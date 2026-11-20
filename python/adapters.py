"""Validation of prepared media before browser publishing."""
from pathlib import Path

URLS = {"facebook": "https://www.facebook.com/", "bluesky": "https://bsky.app/intent/compose", "x": "https://x.com/compose/post", "instagram": "https://www.instagram.com/", "pinterest": "https://www.pinterest.com/pin-creation-tool/", "tiktok": "https://www.tiktok.com/tiktokstudio/upload"}

def validate(job):
    platform = job.get("platform")
    if platform not in URLS:
        raise ValueError("Unsupported platform")
    files = job.get("files", [])
    video = any(Path(f).suffix.lower() in ('.mp4', '.m4v', '.mov', '.webm') for f in files)
    if video:
        if job.get('mediaType') != 'video' or len(files) != 1 or not Path(files[0]).is_file() or Path(files[0]).suffix.lower() != '.mp4':
            raise ValueError('视频任务必须只包含一个已校验的 MP4 视频')
        cap = {'x': 512_000_000, 'bluesky': 300_000_000}.get(platform, 1_000_000_000)
        if not 0 < Path(files[0]).stat().st_size <= cap:
            raise ValueError('视频文件为空或超过平台大小限制')
    elif job.get('mediaType') == 'video':
        raise ValueError('视频任务缺少 MP4 文件')
    limit = {"facebook": 10, "bluesky": 4, "x": 4, "instagram": 10, "pinterest": 1, "tiktok": 35}[platform]
    if not 1 <= len(files) <= limit or any(not Path(f).is_file() for f in files):
        raise ValueError("Missing images or invalid image count")
    if platform == "tiktok":
        if job.get('tiktokPrivacy') not in (None, 'public', 'self_only'):
            raise ValueError('无效的 TikTok 隐私设置')
        if not video and len(job.get("title", "").encode("utf-16-le")) // 2 > 90:
            raise ValueError("TikTok 图片标题最多 90 字符")
        description = "\n\n".join(part for part in [job.get("title", "") if video else "", job.get("caption", ""), " ".join(job.get("hashtags", []))] if part)
        if len(description.encode("utf-16-le")) // 2 > 4000:
            raise ValueError("TikTok 描述与话题标签合计最多 4000 字符")
    sizes = [Path(f).stat().st_size for f in files]
    if not video and (max(sizes) > 12*1024*1024 or sum(sizes) > 24*1024*1024):
        raise ValueError('每张图片最多 12 MB，每个任务最多 24 MB')
    if platform == "pinterest" and not job.get("boardName", "").strip():
        raise ValueError("Enter the exact Pinterest board name before publishing")

