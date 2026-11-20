import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Build on Windows or macOS.');
const local = path.resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.FANZY_PYTHON || (existsSync(local) ? local : process.platform === 'win32' ? 'py' : 'python3');
const prefix = python === 'py' ? ['-3'] : [];
const probe = spawnSync(python, [...prefix, '-c', 'import platform, struct; print(platform.machine().lower()); print(struct.calcsize("P") * 8)'], { encoding: 'utf8' });
if (probe.error) throw probe.error;
const [machine, bits] = (probe.stdout || '').trim().split(/\r?\n/);
const pythonArch = ['arm64', 'aarch64'].includes(machine) ? 'arm64' : ['amd64', 'x86_64'].includes(machine) ? 'x64' : machine;
if (probe.status !== 0 || bits !== '64' || pythonArch !== process.arch) throw new Error('Node and Python must both use the target native 64-bit architecture.');
function run(args) {
  const result = spawnSync(python, [...prefix, ...args], { stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYINSTALLER_CONFIG_DIR: path.resolve('build/pyinstaller-cache') } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const target = `${process.platform}-${process.arch}`;
run(['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--console',
  '--name', 'fanzy-publisher', '--distpath', `build/publisher/${target}`,
  '--workpath', `build/pyinstaller/${target}`, '--specpath', 'build',
  '--paths', path.resolve('python'), '--add-data', `${path.resolve('python/page_adapter.js')}${path.delimiter}.`,
  '--collect-all', 'playwright', '--hidden-import', 'cryptography.hazmat.primitives.ciphers.aead',
  'python/publisher.py']);
mkdirSync(`build/publisher/${target}`, { recursive: true });
writeFileSync(`build/publisher/${target}/build-info.json`, JSON.stringify({ platform: process.platform, arch: process.arch }, null, 2));
