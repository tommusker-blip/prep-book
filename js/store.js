"use strict";
/* ---------- storage: Claude db inside Claude, Supabase when hosted, else this browser ---------- */
const SB_URL = "https://serjfzitcbixkhnuxhol.supabase.co";
const SB_KEY = "sb_publishable_sCOcKwpCMuAIbLvPtfmcUw_i6n7FZVF";
const DOCS = ["white", "black", "settings", "games", "acc"]; // always present; extra books add more

/* ----- prep books -----
   Each book has its own White and Black repertoire (positions, training cards, misplay flags).
   The first book, "main", keeps the original doc names "white" and "black"; other books are
   saved as "white@<id>" and "black@<id>". The list of books ({id, name}) and the open book
   live in settings, so they sync too. */
const emptyRep = () => ({ pos: {}, cards: {}, flagged: [] });
const repDoc = (color, id = S.book) => (id === "main" ? color : `${color}@${id}`);
const parseRepDoc = name => { const m = /^(white|black)(?:@(.+))?$/.exec(name); return m ? { color: m[1], id: m[2] || "main" } : null; };
function ensureBook(id) { return S.books[id] || (S.books[id] = { white: emptyRep(), black: emptyRep() }); }
function bookList() {
  const list = (S.settings.books || []).filter((b, i, all) => (S.books[b.id] || b.id === "main") && all.findIndex(x => x.id === b.id) === i);
  if (!list.some(b => b.id === "main")) list.unshift({ id: "main", name: "My prep" });
  for (const id of Object.keys(S.books)) if (!list.some(b => b.id === id)) list.push({ id, name: "Untitled book" });
  return list;
}
function openBook(id) {
  S.book = S.books[id] ? id : "main";
  S.rep = ensureBook(S.book);
}
// Every doc this app saves, including one pair per book
function allDocNames() {
  const names = ["settings", "games", "acc"];
  for (const id of Object.keys(S.books)) names.push(repDoc("white", id), repDoc("black", id));
  return names;
}

