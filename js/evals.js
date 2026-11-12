"use strict";
/* ---------- G2: engine results in the database ----------
   Stockfish results by position key go to the Supabase table "evals" (migration 0004), so
   analysis run on the PC is ready on the phone. Used alongside the local cache (EVALC):
   - lookup(fen, depth): before running the engine, ask the database. Requests are batched
     (one query for up to 100 positions, gathered over 40 ms) and misses are remembered for the
     session, so a position is asked about once.
   - put(fen, result): after running it, save the result (batched every 2 s). Only interactive
     results are saved: depth MIN_REMOTE_DEPTH and up, from the WASM engine. Game analysis
     (depth 10, every move) is stored with each game instead (games table).
   Only when signed in; if the table doesn't exist yet, it quietly does nothing. */
const MIN_REMOTE_DEPTH = 12; // v0.9.57: was 14; Connect, Ideas, puzzles and routes check at depth 12
const Evals = {
  table: null,                 // null = unknown, true = works, false = missing / no access
  missed: new Set(),           // keys the database didn't have (this session)
  ask: new Map(),              // key -> [{depth, resolve}] waiting for the next lookup query
  askTimer: null,
  out: new Map(), outTimer: null,
  usable() { return S.storeMode === "supabase" && Store.sb && Store.user && this.table !== false; },
  // kind "eval" (a single best line) or "mpv" (MultiPV, item 7: stored under "mpv:<key>")
  lookup(fen, depth, kind = "eval") {
    const key = (kind === "mpv" ? "mpv:" : "") + K(fen);
    if (!this.usable() || (kind === "eval" && depth < MIN_REMOTE_DEPTH) || this.missed.has(key)) return Promise.resolve(null);
    return new Promise(resolve => {
      (this.ask.get(key) || this.ask.set(key, []).get(key)).push({ depth, resolve });
      if (this.ask.size >= 100) this.query(); else if (!this.askTimer) this.askTimer = setTimeout(() => this.query(), 40);
    });
  },
  async query() {
    clearTimeout(this.askTimer); this.askTimer = null;
    const batch = new Map([...this.ask].slice(0, 100));
    for (const k of batch.keys()) this.ask.delete(k);
    if (this.ask.size) this.askTimer = setTimeout(() => this.query(), 0);
    let rows = [];
    try {
      const { data, error } = await Store.sb.from("evals").select("key,data").in("key", [...batch.keys()]);
      if (error) throw error;
      this.table = true; rows = data;
    } catch (e) { if (missingTable(e)) this.table = false; }
    const found = new Map(rows.map(r => [r.key, r.data]));
    for (const [key, waiters] of batch) {
      const d = found.get(key), mpv = key.startsWith("mpv:"), k = mpv ? key.slice(4) : key, cache = mpv ? MPV : EVALC;
      if (d && (!cache[k] || (cache[k].d || 0) < d.d)) cache[k] = d; // keep the deeper one locally
      if (!d) this.missed.add(key);
      for (const w of waiters) w.resolve(d && d.d >= w.depth ? d : null);
    }
  },
  put(fen, r, kind = "eval") {
    if (!this.usable() || !r || (kind === "eval" && r.d < MIN_REMOTE_DEPTH) || r.e !== "wasm") return;
    const key = (kind === "mpv" ? "mpv:" : "") + K(fen);
    this.missed.delete(key);
    this.out.set(key, { user_id: Store.user.id, key, depth: r.d, data: r });
    if (!this.outTimer) this.outTimer = setTimeout(() => this.flush(), 2000);
  },
  async flush() {
    clearTimeout(this.outTimer); this.outTimer = null;
    if (!this.out.size || !this.usable()) return;
    const rows = [...this.out.values()].slice(0, 200);
    rows.forEach(r => this.out.delete(r.key));
    try {
      const { error } = await Store.sb.from("evals").upsert(rows, { onConflict: "user_id,key" });
      if (error) throw error;
      this.table = true;
    } catch (e) {
      if (missingTable(e)) { this.table = false; this.out.clear(); return; }
      rows.forEach(r => { if (!this.out.has(r.key)) this.out.set(r.key, r); }); // try again later
    }
    if (this.out.size && !this.outTimer) this.outTimer = setTimeout(() => this.flush(), 2000);
  },
};
