"""Validation of prepared media before browser publishing."""
from pathlib import Path

URLS = {"x": "https://x.com/compose/post", "instagram": "https://www.instagram.com/", "pinterest": "https://www.pinterest.com/pin-creation-tool/"}

def validate(job):
    platform = job.get("platform")
    if platform not in URLS:
        raise ValueError("Unsupported platform")
    files = job.get("files", [])
    limit = {"x": 4, "instagram": 10, "pinterest": 1}[platform]
    if not 1 <= len(files) <= limit or any(not Path(f).is_file() for f in files):
        raise ValueError("Missing images or invalid image count")
    sizes = [Path(f).stat().st_size for f in files]
    if max(sizes) > 12*1024*1024 or sum(sizes) > 24*1024*1024:
        raise ValueError('每张图片最多 12 MB，每个任务最多 24 MB')
    if platform == "pinterest" and not job.get("boardName", "").strip():
        raise ValueError("Enter the exact Pinterest board name before publishing")

