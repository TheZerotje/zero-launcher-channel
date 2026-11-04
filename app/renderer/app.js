'use strict';
// Zero Launcher screen. No frameworks, no outside scripts.
// All player text goes through t() so it can be shown in Dutch too (see strings.js).
let S = null;        // last state from the app
let page = null;
let gameId = null;   // open game page
let storeFilter = { q: '', kind: 'all' };
let showOldNews = false;
let libFilter = { q: '', sort: 'played' };
let weekData = null;
const aiLog = [];    // lines for the AI helper
let aiJob = null;
let godotList = null;   // Godot projects the launcher can export (developer)
let upload = null;      // { text, done, total } while uploading
const godotLog = {};    // gameId -> last lines of the Godot export
let aiHistory = null;
let dlData = null;      // download numbers (developer)

// Simple pop-up box. buttons: [[label, cls, fn]]; fn returning false keeps it open.
function modal(title, body, buttons) {
  closeModal();
  const box = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === box) closeModal(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': title }, h('h2', {}, title), body,
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' }, buttons.map(([label, cls, fn]) =>
        h('button', { class: cls, onclick: async () => { try { if ((await fn()) !== false) closeModal(); } catch {} } }, label)))));
  document.body.append(box);
  const first = box.querySelector('input, textarea, button'); if (first) first.focus();
}
function closeModal() { document.querySelector('.modal-back')?.remove(); }

const $ = (s) => document.querySelector(s);
const t = (text, vars) => window.ZLStrings.t(S && S.settings ? S.settings.lang : 'en', text, vars);
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
const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const call = async (name, ...args) => {
  try { return await window.zl.call(name, ...args); }
  catch (e) { toast(t(cleanErr(e)), 'error'); throw e; }
};
function toast(text, kind = 'info') {
  const el = h('div', { class: 'toast ' + kind, role: 'status' }, text);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 8000 : 4000);
}
const mb = (n) => (n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1) + ' MB';
const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const onOff = (checked, onchange, label) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked, onchange }), label);

// ---------------- look: text size, easy font, language ----------------
const ZOOM = { normal: 1, big: 1.15, bigger: 1.3 };
function applyLook() {
  const s = S.settings || {};
  document.documentElement.style.zoom = ZOOM[s.textSize] || 1;
  document.body.classList.toggle('easyfont', !!s.easyFont);
  document.documentElement.lang = s.lang === 'nl' ? 'nl' : 'en';
  $('#refreshBtn').textContent = t('Check for updates');
}

// ---------------- navigation ----------------
function pages() {
  const p = [['store', t('Store')], ['library', t('Library')], ['arcade', t("Zero's Arcade")], ['settings', t('Settings')], ['help', t('Help')]];
  const dev = S.mode === 'developer' ? [['dev-hub', 'My projects'], ['dev-week', 'This week'], ['dev-publish', 'Publish'], ['dev-testers', 'Testers'], ['dev-friends', 'Friend games'], ['dev-ai', 'AI helper'], ['dev-host', 'Website & host']] : [];
  const fr = S.friendHost ? [['friend', 'Send my game']] : [];
  return { p, dev, fr };
}
function go(id) { page = id; gameId = null; render(); }
function renderNav() {
  const { p, dev, fr } = pages();
  const nav = $('#nav'); nav.innerHTML = '';
  const updates = S.games.filter((g) => g.updateReady).length;
  const btn = ([id, label]) => h('button', { class: page === id && !gameId ? 'on' : '', onclick: () => go(id) }, label,
    id === 'library' && updates ? h('span', { class: 'badge' }, updates) : null);
  p.forEach((x) => nav.append(btn(x)));
  if (dev.length) { nav.append(h('div', { class: 'sec' }, 'Developer')); dev.forEach((x) => nav.append(btn(x))); }
  if (fr.length) { nav.append(h('div', { class: 'sec' }, 'Friend host')); fr.forEach((x) => nav.append(btn(x))); }
  $('#modeTag').textContent = { developer: 'Developer', tester: t('Tester'), user: t('Player') }[S.mode];
  $('#lastCheck').textContent = S.lastCheck ? t('Checked {time}', { time: new Date(S.lastCheck).toLocaleTimeString() }) : '';
}

