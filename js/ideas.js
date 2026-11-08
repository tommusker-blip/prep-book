"use strict";
/* ---------- ideas: practical, memorable move suggestions at my turn ----------
   For a position where it's my move, each candidate move gets:
   - engine: centipawns lost against Stockfish's best move (depth IDEA_DEPTH)
   - practical: how often opponents at my level go wrong after it. For each reply they play
     (Lichess, my rating bands), Stockfish checks the position after it; a reply is a mistake
     if it gives me MISTAKE_CP or more compared with their best defence. "err" is the share of
     peer replies that are mistakes: if the only good reply is rarely found, the move is a trick.
   - memorable: does it lead back into my repertoire (transposition chance, from the same peer
     replies), and does it build the same setup (pieces and pawns off their starting squares)
     as one of my other lines?
   Results (everything except the memorability, which depends on the tree) are cached per
   position and rating band in localStorage (pb_ideas). */
const IDEA_DEPTH = 14, REPLY_DEPTH = 12, MISTAKE_CP = 100;
let IDEAS = lsGet("pb_ideas", {}), ideasVer = 0;
const ideaKey = fen => K(fen) + "|" + bandKey();
const cachedIdeas = fen => IDEAS[ideaKey(fen)] || null;
function saveIdeas() {
  const keys = Object.keys(IDEAS);
  if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete IDEAS[k];
  lsSet("pb_ideas", IDEAS);
}
const ideaRules = () => {
  const g = { ...gemDefaults(), ...S.settings.gem };
  return { maxLoss: (g.trapLoss ?? 150), minErr: (g.trapErr ?? 30) / 100 };
};
// Engine eval in centipawns from my side, whoever is to move
async function evalMine(fen, depth, color, prio = PRIO.background) {
  const e = await Engine.analyse(fen, depth, { prio });
  return { cp: fen.split(" ")[1] === myChar(color) ? e.cp : -e.cp, best: e.best };
}
const afterMove = (fen, san) => { const c = new Chess(fen); return c.move(san, { sloppy: true }) ? c.fen() : null; };

// Analyse the candidate moves at one of my-turn positions. onStep(text) reports progress.
// Returns {at, cands:[…]} and caches it. Stops early (returning null) if shouldStop() says so.
async function analyseIdeas(fen, color = S.color, onStep = () => {}, shouldStop = () => false, prio = PRIO.background) {
  const ex = (S.token && !explorerBlocked) ? await explorer(fen, { prio }) : null;
  onStep("engine: best move");
  const base = await evalMine(fen, IDEA_DEPTH, color, prio);
  const bestSan = uciToSan(fen, base.best);
  // Candidates: the moves peers play here (at least 30 games), plus the engine's choice
  let cands = ex && ex.total ? ex.moves.filter(m => m.n >= 30).sort((a, b) => b.n - a.n).slice(0, 8).map(m => ({ san: m.san, peer: m })) : [];
  if (bestSan && !cands.some(c => c.san === bestSan)) cands.push({ san: bestSan, peer: null });
  const topSan = cands.length && cands[0].peer ? cands[0].san : null;
  const out = [];
  for (const [i, c] of cands.entries()) {
    if (shouldStop()) return null;
    const p1 = afterMove(fen, c.san);
    if (!p1) continue;
    onStep(`move ${i + 1} of ${cands.length}: ${c.san}`);
    const e1 = await evalMine(p1, IDEA_DEPTH, color, prio);
    const cand = {
      san: c.san, p1, myEval: e1.cp, loss: Math.max(0, base.cp - e1.cp),
      top: c.san === topSan, engineBest: c.san === bestSan,
      peer: c.peer ? { n: c.peer.n, f: ex.total ? c.peer.n / ex.total : 0, sc: scoreFor(c.peer, color), avg: posAverage(ex, color) } : null,
      replies: [], total: 0, cover: 0, err: null,
    };
    // How do peers answer it, and how often do they go wrong?
    if (cand.loss <= Math.max(ideaRules().maxLoss, 200) && S.token && !explorerBlocked) {
      const ex1 = await explorer(p1, { prio });
      if (ex1 && ex1.total) {
        cand.total = ex1.total;
        let cum = 0;
        const replies = ex1.moves.filter(m => m.n >= 10).sort((a, b) => b.n - a.n).filter(m => { const keep = cum < 0.9; cum += m.n / ex1.total; return keep; }).slice(0, 8);
        for (const r of replies) {
          if (shouldStop()) return null;
          const p2 = afterMove(p1, r.san);
          if (!p2) continue;
          const e2 = await evalMine(p2, REPLY_DEPTH, color, prio);
          cand.replies.push({ san: r.san, f: r.n / ex1.total, myEval: e2.cp, p2, mistake: e2.cp - e1.cp >= MISTAKE_CP });
        }
        cand.cover = cand.replies.reduce((a, r) => a + r.f, 0);
        if (cand.cover) cand.err = cand.replies.filter(r => r.mistake).reduce((a, r) => a + r.f, 0) / cand.cover;
      }
    }
    out.push(cand);
  }
  const res = { at: Date.now(), base: base.cp, best: bestSan, total: ex ? ex.total : 0, cands: out };
  IDEAS[ideaKey(fen)] = res; ideasVer++;
  saveIdeas(); saveEvalCache();
  return res;
}

