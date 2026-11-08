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
function cachedExplorer(fen) { return EXPL[K(fen) + "|" + bandKey()] || null; }
function saveExplSoon() { clearTimeout(explSaveTimer); explSaveTimer = setTimeout(() => lsSet("pb_expl", EXPL), 1500); }

// Lookups run in the job queue's "net" lane (G3), one at a time and about a second apart, so
// Build, a tree scan and Find ideas never hit Lichess in parallel. opts: {prio, stale}.
// Resolves to the data, or {error: "auth" | "rate" | "http" | "net"}; rejects with Jobs.STALE
// if the request went stale while waiting.
function fetchExplorer(fen, opts = {}) {
  const hit = cachedExplorer(fen);
  if (hit) return Promise.resolve(hit);
  return Jobs.add("net", async () => {
    const again = cachedExplorer(fen);
    if (again) return again;
    const wait = explNext - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    explNext = Date.now() + EXPL_GAP;
    const url = `https://explorer.lichess.ovh/lichess?variant=standard&speeds=rapid&ratings=${bandKey()}&moves=20&topGames=0&recentGames=0&fen=${encodeURIComponent(fen)}`;
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
    EXPL[K(fen) + "|" + bandKey()] = small;
    explVer++;
    const keys = Object.keys(EXPL);
    if (keys.length > EXPL_MAX) for (const k of keys.slice(0, keys.length - EXPL_MAX + 200)) delete EXPL[k];
    saveExplSoon();
    return small;
  }, { prio: opts.prio ?? PRIO.background, key: K(fen) + "|" + bandKey(), stale: opts.stale || null });
}
// Cached data, or fetch it. Returns null when there's no token, Lichess can't be used, or the
// request went stale.
async function explorer(fen, opts = {}) {
  const hit = cachedExplorer(fen);
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
async function scanTree(color = S.color, onTick = () => {}) {
  if (Scan.running) { Scan.stop = true; Scan.note = "Stopping…"; onTick(); return; }
  if (!S.token) { toast("Add a Lichess token in Settings first."); return; }
  const todo = scanTodo(color).sort((a, b) => b.reach - a.reach);
  Object.assign(Scan, { running: true, stop: false, done: 0, total: todo.length, note: "", color });
  onTick();
  for (const p of todo) {
    if (Scan.stop) break;
    let d = await fetchExplorer(p.fen);
    if (d.error === "rate") { Scan.note = "Lichess asked for a pause. Waiting a minute…"; onTick(); d = await fetchExplorer(p.fen); }
    if (d.error === "auth") { Scan.note = "Lichess rejected the token. Check it in Settings."; break; }
    if (d.error === "net" || d.error === "rate") { Scan.note = "Couldn't reach Lichess. Try again later."; break; }
    Scan.done++; Scan.note = ""; onTick();
  }
  if (!Scan.note || Scan.note === "Stopping…") Scan.note = Scan.stop ? `Stopped after ${Scan.done} of ${Scan.total}.` : `Fetched ${Scan.done} position${Scan.done === 1 ? "" : "s"}.`;
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
