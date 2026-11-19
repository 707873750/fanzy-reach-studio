import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from http.server import ThreadingHTTPServer
from extension_bridge import Bridge, handler_for


class ExtensionBridgeTests(unittest.TestCase):
    def setUp(self):
        self.bridge = Bridge()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(self.bridge))
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.temp = tempfile.TemporaryDirectory()
        self.file = Path(self.temp.name)/'prepared.jpg'
        self.file.write_bytes(b'prepared fixture')

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.temp.cleanup()

    def post(self, path, body=None, **headers):
        defaults = {'Content-Type':'application/json','Authorization':'Bearer '+self.bridge.token,
                    'Origin':'chrome-extension://'+'a'*32,'X-Fanzy-Client':'test-client-123456789'}
        defaults.update(headers)
        request = urllib.request.Request(f'http://127.0.0.1:{self.server.server_port}'+path,
                                         json.dumps(body or {}).encode(),defaults)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def job(self):
        self.assertEqual(self.post('/pair')[0],200)
        job = self.bridge.create_job({'action':'publish','platform':'x','files':[str(self.file)]})
        lease = self.bridge.lease()
        self.assertNotIn('files',lease)
        return job

    def test_no_access_from_websites_wrong_tokens_or_other_browser(self):
        self.assertEqual(self.post('/pair',Origin='https://x.com')[0],403)
        self.assertEqual(self.post('/pair',Authorization='Bearer wrong')[0],403)
        self.assertEqual(self.post('/pair')[0],200)
        self.assertEqual(self.post('/pair',Origin='chrome-extension://'+'b'*32)[0],403)
        self.assertEqual(self.post('/pair',**{'X-Fanzy-Client':'other-client-123456789'})[0],403)
        self.assertEqual(self.post('/pair',Host='attacker.example')[0],403)

    def test_job_is_never_released_twice_and_assets_are_scoped(self):
        job = self.job()
        self.assertIsNone(self.bridge.lease())
        self.assertEqual(self.post('/asset',{'id':job['id'],'index':0})[0],200)
        self.assertEqual(self.post('/asset',{'id':job['id'],'index':-1})[0],409)
        self.assertEqual(self.post('/asset',{'id':'wrong','index':0})[0],409)
        self.assertEqual(self.post('/result',{'id':job['id'],'state':'succeeded'})[0],409)
        self.assertEqual(self.post('/result',{'id':job['id'],'state':'opened'})[0],409)

    def test_submission_requires_ack_and_is_one_shot(self):
        job = self.job()
        responses = []
        thread = threading.Thread(target=lambda: responses.append(self.post('/checkpoint',{'id':job['id']})))
        thread.start()
        event, active, _ = self.bridge.events.get(timeout=3)
        self.assertEqual(event,'checkpoint')
        self.assertFalse(responses)
        active['permit'] = True; active['ack'].set(); thread.join(timeout=3)
        self.assertEqual(responses[0],(200,{'permit':True}))
        self.assertEqual(self.post('/checkpoint',{'id':job['id']})[0],409)
        status, _ = self.post('/result',{'id':job['id'],'state':'needs_attention','message':'lost browser'})
        self.assertEqual(status,200)
        _, _, result = self.bridge.events.get(timeout=3)
        self.assertEqual(result['state'],'uncertain')
        self.assertEqual(self.post('/result',{'id':job['id'],'state':'succeeded'})[0],409)
        self.assertEqual(self.post('/asset',{'id':job['id'],'index':0})[0],409)

    def test_expired_job_cannot_submit(self):
        job = self.job(); job['done'] = True
        self.assertEqual(self.post('/checkpoint',{'id':job['id']})[0],409)

    def test_old_extension_never_receives_a_scheduled_job(self):
        self.assertEqual(self.post('/pair')[0],200)
        job = self.bridge.create_job({'action':'publish','platform':'x','files':[str(self.file)], 'xScheduledAt':'2030-01-01T12:00:00Z'})
        self.assertIsNone(self.bridge.lease())
        self.assertTrue(job['done'])
        self.assertFalse(job['leased'])
        _, _, result = self.bridge.events.get(timeout=1)
        self.assertEqual(result['state'],'needs_attention')
        self.assertIn('0.3.2', result['message'])
        job = self.bridge.create_job({'action':'publish','platform':'x','files':[str(self.file)], 'xScheduledAt':'2030-01-01T12:00:00Z'})
        self.assertEqual(self.bridge.lease(True)['xScheduledAt'],'2030-01-01T12:00:00Z')
        self.assertEqual(self.post('/result',{'id':job['id'],'state':'succeeded'})[0],409)

    def test_disconnected_browser_cannot_receive_new_job(self):
        with self.assertRaises(ValueError):
            self.bridge.create_job({'action':'login','platform':'x'})

    def test_trace_is_scoped_to_active_job_and_does_not_grant_submission(self):
        entries = []
        self.bridge.logger = entries.append
        job = self.job()
        code, _ = self.post('/log', {'id': job['id'], 'step': 'control.wait', 'message': '等待文案框', 'source': 'page'})
        self.assertEqual(code, 200)
        self.assertEqual(entries[-1]['jobId'], job['id'])
        self.assertEqual(entries[-1]['platform'], 'x')
        self.assertEqual(entries[-1]['source'], 'page')
        self.assertFalse(job['checkpoint'])
        self.assertFalse(job['permit'])
        self.assertEqual(self.post('/log', {'id':'other-job','message':'ignored'})[0],409)


if __name__ == '__main__':
    unittest.main()
