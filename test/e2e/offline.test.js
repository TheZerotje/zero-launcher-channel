'use strict';
// Works offline: last good list is used, installed games still play, a note says so.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeDemo, launch, shot, close } = require('./helpers');

test('offline: games from last time, installed game still plays', async () => {
  const demo = makeDemo();
  let { app, win } = await launch(demo.user);
  try {
    const rr = win.locator('.card', { hasText: 'Railrove' }).first();
    await rr.locator('button', { hasText: 'Install' }).click();
    await rr.locator('button', { hasText: 'Play' }).waitFor({ timeout: 20000 });
  } finally { await close(app); }
  // Now the channel can't be reached.
  const sf = path.join(demo.user, 'settings.json');
  const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
  s.channelUrl = 'http://127.0.0.1:9/';
  fs.writeFileSync(sf, JSON.stringify(s));
  ({ app, win } = await launch(demo.user));
  try {
    await win.locator('.note', { hasText: 'Offline' }).waitFor({ timeout: 15000 });
    const rr = win.locator('.card', { hasText: 'Railrove' }).first();
    await rr.locator('button', { hasText: 'Play' }).waitFor();
    await shot(win, 'player-offline');
    const inst = JSON.parse(fs.readFileSync(path.join(demo.user, 'library', 'installed.json'), 'utf8')).railrove;
    if (process.platform !== 'win32') fs.chmodSync(path.join(inst.dir, inst.exe), 0o755);
    await rr.locator('button', { hasText: 'Play' }).click();
    await rr.locator('button', { hasText: 'Playing' }).waitFor({ timeout: 5000 });
    const st = await win.evaluate(() => window.zl.call('state'));
    assert.equal(st.offline, true);
    assert.equal(st.nextRetry, 60000, 'tries again in 1 minute');
  } finally { await close(app); }
  // No list at all and no cache: installed games are still listed.
  fs.rmSync(path.join(demo.user, 'cache'), { recursive: true, force: true });
  ({ app, win } = await launch(demo.user));
  try {
    await win.locator('#nav button', { hasText: 'Library' }).click();
    const rr = win.locator('.card', { hasText: 'Railrove' }).first();
    await rr.locator('button', { hasText: 'Play' }).waitFor({ timeout: 15000 });
  } finally { await close(app); }
});
