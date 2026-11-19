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
