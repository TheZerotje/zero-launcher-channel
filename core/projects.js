'use strict';
// DEVELOPER "My projects": one list of EVERY project (games, Roblox, D&D tools, AI, website, launcher, other).
// - Data: projects.json in the developer's app data folder (atomic writes). First run: seeded from
//   app/data/hub-seed.json (games) + app/data/projects-seed.json (everything else).
// - Status is read from the PC and is READ ONLY: folders, project files, git (read only), the website's
//   releases.json (read only), the launcher channel. Every value says where it comes from.
// - Scrap hides a project everywhere. Files are NEVER deleted. Only Zero can bring a project back
//   (the main process asks Zero in a confirm box; nothing else calls bringBack).
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic, readJson } = require('./fsutil');
const gamehub = require('./gamehub');

const DAY = 86400000;
const TYPES = { web: 'Web game', pc: 'PC game', roblox: 'Roblox', dnd: 'D&D tool', ai: 'AI', site: 'Website / launcher', other: 'Other' };
const STAGES = {
  unknown: 'Unknown – check', idea: 'Idea', building: 'Building', 'needs-playtest': 'Needs playtest',
  ready: 'Ready for your OK', released: 'Released', 'on-hold': 'On hold', scrapped: 'Scrapped',
};
const WAITING = { zero: 'You', ai: 'AI', friend: 'Friend', nobody: 'Nobody' };
const QUIET = new Set(['on-hold', 'released', 'scrapped']); // never in "Don't forget"
const FORGET_DAYS = { 1: 7, 2: 14, 3: 30 };
const ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const REVIEW_MAX = 10;

const slug = (s) => gamehub.slugify(s).slice(0, 60) || 'project';
const clampPrio = (p) => ([1, 2, 3].includes(Number(p)) ? Number(p) : 2);
const today = (now) => new Date(now).toISOString().slice(0, 10);
const daysSince = (iso, now) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / DAY)) : null);

// hub-seed status -> project stage
const FROM_HUB = { released: 'released', ready: 'ready', testing: 'needs-playtest', 'coming-soon': 'ready', building: 'building', idea: 'idea', 'on-hold': 'on-hold', scrapped: 'scrapped', 'needs-work': 'released' };
const KIND_TYPE = { web: 'web', godot: 'pc', unity: 'pc', unreal: 'pc', pc: 'pc' };

function clean(p, now) {
  const created = p.created || today(now);
  return {
    id: p.id, name: String(p.name || p.id).slice(0, 80), type: TYPES[p.type] ? p.type : 'other',
    folders: Array.isArray(p.folders) ? p.folders.filter((f) => typeof f === 'string' && f).slice(0, 10) : [],
    repo: p.repo || '', stage: STAGES[p.stage] ? p.stage : 'unknown', nextStep: p.nextStep || '',
    waitingOn: WAITING[p.waitingOn] ? p.waitingOn : 'nobody', notes: p.notes || '', priority: clampPrio(p.priority),
    created, lastTouched: p.lastTouched || created, history: Array.isArray(p.history) ? p.history : [],
    ...(p.needsWork ? { needsWork: p.needsWork } : {}),
    ...(p.scrapReason ? { scrapReason: p.scrapReason } : {}), ...(p.scrappedAt ? { scrappedAt: p.scrappedAt } : {}),
    ...(p.review ? { review: p.review } : {}), ...(p.prevStage ? { prevStage: p.prevStage } : {}),
  };
}

