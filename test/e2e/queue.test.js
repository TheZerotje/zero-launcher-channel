'use strict';
// Download line in the real app: one at a time, Waiting, Pause/Resume, Cancel.
// The demo channel is served over a SLOW local web server so we can see each step.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { makeDemo, launch, shot, close } = require('./helpers');
const { Channel } = require('../../core/publisher');

function slowServer(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const f = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
      if (!f.startsWith(dir) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.statusCode = 404; return res.end(); }
      let data = fs.readFileSync(f);
      const m = /bytes=(\d+)-/.exec(req.headers.range || '');
      if (m) { data = data.subarray(Number(m[1])); res.statusCode = 206; }
      res.setHeader('content-length', data.length);
      if (!f.endsWith('.zip')) return res.end(data);
      let i = 0;
      const step = () => {
        if (res.destroyed) return;
        if (i >= data.length) return res.end();
        res.write(data.subarray(i, i + 32)); i += 32;
        setTimeout(step, 50);
      };
      step();
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

test('download line: waiting, pause, resume, cancel', async () => {
  const demo = makeDemo();
  const ch = new Channel(demo.channel, fs.readFileSync(path.join(demo.dir, 'zero-private.pem'), 'utf8'));
  ch.release('marchlands', '0.4.4.0'); // throwaway local demo channel only
  const srv = await slowServer(demo.channel);
  const s = JSON.parse(fs.readFileSync(path.join(demo.user, 'settings.json'), 'utf8'));
  s.channelUrl = `http://127.0.0.1:${srv.address().port}`;
  fs.writeFileSync(path.join(demo.user, 'settings.json'), JSON.stringify(s));
  const { app, win, errors } = await launch(demo.user);
  const card = (n) => win.locator('.card', { hasText: n }).first();
  try {
    await card('Marchlands').waitFor();
    await card('Railrove').locator('button', { hasText: 'Install' }).click();
    await card('Marchlands').locator('button', { hasText: 'Install' }).click();
    await card('Railrove').locator('text=Downloading').waitFor();
    await card('Marchlands').locator('text=Waiting').waitFor();
    await shot(win, 'player-download-line');
    await card('Railrove').locator('button', { hasText: 'Pause' }).click();
    await card('Railrove').locator('text=Paused').waitFor();
    await card('Marchlands').locator('text=Downloading').waitFor();
    // Cancel the running one: its half file is removed.
    await card('Marchlands').locator('button', { hasText: 'Cancel' }).click();
    await card('Marchlands').locator('button', { hasText: 'Install' }).waitFor();
    await win.waitForTimeout(300);
    const dl = path.join(demo.user, 'library', 'downloads');
    assert.ok(!fs.readdirSync(dl).some((f) => f.startsWith('marchlands-')), 'half file removed');
    assert.ok(fs.readdirSync(dl).some((f) => f.startsWith('railrove-')), 'paused one keeps its half file');
    await card('Railrove').locator('button', { hasText: 'Resume' }).click();
    await card('Railrove').locator('button', { hasText: 'Play' }).waitFor({ timeout: 30000 });
    assert.deepEqual(errors, []);
  } finally { await close(app); srv.close(); }
});