// ---------------- game card ----------------
function art(g) {
  const st = g.current && g.current.state !== 'released' ? g.current.state : null;
  const a = h('div', { class: 'art' }, initials(g.name),
    h('span', { class: 'tag ' + (st || g.kind) }, st ? (st === 'testing' ? t('TEST VERSION') : 'UNRELEASED') : (g.kind === 'web' ? t('PLAY NOW') : t('PC GAME'))));
  if (g.image && /^https:\/\//.test(g.image)) a.style.backgroundImage = `url("${g.image.replace(/["\\()]/g, '')}")`;
  return a;
}
function jobLine(g) {
  const j = g.job;
  const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
  const label = {
    waiting: t('Waiting…'), paused: t('Paused at {pct}%', { pct }), download: t('Downloading {pct}%', { pct }),
    check: t('Checking file…'), unpack: t('Installing…'), done: t('Done'),
  }[j.stage] || '…';
  const width = j.stage === 'download' || j.stage === 'paused' ? pct : j.stage === 'waiting' ? 0 : 100;
  return h('div', { class: 'job' }, h('div', { class: 'bar' }, h('i', { style: `width:${width}%` })),
    h('div', { class: 'row', style: 'margin-top:6px;justify-content:space-between' }, h('span', { class: 'dim' }, label),
      h('div', { class: 'row' },
        j.stage === 'download' ? h('button', { class: 'ghost small', onclick: () => call('pause', g.id) }, t('Pause')) : null,
        j.stage === 'paused' ? h('button', { class: 'btn small', onclick: () => call('resume', g.id) }, t('Resume')) : null,
        ['download', 'waiting', 'paused'].includes(j.stage) ? h('button', { class: 'ghost small', onclick: () => call('cancel', g.id) }, t('Cancel')) : null)));
}
const DAY = 86400000;
const isComingSoon = (g) => !!g.comingSoon && !g.current && g.kind === 'pc';
function countdown(date) {
  const ms = Date.parse(date) - Date.now();
  if (ms <= 0) return t('Any moment now');
  const d = Math.floor(ms / DAY), hrs = Math.floor((ms % DAY) / 3600000);
  if (d === 0) return t('In {h} hours', { h: Math.max(1, hrs) });
  if (d === 1) return t('Tomorrow');
  return t('In {d} days', { d });
}
function actions(g) {
  if (isComingSoon(g)) return h('div', { class: 'row' }, h('button', { class: 'btn big', disabled: true }, t('Coming soon')), h('span', { class: 'countdown' }, countdown(g.comingSoon)));
  if (g.kind === 'web') return h('div', { class: 'row' }, h('button', { class: 'btn big', onclick: () => call('play', g.id) }, t('Play')));
  if (g.job) return jobLine(g);
  if (!g.installed) {
    return h('div', { class: 'row' }, h('button', { class: 'btn big', disabled: !g.current, onclick: () => call('install', g.id) }, t('Install')),
      g.current && g.current.file ? h('span', { class: 'dim' }, mb(g.current.file.size)) : null);
  }
  return h('div', { class: 'row' },
    g.running ? h('button', { class: 'btn good big', disabled: true }, t('Playing…')) : h('button', { class: 'btn good big', onclick: () => call('play', g.id) }, t('Play')),
    g.updateReady ? h('button', { class: 'btn warn', onclick: () => call('install', g.id) }, t('Update')) : null);
}
function card(g) {
  const ver = g.installed ? `v${g.installed.version}` : g.current ? `v${g.current.version}` : '';
  const open = () => { gameId = g.id; render(); };
  return h('div', { class: 'card' }, h('div', { class: 'clickable', title: t('More about this game'), onclick: open }, art(g)), h('div', { class: 'body' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', { class: 'clickable', onclick: open }, g.name), h('span', { class: 'dim' }, ver)),
    h('p', {}, g.description || (g.kind === 'web' ? t('Plays right here, no install.') : '')),
    actions(g)));
}
const matches = (g, q) => !q || (g.name + ' ' + (g.description || '')).toLowerCase().includes(q.toLowerCase());
function searchBox(id, value, placeholder, onchange) {
  return h('input', { id, type: 'search', class: 'search', value, placeholder, 'aria-label': placeholder,
    oninput: (e) => { onchange(e.target.value); render(); const i = $('#' + id); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
}

// ---------------- news ----------------
const safeImg = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);
function newsCard(n, big) {
  return h('div', { class: 'news' + (big ? ' big' : '') },
    safeImg(n.image) ? h('img', { src: safeImg(n.image), alt: '', loading: 'lazy' }) : null,
    h('div', { class: 'news-body' }, h('div', { class: 'dim' }, new Date(n.date).toLocaleDateString()), h('h3', {}, n.title), n.text ? h('p', {}, n.text) : null));
}
function newsBlock() {
  const list = S.news || [];
  if (!list.length) return null;
  return h('div', { class: 'news-wrap' },
    h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:8px' }, h('h3', { style: 'margin:0' }, t('News')),
      list.length > 1 ? h('button', { class: 'ghost small', onclick: () => { showOldNews = !showOldNews; render(); } }, showOldNews ? t('Hide older news') : t('Older news')) : null),
    newsCard(list[0], true),
    showOldNews ? list.slice(1).map((n) => newsCard(n, false)) : null);
}

// ---------------- tester feedback + crash reports ----------------
function feedbackBox(g) {
  let vote = null;
  const pick = (v) => (e) => { vote = v; e.target.closest('.feedback').querySelectorAll('.vote').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); };
  return h('div', { class: 'panel feedback' }, h('h3', {}, t('Quick feedback on this test version')),
    h('div', { class: 'row' },
      h('button', { class: 'vote', 'data-v': 'up', 'aria-label': t('Good'), onclick: pick('up') }, '👍'),
      h('button', { class: 'vote', 'data-v': 'down', 'aria-label': t('Not good'), onclick: pick('down') }, '👎')),
    h('textarea', { id: 'fb-text', maxlength: 2000, placeholder: t('Anything else? (you can leave this empty)'), style: 'margin-top:10px' }),
    h('button', { class: 'btn', style: 'margin-top:10px', onclick: async () => {
      if (!vote) return toast(t('Press 👍 or 👎 first.'), 'error');
      const r = await call('feedback', g.id, vote, $('#fb-text').value.trim());
      await call('copy', r.text);
      toast(t('Thank you! Feedback saved and copied. Send it to Zero.'));
      $('#fb-text').value = '';
    } }, t('Send feedback')));
}
let crashText = {}; // gameId -> preview text
function crashBanner() {
  const list = (S.crashes || []);
  if (!list.length) return null;
  return list.map((c) => {
    const g = S.games.find((x) => x.id === c.gameId) || { name: c.gameId };
    return h('div', { class: 'panel crash' }, h('h3', {}, t('{name} closed with an error', { name: g.name })),
      h('p', {}, t('Do you want to make a crash report for Zero? You can see everything in it first.')),
      crashText[c.gameId] ? h('pre', { class: 'log small crash-text' }, crashText[c.gameId]) : null,
      h('div', { class: 'row' },
        !crashText[c.gameId] ? h('button', { class: 'btn', onclick: async () => { crashText[c.gameId] = await call('crashPreview', c.gameId); render(); } }, t('Show crash report'))
          : h('button', { class: 'btn', onclick: async () => { const r = await call('crashSend', c.gameId); await call('copy', r.text); delete crashText[c.gameId]; toast(t('Crash report saved and copied. Send it to Zero.')); } }, t('Save and copy report')),
        h('button', { class: 'ghost', onclick: async () => { delete crashText[c.gameId]; set(await call('crashDismiss', c.gameId)); } }, t('No thanks'))));
  });
}

// ---------------- picture gallery ----------------
let bigPic = null; // { gameId, i }
function gallery(g) {
  const pics = (g.screenshots || []).map(safeImg).filter(Boolean);
  if (!pics.length) return null;
  return h('div', { class: 'gallery' }, pics.map((u, i) => h('img', { src: u, alt: t('Picture {n}', { n: i + 1 }), loading: 'lazy', tabindex: 0,
    onclick: () => openPic(g.id, i), onkeydown: (e) => { if (e.key === 'Enter') openPic(g.id, i); } })));
}
function openPic(id, i) { bigPic = { gameId: id, i }; showPic(); }
function showPic() {
  document.querySelector('.lightbox')?.remove();
  if (!bigPic) return;
  const g = S.games.find((x) => x.id === bigPic.gameId);
  const pics = ((g && g.screenshots) || []).map(safeImg).filter(Boolean);
  if (!pics.length) { bigPic = null; return; }
  bigPic.i = (bigPic.i + pics.length) % pics.length;
  const step = (d) => { bigPic.i += d; showPic(); };
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': t('Big picture'), onclick: (e) => { if (e.target === box) { bigPic = null; showPic(); } } },
    h('button', { class: 'lb-btn lb-prev', 'aria-label': t('Previous picture'), onclick: () => step(-1) }, '‹'),
    h('img', { src: pics[bigPic.i], alt: '' }),
    h('button', { class: 'lb-btn lb-next', 'aria-label': t('Next picture'), onclick: () => step(1) }, '›'),
    h('button', { class: 'lb-btn lb-close', 'aria-label': t('Close'), onclick: () => { bigPic = null; showPic(); } }, '×'),
    h('div', { class: 'lb-count' }, `${bigPic.i + 1} / ${pics.length}`));
  document.body.append(box);
}
document.addEventListener('keydown', (e) => {
  if (!bigPic) return;
  if (e.key === 'ArrowRight') { bigPic.i++; showPic(); }
  else if (e.key === 'ArrowLeft') { bigPic.i--; showPic(); }
  else if (e.key === 'Escape') { bigPic = null; showPic(); }
});

// ---------------- pages ----------------
const P = {};
P.store = () => {
  const G = S.games.filter((g) => !g.scrapped); // scrapped in My projects: hidden from the Store (developer)
  const kinds = [['all', t('All')], ['pc', t('PC games')], ['web', t('Play instantly')], ['installed', t('Installed')]];
  const list = G.filter((g) => matches(g, storeFilter.q) && (storeFilter.kind === 'all'
    || (storeFilter.kind === 'installed' ? !!g.installed : g.kind === storeFilter.kind)));
  const web = list.filter((g) => g.kind === 'web'), pc = list.filter((g) => g.kind === 'pc');
  const now = Date.now();
  const recent = (iso, days) => iso && now - Date.parse(iso) < days * DAY;
  const browsing = !storeFilter.q && storeFilter.kind === 'all';
  const fresh = browsing ? G.filter((g) => recent(g.addedAt, 30) && !isComingSoon(g)) : [];
  const updated = browsing ? G.filter((g) => !fresh.includes(g) && g.kind === 'pc' && recent(g.updatedAt, 14)) : [];
  const soon = browsing ? G.filter(isComingSoon).sort((a, b) => a.comingSoon.localeCompare(b.comingSoon)) : [];
  const section = (title, games, cls) => (games.length ? [h('h3', { class: 'section ' + cls }, title), h('div', { class: 'grid' }, games.map(card))] : null);
  return [
    h('h1', {}, t('Store')), h('p', { class: 'sub' }, t("All of Zero's games. Website games play right away, PC games install.")),
    h('div', { class: 'hero' }, h('div', {}, h('h2', {}, t("Zero's Arcade")), h('div', { class: 'dim' }, t('Every website game, inside the launcher.'))),
      h('button', { class: 'btn', onclick: () => call('openArcade') }, t('Open the Arcade'))),
    S.error ? h('div', { class: 'err' }, t(S.error)) : null,
    S.offline ? h('div', { class: 'note offline' }, t('Offline – showing your games from last time')) : null,
    newsBlock(),
    h('div', { class: 'row tools' }, searchBox('store-q', storeFilter.q, t('Find a game…'), (v) => { storeFilter.q = v; }),
      h('div', { class: 'row chips' }, kinds.map(([k, l]) => h('button', { class: 'chip' + (storeFilter.kind === k ? ' on' : ''), onclick: () => { storeFilter.kind = k; render(); } }, l)))),
    section(t('New'), fresh, 's-new'),
    section(t('Recently updated'), updated, 's-updated'),
    section(t('Coming soon'), soon, 's-soon'),
    browsing && (fresh.length || updated.length || soon.length) ? h('h2', { class: 'all-games' }, t('All games')) : null,
    pc.filter((g) => !isComingSoon(g)).length ? [h('h3', {}, t('PC games')), h('div', { class: 'grid' }, pc.filter((g) => !isComingSoon(g)).map(card))] : null,
    web.length ? [h('h3', { style: 'margin-top:26px' }, t('Website games')), h('div', { class: 'grid' }, web.map(card))] : null,
    !G.length && !S.error ? h('div', { class: 'empty' }, t('No games yet. Check back soon!')) : null,
    G.length && !list.length ? h('div', { class: 'empty' }, t('No game found. Try another word.')) : null,
  ];
};
P.library = () => {
  let mine = S.games.filter((g) => (g.installed || g.job) && matches(g, libFilter.q));
  mine = mine.slice().sort(libFilter.sort === 'name' ? (a, b) => a.name.localeCompare(b.name)
    : (a, b) => ((b.installed && b.installed.lastPlayed) || '').localeCompare((a.installed && a.installed.lastPlayed) || '') || a.name.localeCompare(b.name));
  const any = S.games.some((g) => g.installed || g.job);
  return [h('h1', {}, t('Library')), h('p', { class: 'sub' }, S.settings.autoUpdate ? t('Updates install by themselves.') : t('Auto update is off. Press Update when you see it.')),
    S.offline ? h('div', { class: 'note offline' }, t('Offline – showing your games from last time')) : S.error ? h('div', { class: 'err' }, t(S.error)) : null,
    any ? h('div', { class: 'row tools' }, searchBox('lib-q', libFilter.q, t('Find a game…'), (v) => { libFilter.q = v; }),
      h('label', { class: 'inline' }, t('Sort'), h('select', { id: 'lib-sort', onchange: (e) => { libFilter.sort = e.target.value; render(); } },
        h('option', { value: 'played', selected: libFilter.sort === 'played' }, t('Last played')), h('option', { value: 'name', selected: libFilter.sort === 'name' }, t('Name (A to Z)'))))) : null,
    mine.length ? h('div', { class: 'grid' }, mine.map(card)) : h('div', { class: 'empty' }, any ? t('No game found. Try another word.') : t('Nothing installed yet. Go to the Store and press Install.'))];
};
P.arcade = () => [h('h1', {}, t("Zero's Arcade")), h('p', { class: 'sub' }, t('The website, inside the launcher. It still works in any browser too.')),
  h('button', { class: 'btn big', onclick: () => call('openArcade') }, t('Open the Arcade')), h('p', { class: 'dim' }, S.siteUrl)];
P.game = () => {
  const g = S.games.find((x) => x.id === gameId);
  if (!g) { gameId = null; return P[page](); }
  const rel = g.current;
  const box = h('div', { class: 'panel report' }, h('h3', {}, t('Report a problem')),
    h('p', { class: 'dim' }, t('Tell Zero what went wrong. The launcher makes a small file. Send it to Zero (for example on Discord).')),
    h('textarea', { id: 'rep-text', maxlength: 2000, placeholder: t('What happened? What did you do just before?') }),
    h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: async () => {
      const text = $('#rep-text').value.trim();
      if (!text) return toast(t('Type what went wrong first.'), 'error');
      const r = await call('report', g.id, text);
      await call('copy', r.text);
      toast(t('Report saved and copied. Send it to Zero.'));
      $('#rep-text').value = '';
    } }, t('Make report'))));
  return [
    h('button', { class: 'ghost small back', onclick: () => { gameId = null; render(); } }, '← ' + t('Back')),
    h('div', { class: 'game-top' }, art(g), h('div', { class: 'game-info' },
      h('h1', {}, g.name), h('p', { class: 'sub' }, g.description || ''),
      rel ? h('p', { class: 'dim' }, t('Version {v}', { v: rel.version })) : null,
      actions(g))),
    rel && rel.state === 'testing' && rel.testNotes ? h('div', { class: 'panel testbox' }, h('h3', {}, t('What to test')), h('p', {}, rel.testNotes)) : null,
    rel && rel.state === 'testing' ? feedbackBox(g) : null,
    gallery(g),
    rel && rel.notes ? h('div', { class: 'panel' }, h('h3', {}, t("What's new")), h('p', {}, rel.notes)) : null,
    h('div', { class: 'row extras' },
      g.hasTrailer ? h('button', { class: 'ghost', onclick: () => call('openTrailer', g.id) }, '▶ ' + t('Watch trailer')) : null,
      g.kind === 'pc' && g.installed ? h('button', { class: 'ghost', onclick: () => call('makeShortcut', g.id).then(() => toast(t('Shortcut made on your desktop'))) }, t('Make desktop shortcut')) : null),
    g.kind === 'pc' && g.installed ? h('details', { class: 'panel launch' }, h('summary', {}, t('Launch options')),
      h('p', { class: 'dim' }, t('Extra start words for this game. Only change this if Zero tells you to.')),
      h('div', { class: 'row' }, h('input', { id: 'launch-args', value: g.installed.launchArgs || '', maxlength: 300, placeholder: '--fullscreen', style: 'flex:1' }),
        h('button', { class: 'btn small', onclick: async () => { await call('setLaunchArgs', g.id, $('#launch-args').value); toast(t('Saved')); } }, t('Save')))) : null,
    g.kind === 'pc' && g.installed ? h('div', { class: 'panel' }, h('h3', {}, t('Fix the game')),
      h('p', { class: 'dim' }, t('Game not starting or looks broken? Repair downloads it again and checks every file.')),
      h('div', { class: 'row' }, h('button', { class: 'ghost', disabled: !!g.job || g.running, onclick: () => call('repair', g.id).then(() => toast(t('Repair started'))) }, t('Repair')),
        h('button', { class: 'ghost', disabled: !!g.job || g.running, onclick: async () => { const d = await call('moveGame', g.id); if (d) toast(t('Game moved')); } }, t('Move game to another folder')),
        h('button', { class: 'ghost', disabled: !!g.job || g.running, onclick: () => call('uninstall', g.id) }, t('Uninstall'))),
      h('p', { class: 'dim' }, t('Game folder: {dir}', { dir: g.installed.dir }))) : null,
    box,
  ];
};
P.settings = () => {
  const acc = S.account;
  const st = S.settings;
  const setS = (k, v) => call('setSetting', k, v).then(set);
  return [h('h1', {}, t('Settings')), h('p', { class: 'sub' }, ''),
    h('div', { class: 'panel' }, h('h3', {}, t('My account')),
      acc ? [h('p', {}, t('Hi {name}! Your account ID:', { name: acc.name })), h('div', { class: 'bigid' }, acc.id),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'ghost', onclick: () => call('copy', acc.id).then(() => toast(t('Copied'))) }, t('Copy ID'))),
        h('p', { class: 'dim' }, t('Want to test games? Send this ID to Zero.')),
        S.mode === 'tester' ? h('p', {}, h('span', { class: 'pill testing' }, t('TESTER')), ' ', t('You get test versions of:'), ' ', S.viewer.testerGames.map((id) => (S.games.find((g) => g.id === id) || { name: id }).name).join(', ')) : null]
        : [h('p', { class: 'dim' }, t('No password needed. Your account lives on this PC.')),
          h('div', { class: 'row' }, h('input', { id: 'accName', placeholder: t('Your name'), maxlength: 32 }),
            h('button', { class: 'btn', onclick: async () => { await call('makeAccount', $('#accName').value); toast(t('Account made')); } }, t('Make account')))]),
    h('div', { class: 'panel' }, h('h3', {}, t('Updates')),
      onOff(st.autoUpdate, (e) => setS('autoUpdate', e.target.checked), t('Update games by themselves (recommended)')),
      onOff(st.notify !== false, (e) => setS('notify', e.target.checked), t('Show a Windows message when an update is done or a new test version is ready')),
      h('label', { class: 'inline' }, t('Download speed'), h('select', { id: 'set-speed', onchange: (e) => setS('speedLimit', Number(e.target.value)) },
        [[0, t('No limit')], [5, '5 MB/s'], [2, '2 MB/s'], [1, '1 MB/s']].map(([v, l]) => h('option', { value: v, selected: (st.speedLimit || 0) === v }, l))))),
    h('div', { class: 'panel' }, h('h3', {}, t('Start')),
      onOff(!!st.startWithWindows, (e) => setS('startWithWindows', e.target.checked), t('Start Zero Launcher with Windows (small, in the tray)'))),
    h('div', { class: 'panel' }, h('h3', {}, t('Easy to read')),
      h('label', { class: 'inline' }, t('Text size'), h('select', { id: 'set-size', onchange: (e) => setS('textSize', e.target.value) },
        [['normal', t('Normal')], ['big', t('Big')], ['bigger', t('Bigger')]].map(([v, l]) => h('option', { value: v, selected: (st.textSize || 'normal') === v }, l)))),
      onOff(!!st.easyFont, (e) => setS('easyFont', e.target.checked), t('Easy-to-read letters (Atkinson Hyperlegible)')),
      h('label', { class: 'inline' }, t('Language'), h('select', { id: 'set-lang', onchange: (e) => setS('lang', e.target.value) },
        h('option', { value: 'en', selected: st.lang !== 'nl' }, 'English'), h('option', { value: 'nl', selected: st.lang === 'nl' }, 'Nederlands')))),
    S.mode === 'developer' ? h('div', { class: 'panel keybackup' }, h('h3', {}, 'Back up my secret key'),
      h('p', {}, 'Your secret key signs the game list. If you lose it, players cannot get updates until they reinstall. Keep a copy on a USB stick.'),
      S.keyBackup ? h('p', { class: 'dim' }, `Last backup: ${new Date(S.keyBackup.at).toLocaleDateString()} · next reminder: ${new Date(S.keyBackup.remindAt).toLocaleDateString()}`)
        : h('p', { class: 'warn' }, 'No backup yet.'),
      h('button', { class: 'btn', onclick: async () => { const r = await call('devBackupKey'); if (r) toast('Key copied. Keep the USB stick safe.'); } }, 'Back up my secret key'),
      h('p', { class: 'dim' }, 'It is only copied to the folder you pick. It is never uploaded.')) : null,
  ];
};
const HELP = [
  ['Windows shows a blue box "Windows protected your PC". Is it safe?',
    'Yes. Windows shows this for new apps that are not famous yet. Press "More info", then "Run anyway". You only need to do this once.'],
  ['Where are my games?',
    'In the Library. The game files are on your PC in the Zero Launcher folder. Disk full? Open the game page and press "Move game to another folder".'],
  ['How do updates work?',
    'The launcher checks for new versions by itself and installs them for you. You just press Play. No internet? Games you installed still play.'],
  ['A download stopped. What now?',
    'Press Resume. The download goes on from where it stopped. Only one game downloads at a time; the others say "Waiting".'],
  ['A game does not start. What can I do?',
    'Open the game page and press Repair. It downloads the game again and checks every file. If a game crashes, you see a red box with "Show crash report". Nothing is saved until you say so.'],
  ['How do I report a problem?',
    'Click the game to open its page. Type what went wrong under "Report a problem" and press "Make report". Send it to Zero, for example on Discord.'],
  ['How do I become a tester?',
    'Go to Settings and make an account (just a name, no password). Send your account ID to Zero. When Zero adds you, you get test versions of some games.'],
  ['Is it safe?',
    'Yes. Every game list is signed by Zero, and every download is checked before it is installed. A changed or broken file is never used.'],
];
P.help = () => [h('h1', {}, t('Help')), h('p', { class: 'sub' }, t('Short answers to common questions.')),
  HELP.map(([q, a]) => h('details', { class: 'panel faq' }, h('summary', {}, t(q)), h('p', {}, t(a))))];

