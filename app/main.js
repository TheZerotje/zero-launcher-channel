'use strict';
// Zero Launcher - Electron main process.
// Modes: USER (default), TESTER (same app, account ID on Zero's tester list),
// DEVELOPER (developer.json present on Zero's PC), FRIEND HOST (friend.json present).
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, dialog, nativeImage, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadChannelCached, playerView, currentRelease, retryDelay } = require('../core/catalogue');
const { Installer } = require('../core/installer');
const { findUpdates, CHECK_EVERY_MS } = require('../core/updater');
const testers = require('../core/testers');
const { Channel } = require('../core/publisher');
const { FriendInbox, makeSubmission } = require('../core/friends');
const { GitHubChannel } = require('../core/github');
const website = require('../core/website');
const { AiHelper } = require('../core/aihelper');
const { generateKeyPair } = require('../core/signing');
const gamehub = require('../core/gamehub');
const weekly = require('../core/weekly');
const { DownloadQueue } = require('../core/queue');
const strings = require('./renderer/strings');
const godot = require('../core/godot');
const { shortcutPlan, playArg } = require('../core/shortcut');
const { isTrailer } = require('../core/catalogue');
const crash = require('../core/crash');
const { DownloadStats } = require('../core/stats');
const discord = require('../core/discord');
const keybackup = require('../core/keybackup');
const projects = require('../core/projects');
const CHECK_ITEMS = ['starts', 'sound', 'tested', 'notes', 'picture'];
const CHECK_LABELS = { starts: 'The game starts', sound: 'No sound bugs', tested: 'Tested by a tester', notes: "What's new is written", picture: 'Picture is set' };
let stats = null;
const crypto = require('crypto');

const DEFAULTS = {
  siteUrl: 'https://zero-arcade.tail5afd52.ts.net:8443/',
  channelUrl: 'https://github.com/TheZerotje/zero-launcher-channel/releases/download/channel',
  autoUpdate: true,
};

if (process.env.ZL_USER_DATA) app.setPath('userData', process.env.ZL_USER_DATA);
const DATA = () => app.getPath('userData');
const file = (n) => path.join(DATA(), n);
const { readJson, writeJsonAtomic: writeJson, writeFileAtomic } = require('../core/fsutil'); // all JSON writes are atomic
const { V } = require('../core/validate');

let win = null, tray = null, installer = null, ai = null, lastHub = null;
let catalogue = null, catalogueError = null, lastCheck = null, offline = false, failures = 0, retryTimer = null;
let queue = null; // downloads: one at a time (core/queue.js)
let speedLimitMB = 0;      // download speed limit in MB/s (0 = no limit), from Settings
const crashes = new Map(); // gameId -> { code, version, at } (until the player answers)
const MUTED = !!process.env.ZL_MUTE;
global.zlNotices = []; // every notification we showed (tests read this)

function settings() { return { ...DEFAULTS, ...readJson(file('settings.json'), {}) }; }
function developer() { return readJson(file('developer.json')); }
function friendHost() { return readJson(file('friend.json')); }
function account() { return readJson(file('account.json')); }
function publicKey() {
  const s = settings();
  if (s.publicKeyFile && fs.existsSync(s.publicKeyFile)) return fs.readFileSync(s.publicKeyFile, 'utf8');
  return fs.readFileSync(path.join(__dirname, 'keys', 'zero-public.pem'), 'utf8');
}
function channelSource() { const d = developer(); return d && d.channelDir ? d.channelDir : settings().channelUrl; }
function viewer() {
  if (developer()) return { role: 'developer' };
  return { role: 'user', testerGames: catalogue ? testers.testerGames(catalogue, account()) : [] };
}
function mode() { return developer() ? 'developer' : (viewer().testerGames.length ? 'tester' : 'user'); }
function devChannel() {
  const d = developer();
  if (!d) throw new Error('Developer only');
  return new Channel(d.channelDir, fs.readFileSync(d.privateKeyFile, 'utf8'), d.publisher || 'Zero');
}
function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }
const tr = (text, vars) => strings.t(settings().lang, text, vars);

// Windows message (can be turned off in Settings). Silent when muted.
function notify(title, body) {
  if (settings().notify === false) return false;
  global.zlNotices.push({ title, body, at: new Date().toISOString() });
  try { if (Notification.isSupported()) new Notification({ title, body, silent: MUTED }).show(); } catch {}
  return true;
}

// Tell testers once when a new test version is ready for them.
function checkNewTestVersions() {
  if (developer() || !catalogue) return;
  const v = viewer();
  if (!v.testerGames.length) return;
  const s = readJson(file('settings.json'), {});
  const seen = s.seenTests || {};
  let changed = false;
  for (const g of playerView(catalogue, v).games) {
    const rel = currentRelease(g, v);
    if (rel && rel.state === 'testing' && seen[g.id] !== rel.version) {
      notify(tr('New test version'), tr('A new test version of {name} is ready: {v}.', { name: g.name || g.id, v: rel.version }));
      seen[g.id] = rel.version; changed = true;
    }
  }
  if (changed) { s.seenTests = seen; writeJson(file('settings.json'), s); }
}
// Developer: is the local game list different from the last one uploaded?
function catalogueSha() {
  const d = developer();
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(d.channelDir, 'catalogue.json'))).digest('hex'); } catch { return null; }
}
function uploadNeeded() {
  const sha = catalogueSha();
  return !!sha && sha !== (readJson(file('uploaded.json'), {}) || {}).catalogueSha;
}

// Once a month: remind Zero to back up the secret key (if there is no recent backup).
function checkKeyBackup() {
  const d = developer();
  if (!d || !d.privateKeyFile) return;
  const s = readJson(file('settings.json'), {});
  if (!keybackup.backupWarningDue({ lastBackup: s.keyBackup && s.keyBackup.at, lastWarning: s.keyBackupWarned })) return;
  notify('Back up your secret key', 'Settings > Back up my secret key. Use a USB stick.');
  send('toast', { kind: 'error', text: 'Back up your secret key: Settings > Back up my secret key.' });
  s.keyBackupWarned = new Date().toISOString(); writeJson(file('settings.json'), s);
}

// Friday 12:00: "Your new week plan is ready" (developer only).
function checkWeekNotice() {
  if (!developer()) return;
  const s = readJson(file('settings.json'), {});
  const due = weekly.noticeDue(s.weekNotice);
  if (!due) return;
  if (due.show) notify('Your new week plan is ready', 'Open "This week" in Zero Launcher. Your quick review is ready in My projects.');
  s.weekNotice = due.key; writeJson(file('settings.json'), s);
}

