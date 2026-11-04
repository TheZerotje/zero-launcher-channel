'use strict';
// HOST: show if Zero's website is up. STATUS ONLY: the launcher never starts, stops or restarts it
// (its start file touches Tailscale / port 8443).
const http = require('http');
const https = require('https');

function isUp(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let lib;
    try { lib = new URL(url).protocol === 'https:' ? https : http; } catch { return resolve(false); }
    const req = lib.get(url, { timeout: timeoutMs }, (res) => { res.resume(); resolve(res.statusCode < 500); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

module.exports = { isUp };
