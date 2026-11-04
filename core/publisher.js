'use strict';
// HOST side: Zero's channel folder. Everything new starts "unreleased".
// Nothing becomes "released" unless Zero presses Release (release()).
const fs = require('fs');
const path = require('path');
const { sign } = require('./signing');
const { packFolder, listFiles } = require('./zip');
const { sha256File } = require('./hash');
const versions = require('./versions');
const testers = require('./testers');
const { emptyCatalogue, validate, ID_RE, currentRelease } = require('./catalogue');

class Channel {
  constructor(dir, privateKeyPem, publisher = 'Zero') {
    this.dir = dir;
    this.key = privateKeyPem;
    this.publisher = publisher;
    fs.mkdirSync(path.join(dir, 'packages'), { recursive: true });
    if (!fs.existsSync(this.file)) this._write(emptyCatalogue(publisher));
  }
  get file() { return path.join(this.dir, 'catalogue.json'); }

  read() { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }

  _write(cat) {
    cat.updatedAt = new Date().toISOString();
    const errors = validate(cat);
    if (errors.length) throw new Error('Not saved, catalogue would be broken: ' + errors.join('; '));
    const bytes = Buffer.from(JSON.stringify(cat, null, 2));
    // Write both, then swap in, so players never get a list without a matching signature.
    fs.writeFileSync(this.file + '.tmp', bytes);
    fs.writeFileSync(this.file + '.sig.tmp', sign(bytes, this.key));
    fs.renameSync(this.file + '.tmp', this.file);
    fs.renameSync(this.file + '.sig.tmp', this.file + '.sig');
    return cat;
  }

  _game(cat, id) {
    const g = cat.games.find((x) => x.id === id);
    if (!g) throw new Error(`No game "${id}"`);
    return g;
  }

  upsertGame({ id, name, kind, url, description = '', image = '', owner = 'zero', phoneFriendly }) {
    if (!ID_RE.test(id)) throw new Error('Game id: small letters, numbers and - only (example: railrove)');
    const cat = this.read();
    let g = cat.games.find((x) => x.id === id);
    if (!g) { g = { id, kind, releases: [] }; cat.games.push(g); }
    if (g.kind !== kind) throw new Error(`"${id}" is already a ${g.kind} game`);
    Object.assign(g, { name, description, image, owner });
    if (kind === 'web') g.url = url;
    if (phoneFriendly !== undefined) g.phoneFriendly = !!phoneFriendly;
    return this._write(cat);
  }

  // Pack a build folder as a new UNRELEASED version.
  async addPcRelease({ gameId, buildDir, version, notes = '', exe, packageFile }) {
    if (!versions.isValid(version)) throw new Error('Version looks wrong (example: 0.20.0)');
    const cat = this.read();
    const g = this._game(cat, gameId);
    if (g.kind !== 'pc') throw new Error('Not a PC game');
    if (g.releases.some((r) => r.version === version)) throw new Error(`Version ${version} already exists`);
    const rel = `packages/${gameId}/${gameId}-${version}.zip`;
    const zipPath = path.join(this.dir, rel);
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    if (packageFile) {
      fs.copyFileSync(packageFile, zipPath); // already-packed (friend submission)
    } else {
      const files = listFiles(buildDir);
      if (!exe) exe = files.find((f) => /\.exe$/i.test(f) && !/crash|unins/i.test(f));
      if (!exe || !files.includes(exe)) throw new Error('No game .exe found in the build folder');
      await packFolder(buildDir, zipPath);
    }
    const release = {
      version, notes, exe, state: 'unreleased', addedAt: new Date().toISOString(),
      file: { url: rel, size: fs.statSync(zipPath).size, sha256: await sha256File(zipPath) },
    };
    g.releases.push(release);
    this._write(cat);
    return release;
  }

  // Zero presses "Send to testers".
  toTesters(gameId, version) {
    const cat = this.read();
    const r = this._game(cat, gameId).releases.find((x) => x.version === version);
    if (!r) throw new Error('No such version');
    if (r.state === 'released') throw new Error('Already released to everyone');
    r.state = 'testing';
    r.testingAt = new Date().toISOString();
    this._write(cat);
    return r;
  }

  // Give an account tester rights for some games (replaces its list).
  setTester({ accountId, name, games }) {
    const id = testers.normaliseId(accountId);
    if (!id) throw new Error('Account ID looks wrong (example: SAM-4F2A-9C1B)');
    const cat = this.read();
    const known = new Set(cat.games.map((g) => g.id));
    const bad = (games || []).filter((g) => !known.has(g));
    if (bad.length) throw new Error('Unknown game: ' + bad.join(', '));
    const list = (cat.testers || []).filter((t) => t.accountId !== id);
    list.push({ accountId: id, name: String(name || id).slice(0, 32), games: [...new Set(games || [])], updatedAt: new Date().toISOString() });
    cat.testers = list;
    this._write(cat);
    return id;
  }

  removeTester(accountId) {
    const id = testers.normaliseId(accountId);
    const cat = this.read();
    cat.testers = (cat.testers || []).filter((t) => t.accountId !== id);
    this._write(cat);
  }

  // Zero presses "Release to everyone".
  release(gameId, version) {
    const cat = this.read();
    const r = this._game(cat, gameId).releases.find((x) => x.version === version);
    if (!r) throw new Error('No such version');
    r.state = 'released';
    r.releasedAt = new Date().toISOString();
    this._write(cat);
    return r;
  }

  unrelease(gameId, version) {
    const cat = this.read();
    const r = this._game(cat, gameId).releases.find((x) => x.version === version);
    if (!r) throw new Error('No such version');
    r.state = 'unreleased';
    this._write(cat);
  }

  // "Go back to previous version": pull the newest released; players move to the one before.
  goBack(gameId) {
    const cat = this.read();
    const g = this._game(cat, gameId);
    const cur = currentRelease(g, { role: 'user' });
    if (!cur) throw new Error('Nothing released yet');
    const others = g.releases.filter((r) => r.state === 'released' && r !== cur);
    if (!others.length) throw new Error('There is no older released version to go back to');
    cur.state = 'pulled';
    cur.pulledAt = new Date().toISOString();
    this._write(cat);
    return currentRelease(g, { role: 'user' });
  }

  // News for the Store (signed with the list). Newest first for players.
  addNews({ title, text = '', image = '' }) {
    const cat = this.read();
    const item = { id: `n${Date.now().toString(36)}${require('crypto').randomBytes(3).toString('hex')}`, title: String(title || '').trim(), text: String(text || '').trim(), date: new Date().toISOString() };
    if (image) item.image = String(image).trim();
    cat.news = [item, ...(cat.news || [])].slice(0, 50);
    this._write(cat); // validate() refuses a bad title / text / picture address
    return item;
  }

  removeNews(id) {
    const cat = this.read();
    cat.news = (cat.news || []).filter((n) => n.id !== id);
    this._write(cat);
  }

  setHidden(gameId, hidden) {
    const cat = this.read();
    this._game(cat, gameId).hidden = !!hidden;
    this._write(cat);
  }
}

module.exports = { Channel };
