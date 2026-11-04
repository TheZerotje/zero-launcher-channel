'use strict';
// Start a program with arguments SAFELY.
// On Windows, tools like "claude" and "codex" are .cmd files, which need cmd.exe. cmd.exe treats
// & | < > ( ) ^ % ! " as commands, so typed text could run other commands by accident.
// We quote and escape every argument (same rules as the well known cross-spawn package),
// so the text always arrives as plain text.
const { spawn } = require('child_process');

const META = /([()\][%!^"`<>&|;, *?])/g;

// Quote one argument for the Windows command line, then escape cmd.exe special characters.
// double = true for .cmd/.bat files (cmd.exe reads the line twice).
function escapeWinArg(arg, double = true) {
  let a = String(arg);
  a = a.replace(/(\\*)"/g, '$1$1\\"');   // backslashes before a quote are doubled, the quote escaped
  a = a.replace(/(\\*)$/, '$1$1');       // trailing backslashes doubled (they come before our closing quote)
  a = `"${a}"`;
  a = a.replace(META, '^$1');
  if (double) a = a.replace(META, '^$1');
  return a;
}

function escapeWinCommand(cmd) {
  return String(cmd).replace(META, '^$1');
}

// Like child_process.spawn, but safe for .cmd tools on Windows. No shell on other systems.
function spawnSafe(cmd, args = [], opts = {}, platform = process.platform) {
  if (platform !== 'win32') return spawn(cmd, args, { ...opts, shell: false });
  const line = [escapeWinCommand(cmd), ...args.map((a) => escapeWinArg(a, true))].join(' ');
  return spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, shell: false, windowsVerbatimArguments: true });
}

module.exports = { spawnSafe, escapeWinArg, escapeWinCommand };
