"use strict";
/* ---------- storage: Claude db inside Claude, Supabase when hosted, else this browser ---------- */
const SB_URL = "https://serjfzitcbixkhnuxhol.supabase.co";
const SB_KEY = "sb_publishable_sCOcKwpCMuAIbLvPtfmcUw_i6n7FZVF";
const DOCS = ["white", "black", "settings", "games", "acc"];

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
  if (d.white) S.rep.white = normRep(d.white);
  if (d.black) S.rep.black = normRep(d.black);
  if (d.settings) Object.assign(S.settings, d.settings);
  if (d.games && d.games.list) S.games = d.games.list;
  if (d.acc && d.acc.map) S.acc = d.acc.map;
}
function hasLocalData() {
  const d = lsGet("pb_data", null);
  return !!(d && ((d.white && Object.keys(d.white.pos || {}).length) || (d.black && Object.keys(d.black.pos || {}).length) || (d.games && d.games.list && d.games.list.length)));
}
// Docs changed on this device whose save to the database isn't confirmed yet: {doc: localMs}
const Dirty = {
  get: () => lsGet("pb_dirty", {}),
  mark(name) { const d = this.get(); d[name] = Date.now(); lsSet("pb_dirty", d); },
  clear(name, since) { const d = this.get(); if (d[name] && d[name] <= since) { delete d[name]; lsSet("pb_dirty", d); } },
};
const Store = {
  db: null, uid: null, sb: null, user: null, timers: {}, inflight: {}, pending: {}, seen: {},
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
        const snaps = await Promise.race([
          Promise.all(DOCS.map(n => db.doc(`data/users/${uid}/${n}`).get())),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000)),
        ]);
        const d = {};
        snaps.forEach((s, i) => { if (s.exists) d[DOCS[i]] = s.data(); });
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
      if (hasLocalData()) for (const n of DOCS) this.save(n);
      return true;
    }
    // The database copy wins, except for docs this device changed later and never got saved
    const dirty = Dirty.get(), remote = {}, d = {}, push = [];
    for (const r of data) { remote[r.doc] = r; this.seen[r.doc] = r.updated_at; }
    for (const n of DOCS) {
      const r = remote[n];
      if (dirty[n] && local[n] && (!r || dirty[n] > Date.parse(r.updated_at))) { d[n] = local[n]; push.push(n); }
      else if (r) d[n] = r.data;
    }
    applyData(d);
    for (const n of push) this.save(n);
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
    if (this.sb) await this.sb.auth.signOut();
    try { localStorage.removeItem("pb_data"); localStorage.removeItem("pb_dirty"); } catch (e) {}
    location.reload();
  },
  docFor(name) {
    if (name === "games") return { list: S.games };
    if (name === "acc") return { map: S.acc };
    if (name === "settings") return { ...S.settings };
    return S.rep[name];
  },
  save(name) {
    if (S.storeMode === "supabase") Dirty.mark(name);
    clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(() => { this.timers[name] = null; this.flush(name); }, 700);
  },
  // Save everything still waiting, and retry earlier failed saves. Called when the app is hidden.
  flushAll() {
    const names = Object.keys(this.timers).filter(n => this.timers[n]);
    for (const n of names) { clearTimeout(this.timers[n]); this.timers[n] = null; }
    if (S.storeMode === "supabase") for (const n of Object.keys(Dirty.get())) if (!names.includes(n)) names.push(n);
    return Promise.all(names.map(n => this.flush(n)));
  },
  async flush(name) {
    lsSet("pb_data", { white: S.rep.white, black: S.rep.black, settings: S.settings, games: { list: S.games }, acc: { map: S.acc } });
    if (!this.db && S.storeMode !== "supabase") return;
    if (this.inflight[name]) { this.pending[name] = true; return; }
    this.inflight[name] = true;
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
    } catch (e) {
      if (e && e.code === "quota_exceeded") toast("Cloud storage is full; saved on this device only.");
      else if (S.storeMode === "supabase") toast("Couldn't save to the database. Your changes are kept on this device and will be saved next time.");
    }
    this.inflight[name] = false;
    if (this.pending[name]) { this.pending[name] = false; this.flush(name); }
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
