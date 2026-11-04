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

test('welcome box: only on the first start for players, gone after OK (also after a restart), never for Zero', async () => {
  const demo = makeDemo();
  let { app, win, errors } = await launch(demo.user);
  try {
    const box = win.locator('.welcome');
    await box.waitFor();
    assert.match(await box.textContent(), /Pick a game below.*big button.*update by themselves/);
    await shot(win, 'player-welcome');
    await box.locator('button', { hasText: "OK, let's play!" }).click();
    await win.waitForFunction(() => !document.querySelector('.welcome'));
    assert.deepEqual(errors, []);
  } finally { await close(app); }
  ({ app, win } = await launch(demo.user));
  try {
    await win.locator('.card').first().waitFor();
    assert.equal(await win.locator('.welcome').count(), 0, 'not again after a restart');
  } finally { await close(app); }
  ({ app, win } = await launch(demo.dev));
  try {
    await goto(win, 'Store');
    await win.locator('.card').first().waitFor();
    assert.equal(await win.locator('.welcome').count(), 0, 'never for the developer');
  } finally { await close(app); }
});

test('Continue playing: the games you played last are on top of the Store', async () => {
  const demo = makeDemo();
  const { app, win } = await launch(demo.user);
  try {
    await win.locator('.card').first().waitFor();
    assert.equal(await win.locator('h3.s-again').count(), 0, 'nothing played yet: no row');
    const rr = win.locator('.card', { hasText: 'Railrove' }).first();
    await rr.locator('button', { hasText: 'Install' }).click();
    await rr.locator('button', { hasText: 'Play' }).waitFor({ timeout: 20000 });
    const inst = JSON.parse(fs.readFileSync(path.join(demo.user, 'library', 'installed.json'), 'utf8')).railrove;
    if (process.platform !== 'win32') fs.chmodSync(path.join(inst.dir, inst.exe), 0o755);
    await rr.locator('button', { hasText: 'Play' }).click();
    await win.locator('h3.s-again').waitFor({ timeout: 10000 });
    const first = win.locator('h3.s-again + .grid .card').first();
    assert.match(await first.textContent(), /Railrove/);
    await win.locator('button:not([disabled])', { hasText: 'Play' }).first().waitFor({ timeout: 10000 });
    await shot(win, 'player-continue-playing');
    // play time + badge on the game page (kept on this PC only)
    await win.locator('h3.s-again + .grid .card b').first().click();
    const ptBox = win.locator('.panel.playtime');
    await ptBox.waitFor();
    assert.match(await ptBox.textContent(), /Your play time.*(less than 1 min|\d+ min).*played once/);
    await ptBox.locator('.badge-chip', { hasText: 'First play' }).waitFor();
    const saved = JSON.parse(fs.readFileSync(path.join(demo.user, 'playtime.json'), 'utf8'));
    assert.equal(saved.railrove.plays, 1);
    await shot(win, 'player-play-time');
  } finally { await close(app); }
});

test('tester feedback: stars + one line -> code; Zero pastes it in Testers and sees all feedback in one list', async () => {
  const demo = makeDemo();
  let { app, win, errors } = await launch(demo.player);
  let report;
  try {
    await win.locator('.card b', { hasText: 'Railrove' }).first().click();
    const box = win.locator('.panel.feedback');
    await box.waitFor();
    await box.locator('button', { hasText: 'Send feedback' }).click();
    await win.locator('.toast', { hasText: 'Press a star first' }).waitFor();
    await box.locator('.star[data-v="3"]').click();
    assert.equal(await box.locator('.star.on').count(), 3, 'stars 1-3 light up');
    assert.equal(await win.locator('#fb-text').getAttribute('maxlength'), '200');
    await win.fill('#fb-text', 'Night sky is too dark');
    await box.locator('button', { hasText: 'Send feedback' }).click();
    await win.locator('.toast', { hasText: 'Feedback saved' }).waitFor();
    report = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.match(report, /★★★☆☆ \(3 of 5\)\nNight sky is too dark[\s\S]*ZLFB1:/);
    await shot(win, 'tester-feedback-stars');
    // hack: bad stars, long text, extra args
    for (const args of [[0, ''], [6, ''], ['5', ''], [5, 'x'.repeat(201)], [5, '', 'extra']]) {
      assert.match(await tryCall(win, 'feedback', 'railrove', ...args), /Bad input/, JSON.stringify(args));
    }
    // a tester can not use Zero's list
    assert.match(await tryCall(win, 'devFeedbackAdd', report), /Developer only|Not allowed/);
    assert.match(await tryCall(win, 'devFeedback'), /Developer only|Not allowed/);
    assert.deepEqual(errors, []);
  } finally { await close(app); }
  ({ app, win, errors } = await launch(demo.dev));
  try {
    await goto(win, 'Testers');
    const list = win.locator('.panel.fb-list');
    await list.locator('.empty', { hasText: 'No feedback yet' }).waitFor();
    await win.fill('#fb-paste', 'hello, nothing here');
    await list.locator('button', { hasText: 'Add feedback' }).click();
    await win.locator('.toast', { hasText: 'No feedback code found' }).waitFor();
    await win.fill('#fb-paste', `Hi Zero, here you go:\n${report}`);
    await list.locator('button', { hasText: 'Add feedback' }).click();
    await win.locator('.toast', { hasText: 'Added 1 feedback' }).waitFor();
    const grp = win.locator('.fb-group').first();
    await grp.waitFor();
    assert.match(await grp.textContent(), /Railrove v0\.20\.0.*★ 3 of 5.*1 feedback.*Night sky is too dark/);
    await win.fill('#fb-paste', report);
    await list.locator('button', { hasText: 'Add feedback' }).click();
    await win.locator('.toast', { hasText: 'Already in the list' }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(path.join(demo.dev, 'feedback.json'), 'utf8')).length, 1);
    await shot(win, 'dev-tester-feedback');
    await grp.locator('button', { hasText: 'Remove' }).click();
    await list.locator('.empty', { hasText: 'No feedback yet' }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('launcher log: things are written down on this PC; Copy launcher log; no secrets, no input text', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.user);
  try {
    await win.locator('.card').first().waitFor();
    await tryCall(win, 'reportText', '../secret-words-here');
    await tryCall(win, 'devProjects');
    await goto(win, 'My reports');
    const box = win.locator('.panel.launcher-log');
    await box.locator('button', { hasText: 'Copy launcher log' }).click();
    await win.locator('.toast', { hasText: 'Copied' }).waitFor();
    const text = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.match(text, /INFO  start .* as user/);
    assert.match(text, /WARN  reportText: Bad input/);
    assert.match(text, /WARN  devProjects: Developer only/);
    assert.doesNotMatch(text, /secret-words-here/, 'what you typed is never written down');
    assert.ok(fs.existsSync(path.join(demo.user, 'logs', 'launcher.log')));
    await shot(win, 'player-launcher-log');
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});
