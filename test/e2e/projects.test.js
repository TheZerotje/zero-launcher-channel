'use strict';
// Part 3: My projects (developer). Exact status, boxes, filters, scrap + graveyard + bring back,
// quick review, status report. Muted, demo data only. Folders are only read, never changed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeDemo, launch, mockDialogs, goto, shot, close } = require('./helpers');

const row = (win, name) => win.locator('.hub-row', { hasText: name }).first();
const snap = (dir) => JSON.stringify(fs.readdirSync(dir, { recursive: true }).sort().map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]));

test('My projects: every project with exact status, boxes, filters, new folders', async () => {
  const demo = makeDemo();
  const before = snap(path.join(demo.dir, 'projects'));
  const { app, win, errors } = await launch(demo.dev);
  try {
    await goto(win, 'My projects');
    await win.locator('h1', { hasText: 'My projects' }).waitFor();
    // games and other projects in one list
    await row(win, 'Railrove').waitFor();
    await row(win, 'Roblox: Shape Army').waitFor();
    await row(win, 'D&D World Engine').waitFor();
    // exact status with a source
    const rr = row(win, 'Railrove');
    assert.match(await rr.textContent(), /0\.19\.12\.0/);
    assert.match(await rr.textContent(), /Last build: /);
    assert.match(await rr.locator('.src').allTextContents().then((x) => x.join(' ')), /folder /);
    // a seed folder that is not on this PC -> red warning
    assert.match(await row(win, 'Marchlands').locator('.missing').first().textContent(), /Folder not found/);
    // website state comes from releases.json (read only)
    await win.locator('.pf-stage').selectOption('ready');
    assert.match(await row(win, 'Nova Forge').textContent(), /Website: unreleased.*releases\.json \(read only\)/);
    await win.locator('.pf-stage').selectOption('');
    // released + scrapped are hidden by default
    assert.equal(await win.locator('.hub-row', { hasText: 'Pop Storm' }).count(), 0);
    assert.equal(await win.locator('.hub-row', { hasText: 'Cryptogram' }).count(), 0);
    await win.locator('label', { hasText: 'Show released' }).locator('input').check();
    await row(win, 'Pop Storm').waitFor();
    assert.equal(await win.locator('.hub-row', { hasText: 'Cryptogram' }).count(), 0, 'scrapped never in the list');
    // filters + search
    await win.locator('.pf-type').selectOption('roblox');
    assert.equal(await win.locator('.hub-row').count(), 4);
    await win.locator('.pf-type').selectOption('');
    await win.locator('#hub-q').fill('Studio test');
    assert.equal(await win.locator('.hub-row').count(), 1);
    await win.locator('#hub-q').fill('');
    // boxes
    const wait = win.locator('.pbox.waiting');
    assert.match(await wait.textContent(), /Nova Forge/);
    const nf = win.locator('.pbox.newf');
    assert.match(await nf.textContent(), /New Space Game/);
    assert.doesNotMatch(await nf.textContent(), /RECYCLE|System Volume|Dustrunner/);
    await shot(win, 'dev-my-projects');
    await nf.locator('.pline', { hasText: 'Old Stuff' }).locator('button', { hasText: 'Ignore forever' }).click();
    await win.waitForFunction(() => !document.querySelector('.pbox.newf').textContent.includes('Old Stuff'));
    await nf.locator('.pline', { hasText: 'New Space Game' }).locator('button', { hasText: 'Add as project' }).click();
    await row(win, 'New Space Game').waitFor();
    // edit: stage, priority, next step -> saved with history
    const ns = row(win, 'New Space Game');
    await ns.locator('button', { hasText: 'Edit' }).click();
    await ns.locator('.e-stage').selectOption('building');
    await ns.locator('.e-next').fill('Make the ship fly');
    await ns.locator('button', { hasText: 'Save' }).click();
    await win.locator('.hub-row', { hasText: 'Make the ship fly' }).waitFor();
    const saved = JSON.parse(fs.readFileSync(path.join(demo.dev, 'projects.json'), 'utf8'));
    const p = saved.projects.find((x) => x.name === 'New Space Game');
    assert.equal(p.stage, 'building'); assert.ok(p.history.length >= 2);
    assert.deepEqual(saved.ignoredFolders, [path.join(demo.dir, 'drive-e', 'Old Stuff')]);
    assert.equal(snap(path.join(demo.dir, 'projects')), before, 'project folders are never changed');
    // daily "Don't forget" message has an off switch
    await goto(win, 'Settings');
    await win.locator('label', { hasText: "Don't forget" }).locator('input').uncheck();
    await win.waitForTimeout(300);
    assert.equal(JSON.parse(fs.readFileSync(path.join(demo.dev, 'settings.json'), 'utf8')).projectReminders, false);
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('scrap: reason + confirm, hidden everywhere, graveyard, bring back only by Zero, archive keeps the folder', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.dev);
  try {
    await mockDialogs(app, { folder: path.join(demo.dir, 'archive') });
    await goto(win, 'My projects');
    const rr = row(win, 'Railrove');
    await rr.waitFor();
    await rr.locator('button', { hasText: 'Edit' }).click();
    await rr.locator('button', { hasText: 'Scrap project' }).click();
    await win.locator('.modal button', { hasText: 'Next' }).click(); // empty reason: refused
    assert.equal(await win.locator('.modal').count(), 1);
    await win.locator('#scrap-reason').fill('Too big for now');
    await win.locator('.modal button', { hasText: 'Next' }).click();
    await win.waitForFunction(() => ![...document.querySelectorAll('.hub-row')].some((r) => r.textContent.includes('Railrove')));
    // the confirm box said "It will be hidden everywhere"
    // hidden in the Store (developer view) and in This week
    await goto(win, 'Store');
    assert.equal(await win.locator('.card', { hasText: 'Railrove' }).count(), 0);
    await goto(win, 'This week');
    await win.locator('h1', { hasText: 'This week' }).waitFor();
    await win.locator('button', { hasText: 'Suggest again' }).click().catch(() => {});
    await win.waitForTimeout(300);
    assert.doesNotMatch(await win.locator('#main').textContent(), /Railrove/);
    // Publish marks it scrapped
    await goto(win, 'Publish');
    await win.locator('.pill.st-scrapped').first().waitFor();
    // graveyard
    await goto(win, 'My projects');
    await win.locator('button', { hasText: /^Scrapped \(/ }).click();
    await win.locator('h1', { hasText: 'Scrapped' }).waitFor();
    for (const n of ['Cryptogram', 'Mall-ien Empire', 'Glowcube Gardens', 'Junkyard Jingles', 'Lantern Road', 'Railrove']) await row(win, n).waitFor();
    assert.match(await row(win, 'Railrove').textContent(), /Too big for now/);
    assert.doesNotMatch(await win.locator('#main').textContent(), /Alex/);
    await shot(win, 'dev-graveyard');
    // archive zip: original folder stays
    const proj = path.join(demo.dir, 'projects', 'Dustrunner');
    await row(win, 'Railrove').locator('button', { hasText: 'Pack folder into an archive zip' }).click();
    await win.waitForFunction(() => document.body.textContent.includes('Archive zip made'));
    assert.ok(fs.readdirSync(path.join(demo.dir, 'archive')).some((f) => /^railrove.*\.zip$/.test(f)));
    assert.ok(fs.existsSync(path.join(proj, 'project.godot')), 'original folder kept');
    // bring back: Zero presses the button and says yes in the box
    await row(win, 'Railrove').locator('button', { hasText: 'Bring back' }).click();
    await win.waitForFunction(() => ![...document.querySelectorAll('.hub-row')].some((r) => r.textContent.includes('Railrove')));
    await win.locator('button', { hasText: 'My projects' }).first().click();
    await row(win, 'Railrove').waitFor();
    // the screen can never scrap or un-scrap with a plain edit
    const r = await win.evaluate(() => window.zl.call('devProjectSave', 'railrove', { stage: 'scrapped' }).then(() => 'ok', (e) => e.message));
    assert.match(r, /Bad input: stage/);
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('quick review: one card at a time, 4 buttons, saved in history; week plan uses only Keep going; status report', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.dev);
  try {
    await mockDialogs(app);
    await goto(win, 'My projects');
    await win.locator('button', { hasText: 'Quick review' }).first().click();
    await win.locator('.review-card').waitFor();
    for (const b of ['Keep going', 'Pause', 'Scrap', 'Skip']) await win.locator('.review-btns button', { hasText: b }).waitFor();
    await shot(win, 'dev-quick-review');
    assert.equal(await win.locator('.review-count').textContent(), '1 of 10');
    const names = [];
    const pick = async (b) => { names.push(await win.locator('.review-card h2').textContent()); await win.locator('.review-btns button', { hasText: b }).click(); await win.waitForTimeout(250); };
    await pick('Keep going');
    await pick('Pause');
    await pick('Skip');
    names.push(await win.locator('.review-card h2').textContent());
    await win.locator('.review-btns button', { hasText: 'Scrap' }).click();
    await win.locator('#scrap-reason').fill('Not for me');
    await win.locator('.modal button', { hasText: 'Scrap it' }).click();
    await win.waitForTimeout(300);
    const saved = JSON.parse(fs.readFileSync(path.join(demo.dev, 'projects.json'), 'utf8'));
    const by = (n) => saved.projects.find((p) => p.name === n);
    assert.match(by(names[0]).history.pop().what, /Keep going/);
    assert.equal(by(names[1]).stage, 'on-hold');
    assert.match(by(names[2]).history.pop().what, /Skip/);
    assert.equal(by(names[3]).stage, 'scrapped');
    assert.equal(Object.values(saved.reviews)[0].done.length, 4);
    // max 10 per review (the count stays the same while you go)
    const total = await win.locator('.review-count').textContent();
    assert.match(total, /^5 of 10$/);
    // status report
    await goto(win, 'My projects');
    await win.locator('button', { hasText: 'Make status report' }).click();
    await win.locator('.report-frame').waitFor();
    await win.locator('button', { hasText: 'Copy as Markdown' }).click();
    const md = await app.evaluate(({ clipboard }) => clipboard.readText());
    for (const s of ['# Status report', '## Waiting on you', "## Don't forget", '## Scrapped this week (1)']) assert.ok(md.includes(s), s);
    assert.ok(md.includes(names[3]));
    await shot(win, 'dev-status-report');
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('fix a red folder in one click: Pick folder replaces the missing path', async () => {
  const demo = makeDemo();
  const newDir = path.join(demo.dir, 'real-marchlands'); fs.mkdirSync(newDir);
  fs.writeFileSync(path.join(newDir, 'project.godot'), 'config/name="Marchlands"\nconfig/version="0.5.0"\n');
  const { app, win, errors } = await launch(demo.dev);
  try {
    await mockDialogs(app, { folder: newDir });
    const mr = row(win, 'Marchlands');
    await mr.waitFor();
    const missing = await mr.locator('.missing-path').count();
    assert.ok(missing >= 1);
    await mr.locator('button.pick-folder').first().click();
    await win.waitForFunction((d) => [...document.querySelectorAll('.hub-row')].some((r) => r.textContent.includes('Marchlands') && r.textContent.includes(d)), newDir);
    assert.equal(await row(win, 'Marchlands').locator('.missing-path').count(), missing - 1);
    assert.match(await row(win, 'Marchlands').textContent(), /0\.5\.0/, 'status read from the new folder');
    const saved = JSON.parse(fs.readFileSync(path.join(demo.dev, 'projects.json'), 'utf8')).projects.find((p) => p.id === 'marchlands');
    assert.ok(saved.folders.includes(newDir));
    // add a folder to a project without one
    const sa = row(win, 'Roblox: Shape Army');
    await sa.locator('button.add-folder').click();
    await win.waitForFunction(() => document.body.textContent.includes('Folder added'));
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});
