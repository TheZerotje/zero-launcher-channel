'use strict';
// The launcher log: one short line per event in logs/launcher.log, on this PC only. Nothing is sent anywhere.
// When the file is bigger than 1 MB it moves to launcher.old.log (so at most ~2 MB on disk).
// Secrets never go in: tokens and private keys are blanked before a line is written.
const fs = require('fs');
const path = require('path');

const MAX = 1024 * 1024;
const LINE = 500;
const SECRET = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(token|password|secret|authorization)(["'\s:=]+)[^\s"',]+/gi,
];

function clean(msg) {
  let s = msg instanceof Error ? msg.message : typeof msg === 'string' ? msg : JSON.stringify(msg);
  s = String(s ?? '');
  s = s.replace(SECRET[0], '[hidden key]').replace(SECRET[1], '[hidden]').replace(SECRET[2], '$1$2[hidden]');
  return s.replace(/[\r\n\t]+/g, ' ').slice(0, LINE);
}

class Log {
  constructor(dir, { max = MAX } = {}) { this.dir = dir; this.file = path.join(dir, 'launcher.log'); this.old = path.join(dir, 'launcher.old.log'); this.max = max; }
  write(level, msg, now = new Date()) {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      try { if (fs.statSync(this.file).size > this.max) fs.renameSync(this.file, this.old); } catch {}
      fs.appendFileSync(this.file, `${now.toISOString()} ${level.toUpperCase().padEnd(5)} ${clean(msg)}\n`);
    } catch {} // the log must never break the launcher
  }
  info(m) { this.write('info', m); }
  warn(m) { this.write('warn', m); }
  error(m) { this.write('error', m); }
  // the last part of the log (old file first), for "Copy launcher log"
  tail(bytes = 100000) {
    const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
    const all = read(this.old) + read(this.file);
    if (all.length <= bytes) return all;
    const cut = all.slice(-bytes);
    return cut.slice(cut.indexOf('\n') + 1);
  }
}

module.exports = { Log, clean, MAX };
