'use strict';
// Which installed games have a newer released version?
const versions = require('./versions');
const { currentRelease } = require('./catalogue');

function findUpdates(catalogue, installed, viewer = { role: 'user' }) {
  const out = [];
  for (const g of catalogue.games) {
    const have = installed[g.id];
    if (!have || g.kind !== 'pc') continue;
    const rel = currentRelease(g, viewer);
    if (rel && versions.compare(rel.version, have.version) !== 0) {
      // != instead of > so a "go back" (rollback) by Zero also reaches players.
      out.push({ game: g, release: rel, from: have.version });
    }
  }
  return out;
}

// Check every 30 min (+ at start). With Zero's release, players get it within ~1 hour.
const CHECK_EVERY_MS = 30 * 60 * 1000;

module.exports = { findUpdates, CHECK_EVERY_MS };
