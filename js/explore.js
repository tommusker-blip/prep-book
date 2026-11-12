"use strict";
/* ---------- Lichess opening explorer: client, tree index, tree scan, suggestions ----------
   Needs the network (so not inside Claude) and a personal Lichess token (Settings). */
let explorerBlocked = false; // only inside Claude, where pages can't reach outside sites at all
const EXPL_NET_PAUSE = 20000; // after a network failure (dropped connection, Lichess error page), wait and try again
const EXPL_MAX = 2500;       // cached positions kept in localStorage (pb_expl)
const EXPL_GAP = 1100;       // ms between requests: one at a time, about one a second
let explNext = 0, explSaveTimer = null, explVer = 0;

const bandKey = () => S.settings.band.join(",");

// Lichess rating bands (lower bounds; 2500 means 2500+)
const BANDS = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
/* ---------- G4: rating band that keeps up ----------
   Lichess ratings run higher than chess.com ones: about +250 at club level, so 1500–1600 on
   chess.com is roughly the Lichess 1600–1999 bands. The two bands either side of that estimate
   are suggested, and used automatically until the user picks bands by hand (bandAuto false). */
function bandsFor(cc) {
  const est = cc + 250, top = BANDS[BANDS.length - 2]; // 2200; 2500+ is the open-ended top band
  const b = Math.max(BANDS[0], Math.min(top, Math.floor(est / 200) * 200));
  if (est >= 2500) return [2200, 2500];
  return est - b < 100 && b > BANDS[0] ? [b - 200, b] : [b, Math.min(b + 200, top)];
}
const bandLabel = band => { const lo = Math.min(...band), hi = Math.max(...band); return `${lo}–${hi === 2500 ? "2500+" : hi + 199}`; };
// Where explorer numbers come from, in words
const srcLine = ex => `Lichess rapid, ${S.settings.band.map(b => b + "+").join(" & ")}, ${ex.total.toLocaleString("en-GB")} games`;
// src: my rating bands (default), "masters" (the Lichess masters database) or another band ("2200,2500")
/* v0.9.57: the local copy keeps the most recently used EXPL_MAX positions (a read moves a position to the
   back of the queue, so the tree's positions, read all the time, stay); everything fetched is also kept in
   the database (Stash kind "expl"), which is asked before Lichess and filled in for the tree at start-up. */
let explTouched = 0;
function cachedExplorer(fen, src = bandKey()) {
  const k = K(fen) + "|" + src, d = EXPL[k];
  if (d && explTouched++ % 4 === 0) { delete EXPL[k]; EXPL[k] = d; } // now and then, so reads stay cheap
  return d || null;
}
/* v0.9.60: each position's data carries when it was fetched (at); a scan re-fetches data older than
   explMaxAge() months (Settings, default 6; 0 = never). Data saved before this had no date: it counts from
   when this version first sees it. */
const EXPL_AGES = [0, 3, 6, 12];
const explMaxAge = () => (EXPL_AGES.includes(S.settings.explMaxAge) ? S.settings.explMaxAge : 6);
const explOld = d => { const m = explMaxAge(); return !!m && !!d && Date.now() - (d.at || Date.now()) > m * 30.44 * 864e5; };
function storeExpl(k, small) {
  if (!small.at) small.at = Date.now();
  EXPL[k] = small;
  explVer++;
  const keys = Object.keys(EXPL);
  if (keys.length > EXPL_MAX) for (const x of keys.slice(0, keys.length - EXPL_MAX + 200)) delete EXPL[x];
  saveExplSoon();
}
// Fill the local copy from the database for these positions (no Lichess requests)
async function explPrefetch(fens, src = bandKey()) {
  if (!Stash.usable()) return 0;
  const want = [...new Set(fens.map(f => K(f) + "|" + src))].filter(k => !EXPL[k]);
  if (!want.length) return 0;
  const got = await Stash.getMany("expl", want);
  for (const [k, d] of got) storeExpl(k, d);
  return got.size;
}
// Both colours' trees: everything my repertoire needs, from the database (start-up, in the background)
async function explPrefetchTrees() {
  let n = 0;
  for (const color of ["white", "black"]) n += await explPrefetch(Object.values(indexTree(color)).map(p => p.fen));
  if (n) { treeMemo.sig = ""; if (typeof catStale === "function") { catStale("white"); catStale("black"); } if (typeof render === "function") render(); }
  return n;
}
function saveExplSoon() { clearTimeout(explSaveTimer); explSaveTimer = setTimeout(() => lsSet("pb_expl", EXPL), 1500); }

