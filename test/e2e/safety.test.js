'use strict';
// Safety: bad IPC input is refused, web game windows are sandboxed, outside links open in the normal browser.
const test = require('node:test');
const assert = require('node:assert');
const { makeDemo, launch, close } = require('./helpers');

test('bad IPC input is refused (player and developer)', async () => {
  const demo = makeDemo();
  for (const who of ['user', 'dev']) {
    const { app, win } = await launch(demo[who]);
    try {
      const tryCall = (name, ...args) => win.evaluate(([n, a]) => window.zl.call(n, ...a).then(() => 'ok', (e) => e.message), [name, args]);
      assert.match(await tryCall('install', '../../evil'), /Bad input|game id/);
      assert.match(await tryCall('install', { id: 'railrove' }), /Bad input/);
      assert.match(await tryCall('play', 'railrove', 'extra'), /Bad input/);
      assert.match(await tryCall('copy', 'x'.repeat(30000)), /Bad input/);
      assert.match(await tryCall('notAThing'), /No handler|not registered|Error/);
      if (who === 'dev') {
        assert.match(await tryCall('devAddVersion', { gameId: 'railrove', buildDir: 'relative', version: '1.0' }), /Bad input/);
        assert.match(await tryCall('devAddGame', { id: 'x-y', name: 'X', kind: 'web', url: 'javascript:alert(1)' }), /Bad input/);
        assert.match(await tryCall('devRelease', 'railrove', '1.0; echo'), /Bad input/);
        assert.match(await tryCall('devImportSubmission', '/etc/passwd'), /Bad input/);
        assert.match(await tryCall('devAiLog', '../../x'), /Bad input/);
        assert.match(await tryCall('devReject', '../../x'), /Bad input/);
      }
    } finally { await close(app); }
  }
});

test('web game windows: sandboxed, no node, no preload; outside links go to the normal browser', async () => {
  const demo = makeDemo();
  const { app, win } = await launch(demo.user);
  try {
    await app.evaluate(({ shell }) => { global.opened = []; shell.openExternal = async (u) => { global.opened.push(u); }; });
    await win.locator('.card', { hasText: 'Pop Storm' }).locator('button', { hasText: 'Play' }).first().click();
    await win.waitForTimeout(1500);
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() !== 'Zero Launcher');
      const p = w.webContents.getLastWebPreferences();
      return { sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation, preload: p.preload || null, muted: w.webContents.isAudioMuted() };
    });
    assert.deepEqual(prefs, { sandbox: true, nodeIntegration: false, contextIsolation: true, preload: null, muted: true });
    // the page inside cannot see node
    const hasNode = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() !== 'Zero Launcher');
      return w.webContents.executeJavaScript('typeof require + "/" + typeof process');
    });
    assert.equal(hasNode, 'undefined/undefined');
    await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle() !== 'Zero Launcher');
      await w.webContents.executeJavaScript('window.open("https://example.com/page"); 1', true);
    });
    await win.waitForTimeout(500);
    assert.deepEqual(await app.evaluate(() => global.opened), ['https://example.com/page']);
    const count = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    assert.equal(count, 2, 'no new app window was opened');
  } finally { await close(app); }
});
