'use strict';
// Player comfort: search + filters, Help page, text size, easy font, Dutch, test version message, report.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeDemo, launch, goto, shot, close } = require('./helpers');

test('store search and filters, library sort', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.user);
  try {
    await win.locator('.card', { hasText: 'Railrove' }).waitFor();
    await win.fill('#store-q', 'pop');
    await win.waitForTimeout(200);
    assert.equal(await win.locator('.card').count(), 1);
    assert.match(await win.locator('.card').textContent(), /Pop Storm/);
    await shot(win, 'player-store-search');
    await win.fill('#store-q', 'zzzz');
    await win.locator('text=No game found').waitFor();
    await win.fill('#store-q', '');
    await win.locator('.chip', { hasText: 'PC games' }).click();
    assert.equal(await win.locator('.card').count(), 1);
    await win.locator('.chip', { hasText: 'Play instantly' }).click();
    assert.equal(await win.locator('.card').count(), 2);
    await win.locator('.chip', { hasText: 'Installed' }).click();
    assert.equal(await win.locator('.card').count(), 0);
    await goto(win, 'Library');
    await win.locator('text=Nothing installed yet').waitFor();
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('help page, text size, easy font and Dutch', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.user);
  try {
    await goto(win, 'Help');
    const n = await win.locator('details.faq').count();
    assert.ok(n >= 6 && n <= 8, `6-8 questions, got ${n}`);
    await win.locator('details.faq summary').first().click();
    await shot(win, 'player-help');
    await goto(win, 'Settings');
    await win.selectOption('#set-size', 'bigger');
    await win.waitForFunction(() => document.documentElement.style.zoom === '1.3');
    await win.locator('label.switch', { hasText: 'Easy-to-read' }).locator('input').check();
    await win.waitForFunction(() => document.body.classList.contains('easyfont'));
    const fontOk = await win.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "Atkinson Hyperlegible"'); });
    assert.ok(fontOk, 'bundled font loads');
    await shot(win, 'player-settings-big-easy');
    await win.selectOption('#set-lang', 'nl');
    await win.locator('#nav button', { hasText: 'Winkel' }).waitFor();
    await win.locator('#nav button', { hasText: 'Winkel' }).click();
    await win.locator('h1', { hasText: 'Winkel' }).waitFor();
    await win.locator('button', { hasText: 'Installeren' }).first().waitFor();
    await shot(win, 'player-store-dutch');
    const saved = JSON.parse(fs.readFileSync(path.join(demo.user, 'settings.json'), 'utf8'));
    assert.equal(saved.lang, 'nl'); assert.equal(saved.textSize, 'bigger'); assert.equal(saved.easyFont, true);
    // bad values are refused
    const r = await win.evaluate(() => window.zl.call('setSetting', 'textSize', 'huge').then(() => 'ok', (e) => e.message));
    assert.match(r, /Not allowed/);
    const r2 = await win.evaluate(() => window.zl.call('setSetting', 'publicKeyFile', 'C:\\evil.pem').then(() => 'ok', (e) => e.message));
    assert.match(r2, /Not allowed/);
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('tester gets one message for a new test version; switch turns messages off', async () => {
  const demo = makeDemo();
  let { app, win } = await launch(demo.player);
  try {
    await win.locator('.card', { hasText: 'Railrove' }).waitFor();
    await win.waitForTimeout(300);
    let notices = await app.evaluate(() => global.zlNotices);
    assert.equal(notices.filter((n) => n.title === 'New test version').length, 1);
    await win.locator('#refreshBtn').click();
    await win.waitForTimeout(500);
    notices = await app.evaluate(() => global.zlNotices);
    assert.equal(notices.filter((n) => n.title === 'New test version').length, 1, 'only once');
    await goto(win, 'Settings');
    await win.locator('label.switch', { hasText: 'Windows message' }).locator('input').uncheck();
    await win.waitForTimeout(200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(demo.player, 'settings.json'), 'utf8')).notify, false);
  } finally { await close(app); }
});

test('report a problem makes a file with the game info', async () => {
  const demo = makeDemo();
  const { app, win } = await launch(demo.user);
  try {
    await win.locator('.card b', { hasText: 'Railrove' }).click();
    await win.fill('#rep-text', 'The train fell off the map');
    await win.locator('button', { hasText: 'Make report' }).click();
    await win.locator('.toast', { hasText: 'Report saved' }).waitFor();
    const dir = path.join(demo.user, 'reports');
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1);
    const text = fs.readFileSync(path.join(dir, files[0]), 'utf8');
    assert.match(text, /Game: Railrove/); assert.match(text, /The train fell off the map/);
    const bad = await win.evaluate(() => window.zl.call('report', '../../x', 'hi').then(() => 'ok', (e) => e.message));
    assert.match(bad, /Bad input: game id/);
    const unknown = await win.evaluate(() => window.zl.call('report', 'no-such-game', 'hi').then(() => 'ok', (e) => e.message));
    assert.match(unknown, /Game not found/);
  } finally { await close(app); }
});
