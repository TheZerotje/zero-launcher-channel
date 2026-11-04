'use strict';
// Developer power: Godot export, Upload needed badge, My projects extras, AI helper past jobs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeDemo, launch, goto, shot, close } = require('./helpers');

test('Publish: Upload needed badge, Export from Godot adds an UNRELEASED version', { skip: process.platform === 'win32' && 'fake Godot is a shell script' }, async () => {
  const demo = makeDemo();
  const proj = path.join(demo.dir, 'projects', 'Dustrunner');
  const before = fs.readdirSync(proj, { recursive: true }).sort();
  const { app, win, errors } = await launch(demo.dev);
  try {
    await goto(win, 'Publish');
    await win.locator('.upload-badge', { hasText: 'Upload needed' }).waitFor();
    const panel = win.locator('.panel', { has: win.locator('#v-railrove') });
    await panel.locator('button', { hasText: 'Export from Godot' }).waitFor();
    await win.fill('#v-railrove', '0.22.0');
    await win.fill('#n-railrove', 'Built by Godot');
    await panel.locator('button', { hasText: 'Export from Godot' }).click();
    await win.locator('tr', { hasText: 'v0.22.0' }).locator('text=unreleased').waitFor({ timeout: 20000 });
    await shot(win, 'dev-publish-godot');
    const cat = JSON.parse(fs.readFileSync(path.join(demo.channel, 'catalogue.json'), 'utf8'));
    const r = cat.games.find((g) => g.id === 'railrove').releases.find((x) => x.version === '0.22.0');
    assert.equal(r.state, 'unreleased');
    assert.equal(r.exe, 'Railrove.exe');
    assert.deepEqual(fs.readdirSync(proj, { recursive: true }).sort(), before, 'project folder not changed');
    // player cannot export
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('My projects: git commits, last build size, Copy path; AI helper past jobs', async () => {
  const demo = makeDemo();
  const proj = path.join(demo.dir, 'projects', 'Dustrunner');
  const g = (...a) => execFileSync('git', ['-C', proj, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
  g('init', '-q'); g('add', '.'); g('commit', '-q', '-m', 'Add crane');
  const runs = path.join(demo.dev, 'ai-runs', '1762000000000-1');
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, 'job.json'), JSON.stringify({ tool: 'claude', said: 'claude', task: 'fix the jump bug', cwd: proj, startedAt: '2026-11-03T20:00:00Z' }));
  fs.writeFileSync(path.join(runs, 'end.json'), JSON.stringify({ code: 0 }));
  fs.writeFileSync(path.join(runs, 'output.jsonl'), JSON.stringify({ type: 'result', subtype: 'success', result: 'Jump fixed' }) + '\n');
  const { app, win, errors } = await launch(demo.dev);
  try {
    await goto(win, 'My projects');
    const row = win.locator('.hub-row', { hasText: 'Railrove' }).first();
    await row.waitFor();
    await row.locator('summary', { hasText: 'Git: last 1 commits' }).click();
    await row.locator('text=Add crane').waitFor();
    assert.match(await row.textContent(), /Last build: /);
    await row.locator('button', { hasText: 'Copy path' }).click();
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), proj);
    await shot(win, 'dev-my-games-git');
    await goto(win, 'AI helper');
    const job = win.locator('.ai-jobs tr', { hasText: 'fix the jump bug' });
    await job.waitFor();
    assert.match(await job.textContent(), /done/);
    await job.locator('button', { hasText: 'Show log' }).click();
    await win.locator('#ai-log', { hasText: 'Jump fixed' }).waitFor();
    await shot(win, 'dev-ai-history');
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('keyboard: Ctrl+1..9 pages for the developer, Ctrl+F search', async () => {
  const demo = makeDemo();
  const { app, win } = await launch(demo.dev);
  try {
    await win.keyboard.press('Control+3');
    await win.locator('h1', { hasText: 'Publish' }).waitFor();
    await win.keyboard.press('Control+1');
    await win.locator('h1', { hasText: 'My projects' }).waitFor();
    await win.locator('#hub-q').waitFor();
    await win.locator('body').click({ position: { x: 600, y: 20 } });
    await win.keyboard.press('Control+f');
    assert.equal(await win.evaluate(() => document.activeElement.id), 'hub-q');
    await win.keyboard.press('Control+8');
    await win.locator('h1', { hasText: 'Store' }).waitFor();
  } finally { await close(app); }
});
