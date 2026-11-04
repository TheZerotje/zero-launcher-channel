'use strict';
// Tester feedback: 1-5 stars + one line, for a TEST version.
// The tester's PC makes a short code ("ZLFB1:...") inside the saved report. The tester sends it to Zero
// (chat, mail) the same way as a problem report. Zero pastes it in Testers -> it is kept in feedback.json
// on Zero's PC only. Nothing is uploaded or published. The code is not signed (low stakes): the account
// ID is shown next to each line, so Zero sees who wrote it.
const { writeJsonAtomic, readJson } = require('./fsutil');
const { ID_RE } = require('./catalogue');
const versions = require('./versions');
const testers = require('./testers');

const PREFIX = 'ZLFB1:';
const MAX_TEXT = 200;
const MAX_KEEP = 2000;
const CODE_RE = /ZLFB1:([A-Za-z0-9_-]{8,1200})/g;

const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

// Check one entry; returns a clean copy or null. Never trusts the input.
function clean(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const { g, v, s, t = '', a = '', at } = e;
  if (typeof g !== 'string' || !ID_RE.test(g)) return null;
  if (typeof v !== 'string' || v.length > 40 || !versions.isValid(v)) return null;
  if (!Number.isInteger(s) || s < 1 || s > 5) return null;
  if (typeof t !== 'string' || t.length > MAX_TEXT) return null;
  if (typeof a !== 'string' || (a && !testers.ID_RE.test(a))) return null;
  if (typeof at !== 'string' || at.length > 40 || Number.isNaN(Date.parse(at))) return null;
  return { g, v, s, t: oneLine(t), a, at: new Date(at).toISOString() };
}

function makeCode(entry) {
  const e = clean({ ...entry, t: oneLine(entry.t) });
  if (!e) throw new Error('Bad feedback');
  return PREFIX + Buffer.from(JSON.stringify(e)).toString('base64url');
}

// Find every feedback code in pasted text. Bad codes are skipped (counted).
function parse(text) {
  const found = []; let bad = 0;
  for (const m of String(text || '').slice(0, 200000).matchAll(CODE_RE)) {
    let e = null;
    try { e = clean(JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))); } catch {}
    e ? found.push(e) : bad++;
  }
  return { found, bad };
}

const key = (e) => `${e.g}|${e.v}|${e.a}|${e.at}`;

class FeedbackStore {
  constructor(file) { this.file = file; }
  all() { const d = readJson(this.file, []); return Array.isArray(d) ? d.map(clean).filter(Boolean) : []; }
  add(text) {
    const { found, bad } = parse(text);
    const list = this.all(); const seen = new Set(list.map(key));
    let added = 0;
    for (const e of found) if (!seen.has(key(e))) { seen.add(key(e)); list.push(e); added++; }
    if (added) writeJsonAtomic(this.file, list.slice(-MAX_KEEP));
    return { added, same: found.length - added, bad };
  }
  remove(at, a) {
    const list = this.all(); const rest = list.filter((e) => !(e.at === at && e.a === a));
    if (rest.length !== list.length) writeJsonAtomic(this.file, rest);
    return list.length - rest.length;
  }
  // grouped by game + version, newest version first; average stars
  grouped() {
    const groups = new Map();
    for (const e of this.all()) {
      const k = `${e.g}|${e.v}`;
      if (!groups.has(k)) groups.set(k, { game: e.g, version: e.v, items: [] });
      groups.get(k).items.push(e);
    }
    return [...groups.values()].map((x) => ({ ...x, items: x.items.sort((p, q) => q.at.localeCompare(p.at)),
      average: Math.round((x.items.reduce((n, e) => n + e.s, 0) / x.items.length) * 10) / 10 }))
      .sort((p, q) => q.items[0].at.localeCompare(p.items[0].at));
  }
}

module.exports = { FeedbackStore, makeCode, parse, clean, stars, oneLine, PREFIX, MAX_TEXT };
