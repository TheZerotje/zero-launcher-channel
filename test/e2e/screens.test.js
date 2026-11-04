'use strict';
// Screenshot every page for every kind of person -> docs/screens/.
const test = require('node:test');
const assert = require('node:assert');
const { makeDemo, launch, shot, close } = require('./helpers');

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

for (const who of ['user', 'player', 'dev']) {
  test(`screenshots of every page (${who})`, async () => {
    const demo = makeDemo();
    const { app, win, errors } = await launch(demo[who]);
    const prefix = { user: 'player', player: 'tester', dev: 'dev' }[who];
    try {
      const labels = await win.locator('#nav button').evaluateAll((bs) => bs.map((b) => b.childNodes[0].textContent));
      assert.ok(labels.length >= 4);
      for (let i = 0; i < labels.length; i++) {
        await win.locator('#nav button').nth(i).click();
        await win.waitForTimeout(700);
        await shot(win, `${prefix}-${slug(labels[i])}`);
      }
      assert.deepEqual(errors, []);
    } finally { await close(app); }
  });
}
