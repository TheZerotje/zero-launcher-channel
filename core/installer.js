'use strict';
// Install / update / uninstall / play PC games on the player's computer.
// Layout (root = %LOCALAPPDATA%\ZeroLauncher by default):
//   games/<id>/<version>/...   the game files
//   downloads/<id>-<version>.zip.part
//   installed.json            { <id>: { version, exe, dir, installedAt } }
// Rules: a download is only unpacked after its SHA-256 matches the catalogue.
// Unpacking goes to a temp folder first, so a broken install never says "installed".
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { downloadTo } = require('./net');
const { sha256File } = require('./hash');
const { unpack } = require('./zip');
const { resolveFileUrl, ID_RE } = require('./catalogue');
const { writeJsonAtomic } = require('./fsutil');

function listAll(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) listAll(f, base, out); else if (e.isFile()) out.push(path.relative(base, f));
  }
  return out;
}

// Split "a b \"c d\"" into ['a', 'b', 'c d'].
function splitArgs(text) {
  const out = []; let cur = ''; let q = null; let any = false;
  for (const ch of String(text || '')) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; any = true; continue; }
    if (/\s/.test(ch)) { if (cur || any) { out.push(cur); cur = ''; any = false; } continue; }
    cur += ch;
  }
  if (q) throw new Error('Launch options: a quote " is not closed');
  if (cur || any) out.push(cur);
  return out;
}

class Installer {
  constructor(root) {
    this.root = root;
    this.gamesDir = path.join(root, 'games');
    this.dlDir = path.join(root, 'downloads');
    this.stateFile = path.join(root, 'installed.json');
    fs.mkdirSync(this.gamesDir, { recursive: true });
    fs.mkdirSync(this.dlDir, { recursive: true });
    this.running = new Map();
  }

  installed() {
    try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch { return {}; }
  }

  _save(state) {
    writeJsonAtomic(this.stateFile, state);
  }

  // Free space on the disk that holds the games (bytes). Can be replaced in tests.
  freeBytes() {
    try { const st = fs.statfsSync(this.root); return st.bavail * st.bsize; } catch { return Infinity; }
  }

  // Space a game needs: the zip + the unpacked files (guess: 2.5 x the zip) + 50 MB room.
  static spaceNeeded(zipSize, alreadyDownloaded = 0) {
    return Math.max(0, zipSize - alreadyDownloaded) + Math.ceil(zipSize * 2.5) + 50 * 1048576;
  }

  checkSpace(zipSize, alreadyDownloaded = 0) {
    const need = Installer.spaceNeeded(zipSize, alreadyDownloaded);
    const free = this.freeBytes();
    if (free < need) {
      const mbs = (n) => Math.ceil(n / 1048576);
      const e = new Error(`Not enough free space. This game needs about ${mbs(need)} MB. You have ${mbs(free)} MB free.`);
      e.code = 'NO_SPACE'; e.need = need; e.free = free;
      throw e;
    }
  }

  partFile(gameId, version) { return path.join(this.dlDir, `${gameId}-${version}.zip.part`); }

  // Remove a half download (after Cancel).
  removePart(gameId, version) {
    if (!ID_RE.test(gameId)) throw new Error('Bad game id');
    fs.rmSync(this.partFile(gameId, version), { force: true });
  }

  // Get a file from a channel (http or folder) into dest.
  async _fetch(src, dest, opts) {
    if (/^https?:\/\//.test(src)) return downloadTo(src, dest, opts);
    await fs.promises.copyFile(src, dest);
    const size = fs.statSync(dest).size;
    if (opts.onProgress) opts.onProgress(size, size);
  }

  // Install (or update to) a release. Old version stays until the new one is ready.
  async install(channelSource, game, release, { onProgress, signal, maxBytesPerSec } = {}) {
    if (game.kind !== 'pc') throw new Error('Only PC games can be installed');
    if (!ID_RE.test(game.id)) throw new Error('Bad game id');
    const report = (stage, done = 0, total = 0) => onProgress && onProgress({ stage, done, total });
    const part = this.partFile(game.id, release.version);
    const src = resolveFileUrl(channelSource, release.file.url);
    let have = 0;
    try { have = fs.statSync(part).size; } catch {}
    this.checkSpace(release.file.size || 0, have);

    report('download');
    await this._fetch(src, part, { onProgress: (d, t) => report('download', d, t || release.file.size), signal, maxBytesPerSec });

    report('check');
    const sum = await sha256File(part);
    if (sum !== release.file.sha256) {
      fs.rmSync(part, { force: true });
      const e = new Error('Download broken (check failed). Please try again.');
      e.code = 'BAD_CHECKSUM';
      throw e;
    }

    report('unpack');
    const prev = this.installed()[game.id];
    const base = prev && prev.base ? prev.base : this.gamesDir; // a moved game keeps its new folder
    const finalDir = path.join(base, game.id, release.version);
    const tmpDir = finalDir + '.installing';
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      await unpack(part, tmpDir);
      if (!fs.existsSync(path.join(tmpDir, release.exe))) throw new Error(`Game file ${release.exe} missing in package`);
      fs.rmSync(finalDir, { recursive: true, force: true });
      fs.renameSync(tmpDir, finalDir);
    } catch (e) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      throw e;
    }
    fs.rmSync(part, { force: true });

