'use strict';
// Checks for everything the screen sends to the main process (IPC).
// Bad input -> Error('Bad input: <what>'). Never trust what the screen sends.
const fs = require('fs');
const path = require('path');

const GAME_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const VERSION = /^v?\d+(\.\d+){0,4}(-[0-9A-Za-z.]+)?$/;

function bad(what) { const e = new Error('Bad input: ' + what); e.code = 'BAD_INPUT'; return e; }

const V = {
  str(x, what = 'text', max = 300, { allowEmpty = true } = {}) {
    if (typeof x !== 'string' || x.length > max || (!allowEmpty && !x.trim())) throw bad(what);
    return x;
  },
  optStr(x, what, max = 300) { return x === undefined || x === null ? '' : V.str(x, what, max); },
  bool(x, what = 'yes/no') { if (typeof x !== 'boolean') throw bad(what); return x; },
  gameId(x) { if (typeof x !== 'string' || !GAME_ID.test(x)) throw bad('game id'); return x; },
  version(x) { if (typeof x !== 'string' || !VERSION.test(x.trim())) throw bad('version'); return x.trim(); },
  obj(x, what = 'data') { if (!x || typeof x !== 'object' || Array.isArray(x)) throw bad(what); return x; },
  oneOf(x, list, what) { if (!list.includes(x)) throw bad(what); return x; },
  match(x, re, what) { if (typeof x !== 'string' || !re.test(x)) throw bad(what); return x; },
  url(x, what = 'web address', { optional = true, httpsOnly = false } = {}) {
    if (optional && (x === undefined || x === null || x === '')) return '';
    if (typeof x !== 'string' || x.length > 500) throw bad(what);
    let u; try { u = new URL(x); } catch { throw bad(what); }
    if (!(u.protocol === 'https:' || (!httpsOnly && u.protocol === 'http:'))) throw bad(what);
    return x;
  },
  // An absolute path to a folder that exists.
  dir(x, what = 'folder') {
    if (typeof x !== 'string' || x.length > 1000 || !path.isAbsolute(x) || x.includes('\0')) throw bad(what);
    let st; try { st = fs.statSync(x); } catch { throw bad(what + ' (not found)'); }
    if (!st.isDirectory()) throw bad(what);
    return x;
  },
  // An absolute path to a file that exists (optionally with an extension).
  file(x, what = 'file', ext) {
    if (typeof x !== 'string' || x.length > 1000 || !path.isAbsolute(x) || x.includes('\0')) throw bad(what);
    if (ext && path.extname(x).toLowerCase() !== ext) throw bad(what);
    let st; try { st = fs.statSync(x); } catch { throw bad(what + ' (not found)'); }
    if (!st.isFile()) throw bad(what);
    return x;
  },
  list(x, what, max = 100) { if (!Array.isArray(x) || x.length > max) throw bad(what); return x; },
};

module.exports = { V, GAME_ID, VERSION, bad };
