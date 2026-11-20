import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const api={};
vm.runInNewContext(ts.transpileModule(await fs.readFile('src/shared/post-url.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:api,URL});
const valid={x:'https://x.com/i/status/123456789',instagram:'https://www.instagram.com/reel/Code_1/',pinterest:'https://www.pinterest.com/pin/123456/',bluesky:'https://bsky.app/profile/did:plc:test/post/abc123',tiktok:'https://www.tiktok.com/@owner/video/123456789012345',facebook:'https://www.facebook.com/permalink.php?story_fbid=123456789&id=987654321'};
for(const [platform,url] of Object.entries(valid)) {
  assert.equal(api.postUrl(platform,url),url);
  assert.equal(api.postUrl(platform,url+(url.includes('?')?'&':'?')+'utm_source=test#top'),url);
  assert.equal(api.postUrl(platform,url.replace('https:','http:')),null);
  assert.equal(api.postUrl(platform,url.replace('https://','https://user:password@')),null);
  assert.equal(api.postUrl(platform,'https://example.com/post/123'),null);
}
for(const [platform,url] of [['x','https://x.com/compose/post'],['instagram','https://www.instagram.com/'],['tiktok','https://www.tiktok.com/tiktokstudio/content'],['facebook','https://www.facebook.com/profile.php?id=123'],['pinterest','https://www.pinterest.com/pin-creation-tool/'],['bluesky','https://bsky.app/profile/owner'],['x','https://x.com.evil.example/user/status/123']]) assert.equal(api.postUrl(platform,url),null);
console.log('PASS: six-platform post URLs, tracking removal, invalid hosts and non-post pages');