// First run: games from the hub seed + the project seed (+ folders from developer.json hub.projects).
function seedList({ hubSeed = { games: [] }, projectsSeed = { projects: [] }, hubProjects = [], now = Date.now() }) {
  const asOf = projectsSeed.asOf || hubSeed.asOf || today(now);
  const by = new Map();
  for (const g of hubSeed.games || []) {
    by.set(g.id, {
      id: g.id, name: g.name, type: KIND_TYPE[g.kind] || 'other', stage: FROM_HUB[g.status] || 'unknown',
      folders: g.folder ? [g.folder] : [], nextStep: g.nextStep || '', priority: 2, created: asOf,
      waitingOn: g.status === 'ready' || g.status === 'testing' ? 'zero' : 'nobody',
      notes: [g.version ? `Version ${g.version}.` : '', g.status === 'coming-soon' ? 'Coming soon on the website.' : '', g.flag || ''].filter(Boolean).join(' '),
      ...(g.status === 'scrapped' ? { scrapReason: 'Scrapped before 2 Nov 2026 (from project notes)' } : {}), // no date: not "this week"
    });
  }
  for (const p of projectsSeed.projects || []) {
    const old = by.get(p.id) || {};
    by.set(p.id, { ...old, ...p, folders: [...new Set([...(p.folders || []), ...(old.folders || [])])], created: asOf,
      notes: [old.notes, p.notes].filter(Boolean).join(' ') });
  }
  for (const hp of hubProjects || []) {
    const id = hp.id || slug(hp.name);
    const old = by.get(id) || { id, name: hp.name, type: 'pc', stage: 'building', created: asOf };
    by.set(id, { ...old, folders: [...new Set([hp.path, ...(old.folders || [])])] }); // developer.json = this PC: first
  }
  return [...by.values()].map((p) => clean(p, now));
}

