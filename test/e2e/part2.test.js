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
