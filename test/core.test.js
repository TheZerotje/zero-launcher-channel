'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { generateKeyPair } = require('../core/signing');
const { Channel } = require('../core/publisher');
const { loadChannel, playerView, currentRelease } = require('../core/catalogue');
const { Installer } = require('../core/installer');
const { findUpdates } = require('../core/updater');
const { makeSubmission, FriendInbox } = require('../core/friends');
const testers = require('../core/testers');
const versions = require('../core/versions');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zlt-'));
function fakeBuild(dir, label) {
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'TestGame.exe'), 'fake exe ' + label);
  fs.writeFileSync(path.join(dir, 'data', 'game.pck'), Buffer.alloc(200000, label));
  return dir;
}
function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const f = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
      if (!f.startsWith(dir) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
      const data = fs.readFileSync(f);
      const m = /bytes=(\d+)-/.exec(req.headers.range || '');
      if (m) { res.statusCode = 206; return res.end(data.subarray(Number(m[1]))); }
      res.setHeader('content-length', data.length);
      res.end(data);
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

test('versions compare', () => {
  assert.equal(versions.compare('0.19.12.0', '0.19.9'), 1);
  assert.equal(versions.compare('1.0', '1.0.0'), 0);
  assert.equal(versions.compare('1.0-beta', '1.0'), -1);
  assert.ok(!versions.isValid('abc'));
});

test('full flow: publish, roles, install over http, update, go back, uninstall', async () => {
  const keys = generateKeyPair();
  const chDir = tmp();
  const ch = new Channel(chDir, keys.privateKey);
  ch.upsertGame({ id: 'test-game', name: 'Test Game', kind: 'pc' });
  ch.upsertGame({ id: 'pop-storm', name: 'Pop Storm', kind: 'web', url: 'https://example.com/games/pop-storm/' });
  await ch.addPcRelease({ gameId: 'test-game', buildDir: fakeBuild(tmp(), 'a'), version: '1.0.0', notes: 'first' });

  const srv = await serve(chDir);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    let cat = await loadChannel(base, keys.publicKey);
    // unreleased: only developer sees it
    assert.equal(playerView(cat, 'user').games.find((g) => g.id === 'test-game'), undefined);
    assert.equal(playerView(cat, { role: 'user', testerGames: ['test-game'] }).games.find((g) => g.id === 'test-game'), undefined);
    assert.ok(playerView(cat, 'developer').games.find((g) => g.id === 'test-game'));
    assert.ok(playerView(cat, 'user').games.find((g) => g.id === 'pop-storm'), 'web games always visible');

    ch.toTesters('test-game', '1.0.0');
    cat = await loadChannel(base, keys.publicKey);
    assert.ok(playerView(cat, { role: 'user', testerGames: ['test-game'] }).games.find((g) => g.id === 'test-game'));
    assert.equal(playerView(cat, 'user').games.find((g) => g.id === 'test-game'), undefined);

    ch.release('test-game', '1.0.0');
    cat = await loadChannel(base, keys.publicKey);
    const game = cat.games.find((g) => g.id === 'test-game');
    const inst = new Installer(tmp());
    const stages = [];
    await inst.install(base, game, currentRelease(game), { onProgress: (p) => stages.push(p.stage) });
    assert.deepEqual([...new Set(stages)], ['download', 'check', 'unpack', 'done']);
    const info = inst.installed()['test-game'];
    assert.equal(info.version, '1.0.0');
    assert.ok(fs.existsSync(path.join(info.dir, 'TestGame.exe')));
    assert.equal(findUpdates(cat, inst.installed()).length, 0);

    // v1.1 to testers: user gets no update, tester does
    await ch.addPcRelease({ gameId: 'test-game', buildDir: fakeBuild(tmp(), 'b'), version: '1.1.0' });
    ch.toTesters('test-game', '1.1.0');
    cat = await loadChannel(base, keys.publicKey);
    assert.equal(findUpdates(cat, inst.installed(), { role: 'user' }).length, 0);
    assert.equal(findUpdates(cat, inst.installed(), { role: 'user', testerGames: ['test-game'] }).length, 1);

    ch.release('test-game', '1.1.0');
    cat = await loadChannel(base, keys.publicKey);
    const ups = findUpdates(cat, inst.installed());
    assert.equal(ups.length, 1);
    await inst.install(base, ups[0].game, ups[0].release);
    assert.equal(inst.installed()['test-game'].version, '1.1.0');
    assert.ok(!fs.existsSync(info.dir), 'old version removed after update');

    // go back
    ch.goBack('test-game');
    cat = await loadChannel(base, keys.publicKey);
    const back = findUpdates(cat, inst.installed());
    assert.equal(back[0].release.version, '1.0.0');

    inst.uninstall('test-game');
    assert.equal(inst.installed()['test-game'], undefined);
    assert.ok(!fs.existsSync(path.join(inst.gamesDir, 'test-game')));
  } finally { srv.close(); }
});

