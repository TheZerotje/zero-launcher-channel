'use strict';
// DEVELOPER ONLY: "claude, do X" / "codex, do Y" / "chatgpt, do Y".
// Runs the AI tool that is already installed on Zero's PC, signed in with Zero's own
// account (Claude Code: `claude -p`, Codex: `codex exec`). Nothing goes through us.
const { execFile } = require('child_process');
const { spawnSafe } = require('./proc');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeJsonAtomic } = require('./fsutil');

const RULES = [
  'You are working for Zero from the Zero Launcher.',
  'RULES: never change system volume, mute or audio device; never play sound; run tests muted/headless',
  '(Godot --headless or --audio-driver Dummy, browsers --mute-audio).',
  'Work only inside the current folder. Never close programs you did not start.',
  'Never release or publish a game. Never change Tailscale or port 8443.',
  'Make a backup before replacing files you did not create. Answer in very simple short English.',
].join(' ');

// "claude, add night mode" -> { tool: 'claude', task: 'add night mode' }
function parse(text) {
  const m = /^\s*(claude|codex|chatgpt|chat gpt|gpt)\s*[,:]?\s+([\s\S]+)$/i.exec(String(text || ''));
  if (!m) return null;
  const word = m[1].toLowerCase().replace(/\s/g, '');
  return { tool: word === 'claude' ? 'claude' : 'codex', said: m[1], task: m[2].trim() };
}

function commandFor(tool, task, cwd) {
  if (tool === 'claude') {
    return {
      cmd: 'claude',
      args: ['-p', task, '--output-format', 'stream-json', '--verbose',
        '--permission-mode', 'acceptEdits', '--append-system-prompt', RULES],
    };
  }
  return {
    cmd: 'codex',
    args: ['exec', '--sandbox', 'workspace-write', '--cd', cwd, '--skip-git-repo-check', '--json', `${RULES}\n\nTASK: ${task}`],
  };
}

// Turn one line of tool output into something short for the screen.
function pretty(tool, line) {
  let j;
  try { j = JSON.parse(line); } catch { return line; }
  if (tool === 'claude') {
    if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
      return j.message.content.map((c) => c.type === 'text' ? c.text
        : c.type === 'tool_use' ? `[${c.name}] ${summariseInput(c.input)}` : '').filter(Boolean).join('\n');
    }
    if (j.type === 'result') return `DONE (${j.subtype || 'ok'})${j.result ? ': ' + j.result : ''}`;
    return '';
  }
  const item = j.item || j.msg || j;
  if (item.type === 'agent_message' || item.type === 'message') return item.text || item.message || '';
  if (item.type === 'command_execution') return `[run] ${item.command || ''}`;
  if (item.type === 'file_change') return `[files] ${(item.changes || []).map((c) => c.path).join(', ')}`;
  if (j.type === 'turn.completed') return 'DONE';
  if (j.type === 'error' || j.type === 'turn.failed') return 'ERROR: ' + (j.message || (j.error && j.error.message) || '');
  return '';
}
function summariseInput(i) {
  if (!i) return '';
  return String(i.file_path || i.command || i.pattern || i.description || JSON.stringify(i)).slice(0, 120);
}

class AiHelper {
  constructor(logRoot) { this.logRoot = logRoot; this.jobs = new Map(); this.n = 0; }

  start(text, cwd, onLine, onEnd) {
    const p = parse(text);
    if (!p) throw new Error('Start with "claude," or "codex," or "chatgpt,". Example: claude, fix the jump bug');
    if (!cwd || !fs.existsSync(cwd)) throw new Error('Pick a folder first');
    const { cmd, args } = commandFor(p.tool, p.task, cwd);
    const id = `${Date.now()}-${++this.n}`;
    const dir = path.join(this.logRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    writeJsonAtomic(path.join(dir, 'job.json'), { ...p, cwd, startedAt: new Date().toISOString() });
    const log = fs.createWriteStream(path.join(dir, 'output.jsonl'));
    // spawnSafe: typed text can never run other commands (see core/proc.js).
    const child = spawnSafe(cmd, args, { cwd, windowsHide: true, env: { ...process.env, CODEX_BRIDGE_NO_CUA: '1' } });
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
    this.jobs.set(id, child);
    let buf = '';
    const feed = (chunk) => {
      log.write(chunk);
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line) { const t = pretty(p.tool, line); if (t) onLine(t); }
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', (d) => { log.write(d); });
    child.on('error', (e) => onLine(`Could not start ${p.tool}: ${e.message}. Is it installed and signed in?`));
    child.on('close', (code) => {
      this.jobs.delete(id); log.end();
      try { writeJsonAtomic(path.join(dir, 'end.json'), { code, endedAt: new Date().toISOString() }); } catch {}
      onEnd && onEnd(code);
    });
    return { id, tool: p.tool, task: p.task };
  }

  // Past jobs (newest first) from the ai-runs folder.
  history(limit = 30) {
    let ids = [];
    try { ids = fs.readdirSync(this.logRoot).filter((x) => AiHelper.ID_RE.test(x)); } catch { return []; }
    ids.sort((a, b) => Number(b.split('-')[0]) - Number(a.split('-')[0]) || b.localeCompare(a));
    return ids.slice(0, limit).map((id) => {
      const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(this.logRoot, id, f), 'utf8')); } catch { return null; } };
      const job = read('job.json') || {};
      const end = read('end.json');
      const status = this.jobs.has(id) ? 'running' : !end ? 'stopped' : end.code === 0 ? 'done' : 'failed';
      return { id, tool: job.tool, task: job.task, said: job.said, cwd: job.cwd, startedAt: job.startedAt, endedAt: end && end.endedAt, code: end ? end.code : null, status };
    });
  }

  logFile(id) {
    if (!AiHelper.ID_RE.test(String(id))) throw new Error('Bad job id');
    const f = path.join(this.logRoot, id, 'output.jsonl');
    if (!fs.existsSync(f)) throw new Error('No log for this job');
    return f;
  }

  // Readable text of a past job's log (last lines).
  readLog(id, maxLines = 300) {
    const f = this.logFile(id);
    const job = this.history(1000).find((j) => j.id === id) || {};
    const lines = fs.readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => pretty(job.tool || 'claude', l)).filter(Boolean);
    return lines.slice(-maxLines).join('\n');
  }

  // Stop only OUR job (and the processes it started), never anything else.
  stop(id) {
    const child = this.jobs.get(id);
    if (!child) return false;
    if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
    else child.kill('SIGTERM');
    return true;
  }
}

AiHelper.ID_RE = /^\d{10,16}-\d{1,6}$/;

module.exports = { AiHelper, parse, commandFor, pretty, RULES };
