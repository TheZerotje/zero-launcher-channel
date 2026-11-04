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
