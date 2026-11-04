'use strict';
// End-to-end tests of the real app. Each test uses throwaway demo profiles (tools/make-demo.js)
// with a LOCAL demo channel in the temp folder. Nothing goes to GitHub or to real players.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeDemo, launch, mockDialogs, goto, shot, close } = require('./helpers');
const { Channel } = require('../../core/publisher');

const readCat = (demo) => JSON.parse(fs.readFileSync(path.join(demo.channel, 'catalogue.json'), 'utf8'));
const demoChannel = (demo) => new Channel(demo.channel, fs.readFileSync(path.join(demo.dir, 'zero-private.pem'), 'utf8'));
const card = (win, name) => win.locator('.card', { hasText: name }).first();
// The fake game is a tiny shell script. Zip files do not keep the "may run" flag, so set it here.
function makeRunnable(profile, id) {
  const inst = JSON.parse(fs.readFileSync(path.join(profile, 'library', 'installed.json'), 'utf8'))[id];
  if (process.platform !== 'win32') fs.chmodSync(path.join(inst.dir, inst.exe), 0o755);
}

test('player: install, play, update arrives and installs, uninstall', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.user);
  try {
    await mockDialogs(app);
    const rr = card(win, 'Railrove');
    await rr.locator('button', { hasText: 'Install' }).click();
    await rr.locator('button', { hasText: 'Play' }).waitFor({ timeout: 20000 });
    assert.match(await rr.textContent(), /v0\.19\.12\.0/);
    await shot(win, 'player-installed');

    makeRunnable(demo.user, 'railrove');
    await rr.locator('button', { hasText: 'Play' }).click();
    await rr.locator('button', { hasText: 'Playing' }).waitFor({ timeout: 5000 });
    await rr.locator('button:not([disabled])', { hasText: 'Play' }).waitFor({ timeout: 10000 }); // game closed

    // Zero releases a new version in the (local demo) channel. Player checks for updates.
    const ch = demoChannel(demo);
    await ch.addPcRelease({ gameId: 'railrove', buildDir: path.join(demo.dir, 'builds', 'rr19'), version: '0.19.13.0', notes: 'Fix' });
    ch.release('railrove', '0.19.13.0');
    await win.locator('#refreshBtn').click();
    await win.waitForFunction(() => /v0\.19\.13\.0/.test(document.querySelector('.card').textContent), null, { timeout: 20000 });
    await rr.locator('button', { hasText: 'Play' }).waitFor({ timeout: 20000 });
    const installed = JSON.parse(fs.readFileSync(path.join(demo.user, 'library', 'installed.json'), 'utf8'));
    assert.equal(installed.railrove.version, '0.19.13.0');
    assert.ok(installed.railrove.lastPlayed, 'last played is saved');
    const notices = await app.evaluate(() => global.zlNotices);
    assert.ok(notices.some((n) => n.title === 'Update done' && /0\.19\.13\.0/.test(n.body)), 'update message shown');

    // Uninstall lives on the game page.
    await rr.locator('b', { hasText: 'Railrove' }).click();
    await win.locator('h1', { hasText: 'Railrove' }).waitFor();
    await shot(win, 'player-game-page');
    await win.locator('button', { hasText: 'Uninstall' }).click();
    await win.locator('button', { hasText: 'Install' }).first().waitFor({ timeout: 10000 });
    assert.ok(!fs.existsSync(path.join(demo.user, 'library', 'games', 'railrove')));
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('tester sees only the test versions Zero ticked; normal player does not', async () => {
  const demo = makeDemo();
  let { app, win } = await launch(demo.player);
  try {
    assert.equal(await win.locator('#modeTag').textContent(), 'Tester');
    const rr = card(win, 'Railrove');
    await rr.waitFor();
    assert.match(await rr.textContent(), /TEST VERSION/);
    assert.match(await rr.textContent(), /v0\.20\.0/);
    assert.equal(await win.locator('.card', { hasText: 'Marchlands' }).count(), 0); // only unreleased: hidden
    await shot(win, 'tester-store');
  } finally { await close(app); }
  ({ app, win } = await launch(demo.user));
  try {
    const rr = card(win, 'Railrove');
    await rr.waitFor();
    assert.doesNotMatch(await rr.textContent(), /TEST VERSION/);
    assert.match(await rr.textContent(), /v0\.19\.12\.0/);
    assert.equal(await win.locator('.card', { hasText: 'Marchlands' }).count(), 0);
  } finally { await close(app); }
});

test('developer: add version, send to testers, release (confirm mocked), go back', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.dev);
  try {
    await mockDialogs(app, { folder: path.join(demo.dir, 'builds', 'rr20') });
    await goto(win, 'Publish');
    await win.fill('#v-railrove', '0.21.0');
    await win.fill('#n-railrove', 'New bridge');
    const panel = win.locator('.panel', { has: win.locator('#v-railrove') });
    await panel.locator('button', { hasText: 'Pick build folder' }).click();
    const row = () => win.locator('tr', { hasText: 'v0.21.0' });
    await row().locator('text=unreleased').waitFor({ timeout: 20000 });
    await row().locator('button', { hasText: 'Send to testers' }).click();
    await row().locator('text=testing').waitFor();
    await row().locator('button', { hasText: 'Release to everyone' }).click();
    await win.locator('.modal', { hasText: 'Before you release' }).waitFor(); // release checklist
    await win.locator('.modal button', { hasText: 'Release to everyone' }).click();
    await row().locator('text=released').waitFor();
    let r = readCat(demo).games.find((g) => g.id === 'railrove').releases.find((x) => x.version === '0.21.0');
    assert.equal(r.state, 'released');
    await shot(win, 'dev-publish-released');
    await panel.locator('button', { hasText: 'Go back' }).click();
    await row().locator('text=pulled').waitFor();
    r = readCat(demo).games.find((g) => g.id === 'railrove').releases.find((x) => x.version === '0.21.0');
    assert.equal(r.state, 'pulled');
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('release needs the confirm box: Cancel keeps it unreleased', async () => {
  const demo = makeDemo();
  const { app, win } = await launch(demo.dev);
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    await goto(win, 'Publish');
    const row = win.locator('tr', { hasText: 'v0.4.4.0' });
    await row.locator('button', { hasText: 'Release to everyone' }).click();
    await win.locator('.modal button', { hasText: 'Release to everyone' }).click();
    await win.waitForTimeout(500);
    const r = readCat(demo).games.find((g) => g.id === 'marchlands').releases[0];
    assert.equal(r.state, 'unreleased');
  } finally { await close(app); }
});

test('friend file: approve makes it unreleased (not released)', async () => {
  const demo = makeDemo();
  const { app, win } = await launch(demo.dev);
  try {
    await goto(win, 'Friend games');
    const row = win.locator('tr', { hasText: 'Sky Rally' });
    await row.waitFor();
    await shot(win, 'dev-friend-waiting');
    await row.locator('button', { hasText: 'Approve' }).click();
    await win.locator('text=Nothing waiting.').waitFor({ timeout: 10000 });
    const g = readCat(demo).games.find((x) => x.id === 'sky-rally');
    assert.equal(g.releases[0].state, 'unreleased');
    await goto(win, 'Publish');
    await win.locator('.panel', { hasText: 'Sky Rally' }).locator('text=unreleased').first().waitFor();
  } finally { await close(app); }
});

test('changed (tampered) game list is refused', async () => {
  const demo = makeDemo();
  const f = path.join(demo.channel, 'catalogue.json');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Build a moving train base', 'FREE GOLD click here'));
  const { app, win } = await launch(demo.user);
  try {
    await win.locator('.err', { hasText: 'safety check' }).waitFor({ timeout: 10000 });
    assert.equal(await win.locator('text=FREE GOLD').count(), 0);
    await shot(win, 'player-tampered-list');
  } finally { await close(app); }
});

test('player cannot call developer or friend actions', async () => {
  const demo = makeDemo();
  const { app, win } = await launch(demo.user);
  try {
    const tryCall = (name, ...args) => win.evaluate(([n, a]) => window.zl.call(n, ...a).then(() => 'ok', (e) => e.message), [name, args]);
    for (const [name, args] of [['devRelease', ['railrove', '0.20.0']], ['devToTesters', ['marchlands', '0.4.4.0']], ['devUpload', []], ['devAiStart', ['claude, hi', '/']], ['devHub', []]]) {
      assert.match(await tryCall(name, ...args), /Developer only/, name);
    }
    assert.match(await tryCall('friendSubmit', {}), /Friend host only/);
    assert.match(await tryCall('friendMakeKeys'), /Friend host only/);
    assert.equal(readCat(demo).games.find((g) => g.id === 'railrove').releases.find((r) => r.version === '0.20.0').state, 'testing');
  } finally { await close(app); }
});