// Re-key a stored repertoire with the current K() (older builds kept every en-passant
// square). Positions that now share a key are merged; walk() tidies up afterwards.
function normRep(r) {
  const out = { pos: {}, cards: {}, flagged: r.flagged }; // undefined flagged -> migrated in flagMisplays()
  for (const [k, n] of Object.entries(r.pos || {})) {
    const nk = K(k), have = out.pos[nk];
    if (!have) { out.pos[nk] = { ...n, m: (n.m || []).slice() }; continue; }
    for (const m of n.m || []) if (!have.m.includes(m)) have.m.push(m);
  }
  for (const [k, c] of Object.entries(r.cards || {})) {
    const nk = K(k), have = out.cards[nk];
    if (!have || (c.reps || 0) > (have.reps || 0)) out.cards[nk] = c;
  }
  return out;
}
function applyData(d) {
  for (const [name, v] of Object.entries(d)) {
    const r = v && parseRepDoc(name);
    if (r && !v.deleted) ensureBook(r.id)[r.color] = normRep(v);
    if (r && v.deleted && r.id !== "main") delete S.books[r.id];
  }
  if (d.settings) Object.assign(S.settings, d.settings);
  if (d.games && d.games.list) S.games = d.games.list;
  if (d.acc && d.acc.map) S.acc = d.acc.map;
  openBook(S.settings.book || S.book || "main");
}
// Everything, for the browser copy (pb_data)
function localSnapshot() {
  // Games and their analysis live in IndexedDB (games.js) once that works on this device
  const d = Games.idb ? { settings: S.settings } : { settings: S.settings, games: { list: S.games }, acc: { map: S.acc } };
  for (const id of Object.keys(S.books)) { d[repDoc("white", id)] = S.books[id].white; d[repDoc("black", id)] = S.books[id].black; }
  return d;
}
function hasLocalData() {
  const d = lsGet("pb_data", null);
  if (!d) return false;
  return Object.entries(d).some(([k, v]) => (parseRepDoc(k) && v && Object.keys(v.pos || {}).length) || (k === "games" && v && v.list && v.list.length));
}
// Docs changed on this device whose save to the database isn't confirmed yet: {doc: localMs}
const Dirty = {
  get: () => lsGet("pb_dirty", {}),
  mark(name) { const d = this.get(); d[name] = Date.now(); lsSet("pb_dirty", d); },
  clear(name, since) { const d = this.get(); if (d[name] && d[name] <= since) { delete d[name]; lsSet("pb_dirty", d); } },
};
const Store = {
  db: null, uid: null, sb: null, user: null, timers: {}, inflight: {}, pending: {}, seen: {},
  failed: false, savedAt: 0, onStatus: null,
  // Save state for the header indicator:
  //   "pending" (change waiting to be sent), "saving", "saved", "error" (will retry), "device" (local only)
  status() {
    if (Object.values(this.inflight).some(Boolean) || Games.inflight) return "saving";
    if (Object.values(this.timers).some(Boolean) || Games.timer) return "pending";
    if (Games.table && Games.failed && Games.dirty.size) return "error";
    if (S.storeMode === "local") return this.savedAt ? "device" : "idle";
    if (this.failed || (S.storeMode === "supabase" && Object.keys(Dirty.get()).length)) return "error";
    return this.savedAt ? "saved" : "idle";
  },
  emit() { if (this.onStatus) this.onStatus(this.status()); },
  // Returns "ready" or "auth" (hosted copy, not signed in yet)
  async init() {
    if (window.claude && window.claude.use) {
      try {
        const [db, user] = await Promise.race([
          Promise.all([window.claude.use("db"), window.claude.use("user")]),
          new Promise(r => setTimeout(() => r([null, null]), 10000)),
        ]);
        if (!db || !user) throw 0;
        const uid = await user.id();
        if (!uid) throw 0;
        this.db = db; this.uid = uid;
        const timeout = p => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))]);
        const read = async names => { const snaps = await timeout(Promise.all(names.map(n => db.doc(`data/users/${uid}/${n}`).get()))); const d = {}; snaps.forEach((s, i) => { if (s.exists) d[names[i]] = s.data(); }); return d; };
        const d = await read(DOCS);
        // Extra books are listed in settings
        const extra = ((d.settings && d.settings.books) || []).filter(b => b.id !== "main").flatMap(b => [repDoc("white", b.id), repDoc("black", b.id)]);
        if (extra.length) Object.assign(d, await read(extra));
        if (!Object.keys(d).length) applyData(lsGet("pb_data", {}));
        else applyData(JSON.parse(JSON.stringify(d)));
        S.storeMode = "db";
        return "ready";
      } catch (e) { this.db = null; }
    } else if (window.supabase && window.supabase.createClient && !lsGet("pb_local_only", false)) {
      try {
        this.sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
        const { data } = await this.sb.auth.getSession();
        if (data && data.session) return (await this.loadRemote(data.session.user)) ? "ready" : "auth";
        return "auth";
      } catch (e) { this.sb = null; }
    }
    applyData(lsGet("pb_data", {}));
    S.storeMode = "local";
    await Games.initLocal();
    return "ready";
  },
  async loadRemote(user) {
    this.user = user;
    const { data, error } = await this.sb.from("prep_data").select("doc,data,updated_at");
    if (error) { toast("Couldn't load from the database: " + error.message); return false; }
    S.storeMode = "supabase";
    const local = lsGet("pb_data", {});
    if (!data.length) {
      // First sign-in: move anything saved in this browser up to the database
      applyData(local);
      if (hasLocalData()) for (const n of allDocNames()) this.save(n);
      await Games.initRemote();
      return true;
    }
    // The database copy wins, except for docs this device changed later and never got saved
    const dirty = Dirty.get(), remote = {}, d = {}, push = [];
    for (const r of data) { remote[r.doc] = r; this.seen[r.doc] = r.updated_at; }
    const names = new Set([...DOCS, ...Object.keys(remote), ...Object.keys(dirty)]);
    for (const n of names) {
      const r = remote[n];
      if (dirty[n] && local[n] && (!r || dirty[n] > Date.parse(r.updated_at))) { d[n] = local[n]; push.push(n); }
      else if (r) d[n] = r.data;
    }
    applyData(d);
    for (const n of push) this.save(n);
    await Games.initRemote();
    return true;
  },
  // Pull changes made on another device since we last looked
  async refresh() {
    if (S.storeMode !== "supabase" || this.busy()) return false;
    const { data, error } = await this.sb.from("prep_data").select("doc,data,updated_at");
    if (error || !data || this.busy()) return false;
    const dirty = Dirty.get(), d = {};
    for (const r of data) {
      if (this.seen[r.doc] && Date.parse(r.updated_at) <= Date.parse(this.seen[r.doc])) continue;
      if (dirty[r.doc]) continue; // our unsaved change wins; it goes up on the next flush
      d[r.doc] = r.data; this.seen[r.doc] = r.updated_at;
    }
    if (!Object.keys(d).length) return false;
    applyData(d);
    return true;
  },
  busy() { return Object.values(this.inflight).some(Boolean) || Object.values(this.timers).some(Boolean); },
  async signOut() {
    await this.flushAll();
    await Games.signOut();
    if (this.sb) await this.sb.auth.signOut();
    try { for (const k of ["pb_data", "pb_dirty", "pb_token"]) localStorage.removeItem(k); } catch (e) {}
    location.reload();
  },
  docFor(name) {
    if (name === "games") return { list: S.games };
    if (name === "acc") return { map: S.acc };
    if (name === "settings") return { ...S.settings };
    const r = parseRepDoc(name);
    if (r && S.books[r.id]) return S.books[r.id][r.color];
    return r ? { deleted: true } : null; // a deleted book: leave a tombstone so other devices drop it
  },
  save(name) {
    // Games and analysis: kept in IndexedDB, and sent per game by Games.mark() once the games
    // table is in use. The old whole documents are only written while it isn't.
    if (name === "games" || name === "acc") {
      Games.saveLocalSoon();
      if (Games.table) { this.emit(); return; }
    }
    if (S.storeMode === "supabase") Dirty.mark(name);
    clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(() => { this.timers[name] = null; this.flush(name); }, 700);
    this.emit();
  },
  // Save everything still waiting, and retry earlier failed saves. Called when the app is hidden.
  flushAll() {
    const names = Object.keys(this.timers).filter(n => this.timers[n]);
    for (const n of names) { clearTimeout(this.timers[n]); this.timers[n] = null; }
    if (S.storeMode === "supabase") for (const n of Object.keys(Dirty.get())) if (!names.includes(n)) names.push(n);
    if (!names.length && S.storeMode === "local") lsSet("pb_data", localSnapshot());
    if (Games.table) Games.push();
    if (Evals.out.size) Evals.flush();
    return Promise.all(names.map(n => this.flush(n)));
  },
  async flush(name) {
    if ((name === "games" || name === "acc") && Games.table) { Dirty.clear(name, Date.now()); return; } // old docs retired
    lsSet("pb_data", localSnapshot());
    if (!this.db && S.storeMode !== "supabase") { this.savedAt = Date.now(); this.emit(); return; }
    if (this.inflight[name]) { this.pending[name] = true; return; }
    this.inflight[name] = true;
    this.emit();
    const started = Date.now();
    try {
      let body = this.docFor(name);
      if (this.db) {
        if (name === "games") {
          let list = S.games.slice();
          while (JSON.stringify(list).length > 230000 && list.length) list = list.slice(0, Math.floor(list.length * 0.85));
          body = { list };
        }
        await this.db.doc(`data/users/${this.uid}/${name}`).set(JSON.parse(JSON.stringify(body)));
      } else {
        // The database trigger sets updated_at; read it back so refresh() only compares server times
        const { data, error } = await this.sb.from("prep_data")
          .upsert({ user_id: this.user.id, doc: name, data: JSON.parse(JSON.stringify(body)), updated_at: new Date().toISOString() }, { onConflict: "user_id,doc" })
          .select("updated_at").single();
        if (error) throw error;
        this.seen[name] = data.updated_at;
        Dirty.clear(name, started);
      }
      this.failed = false;
      this.savedAt = Date.now();
    } catch (e) {
      this.failed = true;
      if (e && e.code === "quota_exceeded") toast("Cloud storage is full; saved on this device only.");
    }
    this.inflight[name] = false;
    if (this.pending[name]) { this.pending[name] = false; this.flush(name); }
    this.emit();
  },
};