// Lookups run in the job queue's "net" lane (G3), one at a time and about a second apart, so
// Build, a tree scan and Find ideas never hit Lichess in parallel. opts: {prio, stale}.
// Resolves to the data, or {error: "auth" | "rate" | "http" | "net"}; rejects with Jobs.STALE
// if the request went stale while waiting.
function fetchExplorer(fen, opts = {}) {
  const src = opts.src || bandKey();
  const hit = cachedExplorer(fen, src);
  if (hit) return Promise.resolve(hit);
  // v0.9.57: the database first (fast, and no Lichess quota); then Lichess, in the queue
  if (Stash.usable()) return Stash.get("expl", K(fen) + "|" + src).then(d => { if (d) { storeExpl(K(fen) + "|" + src, d); return d; } return fetchLichess(fen, src, opts); });
  return fetchLichess(fen, src, opts);
}
function fetchLichess(fen, src, opts) {
  return Jobs.add("net", async () => {
    const again = !opts.force && cachedExplorer(fen, src); // force: re-fetch old data (v0.9.60)
    if (again) return again;
    const wait = explNext - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    explNext = Date.now() + EXPL_GAP;
    const url = src === "masters"
      ? `https://explorer.lichess.ovh/masters?moves=12&topGames=0&fen=${encodeURIComponent(fen)}`
      : `https://explorer.lichess.ovh/lichess?variant=standard&speeds=rapid&ratings=${src}&moves=20&topGames=0&recentGames=0&fen=${encodeURIComponent(fen)}`;
    let r;
    try { r = await fetch(url, { headers: { Authorization: "Bearer " + S.token } }); }
    catch (e) { return { error: "net" }; }
    if (r.status === 401) return { error: "auth" };
    if (r.status === 429) { explNext = Date.now() + 61000; return { error: "rate" }; } // Lichess: wait a full minute
    if (!r.ok) return { error: "http", status: r.status };
    const d = await r.json();
    const small = {
      total: d.white + d.draws + d.black, w: d.white, d: d.draws, b: d.black,
      moves: (d.moves || []).map(m => ({ san: m.san, n: m.white + m.draws + m.black, w: m.white, d: m.draws, b: m.black })),
    };
    storeExpl(K(fen) + "|" + src, small);
    Stash.put("expl", K(fen) + "|" + src, small);
    return small;
  }, { prio: opts.prio ?? PRIO.background, key: K(fen) + "|" + src, stale: opts.stale || null });
}
// Cached data, or fetch it. Returns null when there's no token, Lichess can't be used, or the
// request went stale.
async function explorer(fen, opts = {}) {
  const src = opts.src || bandKey();
  const hit = cachedExplorer(fen, src);
  if (hit) return hit;
  if (!S.token || explorerBlocked) return null;
  let d;
  try { d = await fetchExplorer(fen, opts); } catch (e) { return null; }
  if (d.error === "auth") { toast("Lichess rejected the token. Check it in Settings."); return null; }
  if (d.error === "net") {
    // Inside Claude nothing outside can be reached, so stop asking. Anywhere else a failure is
    // usually brief (a dropped connection, or a Lichess error page without CORS headers): pause and
    // let later requests try again. This used to block Lichess for the whole session, which
    // looked like a lost token, since pasting the token again cleared the block.
    if (S.storeMode === "db") explorerBlocked = true; else explNext = Math.max(explNext, Date.now() + EXPL_NET_PAUSE);
    return null;
  }
  return d.error ? null : d;
}

