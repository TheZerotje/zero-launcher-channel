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
    let r = await gh.sync(dir);
    assert.equal(r.uploaded, 1);
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
