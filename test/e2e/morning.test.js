'use strict';
// Morning extras: My reports page, welcome screen, Continue playing. Muted, demo data only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeDemo, launch, goto, shot, close } = require('./helpers');

const tryCall = (win, name, ...args) => win.evaluate(([n, a]) => window.zl.call(n, ...a).then(() => 'ok', (e) => e.message), [name, args]);

test('My reports: the report you made is there; show, copy; other files can never be read', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.user);
  try {
    await goto(win, 'My reports');
    await win.locator('.empty', { hasText: 'No reports yet' }).waitFor();
    await goto(win, 'Store');
    await win.locator('.card b', { hasText: 'Railrove' }).first().click();
    await win.fill('#rep-text', 'The train fell off the map');
    await win.locator('button', { hasText: 'Make report' }).click();
    await win.locator('.toast', { hasText: 'Report saved' }).waitFor();
    await goto(win, 'My reports');
    const r = win.locator('.report-row').first();
    await r.waitFor();
    assert.match(await r.textContent(), /Problem report.*Railrove/);
    await r.locator('button', { hasText: 'Show' }).first().click();
    await win.locator('.report-text', { hasText: 'The train fell off the map' }).waitFor();
    await r.locator('button', { hasText: 'Copy' }).click();
    assert.match(await app.evaluate(({ clipboard }) => clipboard.readText()), /The train fell off the map/);
    await shot(win, 'player-my-reports');
    // hack: only report files, only in the reports folder
    fs.writeFileSync(path.join(demo.user, 'secret.txt'), 'secret');
    for (const bad of ['../secret.txt', '..\\secret.txt', '/etc/passwd', 'secret.txt', 'x-1234567890.txt/../../secret.txt', '']) {
      assert.match(await tryCall(win, 'reportText', bad), /Bad input|not found/, bad);
    }
    assert.match(await tryCall(win, 'reportShow', '../../x'), /Bad input/);
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('welcome box: only on the first start for players, gone after OK (also after a restart), never for Zero', async () => {
  const demo = makeDemo();
  let { app, win, errors } = await launch(demo.user);
  try {
    const box = win.locator('.welcome');
    await box.waitFor();
    assert.match(await box.textContent(), /Pick a game below.*big button.*update by themselves/);
    await shot(win, 'player-welcome');
    await box.locator('button', { hasText: "OK, let's play!" }).click();
    await win.waitForFunction(() => !document.querySelector('.welcome'));
    assert.deepEqual(errors, []);
  } finally { await close(app); }
  ({ app, win } = await launch(demo.user));
  try {
    await win.locator('.card').first().waitFor();
    assert.equal(await win.locator('.welcome').count(), 0, 'not again after a restart');
  } finally { await close(app); }
  ({ app, win } = await launch(demo.dev));
  try {
    await goto(win, 'Store');
    await win.locator('.card').first().waitFor();
    assert.equal(await win.locator('.welcome').count(), 0, 'never for the developer');
  } finally { await close(app); }
});

test('Continue playing: the games you played last are on top of the Store', async () => {
  const demo = makeDemo();
  const { app, win } = await launch(demo.user);
  try {
    await win.locator('.card').first().waitFor();
    assert.equal(await win.locator('h3.s-again').count(), 0, 'nothing played yet: no row');
    const rr = win.locator('.card', { hasText: 'Railrove' }).first();
    await rr.locator('button', { hasText: 'Install' }).click();
    await rr.locator('button', { hasText: 'Play' }).waitFor({ timeout: 20000 });
    const inst = JSON.parse(fs.readFileSync(path.join(demo.user, 'library', 'installed.json'), 'utf8')).railrove;
    if (process.platform !== 'win32') fs.chmodSync(path.join(inst.dir, inst.exe), 0o755);
    await rr.locator('button', { hasText: 'Play' }).click();
    await win.locator('h3.s-again').waitFor({ timeout: 10000 });
    const first = win.locator('h3.s-again + .grid .card').first();
    assert.match(await first.textContent(), /Railrove/);
    await win.locator('button:not([disabled])', { hasText: 'Play' }).first().waitFor({ timeout: 10000 });
    await shot(win, 'player-continue-playing');
    // play time + badge on the game page (kept on this PC only)
    await win.locator('h3.s-again + .grid .card b').first().click();
    const ptBox = win.locator('.panel.playtime');
    await ptBox.waitFor();
    assert.match(await ptBox.textContent(), /Your play time.*(less than 1 min|\d+ min).*played once/);
    await ptBox.locator('.badge-chip', { hasText: 'First play' }).waitFor();
    const saved = JSON.parse(fs.readFileSync(path.join(demo.user, 'playtime.json'), 'utf8'));
    assert.equal(saved.railrove.plays, 1);
    await shot(win, 'player-play-time');
  } finally { await close(app); }
});

test('tester feedback: stars + one line -> code; Zero pastes it in Testers and sees all feedback in one list', async () => {
  const demo = makeDemo();
  let { app, win, errors } = await launch(demo.player);
  let report;
  try {
    await win.locator('.card b', { hasText: 'Railrove' }).first().click();
    const box = win.locator('.panel.feedback');
    await box.waitFor();
    await box.locator('button', { hasText: 'Send feedback' }).click();
    await win.locator('.toast', { hasText: 'Press a star first' }).waitFor();
    await box.locator('.star[data-v="3"]').click();
    assert.equal(await box.locator('.star.on').count(), 3, 'stars 1-3 light up');
    assert.equal(await win.locator('#fb-text').getAttribute('maxlength'), '200');
    await win.fill('#fb-text', 'Night sky is too dark');
    await box.locator('button', { hasText: 'Send feedback' }).click();
    await win.locator('.toast', { hasText: 'Feedback saved' }).waitFor();
    report = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.match(report, /★★★☆☆ \(3 of 5\)\nNight sky is too dark[\s\S]*ZLFB1:/);
    await shot(win, 'tester-feedback-stars');
    // hack: bad stars, long text, extra args
    for (const args of [[0, ''], [6, ''], ['5', ''], [5, 'x'.repeat(201)], [5, '', 'extra']]) {
      assert.match(await tryCall(win, 'feedback', 'railrove', ...args), /Bad input/, JSON.stringify(args));
    }
    // a tester can not use Zero's list
    assert.match(await tryCall(win, 'devFeedbackAdd', report), /Developer only|Not allowed/);
    assert.match(await tryCall(win, 'devFeedback'), /Developer only|Not allowed/);
    assert.deepEqual(errors, []);
  } finally { await close(app); }
  ({ app, win, errors } = await launch(demo.dev));
  try {
    await goto(win, 'Testers');
    const list = win.locator('.panel.fb-list');
    await list.locator('.empty', { hasText: 'No feedback yet' }).waitFor();
    await win.fill('#fb-paste', 'hello, nothing here');
    await list.locator('button', { hasText: 'Add feedback' }).click();
    await win.locator('.toast', { hasText: 'No feedback code found' }).waitFor();
    await win.fill('#fb-paste', `Hi Zero, here you go:\n${report}`);
    await list.locator('button', { hasText: 'Add feedback' }).click();
    await win.locator('.toast', { hasText: 'Added 1 feedback' }).waitFor();
    const grp = win.locator('.fb-group').first();
    await grp.waitFor();
    assert.match(await grp.textContent(), /Railrove v0\.20\.0.*★ 3 of 5.*1 feedback.*Night sky is too dark/);
    await win.fill('#fb-paste', report);
    await list.locator('button', { hasText: 'Add feedback' }).click();
    await win.locator('.toast', { hasText: 'Already in the list' }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(path.join(demo.dev, 'feedback.json'), 'utf8')).length, 1);
    await shot(win, 'dev-tester-feedback');
    await grp.locator('button', { hasText: 'Remove' }).click();
    await list.locator('.empty', { hasText: 'No feedback yet' }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('launcher log: things are written down on this PC; Copy launcher log; no secrets, no input text', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.user);
  try {
    await win.locator('.card').first().waitFor();
    await tryCall(win, 'reportText', '../secret-words-here');
    await tryCall(win, 'devProjects');
    await goto(win, 'My reports');
    const box = win.locator('.panel.launcher-log');
    await box.locator('button', { hasText: 'Copy launcher log' }).click();
    await win.locator('.toast', { hasText: 'Copied' }).waitFor();
    const text = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.match(text, /INFO  start .* as user/);
    assert.match(text, /WARN  reportText: Bad input/);
    assert.match(text, /WARN  devProjects: Developer only/);
    assert.doesNotMatch(text, /secret-words-here/, 'what you typed is never written down');
    assert.ok(fs.existsSync(path.join(demo.user, 'logs', 'launcher.log')));
    await shot(win, 'player-launcher-log');
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('back up my launcher data: save, change things, load it back (only after yes); not-a-backup is refused', async () => {
  const { mockDialogs } = require('./helpers');
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.user);
  const zip = path.join(demo.dir, 'my-backup.zip');
  try {
    await mockDialogs(app);
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, zip);
    fs.writeFileSync(path.join(demo.user, 'playtime.json'), JSON.stringify({ railrove: { ms: 3600000, plays: 7, days: [] } }));
    await goto(win, 'Settings');
    await win.locator('#set-size').selectOption('big');
    await win.waitForTimeout(200);
    const box = win.locator('.panel.backup');
    await box.locator('button', { hasText: 'Save a backup' }).click();
    await win.locator('.toast', { hasText: 'Backup saved' }).waitFor();
    assert.ok(fs.existsSync(zip));
    await shot(win, 'player-backup');
    // change things, then load the backup: Cancel first -> nothing changes
    await win.locator('#set-size').selectOption('bigger');
    fs.writeFileSync(path.join(demo.user, 'playtime.json'), '{}');
    await mockDialogs(app, { file: zip });
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await box.locator('button', { hasText: 'Load a backup' }).click();
    await win.waitForTimeout(500);
    assert.equal(fs.readFileSync(path.join(demo.user, 'playtime.json'), 'utf8'), '{}', 'Cancel keeps everything');
    await mockDialogs(app, { file: zip });
    await win.locator('.panel.backup button', { hasText: 'Load a backup' }).click();
    await win.locator('.toast', { hasText: 'Backup loaded' }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(path.join(demo.user, 'playtime.json'), 'utf8')).railrove.plays, 7);
    assert.equal(JSON.parse(fs.readFileSync(path.join(demo.user, 'settings.json'), 'utf8')).textSize, 'big');
    assert.equal(await win.locator('#set-size').inputValue(), 'big', 'the page shows the loaded settings');
    assert.ok(fs.readdirSync(path.join(demo.user, 'backups')).some((f) => f.startsWith('before-load-')), 'old data kept just in case');
    // a zip that is not a backup
    const other = path.join(demo.dir, 'other.zip');
    await require('../../core/zip').packFolder(path.join(demo.user, 'backups'), other);
    await mockDialogs(app, { file: other });
    await win.locator('.panel.backup button', { hasText: 'Load a backup' }).click();
    await win.locator('.toast', { hasText: 'not a Zero Launcher backup' }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('launcher update: Zero adds the setup, only Zero sees it first; after Send to players a player gets one big button; checked, then a yes', async () => {
  const { mockDialogs } = require('./helpers');
  const demo = makeDemo();
  const exe = path.join(demo.dir, 'ZeroLauncherSetup-9.9.9.exe'); fs.writeFileSync(exe, 'MZ fake launcher setup');
  let { app, win, errors } = await launch(demo.dev);
  try {
    await mockDialogs(app, { file: exe });
    await goto(win, 'Publish');
    const panel = win.locator('.panel.launcher-channel');
    await panel.locator('button', { hasText: 'Add launcher setup' }).click();
    await win.locator('.toast', { hasText: 'Launcher added' }).waitFor();
    assert.match(await panel.textContent(), /In your channel: 9\.9\.9 \(not sent to players yet\)/);
    await shot(win, 'dev-launcher-update');
    await goto(win, 'Store');
    assert.match(await win.locator('.launcher-update').textContent(), /version 9\.9\.9.*Only you see this/);
    assert.deepEqual(errors, []);
  } finally { await close(app); }
  // a player does not see it yet
  ({ app, win } = await launch(demo.user));
  try {
    await win.locator('.card').first().waitFor();
    assert.equal(await win.locator('.launcher-update').count(), 0, 'not before Send to players');
    assert.match(await tryCall(win, 'launcherUpdate'), /No new launcher/);
    for (const n of ['devLauncherAdd', 'devLauncherRelease']) assert.match(await tryCall(win, n), /Developer only/, n);
    assert.match(await tryCall(win, 'launcherUpdate', 'C:/evil.exe'), /Bad input/);
  } finally { await close(app); }
  ({ app, win } = await launch(demo.dev));
  try {
    await mockDialogs(app);
    await goto(win, 'Publish');
    await win.locator('.panel.launcher-channel button', { hasText: 'Send to players' }).click();
    await win.locator('.panel.launcher-channel', { hasText: '9.9.9 (sent to players)' }).waitFor();
  } finally { await close(app); }
  ({ app, win, errors } = await launch(demo.user));
  try {
    await app.evaluate(({ shell, app: a }) => { global.__opened = []; shell.openPath = async (p) => { global.__opened.push(p); return ''; }; a.quit = () => { global.__quit = true; }; });
    const banner = win.locator('.launcher-update');
    await banner.waitFor();
    assert.match(await banner.textContent(), /A new Zero Launcher is ready: version 9\.9\.9/);
    assert.doesNotMatch(await banner.textContent(), /Only you see this/);
    await shot(win, 'player-launcher-update');
    // "Later": nothing is started
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await banner.locator('button', { hasText: 'Update the launcher' }).click();
    await win.locator('.launcher-update button', { hasText: 'Update the launcher' }).waitFor();
    assert.deepEqual(await app.evaluate(() => global.__opened), []);
    // someone swaps the file in the channel: refused, never started
    const chFile = path.join(demo.dir, 'channel', 'packages', 'launcher', 'ZeroLauncherSetup-9.9.9.exe');
    fs.writeFileSync(chFile, 'MZ evil'); fs.rmSync(path.join(demo.user, 'updates'), { recursive: true, force: true });
    await mockDialogs(app);
    await win.locator('.launcher-update button', { hasText: 'Update the launcher' }).click();
    await win.locator('.toast', { hasText: 'check failed' }).waitFor();
    assert.deepEqual(await app.evaluate(() => global.__opened), []);
    // the real file again: checked, yes -> the setup starts, the launcher closes
    fs.writeFileSync(chFile, 'MZ fake launcher setup');
    await win.locator('.launcher-update button', { hasText: 'Update the launcher' }).click();
    await app.evaluate(() => new Promise((r) => { const t = setInterval(() => { if (global.__quit) { clearInterval(t); r(); } }, 50); }));
    const opened = await app.evaluate(() => global.__opened);
    assert.equal(opened.length, 1); assert.match(opened[0], /updates[\\/]ZeroLauncherSetup-9\.9\.9\.exe$/);
    assert.match(fs.readFileSync(path.join(demo.user, 'logs', 'launcher.log'), 'utf8'), /launcher 9\.9\.9 downloaded and checked/);
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});
