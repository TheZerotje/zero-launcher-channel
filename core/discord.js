'use strict';
// DEVELOPER: optional "Post to Discord" after a release.
// The webhook address is ONLY in developer.json on Zero's PC (never in the repo, never sent to the screen).
// Nothing is posted by itself: Zero sees the message first and presses Send.
const HOSTS = new Set(['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com']);

function isWebhook(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOSTS.has(u.hostname) && /^\/api\/webhooks\/\d+\/[\w-]+$/.test(u.pathname);
  } catch { return false; }
}

function releaseMessage(game, release) {
  const lines = [`🎮 **${game.name || game.id} ${release.version}** is out now!`];
  if (release.notes) lines.push(`What's new: ${release.notes}`);
  lines.push('It updates by itself in Zero Launcher. Have fun!');
  return lines.join('\n');
}

async function post(webhook, text, fetchImpl = (...a) => fetch(...a)) {
  if (!isWebhook(webhook)) throw new Error('The Discord webhook address in developer.json looks wrong');
  const content = String(text || '').trim();
  if (!content) throw new Error('The message is empty');
  if (content.length > 2000) throw new Error('The message is too long (max 2000 letters)');
  const res = await fetchImpl(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'ZeroLauncher' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }), // never ping @everyone
  });
  if (!res.ok) throw new Error(`Discord said ${res.status}`);
  return true;
}

module.exports = { isWebhook, releaseMessage, post };
