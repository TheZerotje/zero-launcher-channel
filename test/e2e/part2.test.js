'use strict';
// Part 2 features in the real app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeDemo, launch, goto, shot, close } = require('./helpers');

test('news: Zero writes news, players see the newest on top, older news opens the rest', async () => {
  const demo = makeDemo();
  let { app, win } = await launch(demo.dev);
  try {
    await goto(win, 'Publish');
    for (const [title, text] of [['Railrove 0.19 is out', 'Crane feel is better.'], ['Marchlands coming soon', 'Warbands!']]) {
      await win.fill('#news-title', title);
      await win.fill('#news-text', text);
      await win.locator('button', { hasText: 'Add news' }).click();
      await win.locator('td', { hasText: title }).waitFor();
    }
    const bad = await win.evaluate(() => window.zl.call('devAddNews', { title: 'x', image: 'javascript:alert(1)' }).then(() => 'ok', (e) => e.message));
    assert.match(bad, /Bad input/);
    await shot(win, 'dev-publish-news');
  } finally { await close(app); }
  ({ app, win } = await launch(demo.user));
  try {
    const top = win.locator('.news.big');
    await top.waitFor();
    assert.match(await top.textContent(), /Marchlands coming soon/);
    assert.equal(await win.locator('.news').count(), 1);
    await win.locator('button', { hasText: 'Older news' }).click();
    assert.equal(await win.locator('.news').count(), 2);
    await shot(win, 'player-store-news');
  } finally { await close(app); }
});

test('game pages: gallery with big view + arrows, trailer, store sections with countdown, launch options', async () => {
  const demo = makeDemo();
  const { Channel } = require('../../core/publisher');
  const ch = new Channel(demo.channel, fs.readFileSync(path.join(demo.dir, 'zero-private.pem'), 'utf8'));
  const soon = new Date(Date.now() + 5 * 86400000 + 3600000).toISOString().slice(0, 10);
  let { app, win } = await launch(demo.dev);
  try {
    await goto(win, 'Publish');
    const panel = win.locator('.panel', { has: win.locator('#v-railrove') });
    await panel.locator('summary', { hasText: 'Game page' }).click();
    await win.fill('#gi-railrove-tr', 'https://www.youtube.com/watch?v=abc123');
    await win.fill('#gi-railrove-ss', 'https://example.com/a.png\nhttps://example.com/b.png\nhttps://example.com/c.png');
    await panel.locator('button', { hasText: 'Save game page' }).click();
    await win.locator('.toast', { hasText: 'Game page saved' }).waitFor();
    const mpanel = win.locator('.panel', { has: win.locator('#v-marchlands') });
    await mpanel.locator('summary', { hasText: 'Game page' }).click();
    await win.fill('#gi-marchlands-cs', soon);
    await mpanel.locator('button', { hasText: 'Save game page' }).click();
    await win.locator('.toast', { hasText: 'Game page saved' }).nth(1).waitFor();
    const bad = await win.evaluate(() => window.zl.call('devSetGameInfo', 'railrove', { trailer: 'https://evil.test/x' }).then(() => 'ok', (e) => e.message));
    assert.match(bad, /YouTube/);
  } finally { await close(app); }
  ({ app, win } = await launch(demo.user));
  try {
    await app.evaluate(({ shell }) => { global.opened = []; shell.openExternal = async (u) => { global.opened.push(u); }; });
    // Store sections
    await win.locator('h3.s-new').waitFor();
    const soonCard = win.locator('h3.s-soon + .grid .card', { hasText: 'Marchlands' });
    await soonCard.waitFor();
    assert.match(await soonCard.textContent(), /In [45] days/);
    assert.equal(await soonCard.locator('button', { hasText: 'Install' }).count(), 0);
    await shot(win, 'player-store-sections');
    // Game page
    await win.locator('.card b', { hasText: 'Railrove' }).first().click();
    await win.locator('.gallery img').first().waitFor();
    assert.equal(await win.locator('.gallery img').count(), 3);
    await win.locator('.gallery img').first().click();
    await win.locator('.lb-count', { hasText: '1 / 3' }).waitFor();
    await win.keyboard.press('ArrowRight');
    await win.locator('.lb-count', { hasText: '2 / 3' }).waitFor();
    await win.locator('.lb-prev').click(); await win.locator('.lb-prev').click();
    await win.locator('.lb-count', { hasText: '3 / 3' }).waitFor();
    await shot(win, 'player-game-gallery');
    await win.keyboard.press('Escape');
    assert.equal(await win.locator('.lightbox').count(), 0);
    await win.locator('button', { hasText: 'Watch trailer' }).click();
    await win.waitForTimeout(300);
    assert.deepEqual(await app.evaluate(() => global.opened), ['https://www.youtube.com/watch?v=abc123']);
    // Install, set launch options, play: the game gets the words
    await win.locator('button', { hasText: 'Install' }).first().click();
    await win.locator('summary', { hasText: 'Launch options' }).waitFor({ timeout: 20000 });
    await win.locator('summary', { hasText: 'Launch options' }).click();
    await win.fill('#launch-args', '--fullscreen --name "Big Map"');
    await win.locator('details.launch button', { hasText: 'Save' }).click();
    await win.locator('.toast', { hasText: 'Saved' }).waitFor();
    const inst = JSON.parse(fs.readFileSync(path.join(demo.user, 'library', 'installed.json'), 'utf8')).railrove;
    assert.equal(inst.launchArgs, '--fullscreen --name "Big Map"');
    if (process.platform !== 'win32') {
      const exe = path.join(inst.dir, inst.exe);
      const outFile = path.join(demo.dir, 'args.txt');
      fs.writeFileSync(exe, `#!/bin/sh\nfor a; do echo "$a"; done > "${outFile}"\n`);
      fs.chmodSync(exe, 0o755);
      await win.locator('.game-info button', { hasText: 'Play' }).click();
      await win.waitForTimeout(1500);
      assert.deepEqual(fs.readFileSync(outFile, 'utf8').trim().split('\n'), ['--fullscreen', '--name', 'Big Map']);
      // Shortcut: Windows only
      const r = await win.evaluate(() => window.zl.call('makeShortcut', 'railrove').then(() => 'ok', (e) => e.message));
      assert.match(r, /Windows only/);
    }
    await shot(win, 'player-game-page-extras');
  } finally { await close(app); }
});