// Report files are named <game id>-<time>.txt or <game id>-crash-<time>.txt (see report / crashSend).
const REPORT_RE = /^[a-z0-9][a-z0-9-]{1,40}-(crash-)?\d{10,16}\.txt$/;
function reportFile(name) {
  if (typeof name !== 'string' || !REPORT_RE.test(name)) throw new Error('Bad input: report');
  const dir = path.join(DATA(), 'reports'); const full = path.join(dir, name);
  if (path.dirname(full) !== dir || !fs.existsSync(full)) throw new Error('Report not found');
  return full;
}

// ---- My projects (developer) ----
function projectStore() {
  const d = developer() || {};
  return new projects.ProjectStore(file('projects.json'), {
    hubSeed: readJson(path.join(__dirname, 'data', 'hub-seed.json'), { games: [] }),
    projectsSeed: readJson(path.join(__dirname, 'data', 'projects-seed.json'), { projects: [] }),
    hubProjects: (d.hub && d.hub.projects) || [],
  });
}
function scanRoots() {
  const d = developer() || {};
  if (d.projects && Array.isArray(d.projects.scanRoots)) return d.projects.scanRoots.filter((r) => typeof r === 'string' && path.isAbsolute(r));
  return process.platform === 'win32' ? ['E:\\', 'F:\\'] : [];
}
let lastProjects = null;
function projectsView() {
  const d = developer() || {};
  const data = projectStore().load();
  const site = gamehub.scanSite((d.hub || {}).siteDir); // READ ONLY
  const ctx = { site, channel: catalogue };
  const list = data.projects.map((p) => ({ ...p, status: projects.status(p, ctx) }));
  const now = Date.now();
  const weekKey = weekly.key(weekly.weekStart(new Date(now)));
  const done = (data.reviews[weekKey] || {}).done || [];
  const queueList = projects.reviewQueue(list, now, done).slice(0, Math.max(0, projects.REVIEW_MAX - done.length)); // max 10 per review
  lastProjects = {
    projects: list, dontForget: projects.forgotten(list, now), waiting: projects.waitingOnYou(list),
    newFolders: projects.newFolders(scanRoots(), list, data.ignoredFolders),
    scrapped: list.filter((p) => p.stage === 'scrapped').sort((a, b) => String(b.scrappedAt || '').localeCompare(String(a.scrappedAt || ''))),
    review: { weekKey, doneCount: done.length, queue: queueList, due: done.length === 0 && queueList.length > 0 },
    types: projects.TYPES, stages: projects.STAGES, waitingOn: projects.WAITING, scannedAt: new Date(now).toISOString(),
    siteError: site.error || null,
  };
  return lastProjects;
}
function scrappedIds() {
  try { return new Set(projectStore().load().projects.filter((p) => p.stage === 'scrapped').map((p) => p.id)); } catch { return new Set(); }
}
// The week plan only uses projects that may go on (never scrapped / on hold; after a review only "Keep going").
function weekHub() {
  const hub = api.devHub();
  const list = projectStore().load().projects;
  const allowed = projects.weekAllowed(list);
  const skip = list.filter((p) => allowed.blocked.has(p.id)).flatMap((p) => [p.name, p.name.replace(/\s*\(.*\)$/, '')]);
  return { ...hub, games: hub.games.filter((g) => !allowed.blocked.has(g.id)), skip };
}
// Once a day: "Don't forget" message (developer only, off switch in Settings).
function checkProjectReminder() {
  if (!developer() || settings().projectReminders === false) return;
  const s = readJson(file('settings.json'), {});
  let count = 0;
  try { count = projects.forgotten(projectStore().load().projects.map((p) => ({ ...p, status: projects.status(p, {}) }))).length; } catch { return; }
  const due = projects.reminderDue(s.projectReminderDay, count);
  if (!due) return;
  if (due.show) notify("Don't forget", `${count} project${count > 1 ? 's have' : ' has'} had no change for a while. Open My projects.`);
  s.projectReminderDay = due.key; writeJson(file('settings.json'), s);
}

// Developer's Godot projects (from developer.json hub.projects) that the launcher may export.
function godotProjects() {
  const d = developer();
  return ((d.hub && d.hub.projects) || []).filter((p) => p && p.path && fs.existsSync(path.join(p.path, 'project.godot')))
    .map((p) => ({ id: p.id, name: p.name, path: p.path, preset: godot.hasPreset(p.path), info: godot.projectInfo(p.path) }));
}

const publicJob = (j) => j && { stage: j.stage, done: j.done || 0, total: j.total || 0, version: j.version };

async function refresh() {
  const r = await loadChannelCached(channelSource(), publicKey(), path.join(DATA(), 'cache'));
  if (r.cat) catalogue = r.cat;
  offline = r.offline;
  catalogueError = !r.error ? null
    : r.error.code === 'BAD_SIGNATURE' ? 'The game list failed the safety check, so it was not used.'
    : r.offline ? null : 'Could not load the game list. Are you online?';
  if (r.error) console.error('[catalogue]', r.error.message);
  // Failed? Try again by itself after 1 min, then 5 min, then 30 min.
  clearTimeout(retryTimer);
  if (r.error) { failures++; retryTimer = setTimeout(refresh, retryDelay(failures)); } else failures = 0;
  lastCheck = new Date().toISOString();
  send('state', state());
  checkNewTestVersions();
  if (catalogue && settings().autoUpdate) autoUpdate();
  return state();
}

function state() {
  const v = viewer();
  const inst = installer.installed();
  // No list at all (first start, offline): still show installed games so they can be played.
  const view = catalogue ? playerView(catalogue, v)
    : { games: Object.entries(inst).map(([id, i]) => ({ id, name: i.name || id, kind: 'pc', releases: [] })) };
  const updates = catalogue ? findUpdates(catalogue, inst, v).map((u) => u.game.id) : [];
  const d = developer();
  const scrapped = d ? scrappedIds() : new Set();
  return {
    mode: mode(), viewer: v, siteUrl: d && d.website ? d.website.url : settings().siteUrl,
    settings: { ...settings() }, account: account() ? { name: account().name, id: account().id } : null,
    friendHost: friendHost() ? { friendId: friendHost().friendId, name: friendHost().name } : null,
    news: catalogue ? (catalogue.news || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))) : [],
    games: view.games.map((g) => ({
      id: g.id, name: g.name, kind: g.kind, url: g.url, description: g.description, image: g.image, owner: g.owner,
      phoneFriendly: g.phoneFriendly, hidden: g.hidden,
      screenshots: g.screenshots || [], hasTrailer: !!g.trailer, comingSoon: g.comingSoon || null, addedAt: g.addedAt || null,
      updatedAt: (() => { const c = currentRelease(g, v); return c ? c.releasedAt || c.testingAt || c.addedAt || null : null; })(),
      trailer: d ? g.trailer || '' : undefined,
      current: currentRelease(g, v), releases: d ? g.releases : undefined,
      installed: inst[g.id] || null, updateReady: updates.includes(g.id),
      running: installer.isRunning(g.id), job: publicJob(queue.get(g.id)),
      scrapped: d ? scrapped.has(g.id) : undefined,
    })),
    testers: d && catalogue ? catalogue.testers || [] : undefined,
    uploadNeeded: d ? uploadNeeded() : undefined,
    hasDiscord: d ? !!d.discordWebhook : undefined,
    keyBackup: d ? (readJson(file('settings.json'), {}) || {}).keyBackup || null : undefined,
    checklists: d ? readJson(file('checklists.json'), {}) : undefined,
    crashes: [...crashes.entries()].map(([gameId, c]) => ({ gameId, ...c })),
    error: catalogueError, offline, lastCheck, muted: MUTED, nextRetry: failures ? retryDelay(failures) : null,
  };
}

