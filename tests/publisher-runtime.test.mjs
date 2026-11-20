import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const source = await fs.readFile('src/main/publisher-runtime.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
function runtime(platform, packaged, files = new Map(), encryption = true) {
  const deps = {
    electron: { app: { isPackaged: packaged, getAppPath: () => '/app', getPath: () => '/user' }, safeStorage: {
      isEncryptionAvailable: () => encryption,
      encryptString: value => Buffer.from('encrypted:' + value),
      decryptString: value => value.toString().replace(/^encrypted:/, '')
    } },
    'node:path': path.posix,
    'node:crypto': { randomBytes: () => Buffer.alloc(32, 5) },
    'node:fs': {
      existsSync: p => files.has(p), readFileSync: p => files.get(p),
      writeFileSync: (p, value) => files.set(p, value), mkdirSync: () => {},
      renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); }
    }
  };
  const context = { exports: {}, require: name => deps[name], process: { platform, resourcesPath: '/resources', env: { FANZY_PYTHON: '/external-python' } } };
  vm.runInNewContext(compiled, context);
  return context.exports;
}
for (const platform of ['win32', 'darwin']) {
  const binary = `/resources/publisher/fanzy-publisher${platform === 'win32' ? '.exe' : ''}`;
  const api = runtime(platform, true, new Map([[binary, true]]));
  assert.equal(api.publisherCommand().command, binary, 'packaged app must ignore external Python overrides');
  assert.equal(api.publisherCommand().args.length, 0);
  assert.throws(() => runtime(platform, true).publisherCommand(), /发布组件/);
  assert.equal(runtime(platform, false).publisherCommand().command, '/external-python');
}
const files = new Map();
const api = runtime('darwin', true, files);
const first = api.macSessionKey();
assert.equal(api.macSessionKey(), first, 'all workers must reuse the persisted key');
assert.equal(files.get('/user/session-key.enc').toString(), 'encrypted:' + first);
assert.equal(runtime('win32', true).macSessionKey(), undefined);
assert.throws(() => runtime('darwin', true, new Map(), false).macSessionKey(), /钥匙串/);
console.log('PASS: packaged runtime resolution, missing-worker failure and protected macOS key reuse.');
