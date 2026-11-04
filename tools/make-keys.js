// Run ONCE on Zero's PC: makes Zero's signing keys.
//   node tools/make-keys.js "%APPDATA%\Zero Launcher"
// zero-private.pem = SECRET (never share, keep a backup on a USB stick).
// zero-public.pem  = goes into app/keys/ so every launcher trusts Zero's game list.
const fs = require('fs'); const path = require('path');
const { generateKeyPair, fingerprint } = require('../core/signing');
const dir = path.resolve(process.argv[2] || '.');
const priv = path.join(dir, 'zero-private.pem');
if (fs.existsSync(priv)) { console.log('Keys already exist, not replacing them:', priv); process.exit(0); }
fs.mkdirSync(dir, { recursive: true });
const k = generateKeyPair();
fs.writeFileSync(priv, k.privateKey, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'zero-public.pem'), k.publicKey);
fs.copyFileSync(path.join(dir, 'zero-public.pem'), path.join(__dirname, '..', 'app', 'keys', 'zero-public.pem'));
console.log('Made keys in', dir, 'fingerprint', fingerprint(k.publicKey));
