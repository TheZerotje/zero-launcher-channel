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

const isHttps = (u) => typeof u === 'string' && u.length <= 500 && /^https:\/\/[^\s"'<>()\\]+$/.test(u);
// Trailer: only YouTube, only https (it opens in the normal browser).
function isTrailer(u) {
  if (!isHttps(u)) return false;
  try { const h = new URL(u).hostname.toLowerCase(); return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(h); } catch { return false; }
}

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
    if (g.screenshots !== undefined && (!Array.isArray(g.screenshots) || g.screenshots.length > 12 || !g.screenshots.every(isHttps))) errors.push(`${g.id}: screenshots must be up to 12 https addresses`);
    if (g.trailer !== undefined && g.trailer !== '' && !isTrailer(g.trailer)) errors.push(`${g.id}: trailer must be a YouTube https address`);
    if (g.comingSoon !== undefined && g.comingSoon !== '' && Number.isNaN(Date.parse(g.comingSoon))) errors.push(`${g.id}: bad coming soon date`);
    for (const r of g.releases || []) {
      if (!versions.isValid(r.version)) errors.push(`${g.id}: bad version ${r.version}`);
      if (!['unreleased', 'testing', 'released', 'pulled'].includes(r.state)) errors.push(`${g.id} ${r.version}: bad state`);
      if (r.testNotes !== undefined && (typeof r.testNotes !== 'string' || r.testNotes.length > 600)) errors.push(`${g.id} ${r.version}: "what to test" too long`);
      if (g.kind === 'pc') {
        if (!r.file || !/^[a-f0-9]{64}$/.test(r.file.sha256 || '')) errors.push(`${g.id} ${r.version}: sha256 missing`);
        if (!r.exe || r.exe.includes('..') || path.isAbsolute(r.exe)) errors.push(`${g.id} ${r.version}: bad exe`);
      }
    }
  }
  const httpsUrl = (u) => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 500;
  if (cat && cat.news !== undefined) {
    if (!Array.isArray(cat.news)) errors.push('news must be a list');
    for (const n of Array.isArray(cat.news) ? cat.news : []) {
      if (!n || typeof n.title !== 'string' || !n.title.trim() || n.title.length > 80) errors.push('news: bad title');
      else if (typeof n.text !== 'string' || n.text.length > 600) errors.push(`news "${n.title}": text too long`);
      else if (!n.date || Number.isNaN(Date.parse(n.date))) errors.push(`news "${n.title}": bad date`);
      else if (n.image && !httpsUrl(n.image)) errors.push(`news "${n.title}": picture must be an https address`);
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
      .filter((g) => g.kind === 'web' || g.releases.length > 0 || (g.comingSoon && Date.parse(g.comingSoon) > Date.now() - 86400000)),
  };
}

// Check the signature, then parse + validate. Throws BAD_SIGNATURE / BAD_CATALOGUE.
function verifyAndParse(bytes, sig, publicKeyPem) {
  if (!verify(bytes, String(sig), publicKeyPem)) {
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

async function readChannelFiles(source) {
  const read = async (name) => {
    if (/^https?:\/\//.test(source)) return fetchBytes(source.replace(/\/$/, '') + '/' + name);
    return fs.promises.readFile(path.join(source, name));
  };
  const bytes = await read('catalogue.json');
  const sig = (await read('catalogue.json.sig')).toString('utf8');
  return { bytes, sig };
}

// Load + verify a channel. source = folder path or http(s) base address.
async function loadChannel(source, publicKeyPem) {
  const { bytes, sig } = await readChannelFiles(source);
  return verifyAndParse(bytes, sig, publicKeyPem);
}

// Same, but keeps the last GOOD list on disk (cacheDir). If the channel can't be reached, or sends a
// list that fails the check, the last good list is used (checked again with Zero's key).
// Returns { cat, offline, error } - error is the reason the fresh list was not used.
async function loadChannelCached(source, publicKeyPem, cacheDir) {
  const cBytes = path.join(cacheDir, 'catalogue.json'), cSig = path.join(cacheDir, 'catalogue.json.sig');
  try {
    const { bytes, sig } = await readChannelFiles(source);
    const cat = verifyAndParse(bytes, sig, publicKeyPem);
    try {
      const { writeFileAtomic } = require('./fsutil');
      writeFileAtomic(cBytes, bytes); writeFileAtomic(cSig, sig);
    } catch {}
    return { cat, offline: false, error: null };
  } catch (error) {
    let cat = null;
    try { cat = verifyAndParse(fs.readFileSync(cBytes), fs.readFileSync(cSig, 'utf8'), publicKeyPem); } catch {}
    return { cat, offline: !!cat, error };
  }
}

// Wait time before trying again after a failed check: 1 min, 5 min, then 30 min.
function retryDelay(failures) {
  return [60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000][Math.min(Math.max(failures, 1), 3) - 1];
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

module.exports = { isHttps, isTrailer, statesFor, FORMAT, ID_RE, emptyCatalogue, validate, currentRelease, playerView, loadChannel, loadChannelCached, verifyAndParse, retryDelay, resolveFileUrl };
