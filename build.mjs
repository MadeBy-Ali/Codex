// node build.mjs — turns posts/*.md into posts.json and one static page per post (p/<slug>/index.html)
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { esc, md } from './md.mjs';
// POSTS_DIR = where the .md files live, OUT_DIR = where posts.json and p/ are written (the API sets both)
const POSTS = process.env.POSTS_DIR || 'posts', OUT = process.env.OUT_DIR || '.';
// posts/<entry>.md sit loose; posts/<volume>/<entry>.md belong to a volume (a folder)
const files = [];
for (const name of readdirSync(POSTS).sort()) {
  const full = join(POSTS, name);
  if (name.endsWith('.md')) files.push({ vol: '', f: name });
  else if (statSync(full).isDirectory()) for (const f of readdirSync(full).sort()) if (f.endsWith('.md')) files.push({ vol: name, f });
}
const prettyVol = v => v.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const posts = files.map(({ vol, f }) => {
  const raw = readFileSync(join(POSTS, vol, f), 'utf8'); const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(f + ': missing front matter');
  const meta = Object.fromEntries(m[1].split('\n').map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  if (meta.draft === 'true') return null;
  const name = f.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
  const slug = vol ? vol + '/' + name : name;
  const words = m[2].split(/\s+/).filter(Boolean).length;
  return { slug, volume: vol, volumeName: vol ? prettyVol(vol) : '', title: meta.title, date: meta.date, summary: meta.summary || '', minutes: Math.max(1, Math.round(words / 200)), html: md(m[2]) };
}).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
writeFileSync(join(OUT, 'posts.json'), JSON.stringify(posts));
rmSync(join(OUT, 'p'), { recursive: true, force: true });
const fmt = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
for (const p of posts) {
  mkdirSync(join(OUT, 'p', p.slug), { recursive: true });
  writeFileSync(join(OUT, 'p', p.slug, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} · The Codex</title><meta name="description" content="${esc(p.summary)}">
<meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(p.summary)}"><meta property="og:type" content="article">
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Montserrat:wght@500;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/read.css"></head><body><main class="read"><a class="back" href="/">← back to the codex</a>
<h1>${esc(p.title)}</h1><p class="meta">${fmt(p.date)} · ${p.minutes} min read</p><article>${p.html}</article></main></body></html>`);
}
console.log('built', posts.length, 'post(s)');
