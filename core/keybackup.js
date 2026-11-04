'use strict';
// DEVELOPER: "Back up my secret key". Copies Zero's private key file to a folder Zero picks
// (a USB stick). Never uploads it. Refuses folders that get uploaded (the channel folder).
const fs = require('fs');
const path = require('path');

const MONTH = 30 * 86400000;
const inside = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function backupKey({ keyFile, toDir, forbidden = [], now = new Date() }) {
  if (!keyFile || !fs.existsSync(keyFile)) throw new Error('Your secret key file was not found (privateKeyFile in developer.json)');
  if (!toDir || !path.isAbsolute(toDir) || !fs.existsSync(toDir) || !fs.statSync(toDir).isDirectory()) throw new Error('Pick a folder (for example your USB stick)');
  for (const f of forbidden.filter(Boolean)) {
    if (inside(toDir, f)) throw new Error('Not this folder: it gets uploaded or belongs to the app. Pick a USB stick or a private folder.');
  }
  if (path.resolve(toDir) === path.resolve(path.dirname(keyFile))) throw new Error('Pick another place than where the key already is (for example a USB stick).');
  const day = now.toISOString().slice(0, 10);
  let dest = path.join(toDir, `zero-private-backup-${day}.pem`);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(toDir, `zero-private-backup-${day}-${i}.pem`); // never overwrite
  fs.copyFileSync(keyFile, dest, fs.constants.COPYFILE_EXCL);
  try { fs.chmodSync(dest, 0o600); } catch {}
  if (fs.readFileSync(dest).compare(fs.readFileSync(keyFile)) !== 0) throw new Error('The copy is not the same. Try another folder.');
  return { file: dest, at: now.toISOString(), remindAt: new Date(now.getTime() + MONTH).toISOString() };
}

// Warn once a month when there is no backup (or the last one is older than a month).
function backupWarningDue({ lastBackup, lastWarning, now = Date.now() }) {
  const old = !lastBackup || now - Date.parse(lastBackup) > MONTH;
  const warnedRecently = lastWarning && now - Date.parse(lastWarning) < MONTH;
  return old && !warnedRecently;
}

module.exports = { backupKey, backupWarningDue, MONTH };
