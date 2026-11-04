'use strict';
// "Back up my launcher data": settings, account, play time, reports (and Zero's project lists) in one zip.
// Games are NOT in it (they download again), and no key files (.pem), developer.json or friend.json:
// a backup can never turn a PC into Zero's PC or a friend host. Zero's secret key has its own backup.
// Loading a backup: safe unpack (no ../), then only the known file names are taken, and each must be
// good JSON. Settings go through the same allowed list as the Settings page.
const fs = require('fs');
const os = require('os');
const path = require('path');
const yazl = require('yazl');
const { unpack } = require('./zip');
const { writeJsonAtomic, writeFileAtomic } = require('./fsutil');

const FILES = ['settings.json', 'account.json', 'playtime.json', 'feedback.json', 'projects.json', 'weekly.json', 'checklists.json'];
const MAX_FILE = 5 * 1024 * 1024;
const MARK = 'zero-launcher-backup.json';

// settingsClean(obj) -> obj with only allowed keys/values (from the app); installRoot is never taken from a backup
function make(dataDir, outZip, { reportRe, settingsClean, version = '' }) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile(); const names = [];
    const add = (name, buf) => { zip.addBuffer(buf, name); names.push(name); };
    for (const f of FILES) {
      const full = path.join(dataDir, f);
      if (!fs.existsSync(full)) continue;
      let data; try { data = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
      if (f === 'settings.json') data = settingsClean(data);
      add(f, Buffer.from(JSON.stringify(data, null, 2)));
    }
    const rdir = path.join(dataDir, 'reports');
    let reports = []; try { reports = fs.readdirSync(rdir).filter((f) => reportRe.test(f)); } catch {}
    for (const f of reports) { const full = path.join(rdir, f); if (fs.statSync(full).size <= MAX_FILE) add('reports/' + f, fs.readFileSync(full)); }
    zip.addBuffer(Buffer.from(JSON.stringify({ app: 'Zero Launcher', version, at: new Date().toISOString(), files: names })), MARK);
    fs.mkdirSync(path.dirname(outZip), { recursive: true });
    const out = fs.createWriteStream(outZip);
    zip.outputStream.pipe(out).on('close', () => resolve(names)).on('error', reject);
    zip.end();
  });
}

// Check a backup without changing anything. Returns { files: Map(name -> Buffer|object), at }.
async function read(zipPath, { reportRe, settingsClean, accountOk }) {
  if (fs.statSync(zipPath).size > 100 * 1024 * 1024) throw new Error('This file is too big to be a launcher backup.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-restore-'));
  try {
    await unpack(zipPath, tmp);
    let mark; try { mark = JSON.parse(fs.readFileSync(path.join(tmp, MARK), 'utf8')); } catch {}
    if (!mark || mark.app !== 'Zero Launcher') throw new Error('This is not a Zero Launcher backup.');
    const files = new Map();
    for (const f of FILES) {
      const full = path.join(tmp, f);
      if (!fs.existsSync(full) || !fs.lstatSync(full).isFile() || fs.statSync(full).size > MAX_FILE) continue;
      let data; try { data = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
      if (data === null || typeof data !== 'object') continue;
      if (f === 'settings.json') data = settingsClean(data);
      if (f === 'account.json' && !accountOk(data)) continue;
      files.set(f, data);
    }
    const rdir = path.join(tmp, 'reports');
    let reports = []; try { reports = fs.readdirSync(rdir).filter((f) => reportRe.test(f)); } catch {}
    for (const f of reports) {
      const full = path.join(rdir, f);
      if (fs.lstatSync(full).isFile() && fs.statSync(full).size <= MAX_FILE) files.set('reports/' + f, fs.readFileSync(full));
    }
    return { files, at: typeof mark.at === 'string' ? mark.at.slice(0, 40) : '' };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Write what read() returned. Settings keep this PC's install folder.
function restore(dataDir, files, { keepSettings = {} } = {}) {
  for (const [name, data] of files) {
    if (name.startsWith('reports/')) { fs.mkdirSync(path.join(dataDir, 'reports'), { recursive: true }); writeFileAtomic(path.join(dataDir, name), data); continue; }
    writeJsonAtomic(path.join(dataDir, name), name === 'settings.json' ? { ...data, ...keepSettings } : data);
  }
  return [...files.keys()];
}

module.exports = { make, read, restore, FILES, MARK };
