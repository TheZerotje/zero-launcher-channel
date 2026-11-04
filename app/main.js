'use strict';
// Zero Launcher - Electron main process.
// Modes: USER (default), TESTER (same app, account ID on Zero's tester list),
// DEVELOPER (developer.json present on Zero's PC), FRIEND HOST (friend.json present).
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadChannel, playerView, currentRelease } = require('../core/catalogue');
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

const DEFAULTS = {
  siteUrl: 'https://zero-arcade.tail5afd52.ts.net:8443/',
  channelUrl: 'https://github.com/TheZerotje/zero-launcher-channel/releases/download/channel',
  autoUpdate: true,
};

if (process.env.ZL_USER_DATA) app.setPath('userData', process.env.ZL_USER_DATA);
const DATA = () => app.getPath('userData');
const file = (n) => path.join(DATA(), n);
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };

let win = null, tray = null, installer = null, ai = null, lastHub = null;
let catalogue = null, catalogueError = null, lastCheck = null;
const jobs = new Map(); // gameId -> { stage, done, total, signal }
const MUTED = !!process.env.ZL_MUTE;

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

async function refresh() {
  try {
    catalogue = await loadChannel(channelSource(), publicKey());
    catalogueError = null;
  } catch (e) {
    catalogueError = e.code === 'BAD_SIGNATURE' ? 'The game list failed the safety check, so it was not used.' : 'Could not load the game list. Are you online?';
    console.error('[catalogue]', e.message);
  }
  lastCheck = new Date().toISOString();
  send('state', state());
  if (catalogue && settings().autoUpdate) autoUpdate();
  return state();
}

function state() {
  const v = viewer();
  const view = catalogue ? playerView(catalogue, v) : { games: [] };
  const inst = installer.installed();
  const updates = catalogue ? findUpdates(catalogue, inst, v).map((u) => u.game.id) : [];
  const d = developer();
  return {
    mode: mode(), viewer: v, siteUrl: d && d.website ? d.website.url : settings().siteUrl,
    settings: { ...settings() }, account: account() ? { name: account().name, id: account().id } : null,
    friendHost: friendHost() ? { friendId: friendHost().friendId, name: friendHost().name } : null,
    games: view.games.map((g) => ({
      id: g.id, name: g.name, kind: g.kind, url: g.url, description: g.description, image: g.image, owner: g.owner,
      phoneFriendly: g.phoneFriendly, hidden: g.hidden,
      current: currentRelease(g, v), releases: d ? g.releases : undefined,
      installed: inst[g.id] || null, updateReady: updates.includes(g.id),
      running: installer.isRunning(g.id), job: jobs.get(g.id) ? { ...jobs.get(g.id), signal: undefined } : null,
    })),
    testers: d && catalogue ? catalogue.testers || [] : undefined,
    error: catalogueError, lastCheck, muted: MUTED,
  };
}

async function install(gameId) {
  if (jobs.has(gameId)) return;
  const g = catalogue && catalogue.games.find((x) => x.id === gameId);
  if (!g) throw new Error('Game not found');
  const rel = currentRelease(g, viewer());
  if (!rel) throw new Error('No version available for you yet');
  const job = { stage: 'download', done: 0, total: rel.file.size, signal: { cancelled: false }, version: rel.version };
  jobs.set(gameId, job);
  send('state', state());
  let last = 0;
  try {
    await installer.install(channelSource(), g, rel, {
      signal: job.signal,
      onProgress: (p) => {
        Object.assign(job, p);
        if (Date.now() - last > 250 || p.stage !== 'download') { last = Date.now(); send('state', state()); }
      },
    });
    jobs.delete(gameId);
  } catch (e) {
    jobs.delete(gameId);
    if (e.code !== 'PAUSED') send('toast', { kind: 'error', text: `${g.name}: ${e.message}` });
  }
  send('state', state());
}

function autoUpdate() {
  for (const u of findUpdates(catalogue, installer.installed(), viewer())) {
    if (!installer.isRunning(u.game.id) && !jobs.has(u.game.id)) install(u.game.id);
  }
}