test('changed catalogue or wrong key is refused', async () => {
  const keys = generateKeyPair();
  const other = generateKeyPair();
  const dir = tmp();
  const ch = new Channel(dir, keys.privateKey);
  ch.upsertGame({ id: 'abc', name: 'A', kind: 'web', url: 'https://x.y/' });
  await assert.rejects(loadChannel(dir, other.publicKey), { code: 'BAD_SIGNATURE' });
  const f = path.join(dir, 'catalogue.json');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"A"', '"Evil"'));
  await assert.rejects(loadChannel(dir, keys.publicKey), { code: 'BAD_SIGNATURE' });
});

test('broken download is refused and nothing is installed', async () => {
  const keys = generateKeyPair();
  const dir = tmp();
  const ch = new Channel(dir, keys.privateKey);
  ch.upsertGame({ id: 'tg', name: 'T', kind: 'pc' });
  const r = await ch.addPcRelease({ gameId: 'tg', buildDir: fakeBuild(tmp(), 'a'), version: '1.0' });
  ch.release('tg', '1.0');
  const zip = path.join(dir, r.file.url);
  const b = fs.readFileSync(zip); b[b.length - 30] ^= 0xff; fs.writeFileSync(zip, b);
  const cat = await loadChannel(dir, keys.publicKey);
  const inst = new Installer(tmp());
  await assert.rejects(inst.install(dir, cat.games[0], currentRelease(cat.games[0])), { code: 'BAD_CHECKSUM' });
  assert.deepEqual(inst.installed(), {});
  assert.deepEqual(fs.readdirSync(inst.dlDir), []);
});

test('zip with ../ path is refused', async () => {
  const yazl = require('yazl');
  const { unpack } = require('../core/zip');
  const z = new yazl.ZipFile();
  const zp = path.join(tmp(), 'evil.zip');
  z.addBuffer(Buffer.from('x'), 'ok.txt');
  z.addBuffer(Buffer.from('x'), 'a/xx/xx/evil.txt');
  await new Promise((r) => { z.outputStream.pipe(fs.createWriteStream(zp)).on('close', r); z.end(); });
  const raw = fs.readFileSync(zp).toString('latin1').split('a/xx/xx/evil.txt').join('a/../../evil.txt');
  fs.writeFileSync(zp, Buffer.from(raw, 'latin1'));
  const out = tmp();
  await assert.rejects(unpack(zp, path.join(out, 'in')), /Unsafe|invalid relative path/);
  assert.ok(!fs.existsSync(path.join(out, 'evil.txt')));
});

test('friend: submit, wrong key refused, other game refused, approve adds as unreleased, block', async () => {
  const zero = generateKeyPair();
  const friend = generateKeyPair();
  const faker = generateKeyPair();
  const ch = new Channel(tmp(), zero.privateKey);
  const inbox = new FriendInbox(tmp());
  inbox.addFriend({ friendId: 'sam', name: 'Sam', publicKeyPem: friend.publicKey, games: ['sams-game'] });
  const out = tmp();
  const build = fakeBuild(tmp(), 's');

  const good = await makeSubmission({ friendId: 'sam', privateKeyPem: friend.privateKey, gameId: 'sams-game', gameName: "Sam's Game", version: '0.1', buildDir: build, outDir: out });
  const fake = await makeSubmission({ friendId: 'sam', privateKeyPem: faker.privateKey, gameId: 'sams-game', version: '0.2', buildDir: build, outDir: tmp() });
  const notHis = await makeSubmission({ friendId: 'sam', privateKeyPem: friend.privateKey, gameId: 'railrove', version: '9.0', buildDir: build, outDir: tmp() });

  await assert.rejects(inbox.importSubmission(fake), /Signature is wrong/);
  await assert.rejects(inbox.importSubmission(notHis), /may not publish/);
  const sub = await inbox.importSubmission(good);
  assert.equal(inbox.waiting().length, 1);
  assert.equal(ch.read().games.length, 0, 'nothing in catalogue before approve');
  const rel = await inbox.approve(sub.id, ch);
  assert.equal(rel.state, 'unreleased');
  assert.equal(ch.read().games[0].owner, 'sam');
  assert.equal(inbox.waiting().length, 0);

  inbox.setBlocked('sam', true);
  await assert.rejects(inbox.importSubmission(good), /blocked/);
});

test('accounts + tester rights per game', async () => {
  const keys = generateKeyPair();
  const ch = new Channel(tmp(), keys.privateKey);
  ch.upsertGame({ id: 'railrove', name: 'Railrove', kind: 'pc' });
  ch.upsertGame({ id: 'marchlands', name: 'Marchlands', kind: 'pc' });
  for (const id of ['railrove', 'marchlands']) {
    await ch.addPcRelease({ gameId: id, buildDir: fakeBuild(tmp(), id[0]), version: '0.1' });
    ch.toTesters(id, '0.1');
  }
  const sam = testers.makeAccount('Sam');
  assert.match(sam.id, /^SAM-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.throws(() => ch.setTester({ accountId: 'nonsense', games: [] }), /looks wrong/);
  ch.setTester({ accountId: sam.id.toLowerCase(), name: 'Sam', games: ['railrove'] });
  const cat = ch.read();
  const g = testers.testerGames(cat, sam);
  assert.deepEqual(g, ['railrove']);
  const view = playerView(cat, { role: 'user', testerGames: g });
  assert.deepEqual(view.games.map((x) => x.id), ['railrove']);
  assert.equal(view.testers, undefined, 'tester list hidden from players');
  const stranger = testers.makeAccount('Sam');
  assert.deepEqual(testers.testerGames(cat, stranger), [], 'same name, other key = no rights');
  ch.removeTester(sam.id);
  assert.deepEqual(testers.testerGames(ch.read(), sam), []);
});

test('AI helper: parse the box', () => {
  const { parse, commandFor, pretty } = require('../core/aihelper');
  assert.deepEqual(parse('claude, add night mode'), { tool: 'claude', said: 'claude', task: 'add night mode' });
  assert.equal(parse('ChatGPT do Y').tool, 'codex');
  assert.equal(parse('codex: make icons').task, 'make icons');
  assert.equal(parse('hello'), null);
  assert.ok(commandFor('codex', 'x', '/tmp').args.includes('workspace-write'));
  assert.equal(pretty('claude', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })), 'hi');
});

