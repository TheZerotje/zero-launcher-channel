'use strict';
// DEVELOPER "My games": one accurate list of every game, where it is and what it needs.
// Truth comes from 3 places, strongest first:
//   1. Zero's own marks in hub.json (status, next step, "needs work")   -> source "you"
//   2. What the PC says right now: the website's release file, game folders,
//      Godot/Unity/Unreal project files, last changed time               -> source "pc"
//   3. The seed list from the project notes (app/data/hub-seed.json)      -> source "notes"
// Every value says where it came from, so Zero can see how sure it is.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const STATUSES = {
  'needs-work': { label: 'Needs work', order: 0 },
  ready: { label: 'Ready for your OK', order: 1 },
  testing: { label: 'Needs your playtest', order: 2 },
  'coming-soon': { label: 'Coming soon', order: 3 },
  building: { label: 'In development', order: 4 },
  idea: { label: 'Idea', order: 5 },
  'on-hold': { label: 'On hold', order: 6 },
  released: { label: 'Released', order: 7 },
  scrapped: { label: 'Scrapped', order: 8 },
};
const SKIP_DIRS = new Set(['node_modules', '.git', '.godot', '.import', 'Library', 'Temp', 'obj', 'Intermediate', 'DerivedDataCache', 'Saved', '_backups', 'backups', 'dist', 'e2e']);
const DAY = 86400000;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const slugify = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Newest file change in a folder (bounded, skips caches).
function lastChanged(dir, limit = 20000) {
  let newest = 0, count = 0;
  const walk = (d, depth) => {
    if (count > limit || depth > 8) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (count > limit) return;
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(f, depth + 1); }
      else if (e.isFile()) { count++; try { const m = fs.statSync(f).mtimeMs; if (m > newest) newest = m; } catch {} }
    }
  };
  walk(dir, 0);
  return newest ? new Date(newest).toISOString() : null;
}

// What engine is this folder, and what does its project file say?
function readProject(dir) {
  const out = { engine: null, name: null, version: null, builds: [] };
  const godot = path.join(dir, 'project.godot');
  if (fs.existsSync(godot)) {
    const t = fs.readFileSync(godot, 'utf8');
    out.engine = 'godot';
    out.name = (/^config\/name="([^"]*)"/m.exec(t) || [])[1] || null;
    out.version = (/^config\/version="([^"]*)"/m.exec(t) || [])[1] || null;
    const v = /config\/features=PackedStringArray\("([\d.]+)"/.exec(t); if (v) out.engineVersion = v[1];
  }
  const unity = path.join(dir, 'ProjectSettings', 'ProjectSettings.asset');
  if (fs.existsSync(unity)) {
    const t = fs.readFileSync(unity, 'utf8');
    out.engine = 'unity';
    out.name = ((/productName: (.*)/.exec(t) || [])[1] || '').trim() || null;
    out.version = ((/bundleVersion: (.*)/.exec(t) || [])[1] || '').trim() || null;
  }
  try {
    const up = fs.readdirSync(dir).find((f) => f.endsWith('.uproject'));
    if (up) { out.engine = 'unreal'; out.name = up.replace(/\.uproject$/, ''); }
  } catch {}
  // Windows builds: look in common export folders for .exe
  for (const sub of ['build', 'builds', 'export', 'exports', 'Build', 'Builds', 'dist']) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) continue;
    const walk = (x, depth) => {
      let ents; try { ents = fs.readdirSync(x, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const f = path.join(x, e.name);
        if (e.isDirectory() && depth < 3) walk(f, depth + 1);
        else if (e.isFile() && /\.exe$/i.test(e.name) && !/crash|unins|unitycrash/i.test(e.name)) {
          const st = fs.statSync(f); out.builds.push({ exe: f, size: st.size, at: new Date(st.mtimeMs).toISOString() });
        }
      }
    };
    walk(d, 0);
  }
  out.builds.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}

