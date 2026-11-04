'use strict';
// DEVELOPER: download counts from the PUBLIC GitHub release (no token needed).
// GET /repos/<repo>/releases/tags/channel -> assets[].download_count. Kept for 10 minutes.
const CACHE_MS = 10 * 60 * 1000;

class DownloadStats {
  constructor({ repo, tag = 'channel', api = 'https://api.github.com', fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('GitHub repo looks wrong');
    Object.assign(this, { repo, tag, api, fetchImpl, now });
    this.cache = null;
  }

  // { byFile: { 'railrove-0.20.0.zip': 12 }, at, error }
  async counts(force = false) {
    if (!force && this.cache && this.now() - this.cache.at < CACHE_MS) return this.cache;
    try {
      const res = await this.fetchImpl(`${this.api}/repos/${this.repo}/releases/tags/${this.tag}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ZeroLauncher' } });
      if (res.status === 404) { this.cache = { byFile: {}, at: this.now(), error: 'Nothing uploaded yet' }; return this.cache; }
      if (!res.ok) throw new Error(`GitHub said ${res.status}`);
      const rel = await res.json();
      const byFile = {};
      for (const a of rel.assets || []) if (a && typeof a.name === 'string') byFile[a.name] = Number(a.download_count) || 0;
      this.cache = { byFile, at: this.now(), error: null };
    } catch (e) {
      // keep old numbers if we had them
      this.cache = { byFile: (this.cache && this.cache.byFile) || {}, at: this.now(), error: 'Could not get download numbers: ' + e.message };
    }
    return this.cache;
  }

  // Per game + version, using the zip names in the game list.
  static perVersion(catalogue, byFile) {
    const out = {};
    for (const g of (catalogue && catalogue.games) || []) {
      out[g.id] = { total: 0, versions: {} };
      for (const r of g.releases || []) {
        if (!r.file) continue;
        const n = byFile[r.file.url.split('/').pop()] || 0;
        out[g.id].versions[r.version] = n;
        out[g.id].total += n;
      }
    }
    return out;
  }
}

module.exports = { DownloadStats, CACHE_MS };
