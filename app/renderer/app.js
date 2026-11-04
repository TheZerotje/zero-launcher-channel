'use strict';
// Zero Launcher screen. No frameworks, no outside scripts.
let S = null;        // last state from the app
let page = null;
let hubFilter = { q: '', status: 'all' };
let hubData = null;
let weekData = null;
const aiLog = [];    // lines for the AI helper
let aiJob = null;

const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.setAttribute('style', v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const call = async (name, ...args) => {
  try { return await window.zl.call(name, ...args); }
  catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error'); throw e; }
};
function toast(text, kind = 'info') {
  const t = h('div', { class: 'toast ' + kind }, text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 8000 : 4000);
}
const mb = (n) => (n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1) + ' MB';
const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

// ---------------- navigation ----------------
function pages() {
  const p = [['store', 'Store'], ['library', 'Library'], ['arcade', "Zero's Arcade"], ['settings', 'Settings']];
  const dev = S.mode === 'developer' ? [['dev-hub', 'My games'], ['dev-week', 'This week'], ['dev-publish', 'Publish'], ['dev-testers', 'Testers'], ['dev-friends', 'Friend games'], ['dev-ai', 'AI helper'], ['dev-host', 'Website & host']] : [];
  const fr = S.friendHost ? [['friend', 'Send my game']] : [];
  return { p, dev, fr };
}
function renderNav() {
  const { p, dev, fr } = pages();
  const nav = $('#nav'); nav.innerHTML = '';
  const updates = S.games.filter((g) => g.updateReady).length;
  const btn = ([id, label]) => h('button', { class: page === id ? 'on' : '', onclick: () => { page = id; render(); } }, label,
    id === 'library' && updates ? h('span', { class: 'badge' }, updates) : null);
  p.forEach((x) => nav.append(btn(x)));
  if (dev.length) { nav.append(h('div', { class: 'sec' }, 'Developer')); dev.forEach((x) => nav.append(btn(x))); }
  if (fr.length) { nav.append(h('div', { class: 'sec' }, 'Friend host')); fr.forEach((x) => nav.append(btn(x))); }
  $('#modeTag').textContent = { developer: 'Developer', tester: 'Tester', user: 'Player' }[S.mode];
  $('#lastCheck').textContent = S.lastCheck ? 'Checked ' + new Date(S.lastCheck).toLocaleTimeString() : '';
}

// ---------------- game card ----------------
function art(g) {
  const st = g.current && g.current.state !== 'released' ? g.current.state : null;
  const a = h('div', { class: 'art' }, initials(g.name),
    h('span', { class: 'tag ' + (st || g.kind) }, st ? (st === 'testing' ? 'TEST VERSION' : 'UNRELEASED') : (g.kind === 'web' ? 'PLAY NOW' : 'PC GAME')));
  if (g.image && /^https:\/\//.test(g.image)) a.style.backgroundImage = `url("${g.image.replace(/"/g, '')}")`;
  return a;
}
function actions(g) {
  if (g.kind === 'web') return h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => call('play', g.id) }, 'Play'));
  if (g.job) {
    const pct = g.job.total ? Math.round((g.job.done / g.job.total) * 100) : 0;
    const label = { download: `Downloading ${pct}%`, check: 'Checking file…', unpack: 'Installing…', done: 'Done' }[g.job.stage] || '…';
    return h('div', {}, h('div', { class: 'bar' }, h('i', { style: `width:${g.job.stage === 'download' ? pct : 100}%` })),
      h('div', { class: 'row', style: 'margin-top:6px;justify-content:space-between' }, h('span', { class: 'dim' }, label),
        g.job.stage === 'download' ? h('button', { class: 'ghost small', onclick: () => call('pause', g.id) }, 'Pause') : null));
  }
  if (!g.installed) {
    return h('div', { class: 'row' }, h('button', { class: 'btn', disabled: !g.current, onclick: () => call('install', g.id) }, 'Install'),
      g.current && g.current.file ? h('span', { class: 'dim' }, mb(g.current.file.size)) : null);
  }
  return h('div', { class: 'row' },
    g.running ? h('button', { class: 'btn good', disabled: true }, 'Playing…') : h('button', { class: 'btn good', onclick: () => call('play', g.id) }, 'Play'),
    g.updateReady ? h('button', { class: 'btn warn', onclick: () => call('install', g.id) }, 'Update') : null,
    h('button', { class: 'ghost small', disabled: g.running, onclick: () => call('uninstall', g.id) }, 'Uninstall'));
}
function card(g) {
  const ver = g.installed ? `v${g.installed.version}` : g.current ? `v${g.current.version}` : '';
  return h('div', { class: 'card' }, art(g), h('div', { class: 'body' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', {}, g.name), h('span', { class: 'dim' }, ver)),
    h('p', {}, g.description || (g.kind === 'web' ? 'Plays right here, no install.' : '')),
    actions(g)));
}

// ---------------- pages ----------------
const P = {};
P.store = () => {
  const web = S.games.filter((g) => g.kind === 'web'), pc = S.games.filter((g) => g.kind === 'pc');
  return [
    h('h1', {}, 'Store'), h('p', { class: 'sub' }, 'All of Zero\'s games. Website games play right away, PC games install.'),
    h('div', { class: 'hero' }, h('div', {}, h('h2', {}, "Zero's Arcade"), h('div', { class: 'dim' }, 'Every website game, inside the launcher.')),
      h('button', { class: 'btn', onclick: () => call('openArcade') }, 'Open the Arcade')),
    S.error ? h('div', { class: 'err' }, S.error) : null,
    pc.length ? [h('h3', {}, 'PC games'), h('div', { class: 'grid' }, pc.map(card))] : null,
    web.length ? [h('h3', { style: 'margin-top:26px' }, 'Website games'), h('div', { class: 'grid' }, web.map(card))] : null,
    !S.games.length && !S.error ? h('div', { class: 'empty' }, 'No games yet. Check back soon!') : null,
  ];
};
P.library = () => {
  const mine = S.games.filter((g) => g.installed || g.job);
  return [h('h1', {}, 'Library'), h('p', { class: 'sub' }, S.settings.autoUpdate ? 'Updates install by themselves.' : 'Auto update is off. Press Update when you see it.'),
    mine.length ? h('div', { class: 'grid' }, mine.map(card)) : h('div', { class: 'empty' }, 'Nothing installed yet. Go to the Store and press Install.')];
};
P.arcade = () => [h('h1', {}, "Zero's Arcade"), h('p', { class: 'sub' }, 'The website, inside the launcher. It still works in any browser too.'),
  h('button', { class: 'btn', onclick: () => call('openArcade') }, 'Open the Arcade'), h('p', { class: 'dim' }, S.siteUrl)];
P.settings = () => {
  const acc = S.account;
  return [h('h1', {}, 'Settings'), h('p', { class: 'sub' }, ''),
    h('div', { class: 'panel' }, h('h3', {}, 'My account'),
      acc ? [h('p', {}, 'Hi ', h('b', {}, acc.name), '! Your account ID:'), h('div', { class: 'bigid' }, acc.id),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'ghost', onclick: () => call('copy', acc.id).then(() => toast('Copied')) }, 'Copy ID')),
        h('p', { class: 'dim' }, 'Want to test games? Send this ID to Zero.'),
        S.mode === 'tester' ? h('p', {}, h('span', { class: 'pill testing' }, 'TESTER'), ' You get test versions of: ', S.viewer.testerGames.map((id) => (S.games.find((g) => g.id === id) || { name: id }).name).join(', ')) : null]
        : [h('p', { class: 'dim' }, 'No password needed. Your account lives on this PC.'),
          h('div', { class: 'row' }, h('input', { id: 'accName', placeholder: 'Your name', maxlength: 32 }),
            h('button', { class: 'btn', onclick: async () => { await call('makeAccount', $('#accName').value); toast('Account made'); } }, 'Make account'))]),
    h('div', { class: 'panel' }, h('h3', {}, 'Updates'),
      h('label', { style: 'flex-direction:row;align-items:center;gap:10px;color:var(--text)' },
        h('input', { type: 'checkbox', checked: S.settings.autoUpdate, onchange: (e) => call('setSetting', 'autoUpdate', e.target.checked).then(set) }),
        'Update games by themselves (recommended)'))];
};

