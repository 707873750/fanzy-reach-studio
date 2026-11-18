"""JSON-lines child process for Electron. Run with Python 3.10+.

stdout is protocol only. Each platform gets an app-owned persistent profile.
"""
import json
import sys
from pathlib import Path
from adapters import URLS, prepare, submit, validate


def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def main():
    from playwright.sync_api import sync_playwright
    root = Path(sys.argv[1]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    contexts = {}
    pages = {}
    with sync_playwright() as playwright:
        for line in sys.stdin:
            request = json.loads(line)
            submitted = False
            try:
                platform = request["platform"]
                if platform not in URLS:
                    raise ValueError("Unsupported platform")
                if request["action"] == "publish":
                    validate(request)
                context = contexts.get(platform)
                if context is None:
                    context = playwright.chromium.launch_persistent_context(
                        str(root / platform), channel="msedge", headless=False,
                        viewport={"width": 1280, "height": 900}, locale="en-US")
                    contexts[platform] = context
                    context.on("close", lambda *_, key=platform: contexts.pop(key, None))
                    context.set_default_timeout(20000)
                    context.set_default_navigation_timeout(45000)
                page = pages.get(platform)
                if page is None or page.is_closed():
                    page = context.new_page()
                    pages[platform] = page
                page.bring_to_front()
                if request["action"] == "login":
                    page.goto(URLS[platform], wait_until="domcontentloaded")
                    emit({"type": "result", "state": "opened"})
                    continue
                control, success = prepare(page, request)

                def before_submit():
                    nonlocal submitted
                    emit({"type": "submitting"})
                    ack = json.loads(sys.stdin.readline())
                    if ack != {"ack": "persisted"}:
                        raise RuntimeError("Publish checkpoint was not persisted")
                    submitted = True

                url = submit(page, control, success, before_submit)
                emit({"type": "result", "state": "succeeded", "url": url,
                      "message": "Platform displayed its publication confirmation."})
            except Exception as error:
                # Do not expose Playwright call logs, cookies, or caption content.
                message = (str(error) if isinstance(error, ValueError) else
                           "Browser step could not be verified. Check login, verification challenges, upload progress and page layout in the open browser.")
                emit({"type": "result", "state": "uncertain" if submitted else "needs_attention", "message": message})


if __name__ == "__main__":
    try:
        main()
    except ImportError:
        emit({"type": "fatal", "message": "Python Playwright is missing. Install python/requirements.txt using your configured Python interpreter."})
        sys.exit(1)
