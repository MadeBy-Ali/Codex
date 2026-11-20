// The Markdown renderer, shared by build.mjs (published pages) and the API (editor preview).
export const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const inline = s => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+|\/[^)\s]*|#[^)\s]*)\)/g, '<a href="$2" rel="noopener">$1</a>');
export function md(src) {
  const out = []; let para = [], list = null, quote = [], code = null;
  const flushP = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const flushL = () => { if (list) { out.push(`<${list.t}>` + list.i.map(x => '<li>' + inline(x) + '</li>').join('') + `</${list.t}>`); list = null; } };
  const flushQ = () => { if (quote.length) { out.push('<blockquote><p>' + inline(quote.join(' ')) + '</p></blockquote>'); quote = []; } };
  const flush = () => { flushP(); flushL(); flushQ(); };
  for (const raw of src.split('\n')) {
    if (code) { if (raw.startsWith('```')) { out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); code = null; } else code.push(raw); continue; }
    if (raw.startsWith('```')) { flush(); code = []; continue; }
    const l = raw.trimEnd(); let m;
    if (!l.trim()) { flush(); continue; }
    if ((m = l.match(/^(#{2,3})\s+(.*)/))) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = l.match(/^>\s?(.*)/))) { flushP(); flushL(); quote.push(m[1]); continue; }
    if ((m = l.match(/^[-*]\s+(.*)/))) { flushP(); flushQ(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', i: [] }; } list.i.push(m[1]); continue; }
    if ((m = l.match(/^\d+\.\s+(.*)/))) { flushP(); flushQ(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', i: [] }; } list.i.push(m[1]); continue; }
    flushL(); flushQ(); para.push(l.trim());
  }
  flush(); return out.join('\n');
}