// ---- developer ----

const STATUS_LIST = [['needs-work', 'Needs work'], ['ready', 'Ready for your OK'], ['testing', 'Needs your playtest'], ['coming-soon', 'Coming soon'], ['building', 'In development'], ['idea', 'Idea'], ['on-hold', 'On hold'], ['released', 'Released'], ['scrapped', 'Scrapped']];
const SRC = { you: 'you set this', pc: 'checked on your PC', notes: 'from project notes' };
const KIND = { web: 'Website', godot: 'Godot', unity: 'Unity', unreal: 'Unreal', pc: 'PC' };
function hubRow(g) {
  const edit = h('div', { class: 'hub-edit', style: 'display:none' },
    h('div', { class: 'form' },
      h('label', {}, 'Status', h('select', { class: 'e-status' }, h('option', { value: '' }, '(automatic)'), STATUS_LIST.filter(([k]) => k !== 'needs-work').map(([k, l]) => h('option', { value: k, selected: g.facts.status && g.facts.status.source === 'you' && g.status === k }, l)))),
      h('label', {}, 'Next step', h('input', { class: 'e-next', value: g.nextStep || '', placeholder: 'example: add sound to menu' }))),
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: async (e) => {
      const box = e.target.closest('.hub-edit');
      hubData = await call('devHubMark', g.id, { status: box.querySelector('.e-status').value, nextStep: box.querySelector('.e-next').value.trim() }); render();
    } }, 'Save')));
  return h('div', { class: 'hub-row' },
    h('div', { class: 'hub-main' },
      h('div', { class: 'row' }, h('b', { class: 'hub-name' }, g.name), h('span', { class: 'kind k-' + g.kind }, KIND[g.kind] || g.kind), g.version ? h('span', { class: 'dim' }, g.version) : null),
      h('div', { class: 'row', style: 'margin-top:4px' },
        h('span', { class: 'pill s-' + g.status }, g.statusLabel), h('span', { class: 'src' }, SRC[g.statusSource] || ''),
        g.changedAgo ? h('span', { class: 'dim' }, '· last worked on ' + g.changedAgo) : null),
      g.nextStep ? h('div', { class: 'next' }, 'Next: ', g.nextStep) : null,
      g.warnings.length ? h('div', { class: 'warn' }, '⚠ ' + g.warnings.join(' · ')) : null,
      g.thread ? h('div', { class: 'dim' }, 'Chat: ' + g.thread) : null,
      edit),
    h('div', { class: 'hub-side' },
      g.folder ? h('button', { class: 'ghost small', title: g.folder, onclick: () => call('devOpenFolder', g.folder) }, 'Open folder') : h('span', { class: 'dim' }, 'no folder'),
      g.folder ? h('span', { class: 'path' }, g.folder) : null,
      h('div', { class: 'row' },
        h('button', { class: 'ghost small', onclick: (e) => { const x = e.target.closest('.hub-row').querySelector('.hub-edit'); x.style.display = x.style.display === 'none' ? 'block' : 'none'; } }, 'Edit'),
        (g.status === 'released' || g.status === 'needs-work') ? h('button', { class: 'ghost small', onclick: async () => {
          hubData = await call('devHubMark', g.id, { needsWork: g.status === 'needs-work' ? '' : 'needs work' }); render();
        } }, g.status === 'needs-work' ? 'Mark fixed' : 'Needs work') : null)));
}
P['dev-hub'] = () => {
  if (!hubData) { call('devHub').then((r) => { hubData = r; render(); }).catch(() => {}); return [h('h1', {}, 'My games'), h('p', { class: 'dim' }, 'Checking your folders…')]; }
  const q = hubFilter.q.toLowerCase();
  const games = hubData.games.filter((g) => (!q || (g.name + ' ' + g.id + ' ' + (g.folder || '') + ' ' + (g.nextStep || '')).toLowerCase().includes(q)) && (hubFilter.status === 'all' || g.status === hubFilter.status));
  const count = (k) => hubData.games.filter((g) => g.status === k).length;
  const chips = h('div', { class: 'row chips' }, h('button', { class: 'chip' + (hubFilter.status === 'all' ? ' on' : ''), onclick: () => { hubFilter.status = 'all'; render(); } }, `All ${hubData.games.length}`),
    STATUS_LIST.filter(([k]) => count(k)).map(([k, l]) => h('button', { class: 'chip s-' + k + (hubFilter.status === k ? ' on' : ''), onclick: () => { hubFilter.status = k; render(); } }, `${l} ${count(k)}`)));
  const folded = new Set(['released', 'scrapped']);
  const groups = STATUS_LIST.map(([k, l]) => [k, l, games.filter((g) => g.status === k)]).filter(([, , list]) => list.length);
  const search = h('input', { id: 'hub-q', placeholder: 'Search a game, folder or next step…', value: hubFilter.q, style: 'width:100%;font-size:16px;padding:12px 14px',
    oninput: (e) => { hubFilter.q = e.target.value; render(); const i = $('#hub-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
  return [h('div', { class: 'row', style: 'justify-content:space-between' }, h('h1', {}, 'My games'),
      h('button', { class: 'ghost', onclick: async () => { hubData = await call('devHub'); render(); toast('Folders checked again'); } }, 'Check again')),
    h('p', { class: 'sub' }, `Checked ${new Date(hubData.scannedAt).toLocaleTimeString()}. Each status says where it comes from. Released games are folded away unless they need work.`),
    hubData.site.error ? h('div', { class: 'err' }, hubData.site.error + ': ' + (hubData.site.folder || '')) : null,
    search, chips,
    groups.map(([k, l, list]) => folded.has(k) && hubFilter.status !== k && !q
      ? h('details', { class: 'hub-group' }, h('summary', {}, `${l} (${list.length})`), list.map(hubRow))
      : h('div', { class: 'hub-group' }, h('h3', {}, `${l} (${list.length})`), list.map(hubRow))),
    !games.length ? h('div', { class: 'empty' }, 'No game matches.') : null];
};

P['dev-week'] = () => {
  if (!weekData) { call('devWeek').then((r) => { weekData = r; render(); }).catch(() => {}); return [h('h1', {}, 'This week'), h('p', { class: 'dim' }, 'Loading…')]; }
  const W = weekData.week;
  const save = async (extra = {}) => { weekData = await call('devWeekSave', weekData.key, { ...W, ...extra }); render(); };
  const list = (items, name) => h('div', { class: 'checklist' }, items.map((it, i) => h('div', { class: 'check' + (it.done ? ' done' : '') },
    h('input', { type: 'checkbox', checked: it.done, onchange: (e) => { it.done = e.target.checked; save(); } }),
    h('span', { class: 'ctext' }, it.text),
    h('button', { class: 'x', title: 'Remove', onclick: () => { items.splice(i, 1); save(); } }, '×'))),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('input', { id: 'add-' + name, placeholder: name === 'goals' ? 'Add a goal…' : 'Add a to-do…', style: 'flex:1',
      onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { items.push({ text: e.target.value.trim(), done: false }); save(); } } }),
      h('button', { class: 'ghost small', onclick: () => { const v = $('#add-' + name).value.trim(); if (v) { items.push({ text: v, done: false }); save(); } } }, 'Add')));
  const all = [...W.goals, ...W.todos]; const done = all.filter((x) => x.done).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;
  return [h('div', { class: 'row', style: 'justify-content:space-between' }, h('h1', {}, 'This week'), h('span', { class: 'dim' }, `Week of Fri ${W.start} · next plan ${new Date(weekData.nextPlan).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`)),
    h('p', { class: 'sub' }, 'Suggested from your games and your focus. Change anything, then press OK.'),
    !W.confirmed ? h('div', { class: 'hero' }, h('div', {}, h('h2', {}, 'New plan ready'), h('div', { class: 'dim' }, 'Look it over. Remove what you don\'t want, add your own.')),
      h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: async () => { weekData = await call('devWeekResuggest', weekData.key); render(); } }, 'Suggest again'),
        h('button', { class: 'btn good', onclick: () => save({ confirmed: true }) }, 'OK, this is my week'))) : null,
    h('div', { class: 'panel' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', { style: 'margin:0' }, `Done ${done} of ${all.length}`), h('b', {}, pct + '%')),
      h('div', { class: 'bar', style: 'margin-top:10px;height:10px' }, h('i', { style: `width:${pct}%;background:var(--good)` }))),
    h('div', { class: 'panel' }, h('h3', {}, 'Goals (max 5)'), list(W.goals, 'goals')),
    h('div', { class: 'panel' }, h('h3', {}, 'To do'), list(W.todos, 'todos')),
    weekData.history.length ? h('div', { class: 'panel' }, h('h3', {}, 'Earlier weeks'), weekData.history.map((x) => h('div', { class: 'row', style: 'justify-content:space-between;padding:4px 0' }, h('span', {}, 'Week of ' + x.key), h('span', { class: 'dim' }, `${x.done} of ${x.total} done`)))) : null];
};
P['dev-publish'] = () => {
  const pc = S.games.filter((g) => g.kind === 'pc');
  const verRow = (g, r) => h('tr', {}, h('td', {}, 'v' + r.version), h('td', {}, h('span', { class: 'pill ' + r.state }, r.state)),
    h('td', { class: 'dim' }, r.notes || ''), h('td', { class: 'dim' }, r.file ? mb(r.file.size) : ''),
    h('td', {}, h('div', { class: 'row' },
      r.state === 'unreleased' ? h('button', { class: 'btn test small', onclick: () => call('devToTesters', g.id, r.version).then(set) }, 'Send to testers') : null,
      r.state === 'unreleased' || r.state === 'testing' ? h('button', { class: 'btn good small', onclick: () => call('devRelease', g.id, r.version).then(set) }, 'Release to everyone') : null,
      r.state === 'testing' ? h('button', { class: 'ghost small', onclick: () => call('devUnrelease', g.id, r.version).then(set) }, 'Back to unreleased') : null)));
  const all = S.games;
  return [h('h1', {}, 'Publish'), h('p', { class: 'sub' }, 'New versions start as Unreleased. Then: Send to testers → Release to everyone → Upload.'),
    h('div', { class: 'panel' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', { style: 'margin:0' }, 'Upload to players'),
      h('button', { class: 'btn', onclick: async () => { const r = await call('devUpload'); toast(`Uploaded ${r.uploaded} new file(s)`); } }, 'Upload now')),
      h('p', { class: 'dim' }, 'Sends the list and new game files to GitHub. Players get it within about 1 hour.')),
    pc.map((g) => h('div', { class: 'panel' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', { style: 'margin:0' }, g.name, g.owner && g.owner !== 'zero' ? h('span', { class: 'dim' }, '  by ' + g.owner) : null),
        h('div', { class: 'row' }, h('button', { class: 'ghost small', onclick: () => call('devGoBack', g.id).then(set) }, 'Go back to previous version'),
          h('button', { class: 'ghost small', onclick: () => call('devHide', g.id, !g.hidden).then(set) }, g.hidden ? 'Show in store' : 'Hide from store'))),
      h('table', {}, h('tr', {}, ['Version', 'State', "What's new", 'Size', ''].map((t) => h('th', {}, t))),
        (g.releases || []).slice().reverse().map((r) => verRow(g, r))),
      h('div', { class: 'form', style: 'margin-top:14px' },
        h('label', {}, 'New version', h('input', { id: 'v-' + g.id, placeholder: 'example 0.20.0' })),
        h('label', {}, "What's new", h('input', { id: 'n-' + g.id, placeholder: 'example: new wagons' }))),
      h('button', { class: 'btn', onclick: async () => {
        const dir = await call('devPickFolder'); if (!dir) return;
        toast('Packing… this can take a minute');
        await call('devAddVersion', { gameId: g.id, buildDir: dir, version: $('#v-' + g.id).value.trim(), notes: $('#n-' + g.id).value.trim() });
        toast('Added as Unreleased'); set(await call('state'));
      } }, 'Pick build folder & add version'))),
    h('div', { class: 'panel' }, h('h3', {}, 'Add a game'),
      h('div', { class: 'form' },
        h('label', {}, 'Game id', h('input', { id: 'ng-id', placeholder: 'railrove' })),
        h('label', {}, 'Name', h('input', { id: 'ng-name', placeholder: 'Railrove' })),
        h('label', {}, 'Type', h('select', { id: 'ng-kind' }, h('option', { value: 'pc' }, 'PC game (Godot / Unity)'), h('option', { value: 'web' }, 'Website game'))),
        h('label', {}, 'Web address (website games)', h('input', { id: 'ng-url', placeholder: 'https://…' })),
        h('label', {}, 'Picture address (optional)', h('input', { id: 'ng-img', placeholder: 'https://…png' })),
        h('label', {}, 'Short text', h('input', { id: 'ng-desc', placeholder: 'Build a train base…' }))),
      h('button', { class: 'btn', onclick: async () => {
        set(await call('devAddGame', { id: $('#ng-id').value.trim(), name: $('#ng-name').value.trim(), kind: $('#ng-kind').value, url: $('#ng-url').value.trim(), image: $('#ng-img').value.trim(), description: $('#ng-desc').value.trim() }));
        toast('Game added');
      } }, 'Add game')),
    h('p', { class: 'dim' }, `${all.length} games in your list.`)];
};
P['dev-testers'] = () => {
  const pc = S.games.filter((g) => g.kind === 'pc');
  const list = S.testers || [];
  const ticks = (prefix, chosen = []) => h('div', { class: 'row' }, pc.map((g) => h('label', { style: 'flex-direction:row;gap:6px;align-items:center;color:var(--text)' },
    h('input', { type: 'checkbox', class: prefix, value: g.id, checked: chosen.includes(g.id) }), g.name)));
  const picked = (cls) => [...document.querySelectorAll('input.' + cls + ':checked')].map((i) => i.value);
  return [h('h1', {}, 'Testers'), h('p', { class: 'sub' }, 'Your friend makes an account in Settings and sends you the ID. Tick which games he may test. Then press Upload on Publish.'),
    h('div', { class: 'panel' }, h('h3', {}, 'Add a tester'),
      h('div', { class: 'form' }, h('label', {}, 'Account ID', h('input', { id: 't-id', placeholder: 'SAM-4F2A-9C1B' })), h('label', {}, 'Name', h('input', { id: 't-name', placeholder: 'Sam' }))),
      ticks('t-new'), h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: async () => {
        set(await call('devSetTester', { accountId: $('#t-id').value, name: $('#t-name').value, games: picked('t-new') })); toast('Tester saved');
      } }, 'Save tester'))),
    list.length ? list.map((t, i) => h('div', { class: 'panel' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', { style: 'margin:0' }, t.name, h('span', { class: 'dim' }, '  ' + t.accountId)),
      h('button', { class: 'btn bad small', onclick: () => call('devRemoveTester', t.accountId).then(set) }, 'Remove')),
      h('div', { style: 'margin-top:10px' }, ticks('t-' + i, t.games)),
      h('button', { class: 'ghost small', style: 'margin-top:10px', onclick: () => call('devSetTester', { accountId: t.accountId, name: t.name, games: picked('t-' + i) }).then(set) }, 'Save games')))
      : h('div', { class: 'empty' }, 'No testers yet.')];
};
P['dev-friends'] = () => {
  const box = h('div', {}, h('p', { class: 'dim' }, 'Loading…'));
  call('devFriends').then(({ friends, waiting }) => {
    box.innerHTML = '';
    box.append(
      h('div', { class: 'panel' }, h('h3', {}, 'Waiting for you'),
        h('button', { class: 'ghost', onclick: async () => { const f = await call('devPickFile'); if (!f) return; await call('devImportSubmission', f); toast('Added to the waiting list'); render(); } }, 'Open a friend\'s .zlsub file'),
        waiting.length ? h('table', { style: 'margin-top:12px' }, h('tr', {}, ['Friend', 'Game', 'Version', "What's new", ''].map((t) => h('th', {}, t))),
          waiting.map((w) => h('tr', {}, h('td', {}, (friends[w.friendId] || {}).name || w.friendId), h('td', {}, w.gameName || w.gameId), h('td', {}, 'v' + w.version), h('td', { class: 'dim' }, w.notes || ''),
            h('td', {}, h('div', { class: 'row' }, h('button', { class: 'btn good small', onclick: async () => { await call('devApprove', w.id); toast('Approved. It is now Unreleased in Publish.'); render(); } }, 'Approve'),
              h('button', { class: 'ghost small', onclick: async () => { await call('devReject', w.id); render(); } }, 'Reject'))))))
          : h('p', { class: 'dim' }, 'Nothing waiting.')),
      h('div', { class: 'panel' }, h('h3', {}, 'Friends who can send games'),
        Object.entries(friends).map(([id, f]) => h('div', { class: 'row', style: 'justify-content:space-between;padding:6px 0' },
          h('span', {}, h('b', {}, f.name), h('span', { class: 'dim' }, `  ${id} · games: ${f.games.join(', ')}`), f.blocked ? h('span', { class: 'pill pulled', style: 'margin-left:8px' }, 'blocked') : null),
          h('button', { class: 'ghost small', onclick: async () => { await call('devBlockFriend', id, !f.blocked); render(); } }, f.blocked ? 'Unblock' : 'Block'))),
        h('div', { class: 'form', style: 'margin-top:12px' }, h('label', {}, 'Friend id', h('input', { id: 'f-id', placeholder: 'sam' })), h('label', {}, 'Name', h('input', { id: 'f-name', placeholder: 'Sam' })),
          h('label', {}, 'His game id(s), comma between', h('input', { id: 'f-games', placeholder: 'sams-game' }))),
        h('label', {}, 'His public key (he sends it to you)', h('textarea', { id: 'f-key', placeholder: '-----BEGIN PUBLIC KEY-----' })),
        h('button', { class: 'btn', style: 'margin-top:10px', onclick: async () => {
          await call('devAddFriend', { friendId: $('#f-id').value.trim(), name: $('#f-name').value.trim(), publicKeyPem: $('#f-key').value.trim(), games: $('#f-games').value.split(',').map((s) => s.trim()).filter(Boolean) });
          toast('Friend added'); render();
        } }, 'Add friend')));
  }).catch(() => {});
  return [h('h1', {}, 'Friend games'), h('p', { class: 'sub' }, 'Nothing from a friend reaches players until you press Approve, and then Release.'), box];
};
P['dev-ai'] = () => {
  const sel = h('select', { id: 'ai-folder' });
  call('devAiFolders').then((fs) => { fs.forEach((f) => sel.append(h('option', { value: f.path }, `${f.name}  (${f.path})`))); if (!fs.length) sel.append(h('option', { value: '' }, 'Add folders to aiFolders in developer.json')); });
  const log = h('div', { class: 'log', id: 'ai-log' }, aiLog.join('\n'));
  const go = async () => {
    const text = $('#ai-text').value.trim(); if (!text) return;
    aiLog.push(`\n> ${text}`);
    aiJob = await call('devAiStart', text, sel.value);
    aiLog.push(`(${aiJob.tool} is working…)`); render();
  };
  return [h('h1', {}, 'AI helper'), h('p', { class: 'sub' }, 'Type "claude, …" or "codex, …" or "chatgpt, …". It runs on this PC with your own account. No sound, no releases.'),
    h('div', { class: 'panel' }, h('label', {}, 'Folder', sel),
      h('textarea', { id: 'ai-text', style: 'margin-top:10px', placeholder: 'claude, add a night mode to the menu', onkeydown: (e) => { if (e.key === 'Enter' && e.ctrlKey) go(); } }),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: go }, 'Go'),
        aiJob ? h('button', { class: 'btn bad', onclick: () => call('devAiStop', aiJob.id) }, 'Stop') : null,
        h('button', { class: 'ghost', onclick: () => call('devChatGPT') }, 'Open ChatGPT window'),
        h('span', { class: 'dim' }, 'Ctrl+Enter = Go'))),
    log];
};
P['dev-host'] = () => {
  const st = h('div', {}, h('p', { class: 'dim' }, 'Checking…'));
  Promise.all([call('devWebsite'), call('devAutoStart')]).then(([w, auto]) => {
    st.innerHTML = '';
    st.append(h('div', { class: 'panel' }, h('h3', {}, h('span', { class: 'dot ' + (w.up ? 'on' : 'off') }), w.up ? 'Website is running' : 'Website is OFF'),
      h('p', { class: 'dim' }, w.url),
      !w.up ? h('p', {}, 'Start it the way you always do. The launcher only shows if it is up.') : null,
      h('p', { class: 'dim' }, 'The launcher never starts, stops or restarts your website.'),
      h('button', { class: 'ghost small', onclick: () => render() }, 'Check again')),
      h('div', { class: 'panel' }, h('h3', {}, 'Start with Windows'),
        h('label', { style: 'flex-direction:row;align-items:center;gap:10px;color:var(--text)' },
          h('input', { type: 'checkbox', checked: auto, onchange: (e) => call('devAutoStart', e.target.checked).then(() => toast(e.target.checked ? 'Will start with Windows' : 'Will not start with Windows')) }),
          'Start the launcher when my PC starts')));
  }).catch(() => {});
  return [h('h1', {}, 'Website & host'), h('p', { class: 'sub' }, ''), st];
};
P.friend = () => [h('h1', {}, 'Send my game to Zero'), h('p', { class: 'sub' }, 'Step 1: send Zero your public key (once). Step 2: make a game file and send it to Zero. He approves it.'),
  h('div', { class: 'panel' }, h('h3', {}, '1. My public key'), h('button', { class: 'ghost', onclick: async () => { const k = await call('friendMakeKeys'); await call('copy', k); toast('Public key copied. Send it to Zero.'); } }, 'Copy my public key')),
  h('div', { class: 'panel' }, h('h3', {}, '2. Make a game file'),
    h('div', { class: 'form' }, h('label', {}, 'Game id', h('input', { id: 's-id', placeholder: 'sams-game' })), h('label', {}, 'Game name', h('input', { id: 's-name' })),
      h('label', {}, 'Version', h('input', { id: 's-ver', placeholder: '0.1.0' })), h('label', {}, "What's new", h('input', { id: 's-notes' }))),
    h('button', { class: 'btn', onclick: async () => {
      const dir = await call('devPickFolder').catch(() => null);
      if (!dir) return;
      await call('friendSubmit', { gameId: $('#s-id').value.trim(), gameName: $('#s-name').value.trim(), version: $('#s-ver').value.trim(), notes: $('#s-notes').value.trim(), buildDir: dir });
      toast('Game file made. Send the .zlsub file to Zero.');
    } }, 'Pick build folder & make file'))];