class ProjectStore {
  constructor(file, seed) { this.file = file; this.seed = seed; }
  load(now = Date.now()) {
    let d = readJson(this.file);
    if (!d || !Array.isArray(d.projects)) {
      d = { version: 1, projects: seedList({ ...(this.seed || {}), now }), ignoredFolders: [], reviews: {} };
      writeJsonAtomic(this.file, d);
    }
    d.ignoredFolders = d.ignoredFolders || []; d.reviews = d.reviews || {};
    d.projects = d.projects.map((p) => clean(p, now));
    return d;
  }
  save(d) { writeJsonAtomic(this.file, d); }
  _edit(id, fn, now = Date.now()) {
    const d = this.load(now);
    const p = d.projects.find((x) => x.id === id);
    if (!p) throw new Error('Project not found');
    fn(p, d);
    this.save(d);
    return p;
  }
  // Normal edits. Scrap / bring back have their own functions; an edit can never un-scrap.
  update(id, patch, now = Date.now()) {
    return this._edit(id, (p) => {
      if (p.stage === 'scrapped') throw new Error('This project is scrapped. Bring it back first.');
      const changes = [];
      const set = (k, v) => { if (v !== undefined && p[k] !== v) { p[k] = v; changes.push(k); } };
      if ('name' in patch) set('name', String(patch.name).trim().slice(0, 80) || p.name);
      if ('type' in patch && TYPES[patch.type]) set('type', patch.type);
      if ('stage' in patch) {
        if (patch.stage === 'scrapped') throw new Error('Use "Scrap project" to scrap it');
        if (STAGES[patch.stage]) set('stage', patch.stage);
      }
      if ('waitingOn' in patch && WAITING[patch.waitingOn]) set('waitingOn', patch.waitingOn);
      if ('priority' in patch) set('priority', clampPrio(patch.priority));
      for (const k of ['nextStep', 'notes', 'repo']) if (k in patch) set(k, String(patch[k] || '').slice(0, 500));
      if ('needsWork' in patch) { if (patch.needsWork) set('needsWork', String(patch.needsWork).slice(0, 200)); else if (p.needsWork) { delete p.needsWork; changes.push('needsWork'); } }
      if ('folders' in patch && Array.isArray(patch.folders)) set('folders', patch.folders.filter((f) => typeof f === 'string' && path.isAbsolute(f)).slice(0, 10));
      if (changes.length) {
        p.lastTouched = new Date(now).toISOString();
        p.history.push({ date: p.lastTouched, what: `Changed ${changes.join(', ')}` + (changes.includes('stage') ? ` (now ${STAGES[p.stage]})` : '') });
      }
    }, now);
  }
  add({ name, type = 'other', folders = [], stage = 'idea' }, now = Date.now()) {
    const d = this.load(now);
    let id = slug(name); let n = 2;
    while (d.projects.some((p) => p.id === id)) id = `${slug(name).slice(0, 56)}-${n++}`;
    const iso = new Date(now).toISOString();
    const p = clean({ id, name, type, folders, stage: stage === 'scrapped' ? 'idea' : stage, created: iso, lastTouched: iso, history: [{ date: iso, what: 'Added' }] }, now);
    d.projects.push(p); this.save(d); return p;
  }
  scrap(id, reason, now = Date.now()) {
    const why = String(reason || '').trim();
    if (!why) throw new Error('Write one line: why do you scrap it?');
    return this._edit(id, (p) => {
      if (p.stage === 'scrapped') throw new Error('Already scrapped');
      const iso = new Date(now).toISOString();
      p.prevStage = p.stage; p.stage = 'scrapped'; p.scrapReason = why.slice(0, 200); p.scrappedAt = iso; p.lastTouched = iso;
      p.history.push({ date: iso, what: `Scrapped: ${p.scrapReason}` });
    }, now);
  }
  // ONLY called after Zero pressed "Bring back" AND said yes in the confirm box (see main.js).
  bringBack(id, now = Date.now()) {
    return this._edit(id, (p) => {
      if (p.stage !== 'scrapped') throw new Error('This project is not scrapped');
      const iso = new Date(now).toISOString();
      p.stage = p.prevStage && p.prevStage !== 'scrapped' ? p.prevStage : 'on-hold';
      delete p.scrapReason; delete p.scrappedAt; delete p.prevStage; delete p.review;
      p.lastTouched = iso; p.history.push({ date: iso, what: 'Brought back by Zero' });
    }, now);
  }
  // Add a line to the history (works for scrapped projects too; changes nothing else).
  log(id, what, now = Date.now()) {
    return this._edit(id, (p) => { p.history.push({ date: new Date(now).toISOString(), what: String(what).slice(0, 300) }); }, now);
  }
  ignoreFolder(dir) {
    const d = this.load();
    if (!d.ignoredFolders.some((x) => same(x, dir))) d.ignoredFolders.push(dir);
    this.save(d); return d.ignoredFolders;
  }
  // Quick review choice: keep / pause / scrap / skip. Saved in the project history.
  review(id, choice, { reason, weekKey } = {}, now = Date.now()) {
    if (!['keep', 'pause', 'scrap', 'skip'].includes(choice)) throw new Error('Bad choice');
    if (choice === 'scrap') { this.scrap(id, reason, now); }
    const p = this._edit(id, (x, d) => {
      const iso = new Date(now).toISOString();
      if (choice === 'keep') { x.review = 'keep'; if (x.stage === 'on-hold' || x.stage === 'unknown') x.stage = 'building'; }
      if (choice === 'pause') { x.review = 'pause'; x.stage = 'on-hold'; }
      if (choice !== 'skip') x.lastTouched = iso;
      x.history.push({ date: iso, what: `Quick review: ${{ keep: 'Keep going', pause: 'Pause', scrap: 'Scrap', skip: 'Skip' }[choice]}` });
      if (weekKey) { d.reviews[weekKey] = d.reviews[weekKey] || { done: [] }; d.reviews[weekKey].done.push(id); }
    }, now);
    return p;
  }
}

const norm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();
const same = (a, b) => norm(a) === norm(b);