// ---- developer ----

// ---- My projects (developer): every project, exact status, don't forget, scrap, quick review, report ----
let projData = null;
let projFilter = { q: '', type: '', stage: '', waitingOn: '', priority: '', showReleased: false };
let reviewAt = 0;
const SRC_NOTE = (p) => (p.history.length ? 'you set this' : 'from project notes');
const daysTxt = (iso) => { if (!iso) return 'never'; const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
const loadProjects = async () => { projData = await call('devProjects'); render(); };
function projVisible() {
  const f = projFilter; const q = f.q.toLowerCase();
  return projData.projects.filter((p) => p.stage !== 'scrapped'
    && (f.stage ? p.stage === f.stage : (p.stage !== 'released' || p.needsWork || f.showReleased))
    && (!f.type || p.type === f.type) && (!f.waitingOn || p.waitingOn === f.waitingOn) && (!f.priority || p.priority === Number(f.priority))
    && (!q || [p.name, p.id, p.nextStep, p.notes, p.repo, ...p.folders].join(' ').toLowerCase().includes(q)));
}
function scrapProject(p) {
  const input = h('input', { id: 'scrap-reason', placeholder: 'example: not fun anymore', maxlength: 200, style: 'width:100%' });
  modal(`Scrap ${p.name}?`, h('div', {}, h('p', {}, 'Why? One line is enough. No files are deleted.'), input), [
    ['Cancel', 'ghost', () => true],
    ['Next', 'btn bad', async () => {
      const reason = $('#scrap-reason').value.trim();
      if (!reason) { toast('Write one line first', 'error'); return false; }
      const r = await call('devProjectScrap', p.id, reason);
      if (r) { projData = r; render(); toast(`${p.name} is scrapped. It is hidden everywhere.`); }
    }]]);
}
function projectRow(p) {
  const st = p.status; const fx = st.facts;
  const v = (k) => fx[k] && fx[k].value;
  const src = (k) => (fx[k] ? h('span', { class: 'src', title: fx[k].source }, fx[k].source) : null);
  const D = projData;
  const edit = h('div', { class: 'hub-edit', style: 'display:none' },
    h('div', { class: 'form' },
      h('label', {}, 'Stage', h('select', { class: 'e-stage' }, Object.entries(D.stages).filter(([k]) => k !== 'scrapped').map(([k, l]) => h('option', { value: k, selected: p.stage === k }, l)))),
      h('label', {}, 'Type', h('select', { class: 'e-type' }, Object.entries(D.types).map(([k, l]) => h('option', { value: k, selected: p.type === k }, l)))),
      h('label', {}, 'Waiting on', h('select', { class: 'e-wait' }, Object.entries(D.waitingOn).map(([k, l]) => h('option', { value: k, selected: p.waitingOn === k }, l)))),
      h('label', {}, 'Priority', h('select', { class: 'e-prio' }, [1, 2, 3].map((n) => h('option', { value: n, selected: p.priority === n }, String(n))))),
      h('label', {}, 'Next step', h('input', { class: 'e-next', value: p.nextStep || '', placeholder: 'example: add sound to menu' })),
      h('label', {}, 'Notes', h('input', { class: 'e-notes', value: p.notes || '' }))),
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: async (e) => {
      const box = e.target.closest('.hub-edit');
      projData = await call('devProjectSave', p.id, { stage: box.querySelector('.e-stage').value, type: box.querySelector('.e-type').value, waitingOn: box.querySelector('.e-wait').value,
        priority: Number(box.querySelector('.e-prio').value), nextStep: box.querySelector('.e-next').value.trim(), notes: box.querySelector('.e-notes').value.trim() });
      render(); toast('Saved');
    } }, 'Save'),
    h('button', { class: 'ghost small bad-text', onclick: () => scrapProject(p) }, 'Scrap project')));
  const folder = (st.folders.find((f) => f.found) || {}).dir || p.folders[0]; // the first folder that is on this PC
  return h('div', { class: 'hub-row', 'data-id': p.id },
    h('div', { class: 'hub-main' },
      h('div', { class: 'row' }, h('b', { class: 'hub-name' }, p.name), h('span', { class: 'kind k-' + p.type }, D.types[p.type]), h('span', { class: 'prio p' + p.priority, title: 'Priority' }, 'P' + p.priority),
        v('version') ? h('span', { class: 'dim', title: fx.version.source }, v('version')) : null),
      h('div', { class: 'row', style: 'margin-top:4px' },
        h('span', { class: 'pill st-' + p.stage }, D.stages[p.stage]), h('span', { class: 'src' }, SRC_NOTE(p)),
        p.waitingOn !== 'nobody' ? h('span', { class: 'wait' }, 'Waiting on: ' + D.waitingOn[p.waitingOn]) : null,
        h('span', { class: 'dim', title: st.lastChangeSource || '' }, '· last change ' + daysTxt(st.lastChange)), st.lastChangeSource ? h('span', { class: 'src' }, st.lastChangeSource) : null),
      p.nextStep ? h('div', { class: 'next' }, 'Next: ', p.nextStep) : null,
      p.needsWork ? h('div', { class: 'warn' }, '⚠ Needs work: ' + p.needsWork) : null,
      st.warnings.length ? h('div', { class: 'warn' }, st.warnings.map((w) => h('div', { class: /^Folder not found/.test(w) ? 'missing' : '' }, '⚠ ' + w))) : null,
      v('siteState') ? h('div', { class: 'dim' }, 'Website: ' + v('siteState') + ' ', src('siteState')) : null,
      v('channel') ? h('div', { class: 'dim' }, 'Launcher: ' + Object.entries(v('channel')).map(([s, vs]) => `${s} ${vs.join(', ')}`).join(' · ') + ' ', src('channel')) : null,
      v('lastBuild') ? h('div', { class: 'dim' }, `Last build: ${mb(v('lastBuild').size)} · ${new Date(v('lastBuild').at).toLocaleDateString()} `, src('lastBuild')) : null,
      v('robloxFile') ? h('div', { class: 'dim' }, `Roblox file: ${v('robloxFile').file} · ${new Date(v('robloxFile').date).toLocaleDateString()}`) : null,
      v('git') ? h('details', { class: 'git' }, h('summary', {}, `Git: ${v('git').commits.length ? 'last ' + v('git').commits.length + ' commits' : 'no commits'}${v('git').dirty ? ' · changes not committed' : ''}`),
        v('git').commits.map((c) => h('div', { class: 'commit' }, h('span', { class: 'dim' }, new Date(c.date).toLocaleDateString() + ' '), c.message))) : null,
      p.repo ? h('div', { class: 'dim' }, 'Repo: ' + p.repo) : null,
      p.notes ? h('div', { class: 'dim' }, p.notes) : null,
      edit),
    h('div', { class: 'hub-side' },
      folder ? h('button', { class: 'ghost small', title: folder, onclick: () => call('devOpenFolder', folder) }, 'Open folder') : h('span', { class: 'dim' }, 'no folder'),
      p.folders.map((f) => h('span', { class: 'path' }, f)),
      folder ? h('button', { class: 'ghost small', onclick: () => call('copy', folder).then(() => toast('Path copied')) }, 'Copy path') : null,
      h('div', { class: 'row' },
        h('button', { class: 'ghost small', onclick: (e) => { const x = e.target.closest('.hub-row').querySelector('.hub-edit'); x.style.display = x.style.display === 'none' ? 'block' : 'none'; } }, 'Edit'),
        p.stage === 'released' ? h('button', { class: 'ghost small', onclick: async () => { projData = await call('devProjectSave', p.id, { needsWork: p.needsWork ? '' : 'needs work' }); render(); } }, p.needsWork ? 'Mark fixed' : 'Needs work') : null)));
}
function projBox(title, cls, items, empty, line) {
  return h('div', { class: 'panel pbox ' + cls }, h('h3', {}, `${title} (${items.length})`), items.length ? items.slice(0, 8).map(line) : h('div', { class: 'dim' }, empty),
    items.length > 8 ? h('div', { class: 'dim' }, `and ${items.length - 8} more`) : null);
}
const jumpTo = (id) => { projFilter = { ...projFilter, q: '', stage: '', type: '', waitingOn: '', priority: '', showReleased: true }; render(); setTimeout(() => { const r = document.querySelector(`.hub-row[data-id="${id}"]`); if (r) { r.scrollIntoView({ block: 'center' }); r.classList.add('flash'); } }, 50); };
P['dev-hub'] = () => {
  if (!projData) { loadProjects().catch(() => {}); return [h('h1', {}, 'My projects'), h('p', { class: 'dim loading' }, 'Checking your folders…')]; }
  const D = projData; const list = projVisible();
  const sel = (key, label, opts) => h('select', { class: 'pf-' + key, onchange: (e) => { projFilter[key] = e.target.value; render(); } },
    h('option', { value: '' }, label), Object.entries(opts).map(([k, l]) => h('option', { value: k, selected: String(projFilter[key]) === String(k) }, l)));
  const search = h('input', { id: 'hub-q', class: 'search', placeholder: 'Search a project, folder or next step…', value: projFilter.q, style: 'width:100%;font-size:16px;padding:12px 14px',
    oninput: (e) => { projFilter.q = e.target.value; render(); const i = $('#hub-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
  const groups = Object.entries(D.stages).map(([k, l]) => [k, l, list.filter((p) => p.stage === k)]).filter(([, , ps]) => ps.length);
  return [h('div', { class: 'row', style: 'justify-content:space-between' }, h('h1', {}, 'My projects'),
      h('div', { class: 'row' },
        h('button', { class: 'ghost', onclick: () => { reviewAt = 0; go('dev-review'); } }, 'Quick review'),
        h('button', { class: 'ghost', onclick: () => { reportData = null; go('dev-report'); } }, 'Make status report'),
        h('button', { class: 'ghost', onclick: () => go('dev-graveyard') }, `Scrapped (${D.scrapped.length})`),
        h('button', { class: 'ghost', onclick: async () => { await loadProjects(); toast('Folders checked again'); } }, 'Check again'))),
    h('p', { class: 'sub' }, `Checked ${new Date(D.scannedAt).toLocaleTimeString()}. Every value says where it comes from. Released and scrapped projects are hidden unless you ask.`),
    D.review.due ? h('div', { class: 'hero' }, h('div', {}, h('h2', {}, 'Quick review'), h('div', { class: 'dim' }, `${D.review.queue.length} projects, one at a time. Keep going, pause, scrap or skip.`)),
      h('button', { class: 'btn', onclick: () => { reviewAt = 0; go('dev-review'); } }, 'Start review')) : null,
    D.siteError ? h('div', { class: 'err' }, D.siteError) : null,
    h('div', { class: 'pboxes' },
      projBox("Don't forget", 'forget', D.dontForget, 'Nothing forgotten. Nice!', (x) => h('div', { class: 'pline clickable', onclick: () => jumpTo(x.id) }, h('b', {}, x.name), h('span', { class: 'days' }, ` ${x.days} days`), x.nextStep ? h('div', { class: 'dim' }, 'Next: ' + x.nextStep) : null)),
      projBox('Waiting on you', 'waiting', D.waiting, 'Nothing waits on you.', (x) => h('div', { class: 'pline clickable', onclick: () => jumpTo(x.id) }, h('b', {}, x.name), x.nextStep ? h('div', { class: 'dim' }, x.nextStep) : null)),
      projBox('New folder found', 'newf', D.newFolders, 'No new folders on E:\\ or F:\\.', (x) => h('div', { class: 'pline' }, h('b', {}, x.name), h('div', { class: 'dim path' }, x.path),
        h('div', { class: 'row' },
          h('button', { class: 'ghost small', onclick: async () => { const r = await call('devProjectAdd', { name: x.name, type: 'other', folder: x.path }); projData = r.view; render(); toast('Added. Press Edit to set the type and stage.'); } }, 'Add as project'),
          h('button', { class: 'ghost small', onclick: async () => { projData = await call('devProjectIgnoreFolder', x.path); render(); } }, 'Ignore forever'))))),
    search,
    h('div', { class: 'row tools' }, sel('type', 'All types', D.types), sel('stage', 'All stages', Object.fromEntries(Object.entries(D.stages).filter(([k]) => k !== 'scrapped'))),
      sel('waitingOn', 'Waiting on anyone', D.waitingOn), sel('priority', 'Any priority', { 1: 'Priority 1', 2: 'Priority 2', 3: 'Priority 3' }),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: projFilter.showReleased, onchange: (e) => { projFilter.showReleased = e.target.checked; render(); } }), 'Show released'),
      h('button', { class: 'ghost small', onclick: () => {
        const input = h('input', { id: 'new-proj', placeholder: 'Project name', maxlength: 80, style: 'width:100%' });
        modal('New project', input, [['Cancel', 'ghost', () => true], ['Add', 'btn', async () => {
          const name = $('#new-proj').value.trim(); if (!name) return false;
          const r = await call('devProjectAdd', { name, type: 'other' }); projData = r.view; closeModal(); render(); jumpTo(r.id);
        }]]);
      } }, '+ New project')),
    groups.map(([k, l, ps]) => h('div', { class: 'hub-group' }, h('h3', {}, `${l} (${ps.length})`), ps.map(projectRow))),
    !list.length ? h('div', { class: 'empty' }, 'No project matches.') : null];
};

// Quick review: one project at a time, 4 big buttons. Most forgotten first, max 10.
P['dev-review'] = () => {
  if (!projData) { loadProjects().catch(() => {}); return [h('h1', {}, 'Quick review'), h('p', { class: 'dim loading' }, 'Loading…')]; }
  const q = projData.review.queue;
  const back = h('button', { class: 'ghost', onclick: () => go('dev-hub') }, '← My projects');
  if (!q.length) return [h('h1', {}, 'Quick review'), h('div', { class: 'hero' }, h('div', {}, h('h2', {}, 'All done!'), h('div', { class: 'dim' }, 'Your week plan uses the projects you keep going.'))), back];
  const p = q[0];
  const choose = async (choice, reason) => { projData = await call('devReviewChoice', p.id, choice, reason || ''); reviewAt++; render(); };
  return [h('div', { class: 'row', style: 'justify-content:space-between' }, h('h1', {}, 'Quick review'), h('span', { class: 'dim review-count' }, `${projData.review.doneCount + 1} of ${projData.review.doneCount + q.length}`)),
    h('div', { class: 'panel review-card' },
      h('h2', {}, p.name), h('div', { class: 'row' }, h('span', { class: 'pill st-' + p.stage }, p.stageLabel), h('span', { class: 'kind' }, p.type), h('span', { class: 'prio p' + p.priority }, 'P' + p.priority)),
      h('p', { class: 'big-days' }, p.days ? `No change for ${p.days} days` : 'Changed today'),
      p.nextStep ? h('p', {}, 'Next: ' + p.nextStep) : null, p.notes ? h('p', { class: 'dim' }, p.notes) : null,
      h('div', { class: 'review-btns' },
        h('button', { class: 'btn big good', onclick: () => choose('keep') }, 'Keep going'),
        h('button', { class: 'btn big', onclick: () => choose('pause') }, 'Pause'),
        h('button', { class: 'btn big bad', onclick: () => {
          const input = h('input', { id: 'scrap-reason', placeholder: 'example: not fun anymore', maxlength: 200, style: 'width:100%' });
          modal(`Scrap ${p.name}?`, h('div', {}, h('p', {}, 'Why? One line is enough. No files are deleted.'), input), [['Cancel', 'ghost', () => true], ['Scrap it', 'btn bad', async () => {
            const reason = $('#scrap-reason').value.trim(); if (!reason) { toast('Write one line first', 'error'); return false; }
            closeModal(); await choose('scrap', reason);
          }]]);
        } }, 'Scrap'),
        h('button', { class: 'btn big ghost', onclick: () => choose('skip') }, 'Skip'))),
    back];
};

// Graveyard: scrapped projects with reason + date. Only Zero presses "Bring back".
P['dev-graveyard'] = () => {
  if (!projData) { loadProjects().catch(() => {}); return [h('h1', {}, 'Scrapped'), h('p', { class: 'dim loading' }, 'Loading…')]; }
  const list = projData.scrapped;
  return [h('div', { class: 'row', style: 'justify-content:space-between' }, h('h1', {}, 'Scrapped'), h('button', { class: 'ghost', onclick: () => go('dev-hub') }, '← My projects')),
    h('p', { class: 'sub' }, 'Hidden everywhere. No files were deleted. Change the website yourself if it still shows a game.'),
    list.length ? list.map((p) => h('div', { class: 'hub-row grave', 'data-id': p.id },
      h('div', { class: 'hub-main' }, h('b', { class: 'hub-name' }, p.name), h('div', { class: 'dim' }, `Scrapped${p.scrappedAt ? ' ' + new Date(p.scrappedAt).toLocaleDateString() : ''}: ${p.scrapReason || ''}`),
        p.status.warnings.filter((w) => /^Scrapped/.test(w)).map((w) => h('div', { class: 'warn' }, '⚠ ' + w))),
      h('div', { class: 'hub-side' },
        p.folders.filter((f) => !p.status.warnings.includes('Folder not found: ' + f)).map((f) => h('button', { class: 'ghost small', title: f, onclick: async () => { const z = await call('devProjectArchive', p.id, f); if (z) toast('Archive zip made: ' + z); } }, 'Pack folder into an archive zip')),
        h('button', { class: 'ghost small', onclick: async () => { const r = await call('devProjectBringBack', p.id); if (r) { projData = r; render(); toast(`${p.name} is back`); } } }, 'Bring back'))))
      : h('div', { class: 'empty' }, 'Nothing scrapped.')];
};

// Status report: one page, Markdown copy button, optional save.
let reportData = null;
P['dev-report'] = () => {
  if (!reportData) { call('devStatusReport').then((r) => { reportData = r; render(); }).catch(() => {}); return [h('h1', {}, 'Status report'), h('p', { class: 'dim loading' }, 'Making it…')]; }
  const frame = h('iframe', { class: 'report-frame', sandbox: '', srcdoc: reportData.html, title: 'Status report' });
  return [h('div', { class: 'row', style: 'justify-content:space-between' }, h('h1', {}, 'Status report'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => { await call('copy', reportData.markdown); toast('Markdown copied'); } }, 'Copy as Markdown'),
        h('button', { class: 'ghost', onclick: async () => { const f = await call('devSaveReport', 'html'); if (f) toast('Saved: ' + f); } }, 'Save as HTML'),
        h('button', { class: 'ghost', onclick: async () => { const f = await call('devSaveReport', 'md'); if (f) toast('Saved: ' + f); } }, 'Save as Markdown'),
        h('button', { class: 'ghost', onclick: () => { reportData = null; go('dev-hub'); } }, '← My projects'))),
    frame];
};

