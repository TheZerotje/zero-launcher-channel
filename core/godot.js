'use strict';
// DEVELOPER: "Export from Godot".
// Runs the Godot command line, headless (no window, no sound), at low priority:
//   godot --headless --path <copy of project> --export-release "Windows Desktop" <tmp>\<Game>.exe
// SAFE: the real project folder is never changed. We first copy the project to a temp folder and
// export from that copy (Godot writes cache files while exporting). The .exe goes to another temp folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PRESET = 'Windows Desktop';
const SKIP = new Set(['.git', 'build', 'builds', 'export', 'exports', 'dist', 'Build', 'Builds']);

function hasPreset(projectDir, preset = PRESET) {
  const f = path.join(projectDir, 'export_presets.cfg');
  if (!fs.existsSync(f)) return false;
  const t = fs.readFileSync(f, 'utf8');
  return new RegExp(`^name="${preset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'm').test(t);
}

function projectInfo(projectDir) {
  const f = path.join(projectDir, 'project.godot');
  if (!fs.existsSync(f)) return null;
  const t = fs.readFileSync(f, 'utf8');
  return {
    name: (/^config\/name="([^"]*)"/m.exec(t) || [])[1] || path.basename(projectDir),
    version: (/^config\/version="([^"]*)"/m.exec(t) || [])[1] || null,
  };
}

const isInside = (child, parent) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Copy the project (no .git, no old builds, never follow links).
function copyProject(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.isSymbolicLink()) continue;
    const a = path.join(src, e.name), b = path.join(dest, e.name);
    if (e.isDirectory()) copyProject(a, b);
    else if (e.isFile()) fs.copyFileSync(a, b);
  }
}

// Returns { buildDir, exe, log }. Throws with a clear message if something is missing.
async function exportWindows({ godotPath, projectDir, gameName, tmpRoot = os.tmpdir(), timeoutMs = 20 * 60 * 1000, onLine = () => {} }) {
  if (!godotPath) throw new Error('Set "godotPath" in developer.json (the Godot .exe)');
  if (!fs.existsSync(godotPath)) throw new Error('Godot not found at ' + godotPath);
  if (!projectDir || !fs.existsSync(path.join(projectDir, 'project.godot'))) throw new Error('No Godot project in this folder');
  if (!hasPreset(projectDir)) {
    throw new Error(`This project has no "${PRESET}" export preset. Open it in Godot: Project > Export > Add > Windows Desktop. Then try again.`);
  }
  const safeName = String(gameName || 'Game').replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'Game';
  const work = fs.mkdtempSync(path.join(tmpRoot, 'zl-godot-'));
  if (isInside(work, projectDir)) throw new Error('Temp folder is inside the project. Not allowed.');
  const copy = path.join(work, 'project');
  const buildDir = path.join(work, 'build');
  fs.mkdirSync(buildDir);
  onLine('Copying the project to a temp folder (your folder is not changed)…');
  copyProject(projectDir, copy);
  const exe = path.join(buildDir, safeName + '.exe');
  const args = ['--headless', '--audio-driver', 'Dummy', '--path', copy, '--export-release', PRESET, exe];
  onLine('Running Godot (headless, muted, low priority)…');
  const log = [];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(godotPath, args, { cwd: copy, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW); } catch {}
    const timer = setTimeout(() => { child.kill(); reject(new Error('Godot took too long (more than 20 minutes)')); }, timeoutMs);
    const feed = (d) => { for (const l of d.toString().split(/\r?\n/)) if (l.trim()) { log.push(l); if (log.length > 400) log.shift(); onLine(l); } };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    child.on('error', (e) => { clearTimeout(timer); reject(new Error('Could not start Godot: ' + e.message)); });
    child.on('close', (c) => { clearTimeout(timer); resolve(c); });
  });
  if (code !== 0 || !fs.existsSync(exe)) {
    const e = new Error(`Godot export failed (code ${code}). Last lines:\n` + log.slice(-8).join('\n'));
    e.log = log;
    throw e;
  }
  fs.rmSync(copy, { recursive: true, force: true }); // only our own temp copy
  return { buildDir, exe: path.basename(exe), log, work };
}

module.exports = { exportWindows, hasPreset, projectInfo, copyProject, isInside, PRESET };