// Put a game in the download line. The queue runs one at a time.
function install(gameId, { repair = false } = {}) {
  const g = catalogue && catalogue.games.find((x) => x.id === gameId);
  if (!g || g.kind !== 'pc') throw new Error('Game not found');
  const rel = currentRelease(g, viewer());
  if (!rel) throw new Error('No version available for you yet');
  if (installer.isRunning(gameId)) throw new Error('Close the game first');
  return queue.add(gameId, { version: rel.version, total: rel.file.size, done: 0, repair });
}

async function runInstall(gameId, job) {
  const g = catalogue && catalogue.games.find((x) => x.id === gameId);
  if (!g) throw new Error('Game not found');
  const rel = currentRelease(g, viewer());
  if (!rel) throw new Error('No version available for you yet');
  job.version = rel.version; job.total = rel.file.size;
  const before = installer.installed()[gameId];
  let last = 0;
  await installer.install(channelSource(), g, rel, {
    signal: job.signal,
    maxBytesPerSec: () => speedLimitMB * 1048576,
    onProgress: (p) => {
      Object.assign(job, p);
      if (Date.now() - last > 250 || p.stage !== 'download') { last = Date.now(); send('state', state()); }
    },
  });
  if (before && before.version !== rel.version) notify(tr('Update done'), tr('{name} is updated to version {v}.', { name: g.name || g.id, v: rel.version }));
}

function autoUpdate() {
  for (const u of findUpdates(catalogue, installer.installed(), viewer())) {
    const j = queue.get(u.game.id);
    if (!installer.isRunning(u.game.id) && !j) install(u.game.id);
  }
}

function openWebGame(url, title) {
  const w = new BrowserWindow({
    width: 1280, height: 800, title: title || 'Zero\'s Arcade', backgroundColor: '#0d1017', autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'persist:arcade' },
  });
  if (MUTED) w.webContents.setAudioMuted(true);
  const u0 = new URL(url);
  if (!['http:', 'https:'].includes(u0.protocol)) { w.destroy(); throw new Error('Bad web address'); }
  const origin = u0.origin;
  w.webContents.on('will-attach-webview', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https:\/\//.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, u) => { if (new URL(u).origin !== origin) { e.preventDefault(); if (/^https:\/\//.test(u)) shell.openExternal(u); } });
  w.loadURL(url).catch(() => w.loadFile(path.join(__dirname, 'renderer', 'offline.html')));
  return w;
}