    const state = this.installed();
    const old = state[game.id];
    state[game.id] = { ...(old || {}), name: game.name || game.id, version: release.version, exe: release.exe, dir: finalDir, installedAt: new Date().toISOString() };
    this._save(state);
    // Remove the old version only after the new one is safely in place.
    if (old && old.dir && old.dir !== finalDir && !this.running.has(game.id)) {
      fs.rmSync(old.dir, { recursive: true, force: true });
    }
    report('done');
    return state[game.id];
  }

  uninstall(gameId) {
    if (!ID_RE.test(gameId)) throw new Error('Bad game id');
    if (this.running.has(gameId)) throw new Error('Close the game first');
    const state = this.installed();
    fs.rmSync(path.join(this.gamesDir, gameId), { recursive: true, force: true });
    const base = state[gameId] && state[gameId].base;
    if (base && path.isAbsolute(base)) fs.rmSync(path.join(base, gameId), { recursive: true, force: true }); // moved game
    for (const f of fs.readdirSync(this.dlDir)) if (f.startsWith(gameId + '-')) fs.rmSync(path.join(this.dlDir, f), { force: true });
    delete state[gameId];
    this._save(state);
  }

  // Launch options: extra start words for the game (example: --fullscreen --level 2).
  setLaunchArgs(gameId, text) {
    if (!ID_RE.test(gameId)) throw new Error('Bad game id');
    const st = this.installed();
    if (!st[gameId]) throw new Error('Game is not installed');
    const clean = String(text || '').replace(/[\r\n\0]/g, ' ').trim().slice(0, 300);
    splitArgs(clean); // throws on a broken quote
    if (clean) st[gameId].launchArgs = clean; else delete st[gameId].launchArgs;
    this._save(st);
    return clean;
  }

  // onExit(code, error, msRunning)
  play(gameId, onExit) {
    const info = this.installed()[gameId];
    if (!info) throw new Error('Game is not installed');
    if (this.running.has(gameId)) return this.running.get(gameId).pid;
    const exe = path.resolve(info.dir, info.exe);
    if (!exe.startsWith(path.resolve(info.dir) + path.sep)) throw new Error('Bad game file');
    // No shell: the words go straight to the game, they can never run other commands.
    const startedAt = Date.now();
    const child = spawn(exe, splitArgs(info.launchArgs || ''), { cwd: path.dirname(exe), detached: true, stdio: 'ignore', shell: false });
    this.running.set(gameId, child);
    const st = this.installed();
    if (st[gameId]) { st[gameId].lastPlayed = new Date().toISOString(); this._save(st); }
    child.on('exit', (code) => { this.running.delete(gameId); onExit && onExit(code, null, Date.now() - startedAt); });
    child.on('error', (err) => { this.running.delete(gameId); onExit && onExit(-1, err, Date.now() - startedAt); });
    child.unref();
    return child.pid;
  }

  isRunning(gameId) { return this.running.has(gameId); }

  // Move an installed game to another folder: copy, check every file, switch, THEN remove the old copy.
  // If anything fails, the copy is removed and the game stays where it was.
  async moveGame(gameId, newBase) {
    if (!ID_RE.test(gameId)) throw new Error('Bad game id');
    if (this.running.has(gameId)) throw new Error('Close the game first');
    const state = this.installed();
    const info = state[gameId];
    if (!info) throw new Error('Game is not installed');
    if (!path.isAbsolute(newBase) || !fs.existsSync(newBase) || !fs.statSync(newBase).isDirectory()) throw new Error('Pick a folder');
    const from = path.resolve(info.dir);
    // Safety: the old folder must really be this game's version folder (<base>/<game id>/<version>), so the
    // clean-up after the move can never remove anything else.
    if (path.basename(from) !== info.version || path.basename(path.dirname(from)) !== gameId) throw new Error('The game folder looks wrong. Use Repair first.');
    const to = path.resolve(newBase, gameId, info.version);
    if (to === from) throw new Error('The game is already in that folder');
    const rel = path.relative(from, path.resolve(newBase));
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error('Pick a folder outside the game folder');
    const files = listAll(from);
    let size = 0; for (const f of files) size += fs.statSync(path.join(from, f)).size;
    const free = (() => { try { const st = fs.statfsSync(newBase); return st.bavail * st.bsize; } catch { return Infinity; } })();
    if (free < size + 50 * 1048576) throw new Error(`Not enough free space there. The game needs about ${Math.ceil(size / 1048576)} MB.`);
    const tmp = to + '.moving';
    fs.rmSync(tmp, { recursive: true, force: true });
    try {
      for (const f of files) {
        fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
        fs.copyFileSync(path.join(from, f), path.join(tmp, f));
      }
      for (const f of files) { // check: same size and same content
        const a = path.join(from, f), b = path.join(tmp, f);
        if (fs.statSync(a).size !== fs.statSync(b).size || (await sha256File(a)) !== (await sha256File(b))) throw new Error('Copy check failed for ' + f);
      }
      if (fs.existsSync(to)) throw new Error('There is already a game folder there');
      fs.renameSync(tmp, to);
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
    const st = this.installed();
    st[gameId] = { ...st[gameId], dir: to, base: path.resolve(newBase) };
    this._save(st);
    fs.rmSync(from, { recursive: true, force: true }); // only now, after the new copy is checked and saved
    try { fs.rmdirSync(path.dirname(from)); } catch {} // remove the empty game folder, if empty
    return st[gameId];
  }
}

module.exports = { Installer, splitArgs };
