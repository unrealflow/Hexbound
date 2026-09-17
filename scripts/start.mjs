/** Hexbound one-click launcher (cross-platform).
 * Usage: npm start   (or: node scripts/start.mjs [--port 5188] [--no-open])
 * Installs deps and textures when missing, then serves the dev build and opens it.
 */
import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createConnection } from 'net';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const port = portArg >= 0 ? Number(argv[portArg + 1]) : 5173;
const open = !argv.includes('--no-open');
const url = `http://127.0.0.1:${port}/`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (args) => {
  console.log(`\n$ npm ${args.join(' ')}`);
  const r = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`[Hexbound] npm ${args.join(' ')} failed (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
};

console.log('== Hexbound 一键启动 ==');
console.log(`[1/4] Node ${process.version}`);

if (!existsSync(join(root, 'node_modules'))) {
  console.log('[2/4] 首次运行：安装依赖');
  run(['install']);
} else {
  console.log('[2/4] 依赖已就绪');
}

const texDir = join(root, 'public', 'tex');
const texMissing = !existsSync(texDir) || readdirSync(texDir).filter((f) => f.endsWith('.png')).length === 0;
if (texMissing) {
  console.log('[3/4] 生成程序化细节贴图');
  run(['run', 'tex:gen']);
} else {
  console.log('[3/4] 贴图已就绪 (public/tex)');
}

mkdirSync(texDir, { recursive: true });
console.log(`[4/4] 启动 dev server: ${url}`);

// `npm run dev` already binds 127.0.0.1; only the port is forced here.
const vite = spawn(npm, ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const portOpen = () =>
  new Promise((resolve) => {
    const sock = createConnection({ host: '127.0.0.1', port });
    sock.setTimeout(400);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => { sock.destroy(); resolve(false); });
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });

const deadline = Date.now() + 60000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 400));
  if (vite.exitCode !== null) {
    console.error('[Hexbound] dev server 提前退出');
    process.exit(1);
  }
  if (await portOpen()) break;
}

if (!(await portOpen())) {
  console.error('[Hexbound] 等待 dev server 超时');
  vite.kill();
  process.exit(1);
}

console.log(`\n已就绪 → ${url}  (Ctrl+C 停止)`);
if (open) {
  const cmd =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
}

const stop = () => {
  vite.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
vite.on('exit', (code) => process.exit(code ?? 0));
