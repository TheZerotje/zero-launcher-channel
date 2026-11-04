'use strict';
// Play time + simple badges, kept on this PC only (playtime.json). Nothing is sent anywhere.
// Kept apart from installed.json, so play time stays after an uninstall / reinstall.
const { writeJsonAtomic, readJson } = require('./fsutil');
const { ID_RE } = require('./catalogue');

const HOUR = 3600000;
const MAX_SESSION = 24 * HOUR; // a game left open for days counts as 24 hours at most
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The badges, in the order they are shown. Simple words.
const BADGES = [
  { id: 'first', label: 'First play', test: (p) => p.plays >= 1 },
  { id: 'hour', label: '1 hour played', test: (p) => p.ms >= HOUR },
  { id: 'days5', label: 'Played on 5 days', test: (p) => (p.days || []).length >= 5 },
  { id: 'hours10', label: '10 hours played', test: (p) => p.ms >= 10 * HOUR },
  { id: 'tester', label: 'Tested a test version', test: (p) => !!p.tested },
];

function record(file, gameId, ms, { test = false, now = new Date() } = {}) {
  if (!ID_RE.test(gameId)) throw new Error('Bad game id');
  const all = readJson(file, {}) || {};
  const p = Object.hasOwn(all, gameId) ? all[gameId] : { ms: 0, plays: 0, days: [], first: now.toISOString() };
  p.ms += Math.max(0, Math.min(Number(ms) || 0, MAX_SESSION));
  p.plays += 1;
  p.last = now.toISOString();
  const k = dayKey(now);
  if (!p.days.includes(k)) p.days = [...p.days, k].slice(-400);
  if (test) p.tested = true;
  all[gameId] = p;
  writeJsonAtomic(file, all);
  return summary(p);
}

function summary(p) {
  if (!p) return { ms: 0, plays: 0, badges: [] };
  return { ms: p.ms, plays: p.plays, last: p.last, badges: BADGES.filter((b) => b.test(p)).map((b) => ({ id: b.id, label: b.label })) };
}

function all(file) {
  const d = readJson(file, {}) || {};
  const out = {};
  for (const [id, p] of Object.entries(d)) if (ID_RE.test(id) && p && typeof p.ms === 'number') out[id] = summary(p);
  return out;
}

// "2 h 15 min", "15 min", "less than 1 min"
function pretty(ms) {
  const m = Math.floor((ms || 0) / 60000);
  if (m < 1) return 'less than 1 min';
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

module.exports = { record, summary, all, pretty, BADGES, MAX_SESSION };
