// node dev.mjs [dir]  — LOCAL TESTING ONLY. Serves a scratch copy of the codex plus the API on one port.
// Adds /dev-login (sets a session cookie) because passkeys need a real authenticator. Never deployed.
import { createServer } from 'node:http';
import { mkdirSync, cpSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const SCRATCH = process.argv[2] || '/tmp/codex-dev';
const PORT = Number(process.env.PORT || 4175);
rmSync(SCRATCH, { recursive: true, force: true }); mkdirSync(join(SCRATCH, 'site'), { recursive: true });
for (const f of ['index.html', 'scribe.js', 'scribe.css', 'read.css', 'posts.json']) cpSync(join(ROOT, f), join(SCRATCH, 'site', f));
cpSync(join(ROOT, 'posts'), join(SCRATCH, 'data', 'posts'), { recursive: true });
const app = createApp({ dataDir: join(SCRATCH, 'data'), siteDir: join(SCRATCH, 'site'), rpID: 'localhost', origin: `http://localhost:${PORT}`, setupCode: 'dev', secureCookie: false });
app.rebuild();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/dev-login') { res.writeHead(302, { 'set-cookie': app.cookieFor(app.newSession()), location: '/' }); return res.end(); }
  if (u.pathname.startsWith('/api/')) return app.handle(req, res).catch(e => { console.error(e); res.writeHead(500); res.end('{}'); });
  let f = join(SCRATCH, 'site', decodeURIComponent(u.pathname)); if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!f.startsWith(join(SCRATCH, 'site')) || !existsSync(f)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(f));
}).listen(PORT, '127.0.0.1', () => console.log(`dev codex on http://localhost:${PORT}  (scratch: ${SCRATCH})`));