// ---------------- IPC: everything the screen may ask for ----------------
const api = {
  state: () => state(),
  refresh: () => refresh(),
  install: (id) => { install(id); return true; },
  repair: (id) => { install(id, { repair: true }); return true; },
  pause: (id) => queue.pause(id),
  resume: (id) => queue.resume(id),
  cancel: (id) => { const j = queue.get(id); return queue.cancel(id, () => { if (j && j.version) installer.removePart(id, j.version); }); },
  // What a crash report would hold. Shown to the player BEFORE anything is saved.
  crashPreview: (id) => {
    const c = crashes.get(id);
    if (!c) throw new Error('No crash for this game');
    const g = (catalogue && catalogue.games.find((x) => x.id === id)) || { name: id };
    const inst = installer.installed()[id] || {};
    const appData = process.env.ZL_GODOT_APPDATA || app.getPath('appData');
    const logFile = crash.godotLogFile(appData, [g.name, inst.exe ? path.basename(inst.exe, path.extname(inst.exe)) : null]);
    return crash.crashReport({ gameName: g.name || id, gameId: id, version: c.version, code: c.code, launcher: app.getVersion(), platform: `${process.platform} ${require('os').release()}`, account: account() && account().id, logFile });
  },
  crashSend: (id) => {
    const text = api.crashPreview(id);
    crashes.delete(id);
    const out = path.join(DATA(), 'reports', `${id}-crash-${Date.now()}.txt`);
    writeFileAtomic(out, text);
    send('state', state());
    return { file: out, text };
  },
  crashDismiss: (id) => { crashes.delete(id); send('state', state()); return true; },
  // Quick feedback on a TEST version: thumbs up / down + optional text. Saved like a report.
  feedback: (id, vote, text) => {
    const g = catalogue && catalogue.games.find((x) => x.id === id);
    if (!g) throw new Error('Game not found');
    const rel = currentRelease(g, viewer());
    if (!rel || rel.state !== 'testing') throw new Error('Feedback is only for test versions');
    return api.report(id, `Test feedback for version ${rel.version}: ${vote === 'up' ? '👍 good' : '👎 not good'}\n${String(text || '').slice(0, 2000)}`);
  },
  report: (id, text) => {
    const g = catalogue && catalogue.games.find((x) => x.id === id);
    if (!g) throw new Error('Game not found');
    const inst = installer.installed()[id];
    const body = [
      'Zero Launcher problem report',
      `Game: ${g.name || id} (${id})`,
      `Version: ${inst ? inst.version : (currentRelease(g, viewer()) || {}).version || '-'}`,
      `Launcher: ${app.getVersion()} on ${process.platform} ${require('os').release()}`,
      `Account: ${account() ? account().id : '-'}`,
      `Time: ${new Date().toISOString()}`,
      '',
      String(text).slice(0, 2000),
    ].join('\n');
    const dir = path.join(DATA(), 'reports');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${id}-${Date.now()}.txt`);
    writeFileAtomic(out, body);
    return { file: out, text: body };
  },
  // ---- My reports: the reports this PC made (problem, crash, feedback). Only files in the reports folder. ----
  reportsList: () => {
    const dir = path.join(DATA(), 'reports');
    let files = []; try { files = fs.readdirSync(dir).filter((f) => REPORT_RE.test(f)); } catch {}
    return files.map((f) => {
      const full = path.join(dir, f); const st = fs.statSync(full);
      const head = fs.readFileSync(full, 'utf8').slice(0, 600);
      const game = (/^Game: (.*)$/m.exec(head) || [])[1] || '';
      const kind = /-crash-\d+\.txt$/.test(f) ? 'crash' : /^Test feedback/m.test(head) ? 'feedback' : 'problem';
      return { name: f, kind, game: game.replace(/\s*\([a-z0-9-]+\)$/, ''), at: new Date(st.mtimeMs).toISOString(), size: st.size };
    }).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
  },
  reportText: (name) => fs.readFileSync(reportFile(name), 'utf8').slice(0, 200000),
  reportShow: (name) => { shell.showItemInFolder(reportFile(name)); return true; },
  uninstall: async (id) => {
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Uninstall', 'Cancel'], defaultId: 1, message: 'Uninstall this game?' });
    if (r.response !== 0) return false;
    if (queue.get(id)) throw new Error('Wait for the download to finish, or press Cancel');
    installer.uninstall(id); send('state', state()); return true;
  },
  play: (id) => {
    const g = catalogue && catalogue.games.find((x) => x.id === id);
    if (g && g.kind === 'web') { openWebGame(g.url, g.name); return true; }
    const version = (installer.installed()[id] || {}).version;
    installer.play(id, (code, err, ms) => {
      if (crash.isCrash(code, ms, err)) crashes.set(id, { code: err ? String(err.code || err.message) : code, version, at: new Date().toISOString() });
      send('state', state());
      if (catalogue && settings().autoUpdate) autoUpdate();
    });
    send('state', state()); return true;
  },
  openArcade: () => { openWebGame(state().siteUrl); return true; },
  // The trailer address comes from the signed list, never from the screen.
  openTrailer: (id) => {
    const g = catalogue && catalogue.games.find((x) => x.id === id);
    if (!g || !isTrailer(g.trailer || '')) throw new Error('No trailer');
    shell.openExternal(g.trailer); return true;
  },
  makeShortcut: (id) => {
    if (process.platform !== 'win32') throw new Error('Desktop shortcuts work on Windows only');
    const g = catalogue && catalogue.games.find((x) => x.id === id);
    if (!g) throw new Error('Game not found');
    const plan = shortcutPlan({ gameId: id, name: g.name || id, desktop: app.getPath('desktop'), execPath: process.execPath, appPath: app.getAppPath(), isPackaged: app.isPackaged });
    if (!shell.writeShortcutLink(plan.file, 'create', plan.options)) throw new Error('Could not make the shortcut');
    return plan.file;
  },
  moveGame: async (id) => {
    if (queue.get(id)) throw new Error('Wait for the download to finish, or press Cancel');
    if (!installer.installed()[id]) throw new Error('Game is not installed');
    const pick = await dialog.showOpenDialog(win, { title: 'Pick the new folder for this game', properties: ['openDirectory', 'createDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const r = await installer.moveGame(id, pick.filePaths[0]);
    send('state', state());
    return r.dir;
  },
  setLaunchArgs: (id, text) => { const r = installer.setLaunchArgs(id, text); send('state', state()); return r; },
  setSetting: (k, v) => {
    const ok = { autoUpdate: 'boolean', notify: 'boolean', easyFont: 'boolean', startWithWindows: 'boolean', projectReminders: 'boolean', textSize: ['normal', 'big', 'bigger'], lang: ['en', 'nl'], speedLimit: [0, 1, 2, 5] };
    if (!ok[k]) throw new Error('Not allowed');
    if (Array.isArray(ok[k]) ? !ok[k].includes(v) : typeof v !== ok[k]) throw new Error('Not allowed');
    if (k === 'speedLimit') speedLimitMB = v;
    if (k === 'startWithWindows') {
      try { app.setLoginItemSettings({ openAtLogin: v, args: ['--hidden'] }); } catch {}
      if (v && !tray) createTray();
    }
    const s = readJson(file('settings.json'), {}); s[k] = v; writeJson(file('settings.json'), s);
    return state();
  },
  makeAccount: (name) => {
    if (account()) throw new Error('You already have an account');
    const a = testers.makeAccount(name); writeJson(file('account.json'), a); refresh(); return { name: a.name, id: a.id };
  },
  copy: (text) => { require('electron').clipboard.writeText(String(text)); return true; },

  // ---- developer ----
  devHub: () => {
    const d = developer(); const hub = d.hub || {};
    const seed = readJson(path.join(__dirname, 'data', 'hub-seed.json'), { games: [] });
    // Your marks: old hub.json (from before My projects) + what you set in My projects (wins).
    const marks = readJson(file('hub.json'), {});
    const TO_HUB = { 'needs-playtest': 'testing', ready: 'ready', building: 'building', idea: 'idea', 'on-hold': 'on-hold', released: 'released', scrapped: 'scrapped' };
    for (const p of projectStore().load().projects) {
      if (!p.history.length) continue; // never edited: keep what the PC and the notes say
      marks[p.id] = { ...(marks[p.id] || {}), ...(TO_HUB[p.stage] ? { status: TO_HUB[p.stage] } : {}), ...(p.nextStep ? { nextStep: p.nextStep } : {}), ...(p.needsWork ? { needsWork: p.needsWork } : {}) };
    }
    const r = gamehub.build({ seed, marks, siteDir: hub.siteDir, projects: hub.projects || [] });
    const dead = scrappedIds(); // scrapped in My projects = scrapped here too
    for (const g of r.games) if (dead.has(g.id)) { g.status = 'scrapped'; g.statusLabel = 'Scrapped'; g.statusSource = 'you'; }
    lastHub = r; return r;
  },
  devWeek: () => {
    const store = readJson(file('weekly.json'), {});
    const hub = weekHub();
    const r = weekly.current(store, hub, (developer().weekly || {}).focus, new Date(), hub.skip);
    writeJson(file('weekly.json'), store); return r;
  },
  devWeekSave: (k, week) => {
    const store = readJson(file('weekly.json'), {});
    if (!store.weeks || !store.weeks[k]) throw new Error('Unknown week');
    const clean = (list) => (Array.isArray(list) ? list : []).slice(0, 30).map((i) => ({ text: String(i.text || '').slice(0, 200), done: !!i.done, gameId: i.gameId || undefined })).filter((i) => i.text);
    store.weeks[k] = { ...store.weeks[k], goals: clean(week.goals).slice(0, 5), todos: clean(week.todos), confirmed: !!week.confirmed };
    writeJson(file('weekly.json'), store); return api.devWeek();
  },
  devWeekResuggest: (k) => {
    const store = readJson(file('weekly.json'), {});
    if (!store.weeks || !store.weeks[k]) throw new Error('Unknown week');
    const wh = weekHub();
    const s = weekly.suggest(wh, (developer().weekly || {}).focus, wh.skip);
    store.weeks[k] = { ...store.weeks[k], ...s, confirmed: false };
    writeJson(file('weekly.json'), store); return api.devWeek();
  },
  devOpenFolder: (folder) => {
    const known = (lastHub && lastHub.games.some((g) => g.folder === folder)) || (lastProjects && lastProjects.projects.some((p) => p.folders.includes(folder)));
    if (!known) throw new Error('Unknown folder');
    // Only ever open a FOLDER: shell.openPath on a file would run it (e.g. an .exe).
    let isDir = false; try { isDir = fs.statSync(folder).isDirectory(); } catch {}
    if (!isDir) throw new Error('Folder not found');
    return shell.openPath(folder);
  },
  // ---- My projects ----
  devProjects: () => projectsView(),
  devProjectSave: (id, patch) => { projectStore().update(id, patch); return projectsView(); },
  devProjectAdd: (o) => { const p = projectStore().add({ name: o.name, type: o.type || 'other', folders: o.folder ? [o.folder] : [] }); return { id: p.id, view: projectsView() }; },
  devProjectScrap: async (id, reason) => {
    const p = projectStore().load().projects.find((x) => x.id === id);
    if (!p) throw new Error('Project not found');
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Scrap it', 'Cancel'], defaultId: 1, cancelId: 1, message: `Scrap ${p.name}?`, detail: 'Are you sure? It will be hidden everywhere. No files are deleted.' });
    if (r.response !== 0) return null;
    projectStore().scrap(id, reason); send('state', state()); return projectsView();
  },
  // Only Zero brings a project back: a person must press "Bring back" and then say yes here.
  devProjectBringBack: async (id) => {
    const p = projectStore().load().projects.find((x) => x.id === id);
    if (!p) throw new Error('Project not found');
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Bring back', 'Cancel'], defaultId: 1, cancelId: 1, message: `Bring ${p.name} back?`, detail: 'It shows up in your lists again.' });
    if (r.response !== 0) return null;
    projectStore().bringBack(id); send('state', state()); return projectsView();
  },
  // Pick a folder for a project (replaces `old`, or adds one). The person picks it in a Windows folder box.
  devProjectPickFolder: async (id, old) => {
    const p = projectStore().load().projects.find((x) => x.id === id);
    if (!p) throw new Error('Project not found');
    if (old && !p.folders.includes(old)) throw new Error('Unknown folder');
    const pick = await dialog.showOpenDialog(win, { title: `Pick the folder of ${p.name}`, properties: ['openDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const dir = pick.filePaths[0];
    const folders = old ? p.folders.map((f) => (f === old ? dir : f)) : [...p.folders, dir];
    projectStore().update(id, { folders: [...new Set(folders)] });
    return projectsView();
  },
  devProjectIgnoreFolder: (dir) => { projectStore().ignoreFolder(dir); return projectsView(); },
  devProjectArchive: async (id, folder) => {
    const p = projectStore().load().projects.find((x) => x.id === id);
    if (!p || !p.folders.includes(folder)) throw new Error('Unknown folder');
    const def = process.platform === 'win32' ? 'E:\\Archive' : undefined;
    const pick = await dialog.showOpenDialog(win, { title: 'Pick the archive folder (the original folder is kept)', defaultPath: def, properties: ['openDirectory', 'createDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const zip = await projects.archiveFolder(folder, pick.filePaths[0], p.name);
    projectStore().log(id, `Archive zip made: ${zip}`);
    return zip;
  },
  devReviewChoice: (id, choice, reason) => {
    const weekKey = weekly.key(weekly.weekStart(new Date()));
    projectStore().review(id, choice, { reason, weekKey }); send('state', state()); return projectsView();
  },
  devStatusReport: () => projects.report(projectsView().projects),
  devSaveReport: async (kind) => {
    const rep = projects.report(projectsView().projects);
    const ext = kind === 'html' ? 'html' : 'md';
    const r = await dialog.showSaveDialog(win, { title: 'Save status report', defaultPath: `status-report-${rep.date}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (r.canceled || !r.filePath) return null;
    if (!path.isAbsolute(r.filePath)) throw new Error('Pick a file');
    writeFileAtomic(r.filePath, kind === 'html' ? rep.html : rep.markdown);
    return r.filePath;
  },
  devAddGame: (g) => { devChannel().upsertGame({ id: g.id, name: g.name, kind: g.kind, url: g.url, image: g.image || '', description: g.description || '' }); return refresh(); },
  devAddVersion: async (o) => { const r = await devChannel().addPcRelease({ gameId: o.gameId, buildDir: o.buildDir, version: o.version, notes: o.notes || '' }); await refresh(); return r; },
  devPickFolder: async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; },
  devPickFile: async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Friend game', extensions: ['zlsub'] }] }); return r.canceled ? null : r.filePaths[0]; },
  devToTesters: (id, v) => { devChannel().toTesters(id, v); return refresh(); },
  devRelease: async (id, v) => {
    // Release checklist: missing ticks do not block, but Zero must say "Release anyway".
    const ticks = (readJson(file('checklists.json'), {})[`${id}@${v}`]) || {};
    const missing = CHECK_ITEMS.filter((k) => !ticks[k]).map((k) => CHECK_LABELS[k]);
    if (missing.length) {
      const a = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Release anyway', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Some checks are not ticked. Release anyway?', detail: 'Not ticked:\n- ' + missing.join('\n- ') });
      if (a.response !== 0) return state();
    }
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Release to everyone', 'Cancel'], defaultId: 1, message: `Release ${id} ${v} to EVERYONE?`, detail: 'Players get it automatically within about 1 hour after you upload.' });
    if (r.response !== 0) return state();
    devChannel().release(id, v); return refresh();
  },
  devUnrelease: (id, v) => { devChannel().unrelease(id, v); return refresh(); },
  devGoBack: async (id) => {
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Go back', 'Cancel'], defaultId: 1, message: `Pull the newest version of ${id}? Players go back to the version before.` });
    if (r.response !== 0) return state();
    devChannel().goBack(id); return refresh();
  },
  devHide: (id, hidden) => { devChannel().setHidden(id, hidden); return refresh(); },
  devSetGameInfo: (id, o) => {
    devChannel().setGameInfo(id, { screenshots: o.screenshots, trailer: o.trailer, comingSoon: o.comingSoon, description: o.description, image: o.image });
    return refresh();
  },
  devSetTestNotes: (id, v, text) => { devChannel().setTestNotes(id, v, text); return refresh(); },
  devSaveChecklist: (id, v, ticks) => {
    const all = readJson(file('checklists.json'), {});
    all[`${id}@${v}`] = Object.fromEntries(CHECK_ITEMS.map((k) => [k, !!ticks[k]]));
    writeJson(file('checklists.json'), all);
    return all[`${id}@${v}`];
  },
  devDownloads: async (force) => {
    const d = developer();
    if (!stats) stats = new DownloadStats({ repo: (d.github && d.github.repo) || 'TheZerotje/zero-launcher-channel' });
    const c = await stats.counts(!!force);
    return { perGame: DownloadStats.perVersion(catalogue, c.byFile), at: new Date(c.at).toISOString(), error: c.error };
  },
  devDiscordPreview: (id, v) => {
    const g = catalogue && catalogue.games.find((x) => x.id === id);
    const r = g && (g.releases || []).find((x) => x.version === v);
    if (!r) throw new Error('No such version');
    if (!developer().discordWebhook) throw new Error('Put your Discord webhook address in developer.json (discordWebhook) first');
    return discord.releaseMessage(g, r);
  },
  devDiscordSend: async (text) => discord.post(developer().discordWebhook, text),
  devBackupKey: async () => {
    const d = developer();
    const pick = await dialog.showOpenDialog(win, { title: 'Pick a folder for the backup (a USB stick)', properties: ['openDirectory', 'createDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const r = keybackup.backupKey({ keyFile: d.privateKeyFile, toDir: pick.filePaths[0], forbidden: [d.channelDir, d.friendsDir, path.join(__dirname, '..')] });
    const s = readJson(file('settings.json'), {}); s.keyBackup = { at: r.at, remindAt: r.remindAt, folder: pick.filePaths[0] }; writeJson(file('settings.json'), s);
    send('state', state());
    return r;
  },
  devAddNews: (n) => { devChannel().addNews({ title: n.title, text: n.text || '', image: n.image || '' }); return refresh(); },
  devRemoveNews: (id) => { devChannel().removeNews(id); return refresh(); },
  devSetTester: (o) => { devChannel().setTester({ accountId: o.accountId, name: o.name, games: o.games || [] }); return refresh(); },
  devRemoveTester: (id) => { devChannel().removeTester(id); return refresh(); },
  devUpload: async () => {
    const d = developer();
    if (!d.github || !d.github.repo || !d.github.token) throw new Error('Set github.repo and github.token in developer.json first');
    const gh = new GitHubChannel(d.github);
    const sha = catalogueSha();
    const r = await gh.sync(d.channelDir, (text, p = {}) => send('progress', { kind: 'upload', text, done: p.done || 0, total: p.total || 0 }));
    writeJson(file('uploaded.json'), { catalogueSha: sha, at: new Date().toISOString() });
    send('state', state());
    return r;
  },
  devGodotProjects: () => godotProjects(),
  devGodotExport: async (gameId, version, notes) => {
    const d = developer();
    if (typeof gameId !== 'string' || typeof version !== 'string') throw new Error('Bad input');
    const proj = godotProjects().find((p) => p.id === gameId);
    if (!proj) throw new Error('No Godot project folder known for this game (developer.json hub.projects)');
    const g = catalogue && catalogue.games.find((x) => x.id === gameId && x.kind === 'pc');
    if (!g) throw new Error('Add this game as a PC game first');
    const ver = version.trim() || (proj.info && proj.info.version) || '';
    if (!ver) throw new Error('Type a version (example 0.20.0)');
    const say = (text) => send('progress', { kind: 'godot', gameId, text });
    const out = await godot.exportWindows({ godotPath: d.godotPath, projectDir: proj.path, gameName: proj.info ? proj.info.name : g.name, onLine: say });
    try {
      say('Packing the new version…');
      const rel = await devChannel().addPcRelease({ gameId, buildDir: out.buildDir, version: ver, notes: String(notes || '').slice(0, 300), exe: out.exe });
      say(`Done. ${g.name} ${ver} is added as Unreleased.`);
      await refresh();
      return rel;
    } finally {
      fs.rmSync(out.work, { recursive: true, force: true }); // our own temp folder only
    }
  },
  devWebsite: async () => { const d = developer(); return { url: d.website.url, up: await website.isUp(d.website.url) }; },
  devAutoStart: (on) => {
    if (typeof on === 'boolean') app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
    return app.getLoginItemSettings().openAtLogin;
  },
  devFriends: () => { const inbox = new FriendInbox(developer().friendsDir); return { friends: inbox.friends(), waiting: inbox.waiting() }; },
  devAddFriend: (o) => new FriendInbox(developer().friendsDir).addFriend({ friendId: o.friendId, name: o.name, publicKeyPem: o.publicKeyPem, games: o.games || [] }),
  devBlockFriend: (id, b) => new FriendInbox(developer().friendsDir).setBlocked(id, b),
  devImportSubmission: (f) => new FriendInbox(developer().friendsDir).importSubmission(f),
  devApprove: async (id) => { const r = await new FriendInbox(developer().friendsDir).approve(id, devChannel()); await refresh(); return r; },
  devReject: (id) => { new FriendInbox(developer().friendsDir).reject(id); return true; },
  devAiFolders: () => developer().aiFolders || [],
  devAiStart: (text, cwd) => {
    const allowed = (developer().aiFolders || []).map((f) => path.resolve(f.path));
    if (!allowed.includes(path.resolve(cwd))) throw new Error('That folder is not on your AI folder list');
    const job = ai.start(text, cwd, (line) => send('ai', { id: job.id, line }), (code) => send('ai', { id: job.id, end: code }));
    return job;
  },
  devAiStop: (id) => ai.stop(id),
  devAiHistory: () => ai.history(),
  devAiLog: (id) => ai.readLog(id),
  devAiOpenLog: (id) => shell.openPath(ai.logFile(id)),
  devAiRerun: (id) => {
    const old = ai.history(1000).find((j) => j.id === id);
    if (!old) throw new Error('Unknown job');
    return api.devAiStart(`${old.said || old.tool}, ${old.task}`, old.cwd);
  },
  devChatGPT: () => {
    const w = new BrowserWindow({ width: 1100, height: 850, title: 'ChatGPT', autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'persist:chatgpt' } });
    w.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https:\/\//.test(u)) shell.openExternal(u); return { action: 'deny' }; });
    w.loadURL('https://chatgpt.com/'); return true;
  },

  // ---- friend host ----
  friendMakeKeys: () => {
    const f = friendHost();
    if (!f) throw new Error('Not a friend host');
    const keyFile = file('friend-private.pem');
    if (!fs.existsSync(keyFile)) { const k = generateKeyPair(); writeFileAtomic(keyFile, k.privateKey, { mode: 0o600 }); writeFileAtomic(file('friend-public.pem'), k.publicKey); }
    return fs.readFileSync(file('friend-public.pem'), 'utf8');
  },
  friendPickFolder: async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; },
  friendSubmit: async (o) => {
    const f = friendHost();
    const out = await makeSubmission({ gameId: o.gameId, gameName: o.gameName, version: o.version, notes: o.notes || '', buildDir: o.buildDir, friendId: f.friendId, privateKeyPem: fs.readFileSync(file('friend-private.pem'), 'utf8'), outDir: path.join(DATA(), 'to-send') });
    shell.showItemInFolder(out); return out;
  },
};

