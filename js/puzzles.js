"use strict";
/* ---------- mistake review: puzzles from my own games (NOTES item 9) ----------
   Uses the full-game analysis (acc v2: ev = eval from White's side per position, bm = best move
   per position, depth 10) and the clock times (game.clk = seconds left after each move).

   A mistake is a move of mine that loses at least the "mistake size" (Settings > Advanced,
   default 1.5 pawns), or that turns a win into a draw or a draw into a loss (win/loss = ±2
   pawns from my side) while losing at least the "good move" margin.

   A mistake becomes a puzzle unless:
     lost       - I was already lost before it (−3 pawns or worse)
     winning    - I was still clearly winning after it (+3 or better)
     clock      - I had less than the time-pressure cut-off left when I made it
     recapture  - it recaptured on the square the opponent had just captured on
     forced     - it was my only legal move
     unpunished - the opponent didn't punish it: their next move (and the one after, if there
                  is one) must be within the good-move margin, and I must still be at least half
                  the mistake size worse than before
   The overview counts all mistakes by phase and by time left, including excluded ones.

   Working out the positions needs chess.js, so games are scanned in the background in small
   batches (scanMistakes), and the results are kept per game until the analysis or the
   thresholds change. */
const RESULT_CP = 200, LOST_CP = -300, WINNING_CP = 300;
const MIST = { byGame: new Map(), running: false, done: 0, total: 0, sig: "" };
const resultClass = cp => (cp >= RESULT_CP ? 1 : cp <= -RESULT_CP ? -1 : 0);
const targetSq = san => { const m = /([a-h][1-8])(?:=[QRBN])?[+#]?$/.exec(san || ""); return m ? m[1] : ""; };
const mistSig = () => { const a = adv(); return [a.mistake, a.good, a.clock].join("|"); };
// Seconds on my clock when I had to make the move at ply i: what I had left after my
// previous move (clk[i-2]); for my first move, the starting time from the time control
function clockBefore(g, i) {
  if (!g.clk) return null;
  if (i >= 2 && g.clk[i - 2] != null) return g.clk[i - 2];
  const base = +(String(g.tcs || "").split("+")[0]);
  return base > 0 ? base : null;
}
// Phase from the position: endgame with few pieces left, opening in the first 12 moves
function phaseOf(fen, ply) {
  const board = fen.split(" ")[0], pieces = (board.match(/[nbrqNBRQ]/g) || []).length, queens = (board.match(/[qQ]/g) || []).length;
  if (pieces <= 6 || (queens === 0 && pieces <= 8)) return "endgame";
  return ply < 24 ? "opening" : "middlegame";
}
// All mistakes in one game, each with the reasons (if any) it isn't a puzzle
function gameMistakes(g, a, treeIdx) {
  if (!a || a.v !== 2 || !g.my || !g.moves) return [];
  const { mistake, good, clock } = adv(), moves = g.moves.split(" "), ev = a.ev, last = ev.length - 1;
  const mine = i => (g.my === "white" ? ev[i] : -ev[i]);
  const found = [];
  for (let i = 0; i < last; i++) {
    if ((i % 2 === 0 ? "white" : "black") !== g.my) continue;
    const before = mine(i), after = mine(i + 1), loss = before - after;
    if (!(loss >= mistake || (resultClass(after) < resultClass(before) && loss >= good))) continue;
    const m = { gid: g.id, ply: i, played: moves[i], bestUci: a.bm[i] || "", before, after, loss, clock: clockBefore(g, i), reasons: [] };
    if (before <= LOST_CP) m.reasons.push("lost");
    if (after >= WINNING_CP) m.reasons.push("winning");
    if (m.clock != null && m.clock < clock) m.reasons.push("clock");
    const prev = moves[i - 1];
    if (prev && prev.includes("x") && m.played.includes("x") && targetSq(prev) === targetSq(m.played)) m.reasons.push("recapture");
    // Punished: the opponent's next move (and the one after) stay within the margin, and I stay clearly worse
    const oppLoss = j => (j + 1 <= last ? (-mine(j)) - (-mine(j + 1)) : null); // their eval before minus after
    const r1 = oppLoss(i + 1), r2 = oppLoss(i + 3);
    const stillWorse = i + 2 <= last && mine(i + 2) <= before - mistake / 2;
    if (r1 == null || r1 > good || (r2 != null && r2 > good) || !stillWorse) m.reasons.push("unpunished");
    found.push(m);
  }
  if (!found.length) return found;
  // Positions (for the phase, the only-move check and "from your prep"): one replay per game
  const c = new Chess(), maxPly = found[found.length - 1].ply;
  const at = new Map(found.map(m => [m.ply, m]));
  for (let i = 0; i <= maxPly; i++) {
    const m = at.get(i);
    if (m) {
      m.fen = c.fen();
      m.phase = phaseOf(m.fen, i);
      if (c.moves().length === 1) m.reasons.push("forced");
      m.inPrep = !!(treeIdx && treeIdx[K(m.fen)]);
    }
    if (!c.move(moves[i])) { found.forEach(x => { if (x.ply >= i && !x.fen) x.reasons.push("forced"); }); break; }
  }
  return found.filter(m => m.fen);
}
/* ----- the scan, kept between sessions (v0.9.3) -----
   Results are saved in this device's IndexedDB (they're too big for localStorage: a few MB for
   ~2,000 games), per game with a stamp of its analysis, so on the next visit only new or
   re-analysed games are scanned. A change of thresholds (mistSig) starts again. */
const mistKey = () => "mist:" + (typeof Games !== "undefined" && Games.space ? Games.space() : "local");
Object.assign(MIST, { loaded: false, stamp: new Map() });
async function loadMistakes() {
  MIST.loaded = true;
  const saved = typeof IDB !== "undefined" ? await IDB.get(mistKey()) : null;
  if (!saved || saved.v !== 1 || saved.sig !== mistSig()) return;
  MIST.sig = saved.sig;
  for (const [gid, [stamp, list]] of Object.entries(saved.games || {})) {
    if (accStamp(S.acc[gid]) === stamp) { MIST.byGame.set(gid, list); MIST.stamp.set(gid, stamp); }
  }
}
let mistSaveTimer = null;
function saveMistakesSoon() {
  if (typeof IDB === "undefined") return;
  clearTimeout(mistSaveTimer);
  mistSaveTimer = setTimeout(() => {
    const games = {};
    for (const [gid, list] of MIST.byGame) games[gid] = [MIST.stamp.get(gid) || "", list];
    IDB.set(mistKey(), { v: 1, sig: MIST.sig, games });
  }, 1000);
}
// Analysed games with no scan result yet, or one from an older analysis
const mistTodo = () => S.games.filter(g => { const a = S.acc[g.id]; return a && a.v === 2 && MIST.stamp.get(g.id) !== accStamp(a); });
// Does the scan need to run? (false while it's already running)
const mistNeedsScan = () => !MIST.running && (!MIST.loaded || MIST.sig !== mistSig() || mistTodo().length > 0);
// Scan the analysed games that need it in the background (about 12 ms of work per tick);
// onTick(done?). The first call of a session reads the saved results first.
function scanMistakes(onTick = () => {}) {
  if (MIST.running) return;
  if (!MIST.loaded) {
    Object.assign(MIST, { running: true, done: 0, total: 0 });
    loadMistakes().catch(() => {}).then(() => { MIST.running = false; scanMistakes(onTick); });
    return;
  }
  const sig = mistSig();
  if (sig !== MIST.sig) { MIST.byGame.clear(); MIST.stamp.clear(); MIST.sig = sig; }
  const todo = mistTodo();
  if (!todo.length) { onTick(true); return; }
  const idx = { white: indexTree("white"), black: indexTree("black") };
  Object.assign(MIST, { running: true, done: 0, total: todo.length });
  let k = 0;
  const step = () => {
    const end = performance.now() + 12;
    while (k < todo.length && performance.now() < end) {
      const g = todo[k++], a = S.acc[g.id];
      MIST.byGame.set(g.id, gameMistakes(g, a, idx[g.my])); MIST.stamp.set(g.id, accStamp(a)); MIST.done++;
    }
    onTick(false);
    if (k < todo.length) setTimeout(step, 0); else { MIST.running = false; saveMistakesSoon(); onTick(true); }
  };
  setTimeout(step, 0);
}
const allMistakes = () => [...MIST.byGame.values()].flat();
const puzzleId = m => m.gid + ":" + m.ply;
// Puzzles: mistakes with no exclusion reason, newest games first
function puzzleList() {
  const order = new Map(S.games.map((g, i) => [g.id, i]));
  return allMistakes().filter(m => !m.reasons.length).sort((a, b) => (order.get(a.gid) - order.get(b.gid)) || a.ply - b.ply);
}
// Overview: all mistakes by phase and by time left (NOTES item 9)
const CLOCK_BUCKETS = [["5 min +", 300, Infinity], ["2–5 min", 120, 300], ["1–2 min", 60, 120], ["30 s – 1 min", 30, 60], ["under 30 s", 0, 30]];
function mistakeOverview() {
  const all = allMistakes().filter(m => !m.reasons.includes("lost") && !m.reasons.includes("winning"));
  const phase = { opening: 0, middlegame: 0, endgame: 0 }, clock = CLOCK_BUCKETS.map(([label]) => ({ label, n: 0 }));
  let noClock = 0;
  for (const m of all) {
    phase[m.phase] = (phase[m.phase] || 0) + 1;
    if (m.clock == null) { noClock++; continue; }
    const b = CLOCK_BUCKETS.findIndex(([, lo, hi]) => m.clock >= lo && m.clock < hi);
    if (b >= 0) clock[b].n++;
  }
  return { total: all.length, phase, clock, noClock, games: MIST.byGame.size };
}

/* ----- keep / seen / later, and spaced repetition for kept puzzles ----- */
// S.puzzles.map: id -> {st: "keep" | "seen" | "later", c: SM-2 card (kept ones), n: attempts, ok: solved}
const pzState = id => (S.puzzles.map || {})[id] || null;
function setPuzzle(id, patch) {
  S.puzzles.map = S.puzzles.map || {};
  S.puzzles.map[id] = { ...(S.puzzles.map[id] || {}), ...patch };
  Store.save("puzzles");
}
// Is the mistake's position in my repertoire now? (Worked out fresh: saved scans can predate tree changes)
function inPrepNow(m) {
  const g = S.games.find(x => x.id === m.gid);
  return !!(g && m.fen && indexTree(g.my)[K(m.fen)]);
}
// Suggest Keep for mistakes that recur (same position, or 3+ in the same opening and phase),
// that came from my opening prep, or that I failed; Seen it for one-offs I solved at once.
function suggestKeep(m, solvedFirst, list = puzzleList()) {
  if (!solvedFirst || inPrepNow(m)) return true;
  const key = K(m.fen), fam = openingFamilyOf(m.gid);
  const same = list.filter(x => x !== m && (K(x.fen) === key || (x.phase === m.phase && fam && openingFamilyOf(x.gid) === fam)));
  return same.some(x => K(x.fen) === key) || same.length >= 2;
}
// The opening family of a game ("Sicilian Defence"), from its first positions
const famMemo = new Map();
function openingFamilyOf(gid) {
  if (famMemo.has(gid)) return famMemo.get(gid);
  const g = S.games.find(x => x.id === gid);
  let fam = "";
  if (g) for (const k of gameKeys(g)) { const o = typeof OPENINGS !== "undefined" && OPENINGS[k]; if (o) fam = o[1].split(":")[0]; }
  famMemo.set(gid, fam);
  return fam;
}
// The next session: kept puzzles that are due (most overdue first), then new ones, then ones put
// off for later. New and later ones come in a random order rather than by date, so a session
// mixes games and openings. PZ.rng can be swapped for a fixed one in tests.
const PZ = { rng: Math.random };
function shuffled(a, rng = PZ.rng) {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function puzzleQueue(n = 10, now = Date.now()) {
  const list = puzzleList(), due = [], fresh = [], later = [];
  for (const m of list) {
    const st = pzState(puzzleId(m));
    if (!st) fresh.push(m);
    else if (st.st === "keep" && st.c && st.c.due <= now) due.push(m);
    else if (st.st === "later") later.push(m);
  }
  due.sort((a, b) => pzState(puzzleId(a)).c.due - pzState(puzzleId(b)).c.due);
  return [...due, ...shuffled(fresh), ...shuffled(later)].slice(0, n);
}
