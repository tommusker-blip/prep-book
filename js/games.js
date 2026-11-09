"use strict";
/* ---------- G1: games and their analysis, stored per game ----------
   S.games (list) and S.acc (id -> analysis) stay the in-memory model. Where they're kept:
   - this device: IndexedDB ("prepbook" database, keys games:<account> and acc:<account>), which
     has room for full-game analysis; localStorage (5 MB in all) didn't. Older builds kept them
     in pb_data; that copy is moved across once.
   - signed in: the Supabase table "games", one row per game (migration 0003). Only changed
     games are sent (Games.mark(ids)), in batches of 200, and only rows changed since the last
     look are fetched. The first time, games from the old "games"/"acc" documents are copied
     into the table (settings.gamesInTable); the documents are left as a backup.
   - If the table doesn't exist yet (migration not applied), everything works as before through
     the old documents. */
const IDB_TIMEOUT = 3000;
const IDB = {
  dbp: null,
  open() {
    if (this.dbp) return this.dbp;
    this.dbp = new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error("no IndexedDB")); return; }
      const r = indexedDB.open("prepbook", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.dbp;
  },
  // Every call gives up after IDB_TIMEOUT (storage can hang in some browsers and private
  // windows); callers then fall back to localStorage. Never block start-up on it.
  async req(mode, fn) {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("IndexedDB timed out")), IDB_TIMEOUT));
    const db = await Promise.race([this.open(), timeout]);
    return Promise.race([timeout, new Promise((res, rej) => { const t = db.transaction("kv", mode), r = fn(t.objectStore("kv")); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); })]);
  },
  async get(k) { try { return await this.req("readonly", s => s.get(k)); } catch (e) { return undefined; } },
  async set(k, v) { try { await this.req("readwrite", s => s.put(v, k)); return true; } catch (e) { return false; } },
  async del(k) { try { await this.req("readwrite", s => s.delete(k)); } catch (e) {} },
};
// Is this a "table doesn't exist" error from PostgREST?
const missingTable = e => !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table/i.test(e.message || ""));

