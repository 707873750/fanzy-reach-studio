import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const nativeRequire = createRequire(import.meta.url);
const data = { images: [], drafts: [] };
let saved;
const sandbox = { exports: {}, require: name => {
  if (name === './store') return {
    getStore: () => data,
    getAppPaths: () => ({ assets: '/assets', thumbnails: '/thumbnails' }),
    persistStore: async () => { saved = JSON.parse(JSON.stringify(data)); }
  };
  if (name === '../shared/draft-lifecycle') return {};
  if (name === 'node:fs') return { createReadStream: async function* () { yield Buffer.from('same image contents'); } };
  if (name === 'node:fs/promises') return {
    stat: async () => ({ isFile: () => true, size: 10 }),
    readFile: async () => Buffer.from('same image contents'),
    copyFile: async () => {}
  };
  if (name === 'sharp') return Object.assign(() => ({
    metadata: async () => ({ width: 10, height: 10, format: 'png' }),
    rotate() { return this; }, resize() { return this; }, webp() { return this; },
    toFile: async () => {}
  }), { cache: value => assert.equal(value, false) });
  return nativeRequire(name);
} };
const compiled = ts.transpileModule(await fs.readFile('src/main/image-service.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText;
vm.runInNewContext(compiled, sandbox);
const { importFiles, listImages } = sandbox.exports;
const folderA = path.resolve('photos/a');
const folderB = path.resolve('photos/b');
let result = await importFiles(['photos/a/nested/image.png'], folderA);
assert.equal(result.imported.length, 1);
assert.deepEqual(saved.images[0].sourceFolders, [folderA], 'nested images belong to the imported root');
result = await importFiles(['photos/b/image.png'], folderB);
assert.equal(result.duplicates.length, 1);
assert.equal(data.images.length, 1, 'folder membership does not duplicate assets');
assert.deepEqual(saved.images[0].sourceFolders, [folderA, folderB]);
await importFiles(['photos/a/image.png'], folderA);
assert.equal(data.images[0].sourceFolders.length, 2, 'repeat imports do not duplicate membership');
assert.deepEqual(Array.from((await listImages())[0].sourceFolders), [folderA, folderB]);
delete data.images[0].sourceFolders;
await importFiles(['photos/a/image.png']);
assert.equal(data.images[0].sourceFolders, undefined, 'legacy assets remain readable');
await importFiles(['photos/a/image.png'], folderA);
assert.deepEqual(saved.images[0].sourceFolders, [folderA], 'reimport backfills legacy assets');
console.log('PASS: folder persistence, recursive import grouping, duplicate membership and legacy backfill');
