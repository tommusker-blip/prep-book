"use strict";
/* ---------- v0.9.57: slow-to-rebuild data in the database (Supabase table "stash", migration 0005) ----------
   Rows by kind and key (see the migration): Lichess explorer data, Find ideas results and idea lines.
   The local copies stay (fast, and they work offline or in local-only mode); this is the backing store:
   - get(kind, key): one row, batched with other requests over 40 ms (one query per kind, up to 200 keys);
     misses are remembered for the session.
   - getMany(kind, keys): many rows at once (chunks of 200), for prefetching.
   - all(kind): every row of a kind (paged), for small kinds pulled whole at start-up.
   - put(kind, key, data): saved in the background (batched every 2 s).
   Only when signed in; without the table (not applied yet) it quietly does nothing, like Evals.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const Stash = {
  table: null,                 // null = unknown, true = works, false = missing / no access
  missed: new Set(),           // "kind|key" the database didn't have (this session)
  ask: new Map(),              // kind -> Map(key -> [resolve])
  askTimer: null,
  out: new Map(), outTimer: null,
  usable() { return S.storeMode === "supabase" && Store.sb && Store.user && this.table !== false; },
  get(kind, key) {
    if (!this.usable() || this.missed.has(kind + "|" + key)) return Promise.resolve(null);
    return new Promise(resolve => {
      const m = this.ask.get(kind) || this.ask.set(kind, new Map()).get(kind);
      (m.get(key) || m.set(key, []).get(key)).push(resolve);
      if (!this.askTimer) this.askTimer = setTimeout(() => this.query(), 40);
    });
  },
  async query() {
    clearTimeout(this.askTimer); this.askTimer = null;
    const batches = [...this.ask];
    this.ask.clear();
    for (const [kind, m] of batches) {
      const keys = [...m.keys()];
      for (let i = 0; i < keys.length; i += 200) {
        const part = keys.slice(i, i + 200), found = await this.fetch(kind, part);
        for (const k of part) {
          const d = found.get(k) || null;
          if (!d) this.missed.add(kind + "|" + k);
          m.get(k).forEach(r => r(d));
        }
      }
    }
  },
  async fetch(kind, keys) {
    const out = new Map();
    if (!this.usable() || !keys.length) return out;
    try {
      const { data, error } = await Store.sb.from("stash").select("key,data").eq("kind", kind).in("key", keys);
      if (error) throw error;
      this.table = true;
      for (const r of data) out.set(r.key, r.data);
    } catch (e) { if (missingTable(e)) this.table = false; }
    return out;
  },
  async getMany(kind, keys) {
    const want = keys.filter(k => !this.missed.has(kind + "|" + k)), out = new Map();
    for (let i = 0; i < want.length; i += 200) {
      const part = want.slice(i, i + 200), found = await this.fetch(kind, part);
      for (const k of part) { if (found.has(k)) out.set(k, found.get(k)); else this.missed.add(kind + "|" + k); }
      if (this.table === false) break;
    }
    return out;
  },
  async all(kind) {
    const out = new Map();
    if (!this.usable()) return out;
    for (let from = 0; ; from += 1000) {
      try {
        const { data, error } = await Store.sb.from("stash").select("key,data").eq("kind", kind).range(from, from + 999);
        if (error) throw error;
        this.table = true;
        data.forEach(r => out.set(r.key, r.data));
        if (data.length < 1000) break;
      } catch (e) { if (missingTable(e)) this.table = false; break; }
    }
    return out;
  },
  // v0.9.60: every key of a kind (no data), and deleting rows, for the tidy-up in Settings
  async keys(kind) {
    const out = [];
    if (!this.usable()) return out;
    for (let from = 0; ; from += 1000) {
      try {
        const { data, error } = await Store.sb.from("stash").select("key").eq("kind", kind).range(from, from + 999);
        if (error) throw error;
        this.table = true;
        data.forEach(r => out.push(r.key));
        if (data.length < 1000) break;
      } catch (e) { if (missingTable(e)) this.table = false; break; }
    }
    return out;
  },
  async del(kind, keys) {
    let n = 0;
    if (!this.usable()) return n;
    for (let i = 0; i < keys.length; i += 200) {
      const part = keys.slice(i, i + 200);
      const { error } = await Store.sb.from("stash").delete().eq("kind", kind).in("key", part);
      if (error) throw error;
      n += part.length;
      part.forEach(k => { this.out.delete(kind + "|" + k); this.missed.add(kind + "|" + k); });
    }
    return n;
  },
  put(kind, key, data) {
    if (!this.usable() || data == null) return;
    this.missed.delete(kind + "|" + key);
    this.out.set(kind + "|" + key, { user_id: Store.user.id, kind, key, data });
    if (!this.outTimer) this.outTimer = setTimeout(() => this.flush(), 2000);
  },
  async flush() {
    clearTimeout(this.outTimer); this.outTimer = null;
    if (!this.out.size || !this.usable()) return;
    const ids = [...this.out.keys()].slice(0, 200), rows = ids.map(id => this.out.get(id));
    ids.forEach(id => this.out.delete(id));
    try {
      const { error } = await Store.sb.from("stash").upsert(rows, { onConflict: "user_id,kind,key" });
      if (error) throw error;
      this.table = true;
    } catch (e) {
      if (missingTable(e)) { this.table = false; this.out.clear(); return; }
      rows.forEach(r => { const id = r.kind + "|" + r.key; if (!this.out.has(id)) this.out.set(id, r); }); // try again later
    }
    if (this.out.size && !this.outTimer) this.outTimer = setTimeout(() => this.flush(), 2000);
  },
};

/* At start-up (hosted, signed in): fill in what this device is missing, then, the first time on this device
   once the table works, copy up what it has that the database doesn't (pb_stash_up marks that it's done). */
async function stashStartup() {
  if (!Stash.usable()) return;
  await Stash.fetch("expl", ["-"]); // is the table there?
  if (Stash.table !== true) return;
  await explPrefetchTrees();
  await ideasFromStash();
  await ideaLinesFromStash();
  if (!lsGet("pb_stash_up", false)) {
    for (const [k, d] of Object.entries(EXPL)) Stash.put("expl", k, d);
    for (const [k, d] of Object.entries(IDEAS)) Stash.put("ideas", k, d);
    for (const [k, d] of Object.entries(IDEAL)) Stash.put("idealine", k, d);
    lsSet("pb_stash_up", true);
  }
}
