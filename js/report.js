"use strict";
/* ---------- coach data report (CLAUDE.md backlog 6, NOTES "connections") ----------
   A compact report of aggregated numbers and line names (SAN), for an AI coach to read later.
   No raw games and no engine analysis by the AI: the numbers here are the evidence. Built from
   what the app already has: games and their analysis, the repertoire and training cards,
   Lichess data already cached, mistakes (puzzles.js), gaps (gaps.js) and ideas. */
const r1 = x => (x == null || isNaN(x) ? null : Math.round(x * 1000) / 10); // 0..1 -> percent, 1 dp
const avgOf = a => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
const sanLine = path => numbered(0, path);
// The opening a game is in: the deepest named position among its first plies
function gameOpening(g) {
  let name = "", eco = "";
  for (const k of gameKeys(g)) { const o = typeof OPENINGS !== "undefined" && OPENINGS[k]; if (o) { eco = o[0]; name = o[1].replace(/Defense/g, "Defence"); } }
  return { eco, name: name || "Unnamed opening" };
}
// Openings I actually play, from my games: results, accuracy, prep depth, misplays
function openingStats(color) {
  const groups = new Map();
  for (const { g, a, s } of analysis(color, true)) {
    const { eco, name } = gameOpening(g), short = name.split(",")[0]; // family + variation
    const o = groups.get(short) || { opening: short, eco, games: 0, w: 0, d: 0, l: 0, inBook: [], afterBook: [], bookPlies: [], misplays: 0 };
    o.games++;
    if (s === 1) o.w++; else if (s === 0.5) o.d++; else if (s === 0) o.l++;
    const acc = S.acc[g.id];
    if (acc) { if (acc.inb && acc.inb.length) o.inBook.push(...acc.inb); if (acc.post && acc.post.length) o.afterBook.push(...acc.post); }
    o.bookPlies.push(a.ply);
    if (a.type === "misplay") o.misplays++;
    groups.set(short, o);
  }
  return [...groups.values()].filter(o => o.games >= 3).sort((x, y) => y.games - x.games).slice(0, 15).map(o => ({
    opening: o.opening, eco: o.eco, games: o.games,
    winPct: r1(o.w / o.games), drawPct: r1(o.d / o.games), lossPct: r1(o.l / o.games), score: r1((o.w + o.d / 2) / o.games),
    accuracyInBook: avgOf(o.inBook), accuracyAfterBook: avgOf(o.afterBook),
    avgMovesInPrep: Math.round((o.bookPlies.reduce((s, x) => s + x, 0) / o.bookPlies.length / 2) * 10) / 10,
    leftPrepByMisplayPct: r1(o.misplays / o.games),
  }));
}
// Where games leave my repertoire, grouped, with my score from there
function exitStats(color) {
  const groups = new Map();
  for (const { a, s } of analysis(color, true)) {
    const k = a.type + "|" + a.path.join(" ") + "|" + (a.played || "");
    const e = groups.get(k) || { type: a.type, line: sanLine(a.path), move: a.played || "", games: 0, pts: 0, scored: 0 };
    e.games++; if (s != null) { e.pts += s; e.scored++; }
    groups.set(k, e);
  }
  return [...groups.values()].sort((x, y) => y.games - x.games).slice(0, 12)
    .map(e => ({ exit: e.type, line: e.line, move: e.move, games: e.games, score: e.scored ? r1(e.pts / e.scored) : null }));
}
// Positions in my tree where I score below peers (3+ games)
function belowPar(color) {
  const out = [];
  for (const [key, p] of Object.entries(indexTree(color))) {
    const me = myPosStats(key, color), ex = cachedExplorer(p.fen);
    if (!me || me.n < 3 || !ex || !ex.total) continue;
    const peer = posAverage(ex, color), b = blended(me, peer);
    if (b.score < peer - 0.05) out.push({ line: sanLine(p.path), myGames: me.n, myScore: r1(wdlScore(me)), expected: r1(b.score), peerScore: r1(peer), peerGames: ex.total, reach: r1(p.reach) });
  }
  return out.sort((x, y) => (y.reach * (y.peerScore - y.expected)) - (x.reach * (x.peerScore - x.expected))).slice(0, 10);
}
function gapStats(color, mode) {
  const keep = S.settings.gapMode;
  S.settings.gapMode = mode;
  const list = rankedGaps(color).slice(0, 10).map(g => ({
    what: g.opp ? "unprepared reply" : g.text.startsWith("Your move") ? "my move missing" : "line ends",
    line: sanLine(g.opp ? g.path.concat(g.opp) : g.path), reachPct: r1(g.freq || null),
    expectedScore: g.basis === "no data yet" ? null : r1(g.expected), basis: g.basis,
  }));
  S.settings.gapMode = keep;
  return list;
}
// Training: the positions I get wrong most, and the overall picture
function trainingStats(color) {
  const R = rep(color), { nodes } = walk(color), cards = Object.entries(R.cards), now = Date.now();
  const hardest = cards.filter(([, c]) => c.lapses > 0).sort((x, y) => y[1].lapses - x[1].lapses).slice(0, 8)
    .map(([k, c]) => ({ line: sanLine((nodes[k] || { path: [] }).path), myMove: (R.pos[k] || { m: [] }).m.join(" / "), lapses: c.lapses, reviews: c.seen || 0 }));
  return {
    positions: cards.length, learned: cards.filter(([, c]) => c.reps >= 2).length, due: cards.filter(([, c]) => c.due <= now).length,
    flaggedFromGames: cards.filter(([, c]) => c.flag).length, totalLapses: cards.reduce((s, [, c]) => s + (c.lapses || 0), 0), hardest,
  };
}
function mistakeStats() {
  if (!MIST.byGame.size) return { note: "Mistakes not scanned yet: open Train once so the app can scan your games." };
  const o = mistakeOverview(), list = puzzleList();
  const byOpening = new Map();
  for (const m of allMistakes()) if (!m.reasons.includes("lost") && !m.reasons.includes("winning")) {
    const fam = openingFamilyOf(m.gid) || "Unnamed opening", k = fam + "|" + m.phase;
    byOpening.set(k, (byOpening.get(k) || 0) + 1);
  }
  const clusters = [...byOpening.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => { const [opening, phase] = k.split("|"); return { opening, phase, mistakes: n }; });
  const puzzles = Object.values(S.puzzles.map || {});
  return {
    gamesScanned: o.games, mistakes: o.total, byPhase: o.phase, byTimeLeft: Object.fromEntries(o.clock.map(c => [c.label, c.n])),
    clusters, puzzles: list.length, puzzlesKept: puzzles.filter(p => p.st === "keep").length,
    puzzlesSolvedFirstTimePct: puzzles.length ? r1(puzzles.filter(p => p.ok > 0).length / puzzles.length) : null,
  };
}
// Practical weapons and tricks already found (move rows and Find ideas)
function weaponStats(color) {
  const out = [];
  for (const [key, p] of Object.entries(indexTree(color))) {
    if (!isMine(key, color)) continue;
    const res = cachedIdeas(p.fen);
    if (res) for (const c of res.cands) { const { tags } = ideaTags(c, p.path, color); if (tags.includes("trick")) out.push({ line: sanLine(p.path), move: c.san, opponentsGoWrongPct: r1(c.err), engineLossPawns: Math.round(c.loss) / 100, source: "ideas" }); }
  }
  return out.slice(0, 10);
}
function buildCoachReport() {
  const colors = ["white", "black"], res = { w: 0, d: 0, l: 0 };
  for (const g of S.games) { const s = myScore(g); if (s === 1) res.w++; else if (s === 0.5) res.d++; else if (s === 0) res.l++; }
  const n = S.games.length || 1;
  const report = {
    about: "Prep Book coach report: aggregated numbers only (no raw games). Scores are from the player's side, as percentages. Lines are in SAN.",
    generated: new Date().toISOString().slice(0, 10),
    player: {
      chesscomRapid: S.settings.ccRating ? S.settings.ccRating.r : null, lichessBands: bandLabel(S.settings.band),
      rapidGames: S.games.length, winPct: r1(res.w / n), drawPct: r1(res.d / n), lossPct: r1(res.l / n),
      gamesAnalysed: S.games.filter(g => S.acc[g.id] && S.acc[g.id].v === 2).length,
    },
    thresholds: { goodMovePawns: adv().good / 100, mistakePawns: adv().mistake / 100, timePressureSeconds: adv().clock, peerWeightGames: adv().k },
    mistakes: mistakeStats(),
  };
  for (const c of colors) {
    report[c] = {
      openings: openingStats(c), prepExits: exitStats(c), belowPeerPar: belowPar(c),
      biggestGapsByRatingImpact: gapStats(c, "impact"), biggestGapsByFrequency: gapStats(c, "freq"),
      training: trainingStats(c), practicalWeapons: weaponStats(c),
    };
  }
  return report;
}
// What to paste into an AI coach: a short brief, then the report
function coachPrompt(report) {
  return `You are a chess training coach for a club player (about ${report.player.chesscomRapid || "1500–1600"} rapid on chess.com). Don't analyse positions yourself: the numbers below come from Stockfish and from the player's own games and Lichess peers at their level. Using only this evidence, give practical training advice: what to drill, which lines to fix or change and why, recurring habits (for example leaving book early, or mistakes under time pressure), and a short plan for the next two weeks. Refer to the lines by name and moves. Where useful, suggest training material with links and sources.\n\n${JSON.stringify(report)}`;
}
