'use strict';
// DEVELOPER "This week": 3-5 goals + a to-do list. A new week starts every Friday 12:00
// (PC local time). The plan is SUGGESTED from "My games" and Zero's focus; Zero edits or presses OK.
const DEFAULT_FOCUS = ['1 new web game per week', 'Railrove', 'D&D World Engine'];

// Start of the week that contains `now`: the last Friday 12:00 local time.
function weekStart(now = new Date()) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  const back = (d.getDay() - 5 + 7) % 7; // 5 = Friday
  d.setDate(d.getDate() - back);
  if (d > now) d.setDate(d.getDate() - 7);
  return d;
}
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function suggest(hub, focus = DEFAULT_FOCUS, skip = []) {
  // skip: names of scrapped / paused projects. A focus that points at one of them is left out.
  const skipped = (f) => skip.some((n) => { const a = String(n).toLowerCase(), b = String(f).toLowerCase(); return a && (a.includes(b) || b.includes(a)); });
  const games = (hub && hub.games) || [];
  const by = (s) => games.filter((g) => g.status === s);
  const find = (re) => games.find((g) => re.test(g.name) || re.test(g.id));
  const goals = [];
  const todos = [];
  for (const f of focus) {
    if (skipped(f)) continue;
    if (/new web game/i.test(f)) {
      const next = by('ready')[0] || by('testing')[0];
      goals.push({ text: next ? `Get 1 web game out: ${next.name}` : 'Pick and start 1 new web game', gameId: next && next.id });
      continue;
    }
    const g = find(new RegExp(f.replace(/[^a-z0-9 ]/gi, '').replace(/\s+/g, '.*'), 'i')) || find(new RegExp(f.split(/\s+/).pop(), 'i'));
    goals.push({ text: g ? `${g.name}: ${g.nextStep || 'next step'}` : f, gameId: g && g.id });
  }
  const nw = by('needs-work');
  if (nw.length) goals.unshift({ text: `Fix released game${nw.length > 1 ? 's' : ''}: ${nw.map((g) => g.name).join(', ')}` });
  for (const g of nw) todos.push({ text: `Fix ${g.name}${g.facts && g.facts.needsWork ? ' (' + g.facts.needsWork.value + ')' : ''}`, gameId: g.id });
  for (const g of by('ready')) todos.push({ text: `Release or give feedback: ${g.name}`, gameId: g.id });
  for (const g of by('coming-soon')) todos.push({ text: `Check ${g.name} goes live OK`, gameId: g.id });
  const play = by('testing').sort((a, b) => (b.changed || '').localeCompare(a.changed || '')).slice(0, 5);
  for (const g of play) todos.push({ text: `Playtest ${g.name} (10 min)`, gameId: g.id });
  return { goals: goals.slice(0, 5).map((x) => ({ ...x, done: false })), todos: todos.slice(0, 12).map((x) => ({ ...x, done: false })) };
}

// Get this week's plan, making a suggestion if there is none yet.
function current(store, hub, focus, now = new Date(), skip = []) {
  const k = key(weekStart(now));
  store.weeks = store.weeks || {};
  if (!store.weeks[k]) store.weeks[k] = { start: k, confirmed: false, madeAt: now.toISOString(), ...suggest(hub, focus, skip) };
  const end = weekStart(now); end.setDate(end.getDate() + 7);
  return { key: k, nextPlan: end.toISOString(), week: store.weeks[k], history: Object.keys(store.weeks).filter((x) => x !== k).sort().reverse().slice(0, 8).map((x) => {
    const w = store.weeks[x]; const all = [...w.goals, ...w.todos];
    return { key: x, done: all.filter((i) => i.done).length, total: all.length, goals: w.goals };
  }) };
}

// Friday 12:00 message "Your new week plan is ready".
// lastKey = the week we last told Zero about. Returns the new week key when a message is due, else null.
// The very first time (no lastKey) we only remember the week, so Zero is not told about a week already running.
function noticeDue(lastKey, now = new Date()) {
  const k = key(weekStart(now));
  if (!lastKey) return { key: k, show: false };
  return k !== lastKey ? { key: k, show: true } : null;
}

module.exports = { weekStart, key, suggest, current, noticeDue, DEFAULT_FOCUS };