// ---------------- IPC input checks ----------------
// Every IPC call has a check here. A call without a check is refused (safe default).
const none = (args) => { if (args.length) throw new Error('Bad input'); };
const noMore = (rest) => { if (rest.length) throw new Error('Bad input'); }; // no extra arguments
const gid = ([id, ...rest]) => { V.gameId(id); noMore(rest); };
const gidVer = ([id, v, ...rest]) => { V.gameId(id); V.version(v); noMore(rest); };
const AI_ID = /^\d{10,16}-\d{1,6}$/;
const SUB_ID = /^[a-z0-9][a-z0-9-]{1,40}--[a-z0-9][a-z0-9-]{1,40}--v?[0-9A-Za-z.-]{1,40}$/;
const pid = (x) => V.match(x, projects.ID_RE, 'project id');
const absPath = (x, what = 'folder') => { if (typeof x !== 'string' || x.length > 1000 || !path.isAbsolute(x) || x.includes('\0')) throw new Error('Bad input: ' + what); return x; };
const CHECKS = {
  reportsList: none, reportText: ([n, ...rest]) => { V.str(n, 'report', 80, { allowEmpty: false }); noMore(rest); }, reportShow: ([n, ...rest]) => { V.str(n, 'report', 80, { allowEmpty: false }); noMore(rest); },
  devProjects: none, devStatusReport: none,
  devProjectSave: ([id, patch, ...rest]) => {
    pid(id); V.obj(patch, 'project'); noMore(rest);
    const allowed = { name: 80, nextStep: 500, notes: 2000, repo: 200, needsWork: 200 };
    for (const [k, v] of Object.entries(patch)) {
      if (allowed[k]) V.str(v, k, allowed[k]);
      else if (k === 'type') V.oneOf(v, Object.keys(projects.TYPES), 'type');
      else if (k === 'stage') V.oneOf(v, Object.keys(projects.STAGES).filter((x) => x !== 'scrapped'), 'stage');
      else if (k === 'waitingOn') V.oneOf(v, Object.keys(projects.WAITING), 'waiting on');
      else if (k === 'priority') V.oneOf(v, [1, 2, 3], 'priority');
      else if (k === 'folders') V.list(v, 'folders', 10).forEach((f) => absPath(f));
      else throw new Error('Bad input: ' + k);
    }
  },
  devProjectAdd: ([o, ...rest]) => { V.obj(o); noMore(rest); V.str(o.name, 'name', 80, { allowEmpty: false }); if (o.type !== undefined) V.oneOf(o.type, Object.keys(projects.TYPES), 'type'); if (o.folder !== undefined) V.dir(o.folder); },
  devProjectScrap: ([id, reason, ...rest]) => { pid(id); V.str(reason, 'reason', 200, { allowEmpty: false }); noMore(rest); },
  devProjectBringBack: ([id, ...rest]) => { pid(id); noMore(rest); },
  devProjectPickFolder: ([id, old, ...rest]) => { pid(id); if (old !== undefined && old !== null) V.str(old, 'folder', 1000, { allowEmpty: false }); noMore(rest); }, // old must also be one of the project's folders (checked in the call)
  devProjectIgnoreFolder: ([dir, ...rest]) => { absPath(dir); noMore(rest); },
  devProjectArchive: ([id, folder, ...rest]) => { pid(id); absPath(folder); noMore(rest); },
  devReviewChoice: ([id, choice, reason, ...rest]) => { pid(id); V.oneOf(choice, ['keep', 'pause', 'scrap', 'skip'], 'choice'); V.optStr(reason, 'reason', 200); noMore(rest); },
  devSaveReport: ([kind, ...rest]) => { V.oneOf(kind, ['md', 'html'], 'report kind'); noMore(rest); },
  state: none, refresh: none, openArcade: none, devHub: none, devWeek: none, devPickFolder: none, devPickFile: none,
  devUpload: none, devGodotProjects: none, devWebsite: none, devFriends: none, devAiFolders: none, devAiHistory: none,
  devChatGPT: none, friendMakeKeys: none, friendPickFolder: none,
  install: gid, repair: gid, pause: gid, resume: gid, cancel: gid, uninstall: gid, play: gid, devGoBack: gid,
  devToTesters: gidVer, devRelease: gidVer, devUnrelease: gidVer,
  report: ([id, text]) => { V.gameId(id); V.str(text, 'report text', 2000, { allowEmpty: false }); },
  setSetting: ([k]) => V.str(k, 'setting', 40),
  makeAccount: ([name]) => V.str(name, 'name', 32, { allowEmpty: false }),
  copy: ([text]) => V.str(text, 'text', 20000),
  devWeekSave: ([k, week]) => { V.match(k, /^\d{4}-\d{2}-\d{2}$/, 'week'); V.obj(week, 'week'); },
  devWeekResuggest: ([k]) => V.match(k, /^\d{4}-\d{2}-\d{2}$/, 'week'),
  devOpenFolder: ([f]) => V.str(f, 'folder', 1000, { allowEmpty: false }),
  devAddGame: ([g]) => {
    V.obj(g, 'game'); V.gameId(g.id); V.str(g.name, 'name', 80, { allowEmpty: false }); V.oneOf(g.kind, ['pc', 'web'], 'type');
    V.url(g.url, 'web address', { optional: g.kind !== 'web' }); V.url(g.image, 'picture address', { httpsOnly: true });
    V.optStr(g.description, 'short text', 500);
  },
  devAddVersion: ([o]) => { V.obj(o); V.gameId(o.gameId); V.dir(o.buildDir, 'build folder'); V.version(o.version); V.optStr(o.notes, "what's new", 300); },
  devHide: ([id, hidden]) => { V.gameId(id); V.bool(hidden); },
  openTrailer: gid, makeShortcut: gid, moveGame: gid, crashPreview: gid, crashSend: gid, crashDismiss: gid,
  feedback: ([id, vote, text]) => { V.gameId(id); V.oneOf(vote, ['up', 'down'], 'vote'); V.optStr(text, 'text', 2000); },
  devSetTestNotes: ([id, v, text]) => { V.gameId(id); V.version(v); V.str(text, 'what to test', 600); },
  setLaunchArgs: ([id, text]) => { V.gameId(id); V.str(text, 'launch options', 300); },
  devSetGameInfo: ([id, o]) => {
    V.gameId(id); V.obj(o, 'game info');
    if (o.screenshots !== undefined) V.list(o.screenshots, 'screenshots', 12).forEach((u) => V.url(u, 'screenshot', { optional: false, httpsOnly: true }));
    if (o.trailer !== undefined) V.url(o.trailer, 'trailer', { httpsOnly: true });
    if (o.comingSoon !== undefined && o.comingSoon !== '') V.match(o.comingSoon, /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, 'coming soon date');
    if (o.description !== undefined) V.str(o.description, 'short text', 500);
    if (o.image !== undefined) V.url(o.image, 'picture address', { httpsOnly: true });
  },
  devSaveChecklist: ([id, v, ticks]) => { V.gameId(id); V.version(v); V.obj(ticks, 'ticks'); },
  devDownloads: ([force]) => { if (force !== undefined) V.bool(force); },
  devDiscordPreview: gidVer,
  devDiscordSend: ([text]) => V.str(text, 'message', 2000, { allowEmpty: false }),
  devBackupKey: none,
  devAddNews: ([n]) => { V.obj(n, 'news'); V.str(n.title, 'title', 80, { allowEmpty: false }); V.optStr(n.text, 'text', 600); V.url(n.image, 'picture address', { httpsOnly: true }); },
  devRemoveNews: ([id]) => V.match(id, /^n[0-9a-z]{4,24}$/, 'news id'),
  devSetTester: ([o]) => { V.obj(o); V.str(o.accountId, 'account ID', 20); V.optStr(o.name, 'name', 32); V.list(o.games || [], 'games').forEach(V.gameId); },
  devRemoveTester: ([id]) => V.str(id, 'account ID', 20),
  devGodotExport: ([id, v, notes]) => { V.gameId(id); V.str(v, 'version', 40); if (v.trim()) V.version(v); V.optStr(notes, "what's new", 300); },
  devAutoStart: ([on]) => { if (on !== undefined) V.bool(on); },
  devAddFriend: ([o]) => { V.obj(o); V.gameId(o.friendId); V.str(o.name, 'name', 40); V.str(o.publicKeyPem, 'public key', 2000, { allowEmpty: false }); V.list(o.games || [], 'games', 20).forEach(V.gameId); },
  devBlockFriend: ([id, b]) => { V.gameId(id); V.bool(b); },
  devImportSubmission: ([f]) => V.file(f, 'friend game file', '.zlsub'),
  devApprove: ([id]) => V.match(id, SUB_ID, 'waiting id'),
  devReject: ([id]) => V.match(id, SUB_ID, 'waiting id'),
  devAiStart: ([text, cwd]) => { V.str(text, 'task', 4000, { allowEmpty: false }); V.str(cwd, 'folder', 1000, { allowEmpty: false }); },
  devAiStop: ([id]) => V.match(id, AI_ID, 'job id'),
  devAiLog: ([id]) => V.match(id, AI_ID, 'job id'),
  devAiOpenLog: ([id]) => V.match(id, AI_ID, 'job id'),
  devAiRerun: ([id]) => V.match(id, AI_ID, 'job id'),
  friendSubmit: ([o]) => { V.obj(o); V.gameId(o.gameId); V.str(o.gameName, 'game name', 80); V.version(o.version); V.optStr(o.notes, "what's new", 300); V.dir(o.buildDir, 'build folder'); },
};

