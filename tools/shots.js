// Screenshots of the real app (muted, offscreen-ish under xvfb).
const { _electron } = require('playwright');
const path = require('path');
const out = process.argv[2]; const profile = process.argv[3]; const pagesArg = (process.argv[4] || '').split(',');
(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), '--no-sandbox'], env: { ...process.env, ZL_USER_DATA: profile, ZL_MUTE: '1' } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 800 });
  win.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
  win.on('pageerror', (e) => console.log('page error:', e.message));
  await win.waitForTimeout(2500);
  for (const p of pagesArg) {
    if (!p) continue;
    const [label, action] = p.split(':');
    if (label !== 'start') await win.locator('#nav button', { hasText: label }).first().click();
    if (action === 'get') { await win.locator('button', { hasText: 'Get game' }).first().click(); await win.waitForTimeout(3000); }
    if (action === 'install') { await win.locator('button', { hasText: 'Install' }).first().click(); await win.waitForTimeout(2500); }
    await win.waitForTimeout(1200);
    await win.screenshot({ path: path.join(out, `${label.replace(/\W+/g, '-').toLowerCase()}${action ? '-' + action : ''}.png`) });
  }
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
})().catch((e) => { console.error(e); process.exit(1); });
