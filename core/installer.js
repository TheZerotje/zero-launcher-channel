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
    const tmp = this.stateFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.stateFile);
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
    const part = path.join(this.dlDir, `${game.id}-${release.version}.zip.part`);
    const src = resolveFileUrl(channelSource, release.file.url);

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
    state[game.id] = { version: release.version, exe: release.exe, dir: finalDir, installedAt: new Date().toISOString() };
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
    child.on('exit', (code) => { this.running.delete(gameId); onExit && onExit(code); });
    child.on('error', (err) => { this.running.delete(gameId); onExit && onExit(-1, err); });
    child.unref();
    return child.pid;
  }

  isRunning(gameId) { return this.running.has(gameId); }
}

module.exports = { Installer };
