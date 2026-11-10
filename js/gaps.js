"use strict";
/* ---------- gaps in the repertoire, and the "Next gap" button (NOTES item 4) ----------
   A gap is: my move missing in a position I reach, an opponent reply I haven't prepared, or a
   line that stops. Three ways to rank them (Settings: S.settings.gapRank; "depth", below, is the default):
     "freq"   - how often I'll reach it: reach (product of peer move frequencies along the path)
                × the reply's frequency
     "impact" - rating impact: how often × how far my expected score there falls below an even
                50%. Expected score uses the sample-size rule (blended(): my games blended with
                the peer score; peer score alone when I have none). Unprepared positions get a
                small extra weight (GAP_BONUS) because no prep is a risk in itself.
                Only unprepared positions count, in both modes, so adding the move clears the
                gap. Prepared lines I score badly in are in the coach report (belowPar()). */
const GAP_BONUS = 0.02;
/* Which gaps count (v0.9.26, Settings: S.settings.gapOnly):
     "all"   - every gap, as above (the default)
     "faced" - only what my games actually reached: an opponent reply played against me, my move
               missing in a position I've had on the board, a line ending where my games went on
     "good"  - as "faced", and an opponent reply only if it was a good move in at least one of
               those games: within the `good` margin (adv()) of the best at the games' depth-10
               analysis. Blunders I've faced aren't worth prep; games not analysed don't count.
   oppFaced() finds them from my games by position key (so transpositions count). */
const gapOnly = () => (["faced", "good"].includes(S.settings.gapOnly) ? S.settings.gapOnly : "all");
let facedMemo = {};
function oppFaced(color = S.color) {
  const sig = gamesSig() + "|" + accSig() + "|" + GAMEKEYS.size + "|" + adv().good;
  if (facedMemo[color] && facedMemo[color].sig === sig) return facedMemo[color].map;
  const map = {}, margin = adv().good;
  for (const g of S.games) {
    if (g.my !== color || !GAMEKEYS.has(g.id)) continue;
    const keys = GAMEKEYS.get(g.id), moves = g.moves ? g.moves.split(" ") : [], z = S.acc[g.id], ev = z && z.v === 2 ? z.ev : null;
    for (let i = 0; i + 1 < keys.length && i < moves.length; i++) {
      if (isMine(keys[i], color)) continue;
      const o = (map[keys[i]] = map[keys[i]] || {}), m = (o[moves[i]] = o[moves[i]] || { n: 0, good: 0, checked: 0 });
      m.n++;
      if (ev && ev[i + 1] != null) {
        // their loss, from their side: White's eval falls when White errs, rises when Black does
        const loss = Math.max(-1000, Math.min(1000, (i % 2 === 0 ? 1 : -1) * (ev[i] - ev[i + 1])));
        m.checked++;
        if (loss <= margin) m.good++;
      }
    }
  }
  facedMemo[color] = { sig, map };
  return map;
}
function findGaps(color = S.color) {
  const R = rep(color), games = oppSeen(color), gaps = [], only = gapOnly();
  walk(color);
  const faced = only === "all" ? null : oppFaced(color);
  const reached = key => !faced || !!myPosStats(key, color);
  const keepReply = (key, san) => {
    if (!faced) return true;
    const f = (faced[key] || {})[san];
    return !!f && (only === "faced" || f.good > 0);
  };
  const expect = (mine, peer) => {
    const b = blended(mine, peer);
    return b ? { score: b.score, basis: b.basis } : { score: 0.5, basis: "no data yet" };
  };
  const add = (g, reach, e) => {
    g.freq = reach;
    g.expected = e.score; g.basis = e.basis;
    g.impact = reach * (Math.max(0, 0.5 - e.score) + GAP_BONUS);
    gaps.push(g);
  };
  for (const [key, { path, fen, reach }] of Object.entries(indexTree(color))) {
    const n = R.pos[key], ex = cachedExplorer(fen);
    const peerHere = ex && ex.total ? posAverage(ex, color) : null;
    if (isMine(key, color)) {
      if ((!n || !n.m.length) && reached(key)) add({ id: "m|" + key, path, text: "Your move is missing", detail: path.length ? "after " + path.slice(-1)[0] : "first move" }, reach, expect(myPosStats(key, color), peerHere));
      continue;
    }
    const prepared = n ? n.m : [], cand = {};
    if (ex && ex.total) for (const m of ex.moves) if (m.n / ex.total >= 0.03) cand[m.san] = { f: m.n / ex.total, peer: scoreFor(m, color) };
    for (const [s, c] of Object.entries(games[key] || {})) (cand[s] = cand[s] || {}).g = c;
    for (const [s, v] of Object.entries(cand)) {
      if (prepared.includes(s) || !keepReply(key, s)) continue;
      const r = v.f != null ? reach * v.f : (v.g || 0) * 0.02;
      add({ id: "o|" + key + "|" + s, path, opp: s, text: `No answer to ${moveLabel(path, s)}`, f: v.f, g: v.g }, r, expect(myMoveStats(key, s, color), v.peer != null ? v.peer : null));
    }
    if (!prepared.length && !Object.keys(cand).length && reached(key))
      add({ id: "e|" + key, path, text: path.length ? "Line ends here" : "No opponent first moves yet", detail: path.length ? "add the replies you expect" : "start with 1.e4 and 1.d4" }, reach * 0.5, expect(myPosStats(key, color), peerHere));
  }
  return gaps;
}
const gapMode = () => (["impact", "freq"].includes(S.settings.gapRank) ? S.settings.gapRank : "depth");
/* "depth" (v0.9.24, the default): move by move. Every gap at move 2 that you'd meet in at least
   gapFloor() of games comes before any at move 3, and so on, biggest first within a move, so the
   tree grows evenly: all the common openings 2 moves deep, then 3, then 4. Rarer gaps follow,
   biggest first. */
