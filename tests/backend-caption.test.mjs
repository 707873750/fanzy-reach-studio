import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const nativeRequire = createRequire(import.meta.url);
const settings = { backendUrl: 'https://backend.example.test', deepSeekKeyEncrypted: 'legacy-provider-key' };
let saved = 0, calls = 0, handler;
const dependencies = {
  electron: { safeStorage: { isEncryptionAvailable: () => true, decryptString: value => value.toString() } },
  './store': { getStore: () => ({ settings }), persistStore: async () => { saved++; } },
  './settings-service': {}, './image-service': {}, '../shared/image-generation': {}
};
const sandbox = { exports: {}, require: name => dependencies[name] ?? nativeRequire(name), Buffer, URL, AbortSignal,
  fetch: async (url, options) => { calls++; return handler(url, options); } };
const source = (await fs.readFile('src/main/backend-service.ts', 'utf8')).replace('import.meta.env.MAIN_VITE_BACKEND_URL', 'undefined');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, sandbox);
const api = sandbox.exports;
const input = { images: ['data:image/jpeg;base64,fixture'], platforms: ['x'], shared: false, hasVideo: false };
await assert.rejects(api.backendCaption(input), /请先登录/);
assert.equal(calls, 0); // A legacy local provider key must never bypass backend login.
settings.backendTokenEncrypted = Buffer.from('a'.repeat(64)).toString('base64');
handler = async (url, options) => {
  assert.equal(url, 'https://backend.example.test/api/captions');
  assert.equal(options.headers.Authorization, 'Bearer ' + 'a'.repeat(64));
  assert.equal(options.redirect, 'error');
  assert.deepEqual(JSON.parse(options.body), input);
  assert.ok(!options.body.includes('legacy-provider-key'));
  return new Response(JSON.stringify({ caption: 'Generated copy', hashtags: [] }));
};
assert.equal((await api.backendCaption(input)).caption, 'Generated copy');
handler = async () => { throw new Error('private network error'); };
await assert.rejects(api.backendCaption(input), error => error.message.includes('原草稿已保留') && !error.message.includes('private'));
handler = async () => new Response('not-json');
await assert.rejects(api.backendCaption(input), /格式不正确/);
handler = async () => new Response('x'.repeat(256 * 1024 + 1));
await assert.rejects(api.backendCaption(input), /大小限制/);
handler = async () => new Response(JSON.stringify({ error: '请先登录' }), { status: 401 });
await assert.rejects(api.backendCaption(input), /请先登录/);
assert.equal(settings.backendTokenEncrypted, undefined);
assert.equal(saved, 1);
const before = calls;
await assert.rejects(api.backendCaption(input), /请先登录/);
assert.equal(calls, before);
console.log('PASS: backend-only caption routing, session headers, no legacy-key fallback, safe failures, response limits and expired-session cleanup');
