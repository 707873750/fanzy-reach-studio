"""Offline Facebook integration tests; no real posts are sent."""
import unittest
import test_playwright
from adapters import validate

PAGE = '''<button onclick="document.querySelector('[role=dialog]').hidden=false">What's on your mind?</button>
<div role="dialog" hidden>
<div contenteditable="true" role="textbox" style="min-height:30px"></div>
<input type="file" accept="image/*" multiple onchange="for(const f of this.files){const b=document.createElement('button');b.textContent='Remove photo';document.querySelector('#photos').append(b)}">
<div id="photos"></div>
<button onclick="window.clicks=(window.clicks||0)+1;document.querySelector('#success').textContent='Your post has been shared.'">Post</button>
</div><div id="success" role="status"></div>'''


class FacebookTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_playwright.PlaywrightPublishingTests.asyncSetUp
    asyncTearDown = test_playwright.PlaywrightPublishingTests.asyncTearDown
    checkpoint = test_playwright.PlaywrightPublishingTests.checkpoint

    async def test_multi_image_and_caption(self):
        self.fixture['facebook'] = PAGE
        async def checkpoint():
            await self.checkpoint()
            page = self.context.pages[0]
            self.assertEqual(await page.locator('#photos button').count(), 10)
            self.assertEqual(await page.locator('[role=textbox]').inner_text(), 'PRIVATE fixture caption\n\n#photos')
            return True
        result = await self.runner.publish({**self.job, 'platform':'facebook', 'files':self.job['files']*10, 'hashtags':['#photos']}, checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)
        self.assertIsNone(result.get('url'))
        self.assertEqual(sum(e['step']=='submit.click' for e in self.events), 1)

    async def test_checkpoint_refusal_does_not_click(self):
        self.fixture['facebook'] = PAGE
        async def reject():
            await self.checkpoint()
            return False
        await self.runner.publish({**self.job, 'platform':'facebook'}, reject)
        self.assertFalse(any(e['step']=='submit.click' for e in self.events))

    async def test_missing_confirmation_is_uncertain(self):
        self.fixture['facebook'] = PAGE.replace('Your post has been shared.', 'Uploading')
        async def checkpoint():
            await self.checkpoint()
            await self.context.pages[0].evaluate('const now=Date.now.bind(Date), start=now(); Date.now=()=>start+(now()-start)*1000;')
            return True
        result = await self.runner.publish({**self.job, 'platform':'facebook'}, checkpoint)
        self.assertEqual(result['state'], 'uncertain', result)
        self.assertEqual(sum(e['step']=='submit.click' for e in self.events), 1)

    async def test_stale_confirmation_blocks_submission(self):
        self.fixture['facebook'] = PAGE.replace('id="success" role="status"></div>', 'id="success" role="status">Your post has been shared.</div>')
        result = await self.runner.publish({**self.job, 'platform':'facebook'}, self.checkpoint)
        self.assertEqual(result['state'], 'needs_attention', result)
        self.assertFalse(any(e['step']=='submit.click' for e in self.events))

    async def test_image_limit(self):
        with self.assertRaises(ValueError):
            validate({**self.job, 'platform':'facebook', 'files':self.job['files']*11})

    async def test_localized_home_composer_entry(self):
        for label in ('Qwd Acs，分享你的新鲜事吧！', '分享你的新鲜事吧！',
                      '測試，分享你的新鮮事吧！', '测试，你在想什么？',
                      'What’s on your mind, Tester?'):
            with self.subTest(label=label):
                self.fixture['facebook'] = PAGE.replace("What's on your mind?", label)
                result = await self.runner.publish({**self.job, 'platform':'facebook'}, self.checkpoint)
                self.assertEqual(result['state'], 'succeeded', result)

    async def test_duplicate_entries_never_submit(self):
        entry = '<button>Qwd Acs，分享你的新鲜事吧！</button>'
        self.fixture['facebook'] = PAGE.replace("What's on your mind?", 'Qwd Acs，分享你的新鲜事吧！') + entry
        result = await self.runner.publish({**self.job, 'platform':'facebook'}, self.checkpoint)
        self.assertEqual(result['state'], 'needs_attention', result)
        self.assertFalse(any(e['step']=='submit.click' for e in self.events))

    async def test_chinese_direct_post_button(self):
        for label in ('发帖', '發布', '發佈', '發表'):
            with self.subTest(label=label):
                self.fixture['facebook'] = PAGE.replace('>Post</button>', '>'+label+'</button>').replace("What's on your mind?", 'Qwd Acs，分享你的新鲜事吧！')
                result = await self.runner.publish({**self.job, 'platform':'facebook'}, self.checkpoint)
                self.assertEqual(result['state'], 'succeeded', result)

    async def test_two_step_post_button(self):
        start = PAGE.index('<button onclick="window.clicks=')
        end = PAGE.index('</button>', start) + len('</button>')
        final = PAGE[start:end].replace('>Post</button>', '>发帖</button>')
        next_button = '''<button onclick="window.nextClicks=(window.nextClicks||0)+1;this.closest('[role=dialog]').hidden=true;document.querySelector('#settings').hidden=false">下一步</button>'''
        self.fixture['facebook'] = PAGE[:start]+next_button+PAGE[end:]+f'<div role="dialog" id="settings" hidden>{final}</div>'
        async def checkpoint():
            await self.checkpoint()
            self.assertEqual(await self.context.pages[0].evaluate('window.nextClicks'), 1)
            return True
        result = await self.runner.publish({**self.job, 'platform':'facebook'}, checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)

    async def test_post_button_appears_after_preview(self):
        self.fixture['facebook'] = PAGE.replace('>Post</button>', ' id="post" hidden>发帖</button>').replace("document.querySelector('#photos').append(b)", "document.querySelector('#photos').append(b);setTimeout(()=>document.querySelector('#post').hidden=false,1500)")
        result = await self.runner.publish({**self.job, 'platform':'facebook'}, self.checkpoint)
        self.assertEqual(result['state'], 'succeeded', result)
