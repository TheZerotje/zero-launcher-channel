'use strict';
// "Try to hack it": act like a bad web page / broken screen code and try to get in.
// Every attempt must be refused. Muted, demo data only, nothing leaves this PC.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeDemo, launch, close } = require('./helpers');

const tryCall = (win, name, ...args) => win.evaluate(([n, a]) => window.zl.call(n, ...a).then(() => 'ok', (e) => e.message), [name, args]);

test('hack: HTML in a game name is shown as text, never run', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.dev);
  try {
    const evil = '<img src=x onerror="window.__pwned=1">';
    assert.equal(await tryCall(win, 'devAddGame', { id: 'evil-game', name: evil, kind: 'web', url: 'https://example.com/' }), 'ok');
    await win.locator('#nav button', { hasText: 'Store' }).click();
    await win.locator('.card', { hasText: evil }).first().waitFor();
    assert.equal(await win.evaluate(() => window.__pwned), undefined);
    assert.equal(await win.locator('#main img[onerror]').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('hack: the main window cannot be moved to another page or open file:// windows', async () => {
  const demo = makeDemo();
  const { app, win } = await launch(demo.user);
  try {
    await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; });
    const before = win.url();
    await win.evaluate(() => { location.href = 'https://example.com/'; }).catch(() => {});
    await win.waitForTimeout(500);
    assert.equal(win.url(), before, 'still the launcher page');
    const n = app.windows().length;
    await win.evaluate(() => { window.open('file:///etc/passwd'); window.open('javascript:alert(1)'); });
    await win.waitForTimeout(500);
    assert.equal(app.windows().length, n, 'no new window');
    assert.deepEqual(await app.evaluate(() => global.__opened), [], 'file:// and javascript: never opened');
    // the page has no Node.js
    assert.equal(await win.evaluate(() => typeof require), 'undefined');
    assert.equal(await win.evaluate(() => typeof process), 'undefined');
  } finally { await close(app); }
});

test('hack: My projects calls with bad or sneaky input are refused', async () => {
  const demo = makeDemo();
  const { app, win } = await launch(demo.dev);
  try {
    await win.locator('h1', { hasText: 'My projects' }).waitFor();
    await win.locator('.hub-row').first().waitFor();
    const exe = path.join(demo.dir, 'evil.exe'); fs.writeFileSync(exe, 'x');
    // 1. turn a project "folder" into a program, then ask to "open" it (would RUN it)
    assert.equal(await tryCall(win, 'devProjectSave', 'railrove', { folders: [exe] }), 'ok');
    await win.evaluate(() => window.zl.call('devProjects'));
    assert.match(await tryCall(win, 'devOpenFolder', exe), /Folder not found/);
    assert.match(await tryCall(win, 'devOpenFolder', '/etc'), /Unknown folder/);
    // 2. odd keys, prototype tricks, scrapped via edit, bad types
    // (the __proto__ key is dropped on the way or refused; either way nothing is changed or polluted)
    assert.match(await tryCall(win, 'devProjectSave', 'railrove', JSON.parse('{"__proto__":{"admin":true}}')), /^ok$|Bad input/);
    assert.equal(await app.evaluate(() => ({}).admin), undefined, 'main process not polluted');
    assert.ok(!fs.readFileSync(path.join(demo.dev, 'projects.json'), 'utf8').includes('admin'));
    assert.match(await tryCall(win, 'devProjectSave', 'railrove', { history: [] }), /Bad input: history/);
    assert.match(await tryCall(win, 'devProjectSave', 'railrove', { stage: 'scrapped' }), /Bad input: stage/);
    assert.match(await tryCall(win, 'devProjectSave', 'railrove', { priority: 9 }), /Bad input: priority/);
    assert.match(await tryCall(win, 'devProjectSave', '../../etc', {}), /Bad input: project id/);
    assert.match(await tryCall(win, 'devProjectSave', 'railrove', { folders: ['relative/path'] }), /Bad input/);
    assert.match(await tryCall(win, 'devProjectSave', 'railrove', { notes: 'x'.repeat(5000) }), /Bad input: notes/);
    // 3. archive a folder that is not the project's
    assert.match(await tryCall(win, 'devProjectArchive', 'railrove', '/etc'), /Unknown folder/);
    assert.match(await tryCall(win, 'devSaveReport', 'exe'), /Bad input/);
    assert.match(await tryCall(win, 'devProjectScrap', 'railrove', ''), /Bad input: reason/);
    assert.match(await tryCall(win, 'devReviewChoice', 'railrove', 'delete'), /Bad input: choice/);
    assert.match(await tryCall(win, 'devProjectAdd', { name: 'X', folder: '/does/not/exist' }), /Bad input/);
    // 4. bring back without a person saying yes: the confirm box answers Cancel -> still scrapped
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
    assert.equal(await tryCall(win, 'devProjectBringBack', 'cryptogram'), 'ok');
    const d = JSON.parse(fs.readFileSync(path.join(demo.dev, 'projects.json'), 'utf8'));
    assert.equal(d.projects.find((p) => p.id === 'cryptogram').stage, 'scrapped');
    // ...and the same for scrap: Cancel keeps it
    assert.equal(await tryCall(win, 'devProjectScrap', 'kindlewood', 'test'), 'ok');
    const d2 = JSON.parse(fs.readFileSync(path.join(demo.dev, 'projects.json'), 'utf8'));
    assert.notEqual(d2.projects.find((p) => p.id === 'kindlewood').stage, 'scrapped');
  } finally { await close(app); }
});

test('hack: a player cannot reach any My projects call', async () => {
  const demo = makeDemo();
  const { app, win } = await launch(demo.user);
  try {
    for (const [n, a] of [['devProjects', []], ['devProjectBringBack', ['cryptogram']], ['devStatusReport', []], ['devProjectArchive', ['railrove', '/tmp']], ['devOpenFolder', ['/tmp']]]) {
      assert.match(await tryCall(win, n, ...a), /Developer only|Not allowed/, n);
    }
    assert.ok(!fs.existsSync(path.join(demo.user, 'projects.json')));
  } finally { await close(app); }
});