/* ----- scores ----- */
// My score from Lichess counts (0..1): wins plus half the draws, from my side
function scoreFor(x, color) {
  const n = x.n != null ? x.n : x.total;
  return n ? ((color === "white" ? x.w : x.b) + x.d / 2) / n : null;
}
// Average score over all games in the position. Entries cached by older builds have no
// position totals, so fall back to the sum of the listed moves.
function posAverage(ex, color) {
  if (ex.w != null) return scoreFor(ex, color);
  const s = ex.moves.reduce((a, m) => ({ w: a.w + m.w, d: a.d + m.d, b: a.b + m.b, n: a.n + m.n }), { w: 0, d: 0, b: 0, n: 0 });
  return scoreFor(s, color);
}
// Thresholds (Settings): at least `min` games, played at most `freq` %, `edge` points above average
const gemDefaults = () => ({ min: 300, freq: 10, edge: 5 });
const gemRules = () => {
  const g = { ...gemDefaults(), ...S.settings.gem };
  return { minN: g.min, maxF: g.freq / 100, edge: g.edge / 100 };
};
// What a candidate move looks like at my turn: "gem" (rare, scores well), "better" (scores
// better than my move), or null
function judgeMove(m, ex, color, mine) {
  const { minN, maxF, edge } = gemRules();
  if (mine.includes(m.san) || m.n < minN || !ex.total) return null;
  const sc = scoreFor(m, color), f = m.n / ex.total;
  if (f <= maxF && sc - posAverage(ex, color) >= edge) return "gem";
  const myScores = ex.moves.filter(x => mine.includes(x.san) && x.n >= minN).map(x => scoreFor(x, color));
  if (myScores.length && sc - Math.max(...myScores) >= edge) return "better";
  return null;
}

/* ----- tree index ----- */
// Every position reachable in my repertoire, breadth first: key -> {path, fen, reach}.
// reach estimates the share of my games that get there, from opponent move frequencies
// (a move missing from the Lichess data counts as 1%; no data yet counts as 100%).
// Memoised on the repertoire, the explorer cache and the rating bands.
let treeMemo = { sig: "", idx: null };
// Changes whenever the open book's tree, the explorer cache or the rating bands change
function repSig(color) { return color + "|" + S.book + "|" + bandKey() + "|" + explVer + "|" + walk(color).sig; }
// Built from walk()'s nodes, so no moves are replayed here
function indexTree(color = S.color) {
  const sig = repSig(color);
  if (treeMemo.sig === sig) return treeMemo.idx;
  const { nodes } = walk(color), idx = {}, q = [{ key: K(START), reach: 1 }];
  while (q.length) {
    const { key, reach } = q.shift();
    if (idx[key] || !nodes[key]) continue;
    const node = nodes[key];
    idx[key] = { path: node.path, fen: node.fen, reach };
    const ex = isMine(key, color) ? null : cachedExplorer(node.fen);
    for (const kid of node.kids) {
      let r = reach;
      if (ex && ex.total) { const mv = ex.moves.find(x => x.san === kid.san); r *= mv ? mv.n / ex.total : 0.01; }
      else if (!isMine(key, color) && node.kids.length > 1) r /= node.kids.length; // no data yet: prepared replies share it evenly (v0.9.24)
      q.push({ key: kid.key, reach: r });
    }
  }
  treeMemo = { sig, idx };
  return idx;
}

/* ----- scan my tree ----- */
// Fetch explorer data for every position in the tree that has none, most-reached first.
const Scan = { running: false, stop: false, done: 0, total: 0, note: "", color: "" };
function scanTodo(color = S.color) { return Object.values(indexTree(color)).filter(p => !cachedExplorer(p.fen)); }
/* v0.9.60: tidy up. Positions in any prep book's repertoire, either colour: every position with saved moves
   and the positions those moves lead to (line ends). Lichess data for anything else (lines removed, or
   positions only looked at in Build, Connect or Routes) can be deleted, here and in the database. */
function repertoireKeys() {
  const keep = new Set();
  for (const book of Object.values(S.books)) for (const color of ["white", "black"]) {
    const R = book[color];
    if (!R || !R.pos) continue;
    for (const [key, n] of Object.entries(R.pos)) {
      keep.add(key);
      for (const m of n.m || []) { const f = fenAfter(key + " 0 1", [m]); if (f) keep.add(K(f)); }
    }
  }
  keep.add(K(START));
  return keep;
}
const explPos = k => k.slice(0, k.lastIndexOf("|"));
/* v0.9.61: what a tidy would delete: {local: [keys], remote: [keys]} (remote only when signed in). Positions near
   the repertoire are kept too, because Connect (chains of up to 4 moves between your lines) and Routes from the
   start use their data: near = at most TIDY_NEAR squares different from some repertoire position, the same test
   Connect uses for its chains (2 × 4 plies + 2). Only data far from everything you play is deleted. */