for (const [name, fn] of Object.entries(api)) {
  ipcMain.handle('zl:' + name, async (e, ...args) => {
    if (!win || e.senderFrame !== win.webContents.mainFrame) throw new Error('Not allowed');
    if (name.startsWith('dev') && !developer()) throw new Error('Developer only');
    if (name.startsWith('friend') && !friendHost()) throw new Error('Friend host only');
    if (!CHECKS[name]) throw new Error('Not allowed');
    CHECKS[name](args);
    return fn(...args);
  });
}

function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600, show: !hidden, title: 'Zero Launcher',
    backgroundColor: '#0d1017', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  if (MUTED) win.webContents.setAudioMuted(true);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html')); // Version 1 look only
  // Developer, or a player who picked "Start with Windows": closing the window keeps it small in the tray.
  win.on('close', (e) => { if ((developer() || settings().startWithWindows) && !app.isQuitting) { e.preventDefault(); win.hide(); } });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(developer() ? 'Zero Launcher (host)' : 'Zero Launcher');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Zero Launcher', click: () => { win.show(); win.focus(); } },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { win.show(); win.focus(); });
}

// Web games may NOT use camera, microphone, location, notifications, etc. Only full screen and mouse lock.
function lockDownSession(ses) {
  const ok = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ok.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ok.has(permission));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // A desktop shortcut starts the launcher with --play=<game>.
  const playFromArgs = (argv) => {
    const id = playArg(argv);
    if (!id || !catalogue) return;
    try { api.play(id); } catch (e) { send('toast', { kind: 'error', text: e.message }); }
  };
  app.on('second-instance', (_e, argv) => { if (win) { win.show(); win.focus(); } playFromArgs(argv); });
  app.whenReady().then(async () => {
    const { session } = require('electron');
    for (const part of ['persist:arcade', 'persist:chatgpt']) lockDownSession(session.fromPartition(part));
    const s = settings();
    installer = new Installer(s.installRoot || path.join(DATA(), 'library'));
    queue = new DownloadQueue(runInstall, () => send('state', state()));
    queue.onError = (id, e) => {
      const g = catalogue && catalogue.games.find((x) => x.id === id);
      const name = (g && g.name) || id;
      if (e.code === 'NO_SPACE') send('toast', { kind: 'error', name, text: 'Not enough free space. This game needs about {need} MB. You have {free} MB free.', vars: { need: Math.ceil(e.need / 1048576), free: Math.ceil(e.free / 1048576) } });
      else send('toast', { kind: 'error', name, text: e.message });
    };
    ai = new AiHelper(path.join(DATA(), 'ai-runs'));
    createWindow(process.argv.includes('--hidden'));
    speedLimitMB = [0, 1, 2, 5].includes(s.speedLimit) ? s.speedLimit : 0;
    if (developer() || s.startWithWindows) {
      createTray(); // The website is never started by the launcher (status only).
    }
    await refresh();
    setInterval(refresh, CHECK_EVERY_MS);
    checkWeekNotice();
    setInterval(checkWeekNotice, 60 * 1000);
    checkProjectReminder();
    setInterval(checkProjectReminder, 60 * 60 * 1000);
    playFromArgs(process.argv);
    checkKeyBackup();
  });
  app.on('window-all-closed', () => { if (!developer() && !settings().startWithWindows) app.quit(); });
}
