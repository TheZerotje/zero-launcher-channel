'use strict';
// Helpers for end-to-end tests of the REAL app (Playwright + Electron).
// Always muted (ZL_MUTE=1). Every test uses its own throwaway demo folder in the temp folder.
// Nothing here ever touches the real channel on GitHub.
const { _electron } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCREENS = path.join(ROOT, 'docs', 'screens');

// Make fresh demo profiles (dev, player = tester Sam, user = normal player).
function makeDemo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-e2e-'));
  const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'make-demo.js'), dir], { encoding: 'utf8' });
  const samId = out.trim().split(/\s+/).pop();
  return { dir, samId, dev: path.join(dir, 'dev'), player: path.join(dir, 'player'), user: path.join(dir, 'user'), channel: path.join(dir, 'channel') };
}

async function launch(profile, extraEnv = {}) {
  const args = [ROOT];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const app = await _electron.launch({
    executablePath: require('electron'), args,
    env: { ...process.env, ZL_USER_DATA: profile, ZL_MUTE: '1', ...extraEnv },
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 800 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForSelector('#nav button');
  return { app, win, errors };
}

// Answer every confirm box in the main process with the first button ("Yes").
async function mockDialogs(app, { folder, file } = {}) {
  await app.evaluate(({ dialog }, o) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    dialog.showOpenDialog = async (_w, opts) => {
      const isFile = ((opts || _w || {}).properties || []).includes('openFile');
      const p = isFile ? o.file : o.folder;
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
    };
  }, { folder: folder || null, file: file || null });
}

async function goto(win, label) {
  await win.locator('#nav button', { hasText: label }).first().click();
  await win.waitForTimeout(300);
}

async function shot(win, name) {
  fs.mkdirSync(SCREENS, { recursive: true });
  await win.screenshot({ path: path.join(SCREENS, name + '.png') });
}

async function close(app) {
  await app.evaluate(({ app: a }) => { a.isQuitting = true; a.exit(0); }).catch(() => {});
  await app.close().catch(() => {});
}

module.exports = { makeDemo, launch, mockDialogs, goto, shot, close, ROOT, SCREENS };
