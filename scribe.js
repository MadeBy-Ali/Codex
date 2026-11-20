// The scribe's tools. Loaded only after sign-in or when the scribe's door is opened, so readers never download it.
// Everything here talks to /api (api/server.mjs). Nothing here can do anything without a valid passkey session.
export async function init(C) {
  const { el, fmt, tail, renderList, sheet, panel, hooks, hud } = C;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'scribe.css?v=1'; document.head.append(link);

  let ME = { authed: false, hasPasskey: false };
  let ALL = [], VOLS = [];
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

  const api = async (method, path, body) => {
    const r = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status });
    return j;
  };
  const norm = p => ({ ...p, slug: (p.volume ? p.volume + '/' : '') + tail(p.id), minutes: Math.max(1, Math.round(p.body.split(/\s+/).filter(Boolean).length / 200)) });
  const load = async () => { const j = await api('GET', '/posts'); ALL = j.posts.map(norm); VOLS = j.volumes; };
  const words = t => t.split(/\s+/).filter(Boolean).length;

  // a small machine-voice notice at the foot of the screen
  let toastEl, toastT;
  const toast = (msg, bad) => {
    toastEl ||= document.body.appendChild(el('div', 'toast')); toastEl.textContent = msg; toastEl.className = 'toast on' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 3200);
  };
  const btn = (label, cls, fn) => { const b = el('button', cls, label); b.type = 'button'; if (fn) b.onclick = fn; return b; };

  /* ---------------- the door ---------------- */
  async function refreshMe() { try { ME = await api('GET', '/me'); } catch { ME = { authed: false, hasPasskey: false, offline: true }; } }

  async function signin() {
    await refreshMe(); C.showPanel();
    if (ME.authed) { await enter(); return scribeList(); }
    sheet.replaceChildren();
    const back = btn('← the codex', 'back', () => C.listView());
    const card = el('div', 'door-card');
    const msg = el('p', 'ed-msg');
    card.append(el('div', 'eyebrow', 'The scribe’s door'), el('h2', null, 'Present your key'), el('div', 'rule'));
    if (ME.offline) {
      card.append(el('p', 'door-note', 'The scribe’s door cannot be reached from here.'));
    } else if (!ME.hasPasskey) {
      const code = el('input', 'ed-field'); code.type = 'password'; code.placeholder = 'Setup code'; code.autocomplete = 'off'; code.autocapitalize = 'off';
      card.append(el('p', 'door-note', 'No key is bound yet. Enter the setup code to bind this device as the scribe’s key.'), code,
        btn('Bind this device', 'pill', () => run(msg, async () => { await bind(code.value); })));
    } else {
      card.append(el('p', 'door-note', 'Only the scribe may inscribe. Use the key bound to this codex.'),
        btn('Present key', 'pill', () => run(msg, async () => {
          const { startAuthentication } = await sw();
          const o = await api('POST', '/login/options', {});
          const response = await startAuthentication({ optionsJSON: o.options });
          await api('POST', '/login/verify', { response });
        })));
    }
    card.append(msg); sheet.append(back, card); panel.scrollTop = 0;

    async function run(m, fn) {
      m.textContent = ''; m.className = 'ed-msg';
      try { await fn(); await refreshMe(); if (!ME.authed) throw new Error('Key refused.'); toast('Key accepted.'); await enter(); scribeList(); }
      catch (e) { m.textContent = e.name === 'NotAllowedError' ? 'Cancelled.' : (e.message || 'Key refused.'); m.className = 'ed-msg bad'; }
    }
  }
  let swP; const sw = () => swP ||= import('https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@13.3.0/+esm');
  async function bind(code) {
    const { startRegistration } = await sw();
    const o = await api('POST', '/register/options', { code });
    const response = await startRegistration({ optionsJSON: o.options });
    await api('POST', '/register/verify', { code, response });
  }

  async function enter() {
    ME.authed = true; document.body.classList.add('scribe');
    const label = hud && hud.querySelector('span'); if (label) label.textContent = 'Codex · scribe';
    hooks.list = scribeList; hooks.read = p => amendBar(p);
    try { await load(); } catch (e) { if (e.status === 401) return leave(true); }
    if (C.isOpen() && !sheet.querySelector('.ed')) scribeList();
  }
  async function leave(silent) {
    if (!silent) try { await api('POST', '/logout', {}); } catch {}
    ME.authed = false; document.body.classList.remove('scribe'); delete hooks.list; delete hooks.read;
    const label = hud && hud.querySelector('span'); if (label) label.textContent = 'Codex';
    if (!silent) toast('Door sealed.'); await C.refreshPublic(); C.listView();
  }

  /* ---------------- the scribe's shelf ---------------- */
  async function scribeList() {
    try { await load(); } catch (e) { if (e.status === 401) return leave(true); toast(e.message, true); }
    const top = el('div', 'scribe-bar');
    const row = el('div', 'volrow'); row.hidden = true;
    const vin = el('input', 'ed-field'); vin.placeholder = 'Name of the new volume'; vin.maxLength = 50;
    const mk = async () => { if (!vin.value.trim()) return; try { await api('POST', '/volumes', { name: vin.value }); toast('Volume founded.'); scribeList(); } catch (e) { toast(e.message, true); } };
    vin.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); mk(); } };
    row.append(vin, btn('Found', 'pill sm', mk));
    top.append(btn('Inscribe', 'pill sm', () => edit(null)),
      btn('New volume', 'pill sm ghost', () => { row.hidden = !row.hidden; if (!row.hidden) vin.focus(); }),
      btn('Bind another device', 'pill sm ghost', async () => { try { await bind(''); toast('Device bound.'); } catch (e) { toast(e.name === 'NotAllowedError' ? 'Cancelled.' : e.message, true); } }),
      btn('Seal the door', 'pill sm ghost', () => leave()));
    top.append(row);
    renderList(ALL, {
      top, volumes: VOLS, noDoor: true,
      onOpen: p => p.draft ? edit(p.id) : C.readView(p.slug, true),
      onRemoveVolume: async v => { try { await api('DELETE', '/volumes/' + v); toast('Volume dissolved.'); scribeList(); } catch (e) { toast(e.message, true); } },
    });
  }

  // an "Amend" button on the reader (sealed folios open here)
  function amendBar(p) {
    const rec = ALL.find(x => x.slug === p.slug); if (!rec) return;
    const bar = el('div', 'amend'); bar.append(btn('Amend this folio', 'pill sm', () => edit(rec.id)));
    sheet.querySelector('.back').after(bar);
  }

  /* ---------------- the writing desk ---------------- */
  async function edit(id) {
    let post;
    if (id) { try { post = norm((await api('GET', '/posts/' + encodeURIComponent(id))).post); } catch (e) { return toast(e.message, true); } }
    else post = { id: null, volume: '', title: '', date: today(), summary: '', draft: true, body: '' };
    const bkKey = 'codex-scribe:' + (id || 'new');
    let recovered = false;
    try { const b = JSON.parse(localStorage.getItem(bkKey) || 'null'); if (b && (b.body !== post.body || b.title !== post.title)) { Object.assign(post, b); recovered = true; } } catch {}

    sheet.replaceChildren();
    const card = el('div', 'ed');
    const back = btn('← folios', 'back', async () => { if (dirty() && !confirmLeave) { confirmLeave = true; setStatus('Unrecorded changes. Press again to leave.', true); return; } cleanup(); scribeList(); });
    let confirmLeave = false;

    const chip = el('span', 'chip'); const paintChip = () => { chip.textContent = post.draft ? 'Unsealed' : 'Sealed'; chip.className = 'chip ' + (post.draft ? 'open' : 'shut'); };
    const head = el('div', 'ed-head'); head.append(el('div', 'eyebrow', id ? 'Amending a folio' : 'Inscribing a folio'), chip);

    const title = el('input', 'ed-title'); title.placeholder = 'Title of the folio'; title.value = post.title; title.maxLength = 140; title.enterKeyHint = 'next';
    const volSel = el('select', 'ed-field'); const date = el('input', 'ed-field'); date.type = 'date'; date.value = post.date;
    const paintVols = () => { volSel.replaceChildren(new Option('Loose folio (no volume)', '')); VOLS.forEach(v => volSel.append(new Option(C.pretty(v), v))); volSel.append(new Option('＋ Found a new volume…', '__new')); volSel.value = post.volume; };
    paintVols();
    const newVol = el('input', 'ed-field'); newVol.placeholder = 'Name of the new volume, then Enter'; newVol.hidden = true; newVol.maxLength = 50;
    volSel.onchange = () => { newVol.hidden = volSel.value !== '__new'; if (!newVol.hidden) newVol.focus(); };
    newVol.onkeydown = async e => { if (e.key !== 'Enter') return; e.preventDefault(); try { const j = await api('POST', '/volumes', { name: newVol.value }); VOLS = j.volumes; post.volume = j.volumes.find(v => v === newVol.value.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) || ''; paintVols(); newVol.hidden = true; newVol.value = ''; } catch (er) { toast(er.message, true); } };
    const meta = el('div', 'ed-meta'); meta.append(label('Volume', volSel), label('Date', date));
    const summary = el('input', 'ed-field'); summary.placeholder = 'One line for the shelf'; summary.value = post.summary; summary.maxLength = 220;

    const body = el('textarea', 'ed-body'); body.value = post.body; body.placeholder = 'Set down your words…'; body.spellcheck = true;
    const preview = el('div', 'prose ed-preview'); preview.hidden = true;
    const grow = () => { body.style.height = 'auto'; body.style.height = Math.max(body.scrollHeight + 4, innerHeight * .5) + 'px'; };

    // toolbar: wraps the selection in Markdown
    const wrap = (a, b, ph) => { const s = body.selectionStart, e = body.selectionEnd, sel = body.value.slice(s, e) || ph; body.setRangeText(a + sel + b, s, e, 'select'); body.setSelectionRange(s + a.length, s + a.length + sel.length); body.focus(); changed(); };
    const prefix = p => { const s = body.selectionStart; const ls = body.value.lastIndexOf('\n', s - 1) + 1; body.setRangeText(p, ls, ls, 'end'); body.focus(); changed(); };
    const tools = el('div', 'tools');
    [['H', 'Heading', () => prefix('## ')], ['B', 'Bold', () => wrap('**', '**', 'bold')], ['I', 'Italic', () => wrap('*', '*', 'italic')], ['❝', 'Quote', () => prefix('> ')], ['•', 'List', () => prefix('- ')],
     ['↗', 'Link', () => { const s = body.selectionStart, e = body.selectionEnd, sel = body.value.slice(s, e) || 'text'; body.setRangeText(`[${sel}](https://)`, s, e, 'end'); body.focus(); changed(); }]]
      .forEach(([t, ttl, fn]) => { const b = btn(t, 'tool', fn); b.title = ttl; b.setAttribute('aria-label', ttl); tools.append(b); });
    const pv = btn('Preview', 'tool wide', async () => {
      if (preview.hidden) { try { preview.innerHTML = (await api('POST', '/preview', { body: body.value })).html; } catch (e) { return toast(e.message, true); } preview.hidden = false; body.hidden = true; pv.textContent = 'Write'; }
      else { preview.hidden = true; body.hidden = false; pv.textContent = 'Preview'; grow(); }
    }); tools.append(pv);

    // actions
    const status = el('span', 'ed-status'); const count = () => words(body.value) + ' words';
    const setStatus = (t, bad) => { status.textContent = t; status.className = 'ed-status' + (bad ? ' bad' : ''); };
    const saveB = btn('Record', 'pill sm ghost', () => save()); const sealB = el('button', 'seal'); sealB.type = 'button'; sealB.onclick = () => save(post.draft, true);   // draft -> publish, sealed -> withdraw
    const sealLabel = () => { sealB.innerHTML = '<span class="ring"></span><span class="lbl">' + (post.draft ? 'Seal' : 'Unseal') + '</span>'; sealB.title = post.draft ? 'Publish this folio' : 'Withdraw this folio from the shelf'; };
    let striking = 0; const strikeB = btn('Strike', 'pill sm danger', async () => {
      if (!striking) { strikeB.textContent = 'Confirm strike'; striking = setTimeout(() => { striking = 0; strikeB.textContent = 'Strike'; }, 4000); return; }
      clearTimeout(striking); try { if (post.id) await api('DELETE', '/posts/' + encodeURIComponent(post.id)); try { localStorage.removeItem(bkKey); } catch {} cleanup(); await C.refreshPublic(); toast('Struck from the record.'); scribeList(); } catch (e) { toast(e.message, true); }
    });
    const bar = el('div', 'ed-bar'); const left = el('div', 'ed-bar-l'); left.append(saveB, strikeB); bar.append(status, left, sealB);

    const strip = el('div', 'strip'); strip.setAttribute('aria-hidden', 'true');
    card.append(strip, head, title, meta, newVol, summary, tools, body, preview, bar);
    if (recovered) card.insertBefore(el('p', 'ed-msg', 'Unrecorded text from your last session was recovered.'), title);
    sheet.append(back, card); panel.scrollTop = 0;
    paintChip(); sealLabel(); grow(); setStatus(count());

    // dirty tracking + local backup
    const snap = () => JSON.stringify([title.value, post.volume, date.value, summary.value, body.value]);
    let saved = recovered ? '' : snap(); const dirty = () => snap() !== saved;
    const changed = () => { confirmLeave = false; grow(); setStatus(count()); try { localStorage.setItem(bkKey, JSON.stringify({ title: title.value, summary: summary.value, body: body.value, date: date.value, volume: post.volume })); } catch {} };
    [title, summary, body, date].forEach(i => i.addEventListener('input', changed));
    volSel.addEventListener('change', () => { if (volSel.value !== '__new') { post.volume = volSel.value; changed(); } });

    async function save(publish, stamp) {   // publish: true = seal, false = unseal, undefined = keep as is
      const payload = { title: title.value.trim() || 'Untitled', volume: post.volume, date: date.value, summary: summary.value, body: body.value, draft: publish === undefined ? post.draft : !publish };
      sealB.disabled = saveB.disabled = true;
      try {
        const j = post.id ? await api('PUT', '/posts/' + encodeURIComponent(post.id), payload) : await api('POST', '/posts', payload);
        post = norm(j.post); saved = snap(); try { localStorage.removeItem(bkKey); localStorage.removeItem('codex-scribe:new'); } catch {}
        paintChip(); sealLabel(); await Promise.all([load(), C.refreshPublic()]);
        setStatus('Recorded ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + count());
        if (stamp) { sealB.classList.remove('press'); void sealB.offsetWidth; sealB.classList.add('press'); toast(post.draft ? 'Folio withdrawn from the shelf.' : 'Seal applied. The folio is public.'); }
        else toast('Inscription recorded.');
      } catch (e) { if (e.status === 401) { toast('The door has closed. Present your key again.', true); return signin(); } setStatus(e.message, true); toast(e.message, true); }
      finally { sealB.disabled = saveB.disabled = false; }
    }

    const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
    const onLeave = e => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('keydown', onKey); addEventListener('beforeunload', onLeave);
    function cleanup() { removeEventListener('keydown', onKey); removeEventListener('beforeunload', onLeave); }
    if (!id) title.focus();

    function label(t, input) { const l = el('label', 'ed-label'); l.append(el('span', null, t), input); return l; }
  }

  return { enter, signin };
}