// Git (READ ONLY): last 5 commits + "are there changes not committed yet?".
// --no-optional-locks: git status must not even refresh its index file.
function gitInfo(dir, run = execFileSync) {
  if (!dir || !fs.existsSync(path.join(dir, '.git'))) return null;
  const git = (args) => run('git', ['--no-optional-locks', '-C', dir, ...args], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const commits = git(['log', '-5', '--format=%cI%x09%s']).split('\n').filter(Boolean).map((l) => {
      const i = l.indexOf('\t'); return { date: l.slice(0, i), message: l.slice(i + 1).slice(0, 200) };
    });
    let dirty = null;
    try { dirty = git(['status', '--porcelain']).trim().length > 0; } catch {}
    return { commits, dirty };
  } catch { return { commits: [], dirty: null, error: 'Could not read git' }; }
}

// Website games: every folder with a game.json under the site folder (read only).
function scanSite(siteDir) {
  const games = {};
  if (!siteDir || !fs.existsSync(siteDir)) return { games, releaseFile: null, error: siteDir ? 'Website folder not found' : null };
  const walk = (d, depth) => {
    if (depth > 4) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    if (ents.some((e) => e.isFile() && e.name === 'game.json')) {
      const meta = readJson(path.join(d, 'game.json')) || {};
      const slug = path.basename(d);
      if (!games[slug] || (games[slug].changed || '') < (lastChanged(d) || '')) {
        games[slug] = { slug, folder: d, name: meta.name || slug, category: meta.category, description: meta.description, changed: lastChanged(d) };
      }
      return;
    }
    for (const e of ents) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.') && !/^_/.test(e.name)) walk(path.join(d, e.name), depth + 1);
  };
  walk(siteDir, 0);
  // Release states + host board (format read flexibly; never written).
  const relFile = path.join(siteDir, 'data', 'releases.json');
  const rel = readJson(relFile);
  const states = {};
  const take = (slug, v) => {
    const s = typeof v === 'string' ? v : v && (v.state || v.status || v.release);
    if (s) states[slug] = String(s).toLowerCase();
  };
  if (Array.isArray(rel)) rel.forEach((r) => r && (r.slug || r.id) && take(r.slug || r.id, r));
  else if (rel && typeof rel === 'object') Object.entries(rel.games || rel.releases || rel).forEach(([k, v]) => take(k, v));
  const board = readJson(path.join(siteDir, 'data', 'host-board.json')) || {};
  const boardGames = board.games || board;
  return { games, states, board: boardGames, releaseFile: rel ? relFile : null };
}

function siteStateToStatus(s) {
  if (!s) return null;
  if (/^released|live|public/.test(s)) return 'released';
  if (/coming/.test(s)) return 'coming-soon';
  if (/unreleased|hidden|test/.test(s)) return 'unreleased';
  return null;
}

