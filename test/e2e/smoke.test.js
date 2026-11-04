'use strict';
// Smoke test: the real app opens for a player and shows the Store.
const test = require('node:test');
const assert = require('node:assert');
const { makeDemo, launch, close } = require('./helpers');

test('app opens and shows the Store with games', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.user);
  try {
    await win.waitForSelector('h1:has-text("Store")');
    await win.waitForSelector('.card:has-text("Railrove")');
    assert.equal(await win.locator('#modeTag').textContent(), 'Player');
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});
