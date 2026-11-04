'use strict';
// "Make desktop shortcut": a Windows .lnk on the desktop that starts Zero Launcher and plays the game.
// The shortcut runs the launcher with --play=<game id>; the launcher then starts the game the normal way
// (so updates and checks still happen).
const path = require('path');
const { ID_RE } = require('./catalogue');

const safeFileName = (name) => String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim().slice(0, 60) || 'Game';

function shortcutPlan({ gameId, name, desktop, execPath, appPath, isPackaged, icon }) {
  if (!ID_RE.test(gameId || '')) throw new Error('Bad game id');
  const file = path.join(desktop, safeFileName(name) + '.lnk');
  const args = (isPackaged ? [] : [`"${appPath}"`]).concat(`--play=${gameId}`).join(' ');
  return { file, options: { target: execPath, args, description: `Play ${name} with Zero Launcher`, icon: icon || execPath, iconIndex: 0, appUserModelId: 'com.zero.launcher' } };
}

// Read --play=<id> from the command line (only a valid game id).
function playArg(argv) {
  for (const a of argv || []) {
    const m = /^--play=([a-z0-9][a-z0-9-]{1,40})$/.exec(String(a));
    if (m) return m[1];
  }
  return null;
}

module.exports = { shortcutPlan, playArg, safeFileName };
