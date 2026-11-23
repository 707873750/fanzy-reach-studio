import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const local = new URL('./.local/', import.meta.url);
await fs.mkdir(local, { recursive: true });
const env = { ...process.env };
try { Object.assign(env, (await import('node:util')).parseEnv(await fs.readFile(new URL('./.dev.vars', import.meta.url), 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
env.DEMO_PASSWORD ||= 'demo12345';
if (!env.VOLC_AK || !env.VOLC_SK) {
  const keys = await new Promise(resolve => {
    const childEnv = { ...process.env }; delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(createRequire(import.meta.url)('electron'), [fileURLToPath(new URL('./read-local-keys.cjs', import.meta.url))], { env: childEnv, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const timer = setTimeout(() => { child.kill(); resolve(null); }, 12000);
    child.once('message', value => { clearTimeout(timer); resolve(value); });
    child.once('error', () => { clearTimeout(timer); resolve(null); });
    child.once('exit', () => { clearTimeout(timer); resolve(null); });
  });
  if (keys?.ak && keys?.sk) { env.VOLC_AK = keys.ak; env.VOLC_SK = keys.sk; }
}
// This launcher only bridges local encrypted credentials. All HTTP and business
// logic runs in Python; credentials are inherited privately, never CLI arguments.
console.log(`Volc credentials: ${env.VOLC_AK && env.VOLC_SK ? 'ready' : 'missing; configure backend/.dev.vars'}`);
const child = spawn('uv', ['run', '--no-default-groups', '--group', 'local', 'python', 'local.py'], {
  cwd: fileURLToPath(new URL('.', import.meta.url)), env, windowsHide: true, stdio: 'inherit'
});
child.once('error', () => { console.error('Unable to start FastAPI. Install uv and run npm run backend:install first.'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
