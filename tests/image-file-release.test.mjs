import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reach-image-release-'));
const data = { images: [], drafts: [] };
const paths = { assets: path.join(root, 'assets'), thumbnails: path.join(root, 'thumbnails') };
try {
  await Promise.all(Object.values(paths).map(dir => fs.mkdir(dir)));
  const sandbox = { exports: {}, require: name => {
    if (name === './store') return { getStore: () => data, getAppPaths: () => paths, persistStore: async () => {} };
    if (name === '../shared/draft-lifecycle') return { isPublishRecord: () => false };
    return nativeRequire(name);
  } };
  vm.runInNewContext(ts.transpileModule(await fs.readFile('src/main/image-service.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, sandbox);
  assert.equal(sharp.cache().files.max, 0);
  for (let index = 0; index < 8; index++) {
    const source = path.join(root, `image-${index}.webp`);
    await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: index * 30, g: 50, b: 100 } } }).webp().toFile(source);
    const result = await sandbox.exports.importFiles([source], root);
    assert.equal(result.errors.length, 0);
    assert.equal(result.imported.length, 1);
    const image = data.images[0];
    // Exercise another file-backed Sharp pipeline, as used by AI previews.
    await sharp(image.originalPath).resize(16, 16).jpeg().toBuffer();
    await sandbox.exports.deleteImage(image.id);
    await assert.rejects(fs.access(image.originalPath), { code: 'ENOENT' });
    await assert.rejects(fs.access(image.thumbnailPath), { code: 'ENOENT' });
    await fs.access(source);
  }
  assert.equal(data.images.length, 0);
  console.log('PASS: eight real WebP imports, processing and immediate deletion; sources preserved');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
