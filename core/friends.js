'use strict';
// FRIEND HOST.
// The friend's launcher makes a "submission" file: <game>-<version>.zlsub (a folder-free bundle):
//   a zip with package.zip + submission.json + submission.json.sig (signed with the FRIEND's key).
// Zero's host imports it. It checks: known friend, not blocked, friend owns that game id,
// signature right, checksum right. Then it waits in "Waiting for Zero".
// On Approve it is added to Zero's channel as UNRELEASED (Zero still presses Release).
// Players only ever trust Zero's key, never a friend's key directly.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { sign, verify, fingerprint } = require('./signing');
const { sha256File } = require('./hash');
const { packFolder, unpack, listFiles } = require('./zip');
const versions = require('./versions');
const { ID_RE } = require('./catalogue');

// ---------- friend side ----------
async function makeSubmission({ friendId, privateKeyPem, gameId, gameName, version, notes = '', exe, buildDir, outDir }) {
  if (!ID_RE.test(gameId)) throw new Error('Bad game id');
  if (!versions.isValid(version)) throw new Error('Bad version');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-sub-'));
  try {
    const files = listFiles(buildDir);
    if (!exe) exe = files.find((f) => /\.exe$/i.test(f) && !/crash|unins/i.test(f));
    if (!exe || !files.includes(exe)) throw new Error('No game .exe found in the build folder');
    const pkg = path.join(work, 'package.zip');
    await packFolder(buildDir, pkg);
    const meta = {
      kind: 'zero-launcher-submission', format: 1, friendId, gameId, gameName, version, notes, exe,
      sha256: await sha256File(pkg), size: fs.statSync(pkg).size, madeAt: new Date().toISOString(),
    };
    const bytes = Buffer.from(JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(work, 'submission.json'), bytes);
    fs.writeFileSync(path.join(work, 'submission.json.sig'), sign(bytes, privateKeyPem));
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `${gameId}-${version}.zlsub`);
    await packFolder(work, out);
    return out;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------- Zero's side ----------
class FriendInbox {
  constructor(dir) {
    this.dir = dir;
    this.friendsFile = path.join(dir, 'friends.json');
    this.waitDir = path.join(dir, 'waiting');
    fs.mkdirSync(this.waitDir, { recursive: true });
  }
  friends() { try { return JSON.parse(fs.readFileSync(this.friendsFile, 'utf8')); } catch { return {}; } }
  _saveFriends(f) { fs.writeFileSync(this.friendsFile, JSON.stringify(f, null, 2)); }

  addFriend({ friendId, name, publicKeyPem, games }) {
    if (!ID_RE.test(friendId)) throw new Error('Friend id: small letters, numbers and - only');
    const f = this.friends();
    f[friendId] = { name, publicKey: publicKeyPem, fingerprint: fingerprint(publicKeyPem), games: games || [], blocked: false };
    this._saveFriends(f);
    return f[friendId];
  }
  setBlocked(friendId, blocked) {
    const f = this.friends();
    if (!f[friendId]) throw new Error('Unknown friend');
    f[friendId].blocked = !!blocked;
    this._saveFriends(f);
  }

  async importSubmission(file) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-in-'));
    try {
      await unpack(file, work);
      const bytes = fs.readFileSync(path.join(work, 'submission.json'));
      const sig = fs.readFileSync(path.join(work, 'submission.json.sig'), 'utf8');
      const meta = JSON.parse(bytes.toString('utf8'));
      const friend = this.friends()[meta.friendId];
      if (!friend) throw new Error(`Unknown friend "${meta.friendId}". Add him first.`);
      if (friend.blocked) throw new Error(`${friend.name} is blocked.`);
      if (!verify(bytes, sig, friend.publicKey)) throw new Error('Signature is wrong. This file was not made by ' + friend.name + '.');
      if (!friend.games.includes(meta.gameId)) throw new Error(`${friend.name} may not publish "${meta.gameId}".`);
      if (!ID_RE.test(meta.gameId) || !versions.isValid(meta.version)) throw new Error('Bad game id or version');
      const pkg = path.join(work, 'package.zip');
      if ((await sha256File(pkg)) !== meta.sha256) throw new Error('Package is broken (check failed).');
      const id = `${meta.friendId}--${meta.gameId}--${meta.version}`;
      const dest = path.join(this.waitDir, id);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(dest, { recursive: true });
      fs.copyFileSync(pkg, path.join(dest, 'package.zip'));
      fs.writeFileSync(path.join(dest, 'submission.json'), bytes);
      return { id, ...meta, friendName: friend.name };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  waiting() {
    return fs.readdirSync(this.waitDir).map((id) => {
      try { return { id, ...JSON.parse(fs.readFileSync(path.join(this.waitDir, id, 'submission.json'), 'utf8')) }; } catch { return null; }
    }).filter(Boolean);
  }

  // Approve = add to Zero's channel as unreleased.
  async approve(id, channel) {
    const sub = this.waiting().find((s) => s.id === id);
    if (!sub) throw new Error('Not in the waiting list');
    const friend = this.friends()[sub.friendId];
    if (!friend || friend.blocked) throw new Error('Friend unknown or blocked');
    const cat = channel.read();
    if (!cat.games.find((g) => g.id === sub.gameId)) {
      channel.upsertGame({ id: sub.gameId, name: sub.gameName || sub.gameId, kind: 'pc', owner: sub.friendId, description: `By ${friend.name}` });
    } else if (cat.games.find((g) => g.id === sub.gameId).owner !== sub.friendId) {
      throw new Error('That game id belongs to someone else');
    }
    const pkg = path.join(this.waitDir, id, 'package.zip');
    if ((await sha256File(pkg)) !== sub.sha256) throw new Error('Package changed while waiting');
    const rel = await channel.addPcRelease({ gameId: sub.gameId, version: sub.version, notes: sub.notes, exe: sub.exe, packageFile: pkg });
    fs.rmSync(path.join(this.waitDir, id), { recursive: true, force: true });
    return rel;
  }

  reject(id) {
    if (id.includes('/') || id.includes('\\') || id.includes('..')) throw new Error('Bad id');
    fs.rmSync(path.join(this.waitDir, id), { recursive: true, force: true });
  }
}

module.exports = { makeSubmission, FriendInbox };