test('GitHub sync against a fake GitHub', async () => {
  const { GitHubChannel } = require('../core/github');
  const keys = generateKeyPair();
  const dir = tmp();
  const ch = new Channel(dir, keys.privateKey);
  ch.upsertGame({ id: 'tg', name: 'T', kind: 'pc' });
  await ch.addPcRelease({ gameId: 'tg', buildDir: fakeBuild(tmp(), 'a'), version: '1.0' });
  const assets = []; let nextId = 1; let rel = null;
  const srv = await new Promise((resolve) => {
    const s = http.createServer(async (req, res) => {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      assert.equal(req.headers.authorization, 'Bearer t0k');
      const u = new URL(req.url, 'http://x');
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && u.pathname.endsWith('/releases/tags/channel')) { if (!rel) { res.statusCode = 404; return res.end('{}'); } return res.end(JSON.stringify(rel)); }
      if (req.method === 'POST' && u.pathname.endsWith('/releases')) { rel = { id: 7 }; return res.end(JSON.stringify(rel)); }
      if (req.method === 'GET' && u.pathname.endsWith('/assets')) return res.end(JSON.stringify(u.searchParams.get('page') === '1' ? assets : []));
      if (req.method === 'POST' && u.pathname.endsWith('/assets')) { const a = { id: nextId++, name: u.searchParams.get('name'), size: body.length }; assets.push(a); return res.end(JSON.stringify(a)); }
      if (req.method === 'DELETE') { const id = Number(u.pathname.split('/').pop()); assets.splice(assets.findIndex((a) => a.id === id), 1); res.statusCode = 204; return res.end(); }
      res.statusCode = 500; res.end('{}');
    }).listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;
    const gh = new GitHubChannel({ repo: 'me/chan', token: 't0k', api: base, uploads: base });
    const steps = [];
    let r = await gh.sync(dir, (text, p) => steps.push({ text, ...p }));
    assert.equal(r.uploaded, 1);
    assert.deepEqual(steps.map((x) => x.done), [0, 1, 2, 3], 'upload progress counts up');
    assert.ok(steps.every((x) => x.total === 3));
    assert.deepEqual(assets.map((a) => a.name).sort(), ['catalogue.json', 'catalogue.json.sig', 'tg-1.0.zip']);
    r = await gh.sync(dir);
    assert.equal(r.uploaded, 0, 'zip not uploaded twice');
    assert.equal(assets.length, 3);
  } finally { srv.close(); }
});

test('My games hub: pc beats notes, you beat pc, released folds, needs-work comes back', () => {
  const { build } = require('../core/gamehub');
  const site = tmp();
  fs.mkdirSync(path.join(site, 'games', 'pop-storm'), { recursive: true });
  fs.writeFileSync(path.join(site, 'games', 'pop-storm', 'game.json'), JSON.stringify({ name: 'Pop Storm', category: 'Puzzle' }));
  fs.mkdirSync(path.join(site, 'games', 'new-one'), { recursive: true });
  fs.writeFileSync(path.join(site, 'games', 'new-one', 'game.json'), JSON.stringify({ name: 'New One' }));
  fs.mkdirSync(path.join(site, 'data'));
  fs.writeFileSync(path.join(site, 'data', 'releases.json'), JSON.stringify({ 'pop-storm': { state: 'released' }, 'new-one': 'unreleased', 'cat-nap': 'coming-soon' }));
  const godot = tmp();
  fs.writeFileSync(path.join(godot, 'project.godot'), 'config/name="Railrove"\nconfig/version="0.19.12.0"\nconfig/features=PackedStringArray("4.7", "Forward Plus")\n');
  fs.mkdirSync(path.join(godot, 'build', 'win'), { recursive: true });
  fs.writeFileSync(path.join(godot, 'build', 'win', 'Railrove.exe'), 'x');
  const seed = { games: [{ id: 'cat-nap', name: 'Cat Nap', kind: 'web', status: 'ready' }, { id: 'railrove', name: 'Railrove', kind: 'godot', status: 'on-hold', version: '0.1' }, { id: 'cryptogram', name: 'Cryptogram', kind: 'web', status: 'scrapped' }] };
  let r = build({ seed, siteDir: site, projects: [{ id: 'railrove', name: 'Railrove', path: godot }, { id: 'ghost', name: 'Ghost', path: '/nope' }] });
  const by = Object.fromEntries(r.games.map((g) => [g.id, g]));
  assert.equal(by['pop-storm'].status, 'released');
  assert.equal(by['cat-nap'].status, 'coming-soon', 'website file beats notes');
  assert.equal(by['new-one'].status, 'testing');
  assert.equal(by.railrove.version, '0.19.12.0', 'project file beats notes');
  assert.equal(by.railrove.kind, 'godot');
  assert.equal(by.railrove.status, 'on-hold');
  assert.match(by.railrove.lastBuild.exe, /Railrove\.exe$/);
  assert.ok(by.ghost.warnings.includes('Folder not found on this PC'));
  assert.equal(r.games[r.games.length - 1].id, 'cryptogram', 'scrapped last');
  r = build({ seed, siteDir: site, marks: { 'pop-storm': { needsWork: 'menu bug' }, railrove: { status: 'building', nextStep: 'world building' } } });
  assert.equal(r.games[0].id, 'pop-storm', 'needs work goes to the top');
  const rr = r.games.find((g) => g.id === 'railrove');
  assert.equal(rr.status, 'building'); assert.equal(rr.statusSource, 'you'); assert.equal(rr.nextStep, 'world building');
});

