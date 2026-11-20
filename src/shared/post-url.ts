import type { Platform } from "./types";

/** Accept a post permalink, never a home page, composer, profile or job URL. */
export function postUrl(platform: Platform, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname;
    let valid = false;
    switch (platform) {
      case "pinterest": valid = host === "pinterest.com" && /^\/pin\/\d+\/?$/.test(path); break;
      case "bluesky": valid = host === "bsky.app" && /^\/profile\/[^/]+\/post\/[A-Za-z0-9_-]+\/?$/.test(path); break;
      case "instagram": valid = host === "instagram.com" && /^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(path); break;
      case "x": valid = ["x.com", "twitter.com"].includes(host) && /^\/(?:i\/status|[A-Za-z0-9_]+\/status)\/\d+\/?$/.test(path); break;
      case "tiktok": valid = host === "tiktok.com" && /^\/@[A-Za-z0-9._-]+\/(video|photo)\/\d+\/?$/.test(path); break;
      case "facebook": {
        if (host !== "facebook.com") break;
        const id = (value: string | null) => value !== null && /^(?:\d+|pfbid[A-Za-z0-9]+)$/.test(value);
        valid = /^\/(?:[^/]+\/)?posts\/(?:\d+|pfbid[A-Za-z0-9]+)\/?$/.test(path) || /^\/reel\/\d+\/?$/.test(path)
          || /^\/pfbid[A-Za-z0-9]+\/?$/.test(path)
          || (path === "/permalink.php" && id(url.searchParams.get("story_fbid")) && id(url.searchParams.get("id")))
          || (/^\/watch\/?$/.test(path) && /^\d+$/.test(url.searchParams.get("v") || ""));
        break;
      }
    }
    if (!valid) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (!(platform === "facebook" && ["story_fbid", "id", "v"].includes(key))) url.searchParams.delete(key);
    }
    return url.href;
  } catch { return null; }
}
