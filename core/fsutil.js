'use strict';
// Safe file writes: write a temp file next to it, then rename over the old one.
// A crash or power cut never leaves a half-written file.
const fs = require('fs');
const path = require('path');

let n = 0;
function writeFileAtomic(file, data, opts) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++n}.tmp`;
  try {
    fs.writeFileSync(tmp, data, opts);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function writeJsonAtomic(file, value) {
  writeFileAtomic(file, JSON.stringify(value, null, 2));
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return fallback; }
}

module.exports = { writeFileAtomic, writeJsonAtomic, readJson };