test('weekly plan: Friday 12:00 weeks, suggestions from games', () => {
  const w = require('../core/weekly');
  assert.equal(w.key(w.weekStart(new Date(2026, 10, 2, 10))), '2026-10-30'); // Mon -> Fri 30 Oct
  assert.equal(w.key(w.weekStart(new Date(2026, 10, 6, 11, 59))), '2026-10-30'); // Fri before noon
  assert.equal(w.key(w.weekStart(new Date(2026, 10, 6, 12, 0))), '2026-11-06'); // Fri noon = new week
  const hub = { games: [
    { id: 'cat-nap', name: 'Cat Nap', status: 'ready' },
    { id: 'railrove', name: 'Railrove', status: 'on-hold', nextStep: 'world building' },
    { id: 'world-engine', name: 'D&D World Engine', status: 'building', nextStep: 'map maker' },
    { id: 'pop-storm', name: 'Pop Storm', status: 'needs-work', facts: { needsWork: { value: 'menu bug' } } },
    { id: 'skyhold', name: 'Skyhold', status: 'testing' },
  ] };
  const s = w.suggest(hub);
  assert.deepEqual(s.goals.map((g) => g.text), ['Fix released game: Pop Storm', 'Get 1 web game out: Cat Nap', 'Railrove: world building', 'D&D World Engine: map maker']);
  assert.ok(s.todos.some((t) => t.text === 'Fix Pop Storm (menu bug)'));
  assert.ok(s.todos.some((t) => t.text === 'Playtest Skyhold (10 min)'));
  const store = {};
  const c1 = w.current(store, hub, undefined, new Date(2026, 10, 2));
  c1.week.goals[0].done = true;
  const c2 = w.current(store, hub, undefined, new Date(2026, 10, 7));
  assert.equal(c2.key, '2026-11-06');
  assert.equal(c2.history[0].done, 1);
});

test('developer sees pulled versions in the list, but never gets them as current', () => {
  const { playerView: pv, currentRelease: cr } = require('../core/catalogue');
  const cat = { format: 1, games: [{ id: 'gamex', kind: 'pc', releases: [
    { version: '1.0', state: 'released' }, { version: '1.1', state: 'pulled' }] }] };
  const dev = pv(cat, { role: 'developer' });
  assert.deepEqual(dev.games[0].releases.map((r) => r.version), ['1.0', '1.1']);
  assert.equal(cr(cat.games[0], { role: 'developer' }).version, '1.0');
  const user = pv(cat, { role: 'user' });
  assert.deepEqual(user.games[0].releases.map((r) => r.version), ['1.0']);
});

test('download queue: one at a time, waiting, pause/resume, cancel', async () => {
  const { DownloadQueue } = require('../core/queue');
  const order = [];
  const gates = {};
  const run = (id, job) => new Promise((resolve, reject) => {
    order.push(id);
    gates[id] = { resolve, job };
    const tick = setInterval(() => { if (job.signal.cancelled) { clearInterval(tick); const e = new Error('Paused'); e.code = 'PAUSED'; reject(e); } }, 5);
    gates[id].done = () => { clearInterval(tick); resolve(); };
  });
  const q = new DownloadQueue(run);
  q.add('a'); q.add('b'); q.add('c');
  assert.equal(q.get('a').stage, 'download');
  assert.equal(q.get('b').stage, 'waiting');
  assert.equal(q.add('b'), false, 'no double add');
  // pause the running one: next one starts
  q.pause('a');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(q.get('a').stage, 'paused');
  assert.equal(q.get('b').stage, 'download');
  // cancel a waiting one
  let removed = null;
  q.cancel('c', (id) => { removed = id; });
  assert.equal(removed, 'c');
  assert.equal(q.get('c'), null);
  // resume a: it waits behind b
  q.resume('a');
  assert.equal(q.get('a').stage, 'waiting');
  gates.b.done();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(q.get('b'), null);
  assert.equal(q.get('a').stage, 'download');
  // cancel the running one
  let gone = null;
  q.cancel('a', (id) => { gone = id; });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(gone, 'a');
  assert.equal(q.list().length, 0);
  assert.deepEqual(order, ['a', 'b', 'a']);
});