const gapFloor = () => (S.settings.gapFloor != null ? S.settings.gapFloor : 2) / 100;
const gapMoveNo = g => Math.floor(g.path.length / 2) + 1; // the move where it's missing
function rankedGaps(color = S.color) {
  const k = gapMode(), list = findGaps(color);
  if (k !== "depth") return list.sort((a, b) => b[k] - a[k] || b.freq - a.freq);
  const fl = gapFloor(), big = g => g.freq >= fl;
  return list.sort((a, b) => big(b) - big(a) || (big(a) ? gapMoveNo(a) - gapMoveNo(b) : 0) || b.freq - a.freq);
}
// What the button says about a gap, in the current ranking mode
function gapLabel(g) {
  const where = g.opp ? moveLabel(g.path, g.opp) : (g.path.length ? `after ${g.path.slice(-1)[0]}` : "first move");
  const freq = g.f != null ? `${Math.round(g.f * 100)}% of games` : g.g ? `faced ${g.g}× in your games` : g.detail || "";
  const score = g.basis === "no data yet" ? "no results yet" : `you'd score about ${Math.round(g.expected * 100)}% (${g.basis})`;
  return { where, line: gapMode() === "impact" ? `${score}${freq ? " · " + freq : ""}` : gapMode() === "depth" ? `move ${gapMoveNo(g)}${freq ? " · " + freq : ""}` : freq };
}
let gapLast = null; // id of the gap the button last jumped to; the next tap goes to the one after
function nextGapTarget(list) {
  if (!list.length) return null;
  const i = gapLast ? list.findIndex(g => g.id === gapLast) : -1;
  return list[(i + 1) % list.length];
}
// The Gap › ranking choice (Settings > Building your tree)
function renderGaps() {
  document.querySelectorAll("[data-gapmode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.gapmode === gapMode())));
  document.querySelectorAll("[data-gaponly]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.gaponly === gapOnly())));
}
// Jump the board to a gap. For an unprepared reply, play it on the board so it's my move. It
// isn't saved until I answer it (commitBuildMove() saves the missing reply along with my move).
function jumpToGap(id, list = rankedGaps()) {
  const g = list.find(x => x.id === id);
  if (!g) return;
  gapLast = g.id;
  S.build[S.color] = g.opp ? g.path.concat(g.opp) : g.path.slice();
  renderBuild();
  window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("gapmode", d => { S.settings.gapRank = d.gapmode; gapLast = null; Store.save("settings"); renderGaps(); });
onClick("gaponly", d => { S.settings.gapOnly = d.gaponly; gapLast = null; Store.save("settings"); renderGaps(); });