// ---------- exact status (READ ONLY) ----------
// ctx: { site: gamehub.scanSite(...) result, channel: catalogue, git }
function status(p, ctx = {}) {
  const facts = {};
  const fact = (k, value, source) => { if (value != null && value !== '') facts[k] = { value, source }; };
  const warnings = [];
  const folders = [];
  let changed = null, changedSrc = null;
  for (const dir of p.folders) {
    const f = { dir, found: false };
    folders.push(f);
    if (!fs.existsSync(dir)) { warnings.push(`Folder not found: ${dir}`); continue; }
    f.found = true;
    f.changed = gamehub.lastChanged(dir);
    const pr = gamehub.readProject(dir);
    f.engine = pr.engine; f.version = pr.version; f.build = pr.builds[0] || null;
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!f.version && pkg && pkg.version) { f.version = pkg.version; f.engine = f.engine || 'node'; }
    try {
      const rbx = fs.readdirSync(dir).filter((x) => /\.rbxlx?$/i.test(x)).map((x) => ({ x, m: fs.statSync(path.join(dir, x)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
      if (rbx) { f.engine = f.engine || 'roblox'; f.roblox = { file: rbx.x, date: new Date(rbx.m).toISOString() }; }
    } catch {}
    f.git = gamehub.gitInfo(dir, ctx.git);
    const src = `folder ${dir}`;
    if (f.changed && (!changed || f.changed > changed)) { changed = f.changed; changedSrc = src; }
    if (f.version) fact('version', f.version, f.engine === 'node' ? 'package.json' : `${f.engine} project file`);
    if (f.roblox) fact('robloxFile', f.roblox, 'Roblox file date');
    if (f.build) fact('lastBuild', f.build, src);
    if (f.git) {
      fact('git', f.git, 'git (read only)');
      const c = f.git.commits && f.git.commits[0];
      const ci = c && new Date(Date.parse(c.date)).toISOString();
      if (ci && (!changed || ci > changed)) { changed = ci; changedSrc = `git (read only) in ${dir}`; }
    }
  }
  fact('changed', changed, changedSrc);
  const siteState = ctx.site && ctx.site.states && ctx.site.states[p.id];
  if (siteState) fact('siteState', siteState, 'website releases.json (read only)');
  const cg = ctx.channel && (ctx.channel.games || []).find((g) => g.id === p.id);
  if (cg) {
    const per = {};
    for (const r of cg.releases || []) (per[r.state] = per[r.state] || []).push(r.version);
    fact('channel', per, 'launcher channel');
  }
  if (p.stage === 'scrapped' && siteState && /^(released|live|public|coming)/.test(siteState)) warnings.push('Scrapped – remember to also hide it on the website');
  if (p.stage === 'scrapped' && cg && (cg.releases || []).some((r) => r.state === 'released' || r.state === 'testing')) warnings.push('Scrapped – players can still get it. Press Go back on Publish if you want it gone for them.');
  // last change = newest of: folder files, git commit, Zero's own edits
  const last = [changed, p.lastTouched].filter(Boolean).sort().pop() || null;
  return { facts, folders, warnings, lastChange: last, lastChangeSource: last && last === changed ? changedSrc : 'your last edit' };
}

// ---------- boxes ----------
function forgotten(list, now = Date.now()) {
  return list.filter((p) => !QUIET.has(p.stage)).map((p) => {
    const days = daysSince(p.status ? p.status.lastChange : p.lastTouched, now);
    return { p, days, limit: FORGET_DAYS[p.priority] };
  }).filter((x) => x.days != null && x.days >= x.limit)
    .sort((a, b) => (b.days - b.limit) - (a.days - a.limit) || a.p.priority - b.p.priority)
    .map(({ p, days }) => ({ id: p.id, name: p.name, days, nextStep: p.nextStep, priority: p.priority }));
}
const waitingOnYou = (list) => list.filter((p) => p.waitingOn === 'zero' && p.stage !== 'scrapped' && p.stage !== 'released')
  .map((p) => ({ id: p.id, name: p.name, nextStep: p.nextStep, stage: p.stage }));

// Default view hides scrapped, and released unless it needs work.
function visible(list, f = {}) {
  const q = String(f.q || '').toLowerCase();
  return list.filter((p) => p.stage !== 'scrapped'
    && (f.stage ? p.stage === f.stage : (p.stage !== 'released' || p.needsWork || f.showReleased))
    && (!f.type || p.type === f.type) && (!f.waitingOn || p.waitingOn === f.waitingOn) && (!f.priority || p.priority === Number(f.priority))
    && (!q || [p.name, p.id, p.nextStep, p.notes, p.repo, ...p.folders].join(' ').toLowerCase().includes(q)));
}

// "New folder found": ONLY the top-level folder names of the roots (E:\ and F:\). Never deeper.
const SYSTEM = new Set(['$recycle.bin', 'system volume information', 'recovery', 'windows', 'program files', 'program files (x86)',
  'programdata', 'perflogs', 'config.msi', 'msocache', 'intel', 'amd', 'nvidia', 'users', 'boot', 'found.000', 'onedrivetemp',
  'windowsapps', 'wpsystem', 'xboxgames', 'steamlibrary', 'archive', 'drivers', '$windows.~bt', '$windows.~ws', '$sysreset', '$getcurrent']);
function newFolders(roots, list, ignored = [], readdir = (d) => fs.readdirSync(d, { withFileTypes: true })) {
  const known = new Set([...list.flatMap((p) => p.folders), ...ignored].map(norm));
  const out = [];
  for (const root of roots || []) {
    let ents; try { ents = readdir(root); } catch { continue; }
    for (const e of ents) {
      if (!e.isDirectory() || (e.isSymbolicLink && e.isSymbolicLink())) continue;
      const n = e.name;
      if (n.startsWith('$') || n.startsWith('.') || SYSTEM.has(n.toLowerCase())) continue;
      const full = path.join(root, n);
      // known if it IS a project folder, or holds one (E:\Games when E:\Games\X is a project)
      const nf = norm(full);
      if (known.has(nf) || [...known].some((k) => k.startsWith(nf + path.sep.toLowerCase()) || k.startsWith(nf + '/') || k.startsWith(nf + '\\'))) continue;
      out.push({ name: n, path: full });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Quick review: most forgotten first, max 10. Not scrapped, not released (unless it needs work).
function reviewQueue(list, now = Date.now(), done = []) {
  return list.filter((p) => p.stage !== 'scrapped' && (p.stage !== 'released' || p.needsWork) && !done.includes(p.id))
    .map((p) => ({ p, days: daysSince(p.status ? p.status.lastChange : p.lastTouched, now) || 0 }))
    .sort((a, b) => b.days - a.days || a.p.priority - b.p.priority)
    .slice(0, REVIEW_MAX)
    .map(({ p, days }) => ({ id: p.id, name: p.name, stage: p.stage, stageLabel: STAGES[p.stage], type: TYPES[p.type], days, nextStep: p.nextStep, notes: p.notes, priority: p.priority }));
}

// Which game ids may the week plan use? Never scrapped or on hold. After a review, only "Keep going".
function weekAllowed(list) {
  const reviewed = list.some((p) => p.review === 'keep');
  const ok = new Set(); const blocked = new Set();
  for (const p of list) {
    if (p.stage === 'scrapped' || p.stage === 'on-hold' || (reviewed && p.review !== 'keep')) blocked.add(p.id); else ok.add(p.id);
  }
  return { ok, blocked, reviewed };
}

// Once a day, if something is in "Don't forget".
function reminderDue(lastDay, count, now = Date.now()) {
  const d = new Date(now); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (lastDay === k) return null;
  return { key: k, show: count > 0 };
}

// ---------- status report ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function report(list, now = Date.now()) {
  const date = new Date(now).toISOString().slice(0, 10);
  const wait = waitingOnYou(list); const forgot = forgotten(list, now);
  const weekAgo = now - 7 * DAY;
  const scrappedWeek = list.filter((p) => p.stage === 'scrapped' && p.scrappedAt && Date.parse(p.scrappedAt) >= weekAgo);
  const live = list.filter((p) => p.stage !== 'scrapped');
  const last = (p) => { const d = daysSince(p.status ? p.status.lastChange : p.lastTouched, now); return d == null ? '-' : d === 0 ? 'today' : `${d} days ago`; };
  const md = [`# Status report – ${date}`, '', `## Waiting on you (${wait.length})`, ...(wait.length ? wait.map((p) => `- **${p.name}**: ${p.nextStep || 'no next step'}`) : ['- Nothing.']), '',
    `## Don't forget (${forgot.length})`, ...(forgot.length ? forgot.map((p) => `- **${p.name}**: no change for ${p.days} days. Next: ${p.nextStep || '-'}`) : ['- Nothing.']), ''];
  const html = [`<h1>Status report – ${esc(date)}</h1>`, `<h2>Waiting on you (${wait.length})</h2><ul>${wait.map((p) => `<li><b>${esc(p.name)}</b>: ${esc(p.nextStep || 'no next step')}</li>`).join('') || '<li>Nothing.</li>'}</ul>`,
    `<h2>Don't forget (${forgot.length})</h2><ul>${forgot.map((p) => `<li><b>${esc(p.name)}</b>: no change for ${p.days} days. Next: ${esc(p.nextStep || '-')}</li>`).join('') || '<li>Nothing.</li>'}</ul>`];
  for (const [t, label] of Object.entries(TYPES)) {
    const ps = live.filter((p) => p.type === t);
    if (!ps.length) continue;
    md.push(`## ${label} (${ps.length})`, '| Name | Stage | Last change | Next step |', '|---|---|---|---|',
      ...ps.map((p) => `| ${p.name.replace(/\|/g, '/')} | ${STAGES[p.stage]} | ${last(p)} | ${(p.nextStep || '-').replace(/\|/g, '/')} |`), '');
    html.push(`<h2>${esc(label)} (${ps.length})</h2><table><tr><th>Name</th><th>Stage</th><th>Last change</th><th>Next step</th></tr>${ps.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(STAGES[p.stage])}</td><td>${esc(last(p))}</td><td>${esc(p.nextStep || '-')}</td></tr>`).join('')}</table>`);
  }
  md.push(`## Scrapped this week (${scrappedWeek.length})`, ...(scrappedWeek.length ? scrappedWeek.map((p) => `- ${p.name}: ${p.scrapReason}`) : ['- Nothing.']));
  html.push(`<h2>Scrapped this week (${scrappedWeek.length})</h2><ul>${scrappedWeek.map((p) => `<li>${esc(p.name)}: ${esc(p.scrapReason)}</li>`).join('') || '<li>Nothing.</li>'}</ul>`);
  const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Status report ${esc(date)}</title><style>body{font-family:sans-serif;max-width:900px;margin:24px auto;padding:0 16px;line-height:1.5}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}</style></head><body>${html.join('\n')}</body></html>`;
  return { markdown: md.join('\n'), html: page, date };
}

// "Pack folder into an archive zip": writes <destDir>/<project>-<date>.zip. NEVER deletes or changes the original.
async function archiveFolder(src, destDir, name, now = Date.now()) {
  const { packFolder } = require('./zip');
  const from = path.resolve(src), to = path.resolve(destDir);
  if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) throw new Error('Folder not found');
  const rel = path.relative(from, to);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error('Pick an archive folder outside the project folder');
  fs.mkdirSync(to, { recursive: true });
  let file = path.join(to, `${slug(name)}-${today(now)}.zip`); let n = 2;
  while (fs.existsSync(file)) file = path.join(to, `${slug(name)}-${today(now)}-${n++}.zip`);
  const part = file + '.part';
  try { await packFolder(from, part); fs.renameSync(part, file); } catch (e) { fs.rmSync(part, { force: true }); throw e; }
  return file;
}

module.exports = { archiveFolder, ProjectStore, seedList, status, forgotten, waitingOnYou, visible, newFolders, reviewQueue, weekAllowed, reminderDue, report, TYPES, STAGES, WAITING, FORGET_DAYS, ID_RE, REVIEW_MAX, same };
