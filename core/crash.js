'use strict';
// Crash reports. A game "crashed" when it closed with an error within 2 minutes of starting.
// The report holds: game, version, exit code, and the last 200 lines of the newest Godot log (if any):
//   %APPDATA%\Godot\app_userdata\<game name>\logs\godot.log
// Nothing is sent by itself: the player sees the report first and chooses.
const fs = require('fs');
const path = require('path');

const CRASH_WINDOW_MS = 2 * 60 * 1000;

function isCrash(code, msRunning, error) {
  if (error) return true;
  return code !== 0 && code !== null && msRunning < CRASH_WINDOW_MS;
}

// Safe folder name for app_userdata (no "..", no slashes).
const safeName = (n) => { const s = String(n || '').trim(); return s && !/[\\/:*?"<>|\0]/.test(s) && s !== '.' && s !== '..' ? s : null; };

// Newest Godot log for this game, trying the given names (game name, exe name).
function godotLogFile(appData, names) {
  let best = null;
  for (const n of names) {
    const name = safeName(n);
    if (!name) continue;
    const dir = path.join(appData, 'Godot', 'app_userdata', name, 'logs');
    let files; try { files = fs.readdirSync(dir).filter((f) => /^godot.*\.log$/i.test(f)); } catch { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      try { const m = fs.statSync(full).mtimeMs; if (!best || m > best.m) best = { file: full, m }; } catch {}
    }
  }
  return best ? best.file : null;
}

function lastLines(file, n = 200, maxBytes = 512 * 1024) {
  const st = fs.statSync(file);
  const start = Math.max(0, st.size - maxBytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8').split(/\r?\n/).slice(-n).join('\n');
  } finally { fs.closeSync(fd); }
}

function crashReport({ gameName, gameId, version, code, launcher, platform, account, logFile }) {
  const lines = [
    'Zero Launcher crash report',
    `Game: ${gameName} (${gameId})`,
    `Version: ${version || '-'}`,
    `Exit code: ${code}`,
    `Launcher: ${launcher} on ${platform}`,
    `Account: ${account || '-'}`,
    `Time: ${new Date().toISOString()}`,
    '',
  ];
  if (logFile) { lines.push(`--- last 200 lines of ${path.basename(logFile)} ---`); lines.push(lastLines(logFile, 200)); }
  else lines.push('(No Godot log file found.)');
  return lines.join('\n');
}

module.exports = { isCrash, godotLogFile, lastLines, crashReport, CRASH_WINDOW_MS, safeName };
