'use strict';
// Download queue: ONE download at a time, the rest wait ("Waiting...").
// Each job: { id, stage, done, total, version, signal }.
// stage: waiting -> (download/check/unpack, set by the runner) -> gone when finished
//        paused  = stopped by the player, keeps its half file so Resume goes on from there.
// run(id, job) does the real work and must throw an error with code 'PAUSED' when job.signal.cancelled.
class DownloadQueue {
  constructor(run, onChange = () => {}) {
    this.run = run;
    this.onChange = onChange;
    this.jobs = new Map();   // id -> job (in the order they were added)
    this.active = null;
  }

  add(id, info = {}) {
    const old = this.jobs.get(id);
    if (old && old.stage !== 'paused') return false; // already waiting or running
    const job = { ...(old || {}), ...info, id, stage: 'waiting', signal: { cancelled: false }, error: null };
    this.jobs.delete(id); // move to the end of the line
    this.jobs.set(id, job);
    this.onChange();
    this._next();
    return true;
  }

  get(id) { return this.jobs.get(id) || null; }
  list() { return [...this.jobs.values()]; }

  pause(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (this.active === id) job.signal.cancelled = true; // runner stops at the next piece
    else { job.stage = 'paused'; this.onChange(); }
    return true;
  }

  resume(id) {
    const job = this.jobs.get(id);
    if (!job || job.stage !== 'paused') return false;
    return this.add(id);
  }

  // Cancel: stop and forget. onCancelled(id) removes the half file.
  cancel(id, onCancelled = () => {}) {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.cancelRequested = true;
    if (this.active === id) { job.signal.cancelled = true; job.onCancelled = onCancelled; return true; }
    this.jobs.delete(id);
    onCancelled(id);
    this.onChange();
    return true;
  }

  async _next() {
    if (this.active) return;
    const job = [...this.jobs.values()].find((j) => j.stage === 'waiting');
    if (!job) return;
    this.active = job.id;
    job.stage = 'download';
    this.onChange();
    try {
      await this.run(job.id, job);
      this.jobs.delete(job.id);
    } catch (e) {
      if (job.cancelRequested) {
        this.jobs.delete(job.id);
        if (job.onCancelled) job.onCancelled(job.id);
      } else if (e && e.code === 'PAUSED') {
        job.stage = 'paused';
      } else {
        this.jobs.delete(job.id);
        job.error = e;
        if (this.onError) this.onError(job.id, e);
      }
    } finally {
      this.active = null;
      this.onChange();
      this._next();
    }
  }
}

module.exports = { DownloadQueue };