P['dev-week'] = () => {
  if (!weekData) { call('devWeek').then((r) => { weekData = r; render(); }).catch(() => {}); return [h('h1', {}, 'This week'), h('p', { class: 'dim loading' }, 'Loading…')]; }
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
const CHECKS_UI = [['starts', 'The game starts'], ['sound', 'No sound bugs'], ['tested', 'Tested by a tester'], ['notes', "What's new is written"], ['picture', 'Picture is set']];
function releaseChecklist(g, r) {
  const saved = (S.checklists || {})[`${g.id}@${r.version}`] || {};
  const hint = { notes: r.notes ? `"${r.notes}"` : 'empty now', picture: g.image ? 'set' : 'no picture yet', tested: r.state === 'testing' ? 'it is with testers now' : 'not sent to testers' };
  const body = h('div', { class: 'checklist' }, h('p', { class: 'dim' }, `${g.name} ${r.version}. Tick what is true. Your ticks are saved.`),
    CHECKS_UI.map(([k, label]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', class: 'rc', value: k, checked: !!saved[k] }), h('span', { class: 'ctext' }, label), hint[k] ? h('span', { class: 'dim' }, hint[k]) : null)));
  const ticks = () => Object.fromEntries([...document.querySelectorAll('input.rc')].map((i) => [i.value, i.checked]));
  modal('Before you release', body, [
    ['Cancel', 'ghost', () => true],
    ['Save ticks', 'ghost', async () => { await call('devSaveChecklist', g.id, r.version, ticks()); S.checklists = { ...(S.checklists || {}), [`${g.id}@${r.version}`]: ticks() }; toast('Ticks saved'); }],
    ['Release to everyone', 'btn good', async () => { await call('devSaveChecklist', g.id, r.version, ticks()); closeModal(); set(await call('devRelease', g.id, r.version)); }],
  ]);
}
async function discordPost(g, r) {
  const text = await call('devDiscordPreview', g.id, r.version);
  modal('Post to Discord', h('div', {}, h('p', { class: 'dim' }, 'This is what will be posted. Change it if you want. Nothing is sent until you press Send.'),
    h('textarea', { id: 'discord-text', maxlength: 2000, style: 'min-height:120px' }, text)), [
    ['Cancel', 'ghost', () => true],
    ['Send', 'btn', async () => { await call('devDiscordSend', $('#discord-text').value); toast('Posted to Discord'); }],
  ]);
}
function gameInfoBox(g) {
  const id = 'gi-' + g.id;
  return h('details', { class: 'gameinfo' }, h('summary', {}, 'Game page: pictures, trailer, coming soon'),
    h('div', { class: 'form' },
      h('label', {}, 'Trailer (YouTube address)', h('input', { id: id + '-tr', value: g.trailer || '', placeholder: 'https://www.youtube.com/watch?v=…' })),
      h('label', {}, 'Coming soon date (empty = not coming soon)', h('input', { id: id + '-cs', type: 'date', value: g.comingSoon ? g.comingSoon.slice(0, 10) : '' }))),
    h('label', {}, 'Screenshots: one https picture address per line (max 12)', h('textarea', { id: id + '-ss' }, (g.screenshots || []).join('\n'))),
    h('button', { class: 'ghost small', style: 'margin-top:8px', onclick: async () => {
      const screenshots = $('#' + id + '-ss').value.split('\n').map((x) => x.trim()).filter(Boolean);
      set(await call('devSetGameInfo', g.id, { screenshots, trailer: $('#' + id + '-tr').value.trim(), comingSoon: $('#' + id + '-cs').value }));
      toast('Game page saved. Press Upload now to send it to players.');
    } }, 'Save game page'));
}
P['dev-publish'] = () => {
  const pc = S.games.filter((g) => g.kind === 'pc');
  if (!dlData) { dlData = { perGame: {}, loading: true }; call('devDownloads').then((r) => { dlData = r; render(); }).catch(() => {}); }
  if (!godotList) { godotList = []; call('devGodotProjects').then((r) => { godotList = r; render(); }).catch(() => {}); }
  const godotFor = (id) => godotList.find((p) => p.id === id);
  const godotBox = (g) => {
    const p = godotFor(g.id);
    if (!p) return null;
    return h('div', { class: 'godot' },
      h('div', { class: 'row' }, h('button', { class: 'btn test', disabled: !p.preset, title: p.path, onclick: async () => {
        const ver = $('#v-' + g.id).value.trim(), notes = $('#n-' + g.id).value.trim(); // read before the screen redraws
        godotLog[g.id] = ['Starting…']; render();
        try {
          await call('devGodotExport', g.id, ver, notes);
          toast('Exported from Godot. Added as Unreleased.');
        } catch { godotLog[g.id].push('Failed. See the message above.'); }
        set(await call('state'));
      } }, 'Export from Godot'),
      h('span', { class: 'dim' }, p.preset ? `Project: ${p.path}${p.info && p.info.version ? ' · version in project: ' + p.info.version : ''}` : 'No "Windows Desktop" export preset. Open the project in Godot: Project > Export > Add > Windows Desktop.')),
      godotLog[g.id] ? h('div', { class: 'log small', id: 'godot-log-' + g.id }, godotLog[g.id].slice(-12).join('\n')) : null);
  };
  const verRow = (g, r) => h('tr', {}, h('td', {}, 'v' + r.version), h('td', {}, h('span', { class: 'pill ' + r.state }, r.state)),
    h('td', { class: 'dim' }, r.notes || ''), h('td', { class: 'dim' }, r.file ? mb(r.file.size) : ''),
    h('td', { class: 'dl' }, dlData && dlData.perGame[g.id] ? String(dlData.perGame[g.id].versions[r.version] || 0) : '–'),
    h('td', {}, h('div', { class: 'row' },
      r.state === 'unreleased' ? h('button', { class: 'btn test small', onclick: () => call('devToTesters', g.id, r.version).then(set) }, 'Send to testers') : null,
      r.state === 'unreleased' || r.state === 'testing' ? h('button', { class: 'btn good small', onclick: () => releaseChecklist(g, r) }, 'Release to everyone') : null,
      r.state === 'released' && S.hasDiscord ? h('button', { class: 'ghost small', onclick: () => discordPost(g, r) }, 'Post to Discord') : null,
      r.state === 'testing' ? h('button', { class: 'ghost small', onclick: () => call('devUnrelease', g.id, r.version).then(set) }, 'Back to unreleased') : null),
      r.state === 'unreleased' || r.state === 'testing' ? h('div', { class: 'row', style: 'margin-top:6px' },
        h('input', { class: 'testnotes', id: `tn-${g.id}-${r.version.replace(/\W/g, '_')}`, value: r.testNotes || '', maxlength: 600, placeholder: 'What to test (for testers)', style: 'flex:1;min-width:200px' }),
        h('button', { class: 'ghost small', onclick: async (e) => { const v = e.target.parentElement.querySelector('input').value.trim(); set(await call('devSetTestNotes', g.id, r.version, v)); toast('Saved "what to test"'); } }, 'Save')) : null));
  const all = S.games;
  return [h('h1', {}, 'Publish'), h('p', { class: 'sub' }, 'New versions start as Unreleased. Then: Send to testers → Release to everyone → Upload.'),
    h('div', { class: 'panel' + (S.uploadNeeded ? ' needs-upload' : '') }, h('div', { class: 'row', style: 'justify-content:space-between' },
      h('h3', { style: 'margin:0' }, 'Upload to players', S.uploadNeeded ? h('span', { class: 'pill unreleased upload-badge' }, 'Upload needed') : h('span', { class: 'pill released upload-badge' }, 'Up to date')),
      h('button', { class: 'btn', disabled: !!upload, onclick: async () => {
        upload = { text: 'Starting…', done: 0, total: 0 }; render();
        try { const r = await call('devUpload'); toast(`Uploaded ${r.uploaded} new file(s)`); } finally { upload = null; render(); }
      } }, upload ? 'Uploading…' : 'Upload now')),
      S.uploadNeeded ? h('p', {}, 'You changed things that players do not have yet. Press Upload now when you are ready.') : null,
      upload ? h('div', { class: 'upload-progress' }, h('div', { class: 'bar', style: 'margin:8px 0' }, h('i', { style: `width:${upload.total ? Math.round((upload.done / upload.total) * 100) : 5}%` })), h('span', { class: 'dim' }, upload.text)) : null,
      h('p', { class: 'dim' }, 'Sends the list and new game files to GitHub. Players get it within about 1 hour.'),
      h('div', { class: 'row dim' }, dlData && dlData.at ? `Download numbers from GitHub, ${new Date(dlData.at).toLocaleTimeString()}${dlData.error ? ' · ' + dlData.error : ''}` : 'Getting download numbers…',
        h('button', { class: 'ghost small', onclick: async () => { dlData = await call('devDownloads', true); render(); } }, 'Refresh numbers'))),
    pc.map((g) => h('div', { class: 'panel' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', { style: 'margin:0' }, g.name, g.owner && g.owner !== 'zero' ? h('span', { class: 'dim' }, '  by ' + g.owner) : null, g.scrapped ? h('span', { class: 'pill st-scrapped', title: 'Scrapped in My projects. Hidden from your Store. Players still get it until you press Go back.' }, 'Scrapped') : null),
        h('div', { class: 'row' }, h('button', { class: 'ghost small', onclick: () => call('devGoBack', g.id).then(set) }, 'Go back to previous version'),
          h('button', { class: 'ghost small', onclick: () => call('devHide', g.id, !g.hidden).then(set) }, g.hidden ? 'Show in store' : 'Hide from store'))),
      h('table', {}, h('tr', {}, ['Version', 'State', "What's new", 'Size', 'Downloads', ''].map((t) => h('th', {}, t))),
        (g.releases || []).slice().reverse().map((r) => verRow(g, r))),
      h('div', { class: 'form', style: 'margin-top:14px' },
        h('label', {}, 'New version', h('input', { id: 'v-' + g.id, placeholder: 'example 0.20.0' })),
        h('label', {}, "What's new", h('input', { id: 'n-' + g.id, placeholder: 'example: new wagons' }))),
      h('button', { class: 'btn', onclick: async () => {
        const dir = await call('devPickFolder'); if (!dir) return;
        toast('Packing… this can take a minute');
        await call('devAddVersion', { gameId: g.id, buildDir: dir, version: $('#v-' + g.id).value.trim(), notes: $('#n-' + g.id).value.trim() });
        toast('Added as Unreleased'); set(await call('state'));
      } }, 'Pick build folder & add version'),
      godotBox(g),
      gameInfoBox(g))),
    S.games.filter((g) => g.kind === 'web').length ? h('div', { class: 'panel' }, h('h3', {}, 'Website games: game page'),
      S.games.filter((g) => g.kind === 'web').map((g) => h('div', { style: 'margin-bottom:10px' }, h('b', {}, g.name), gameInfoBox(g)))) : null,
    h('div', { class: 'panel' }, h('h3', {}, 'Write news'),
      h('p', { class: 'dim' }, 'Shows at the top of the Store for players after you press Upload now.'),
      h('div', { class: 'form' },
        h('label', {}, 'Title', h('input', { id: 'news-title', maxlength: 80, placeholder: 'Railrove 0.20 is out!' })),
        h('label', {}, 'Picture address (optional)', h('input', { id: 'news-img', placeholder: 'https://…png' }))),
      h('label', {}, 'Short text', h('textarea', { id: 'news-text', maxlength: 600, placeholder: 'New wagons, new world. Have fun!' })),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: async () => {
        set(await call('devAddNews', { title: $('#news-title').value.trim(), text: $('#news-text').value.trim(), image: $('#news-img').value.trim() }));
        toast('News added. Press Upload now to send it to players.');
      } }, 'Add news')),
      (S.news || []).length ? h('table', { style: 'margin-top:12px' }, (S.news || []).map((n) => h('tr', {}, h('td', { class: 'dim' }, new Date(n.date).toLocaleDateString()), h('td', {}, n.title),
        h('td', {}, h('button', { class: 'ghost small', onclick: () => call('devRemoveNews', n.id).then(set) }, 'Remove'))))) : null),
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
  const box = h('div', {}, h('p', { class: 'dim loading' }, 'Loading…'));
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
  call('devAiFolders').then((fs) => {
    fs.forEach((f) => sel.append(h('option', { value: f.path }, `${f.name}  (${f.path})`)));
    if (!fs.length) sel.append(h('option', { value: '' }, 'Add folders to aiFolders in developer.json'));
    if (pendingAi && fs.length) { const text = pendingAi; pendingAi = null; $('#ai-text').value = text; go2(); }
  });
  const log = h('div', { class: 'log', id: 'ai-log' }, aiLog.join('\n'));
  const go2 = async () => {
    const text = $('#ai-text').value.trim(); if (!text) return;
    aiLog.push(`\n> ${text}`);
    aiJob = await call('devAiStart', text, sel.value);
    aiLog.push(`(${aiJob.tool} is working…)`); render();
  };
  if (!aiHistory) { aiHistory = []; call('devAiHistory').then((r) => { aiHistory = r; render(); }).catch(() => {}); }
  const past = h('div', { class: 'panel' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', { style: 'margin:0' }, 'Past jobs'),
      h('button', { class: 'ghost small', onclick: async () => { aiHistory = await call('devAiHistory'); render(); } }, 'Refresh')),
    aiHistory.length ? h('table', { class: 'ai-jobs' }, h('tr', {}, ['When', 'Tool', 'Task', 'Status', ''].map((x) => h('th', {}, x))),
      aiHistory.map((j) => h('tr', {}, h('td', { class: 'dim' }, j.startedAt ? new Date(j.startedAt).toLocaleString() : ''), h('td', {}, j.tool || ''),
        h('td', {}, String(j.task || '').slice(0, 90)), h('td', {}, h('span', { class: 'pill ' + ({ done: 'released', failed: 'pulled', running: 'testing' }[j.status] || 'unreleased') }, j.status)),
        h('td', {}, h('div', { class: 'row' },
          h('button', { class: 'ghost small', onclick: async () => { const text = await call('devAiLog', j.id); aiLog.length = 0; aiLog.push(`--- log of ${j.tool}: ${j.task} ---`, text); render(); } }, 'Show log'),
          h('button', { class: 'ghost small', onclick: () => call('devAiOpenLog', j.id) }, 'Open log file'),
          h('button', { class: 'ghost small', disabled: j.status === 'running', onclick: async () => { aiJob = await call('devAiRerun', j.id); aiLog.push(`\n> run again: ${j.task}`, `(${aiJob.tool} is working…)`); aiHistory = null; render(); } }, 'Run again'))))))
      : h('p', { class: 'dim' }, 'No jobs yet.'));
  return [h('h1', {}, 'AI helper'), h('p', { class: 'sub' }, 'Type "claude, …" or "codex, …" or "chatgpt, …". It runs on this PC with your own account. No sound, no releases.'),
    h('div', { class: 'panel' }, h('label', {}, 'Folder', sel),
      h('textarea', { id: 'ai-text', style: 'margin-top:10px', placeholder: 'claude, add a night mode to the menu', onkeydown: (e) => { if (e.key === 'Enter' && e.ctrlKey) go2(); } }),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: go2 }, 'Go'),
        aiJob ? h('button', { class: 'btn bad', onclick: () => call('devAiStop', aiJob.id) }, 'Stop') : null,
        h('button', { class: 'ghost', onclick: () => call('devChatGPT') }, 'Open ChatGPT window'),
        h('span', { class: 'dim' }, 'Ctrl+Enter = Go'))),
    log, past];
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
      const dir = await call('friendPickFolder').catch(() => null);
      if (!dir) return;
      await call('friendSubmit', { gameId: $('#s-id').value.trim(), gameName: $('#s-name').value.trim(), version: $('#s-ver').value.trim(), notes: $('#s-notes').value.trim(), buildDir: dir });
      toast('Game file made. Send the .zlsub file to Zero.');
    } }, 'Pick build folder & make file'))];

