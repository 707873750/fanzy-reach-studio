"""Read-only X session comparison; never fills fields or submits a post."""
import argparse
import asyncio
import json
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright
import session_store


async def inspect(context, mode):
    page = context.pages[0] if context.pages else await context.new_page()
    result = {'mode': mode}
    result['auth_cookie_present'] = any(
        c['name'] == 'auth_token' and c['domain'].lstrip('.') == 'x.com'
        for c in await context.cookies('https://x.com'))
    for label, url in [('home', 'https://x.com/home'),
                       ('composer', 'https://x.com/compose/post')]:
        status = {}
        try:
            response = await page.goto(url, wait_until='domcontentloaded', timeout=45000)
            status['http'] = response.status if response else None
            try:
                ready = ('[data-testid="tweetTextarea_0"]' if label == 'composer'
                         else '[data-testid="SideNav_AccountSwitcher_Button"]')
                await page.wait_for_selector(
                    ready + ',input[autocomplete="username"],input[name="password"]',
                    timeout=15000)
            except Exception:
                pass
            status.update(await page.evaluate('''() => ({
                account_menu: !!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'),
                composer: !!document.querySelector('[data-testid="tweetTextarea_0"]'),
                login_field: !!document.querySelector('input[autocomplete="username"],input[name="password"]'),
                restricted: [...document.querySelectorAll('h1,h2,h3,[role="heading"]')].some(n => /Your account is suspended|你的账号已被冻结|你的账号已被暂停/i.test(n.textContent))
            })'''))
        except Exception as error:
            status['error_type'] = type(error).__name__
            status['http_response_failure'] = 'ERR_HTTP_RESPONSE_CODE_FAILURE' in str(error)
        status['location'] = urlsplit(page.url).netloc + urlsplit(page.url).path
        result[label] = status
    return result


async def main(profile):
    async with async_playwright() as playwright:
        for headless in (False, True):
            context = await playwright.chromium.launch_persistent_context(
                str(profile), channel='chrome', headless=headless,
                viewport={'width': 1440, 'height': 1000})
            try:
                if headless:
                    state = session_store.load(profile)
                    if state:
                        await context.set_storage_state(state)
                result = await inspect(context, 'headless' if headless else 'visible')
                if not headless:
                    session_store.save(profile, await context.storage_state(indexed_db=True))
                print(json.dumps(result), flush=True)
            finally:
                await context.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('profile', type=Path)
    args = parser.parse_args()
    if not args.profile.is_dir():
        parser.error('Existing dedicated profile required')
    asyncio.run(main(args.profile.resolve()))
