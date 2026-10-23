import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainFile = path.join(root, 'dist-electron', 'electron', 'main.js');
const rendererUrl = 'http://127.0.0.1:5173';

function rendererReady() {
  return new Promise((resolve) => {
    const request = http.get(rendererUrl, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(600, () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

const startedAt = Date.now();
while (Date.now() - startedAt < 120000) {
  try { await access(mainFile); } catch { await new Promise((resolve) => setTimeout(resolve, 350)); continue; }
  if (!await rendererReady()) { await new Promise((resolve) => setTimeout(resolve, 350)); continue; }
  const windows = process.platform === 'win32';
  const executable = path.join(root, 'node_modules', '.bin', windows ? 'electron.cmd' : 'electron');
  const child = spawn(executable, ['.'], {
    cwd: root,
    env: { ...process.env, PRIME_CLIENT_DEV_URL: rendererUrl },
    stdio: 'inherit',
    shell: windows
  });
  child.on('exit', (code) => { process.exitCode = code ?? 0; });
  child.on('error', (error) => { console.error(`Could not start Electron: ${error.message}`); process.exitCode = 1; });
  const wait = new Promise((resolve) => child.once('exit', resolve));
  await wait;
  process.exit();
}
console.error('Timed out waiting for Vite and the Electron build.');
process.exit(1);
