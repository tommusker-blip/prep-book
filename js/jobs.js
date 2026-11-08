"use strict";
/* ---------- G3: one background job queue ----------
   All slow work goes through here, so features don't compete for the engine or for Lichess.
   Lanes run independently, one job at a time each:
     "engine": the single Stockfish worker
     "net":    Lichess explorer lookups (the job itself keeps them about a second apart)
   Within a lane the highest priority runs first, then first come first served:
     PRIO.now        what the current screen is showing (Build position, verdicts, Analyse)
     PRIO.soon       work the user just asked for on this screen (Find ideas here)
     PRIO.background long jobs (Analyse all games, Scan my tree, Find ideas across my tree)
   A job can have:
     key   - a second request with the same lane and key shares the first one's result (and
             raises its priority if needed)
     stale - a function checked when the job's turn comes; if it returns true the job is
             skipped and its promise rejects with Jobs.STALE (e.g. the user moved on). */
const PRIO = { now: 10, soon: 5, background: 1 };
const Jobs = {
  lanes: { engine: { q: [], busy: false, running: null }, net: { q: [], busy: false, running: null } },
  seq: 0,
  STALE: Object.assign(new Error("stale"), { stale: true }),
  onChange: null,
  add(lane, run, { prio = PRIO.background, key = null, stale = null } = {}) {
    const L = this.lanes[lane];
    if (key) {
      const same = (L.running && L.running.key === key && L.running) || L.q.find(j => j.key === key);
      if (same) {
        if (prio > same.prio) same.prio = prio;
        // Still needed if either requester still needs it
        if (!stale) same.stale = null;
        else if (same.stale) { const s1 = same.stale; same.stale = () => s1() && stale(); }
        return same.promise;
      }
    }
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    promise.catch(() => {}); // callers that don't care about stale results needn't catch
    L.q.push({ run, prio, key, stale, seq: this.seq++, resolve, reject, promise });
    this.pump(lane);
    return promise;
  },
  async pump(lane) {
    const L = this.lanes[lane];
    if (L.busy) return;
    L.busy = true;
    while (L.q.length) {
      L.q.sort((a, b) => b.prio - a.prio || a.seq - b.seq);
      const job = L.q.shift();
      if (job.stale && job.stale()) { job.reject(this.STALE); continue; }
      L.running = job;
      this.changed();
      try { job.resolve(await job.run()); } catch (e) { job.reject(e); }
      L.running = null;
    }
    L.busy = false;
    this.changed();
  },
  // Drop queued jobs that match (e.g. when a long job is stopped)
  cancel(lane, pred) {
    const L = this.lanes[lane];
    L.q = L.q.filter(j => { if (pred(j)) { j.reject(this.STALE); return false; } return true; });
    this.changed();
  },
  counts() { const c = {}; for (const [n, L] of Object.entries(this.lanes)) c[n] = L.q.length + (L.running ? 1 : 0); return c; },
  changed() { if (this.onChange) this.onChange(this.counts()); },
};
const isStale = e => !!(e && e.stale);
