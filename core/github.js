'use strict';
// DEVELOPER: upload the channel folder to free GitHub storage.
// One PUBLIC repo (example TheZerotje/zero-launcher-channel), one release with tag "channel".
// Players read: https://github.com/<repo>/releases/download/channel/catalogue.json (+ .sig, + zips).
// The token stays only in developer.json on Zero's PC.
const fs = require('fs');
const path = require('path');

class GitHubChannel {
  constructor({ repo, token, tag = 'channel', api = 'https://api.github.com', uploads = 'https://uploads.github.com' }) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('GitHub repo looks wrong (example: TheZerotje/zero-launcher-channel)');
    if (!token) throw new Error('No GitHub token set in developer settings');
    Object.assign(this, { repo, token, tag, api, uploads });
  }
  get playerUrl() { return `https://github.com/${this.repo}/releases/download/${this.tag}`; }

  async _req(method, url, body, headers = {}) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ZeroLauncher', ...headers },
      body,
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new Error(`GitHub said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? {} : res.json();
  }

  async release() {
    let r = await this._req('GET', `${this.api}/repos/${this.repo}/releases/tags/${this.tag}`);
    if (!r) {
      r = await this._req('POST', `${this.api}/repos/${this.repo}/releases`, JSON.stringify({
        tag_name: this.tag, name: 'Zero Launcher channel', body: 'Game files for Zero Launcher. Do not delete.', draft: false, prerelease: false,
      }), { 'Content-Type': 'application/json' });
    }
    return r;
  }

  async _assets(rel) {
    const out = [];
    for (let page = 1; ; page++) {
      const list = await this._req('GET', `${this.api}/repos/${this.repo}/releases/${rel.id}/assets?per_page=100&page=${page}`);
      if (!list || !list.length) break;
      out.push(...list);
      if (list.length < 100) break;
    }
    return out;
  }

  async _upload(rel, file, name) {
    const data = fs.readFileSync(file);
    const type = name.endsWith('.json') ? 'application/json' : name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream';
    return this._req('POST', `${this.uploads}/repos/${this.repo}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, data,
      { 'Content-Type': type, 'Content-Length': String(data.length) });
  }

  // Upload new packages first, then swap the catalogue. Old zips are kept (needed for "go back").
  async sync(channelDir, onStep = () => {}) {
    const rel = await this.release();
    const assets = await this._assets(rel);
    const have = new Map(assets.map((a) => [a.name, a]));
    const cat = JSON.parse(fs.readFileSync(path.join(channelDir, 'catalogue.json'), 'utf8'));
    let uploaded = 0;
    const todo = [];
    for (const g of cat.games) {
      for (const r of g.releases || []) {
        if (!r.file) continue;
        const name = r.file.url.split('/').pop();
        const existing = have.get(name);
        if (existing && existing.size === r.file.size) continue;
        todo.push({ name, file: path.join(channelDir, r.file.url), size: r.file.size, existing });
      }
    }
    const lf = cat.launcher && cat.launcher.file; // the launcher setup, if Zero added one
    if (lf) { const name = lf.url.split('/').pop(); const existing = have.get(name); if (!(existing && existing.size === lf.size)) todo.push({ name, file: path.join(channelDir, lf.url), size: lf.size, existing }); }
    const total = todo.length + 2;
    let done = 0;
    for (const t of todo) {
      if (t.existing) await this._req('DELETE', `${this.api}/repos/${this.repo}/releases/assets/${t.existing.id}`);
      onStep(`Uploading ${t.name} (${Math.round(t.size / 1048576)} MB)`, { done, total });
      await this._upload(rel, t.file, t.name);
      uploaded++; done++;
    }
    for (const name of ['catalogue.json.sig', 'catalogue.json']) {
      const existing = have.get(name);
      if (existing) await this._req('DELETE', `${this.api}/repos/${this.repo}/releases/assets/${existing.id}`);
      onStep(`Uploading ${name}`, { done, total });
      await this._upload(rel, path.join(channelDir, name), name);
      done++;
    }
    onStep('Done. Players get it at their next check (within about 1 hour).', { done, total });
    return { uploaded, playerUrl: this.playerUrl };
  }
}

module.exports = { GitHubChannel };
