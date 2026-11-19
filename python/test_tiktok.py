"""TikTok photo fixtures; all platform requests are intercepted locally."""
from pathlib import Path
import tempfile
import unittest
from adapters import validate
import test_playwright

PHOTO_PAGE = '''<!doctype html><html><body>
<input type="file" accept="image/jpeg,image/png" multiple onchange="
document.querySelector('#previews').replaceChildren();
for(const file of this.files) {const img=document.createElement('img');img.width=100;img.height=100;img.src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=';document.querySelector('#previews').append(img)}">
<div id="previews"></div><input aria-label="Title"><textarea aria-label="Description"></textarea>
<button onclick="window.clicks=(window.clicks||0)+1;document.querySelector('[role=status]').textContent='Post published'">Post</button>
<div role="status"></div></body></html>'''


class TikTokPublishingTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_playwright.PlaywrightPublishingTests.asyncSetUp
    asyncTearDown = test_playwright.PlaywrightPublishingTests.asyncTearDown
    checkpoint = test_playwright.PlaywrightPublishingTests.checkpoint


    async def test_photos(self):
        self.fixture['tiktok'] = PHOTO_PAGE
        async def checkpoint():
            await self.checkpoint()
            page = self.context.pages[0]
            self.assertEqual(await page.locator('#previews img').count(), 3)
            self.assertEqual(await page.locator('[aria-label=Title]').input_value(), 'Photo title')
            self.assertEqual(await page.locator('textarea').input_value(), 'PRIVATE fixture caption\n\n#photo')
            return True
        result = await self.runner.publish({**self.job, 'platform':'tiktok', 'files':self.job['files']*3,
                                           'title':'Photo title', 'hashtags':['#photo']}, checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)
        self.assertEqual(sum(e['step']=='submit.click' for e in self.events), 1)


    async def test_delayed_photo_tab_without_role(self):
        self.fixture['tiktok'] = PHOTO_PAGE.replace('image/jpeg,image/png', 'video/mp4').replace('</body>', '''
<script>setTimeout(()=>{
const tab=document.createElement('div');tab.innerHTML='<span>照片</span>';
tab.onclick=()=>{window.tabClicks=(window.tabClicks||0)+1;document.querySelector('input[type=file]').accept='image/jpeg,image/png'};
document.body.append(tab);
},1000);</script></body>''')
        async def checkpoint():
            await self.checkpoint()
            self.assertEqual(await self.context.pages[0].evaluate('window.tabClicks'), 1)
            return True
        result = await self.runner.publish({**self.job, 'platform':'tiktok'}, checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)

    async def test_platform_photo_count_and_chinese_editor(self):
        self.fixture['tiktok'] = PHOTO_PAGE.replace('aria-label="Title"', 'placeholder="添加一个吸睛标题"').replace('<textarea aria-label="Description"></textarea>', '<div contenteditable="true" role="combobox" style="min-height:50px"></div>').replace("document.querySelector('#previews').replaceChildren();", "document.querySelector('#previews').replaceChildren();document.querySelector('#count').textContent='已上传 '+this.files.length+' 张照片。拖动可调整顺序。';").replace('</body>', '<p id="count"></p><img width="50" height="50" src="data:image/png;base64,AAAA"></body>')
        async def checkpoint():
            await self.checkpoint()
            page = self.context.pages[0]
            self.assertEqual(await page.locator('[placeholder="添加一个吸睛标题"]').input_value(), 'Photo title')
            self.assertEqual(await page.locator('[contenteditable]').inner_text(), 'PRIVATE fixture caption')
            return True
        result = await self.runner.publish({**self.job, 'platform':'tiktok', 'title':'Photo title', 'files':self.job['files']*2}, checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)

    async def test_review_row_with_same_photo(self):
        action = "const img=document.querySelector('#previews img').cloneNode();history.pushState({},'', '/tiktokstudio/content');document.body.replaceChildren();const row=document.createElement('div');row.append(img,document.createTextNode('内容审核中'));document.body.append(row)"
        self.fixture['tiktok'] = PHOTO_PAGE.replace("window.clicks=(window.clicks||0)+1;document.querySelector('[role=status]').textContent='Post published'", action)
        result = await self.runner.publish({**self.job, 'platform':'tiktok'}, self.checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)
        self.assertIn('审核状态', result['message'])

    async def test_short_plain_success_notice(self):
        action = "const notice=document.createElement('span');notice.textContent='发布成功';document.body.append(notice);setTimeout(()=>notice.remove(),30)"
        self.fixture['tiktok'] = PHOTO_PAGE.replace("window.clicks=(window.clicks||0)+1;document.querySelector('[role=status]').textContent='Post published'", action)
        result = await self.runner.publish({**self.job, 'platform':'tiktok'}, self.checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)

    async def test_native_rich_editor_input(self):
        editor = '''<div contenteditable="true" role="combobox" style="min-height:50px" oninput="
if(!event.isTrusted) {document.body.innerHTML='&lt;h1&gt;出错了&lt;/h1&gt;';throw Error('Untrusted input')}
window.trustedInputs=(window.trustedInputs||0)+1"></div>
<script>document.execCommand=()=>{throw Error('Scripted editing forbidden')};</script>'''
        self.fixture['tiktok'] = PHOTO_PAGE.replace('<textarea aria-label="Description"></textarea>', editor)
        async def checkpoint():
            await self.checkpoint()
            page = self.context.pages[0]
            self.assertGreater(await page.evaluate('window.trustedInputs||0'), 0)
            self.assertEqual(await page.locator('[contenteditable]').inner_text(), '第一行\n第二行\n\n#photo')
            return True
        result = await self.runner.publish({**self.job, 'platform':'tiktok', 'caption':'第一行\n第二行', 'hashtags':['#photo']}, checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)

    async def test_privacy_selection(self):
        for privacy, expected in [('public','所有人'),('self_only','仅自己')]:
            initial='所有人' if privacy=='self_only' else '仅自己'
            panel=f'''<button id="privacy" onclick="document.querySelector('#options').hidden=false">{initial}</button>
<div id="options" hidden><div role="option" onclick="document.querySelector('#privacy').textContent=this.textContent;this.parentElement.hidden=true">所有人</div><div role="option" onclick="document.querySelector('#privacy').textContent=this.textContent;this.parentElement.hidden=true">仅自己</div></div>'''
            self.fixture['tiktok']=PHOTO_PAGE.replace('</body>',panel+'</body>')
            async def checkpoint():
                await self.checkpoint()
                self.assertEqual(await self.context.pages[0].locator('#privacy').inner_text(),expected)
                return True
            result=await self.runner.publish({**self.job,'platform':'tiktok','tiktokPrivacy':privacy},checkpoint)
            self.assertEqual(result['state'],'succeeded',result)

    async def test_privacy_change_before_submit_blocks_post(self):
        self.fixture['tiktok']=PHOTO_PAGE.replace('</body>','<button id="privacy">所有人</button></body>')
        async def checkpoint():
            await self.context.pages[0].locator('#privacy').evaluate("node=>node.textContent='仅自己'")
            return True
        result=await self.runner.publish({**self.job,'platform':'tiktok','tiktokPrivacy':'public'},checkpoint)
        self.assertNotEqual(result['state'],'succeeded',result)
        self.assertFalse(any(e['step']=='submit.click' for e in self.events))

    async def test_empty_rich_editor_with_caret_sentinel(self):
        editor = '''<div contenteditable="true" role="combobox" style="min-height:50px"><div><br></div></div>
<script>document.querySelector('[contenteditable]').addEventListener('input',function(){if(!this.textContent)this.innerHTML='<div>\u200b<br></div>'});</script>'''
        self.fixture['tiktok']=PHOTO_PAGE.replace('<textarea aria-label="Description"></textarea>',editor)
        result=await self.runner.publish({**self.job,'platform':'tiktok','caption':'','hashtags':[]},self.checkpoint)
        self.assertEqual(result['state'],'succeeded',result)

    async def test_empty_caption_does_not_accept_leftover_text(self):
        editor = '''<div contenteditable="true" role="combobox" style="min-height:50px">Old copy</div>
<script>document.querySelector('[contenteditable]').addEventListener('input',function(){this.textContent='Old copy'});</script>'''
        self.fixture['tiktok']=PHOTO_PAGE.replace('<textarea aria-label="Description"></textarea>',editor)
        async def forbidden():
            self.fail('Leftover text must block submission')
        result=await self.runner.publish({**self.job,'platform':'tiktok','caption':'','hashtags':[]},forbidden)
        self.assertEqual(result['state'],'needs_attention',result)

    async def test_project_response_automatically_confirms_without_success_ui(self):
        action = "fetch('/tiktok/web/project/post/v1/',{method:'POST'}).then(()=>{history.pushState({},'', '/tiktokstudio/content');document.body.textContent='作品列表'})"
        self.fixture['tiktok']=PHOTO_PAGE.replace("window.clicks=(window.clicks||0)+1;document.querySelector('[role=status]').textContent='Post published'",action)
        original_setup=self.runner.context_setup
        async def setup(context, job):
            await original_setup(context,job)
            await context.route('**/tiktok/web/project/post/v1/',lambda route:route.fulfill(
                content_type='application/json',body='{"status_code":0,"project_id":"123456789","project_status":1,"single_post_resp_list":[{"post_id":"123456789012345"}]}'))
        self.runner.context_setup=setup
        result=await self.runner.publish({**self.job,'platform':'tiktok'},self.checkpoint)
        self.assertEqual(result['state'],'succeeded',result)
        self.assertFalse(any(e['step']=='submit.unconfirmed' for e in self.events))
        self.assertEqual(sum(e['step']=='submit.click' for e in self.events),1)

    async def test_video_only(self):
        self.fixture['tiktok'] = PHOTO_PAGE.replace('image/jpeg,image/png', 'video/mp4')
        async def forbidden():
            self.fail('Video-only upload must never reach the checkpoint')
        result = await self.runner.publish({**self.job, 'platform':'tiktok'}, forbidden)
        self.assertEqual(result['state'], 'needs_attention', result)
        self.assertIn('图片上传入口', result['message'])


    async def test_missing_confirmation(self):
        self.fixture['tiktok'] = PHOTO_PAGE.replace("'Post published'", "'Uploaded successfully'")
        # Reduce only the success wait in this fixture test.
        from unittest.mock import patch
        from publisher import ADAPTER_PATH
        adapter = ADAPTER_PATH.read_text(encoding='utf-8').replace(',45000)', ',1000)')
        original = Path.read_text
        def read(path, *args, **kwargs):
            return adapter if path == ADAPTER_PATH else original(path, *args, **kwargs)
        with patch.object(Path, 'read_text', read):
            result = await self.runner.publish({**self.job, 'platform':'tiktok'}, self.checkpoint)
        self.assertEqual(result['state'], 'uncertain', result)
        self.assertEqual(sum(e['step']=='submit.click' for e in self.events), 1)


class TikTokValidationTests(unittest.TestCase):
    def test_photo_limits(self):
        with tempfile.TemporaryDirectory() as folder:
            photo = Path(folder)/'photo.jpg'
            photo.write_bytes(b'fixture')
            job = {'platform':'tiktok', 'files':[str(photo)]*35}
            validate(job)
            for patch in [{'files':[str(photo)]*36}, {'title':'a'*91}, {'caption':'a'*4000,'hashtags':['#tag']}, {'title':'😀'*46}]:
                with self.assertRaises(ValueError):
                    validate({**job, **patch})


if __name__ == '__main__':
    unittest.main()