function openWebGame(url, title) {
  const w = new BrowserWindow({
    width: 1280, height: 800, title: title || 'Zero\'s Arcade', backgroundColor: '#0d1017', autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'persist:arcade' },
  });
  if (MUTED) w.webContents.setAudioMuted(true);
  const origin = new URL(url).origin;
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
  pause: (id) => { const j = jobs.get(id); if (j) j.signal.cancelled = true; return true; },
  uninstall: async (id) => {
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Uninstall', 'Cancel'], defaultId: 1, message: 'Uninstall this game?' });
    if (r.response !== 0) return false;
    installer.uninstall(id); send('state', state()); return true;
  },
  play: (id) => {
    const g = catalogue && catalogue.games.find((x) => x.id === id);
    if (g && g.kind === 'web') { openWebGame(g.url, g.name); return true; }
    installer.play(id, () => { send('state', state()); if (catalogue && settings().autoUpdate) autoUpdate(); });
    send('state', state()); return true;
  },
  openArcade: () => { openWebGame(state().siteUrl); return true; },
  setSetting: (k, v) => {
    if (!['autoUpdate', 'installRoot'].includes(k)) throw new Error('Not allowed');
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
    const r = gamehub.build({ seed, marks: readJson(file('hub.json'), {}), siteDir: hub.siteDir, projects: hub.projects || [] });
    lastHub = r; return r;
  },
  devHubMark: (id, mark) => {
    const marks = readJson(file('hub.json'), {});
    const m = { ...(marks[id] || {}) };
    for (const k of ['status', 'nextStep', 'note', 'needsWork']) if (k in mark) { if (mark[k] === '' || mark[k] === null || mark[k] === false) delete m[k]; else m[k] = String(mark[k]).slice(0, 300); }
    m.updatedAt = new Date().toISOString();
    marks[id] = m; writeJson(file('hub.json'), marks); return api.devHub();
  },
  devWeek: () => {
    const store = readJson(file('weekly.json'), {});
    const hub = lastHub || api.devHub();
    const r = weekly.current(store, hub, (developer().weekly || {}).focus);
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
    const s = weekly.suggest(api.devHub(), (developer().weekly || {}).focus);
    store.weeks[k] = { ...store.weeks[k], ...s, confirmed: false };
    writeJson(file('weekly.json'), store); return api.devWeek();
  },
  devOpenFolder: (folder) => {
    if (!lastHub || !lastHub.games.some((g) => g.folder === folder)) throw new Error('Unknown folder');
    return shell.openPath(folder);
  },
  devAddGame: (g) => { devChannel().upsertGame(g); return refresh(); },
  devAddVersion: async (o) => { const r = await devChannel().addPcRelease(o); await refresh(); return r; },
  devPickFolder: async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] }); return r.canceled ? null : r.filePaths[0]; },
  devPickFile: async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Friend game', extensions: ['zlsub'] }] }); return r.canceled ? null : r.filePaths[0]; },
  devToTesters: (id, v) => { devChannel().toTesters(id, v); return refresh(); },
  devRelease: async (id, v) => {
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
  devSetTester: (o) => { devChannel().setTester(o); return refresh(); },
  devRemoveTester: (id) => { devChannel().removeTester(id); return refresh(); },
  devUpload: async () => {
    const d = developer();
    if (!d.github || !d.github.repo || !d.github.token) throw new Error('Set github.repo and github.token in developer.json first');
    const gh = new GitHubChannel(d.github);
    return gh.sync(d.channelDir, (t) => send('toast', { kind: 'info', text: t }));
  },
  devWebsite: async () => { const d = developer(); return { url: d.website.url, up: await website.isUp(d.website.url) }; },
  devAutoStart: (on) => {
    if (typeof on === 'boolean') app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
    return app.getLoginItemSettings().openAtLogin;
  },
  devFriends: () => { const inbox = new FriendInbox(developer().friendsDir); return { friends: inbox.friends(), waiting: inbox.waiting() }; },
  devAddFriend: (o) => new FriendInbox(developer().friendsDir).addFriend(o),
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
  devChatGPT: () => {
    const w = new BrowserWindow({ width: 1100, height: 850, title: 'ChatGPT', autoHideMenuBar: true, webPreferences: { sandbox: true, partition: 'persist:chatgpt' } });
    w.loadURL('https://chatgpt.com/'); return true;
  },

  // ---- friend host ----
  friendMakeKeys: () => {
    const f = friendHost();
    if (!f) throw new Error('Not a friend host');
    const keyFile = file('friend-private.pem');
    if (!fs.existsSync(keyFile)) { const k = generateKeyPair(); fs.writeFileSync(keyFile, k.privateKey); fs.writeFileSync(file('friend-public.pem'), k.publicKey); }
    return fs.readFileSync(file('friend-public.pem'), 'utf8');
  },
  friendSubmit: async (o) => {
    const f = friendHost();
    const out = await makeSubmission({ ...o, friendId: f.friendId, privateKeyPem: fs.readFileSync(file('friend-private.pem'), 'utf8'), outDir: path.join(DATA(), 'to-send') });
    shell.showItemInFolder(out); return out;
  },
};

for (const [name, fn] of Object.entries(api)) {
  ipcMain.handle('zl:' + name, async (e, ...args) => {
    if (e.senderFrame !== win.webContents.mainFrame) throw new Error('Not allowed');
    if (name.startsWith('dev') && !developer()) throw new Error('Developer only');
    if (name.startsWith('friend') && !friendHost()) throw new Error('Friend host only');
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
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html')); // Version 1 look only
  win.on('close', (e) => { if (developer() && !app.isQuitting) { e.preventDefault(); win.hide(); } });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Zero Launcher (host)');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Zero Launcher', click: () => { win.show(); win.focus(); } },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { win.show(); win.focus(); });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    const s = settings();
    installer = new Installer(s.installRoot || path.join(DATA(), 'library'));
    ai = new AiHelper(path.join(DATA(), 'ai-runs'));
    createWindow(process.argv.includes('--hidden'));
    if (developer()) {
      createTray(); // The website is never started by the launcher (status only).
    }
    await refresh();
    setInterval(refresh, CHECK_EVERY_MS);
  });
  app.on('window-all-closed', () => { if (!developer()) app.quit(); });
}
