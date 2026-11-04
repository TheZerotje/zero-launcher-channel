'use strict';
// Small http(s) helpers with redirects (GitHub release files redirect).
const http = require('http');
const https = require('https');
const fs = require('fs');

function get(url, headers = {}, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'ZeroLauncher', ...headers }, timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), headers, redirects - 1));
        return;
      }
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('Network timeout')));
    req.on('error', reject);
  });
}

async function fetchBytes(url) {
  const res = await get(url, { 'Cache-Control': 'no-cache' });
  if (res.statusCode !== 200) {
    res.resume();
    const e = new Error(`Download failed (${res.statusCode}) ${url}`);
    e.code = 'HTTP_' + res.statusCode;
    throw e;
  }
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks);
}

// Wait so the speed stays under the limit. limit = bytes per second (0 / null = no limit).
async function throttle(startedAt, bytesThisRun, limit) {
  if (!limit) return;
  const shouldTake = (bytesThisRun / limit) * 1000;
  const took = Date.now() - startedAt;
  if (shouldTake > took) await new Promise((r) => setTimeout(r, Math.min(shouldTake - took, 2000)));
}

// Download to a file with resume support. onProgress(done, total).
// signal: { cancelled: bool } to pause. maxBytesPerSec: number or function (read live, so a change applies at once).
async function downloadTo(url, dest, { onProgress, signal, maxBytesPerSec } = {}) {
  let start = 0;
  try { start = fs.statSync(dest).size; } catch {}
  const res = await get(url, start ? { Range: `bytes=${start}-` } : {});
  if (res.statusCode === 200 && start) { start = 0; } // server ignored range: restart
  else if (res.statusCode === 416) { res.resume(); return; } // already complete
  else if (res.statusCode !== 200 && res.statusCode !== 206) {
    res.resume();
    throw new Error(`Download failed (${res.statusCode})`);
  }
  const total = start + Number(res.headers['content-length'] || 0);
  const out = fs.createWriteStream(dest, { flags: start ? 'a' : 'w' });
  let done = start;
  const t0 = Date.now(); let thisRun = 0; let lastLimit = null; let tStart = t0;
  try {
    for await (const chunk of res) {
      if (signal && signal.cancelled) { res.destroy(); const e = new Error('Paused'); e.code = 'PAUSED'; throw e; }
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      done += chunk.length;
      if (onProgress) onProgress(done, total);
      const limit = typeof maxBytesPerSec === 'function' ? maxBytesPerSec() : maxBytesPerSec;
      if (limit !== lastLimit) { lastLimit = limit; tStart = Date.now(); thisRun = 0; } // limit changed: start counting again
      thisRun += chunk.length;
      await throttle(tStart, thisRun, limit);
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
}

module.exports = { get, fetchBytes, downloadTo, throttle };