/* ---------- sign-in screen (hosted copy) ---------- */
function showAuth(onDone) {
  const v = $("#authView");
  v.hidden = false;
  document.querySelector("main").hidden = true;
  document.querySelector(".tabs").hidden = true;
  $("#loading").hidden = true;
  const st = $("#authStatus");
  const creds = () => ({ email: $("#authEmail").value.trim(), password: $("#authPass").value });
  const done = () => { v.hidden = true; document.querySelector("main").hidden = false; document.querySelector(".tabs").hidden = false; onDone(); };
  $("#authForm").onsubmit = async e => {
    e.preventDefault();
    const c = creds();
    if (!c.email || !c.password) { st.textContent = "Enter your email and password."; return; }
    st.textContent = "Signing in…";
    const { data, error } = await Store.sb.auth.signInWithPassword(c);
    if (error) { st.textContent = /confirm/i.test(error.message) ? "Confirm your email first: open the link in the email Supabase sent you, then sign in here." : "Sign-in failed: " + error.message; return; }
    if (await Store.loadRemote(data.user)) done(); else st.textContent = "Signed in, but the database couldn't be read. Try again in a moment.";
  };
  $("#authSignup").onclick = async () => {
    const c = creds();
    if (!c.email || c.password.length < 6) { st.textContent = "Enter your email and a password of at least 6 characters."; return; }
    st.textContent = "Creating your account…";
    const { data, error } = await Store.sb.auth.signUp({ ...c, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) { st.textContent = "Couldn't create the account: " + error.message; return; }
    if (data.session) { if (await Store.loadRemote(data.user)) done(); return; }
    st.textContent = "Account created. Open the confirmation link in your email, then sign in here.";
  };
  $("#authLocal").onclick = () => {
    lsSet("pb_local_only", true);
    applyData(lsGet("pb_data", {}));
    S.storeMode = "local";
    done();
  };
}
