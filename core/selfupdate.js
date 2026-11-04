'use strict';
// Launcher self-update. The signed game list can name a new launcher setup (ZeroLauncherSetup-x.y.z.exe).
// Players only see it when Zero sent it to players, and only when it is NEWER than this launcher.
// The download is SHA-256 checked against the signed list BEFORE it can be started. Nothing runs by itself:
// the player presses the button and says yes.
const fs = require('fs');
const path = require('path');
const versions = require('./versions');
const { resolveFileUrl, LAUNCHER_FILE } = require('./catalogue');
const { downloadTo } = require('./net');
const { sha256File } = require('./hash');

// What the player may update to, or null.
function available(cat, current, { developer = false } = {}) {
  const l = cat && cat.launcher;
  if (!l || !l.file || !LAUNCHER_FILE.test(l.file.url || '') || !versions.isValid(l.version || '')) return null;
  if (!l.released && !developer) return null;
  if (versions.compare(l.version, current) <= 0) return null;
  return { version: l.version, notes: l.notes || '', size: l.file.size, released: !!l.released };
}

// Download into dir, check it, return the checked file. A broken download is removed.
async function download(cat, current, channelSource, dir, { onProgress, signal, developer = false } = {}) {
  const up = available(cat, current, { developer });
  if (!up) throw new Error('No new launcher version');
  const f = cat.launcher.file;
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(f.url));
  if (fs.existsSync(dest) && (await sha256File(dest)) === f.sha256) return dest; // already here and good
  const part = dest + '.part';
  fs.rmSync(part, { force: true });
  const src = resolveFileUrl(channelSource, f.url);
  if (/^https?:\/\//.test(src)) await downloadTo(src, part, { onProgress, signal });
  else { await fs.promises.copyFile(src, part); if (onProgress) onProgress(f.size, f.size); }
  if ((await sha256File(part)) !== f.sha256) {
    fs.rmSync(part, { force: true });
    const e = new Error('Download broken (check failed). Please try again.'); e.code = 'BAD_CHECKSUM'; throw e;
  }
  fs.renameSync(part, dest);
  return dest;
}

module.exports = { available, download };