test('not enough disk space: clear message, nothing downloaded', async () => {
  const dir = tmp();
  const inst = new Installer(path.join(dir, 'lib'));
  inst.freeBytes = () => 10 * 1048576; // 10 MB free
  const game = { id: 'bigone', kind: 'pc' };
  const release = { version: '1.0', exe: 'a.exe', file: { url: 'x.zip', size: 500 * 1048576, sha256: 'a'.repeat(64) } };
  await assert.rejects(inst.install(dir, game, release), (e) => e.code === 'NO_SPACE' && /needs about \d+ MB/.test(e.message) && /10 MB free/.test(e.message));
  assert.equal(fs.readdirSync(path.join(dir, 'lib', 'downloads')).length, 0);
  assert.ok(Installer.spaceNeeded(100) > 100);
});

test('strings: every screen text has a Dutch version', () => {
  const strings = require('../app/renderer/strings');
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'app.js'), 'utf8');
  const re = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  const missing = [];
  let m;
  while ((m = re.exec(src))) { const k = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"'); if (!(k in strings.NL)) missing.push(k); }
  const help = src.slice(src.indexOf('const HELP'), src.indexOf('P.help'));
  const re2 = /'((?:\\.|[^'])*)'/g;
  while ((m = re2.exec(help))) if (!(m[1] in strings.NL)) missing.push(m[1]);
  const main = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
  const re3 = /\btr\(\s*'((?:\\.|[^'])*)'/g;
  while ((m = re3.exec(main))) if (!(m[1] in strings.NL)) missing.push(m[1]);
  assert.deepEqual(missing, []);
  assert.equal(strings.t('nl', 'Play'), 'Spelen');
  assert.equal(strings.t('en', 'Play'), 'Play');
  assert.equal(strings.t('nl', 'Downloading {pct}%', { pct: 40 }), 'Downloaden 40%');
  assert.equal(strings.t('nl', 'some unknown text'), 'some unknown text');
});

const notWindows = process.platform === 'win32' ? 'the fake Godot is a shell script' : false;
test('Godot export: copies the project, exports headless to temp, never changes the project', { skip: notWindows }, async () => {
  const godot = require('../core/godot');
  const dir = tmp();
  const proj = path.join(dir, 'MyGame');
  fs.mkdirSync(path.join(proj, '.godot'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'project.godot'), 'config/name="My Game"\nconfig/version="1.2.0"\n');
  const fake = path.join(dir, 'godot.sh');
  // fake Godot: writes the exe, and ALSO writes a cache file in the folder it runs in (like real Godot)
  fs.writeFileSync(fake, '#!/bin/sh\nfor a; do out="$a"; done\necho "$@" > args.txt\necho cache > .godot/new-cache\nprintf x > "$out"\n', { mode: 0o755 });
  const before = JSON.stringify(fs.readdirSync(proj, { recursive: true }).sort());
  // no preset: clear message
  await assert.rejects(godot.exportWindows({ godotPath: fake, projectDir: proj }), /no "Windows Desktop" export preset/);
  fs.writeFileSync(path.join(proj, 'export_presets.cfg'), '[preset.0]\nname="Windows Desktop"\n');
  const lines = [];
  const out = await godot.exportWindows({ godotPath: fake, projectDir: proj, gameName: 'My Game', onLine: (l) => lines.push(l) });
  assert.ok(fs.existsSync(path.join(out.buildDir, 'My Game.exe')));
  assert.ok(!godot.isInside(out.buildDir, proj), 'export is outside the project');
  const after = JSON.stringify(fs.readdirSync(proj, { recursive: true }).sort());
  assert.equal(after, JSON.stringify(JSON.parse(before).concat(['export_presets.cfg']).sort()), 'project folder not changed by the export');
  assert.ok(!fs.existsSync(path.join(proj, '.godot', 'new-cache')));
  assert.equal(godot.projectInfo(proj).version, '1.2.0');
  // missing godot / bad project
  await assert.rejects(godot.exportWindows({ godotPath: path.join(dir, 'nope'), projectDir: proj }), /Godot not found/);
  await assert.rejects(godot.exportWindows({ godotPath: fake, projectDir: dir }), /No Godot project/);
  // a failing Godot gives a clear error
  fs.writeFileSync(fake, '#!/bin/sh\necho "ERROR: boom"\nexit 3\n', { mode: 0o755 });
  await assert.rejects(godot.exportWindows({ godotPath: fake, projectDir: proj }), /export failed \(code 3\)[\s\S]*boom/);
});

