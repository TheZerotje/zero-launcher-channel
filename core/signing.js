'use strict';
// Ed25519 signing. The catalogue players download is signed with Zero's
// private key; the player launcher only trusts Zero's public key, so a
// changed catalogue (or a fake one) is refused.
const crypto = require('crypto');

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

function sign(bytes, privateKeyPem) {
  return crypto.sign(null, Buffer.from(bytes), crypto.createPrivateKey(privateKeyPem)).toString('base64');
}

function verify(bytes, signatureB64, publicKeyPem) {
  try {
    return crypto.verify(null, Buffer.from(bytes), crypto.createPublicKey(publicKeyPem),
      Buffer.from(String(signatureB64).trim(), 'base64'));
  } catch {
    return false;
  }
}

function fingerprint(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem.trim()).digest('hex').slice(0, 16);
}

module.exports = { generateKeyPair, sign, verify, fingerprint };
