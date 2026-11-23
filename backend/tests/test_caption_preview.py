import json
from test_captions import CaptionTests

class CaptionPreviewTests(CaptionTests):
    def output(self, data):
        self.transport.raw = json.dumps({'choices':[{'message':{'content':json.dumps(data)}}]})

    async def test_three_candidates_one_call_and_distinct_validation(self):
        self.output({'candidates':['First','Second','Third']})
        data={**self.data, 'action':'variants', 'text':'Existing context'}
        result=await self.client.post('/api/captions',json=data)
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['candidates'],['First','Second','Third'])
        self.assertEqual(len(self.transport.calls),1)
        for candidates in [['Same','Same','Other'],['Only one'],['a','b',None],['a','b','x'*5001]]:
            self.output({'candidates':candidates})
            self.assertEqual((await self.client.post('/api/captions',json=data)).status_code,502)

    async def test_translation_text_only(self):
        self.output({'caption':'Hello world'})
        result=await self.client.post('/api/captions',json={**self.data,'images':[], 'action':'translate','text':'你好世界','language':'English'})
        self.assertEqual(result.status_code,200,result.text)
        content=self.transport.calls[-1][2]['messages'][0]['content']
        self.assertEqual(len(content),1)
        self.assertIn('Translate faithfully into English',content[0]['text'])
        self.assertIn('你好世界',content[0]['text'])

    async def test_shortening_bound_and_strictly_shorter(self):
        data={**self.data,'images':[], 'action':'shorten','text':'Original longer caption','maxLength':10}
        self.output({'caption':'Short'})
        self.assertEqual((await self.client.post('/api/captions',json=data)).status_code,200)
        for text in ['x'*11,data['text']]:
            self.output({'caption':text})
            self.assertEqual((await self.client.post('/api/captions',json=data)).status_code,502)
        self.output({'caption':'Original longer caption'})
        self.assertEqual((await self.client.post('/api/captions',json={**data,'maxLength':100})).status_code,502)

    async def test_invalid_preview_fields_rejected_before_provider(self):
        for patch in [{'action':'other','text':'abc'}, {'action':'translate','text':'abc','language':''},
                      {'action':'shorten','text':'abc','maxLength':True}, {'action':'shorten','text':'','maxLength':100},
                      {'action':'variants','text':'x'*5001}]:
            self.assertEqual((await self.client.post('/api/captions',json={**self.data,**patch})).status_code,400)
        self.assertEqual(self.transport.calls,[])
