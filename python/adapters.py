"""Validation of prepared media before browser publishing."""
from pathlib import Path

URLS = {"x": "https://x.com/compose/post", "instagram": "https://www.instagram.com/", "pinterest": "https://www.pinterest.com/pin-creation-tool/", "tiktok": "https://www.tiktok.com/tiktokstudio/upload"}

def validate(job):
    platform = job.get("platform")
    if platform not in URLS:
        raise ValueError("Unsupported platform")
    files = job.get("files", [])
    limit = {"x": 4, "instagram": 10, "pinterest": 1, "tiktok": 35}[platform]
    if not 1 <= len(files) <= limit or any(not Path(f).is_file() for f in files):
        raise ValueError("Missing images or invalid image count")
    if platform == "tiktok":
        if len(job.get("title", "").encode("utf-16-le")) // 2 > 90:
            raise ValueError("TikTok 图片标题最多 90 字符")
        description = "\n\n".join(part for part in [job.get("caption", ""), " ".join(job.get("hashtags", []))] if part)
        if len(description.encode("utf-16-le")) // 2 > 4000:
            raise ValueError("TikTok 描述与话题标签合计最多 4000 字符")
    sizes = [Path(f).stat().st_size for f in files]
    if max(sizes) > 12*1024*1024 or sum(sizes) > 24*1024*1024:
        raise ValueError('每张图片最多 12 MB，每个任务最多 24 MB')
    if platform == "pinterest" and not job.get("boardName", "").strip():
        raise ValueError("Enter the exact Pinterest board name before publishing")