test('git info is read only: last 5 commits + changes not committed', () => {
  const { gitInfo } = require('../core/gamehub');
  const { execFileSync } = require('child_process');
  const dir = tmp();
  const g = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
  g('init', '-q');
  for (let i = 1; i <= 7; i++) { fs.writeFileSync(path.join(dir, 'f.txt'), String(i)); g('add', '.'); g('commit', '-q', '-m', 'change ' + i); }
  const idx = path.join(dir, '.git', 'index');
  const mtime = fs.statSync(idx).mtimeMs;
  let info = gitInfo(dir);
  assert.equal(info.commits.length, 5);
  assert.equal(info.commits[0].message, 'change 7');
  assert.equal(info.dirty, false);
  fs.writeFileSync(path.join(dir, 'f.txt'), 'edited');
  info = gitInfo(dir);
  assert.equal(info.dirty, true);
  assert.equal(fs.statSync(idx).mtimeMs, mtime, 'git index not touched');
  assert.equal(gitInfo(tmp()), null, 'not a git folder');
});

test('Friday 12:00 week message: once per week, not on the very first run', () => {
  const weekly = require('../core/weekly');
  const thu = new Date(2026, 10, 5, 18, 0); // Thu 5 Nov 2026
  const first = weekly.noticeDue(undefined, thu);
  assert.equal(first.show, false);
  assert.equal(weekly.noticeDue(first.key, thu), null);
  const fri = new Date(2026, 10, 6, 12, 1);
  const due = weekly.noticeDue(first.key, fri);
  assert.equal(due.show, true);
  assert.notEqual(due.key, first.key);
  assert.equal(weekly.noticeDue(due.key, new Date(2026, 10, 7, 9)), null);
  assert.equal(weekly.noticeDue(first.key, new Date(2026, 10, 6, 11, 59)), null, 'not before 12:00');
});

test('AI helper: past jobs list, status and log', () => {
  const { AiHelper } = require('../core/aihelper');
  const root = tmp();
  const mk = (id, job, end, out) => {
    fs.mkdirSync(path.join(root, id));
    fs.writeFileSync(path.join(root, id, 'job.json'), JSON.stringify(job));
    if (end) fs.writeFileSync(path.join(root, id, 'end.json'), JSON.stringify(end));
    fs.writeFileSync(path.join(root, id, 'output.jsonl'), out || '');
  };
  mk('1762000000000-1', { tool: 'claude', said: 'claude', task: 'fix jump', cwd: root, startedAt: '2026-11-01T10:00:00Z' }, { code: 0 },
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'I fixed the jump.' }] } }) + '\n');
  mk('1762000001000-2', { tool: 'codex', said: 'codex', task: 'add menu', cwd: root }, { code: 1 });
  mk('1762000002000-3', { tool: 'claude', task: 'stopped one', cwd: root }, null);
  fs.mkdirSync(path.join(root, 'not-a-job'));
  const ai = new AiHelper(root);
  const h = ai.history();
  assert.deepEqual(h.map((j) => j.status), ['stopped', 'failed', 'done']);
  assert.match(ai.readLog('1762000000000-1'), /I fixed the jump/);
  assert.throws(() => ai.logFile('../../etc'), /Bad job id/);
  assert.throws(() => ai.logFile('1762000009999-9'), /No log/);
});

test('every IPC call has an input check, and checks refuse bad input', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
  const apiBlock = src.slice(src.indexOf('const api = {'), src.indexOf('// ---------------- IPC input checks'));
  const names = [...apiBlock.matchAll(/^ {2}([a-zA-Z]+): /gm)].map((m) => m[1]);
  const checkBlock = src.slice(src.indexOf('const CHECKS = {'), src.indexOf('for (const [name, fn] of Object.entries(api))'));
  const missing = names.filter((n) => !new RegExp(`\\b${n}:`).test(checkBlock));
  assert.ok(names.length > 40, 'found the api list');
  assert.deepEqual(missing, []);
  assert.match(src, /if \(!CHECKS\[name\]\) throw new Error\('Not allowed'\)/, 'calls without a check are refused');
  const { V } = require('../core/validate');
  assert.throws(() => V.gameId('../etc'), /Bad input/);
  assert.throws(() => V.gameId(5), /Bad input/);
  assert.throws(() => V.version('1.0; rm -rf'), /Bad input/);
  assert.throws(() => V.str('x'.repeat(301)), /Bad input/);
  assert.throws(() => V.url('javascript:alert(1)'), /Bad input/);
  assert.throws(() => V.url('http://x', 'pic', { httpsOnly: true }), /Bad input/);
  assert.throws(() => V.dir('relative/path'), /Bad input/);
  assert.throws(() => V.dir(path.join(tmp(), 'nope')), /not found/);
  assert.throws(() => V.file(__filename, 'f', '.zlsub'), /Bad input/);
  assert.equal(V.gameId('railrove'), 'railrove');
  assert.equal(V.version(' 0.20.0 '), '0.20.0');
  assert.equal(V.url(''), '');
});

test('atomic JSON writes leave no temp files and replace the old file', () => {
  const { writeJsonAtomic, readJson } = require('../core/fsutil');
  const dir = tmp();
  const f = path.join(dir, 'a', 'x.json');
  writeJsonAtomic(f, { a: 1 });
  writeJsonAtomic(f, { a: 2 });
  assert.deepEqual(readJson(f), { a: 2 });
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['x.json']);
  // no direct writeFileSync of JSON files left in main.js / core (except temp work folders)
  const main = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /fs\.writeFileSync\(/);
});