const TIDY_NEAR = 10;
async function explTidyPlan(onTick = () => {}) {
  const keep = repertoireKeys();
  const remoteAll = await Stash.keys("expl");
  const cand = [...new Set([...Object.keys(EXPL), ...remoteAll].map(explPos))].filter(p => !keep.has(p));
  const trees = [...keep].map(k => boardArr(k));
  const far = new Set();
  for (let i = 0; i < cand.length; i++) {
    const a = boardArr(cand[i]);
    let near = false;
    for (const t of trees) {
      let d = 0;
      for (let j = 0; j < 64 && d <= TIDY_NEAR; j++) if (a[j] !== t[j]) d++;
      if (d <= TIDY_NEAR) { near = true; break; }
    }
    if (!near) far.add(cand[i]);
    if (i % 200 === 199) { onTick(i + 1, cand.length); await new Promise(r => setTimeout(r, 0)); }
  }
  const local = Object.keys(EXPL).filter(k => far.has(explPos(k)));
  const remote = remoteAll.filter(k => far.has(explPos(k)));
  return { local, remote, keep: keep.size, near: cand.length - far.size };
}
async function explTidy(plan) {
  plan.local.forEach(k => delete EXPL[k]);
  explVer++; clearTimeout(explSaveTimer); lsSet("pb_expl", EXPL);
  const n = plan.remote.length ? await Stash.del("expl", plan.remote) : 0;
  return { local: plan.local.length, remote: n };
}
// v0.9.60: positions whose data is older than explMaxAge() (a scan fetches them again)
function scanStale(color = S.color) { return Object.values(indexTree(color)).filter(p => explOld(cachedExplorer(p.fen))); }
async function scanTree(color = S.color, onTick = () => {}) {
  if (Scan.running) { Scan.stop = true; Scan.note = "Stopping…"; onTick(); return; }
  if (!S.token) { toast("Add a Lichess token in Settings first."); return; }
  // v0.9.57: what the database already has comes first, in one go; Lichess only for the rest.
  // v0.9.60: then data older than explMaxAge() is fetched again (another device may have done it already).
  const missing = scanTodo(color), old0 = scanStale(color);
  Object.assign(Scan, { running: true, stop: false, done: 0, total: missing.length + old0.length, note: "Checking what's saved…", color });
  onTick();
  let saved = await explPrefetch(missing.map(p => p.fen));
  if (old0.length && Stash.usable()) {
    const src = bandKey(), got = await Stash.getMany("expl", old0.map(p => K(p.fen) + "|" + src));
    for (const [k, d] of got) { const mine = EXPL[k]; if (!explOld(d) && (d.at || 0) > ((mine && mine.at) || 0)) { storeExpl(k, d); saved++; } }
  }
  const todo = scanTodo(color).sort((a, b) => b.reach - a.reach), old = scanStale(color).sort((a, b) => b.reach - a.reach);
  Object.assign(Scan, { done: saved, total: saved + todo.length + old.length, note: "" });
  onTick();
  const jobs = [...todo.map(p => [p, false]), ...old.map(p => [p, true])];
  for (const [p, force] of jobs) {
    if (Scan.stop) break;
    const get = () => (force ? fetchLichess(p.fen, bandKey(), { force: true }) : fetchExplorer(p.fen));
    let d = await get();
    if (d.error === "rate") { Scan.note = "Lichess asked for a pause. Waiting a minute…"; onTick(); d = await get(); }
    if (d.error === "auth") { Scan.note = "Lichess rejected the token. Check it in Settings."; break; }
    if (d.error === "net" || d.error === "rate") { Scan.note = "Couldn't reach Lichess. Try again later."; break; }
    Scan.done++; Scan.note = ""; onTick();
  }
  if (!Scan.note || Scan.note === "Stopping…") Scan.note = Scan.stop ? `Stopped after ${Scan.done} of ${Scan.total}.` : `Fetched ${Scan.done} position${Scan.done === 1 ? "" : "s"}${old.length ? ` (${old.length} refreshed)` : ""}.`;
  Scan.running = false; Scan.stop = false;
  clearTimeout(explSaveTimer); lsSet("pb_expl", EXPL);
  onTick(true);
}