function ago(iso, now = Date.now()) {
  if (!iso) return null;
  const d = Math.floor((now - Date.parse(iso)) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

// Build the full list. opts: { seed, marks, siteDir, projects: [{id,name,path}], now, bugs: {slug: count} }
function build({ seed = { games: [] }, marks = {}, siteDir, projects = [], now = Date.now(), bugs = {}, git = execFileSync }) {
  const site = scanSite(siteDir);
  const byId = new Map();
  const get = (id) => { if (!byId.has(id)) byId.set(id, { id, facts: {} }); return byId.get(id); };
  const fact = (g, key, value, source) => { if (value != null && value !== '') g.facts[key] = { value, source }; };

  for (const s of seed.games) {
    const g = get(s.id);
    for (const k of ['name', 'kind', 'status', 'version', 'folder', 'thread', 'nextStep', 'note', 'flag']) fact(g, k, s[k], 'notes');
  }
  for (const [slug, w] of Object.entries(site.games)) {
    const g = get(slug);
    fact(g, 'name', w.name, 'pc'); fact(g, 'kind', 'web', 'pc'); fact(g, 'folder', w.folder, 'pc'); fact(g, 'changed', w.changed, 'pc');
    if (w.category) fact(g, 'category', w.category, 'pc');
  }
  for (const [slug, st] of Object.entries(site.states || {})) {
    const g = get(slug);
    fact(g, 'siteState', st, 'pc');
    const mapped = siteStateToStatus(st);
    const seedStatus = g.facts.status && g.facts.status.value;
    if (mapped === 'released' || mapped === 'coming-soon') fact(g, 'status', mapped, 'pc');
    else if (mapped === 'unreleased' && (seedStatus === 'released' || seedStatus === 'coming-soon' || !seedStatus)) fact(g, 'status', 'testing', 'pc');
  }
  for (const [slug, b] of Object.entries(site.board || {})) {
    if (!b || typeof b !== 'object') continue;
    const g = get(slug);
    if (b.next || b.nextStep) fact(g, 'nextStep', b.next || b.nextStep, 'pc');
  }
  for (const p of projects) {
    const g = get(p.id || slugify(p.name));
    fact(g, 'name', p.name, 'pc'); fact(g, 'folder', p.path, 'pc');
    if (!fs.existsSync(p.path)) { fact(g, 'problem', 'Folder not found on this PC', 'pc'); continue; }
    const pr = readProject(p.path);
    if (pr.engine) fact(g, 'kind', pr.engine, 'pc');
    if (pr.version) fact(g, 'version', pr.version, 'pc');
    if (pr.engineVersion) fact(g, 'engineVersion', pr.engineVersion, 'pc');
    fact(g, 'changed', lastChanged(p.path), 'pc');
    if (pr.builds[0]) fact(g, 'lastBuild', pr.builds[0], 'pc');
    const gi = gitInfo(p.path, git);
    if (gi) fact(g, 'git', gi, 'pc');
  }
  for (const [id, m] of Object.entries(marks)) {
    const g = get(id);
    for (const k of ['status', 'nextStep', 'note', 'name', 'thread']) fact(g, k, m[k], 'you');
    if (m.needsWork) fact(g, 'needsWork', m.needsWork, 'you');
  }
  if (bugs) for (const [id, n] of Object.entries(bugs)) if (n > 0 && byId.has(id)) fact(byId.get(id), 'bugs', n, 'pc');

  const list = [...byId.values()].map((g) => {
    const v = (k) => g.facts[k] && g.facts[k].value;
    let status = v('status') || (v('changed') && now - Date.parse(v('changed')) < 14 * DAY ? 'building' : 'idea');
    const why = [];
    if (status === 'released' && (v('needsWork') || v('bugs'))) { status = 'needs-work'; why.push(v('needsWork') ? 'You marked it: needs work' : `${v('bugs')} open bug report(s)`); }
    // "In development" but nothing changed for 14 days -> say so (it may really be on hold)
    const quiet = status === 'building' && v('changed') && now - Date.parse(v('changed')) > 14 * DAY;
    if (quiet) why.push(`No changes for ${ago(v('changed'), now)}`);
    if (v('problem')) why.push(v('problem'));
    if (v('flag')) why.push(v('flag'));
    return {
      id: g.id, name: v('name') || g.id, kind: v('kind') || 'web', status, statusLabel: STATUSES[status] ? STATUSES[status].label : status,
      statusSource: status === 'needs-work' ? (v('needsWork') ? 'you' : 'pc') : (g.facts.status ? g.facts.status.source : 'pc'),
      version: v('version'), folder: v('folder'), changed: v('changed'), changedAgo: ago(v('changed'), now),
      lastBuild: v('lastBuild'), git: v('git'), siteState: v('siteState'), nextStep: v('nextStep'), thread: v('thread'), note: v('note'),
      category: v('category'), warnings: why, facts: g.facts,
    };
  });
  list.sort((a, b) => (STATUSES[a.status] ? STATUSES[a.status].order : 9) - (STATUSES[b.status] ? STATUSES[b.status].order : 9) || (b.changed || '').localeCompare(a.changed || '') || a.name.localeCompare(b.name));
  return { games: list, scannedAt: new Date(now).toISOString(), site: { folder: siteDir, releaseFile: site.releaseFile, error: site.error }, seedAsOf: seed.asOf };
}

module.exports = { build, readProject, scanSite, lastChanged, gitInfo, STATUSES, slugify };