// ---------------- render ----------------
function render() {
  if (!S) return;
  const { p, dev, fr } = pages();
  if (!page) page = S.mode === 'developer' ? 'dev-hub' : 'store';
  if (![...p, ...dev, ...fr].some(([id]) => id === page)) page = 'store';
  renderNav();
  const keepScroll = $('#main').scrollTop;
  const m = $('#main'); m.innerHTML = '';
  m.append(...[P[page]()].flat(3).filter(Boolean));
  m.scrollTop = keepScroll;
  const log = $('#ai-log'); if (log) log.scrollTop = log.scrollHeight;
}
function set(s) { if (s && s.games) { S = s; render(); } }

window.zl.on('state', (s) => { const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName); S = s; if (typing) renderNav(); else render(); });
window.zl.on('toast', (t) => toast(t.text, t.kind));
window.zl.on('ai', (m) => {
  if (m.line) aiLog.push(m.line);
  if (m.end !== undefined) { aiLog.push(`(finished, code ${m.end})`); aiJob = null; }
  const log = $('#ai-log');
  if (log) { log.textContent = aiLog.join('\n'); log.scrollTop = log.scrollHeight; }
  if (m.end !== undefined && page === 'dev-ai') render();
});
$('#refreshBtn').addEventListener('click', async () => { set(await call('refresh')); toast('Checked for updates'); });
call('state').then(set);