test('tester helpers: what to test (purple box), quick feedback, crash report shown before saving', async () => {
  const demo = makeDemo();
  let { app, win } = await launch(demo.dev);
  try {
    await goto(win, 'Publish');
    const row = win.locator('tr', { hasText: 'v0.20.0' });
    await row.locator('input.testnotes').fill('Try the new bridge and the night sky');
    await row.locator('button', { hasText: 'Save' }).click();
    await win.locator('.toast', { hasText: 'what to test' }).waitFor();
  } finally { await close(app); }
  const appData = path.join(demo.dir, 'appdata');
  const logs = path.join(appData, 'Godot', 'app_userdata', 'Railrove', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'godot.log'), 'Godot Engine v4.7\nERROR: Bridge script failed at line 42\n');
  ({ app, win } = await launch(demo.player, { ZL_GODOT_APPDATA: appData }));
  try {
    await win.locator('.card b', { hasText: 'Railrove' }).first().click();
    const box = win.locator('.testbox');
    await box.waitFor();
    assert.match(await box.textContent(), /Try the new bridge/);
    await win.locator('.vote[data-v="up"]').click();
    await win.fill('#fb-text', 'Bridge feels great');
    await win.locator('button', { hasText: 'Send feedback' }).click();
    await win.locator('.toast', { hasText: 'Feedback saved' }).waitFor();
    await shot(win, 'tester-game-page');
    const rep = fs.readdirSync(path.join(demo.player, 'reports'));
    assert.match(fs.readFileSync(path.join(demo.player, 'reports', rep[0]), 'utf8'), /Test feedback for version 0\.20\.0: 👍[\s\S]*Bridge feels great/);
    // install + crash
    await win.locator('.game-info button', { hasText: 'Install' }).click();
    await win.locator('.game-info button', { hasText: 'Play' }).waitFor({ timeout: 20000 });
    if (process.platform !== 'win32') {
      const inst = JSON.parse(fs.readFileSync(path.join(demo.player, 'library', 'installed.json'), 'utf8')).railrove;
      const exe = path.join(inst.dir, inst.exe);
      fs.writeFileSync(exe, '#!/bin/sh\nexit 3\n'); fs.chmodSync(exe, 0o755);
      await win.locator('.game-info button', { hasText: 'Play' }).click();
      const crash = win.locator('.panel.crash');
      await crash.waitFor({ timeout: 10000 });
      assert.equal(fs.readdirSync(path.join(demo.player, 'reports')).length, 1, 'nothing saved before the player says yes');
      await crash.locator('button', { hasText: 'Show crash report' }).click();
      const pre = crash.locator('.crash-text');
      await pre.waitFor();
      const text = await pre.textContent();
      assert.match(text, /Exit code: 3/); assert.match(text, /Bridge script failed at line 42/);
      await shot(win, 'tester-crash-report');
      await crash.locator('button', { hasText: 'Save and copy report' }).click();
      await win.locator('.toast', { hasText: 'Crash report saved' }).waitFor();
      assert.equal(await win.locator('.panel.crash').count(), 0);
      assert.ok(fs.readdirSync(path.join(demo.player, 'reports')).some((f) => f.includes('-crash-')));
    }
  } finally { await close(app); }
  // a normal player has no feedback box for released versions
  ({ app, win } = await launch(demo.user));
  try {
    await win.locator('.card b', { hasText: 'Railrove' }).first().click();
    await win.locator('h1', { hasText: 'Railrove' }).waitFor();
    assert.equal(await win.locator('.feedback').count(), 0);
    const r = await win.evaluate(() => window.zl.call('feedback', 'railrove', 'up', '').then(() => 'ok', (e) => e.message));
    assert.match(r, /only for test versions/);
  } finally { await close(app); }
});
