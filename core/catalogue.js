'use strict';
// The catalogue = the list of games players see.
// It lives in a "channel": a plain folder (or web address) with
//   catalogue.json      the list
//   catalogue.json.sig  Zero's signature over the exact bytes of catalogue.json
//   packages/<id>/<id>-<version>.zip
// Players fetch it, check the signature, and only show RELEASED versions.
const fs = require('fs');
const path = require('path');
const { verify } = require('./signing');
const versions = require('./versions');
const { fetchBytes } = require('./net');

const FORMAT = 1;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

function emptyCatalogue(publisher) {
  return { format: FORMAT, publisher, updatedAt: new Date().toISOString(), games: [] };
}

function validate(cat) {
  const errors = [];
  if (!cat || cat.format !== FORMAT) errors.push('unknown catalogue format');
  if (!Array.isArray(cat && cat.games)) errors.push('games missing');
  for (const g of (cat && cat.games) || []) {
    if (!ID_RE.test(g.id || '')) errors.push(`bad game id ${g.id}`);
    if (!['pc', 'web'].includes(g.kind)) errors.push(`${g.id}: bad kind`);
    if (g.kind === 'web' && !/^https?:\/\//.test(g.url || '')) errors.push(`${g.id}: web game needs url`);
    for (const r of g.releases || []) {
      if (!versions.isValid(r.version)) errors.push(`${g.id}: bad version ${r.version}`);
      if (!['unreleased', 'testing', 'released', 'pulled'].includes(r.state)) errors.push(`${g.id} ${r.version}: bad state`);
      if (g.kind === 'pc') {
        if (!r.file || !/^[a-f0-9]{64}$/.test(r.file.sha256 || '')) errors.push(`${g.id} ${r.version}: sha256 missing`);
        if (!r.exe || r.exe.includes('..') || path.isAbsolute(r.exe)) errors.push(`${g.id} ${r.version}: bad exe`);
      }
    }
  }
  for (const t of (cat && cat.testers) || []) {
    if (!/^[A-Z]{1,4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(t.accountId || '') || !Array.isArray(t.games)) errors.push('bad tester entry');
  }
  return errors;
}

// VIEWERS: { role: 'developer' } sees everything.
//          { role: 'user', testerGames: ['railrove'] } sees released, plus TESTING
//          versions of only the games Zero ticked for this account.
function statesFor(game, viewer) {
  const v = typeof viewer === 'string' ? { role: viewer } : (viewer || { role: 'user' });
  if (v.role === 'developer') return ['unreleased', 'testing', 'released'];
  if ((v.testerGames || []).includes(game.id)) return ['testing', 'released'];
  return ['released'];
}

// Newest version this viewer gets, or null.
function currentRelease(game, viewer) {
  const ok = statesFor(game, viewer);
  const rel = (game.releases || []).filter((r) => ok.includes(r.state));
  rel.sort((a, b) => versions.compare(b.version, a.version));
  return rel[0] || null;
}

// What a viewer is allowed to see. The developer also sees pulled versions (to know what went back).
function playerView(cat, viewer) {
  const dev = (typeof viewer === 'string' ? viewer : viewer && viewer.role) === 'developer';
  return {
    ...cat,
    testers: dev ? cat.testers : undefined,
    games: cat.games
      .filter((g) => dev || !g.hidden)
      .map((g) => ({ ...g, releases: (g.releases || []).filter((r) => (dev && r.state === 'pulled') || statesFor(g, viewer).includes(r.state)) }))
      .filter((g) => g.kind === 'web' || g.releases.length > 0),
  };
}

// Load + verify a channel. source = folder path or http(s) base address.
async function loadChannel(source, publicKeyPem) {
  const read = async (name) => {
    if (/^https?:\/\//.test(source)) return fetchBytes(source.replace(/\/$/, '') + '/' + name);
    return fs.promises.readFile(path.join(source, name));
  };
  const bytes = await read('catalogue.json');
  const sig = (await read('catalogue.json.sig')).toString('utf8');
  if (!verify(bytes, sig, publicKeyPem)) {
    const e = new Error('Catalogue signature is wrong. Refusing to use it.');
    e.code = 'BAD_SIGNATURE';
    throw e;
  }
  const cat = JSON.parse(bytes.toString('utf8'));
  const errors = validate(cat);
  if (errors.length) {
    const e = new Error('Catalogue is broken: ' + errors.join('; '));
    e.code = 'BAD_CATALOGUE';
    throw e;
  }
  return cat;
}

// Turn a release's file url (may be relative to the channel) into a full address/path.
function resolveFileUrl(source, fileUrl) {
  if (/^https?:\/\//.test(fileUrl)) return fileUrl;
  if (/^https?:\/\//.test(source)) {
    // GitHub release assets are flat: packages/railrove/railrove-1.0.zip -> railrove-1.0.zip
    if (/\/releases\/download\//.test(source)) return source.replace(/\/$/, '') + '/' + fileUrl.split('/').pop();
    return source.replace(/\/$/, '') + '/' + fileUrl.replace(/^\//, '');
  }
  return path.join(source, fileUrl);
}

module.exports = { statesFor, FORMAT, ID_RE, emptyCatalogue, validate, currentRelease, playerView, loadChannel, resolveFileUrl };