test('friends: a bad public key or bad game id is refused', () => {
  const inbox = new FriendInbox(tmp());
  assert.throws(() => inbox.addFriend({ friendId: 'sam', name: 'Sam', publicKeyPem: 'hello', games: ['x-game'] }), /public key looks wrong/);
  const k = generateKeyPair();
  assert.throws(() => inbox.addFriend({ friendId: 'sam', name: 'Sam', publicKeyPem: k.publicKey, games: ['../x'] }), /Game id/);
  assert.ok(inbox.addFriend({ friendId: 'sam', name: 'Sam', publicKeyPem: k.publicKey, games: ['x-game'] }));
});

test('safe start: typed text never becomes a command', async () => {
  const { escapeWinArg, spawnSafe } = require('../core/proc');
  assert.equal(escapeWinArg('a b', false), '^"a^ b^"');
  assert.match(escapeWinArg('x & del *', true), /\^\^&/);
  // Real run: a tool that prints its arguments. On Windows it is a .cmd file (needs cmd.exe).
  const dir = tmp();
  const printer = path.join(dir, 'printargs.js');
  fs.writeFileSync(printer, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
  let cmd;
  if (process.platform === 'win32') {
    cmd = path.join(dir, 'tool.cmd');
    fs.writeFileSync(cmd, `@"${process.execPath}" "${printer}" %*\r\n`);
  } else {
    cmd = path.join(dir, 'tool.sh');
    fs.writeFileSync(cmd, `#!/bin/sh\nexec "${process.execPath}" "${printer}" "$@"\n`, { mode: 0o755 });
  }
  const nasty = ['fix the jump & echo HACKED > hacked.txt', 'say "hi" | more', '100% (done) ^ <ok>', 'C:\\path\\', 'a;b,c'];
  const out = await new Promise((resolve, reject) => {
    const c = spawnSafe(cmd, nasty, { cwd: dir });
    let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('error', reject); c.on('close', () => resolve(o));
  });
  assert.deepEqual(JSON.parse(out), nasty);
  assert.ok(!fs.existsSync(path.join(dir, 'hacked.txt')), 'no command ran');
});

test('offline: last good list is kept and used; a bad list is never cached', async () => {
  const { loadChannelCached, retryDelay } = require('../core/catalogue');
  const keys = generateKeyPair();
  const chDir = tmp(), cache = tmp();
  const ch = new Channel(chDir, keys.privateKey);
  ch.upsertGame({ id: 'webby', name: 'Webby', kind: 'web', url: 'https://x.test/' });
  let r = await loadChannelCached(chDir, keys.publicKey, cache);
  assert.equal(r.offline, false); assert.equal(r.error, null); assert.equal(r.cat.games.length, 1);
  assert.ok(fs.existsSync(path.join(cache, 'catalogue.json')));
  // channel gone (offline)
  r = await loadChannelCached(path.join(chDir, 'gone'), keys.publicKey, cache);
  assert.equal(r.offline, true); assert.ok(r.error); assert.equal(r.cat.games[0].id, 'webby');
  // channel sends a changed list: refused, last good list used, cache NOT replaced
  const f = path.join(chDir, 'catalogue.json');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('Webby', 'Evil'));
  r = await loadChannelCached(chDir, keys.publicKey, cache);
  assert.equal(r.error.code, 'BAD_SIGNATURE'); assert.equal(r.cat.games[0].name, 'Webby');
  assert.match(fs.readFileSync(path.join(cache, 'catalogue.json'), 'utf8'), /Webby/);
  // changed cache file: not used either
  const cf = path.join(cache, 'catalogue.json');
  fs.writeFileSync(cf, fs.readFileSync(cf, 'utf8').replace('Webby', 'Evil'));
  r = await loadChannelCached(path.join(chDir, 'gone'), keys.publicKey, cache);
  assert.equal(r.cat, null); assert.equal(r.offline, false);
  assert.deepEqual([1, 2, 3, 9].map(retryDelay), [60000, 300000, 1800000, 1800000]);
});

test('news: signed with the list, bad news refused', () => {
  const keys = generateKeyPair();
  const ch = new Channel(tmp(), keys.privateKey);
  const a = ch.addNews({ title: 'Hello', text: 'First news' });
  ch.addNews({ title: 'Second', text: 'More', image: 'https://x.test/p.png' });
  let cat = ch.read();
  assert.deepEqual(cat.news.map((n) => n.title), ['Second', 'Hello']);
  assert.throws(() => ch.addNews({ title: '', text: 'x' }), /bad title/);
  assert.throws(() => ch.addNews({ title: 'X', image: 'http://insecure.test/p.png' }), /https/);
  assert.throws(() => ch.addNews({ title: 'X', image: 'javascript:alert(1)' }), /https/);
  assert.throws(() => ch.addNews({ title: 'X', text: 'y'.repeat(601) }), /too long/);
  ch.removeNews(a.id);
  cat = ch.read();
  assert.deepEqual(cat.news.map((n) => n.title), ['Second']);
  // players see news through the signed list only
  const { verifyAndParse } = require('../core/catalogue');
  const bytes = fs.readFileSync(ch.file);
  assert.equal(verifyAndParse(bytes, fs.readFileSync(ch.file + '.sig', 'utf8'), keys.publicKey).news.length, 1);
});

