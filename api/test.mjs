// node test.mjs — runs the API on throwaway folders. Passkey ceremonies need a real authenticator,
// so this mints a session directly and tests everything behind the door.
import { mkdtempSync, mkdirSync, readFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createApp } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'codex-test-'));
const site = join(tmp, 'site'); mkdirSync(site);
const app = createApp({ dataDir: join(tmp, 'data'), siteDir: site, rpID: 'localhost', origin: 'http://localhost:4175', setupCode: 'letmein', secureCookie: false });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + app.server.address().port;
const cookie = 'codex_s=' + app.newSession();
const call = (method, path, body, { auth = true, origin } = {}) => fetch(base + path, {
  method, headers: { 'content-type': 'application/json', ...(auth ? { cookie } : {}), ...(origin ? { origin } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));
const published = () => JSON.parse(readFileSync(join(site, 'posts.json'), 'utf8'));
let n = 0; const ok = (name) => console.log('  ✓', name, ++n);

assert.deepEqual((await call('GET', '/api/me', undefined, { auth: false })).json, { authed: false, hasPasskey: false }); ok('anonymous /me');
assert.equal((await call('GET', '/api/posts', undefined, { auth: false })).status, 401); ok('anonymous cannot list');
assert.equal((await call('POST', '/api/posts', { title: 'x' }, { auth: false })).status, 401); ok('anonymous cannot write');
assert.equal((await call('POST', '/api/register/options', { code: 'wrong' }, { auth: false })).status, 403); ok('wrong setup code refused');
assert.equal((await call('POST', '/api/register/options', { code: 'letmein' }, { auth: false })).status, 200); ok('right setup code gets options');
assert.equal((await call('POST', '/api/posts', { title: 'x' }, { origin: 'https://evil.example' })).status, 403); ok('foreign origin refused');
assert.equal((await fetch(base + '/api/posts', { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: '{}' })).status, 415); ok('non-json refused');

let r = await call('POST', '/api/posts', { title: 'Hello: a "draft"', body: 'First **words**.', summary: 'sum' });
assert.equal(r.status, 201); assert.equal(r.json.post.draft, true); const id1 = r.json.post.id;
assert.equal(published().length, 0); ok('new entry is a draft and not published');

r = await call('PUT', '/api/posts/' + id1, { draft: false });
assert.equal(r.json.post.draft, false); assert.equal(published().length, 1);
assert.ok(existsSync(join(site, 'p', published()[0].slug, 'index.html'))); ok('publishing builds the page');

r = await call('PUT', '/api/posts/' + id1, { title: 'Hello, edited', body: 'Rewritten freely.' });
assert.equal(published()[0].title, 'Hello, edited'); assert.match(published()[0].html, /Rewritten freely/); ok('free editing rebuilds');

r = await call('POST', '/api/volumes', { name: 'On Craft' }); assert.deepEqual(r.json.volumes, ['on-craft']); ok('create a volume');
r = await call('PUT', '/api/posts/' + id1, { volume: 'on-craft' });
assert.equal(r.status, 200); assert.equal(r.json.post.volume, 'on-craft'); const id2 = r.json.post.id;
assert.equal(published()[0].volume, 'on-craft'); assert.equal(published()[0].volumeName, 'On Craft');
assert.ok(existsSync(join(site, 'p', published()[0].slug, 'index.html')) && published()[0].slug === 'on-craft/hello-a-draft'); ok('move into a volume');
assert.equal((await call('DELETE', '/api/volumes/on-craft')).status, 409); ok('non-empty volume cannot be deleted');

r = await call('GET', '/api/posts'); assert.equal(r.json.posts.length, 1); assert.deepEqual(r.json.volumes, ['on-craft']); ok('list shows entries and volumes');
for (const bad of ['..%2F..%2Fetc%2Fpasswd', '%2e%2e%2fauth', 'on-craft%2F..%2F..%2Fauth.json'])
  assert.equal((await call('GET', '/api/posts/' + bad)).status, 404);
ok('path traversal ids are rejected');
assert.equal((await call('POST', '/api/posts', { title: 't', volume: '../x' })).status, 400); ok('bad volume name rejected');

r = await call('POST', '/api/posts', { title: 'Hello, edited', volume: 'on-craft', draft: false });
assert.notEqual(r.json.post.id, id2); ok('duplicate titles get a distinct id');

assert.equal((await call('DELETE', '/api/posts/' + id2)).status, 200);
assert.equal((await call('DELETE', '/api/posts/' + r.json.post.id)).status, 200);
assert.equal(published().length, 0); ok('delete removes entries and pages');
assert.equal((await call('DELETE', '/api/volumes/on-craft')).status, 200); ok('empty volume can be deleted');

await call('POST', '/api/logout'); assert.equal((await call('GET', '/api/posts')).status, 401); ok('logout ends the session');

app.server.close(); rmSync(tmp, { recursive: true, force: true }); console.log('all', n, 'passed');
