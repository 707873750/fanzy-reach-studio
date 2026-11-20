import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const nativeRequire = createRequire(import.meta.url);
async function load(file, dependencies, globals = {}) {
  const sandbox = { exports: {}, require: name => dependencies[name] ?? nativeRequire(name), Buffer, URL, AbortSignal, ...globals };
  vm.runInNewContext(ts.transpileModule(await fs.readFile(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, sandbox);
  return sandbox.exports;
}
const signing = await load('src/main/volc-signing.ts', {});
const signed = signing.signVisualRequest('CVSync2AsyncSubmitTask', '{}', 'test-ak', 'test-sk', new Date('2026-11-20T01:02:03Z'));
assert.equal(signed.headers['X-Date'], '20261120T010203Z');
assert.equal(signed.headers['X-Content-Sha256'], '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
assert.match(signed.headers.Authorization, /Credential=test-ak\/20261120\/cn-north-1\/cv\/request/);
assert.notEqual(signed.headers.Authorization, signing.signVisualRequest('CVSync2AsyncGetResult', '{}', 'test-ak', 'test-sk', new Date('2026-11-20T01:02:03Z')).headers.Authorization);
const settings = {};
let handler, calls = [], saved = 0, imported = 0, cleaned = 0, encryption = true, importError = false;
let asset = { id: 'source', originalPath: '/assets/source.jpg', mimeType: 'image/jpeg' };
let dimensions = { width: 1024, height: 1024 }, fileSize = 100;
const api = await load('src/main/image-generation.ts', {
  electron: { safeStorage: { isEncryptionAvailable: () => encryption, encryptString: value => Buffer.from(value), decryptString: value => value.toString() } },
  './store': { getStore: () => ({ settings }), persistStore: async () => { saved++; }, findImage: id => id === 'source' ? asset : undefined },
  './ai-service': { getSettings: () => ({ hasVolcKeys: !!settings.volcKeysEncrypted, hasPendingImageTask: !!settings.volcPendingTask }) },
  './image-service': { importFiles: async () => { imported++; return { imported: [{ id: 'new-image', originalPath: 'private', thumbnailPath: 'private' }], errors: importError ? ['disk failure'] : [], duplicates: [] }; } },
  './volc-signing': signing,
  '../shared/image-generation': { IMAGE_SIZES: ['1328x1328'], IMAGE_PROMPT_LIMIT: 800 },
  'node:timers/promises': { setTimeout: async () => {} },
  sharp: () => ({ metadata: async () => ({ ...dimensions, format: 'jpeg' }), rotate() { return this; }, resize() { return this; }, webp() { return this; }, toBuffer: async () => Buffer.from('thumbnail') }),
  'node:fs/promises': { stat: async () => ({ size: fileSize, isFile: () => true }), readFile: async () => Buffer.from('source-image'), mkdtemp: async () => '/tmp/fanzy-volc-test', writeFile: async () => {}, rm: async () => { cleaned++; } }
}, { fetch: async (url, options) => { const body = JSON.parse(options.body); calls.push({ url, body, options }); return handler(url, body); } });
const response = (data, code = 10000, status = 200) => new Response(JSON.stringify({ code, data }), { status });
const done = () => response({ status: 'done', binary_data_base64: [Buffer.from('output').toString('base64')] });
const input = { mode: 'generate', prompt: 'a cat', size: '1328x1328' };
await assert.rejects(api.generateImage(input), /设置/);
encryption = false; await assert.rejects(api.saveVolcKeys('ak', 'sk'), /安全存储/); encryption = true;
await api.saveVolcKeys('ak', 'sk');
assert.notEqual(settings.volcKeysEncrypted, 'sk');
await assert.rejects(api.generateImage({ ...input, prompt: '' }), /描述/);
await assert.rejects(api.generateImage({ ...input, size: '9999x9999' }), /尺寸/);
handler = url => url.includes('SubmitTask') ? response({ task_id: '123' }) : done();
const result = await api.generateImage(input);
assert.equal(calls[0].body.req_key, 'high_aes_general_v30l_zt2i');
assert.equal(calls[0].body.width, 1328);
assert.equal(calls[1].body.task_id, '123');
assert.equal(JSON.parse(calls[1].body.req_json).return_url, false);
assert.match(result.dataUrl, /^data:image\/jpeg;base64,/);
assert.equal(imported, 0); assert.equal(cleaned, 0);
assert.equal(api.getGeneratedImage().taskId, result.taskId);
await assert.rejects(api.saveGeneratedImage('wrong-id'), /失效/);
assert.equal(imported, 0);
const stored = await api.saveGeneratedImage(result.taskId);
assert.equal(stored.imported[0].originalPath, undefined);
assert.equal(imported, 1); assert.equal(api.getGeneratedImage(), null);
const beforeUploadCalls = calls.length;
const uploaded = await api.loadEditImage('/user/chosen.jpg');
assert.equal(uploaded.fileName, 'chosen.jpg');
assert.match(uploaded.thumbnailDataUrl, /^data:image\/webp;base64,/);
assert.equal(uploaded.originalPath, undefined);
assert.equal(imported, 1); assert.equal(calls.length, beforeUploadCalls);
fileSize = 6 * 1024 * 1024;
await assert.rejects(api.loadEditImage('/user/large.jpg'), /5 MB/);
fileSize = 100;
await assert.rejects(api.generateImage({ ...input, mode: 'edit', uploadId: 'unknown' }), /失效/);
calls = [];
await api.generateImage({ ...input, mode: 'edit', uploadId: uploaded.id });
assert.equal(calls[0].body.binary_data_base64[0], Buffer.from('source-image').toString('base64'));
assert.equal(imported, 1);
await api.discardImageTask();
await api.loadEditImage('/user/new.jpg');
await assert.rejects(api.generateImage({ ...input, mode: 'edit', uploadId: uploaded.id }), /失效/);
await assert.rejects(api.saveGeneratedImage(result.taskId), /失效/);
assert.equal(settings.volcPendingTask, undefined); assert.equal(cleaned, 1);
calls = [];
await api.generateImage({ ...input, mode: 'edit', imageId: 'source', scale: 0.7 });
assert.equal(calls[0].body.req_key, 'seededit_v3.0');
assert.equal(calls[0].body.binary_data_base64[0], Buffer.from('source-image').toString('base64'));
assert.equal(calls[0].body.scale, 0.7); assert.equal(calls[0].body.width, undefined);
await api.discardImageTask();
assert.equal(imported, 1); assert.equal(api.getGeneratedImage(), null);
fileSize = 6 * 1024 * 1024; await assert.rejects(api.generateImage({ ...input, mode: 'edit', imageId: 'source' }), /5 MB/); fileSize = 100;
dimensions = { width: 4000, height: 100 }; await assert.rejects(api.generateImage({ ...input, mode: 'edit', imageId: 'source' }), /比例/); dimensions = { width: 1024, height: 1024 };
await assert.rejects(api.generateImage({ ...input, mode: 'edit', imageId: 'missing' }), /底图/);
await assert.rejects(api.generateImage({ ...input, mode: 'edit', imageId: 'source', scale: NaN }), /强度/);
handler = url => url.includes('SubmitTask') ? response({ task_id: 'resume-id' }) : (() => { throw new Error('secret'); })();
await assert.rejects(api.generateImage(input), /继续查询/);
assert.equal(settings.volcPendingTask.id, 'resume-id');
await assert.rejects(api.generateImage(input), /已有待查询/);
calls = []; handler = done;
await api.resumeImageTask(); assert.equal(calls.length, 1); assert.ok(calls[0].url.includes('GetResult'));
await api.discardImageTask();
handler = url => url.includes('SubmitTask') ? response({ task_id: 'slow' }) : response({ status: 'generating' });
await assert.rejects(api.generateImage(input), /仍在处理中/);
assert.equal(settings.volcPendingTask.id, 'slow');
handler = () => response({ status: 'expired' }); await assert.rejects(api.resumeImageTask(), /过期/); assert.equal(settings.volcPendingTask, undefined);
handler = () => response(null, 50413, 400); await assert.rejects(api.generateImage(input), /审核/);
handler = url => url.includes('SubmitTask') ? response({ task_id: 'disk' }) : done(); importError = true;
const diskPreview = await api.generateImage(input);
await assert.rejects(api.saveGeneratedImage(diskPreview.taskId), /保存失败/);
assert.equal(settings.volcPendingTask.id, 'disk');
assert.equal(api.getGeneratedImage().taskId, 'disk'); importError = false;
const callCount = calls.length;
await api.saveGeneratedImage(diskPreview.taskId);
assert.equal(calls.length, callCount);
let release; handler = () => new Promise(resolve => { release = resolve; });
const pending = api.generateImage(input); await Promise.resolve();
await assert.rejects(api.generateImage(input), /正在处理/);
release(response(null, 50429, 429)); await assert.rejects(pending, /限流/);
await api.discardImageTask(); await api.clearVolcKeys();
assert.equal(settings.volcKeysEncrypted, undefined); assert.ok(saved > 0); assert.ok(imported > 0);
console.log('PASS: signing, encrypted settings, exact model contracts, edit validation, polling, persistence/resume, expiry, disk failure, concurrency and secret isolation');

// Exercise actual image decoders, including WebP contents in a .png file.
const sharp = nativeRequire('sharp');
const realApi = await load('src/main/image-generation.ts', {
  electron: {}, './store': {}, './ai-service': {}, './image-service': {},
  './volc-signing': signing, '../shared/image-generation': {}
});
const pixels = { create: { width: 32, height: 32, channels: 4, background: { r: 30, g: 80, b: 120, alpha: 0.5 } } };
const png = await sharp(pixels).png().toBuffer();
assert.deepEqual(await realApi.normalizeEditImage(png), png);
for (const format of ['webp', 'avif']) {
  const bytes = await sharp(pixels)[format]().toBuffer();
  const normalized = await realApi.normalizeEditImage(bytes);
  const meta = await sharp(normalized).metadata();
  assert.equal(meta.format, 'png'); assert.equal(meta.width, 32); assert.equal(meta.hasAlpha, true);
}
await assert.rejects(realApi.normalizeEditImage(Buffer.from('not an image')), /无法读取/);
console.log('PASS: real PNG passthrough, WebP/AVIF conversion, alpha preservation and corrupt file feedback');
