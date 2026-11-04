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