/* ----- memorability: how well a move fits what I already play ----- */
// My pieces and pawns that have left their starting squares, e.g. {"Pd4","Pe3","Bf4","Nf3"}
const START_BOARD = START.split(" ")[0].split("/").map(r => r.replace(/\d/g, d => ".".repeat(+d))).join("");
function developed(fen, color) {
  const b = fen.split(" ")[0].split("/").map(r => r.replace(/\d/g, d => ".".repeat(+d))).join(""), out = new Set();
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (p === "." || (color === "white") !== (p === p.toUpperCase())) continue;
    if (START_BOARD[i] === p) continue; // still at home
    out.add(p.toUpperCase() + "abcdefgh"[i % 8] + (8 - Math.floor(i / 8)));
  }
  return out;
}
const jaccard = (a, b) => { if (!a.size && !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
// Setups in my tree (at least 6 plies in), memoised with the tree
let setupMemo = { sig: "", list: [] };
function treeSetups(color) {
  const sig = repSig(color);
  if (setupMemo.sig === sig) return setupMemo.list;
  const list = Object.values(indexTree(color)).filter(p => p.path.length >= 6).map(p => ({ path: p.path, set: developed(p.fen, color) })).filter(x => x.set.size >= 3);
  setupMemo = { sig, list };
  return list;
}
// For a candidate at the position after `path`: transposition chance and setup similarity.
// Memoised per tree; the "one move of mine away" check replays every legal move, so it is
// only done for replies played at least 5% of the time.
let memoMemo = { sig: "", map: new Map() };
function memorability(cand, path, color = S.color) {
  const sig = repSig(color);
  if (memoMemo.sig !== sig) memoMemo = { sig, map: new Map() };
  const mk = path.join(" ") + "|" + cand.san;
  if (memoMemo.map.has(mk)) return memoMemo.map.get(mk);
  const idx = indexTree(color), pre = path.join(" ");
  // (a) after each peer reply, is the position in my tree, or one move of mine away from it?
  let trans = 0, oneAway = 0, joins = null;
  for (const r of cand.replies) {
    if (idx[K(r.p2)]) { trans += r.f; joins = joins || idx[K(r.p2)].path; continue; }
    if (r.f < 0.05) continue;
    const c = new Chess(r.p2);
    for (const mv of c.moves()) { c.move(mv); const hit = idx[K(c.fen())]; c.undo(); if (hit) { oneAway += r.f; joins = joins || hit.path; break; } }
  }
  const cover = cand.cover || 0;
  const transP = cover ? (trans + 0.7 * oneAway) / cover : 0;
  // (b) the setup after the candidate, against setups in my other lines (not this line itself)
  const mine = developed(cand.p1, color);
  let best = 0, like = null;
  for (const s of treeSetups(color)) {
    const sp = s.path.join(" ");
    if (pre && (sp === pre || sp.startsWith(pre + " ") || pre.startsWith(sp))) continue; // this line, its ancestors and descendants
    const j = jaccard(mine, s.set);
    if (j > best) { best = j; like = s.path; }
  }
  const score = Math.max(transP, 0.5 * transP + 0.5 * best);
  const res = { transP, setup: best, like, joins, score };
  memoMemo.map.set(mk, res);
  return res;
}
// Short words for a candidate: "Easy to remember", "Practical trick", "Hidden gem"
function ideaTags(cand, path, color = S.color) {
  const { maxLoss, minErr } = ideaRules(), m = memorability(cand, path, color), tags = [];
  if (cand.loss <= 80 && m.score >= 0.5) tags.push("memorable");
  if (!cand.top && !cand.engineBest && cand.loss <= maxLoss && cand.err != null && cand.err >= minErr && cand.cover >= 0.5 && cand.total >= 100) tags.push("trick");
  if (cand.peer && cand.peer.n >= gemRules().minN && cand.peer.f <= gemRules().maxF && cand.peer.sc - cand.peer.avg >= gemRules().edge) tags.push("gem");
  return { tags, m };
}

/* ----- find ideas across the whole tree (background job) ----- */
const IdeaJob = { running: false, stop: false, done: 0, total: 0, note: "" };
function ideaTodo(color = S.color) { return Object.values(indexTree(color)).filter(p => isMine(K(p.fen), color) && !cachedIdeas(p.fen)); }
async function findIdeasInTree(color = S.color, onTick = () => {}) {
  if (IdeaJob.running) { IdeaJob.stop = true; IdeaJob.note = "Stopping…"; onTick(); return; }
  const todo = ideaTodo(color).sort((a, b) => b.reach - a.reach);
  Object.assign(IdeaJob, { running: true, stop: false, done: 0, total: todo.length, note: "" });
  onTick();
  try {
    for (const p of todo) {
      if (IdeaJob.stop) break;
      IdeaJob.note = `at ${p.path.length ? p.path.join(" ") : "the start"}`;
      onTick();
      const r = await analyseIdeas(p.fen, color, () => {}, () => IdeaJob.stop);
      if (!r) break;
      IdeaJob.done++;
    }
    IdeaJob.note = IdeaJob.stop ? `Stopped after ${IdeaJob.done} of ${IdeaJob.total}.` : `Checked ${IdeaJob.done} position${IdeaJob.done === 1 ? "" : "s"}.`;
  } catch (e) {
    IdeaJob.note = "The engine couldn't run in this browser.";
  }
  IdeaJob.running = false; IdeaJob.stop = false;
  onTick(true);
}
// All cached ideas in my tree, tagged, for the Suggestions card
let treeIdeasMemo = { sig: "", out: null };
function treeIdeas(color = S.color) {
  const sig = repSig(color) + "|" + ideasVer + "|" + JSON.stringify(S.settings.gem || {});
  if (treeIdeasMemo.sig === sig) return treeIdeasMemo.out;
  const out = { memorable: [], trick: [] };
  for (const p of Object.values(indexTree(color))) {
    if (!isMine(K(p.fen), color)) continue;
    const res = cachedIdeas(p.fen);
    if (!res) continue;
    const mine = (rep(color).pos[K(p.fen)] || { m: [] }).m;
    for (const c of res.cands) {
      if (mine.includes(c.san)) continue;
      const { tags, m } = ideaTags(c, p.path, color);
      if (tags.includes("memorable")) out.memorable.push({ path: p.path, c, m, rank: p.reach * m.score });
      if (tags.includes("trick")) out.trick.push({ path: p.path, c, m, rank: p.reach * c.err });
    }
  }
  out.memorable.sort((a, b) => b.rank - a.rank);
  out.trick.sort((a, b) => b.rank - a.rank);
  treeIdeasMemo = { sig, out };
  return out;
}
