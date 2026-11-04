// Makes a demo Developer profile + player profile in a folder, for screenshots and tests.
const fs = require('fs'); const path = require('path');
const { generateKeyPair } = require('../core/signing');
const { Channel } = require('../core/publisher');
const testers = require('../core/testers');
const { FriendInbox, makeSubmission } = require('../core/friends');
(async () => {
  const root = path.resolve(process.argv[2] || 'demo');
  fs.rmSync(root, { recursive: true, force: true });
  const k = generateKeyPair();
  // dev = Zero (developer), player = Sam (tester for Railrove), user = a normal player (no account).
  const dev = path.join(root, 'dev'), player = path.join(root, 'player'), user = path.join(root, 'user'), chDir = path.join(root, 'channel');
  for (const d of [dev, player, user]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(root, 'zero-private.pem'), k.privateKey);
  fs.writeFileSync(path.join(root, 'zero-public.pem'), k.publicKey);
  const ch = new Channel(chDir, k.privateKey);
  const build = (label, n) => { const d = path.join(root, 'builds', label); fs.mkdirSync(path.join(d, 'data'), { recursive: true }); fs.writeFileSync(path.join(d, 'Game.exe'), `#!/bin/sh\n# fake game ${label}\nsleep 1\n`); fs.writeFileSync(path.join(d, 'data', 'game.pck'), Buffer.alloc(n, 1)); return d; };
  ch.upsertGame({ id: 'railrove', name: 'Railrove', kind: 'pc', description: 'Build a moving train base and cross a wild world.' });
  ch.upsertGame({ id: 'marchlands', name: 'Marchlands', kind: 'pc', description: 'Lead a medieval warband across the marches.' });
  ch.upsertGame({ id: 'pop-storm', name: 'Pop Storm', kind: 'web', url: 'http://127.0.0.1:4599/', description: 'Pop bubbles, chain storms.' });
  ch.upsertGame({ id: 'cogspire', name: 'Cogspire', kind: 'web', url: 'http://127.0.0.1:4599/', description: 'Tower building with gears.' });
  await ch.addPcRelease({ gameId: 'railrove', buildDir: build('rr19', 3000000), version: '0.19.12.0', notes: 'Crane feel' });
  ch.release('railrove', '0.19.12.0');
  await ch.addPcRelease({ gameId: 'railrove', buildDir: build('rr20', 3100000), version: '0.20.0', notes: 'World building' });
  ch.toTesters('railrove', '0.20.0');
  await ch.addPcRelease({ gameId: 'marchlands', buildDir: build('ml', 2000000), version: '0.4.4.0', notes: 'Catch bandits' });
  const sam = testers.makeAccount('Sam');
  fs.writeFileSync(path.join(player, 'account.json'), JSON.stringify(sam));
  ch.setTester({ accountId: sam.id, name: 'Sam', games: ['railrove'] });
  // friend
  const fk = generateKeyPair();
  const inbox = new FriendInbox(path.join(dev, 'friends'));
  inbox.addFriend({ friendId: 'sam', name: 'Sam', publicKeyPem: fk.publicKey, games: ['sky-rally'] });
  const sub = await makeSubmission({ friendId: 'sam', privateKeyPem: fk.privateKey, gameId: 'sky-rally', gameName: 'Sky Rally', version: '0.3.0', notes: 'New track', buildDir: build('sky', 500000), outDir: path.join(root, 'to-send') });
  await inbox.importSubmission(sub);
  // fake website folder + projects for "My games"
  const site = path.join(root, 'site');
  for (const [slug, name] of [['pop-storm', 'Pop Storm'], ['cogspire', 'Cogspire'], ['nova-forge', 'Nova Forge'], ['cat-nap', 'Cat Nap'], ['shapefront', 'Shapefront']]) {
    fs.mkdirSync(path.join(site, 'games', slug), { recursive: true }); fs.writeFileSync(path.join(site, 'games', slug, 'game.json'), JSON.stringify({ name }));
  }
  fs.mkdirSync(path.join(site, 'data'), { recursive: true });
  fs.writeFileSync(path.join(site, 'data', 'releases.json'), JSON.stringify({ 'pop-storm': 'released', cogspire: 'released', 'nova-forge': 'unreleased', 'cat-nap': 'coming-soon', shapefront: 'unreleased' }));
  const proj = path.join(root, 'projects', 'Dustrunner'); fs.mkdirSync(path.join(proj, 'build', 'win'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'project.godot'), 'config/name="Railrove"\nconfig/version="0.19.12.0"\nconfig/features=PackedStringArray("4.7")\n');
  fs.writeFileSync(path.join(proj, 'build', 'win', 'Railrove.exe'), 'x');
  fs.writeFileSync(path.join(dev, 'developer.json'), JSON.stringify({
    channelDir: chDir, privateKeyFile: path.join(root, 'zero-private.pem'), publisher: 'Zero',
    website: { url: 'http://127.0.0.1:4599/', autoStart: false },
    friendsDir: path.join(dev, 'friends'), aiFolders: [{ name: 'Railrove', path: proj }],
    hub: { siteDir: site, projects: [{ id: 'railrove', name: 'Railrove', path: proj }, { id: 'marchlands', name: 'Marchlands', path: path.join(root, 'projects', 'Marchlands') }] },
  }, null, 2));
  for (const d of [dev, player, user]) fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ publicKeyFile: path.join(root, 'zero-public.pem'), channelUrl: chDir, siteUrl: 'http://127.0.0.1:4599/' }));
  // The build folders stay in demo/builds so tests can add new versions from them.
  console.log(root, sam.id);
})();
