"use strict";
/* ---------- auto-build the repertoire from my games (v0.9.1) ----------
   Walks my games for one colour, move by move from the start, and proposes a tree:
   - my turn: the moves I've played there at least `minGames` times. The most played one that
     Stockfish (depth AB_DEPTH) says gives up at most `maxLoss` centipawns against the best
     move is added. If my score with it is under `minScore` it's still added but flagged
     (`poor`), since leaving it out would also drop every line after it (v0.9.6); with
     `strictScore` it's left out instead, as before. Moves that are left out are listed with
     the reason. Where the repertoire already has a move of mine, it's kept and followed
     (nothing is replaced).
   - the opponent's turn: every reply that came up at least `minGames` times.
   It stops after `plies` half-moves, or when fewer than `minGames` games reach a position.
   The result is a plan to preview; applyAutoBuild() adds it. Games are followed by their move
   order, so a transposition in my games counts under the order it was played in. */
const AB_DEPTH = 12;
const abDefaults = () => ({ minGames: 3, minScore: 0.45, maxLoss: 70, plies: 20, strictScore: false });
const abOpts = () => ({ ...abDefaults(), ...(S.settings.autobuild || {}) });
const AB = { running: false, stop: false, checks: 0, plan: null, color: null };

// How much a move gives up against the best move, from the mover's side (cp), or null if the
// engine isn't available
async function moveLoss(fen, san) {
  if (Engine.failed) return null;
  const after = fenAfter(fen, [san]);
  if (!after) return null;
  try {
    const [b, a] = await Promise.all([Engine.analyse(fen, AB_DEPTH, { prio: PRIO.soon }), Engine.analyse(after, AB_DEPTH, { prio: PRIO.soon })]);
    AB.checks++;
    return Math.max(0, b.cp + a.cp); // a.cp is from the opponent's side after the move
  } catch (e) { return null; }
}
const scoreOf = list => { const s = list.map(x => x.s).filter(x => x != null); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };

async function planAutoBuild(color, opts = abOpts(), onTick = () => {}) {
  const R = rep(color);
  const games = S.games.filter(g => g.my === color && g.moves).map(g => ({ m: g.moves.split(" "), s: myScore(g) }));
  const plan = { color, opts, adds: [], skipped: [], games: games.length };
  const queue = [{ path: [], gs: games }];
  while (queue.length) {
    if (AB.stop) { plan.stopped = true; break; }
    const { path, gs } = queue.shift();
    if (path.length >= opts.plies || gs.length < opts.minGames) continue;
    const fen = fenAfter(START, path);
    if (!fen) continue;
    const key = K(fen), n = R.pos[key];
    const by = new Map();
    for (const g of gs) { const s = g.m[path.length]; if (s) { if (!by.has(s)) by.set(s, []); by.get(s).push(g); } }
    const often = [...by.entries()].filter(([, a]) => a.length >= opts.minGames).sort((x, y) => y[1].length - x[1].length);
    if (isMine(key, color)) {
      if (n && n.m.length) { // already prepared: follow my moves
        for (const s of n.m) if (by.has(s)) queue.push({ path: [...path, s], gs: by.get(s) });
        continue;
      }
      for (const [s, a] of often) {
        const score = scoreOf(a);
        const poor = score != null && score < opts.minScore;
        // Poor results only rule a move out when asked (strictScore): ruling it out also drops every
        // line after it, and the score of a whole game says little about one early move
        if (poor && opts.strictScore) { plan.skipped.push({ path, san: s, games: a.length, score, why: "results" }); continue; }
        const loss = await moveLoss(fen, s);
        onTick(plan);
        if (AB.stop) break;
        if (loss != null && loss > opts.maxLoss) { plan.skipped.push({ path, san: s, games: a.length, score, loss, why: "engine" }); continue; }
        plan.adds.push({ mine: true, path, san: s, games: a.length, score, loss, poor });
        queue.push({ path: [...path, s], gs: a });
        break; // one move of mine per position
      }
    } else {
      for (const [s, a] of often) {
        if (!(n && n.m.includes(s))) plan.adds.push({ mine: false, path, san: s, games: a.length, score: scoreOf(a) });
        queue.push({ path: [...path, s], gs: a });
      }
    }
    onTick(plan);
  }
  return plan;
}
// Add a plan to the repertoire. Moves are in the order they were found, so every move's
// position is already in the tree when it's added.
function applyAutoBuild(plan) {
  let added = 0;
  for (const a of plan.adds) if (addMove(a.path, a.san, plan.color) === "added") added++;
  walk(plan.color);
  Store.save(repDoc(plan.color));
  return added;
}
