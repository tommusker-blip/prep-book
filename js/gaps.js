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
function findGaps(color = S.color) {
  const R = rep(color), games = oppSeen(color), gaps = [];
  walk(color);
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
      if (!n || !n.m.length) add({ id: "m|" + key, path, text: "Your move is missing", detail: path.length ? "after " + path.slice(-1)[0] : "first move" }, reach, expect(myPosStats(key, color), peerHere));
      continue;
    }
    const prepared = n ? n.m : [], cand = {};
    if (ex && ex.total) for (const m of ex.moves) if (m.n / ex.total >= 0.03) cand[m.san] = { f: m.n / ex.total, peer: scoreFor(m, color) };
    for (const [s, c] of Object.entries(games[key] || {})) (cand[s] = cand[s] || {}).g = c;
    for (const [s, v] of Object.entries(cand)) {
      if (prepared.includes(s)) continue;
      const r = v.f != null ? reach * v.f : (v.g || 0) * 0.02;
      add({ id: "o|" + key + "|" + s, path, opp: s, text: `No answer to ${moveLabel(path, s)}`, f: v.f, g: v.g }, r, expect(myMoveStats(key, s, color), v.peer != null ? v.peer : null));
    }
    if (!prepared.length && !Object.keys(cand).length)
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
