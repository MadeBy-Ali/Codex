// The Codex scribe API. One author, passkey login, Markdown files on disk.
// Run: CODEX_SETUP_CODE=... node server.mjs      (see the CONFIG block for every setting)
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync, renameSync, statSync, rmdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { md } from '../md.mjs';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const HERE = dirname(fileURLToPath(import.meta.url));
const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => new Uint8Array(Buffer.from(s, 'base64url'));
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function createApp(cfg = {}) {
  const C = {
    dataDir: resolve(cfg.dataDir || process.env.CODEX_DATA || join(HERE, 'data')),          // posts/, auth.json, sessions.json
    siteDir: resolve(cfg.siteDir || process.env.CODEX_SITE || join(HERE, '..')),            // where posts.json and p/ are published
    buildScript: resolve(cfg.buildScript || join(HERE, '..', 'build.mjs')),
    rpID: cfg.rpID || process.env.CODEX_RPID || 'codex.limvoid.com',
    origin: cfg.origin || process.env.CODEX_ORIGIN || 'https://codex.limvoid.com',
    setupCode: cfg.setupCode ?? process.env.CODEX_SETUP_CODE ?? '',
    secureCookie: cfg.secureCookie ?? (process.env.CODEX_INSECURE_COOKIE !== '1'),
    sessionDays: 30,
  };
  const postsDir = join(C.dataDir, 'posts');
  mkdirSync(postsDir, { recursive: true });

  // ---------- tiny JSON store (atomic writes) ----------
  const readJSON = (f, d) => { try { return JSON.parse(readFileSync(join(C.dataDir, f), 'utf8')); } catch { return d; } };
  const writeJSON = (f, v) => { const p = join(C.dataDir, f); writeFileSync(p + '.tmp', JSON.stringify(v)); renameSync(p + '.tmp', p); };
  let auth = readJSON('auth.json', { userID: b64u(randomBytes(16)), credentials: [] });   // credentials: {id, publicKey, counter, transports}
  const saveAuth = () => writeJSON('auth.json', auth);
  let sessions = readJSON('sessions.json', {});                                           // token -> expiry ms
  const saveSessions = () => writeJSON('sessions.json', sessions);
  const challenges = new Map();                                                           // challenge key -> {value, exp}

  const newSession = () => {
    const t = b64u(randomBytes(32)); sessions[t] = Date.now() + C.sessionDays * 864e5;
    for (const k of Object.keys(sessions)) if (sessions[k] < Date.now()) delete sessions[k];
    saveSessions(); return t;
  };
  const cookieFor = t => `codex_s=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${C.sessionDays * 86400}${C.secureCookie ? '; Secure' : ''}`;
  const sessionOf = req => {
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)codex_s=([\w-]+)/);
    return m && sessions[m[1]] > Date.now() ? m[1] : null;
  };

  // ---------- brute-force guard: per IP, 10 failures per 15 minutes ----------
  const fails = new Map();
  const blocked = ip => (fails.get(ip) || []).filter(t => t > Date.now() - 9e5).length >= 10;
  const fail = ip => fails.set(ip, [...(fails.get(ip) || []).filter(t => t > Date.now() - 9e5), Date.now()]);

  // ---------- posts on disk ----------
  const clean = s => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
  const slugify = t => clean(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
  const validVol = v => v === '' || /^[a-z0-9][a-z0-9-]{0,59}$/.test(v);
  const validId = id => /^([a-z0-9][a-z0-9-]{0,59}\/)?\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,80}$/.test(id);
  const fileOf = id => join(postsDir, id + '.md');
  const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d + 'T00:00:00'));
  const parse = (id, raw) => {
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/); if (!m) return null;
    const meta = Object.fromEntries(m[1].split('\n').map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
    return { id, volume: id.includes('/') ? id.split('/')[0] : '', title: meta.title || '', date: meta.date || '', summary: meta.summary || '', draft: meta.draft === 'true', body: m[2].replace(/^\n/, '') };
  };
  const serialize = p => `---\ntitle: ${clean(p.title)}\ndate: ${p.date}\nsummary: ${clean(p.summary)}\n${p.draft ? 'draft: true\n' : ''}---\n\n${String(p.body || '').replace(/\r\n/g, '\n').trim()}\n`;
  const volumes = () => readdirSync(postsDir).filter(n => statSync(join(postsDir, n)).isDirectory()).sort();
  const listPosts = () => {
    const out = [];
    for (const f of readdirSync(postsDir)) if (f.endsWith('.md')) out.push(parse(f.slice(0, -3), readFileSync(join(postsDir, f), 'utf8')));
    for (const v of volumes()) for (const f of readdirSync(join(postsDir, v))) if (f.endsWith('.md')) out.push(parse(v + '/' + f.slice(0, -3), readFileSync(join(postsDir, v, f), 'utf8')));
    return out.filter(Boolean).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  };
  const rebuild = () => {
    const r = spawnSync(process.execPath, [C.buildScript], { env: { ...process.env, POSTS_DIR: postsDir, OUT_DIR: C.siteDir }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('build failed: ' + (r.stderr || r.stdout));
  };

  // ---------- http helpers ----------
  const send = (res, code, obj, extra = {}) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
    res.end(JSON.stringify(obj));
  };
  const readBody = req => new Promise((ok, no) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 1e6) { no(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { no(Object.assign(new Error('bad json'), { code: 400 })); } });
  });
  const putChallenge = (key, value) => { challenges.set(key, { value, exp: Date.now() + 3e5 }); return key; };
  const takeChallenge = key => { const c = challenges.get(key); challenges.delete(key); return c && c.exp > Date.now() ? c.value : null; };

  // ---------- routes ----------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x'); const path = url.pathname; const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    if (!path.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    // Mutations must be JSON from our own origin (belt and braces on top of SameSite=Strict)
    if (req.method !== 'GET') {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'json only' });
      const o = req.headers.origin; if (o && o !== C.origin) return send(res, 403, { error: 'bad origin' });
    }
    const me = sessionOf(req); const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);

    if (path === '/api/me' && req.method === 'GET')
      return send(res, 200, { authed: !!me, hasPasskey: auth.credentials.length > 0 });

    // --- register a passkey: first one needs the setup code; more (new phone) need an existing session ---
    if (path === '/api/register/options' && req.method === 'POST') {
      if (blocked(ip)) return send(res, 429, { error: 'slow down' });
      const first = auth.credentials.length === 0;
      if (first ? !(C.setupCode && safeEq(body.code || '', C.setupCode)) : !me) { fail(ip); return send(res, 403, { error: first ? 'wrong setup code' : 'sign in first' }); }
      const options = await generateRegistrationOptions({
        rpName: 'The Codex', rpID: C.rpID, userName: 'scribe', userID: unb64u(auth.userID), attestationType: 'none',
        excludeCredentials: auth.credentials.map(c => ({ id: c.id, transports: c.transports })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      });
      const key = putChallenge(b64u(randomBytes(12)), options.challenge);
      return send(res, 200, { options }, { 'set-cookie': `codex_c=${key}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=300${C.secureCookie ? '; Secure' : ''}` });
    }
    if (path === '/api/register/verify' && req.method === 'POST') {
      const first = auth.credentials.length === 0;
      if (first ? !(C.setupCode && safeEq(body.code || '', C.setupCode)) : !me) { fail(ip); return send(res, 403, { error: 'not allowed' }); }
      const ch = takeChallenge((req.headers.cookie || '').match(/codex_c=([\w-]+)/)?.[1]);
      if (!ch) return send(res, 400, { error: 'challenge expired' });
      const v = await verifyRegistrationResponse({ response: body.response, expectedChallenge: ch, expectedOrigin: C.origin, expectedRPID: C.rpID }).catch(() => null);
      if (!v?.verified) return send(res, 400, { error: 'not verified' });
      const c = v.registrationInfo.credential;
      auth.credentials.push({ id: c.id, publicKey: b64u(c.publicKey), counter: c.counter, transports: c.transports || [] }); saveAuth();
      return send(res, 200, { ok: true }, { 'set-cookie': cookieFor(newSession()) });
    }

    // --- sign in ---
    if (path === '/api/login/options' && req.method === 'POST') {
      if (blocked(ip)) return send(res, 429, { error: 'slow down' });
      if (!auth.credentials.length) return send(res, 409, { error: 'no passkey registered' });
      const options = await generateAuthenticationOptions({ rpID: C.rpID, userVerification: 'preferred', allowCredentials: auth.credentials.map(c => ({ id: c.id, transports: c.transports })) });
      const key = putChallenge(b64u(randomBytes(12)), options.challenge);
      return send(res, 200, { options }, { 'set-cookie': `codex_c=${key}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=300${C.secureCookie ? '; Secure' : ''}` });
    }
    if (path === '/api/login/verify' && req.method === 'POST') {
      if (blocked(ip)) return send(res, 429, { error: 'slow down' });
      const ch = takeChallenge((req.headers.cookie || '').match(/codex_c=([\w-]+)/)?.[1]);
      const cred = auth.credentials.find(c => c.id === body.response?.id);
      if (!ch || !cred) { fail(ip); return send(res, 400, { error: 'not verified' }); }
      const v = await verifyAuthenticationResponse({
        response: body.response, expectedChallenge: ch, expectedOrigin: C.origin, expectedRPID: C.rpID,
        credential: { id: cred.id, publicKey: unb64u(cred.publicKey), counter: cred.counter, transports: cred.transports },
      }).catch(() => null);
      if (!v?.verified) { fail(ip); return send(res, 400, { error: 'not verified' }); }
      cred.counter = v.authenticationInfo.newCounter; saveAuth();
      return send(res, 200, { ok: true }, { 'set-cookie': cookieFor(newSession()) });
    }
    if (path === '/api/logout' && req.method === 'POST') {
      if (me) { delete sessions[me]; saveSessions(); }
      return send(res, 200, { ok: true }, { 'set-cookie': `codex_s=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${C.secureCookie ? '; Secure' : ''}` });
    }

    // --- everything below is the scribe only ---
    if (!me) return send(res, 401, { error: 'sealed' });

    if (path === '/api/preview' && req.method === 'POST') return send(res, 200, { html: md(String(body.body || '')) });

    if (path === '/api/posts' && req.method === 'GET') return send(res, 200, { posts: listPosts(), volumes: volumes() });

    if (path === '/api/volumes' && req.method === 'POST') {          // make a new volume (a folder)
      const v = slugify(body.name); if (!validVol(v) || v === 'untitled') return send(res, 400, { error: 'bad volume name' });
      mkdirSync(join(postsDir, v), { recursive: true });
      return send(res, 201, { volumes: volumes() });
    }
    const vm = path.match(/^\/api\/volumes\/([a-z0-9-]+)$/);
    if (vm && req.method === 'DELETE') {                              // only an empty volume can be removed
      const dir = join(postsDir, vm[1]);
      if (!validVol(vm[1]) || !existsSync(dir)) return send(res, 404, { error: 'no such volume' });
      if (readdirSync(dir).length) return send(res, 409, { error: 'volume is not empty' });
      rmdirSync(dir); return send(res, 200, { volumes: volumes() });
    }

    if (path === '/api/posts' && req.method === 'POST') {            // create
      const title = clean(body.title) || 'Untitled'; const date = validDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);
      const vol = clean(body.volume); if (!validVol(vol)) return send(res, 400, { error: 'bad volume' });
      if (vol) mkdirSync(join(postsDir, vol), { recursive: true });
      const stem = `${date}-${slugify(title)}`; const mk = n => (vol ? vol + '/' : '') + stem + (n > 1 ? '-' + n : '');
      let n = 1; while (existsSync(fileOf(mk(n)))) n++;
      const id = mk(n); const p = { id, title, date, summary: body.summary, draft: body.draft !== false, body: body.body };
      writeFileSync(fileOf(id), serialize(p)); rebuild();
      return send(res, 201, { post: parse(id, serialize(p)) });
    }
    const m = path.match(/^\/api\/posts\/(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]); const file = fileOf(id);
      if (!validId(id) || !existsSync(file)) return send(res, 404, { error: 'no such entry' });
      if (req.method === 'GET') return send(res, 200, { post: parse(id, readFileSync(file, 'utf8')) });
      if (req.method === 'PUT') {                                     // edit freely (and move between volumes)
        const cur = parse(id, readFileSync(file, 'utf8'));
        const next = { ...cur, title: clean(body.title) || cur.title, summary: body.summary ?? cur.summary, body: body.body ?? cur.body,
          date: validDate(body.date) ? body.date : cur.date, draft: typeof body.draft === 'boolean' ? body.draft : cur.draft };
        let newId = id;
        if (typeof body.volume === 'string' && body.volume !== cur.volume) {
          if (!validVol(body.volume)) return send(res, 400, { error: 'bad volume' });
          if (body.volume) mkdirSync(join(postsDir, body.volume), { recursive: true });
          newId = (body.volume ? body.volume + '/' : '') + id.split('/').pop();
          if (existsSync(fileOf(newId))) return send(res, 409, { error: 'that volume already has this entry' });
        }
        writeFileSync(fileOf(newId), serialize({ ...next, id: newId }));
        if (newId !== id) unlinkSync(file);
        rebuild();
        return send(res, 200, { post: parse(newId, serialize(next)) });
      }
      if (req.method === 'DELETE') { unlinkSync(file); rebuild(); return send(res, 200, { ok: true }); }
    }
    return send(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => handle(req, res).catch(e => {
    if (!res.headersSent) send(res, e.code === 413 || e.code === 400 ? e.code : 500, { error: e.code ? e.message : 'server error' });
    if (!e.code) console.error(e);
  }));
  return { server, handle, config: C, newSession, cookieFor, listPosts, rebuild };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4175);
  const app = createApp();
  if (!existsSync(join(app.config.dataDir, 'auth.json')) && !app.config.setupCode) console.warn('No passkey yet and CODEX_SETUP_CODE is empty: nobody can register one.');
  app.server.listen(port, '127.0.0.1', () => console.log(`codex api on 127.0.0.1:${port} (rp ${app.config.rpID})`));
}