// ---------------- render ----------------
function render() {
  if (!S) return;
  applyLook();
  const { p, dev, fr } = pages();
  if (!page) page = S.mode === 'developer' ? 'dev-hub' : 'store';
  const sub = dev.length ? ['dev-review', 'dev-graveyard', 'dev-report'] : []; // pages opened from My projects
  if (![...p, ...dev, ...fr].some(([id]) => id === page) && !sub.includes(page)) page = 'store';
  renderNav();
  const keepScroll = $('#main').scrollTop;
  const m = $('#main'); m.innerHTML = '';
  m.append(...[crashBanner(), gameId ? P.game() : P[page]()].flat(3).filter(Boolean));
  m.scrollTop = keepScroll;
  const log = $('#ai-log'); if (log) log.scrollTop = log.scrollHeight;
}
function set(s) { if (s && s.games) { S = s; render(); } }

window.zl.on('state', (s) => { const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName); S = s; if (typing) renderNav(); else render(); });
window.zl.on('toast', (m) => toast(m.name ? `${m.name}: ${t(m.text, m.vars)}` : t(m.text, m.vars), m.kind));
window.zl.on('progress', (m) => {
  if (m.kind === 'upload') { upload = { text: m.text, done: m.done, total: m.total }; if (page === 'dev-publish') render(); }
  if (m.kind === 'godot') {
    (godotLog[m.gameId] = godotLog[m.gameId] || []).push(m.text);
    const el = $('#godot-log-' + m.gameId);
    if (el) { el.textContent = godotLog[m.gameId].slice(-12).join('\n'); el.scrollTop = el.scrollHeight; } else if (page === 'dev-publish') render();
  }
});
window.zl.on('ai', (m) => {
  if (m.line) aiLog.push(m.line);
  if (m.end !== undefined) { aiLog.push(`(finished, code ${m.end})`); aiJob = null; aiHistory = null; }
  const log = $('#ai-log');
  if (log) { log.textContent = aiLog.join('\n'); log.scrollTop = log.scrollHeight; }
  if (m.end !== undefined && page === 'dev-ai') render();
});
// Keyboard: Ctrl+F = search box on this page (everyone). Developer: Ctrl+1..9 = pages in the menu.
// ---------------- Ctrl+K command box (developer) ----------------
let pendingAi = null; // task typed in the command box, started when the AI page is ready
function paletteItems(q) {
  const text = q.trim();
  const items = [];
  if (/^(claude|codex|chatgpt|chat gpt|gpt)\s*[,:]?\s+\S/i.test(text)) items.push({ label: `Run in AI helper: ${text}`, kind: 'AI', run: () => { pendingAi = text; go('dev-ai'); } });
  const { p, dev, fr } = pages();
  for (const [id, label] of [...dev, ...p, ...fr]) items.push({ label, kind: 'Page', run: () => go(id) });
  for (const g of S.games) items.push({ label: g.name, kind: 'Game', run: () => { page = 'store'; gameId = g.id; render(); } });
  const low = text.toLowerCase();
  return items.filter((i) => i.kind === 'AI' || !low || i.label.toLowerCase().includes(low)).slice(0, 12);
}
function openPalette() {
  if (document.querySelector('.palette')) return;
  let sel = 0;
  const list = h('div', { class: 'pal-list' });
  const draw = () => {
    const items = paletteItems(input.value);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.innerHTML = '';
    items.forEach((it, i) => list.append(h('div', { class: 'pal-item' + (i === sel ? ' on' : ''), onclick: () => { close(); it.run(); } }, h('span', { class: 'pal-kind' }, it.kind), it.label)));
    if (!items.length) list.append(h('div', { class: 'dim', style: 'padding:10px' }, 'Nothing found.'));
    return items;
  };
  const input = h('input', { class: 'pal-input', placeholder: 'Go to a page or game, or type "claude, …" / "codex, …"', oninput: () => { sel = 0; draw(); },
    onkeydown: (e) => {
      const items = paletteItems(input.value);
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[sel]) { close(); items[sel].run(); }
      else if (e.key === 'Escape') close();
    } });
  const box = h('div', { class: 'palette', onclick: (e) => { if (e.target === box) close(); } }, h('div', { class: 'pal-box' }, input, list));
  const close = () => box.remove();
  document.body.append(box);
  draw();
  input.focus();
}

document.addEventListener('keydown', (e) => {
  if (!S || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  if ((e.key === 'k' || e.key === 'K') && S.mode === 'developer') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'f' || e.key === 'F') {
    const box = document.querySelector('#main input.search, #hub-q');
    if (box) { e.preventDefault(); box.focus(); box.select(); }
    return;
  }
  if (S.mode === 'developer' && /^[1-9]$/.test(e.key)) {
    const { p, dev, fr } = pages();
    const all = [...dev, ...p, ...fr];
    const target = all[Number(e.key) - 1];
    if (target) { e.preventDefault(); go(target[0]); }
  }
});
$('#refreshBtn').addEventListener('click', async () => { set(await call('refresh')); toast(t('Checked for updates')); });
call('state').then(set);
