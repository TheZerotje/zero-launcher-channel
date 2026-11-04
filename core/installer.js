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
  async install(channelSource, game, release, { onProgress, signal } = {}) {
    if (game.kind !== 'pc') throw new Error('Only PC games can be installed');
    if (!ID_RE.test(game.id)) throw new Error('Bad game id');
    const report = (stage, done = 0, total = 0) => onProgress && onProgress({ stage, done, total });
    const part = this.partFile(game.id, release.version);
    const src = resolveFileUrl(channelSource, release.file.url);
    let have = 0;
    try { have = fs.statSync(part).size; } catch {}
    this.checkSpace(release.file.size || 0, have);

    report('download');
    await this._fetch(src, part, { onProgress: (d, t) => report('download', d, t || release.file.size), signal });

    report('check');
    const sum = await sha256File(part);
    if (sum !== release.file.sha256) {
      fs.rmSync(part, { force: true });
      const e = new Error('Download broken (check failed). Please try again.');
      e.code = 'BAD_CHECKSUM';
      throw e;
    }

    report('unpack');
    const finalDir = path.join(this.gamesDir, game.id, release.version);
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
    for (const f of fs.readdirSync(this.dlDir)) if (f.startsWith(gameId + '-')) fs.rmSync(path.join(this.dlDir, f), { force: true });
    delete state[gameId];
    this._save(state);
  }

  play(gameId, onExit) {
    const info = this.installed()[gameId];
    if (!info) throw new Error('Game is not installed');
    if (this.running.has(gameId)) return this.running.get(gameId).pid;
    const exe = path.resolve(info.dir, info.exe);
    if (!exe.startsWith(path.resolve(info.dir) + path.sep)) throw new Error('Bad game file');
    const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
    this.running.set(gameId, child);
    const st = this.installed();
    if (st[gameId]) { st[gameId].lastPlayed = new Date().toISOString(); this._save(st); }
    child.on('exit', (code) => { this.running.delete(gameId); onExit && onExit(code); });
    child.on('error', (err) => { this.running.delete(gameId); onExit && onExit(-1, err); });
    child.unref();
    return child.pid;
  }

  isRunning(gameId) { return this.running.has(gameId); }
}

module.exports = { Installer };
