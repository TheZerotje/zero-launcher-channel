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

test('developer power 2: download numbers, release checklist, Discord preview, key backup, Ctrl+K', async () => {
  const demo = makeDemo();
  const devFile = path.join(demo.dev, 'developer.json');
  const d = JSON.parse(fs.readFileSync(devFile, 'utf8'));
  d.discordWebhook = 'https://discord.com/api/webhooks/123/test-token';
  fs.writeFileSync(devFile, JSON.stringify(d));
  const usb = path.join(demo.dir, 'usb'); fs.mkdirSync(usb);
  const { app, win } = await launch(demo.dev);
  try {
    await app.evaluate(({ dialog }, usbDir) => {
      global.posts = []; global.boxes = [];
      global.fetch = async (url, opts = {}) => {
        if (String(url).includes('/releases/tags/channel')) return { ok: true, status: 200, json: async () => ({ assets: [{ name: 'railrove-0.19.12.0.zip', download_count: 41 }, { name: 'railrove-0.20.0.zip', download_count: 5 }] }) };
        global.posts.push({ url: String(url), body: opts.body });
        return { ok: true, status: 204, json: async () => ({}) };
      };
      dialog.showMessageBox = async (_w, o) => { global.boxes.push((o || _w).message); return { response: 0 }; };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [usbDir] });
    }, usb);
    await goto(win, 'Publish');
    await win.locator('tr', { hasText: 'v0.19.12.0' }).locator('td.dl', { hasText: '41' }).waitFor();
    // release checklist: tick 2 of 5, release -> "Release anyway?" asked
    const row = win.locator('tr', { hasText: 'v0.20.0' });
    await row.locator('button', { hasText: 'Release to everyone' }).click();
    const m = win.locator('.modal');
    await m.locator('label', { hasText: 'The game starts' }).locator('input').check();
    await m.locator('label', { hasText: 'No sound bugs' }).locator('input').check();
    await shot(win, 'dev-release-checklist');
    await m.locator('button', { hasText: 'Release to everyone' }).click();
    await row.locator('text=released').waitFor();
    const boxes = await app.evaluate(() => global.boxes);
    assert.ok(boxes.some((b) => /Release anyway/.test(b)), 'asked Release anyway');
    assert.ok(boxes.some((b) => /to EVERYONE/.test(b)), 'normal release confirm still asked');
    const saved = JSON.parse(fs.readFileSync(path.join(demo.dev, 'checklists.json'), 'utf8'))['railrove@0.20.0'];
    assert.deepEqual(saved, { starts: true, sound: true, tested: false, notes: false, picture: false });
    // Discord: preview first, nothing sent until Send
    await row.locator('button', { hasText: 'Post to Discord' }).click();
    const ta = win.locator('#discord-text');
    await ta.waitFor();
    assert.match(await ta.inputValue(), /Railrove 0\.20\.0/);
    assert.equal((await app.evaluate(() => global.posts)).length, 0, 'nothing sent yet');
    await ta.fill('Railrove 0.20.0 is out! @everyone');
    await shot(win, 'dev-discord-preview');
    await win.locator('.modal button', { hasText: 'Send' }).click();
    await win.locator('.toast', { hasText: 'Posted to Discord' }).waitFor();
    const posts = await app.evaluate(() => global.posts);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, 'https://discord.com/api/webhooks/123/test-token');
    assert.deepEqual(JSON.parse(posts[0].body).allowed_mentions, { parse: [] });
    const st = await win.evaluate(() => window.zl.call('state'));
    assert.equal(JSON.stringify(st).includes('test-token'), false, 'webhook never reaches the screen');
    // key backup
    await goto(win, 'Settings');
    await win.locator('.keybackup button', { hasText: 'Back up my secret key' }).click();
    await win.locator('.keybackup', { hasText: 'Last backup' }).waitFor();
    const files = fs.readdirSync(usb);
    assert.equal(files.length, 1);
    assert.equal(fs.readFileSync(path.join(usb, files[0]), 'utf8'), fs.readFileSync(path.join(demo.dir, 'zero-private.pem'), 'utf8'));
    await shot(win, 'dev-settings-key-backup');
    // Ctrl+K
    await win.keyboard.press('Control+k');
    await win.locator('.pal-input').fill('marchl');
    await win.keyboard.press('Enter');
    await win.locator('h1', { hasText: 'Marchlands' }).waitFor();
    await win.keyboard.press('Control+k');
    await win.locator('.pal-input').fill('claude, fix the jump bug');
    await win.locator('.pal-item', { hasText: 'Run in AI helper' }).waitFor();
    await shot(win, 'dev-command-box');
    await win.keyboard.press('Enter');
    await win.locator('h1', { hasText: 'AI helper' }).waitFor();
    await win.locator('#ai-log', { hasText: '> claude, fix the jump bug' }).waitFor();
  } finally { await close(app); }
});
