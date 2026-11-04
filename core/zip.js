'use strict';
// Pack a build folder into a zip, and unpack a zip safely (no "../" escapes).
const fs = require('fs');
const path = require('path');
const yazl = require('yazl');
const yauzl = require('yauzl');

function listFiles(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) continue; // never follow links out of the build
    if (ent.isDirectory()) listFiles(full, base, out);
    else if (ent.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function packFolder(srcDir, destZip) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const files = listFiles(srcDir);
    if (!files.length) return reject(new Error('Build folder is empty'));
    for (const rel of files) zip.addFile(path.join(srcDir, rel), rel);
    const out = fs.createWriteStream(destZip);
    zip.outputStream.pipe(out).on('close', () => resolve(files)).on('error', reject);
    zip.end();
  });
}

function unpack(zipPath, destDir) {
  const root = path.resolve(destDir);
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err) return reject(err);
      let count = 0;
      zip.on('error', reject);
      zip.on('end', () => resolve(count));
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        const target = path.resolve(root, name);
        if (name.includes('\\') || path.isAbsolute(name) || (target !== root && !target.startsWith(root + path.sep))) {
          zip.close();
          return reject(new Error('Unsafe file path in package: ' + name));
        }
        if (/\/$/.test(name)) { fs.mkdirSync(target, { recursive: true }); return zip.readEntry(); }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (e2, rs) => {
          if (e2) return reject(e2);
          const ws = fs.createWriteStream(target);
          rs.pipe(ws).on('close', () => { count++; zip.readEntry(); }).on('error', reject);
        });
      });
      zip.readEntry();
    });
  });
}

module.exports = { packFolder, unpack, listFiles };
