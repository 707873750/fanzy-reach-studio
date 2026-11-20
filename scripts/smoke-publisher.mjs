import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const binary = path.resolve(process.argv[2] || `build/publisher/${process.platform}-${process.arch}/fanzy-publisher/${process.platform === 'win32' ? 'fanzy-publisher.exe' : 'fanzy-publisher'}`);
const cwd = mkdtempSync(path.join(os.tmpdir(), 'fanzy-package-'));
try {
  const env = { ...process.env, PATH: process.platform === 'win32' ? `${process.env.SystemRoot}\\System32` : '/usr/bin:/bin', PYTHONUTF8: '1' };
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  delete env.FANZY_PYTHON;
  const result = spawnSync(binary, ['--self-test'], { cwd, env, encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(result.stdout.split(/\r?\n/).some(line => {
    try { const value = JSON.parse(line); return value.type === 'self-test' && value.ok && value.frozen; } catch { return false; }
  }), result.stdout);
  console.log('PASS: bundled Python, Playwright driver, Chrome, session encryption and page adapter; no system Python on PATH.');
} finally {
  if (path.dirname(path.resolve(cwd)) !== path.resolve(os.tmpdir()) || !path.basename(cwd).startsWith('fanzy-package-')) throw new Error('Unexpected temporary directory');
  rmSync(cwd, { recursive: true, force: true });
}
