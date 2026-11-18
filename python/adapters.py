"""Visible-browser adapters. Selectors must be verified against each account's UI.

No private API calls, cookie extraction, captcha bypass, or automatic resubmission.
"""
import re
from pathlib import Path

URLS = {
    "x": "https://x.com/compose/post",
    "instagram": "https://www.instagram.com/",
    "pinterest": "https://www.pinterest.com/pin-creation-tool/",
}


def validate(job):
    platform = job.get("platform")
    if platform not in URLS:
        raise ValueError("Unsupported platform")
    files = job.get("files", [])
    limit = {"x": 4, "instagram": 10, "pinterest": 1}[platform]
    if not 1 <= len(files) <= limit or any(not Path(f).is_file() for f in files):
        raise ValueError("Missing images or invalid image count")
    if platform == "pinterest" and not job.get("boardName", "").strip():
        raise ValueError("Enter the exact Pinterest board name before publishing")


def caption(job, include_title=True):
    return "\n\n".join(s for s in [job.get("title", "") if include_title else "",
                                     job.get("caption", ""), " ".join(job.get("hashtags", []))] if s)


def button(page, pattern):
    return page.get_by_role("button", name=re.compile(pattern, re.I))


def prepare(page, job):
    """Prepare only; return an unambiguous final button and success locator."""
    platform = job["platform"]
    page.goto(URLS[platform], wait_until="domcontentloaded")
    files = job["files"]
    if platform == "x":
        editor = page.locator('[data-testid="tweetTextarea_0"]')
        editor.fill(caption(job))
        page.locator('input[data-testid="fileInput"]').set_input_files(files)
        previews = page.locator('[data-testid="attachments"] [data-testid="tweetPhoto"]')
        previews.nth(len(files) - 1).wait_for(state="visible")
        if job.get("altText"):
            for index in range(len(files)):
                button(page, r"^(Add description|Add alt text|添加描述|添加替代文本)$").first.click()
                page.get_by_role("textbox", name=re.compile(r"(Description|Alt text|描述|替代文本)", re.I)).fill(job["altText"])
                button(page, r"^(Save|Done|保存|完成)$").click()
        return page.locator('[data-testid="tweetButton"]'), page.locator('[data-testid="toast"]').filter(has_text=re.compile(r"(Your post was sent|你的帖子已发送|你的推文已发送)", re.I))
    if platform == "instagram":
        page.get_by_role("link", name=re.compile(r"^(New post|Create|创建|新帖子)$", re.I)).click()
        chooser = button(page, r"^(Select from computer|从电脑选择|从计算机选择)$")
        with page.expect_file_chooser() as info:
            chooser.click()
        info.value.set_files(files)
        button(page, r"^(Next|下一步)$").click()
        button(page, r"^(Next|下一步)$").click()
        page.get_by_role("textbox", name=re.compile(r"(Write a caption|撰写说明|添加说明)", re.I)).fill(caption(job))
        if job.get("altText"):
            button(page, r"^(Accessibility|无障碍|辅助功能)$").click()
            fields = page.get_by_role("textbox", name=re.compile(r"(Alt text|替代文本)", re.I))
            if fields.count() != len(files):
                raise ValueError("Cannot identify alt-text fields for every image")
            for field in fields.all():
                field.fill(job["altText"])
        return button(page, r"^(Share|分享)$"), page.get_by_text(re.compile(r"^(Your post has been shared\.?|你的帖子已分享[。！]?)$", re.I))
    page.locator('input[type="file"]').set_input_files(files)
    page.get_by_role("textbox", name=re.compile(r"^(Title|Add your title|标题|添加标题)$", re.I)).fill(job.get("title", ""))
    page.get_by_role("textbox", name=re.compile(r"(Description|Tell everyone|描述|说明)", re.I)).fill(caption(job, False))
    if job.get("altText"):
        button(page, r"^(Add alt text|添加替代文本)$").click()
        page.get_by_role("textbox", name=re.compile(r"(Alt text|替代文本)", re.I)).fill(job["altText"])
    button(page, r"^(Choose a board|Select a board|选择画板|Board|画板)$").click()
    page.get_by_role("button", name=job["boardName"], exact=True).click()
    return button(page, r"^(Publish|发布)$"), page.get_by_text(re.compile(r"^(Your Pin has been published[.!]?|Pin published[.!]?|你的 Pin 已发布[。！]?)$", re.I))


def submit(page, control, success, before_submit):
    # A pre-existing success banner must never confirm this attempt.
    success.wait_for(state="hidden", timeout=5000)
    control.wait_for(state="visible")
    if control.count() != 1 or not control.is_enabled():
        raise ValueError("Publish button is unavailable or ambiguous; review browser")
    before_submit()  # parent durably records uncertainty BEFORE the external side effect
    control.click(timeout=15000)
    success.wait_for(state="visible", timeout=45000)
    # Only capture a URL when we actually landed on a post detail page.
    url = page.url
    patterns = {
        "x.com": r"https://x\.com/[^/]+/status/\d+",
        "instagram.com": r"https://www\.instagram\.com/(p|reel)/[\w-]+/?",
        "pinterest.com": r"https://www\.pinterest\.com/pin/\d+/?",
    }
    return next((url for pattern in patterns.values() if re.fullmatch(pattern, url)), None)
