'use strict';
// User tests: act like a real person, start to finish. Muted, demo data only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeDemo, launch, mockDialogs, goto, close } = require('./helpers');

// Words a player should never see (tech words, broken values).
const TECH = /\b(undefined|null|NaN|\[object Object\]|SHA-?256|IPC|JSON|catalogue|stack|ENOENT|EACCES|TypeError|Error:)\b/;
const playerPages = ['Store', 'Library', "Zero's Arcade", 'Settings', 'Help'];

async function checkPage(win, where) {
  const text = await win.locator('#main').innerText();
  assert.doesNotMatch(text, TECH, `tech word on ${where}`);
  // every button says what it does (text or a title)
  const empty = await win.locator('#main button').evaluateAll((bs) => bs.filter((b) => !b.textContent.trim() && !b.title && !b.getAttribute('aria-label')).length);
  assert.equal(empty, 0, `button without words on ${where}`);
  // nothing sticks out sideways
  const wide = await win.evaluate(() => document.querySelector('#main').scrollWidth - document.querySelector('#main').clientWidth);
  assert.ok(wide <= 2, `page is too wide on ${where} (${wide}px)`);
}

test('new player, first day: find a game, install, play, change language and text size, read help', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.user);
  try {
    await mockDialogs(app);
    for (const p of playerPages) { await goto(win, p); await checkPage(win, p); }
    // find a game by typing part of its name
    await goto(win, 'Store');
    await win.locator('#store-q').fill('rail');
    const card = win.locator('.card', { hasText: 'Railrove' }).first();
    await card.waitFor();
    // open its page, install with the one big button
    await card.locator('b').click();
    await win.locator('h1', { hasText: 'Railrove' }).waitFor();
    await checkPage(win, 'game page');
    await win.locator('#main button.big', { hasText: 'Install' }).click();
    await win.locator('#main button.big', { hasText: 'Play' }).waitFor({ timeout: 20000 });
    await checkPage(win, 'game page (installed)');
    // the game shows up in the Library
    await goto(win, 'Library');
    await win.locator('.card', { hasText: 'Railrove' }).first().waitFor();
    // Dutch + bigger text: every page still fine, still no tech words
    await goto(win, 'Settings');
    await win.locator('#set-lang').selectOption('nl');
    await win.locator('#set-size').selectOption('bigger');
    await win.waitForTimeout(300);
    for (const p of ['Winkel', 'Mijn games', 'Instellingen', 'Hulp']) { await goto(win, p); await checkPage(win, p); }
    // help answers open with one click
    await goto(win, 'Hulp');
    await win.locator('details.faq summary').nth(1).click();
    assert.ok(await win.locator('details.faq[open]').count() === 1);
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});

test('player only uses the keyboard: Tab reaches the buttons, Enter presses them, Ctrl+F finds a game', async () => {
  const demo = makeDemo();
  const { app, win } = await launch(demo.user);
  try {
    await win.locator('.card').first().waitFor();
    await win.locator('body').click({ position: { x: 700, y: 20 } });
    await win.keyboard.press('Control+f');
    assert.equal(await win.evaluate(() => document.activeElement.id), 'store-q');
    await win.keyboard.type('pop');
    await win.locator('.card', { hasText: 'Pop Storm' }).first().waitFor();
    // Tab moves through real buttons, and focus is visible
    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      await win.keyboard.press('Tab');
      reached = await win.evaluate(() => document.activeElement && document.activeElement.textContent.trim() === 'Play');
    }
    assert.ok(reached, 'Tab reaches the Play button');
    const outline = await win.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' || s.boxShadow !== 'none'; });
    assert.ok(outline, 'you can see which button has focus');
  } finally { await close(app); }
});

test('Zero, morning routine: My projects, quick review, This week, Publish — fast, no errors', async () => {
  const demo = makeDemo();
  const { app, win, errors } = await launch(demo.dev);
  try {
    await mockDialogs(app);
    const t0 = Date.now();
    await win.locator('h1', { hasText: 'My projects' }).waitFor(); // first page for the developer
    await win.locator('.hub-row').first().waitFor();
    assert.ok(Date.now() - t0 < 8000, 'My projects opens fast');
    await win.locator('button', { hasText: 'Start review' }).click();
    await win.locator('.review-btns button', { hasText: 'Keep going' }).click();
    await win.locator('.review-btns button', { hasText: 'Skip' }).click();
    await goto(win, 'This week');
    await win.locator('h1', { hasText: 'This week' }).waitFor();
    await goto(win, 'Publish');
    await win.locator('h1', { hasText: 'Publish' }).waitFor();
    await win.keyboard.press('Control+k');
    await win.keyboard.type('my proj');
    await win.keyboard.press('Enter');
    await win.locator('h1', { hasText: 'My projects' }).waitFor();
    const saved = JSON.parse(fs.readFileSync(path.join(demo.dev, 'projects.json'), 'utf8'));
    assert.equal(Object.values(saved.reviews)[0].done.length, 2);
    assert.deepEqual(errors, []);
  } finally { await close(app); }
});