const Games = {
  idb: false,          // IndexedDB works on this device
  table: false,        // the Supabase games table is in use
  failed: false, inflight: false, timer: null, localTimer: null, seenAt: 0, epoch: 0,
  dirty: new Set(lsGet("pb_dirty_games", [])),
  space: () => (Store.user ? Store.user.id : "local"),
  keepDirty() { lsSet("pb_dirty_games", [...this.dirty]); },
  async loadLocal(space = this.space()) {
    const g = await IDB.get("games:" + space);
    if (!g) return null;
    return { games: g, acc: (await IDB.get("acc:" + space)) || {} };
  },
  saveLocalSoon() { clearTimeout(this.localTimer); this.localTimer = setTimeout(() => this.saveLocal(), 800); },
  async saveLocal() {
    clearTimeout(this.localTimer); this.localTimer = null;
    const sp = this.space();
    this.idb = (await IDB.set("games:" + sp, S.games)) && (await IDB.set("acc:" + sp, S.acc));
  },
  // Local only / inside Claude: take the IndexedDB copy, or move the old pb_data copy into it
  async initLocal() {
    const loc = await this.loadLocal();
    if (loc) { S.games = loc.games; S.acc = loc.acc; this.idb = true; }
    else await this.saveLocal(); // first run of this build: pb_data's games go into IndexedDB
  },
  // Signed in: switch to the games table if it exists, copying games across the first time
  async initRemote() {
    const loc = await this.loadLocal();
    const res = await this.fetchRows();
    if (res.error) { // no table yet (or offline): keep the old documents; use the local copy if it's fuller
      this.table = false;
      if (loc && loc.games.length > S.games.length) { S.games = loc.games; S.acc = loc.acc; }
      await this.saveLocal();
      return;
    }
    this.table = true;
    this.epoch = S.settings.gamesEpoch || 0;
    if (res.rows.length) {
      this.useRows(res.rows, true);
      // changes made here that never reached the database win
      if (loc && this.dirty.size) for (const id of this.dirty) { const g = loc.games.find(x => x.id === id); if (g) this.upsertLocal(g, loc.acc[id]); }
    } else if (!S.settings.gamesInTable) {
      // first time: copy the games from the old documents (or this device) into the table
      if (!S.games.length) { const l = loc || (await this.loadLocal("local")); if (l) { S.games = l.games; S.acc = l.acc; } }
      for (const g of S.games) this.dirty.add(g.id);
      this.keepDirty();
    } else if (loc && this.dirty.size) { S.games = loc.games.filter(g => this.dirty.has(g.id)); S.acc = loc.acc; }
    else { S.games = []; S.acc = {}; }
    S.games.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (!S.settings.gamesInTable) { S.settings.gamesInTable = true; Store.save("settings"); }
    await this.saveLocal();
    if (this.dirty.size) this.schedulePush();
  },
  useRows(rows, replace) {
    if (replace) { S.games = []; S.acc = {}; }
    const byId = new Map(S.games.map((g, i) => [g.id, i]));
    for (const r of rows) {
      const t = Date.parse(r.updated_at);
      if (t > this.seenAt) this.seenAt = t;
      if (!replace && this.dirty.has(r.id)) continue; // our unsent change wins
      this.upsertLocal(r.game, r.analysis, byId);
    }
    S.games.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  },
  upsertLocal(g, analysis, byId) {
    const i = byId ? byId.get(g.id) : S.games.findIndex(x => x.id === g.id);
    if (i != null && i >= 0) S.games[i] = g; else { S.games.push(g); if (byId) byId.set(g.id, S.games.length - 1); }
    if (analysis) S.acc[g.id] = analysis; else delete S.acc[g.id];
    touchData();
  },
  async fetchRows(since = 0) {
    if (!Store.sb || !Store.user) return { error: "no session" };
    const rows = [];
    for (let from = 0; ; from += 1000) {
      let q = Store.sb.from("games").select("id,game,analysis,updated_at").order("id").range(from, from + 999);
      if (since) q = q.gt("updated_at", new Date(since).toISOString());
      const { data, error } = await q;
      if (error) return { error, missing: missingTable(error) };
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return { rows };
  },
  // Pull games changed on another device. Returns true if anything changed.
  async refresh() {
    if (!this.table) return false;
    if ((S.settings.gamesEpoch || 0) !== this.epoch) { // games were cleared elsewhere: reload all
      const res = await this.fetchRows();
      if (res.error) return false;
      this.epoch = S.settings.gamesEpoch || 0;
      this.useRows(res.rows, true); this.saveLocalSoon();
      return true;
    }
    const res = await this.fetchRows(this.seenAt);
    if (res.error || !res.rows.length) return false;
    this.useRows(res.rows, false); this.saveLocalSoon();
    return true;
  },
  // Record that these games (or their analysis) changed: saved locally, and sent if signed in
  mark(ids) {
    if (!ids || !ids.length) return;
    if (this.table) { for (const id of ids) this.dirty.add(id); this.keepDirty(); this.schedulePush(); }
    this.saveLocalSoon();
  },
  schedulePush() { clearTimeout(this.timer); this.timer = setTimeout(() => { this.timer = null; this.push(); }, 800); Store.emit(); },
  async push() {
    if (!this.table || this.inflight || !this.dirty.size || !Store.user) return;
    this.inflight = true; Store.emit();
    const ids = [...this.dirty].slice(0, 200), byId = new Map(S.games.map(g => [g.id, g]));
    const rows = [], gone = [];
    for (const id of ids) {
      const g = byId.get(id);
      if (!g) { gone.push(id); continue; }
      rows.push({ user_id: Store.user.id, id, played_on: /^\d{4}-\d{2}-\d{2}$/.test(g.date || "") ? g.date : null, color: g.my, game: g, analysis: S.acc[id] || null });
    }
    try {
      if (rows.length) {
        const { data, error } = await Store.sb.from("games").upsert(rows, { onConflict: "user_id,id" }).select("updated_at");
        if (error) throw error;
        for (const r of data) this.seenAt = Math.max(this.seenAt, Date.parse(r.updated_at));
      }
      if (gone.length) { const { error } = await Store.sb.from("games").delete().in("id", gone); if (error) throw error; }
      ids.forEach(id => this.dirty.delete(id)); this.keepDirty();
      this.failed = false; Store.savedAt = Date.now();
    } catch (e) { this.failed = true; }
    this.inflight = false; Store.emit();
    if (!this.failed && this.dirty.size) this.push();
  },
  // Remove every game (Games > Clear imported games)
  async clearAll() {
    S.games = []; S.acc = {};
    this.dirty.clear(); this.keepDirty();
    await this.saveLocal();
    if (this.table) {
      S.settings.gamesEpoch = (S.settings.gamesEpoch || 0) + 1; this.epoch = S.settings.gamesEpoch; Store.save("settings");
      const { error } = await Store.sb.from("games").delete().not("id", "is", null);
      if (error) { this.failed = true; toast("Couldn't clear the games in the database. Try again."); }
      Store.emit();
    }
  },
  async signOut() { for (const k of ["games:", "acc:"]) await IDB.del(k + this.space()); lsSet("pb_dirty_games", []); },
};
