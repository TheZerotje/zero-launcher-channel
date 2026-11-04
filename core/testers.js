'use strict';
// ACCOUNTS + TESTERS (no server, no passwords).
// - Anyone can press "Make account" in the launcher: it makes a private key that never
//   leaves their PC, and a short account ID from it (example SAM-4F2A-9C1B).
// - They send Zero the ID. Zero adds it in the Developer launcher and ticks games.
// - The signed catalogue lists: { accountId, name, games: [...] }.
// - A launcher is a tester for a game only if ITS OWN key's ID is on the list for that game.
const crypto = require('crypto');
const { generateKeyPair, fingerprint } = require('./signing');

const ID_RE = /^[A-Z]{1,4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

function accountId(name, publicKeyPem) {
  const prefix = String(name || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || 'USER';
  const fp = fingerprint(publicKeyPem).toUpperCase();
  return `${prefix}-${fp.slice(0, 4)}-${fp.slice(4, 8)}`;
}

function makeAccount(name) {
  const clean = String(name || '').trim().slice(0, 32);
  if (!clean) throw new Error('Type a name first');
  const keys = generateKeyPair();
  return { name: clean, id: accountId(clean, keys.publicKey), publicKey: keys.publicKey, privateKey: keys.privateKey, madeAt: new Date().toISOString() };
}

function normaliseId(id) {
  const s = String(id || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = /^([A-Z]{1,4})([0-9A-F]{4})([0-9A-F]{4})$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// Which games may this account test?
function testerGames(cat, account) {
  if (!account) return [];
  const t = (cat.testers || []).find((x) => x.accountId === account.id);
  return t ? t.games.slice() : [];
}

module.exports = { makeAccount, accountId, normaliseId, testerGames, ID_RE, _crypto: crypto };
