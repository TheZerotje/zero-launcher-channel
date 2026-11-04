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