/* ----- suggestions ----- */
// Pawns only, for comparing structures: the board with every other piece blanked out
const pawnKey = board => board.replace(/\d/g, d => ".".repeat(+d)).replace(/[nbrqkNBRQK]/g, ".");
const family = name => name.split(":")[0].replace(/Defense/g, "Defence");
let sugMemo = { sig: "", out: null };
function suggestions(color = S.color) {
  const sig = repSig(color) + "|" + JSON.stringify(S.settings.gem || {});
  if (sugMemo.sig === sig) return sugMemo.out;
  const idx = indexTree(color), R = rep(color);
  const gems = [], better = [], trans = [], struct = [];
  for (const [key, p] of Object.entries(idx)) {
    const ex = cachedExplorer(p.fen);
    if (!ex || !ex.total) continue;
    const mine = (R.pos[key] && R.pos[key].m) || [];
    const myTurn = isMine(key, color);
    // (4) hidden gems and (5c) better-scoring alternatives, at my turn
    if (myTurn) {
      const avg = posAverage(ex, color);
      const myBest = Math.max(-1, ...ex.moves.filter(x => mine.includes(x.san)).map(x => scoreFor(x, color)));
      for (const m of ex.moves) {
        const kind = judgeMove(m, ex, color, mine);
        if (!kind) continue;
        const sc = scoreFor(m, color);
        const row = { path: p.path, san: m.san, n: m.n, f: m.n / ex.total, sc, avg, myBest, mine: mine.slice() };
        if (kind === "gem") gems.push({ ...row, rank: p.reach * (sc - avg) });
        else better.push({ ...row, rank: p.reach * (sc - myBest) });
      }
    }
    // (5a) moves from a position in my tree that transpose into another position in my tree
    for (const m of ex.moves) {
      if (mine.includes(m.san) || m.n / ex.total < 0.02) continue;
      const c = new Chess(p.fen);
      if (!c.move(m.san)) continue;
      const to = idx[K(c.fen())];
      if (to) trans.push({ path: p.path, san: m.san, n: m.n, f: m.n / ex.total, to: to.path, myTurn, rank: p.reach * (myTurn ? 0.5 : m.n / ex.total) });
    }
  }
  // (5b) named openings that reach the same pawn structure as one of my lines (8+ plies deep)
  const byPawns = {};
  for (const [key, p] of Object.entries(idx)) {
    if (p.path.length < 8) continue;
    const pk = pawnKey(key.split(" ")[0]);
    if (!byPawns[pk] || p.path.length > byPawns[pk].path.length) byPawns[pk] = p;
  }
  if (typeof OPENINGS !== "undefined" && Object.keys(byPawns).length) {
    const famOf = new Map(), seen = new Set();
    for (const [key, [eco, name]] of Object.entries(OPENINGS)) {
      if (idx[key]) continue;
      const mineP = byPawns[pawnKey(key.split(" ")[0])];
      if (!mineP) continue;
      if (!famOf.has(mineP)) { const op = openingFor(mineP.path); famOf.set(mineP, op ? op.name : ""); }
      const myName = famOf.get(mineP);
      if (family(name) === family(myName)) continue; // same opening family: not new
      const id = family(name) + "|" + mineP.path.join(" ");
      if (seen.has(id)) continue;
      seen.add(id);
      struct.push({ eco, name: name.replace(/Defense/g, "Defence"), key, mine: mineP.path, myName, rank: mineP.reach });
    }
  }
  const by = (a, b) => b.rank - a.rank;
  const out = { gems: gems.sort(by), better: better.sort(by), trans: trans.sort(by), struct: struct.sort(by) };
  sugMemo = { sig, out };
  return out;
}
// A Lichess analysis board for a position key (for openings not in my tree)
const lichessAnalysis = key => "https://lichess.org/analysis/standard/" + encodeURIComponent(key + " 0 1").replace(/%20/g, "_");