test('game pages: screenshots, trailer, coming soon, launch options, shortcut plan', async () => {
  const { splitArgs } = require('../core/installer');
  assert.deepEqual(splitArgs('--fullscreen --level 2'), ['--fullscreen', '--level', '2']);
  assert.deepEqual(splitArgs('--name "Big Map" \'x y\' ""'), ['--name', 'Big Map', 'x y', '']);
  assert.deepEqual(splitArgs('a & del *'), ['a', '&', 'del', '*'], 'no shell meaning, just words');
  assert.throws(() => splitArgs('"open'), /not closed/);
  const keys = generateKeyPair();
  const ch = new Channel(tmp(), keys.privateKey);
  ch.upsertGame({ id: 'soon-game', name: 'Soon', kind: 'pc' });
  assert.ok(ch.read().games[0].addedAt);
  assert.throws(() => ch.setGameInfo('soon-game', { screenshots: ['http://x.test/a.png'] }), /https/);
  assert.throws(() => ch.setGameInfo('soon-game', { trailer: 'https://evil.test/watch' }), /YouTube/);
  assert.throws(() => ch.setGameInfo('soon-game', { comingSoon: 'next week' }), /coming soon date/);
  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  ch.setGameInfo('soon-game', { screenshots: ['https://x.test/a.png', 'https://x.test/b.png'], trailer: 'https://youtu.be/abc', comingSoon: future });
  const cat = ch.read();
  // no versions yet, but coming soon: players can see it (without anything to install)
  const view = playerView(cat, { role: 'user' });
  assert.equal(view.games.length, 1);
  assert.equal(view.games[0].releases.length, 0);
  ch.setGameInfo('soon-game', { comingSoon: '' });
  assert.equal(playerView(ch.read(), { role: 'user' }).games.length, 0);
  // launch options saved per installed game
  const dir = tmp();
  const inst = new Installer(path.join(dir, 'lib'));
  assert.throws(() => inst.setLaunchArgs('nope', 'x'), /not installed/);
  inst._save({ g1: { version: '1', exe: 'a.exe', dir } });
  assert.equal(inst.setLaunchArgs('g1', '  --big\n--x  '), '--big --x');
  assert.equal(inst.installed().g1.launchArgs, '--big --x');
  inst.setLaunchArgs('g1', '');
  assert.equal(inst.installed().g1.launchArgs, undefined);
  // desktop shortcut
  const { shortcutPlan, playArg, safeFileName } = require('../core/shortcut');
  const p = shortcutPlan({ gameId: 'railrove', name: 'Rail:rove?', desktop: 'C:\\Users\\z\\Desktop', execPath: 'C:\\ZL\\Zero Launcher.exe', isPackaged: true });
  assert.match(p.file, /Railrove\.lnk$/);
  assert.equal(p.options.args, '--play=railrove');
  assert.throws(() => shortcutPlan({ gameId: '../x', name: 'x', desktop: '/d', execPath: '/e' }), /Bad game id/);
  assert.equal(playArg(['x', '--play=railrove']), 'railrove');
  assert.equal(playArg(['--play=../../evil']), null);
  assert.equal(safeFileName('..'), 'Game');
});

test('tester helpers: what to test note, crash rules, Godot log lines', () => {
  const keys = generateKeyPair();
  const ch = new Channel(tmp(), keys.privateKey);
  ch.upsertGame({ id: 'tg', name: 'T', kind: 'pc' });
  ch.read();
  const cat = ch.read(); cat.games[0].releases.push({ version: '1.0', state: 'testing', exe: 'a.exe', file: { url: 'x', size: 1, sha256: 'a'.repeat(64) } });
  ch._write(cat);
  ch.setTestNotes('tg', '1.0', 'Try the new bridge');
  assert.equal(ch.read().games[0].releases[0].testNotes, 'Try the new bridge');
  assert.throws(() => ch.setTestNotes('tg', '1.0', 'x'.repeat(601)), /too long/);
  const crash = require('../core/crash');
  assert.equal(crash.isCrash(1, 5000), true);
  assert.equal(crash.isCrash(0, 5000), false, 'normal close');
  assert.equal(crash.isCrash(1, 3 * 60 * 1000), false, 'after 2 minutes it is not a crash');
  assert.equal(crash.isCrash(null, 100, new Error('ENOENT')), true);
  const appData = tmp();
  const logs = path.join(appData, 'Godot', 'app_userdata', 'Railrove', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'godot.log'), Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n'));
  const f = crash.godotLogFile(appData, ['../evil', 'Railrove']);
  assert.equal(f, path.join(logs, 'godot.log'));
  assert.equal(crash.godotLogFile(appData, ['..', 'a/b']), null);
  const text = crash.crashReport({ gameName: 'Railrove', gameId: 'railrove', version: '0.20.0', code: 3, launcher: '0.3.0', platform: 'win32', logFile: f });
  assert.match(text, /Exit code: 3/);
  assert.match(text, /line 300/);
  assert.match(text, /line 101\n/);
  assert.doesNotMatch(text, /line 100\n/, 'only the last 200 lines');
});
