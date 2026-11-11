"use strict";
/* ---------- Build: one row per candidate move (NOTES items 1, 5 and 8) ----------
   Each candidate move at the Build position gets one row with three sources side by side:
     engine (Stockfish, eval after the move, ✓ within the "good move" margin)
     peers  (Lichess at my rating bands: how often it's played, and my colour's score after it)
     you    (my own games: how often I've had it, and my score)
   Tapping the row expands it: full W/D/L for peers and for me, the blended expected score and
   its basis, the likely replies and Stockfish's best reply. Tapping the move plays it.
   Every part fills in by itself as engine and Lichess results arrive (job queue, G3). */

/* ----- thresholds: Settings > Advanced ----- */
const advDefaults = () => ({ good: 50, mistake: 150, clock: 30, k: 10, unplayable: 150 });
const adv = () => ({ ...advDefaults(), ...S.settings.adv });

/* ----- the sample-size rule (NOTES, general principles) -----
   With few games of my own, my result is blended with the peer score, moving towards mine as
   games add up: (n × mine + k × peers) / (n + k), with k from Settings > Advanced (default 10,
   so 10 games of mine count as much as the peer data). */
function blended(mine, peerScore) {
  const my = wdlScore(mine), n = mine ? mine.n : 0, k = adv().k;
  if (my == null && peerScore == null) return null;
  if (my == null) return { score: peerScore, basis: "peer data", n: 0 };
  if (peerScore == null) return { score: my, basis: `your ${n} game${n === 1 ? "" : "s"}`, n };
  return { score: (n * my + k * peerScore) / (n + k), basis: `your ${n} game${n === 1 ? "" : "s"} + peer data`, n };
}
const pctOf = x => Math.round(x * 100) + "%";
const nOf = n => (n || 0).toLocaleString("en-GB");
// Lichess counts (white/draws/black) as W/D/L from my side
const peerWdl = (m, color = S.color) => ({ w: color === "white" ? m.w : m.b, d: m.d, l: color === "white" ? m.b : m.w, n: m.n != null ? m.n : m.total });
function wdlLine(o) { const t = o.w + o.d + o.l; return t ? `W ${pct(o.w, t)}% · D ${pct(o.d, t)}% · L ${pct(o.l, t)}% (n = ${nOf(t)})` : "no games"; }
// A results bar; the numbers show on hover (PC) or tap (Android) through data-tip (item 1)
function barFor(o, who) {
  const t = o ? o.w + o.d + o.l : 0;
  if (!t) return `<span class="wdl empty"></span>`;
  return `<span class="wdl" data-tip="${esc(who + ": " + wdlLine(o))}" tabindex="0"><i class="w" style="width:${pct(o.w, t)}%"></i><i class="d" style="width:${pct(o.d, t)}%"></i><i class="l" style="width:${pct(o.l, t)}%"></i></span>`;
}

// An ⓘ button whose explanation shows on hover (PC) or tap (Android), so explanations don't
// take up room on screen all the time
const info = (text, label = "More about this") => `<span class="info" role="button" tabindex="0" aria-label="${esc(label)}" data-tip="${esc(text)}">i</span>`;

/* ----- tips: hover on PC, tap on Android (no browser title tooltips) ----- */
const Tip = {
  el: null, target: null,
  show(target) {
    if (!this.el) { this.el = document.createElement("div"); this.el.id = "tip"; this.el.setAttribute("role", "tooltip"); document.body.append(this.el); }
    this.target = target;
    this.el.textContent = target.dataset.tip;
    this.el.hidden = false;
    const r = target.getBoundingClientRect(), w = this.el.offsetWidth, h = this.el.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const y = r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8;
    this.el.style.left = x + "px"; this.el.style.top = y + "px";
  },
  hide() { if (this.el) this.el.hidden = true; this.target = null; },
  init() {
    document.addEventListener("pointerover", e => { const t = e.target.closest("[data-tip]"); if (t && e.pointerType === "mouse") this.show(t); });
    document.addEventListener("pointerout", e => { const t = e.target.closest("[data-tip]"); if (t && e.pointerType === "mouse" && !t.contains(e.relatedTarget)) this.hide(); });
    document.addEventListener("click", e => {
      const t = e.target.closest("[data-tip]");
      if (t && !t.closest("button")) { if (this.target === t) this.hide(); else this.show(t); e.stopPropagation(); return; }
      this.hide();
    }, true);
    document.addEventListener("focusin", e => { const t = e.target.closest && e.target.closest("[data-tip]"); if (t) this.show(t); });
    document.addEventListener("focusout", () => this.hide());
    window.addEventListener("scroll", () => this.hide(), { passive: true });
  },
};

/* ----- engine evals for the rows (through the job queue) -----
   Every row gets depth 14 straight away, with the follow-ups (the ⚔ tag: MultiPV and the Lichess
   replies after each move). v0.9.27: there used to be a quick depth-10 pass and a "Deeper
   analysis" button; the quick pass wasn't useful. Cached depth-10 results show while 14 runs. */
const QUICK_DEPTH = 10, DEEP_DEPTH = 14;
const rowDepth = () => DEEP_DEPTH;
const evalAt = (fen, depth = QUICK_DEPTH) => { const e = EVALC[K(fen)]; return e && e.d >= depth ? e : null; };
// My-side eval after a move, and how much the mover gave up against their best move
function engineFor(fen, key, san) {
  const before = evalAt(fen), after = fenAfter(fen, [san]), ea = after && evalAt(after);
  if (!ea) return null;
  const meMoving = isMine(key, S.color);
  const mine = meMoving ? -ea.cp : ea.cp;              // ea.cp is from the side to move after it
  const loss = before ? Math.max(0, before.cp + ea.cp) : null; // mover's best minus what they got
  const white = after.split(" ")[1] === "w" ? ea.cp : -ea.cp;     // from White's side: + good for White
  return { mine, white, loss, mate: ea.mate != null, best: ea.best, after };
}
let rowsTimer = null;
function rowsChanged(key) { // refresh the rows once a burst of results has arrived, if still here
  clearTimeout(rowsTimer);
  rowsTimer = setTimeout(() => refreshBuild(key), 150);
}
function queueRowEvals(fen, key, sans) {
  if (Engine.failed) return;
  const depth = rowDepth(key), opts = { prio: PRIO.now, stale: notHere(key) };
  const fens = [fen, ...sans.map(s => fenAfter(fen, [s])).filter(Boolean)].filter(f => !evalAt(f, depth));
  for (const f of fens) Engine.analyse(f, depth, opts).then(() => rowsChanged(key), () => {});
}
// Is anything for the rows still on its way at this depth?
function rowsPending(fen, key, list) {
  const depth = rowDepth(key);
  if (Engine.failed) return false;
  if ([fen, ...list.map(c => fenAfter(fen, [c.san]))].some(f => f && !evalAt(f, depth))) return true;
  if (!isMine(key, S.color)) return false;
  return list.slice(0, FOLLOW_MAX).some(c => { const p1 = fenAfter(fen, [c.san]), m = p1 && MPV[K(p1)]; return p1 && !(m && m.d >= MPV_DEPTH && m.n >= MPV_N); });
}

/* ----- follow-ups for each of my candidate moves (NOTES item 7) -----
   After my candidate move, how many of the opponent's replies keep them within the "good move"
   margin of their best (Stockfish MultiPV), and how often players at my level actually find one
   of those (Lichess). One or two good replies that peers often miss make a practical weapon. */
const MPV_DEPTH = 12, MPV_N = 5, FOLLOW_MAX = 6;
function followups(fen, san) {
  const p1 = fenAfter(fen, [san]);
  if (!p1) return null;
  const mpv = MPV[K(p1)], exA = cachedExplorer(p1), out = { p1, exA };
  if (mpv && mpv.d >= MPV_DEPTH && mpv.lines.length) {
    const best = mpv.lines[0].cp;
    out.good = mpv.lines.filter(l => best - l.cp <= adv().good).map(l => uciToSan(p1, l.uci));
    out.count = out.good.length;
    out.label = out.count <= 1 ? "Only move" : out.count === 2 ? "Narrow" : out.count < MPV_N ? "Several" : "Many";
    // only with enough peer data: 50+ games, and the listed replies covering at least half of them
    const listed = exA && exA.total ? exA.moves.reduce((a, m) => a + m.n, 0) : 0;
    if (exA && exA.total >= 50 && listed / exA.total >= 0.5) { out.found = exA.moves.filter(m => out.good.includes(m.san)).reduce((a, m) => a + m.n, 0); out.find = out.found / exA.total; }
  }
  return out;
}
// Ask for the MultiPV and Lichess replies for my top candidates, one at a time, most played first
function queueFollowups(fen, key, list) {
  if (!isMine(key, S.color)) return;
  const opts = { prio: PRIO.now, stale: notHere(key) };
  for (const c of list.slice(0, FOLLOW_MAX)) {
    const p1 = fenAfter(fen, [c.san]);
    if (!p1) continue;
    const m = MPV[K(p1)];
    if (!Engine.failed && !(m && m.d >= MPV_DEPTH && m.n >= MPV_N)) Engine.multi(p1, MPV_DEPTH, MPV_N, opts).then(() => rowsChanged(key), () => {});
    if (S.token && !explorerBlocked && !cachedExplorer(p1)) explorer(p1, opts).then(d => { if (d) rowsChanged(key); });
  }
}
// A practical weapon: sound for me, one or two good replies, and peers find them half the time or less
const isWeapon = (fu, e) => fu && fu.count != null && fu.count <= 2 && fu.find != null && fu.find <= 0.5 && e && e.loss != null && e.loss <= adv().good;

/* ----- which moves get a row ----- */
// My repertoire moves, the moves peers play (top 6, or 3%+), moves from my own games, and the
// engine's choice; at most 10, most played first.
function candidates(fen, key, n) {
  const ex = cachedExplorer(fen), prep = n ? n.m : [], mineMv = myStats(S.color).mv[key] || {};
  const peer = new Map(ex ? ex.moves.map(m => [m.san, m]) : []);
  const set = new Set(prep);
  if (ex && ex.total) ex.moves.slice().sort((a, b) => b.n - a.n).forEach((m, i) => { if (i < 6 || m.n / ex.total >= 0.03) set.add(m.san); });
  const exM = mastersOn() ? cachedExplorer(fen, "masters") : null; // masters' main moves too (v0.9.20)
  if (exM && exM.total) exM.moves.forEach(m => { if (m.n / exM.total >= 0.05) set.add(m.san); });
  Object.keys(mineMv).forEach(s => set.add(s));
  const pe = evalAt(fen), bestSan = pe && pe.best ? uciToSan(fen, pe.best) : "";
  if (bestSan) set.add(bestSan);
  const freq = s => (peer.get(s) ? peer.get(s).n : 0);
  return [...set].sort((a, b) => (prep.includes(b) - prep.includes(a)) || freq(b) - freq(a) || ((mineMv[b] || {}).n || 0) - ((mineMv[a] || {}).n || 0)).slice(0, 10)
    .map(san => ({ san, prep: prep.includes(san), peer: peer.get(san) || null, mast: exM ? exM.moves.find(m => m.san === san) || null : null, mine: mineMv[san] || null, engineBest: san === bestSan }));
}

/* ----- the rows ----- */
const candOpen = new Set(); // "key|san" of expanded rows
// Eval cell: the eval after the move from White's side (+ good for White, − for Black, whoever
// I play), coloured by how the move compares with the best move here: strong (within the good
// margin), playable (up to a mistake) or weak. The only mark is "g" for a gambit shown although
// the engine rates it weak.
function strengthOf(e) {
  if (!e || e.loss == null) return { k: "", t: "" };
  if (e.loss <= adv().good) return { k: "s-good", t: "strong" };
  if (e.loss <= adv().mistake) return { k: "s-ok", t: "playable" };
  return { k: "s-weak", t: "weak" };
}
const evalText = e => (e.mate ? (e.white > 0 ? "+M" : "−M") : pawns(e.white));
function engineCell(e) {
  if (!e) return Engine.failed ? "–" : `<span class="muted">…</span>`;
  const s = strengthOf(e);
  return `<span class="ev ${s.k}" aria-label="${evalText(e)}${s.t ? ", " + s.t : ""}">${evalText(e)}</span>`;
}
function candRow(fen, key, c, ex, path) {
  const myTurn = isMine(key, S.color), e = engineFor(fen, key, c.san);
  const peerScore = c.peer ? scoreFor(c.peer, S.color) : null, f = c.peer && ex && ex.total ? c.peer.n / ex.total : null;
  const b = blended(c.mine, peerScore), open = candOpen.has(key + "|" + c.san);
  // Where the sources disagree (item 8)
  let flag = "", flagText = "";
  const avg = ex && ex.total ? posAverage(ex, S.color) : null;
  if (myTurn && e && e.loss != null && e.loss <= adv().good && c.mine && c.mine.n >= 3 && wdlScore(c.mine) < 0.4) { flag = "warn"; flagText = "The engine likes it, but you score badly with it"; }
  else if (myTurn && e && e.loss != null && e.loss >= adv().mistake / 2 && peerScore != null && avg != null && peerScore - avg >= 0.05) { flag = "gem"; flagText = "The engine dislikes it, but it scores well at your level"; }
  else if (!myTurn && c.mine && c.mine.n >= 3 && wdlScore(c.mine) < 0.4) { flag = "warn"; flagText = "You score badly against this reply"; }
  // Item 7: how many good replies, and how often peers find one
  const fu = myTurn ? followups(fen, c.san) : null, weapon = isWeapon(fu, e);
  if (weapon && !flag) { flag = "gem"; flagText = `A practical weapon: only ${fu.good.join(" or ")} keep${fu.count === 1 ? "s" : ""} your opponent level, and players at your level find ${fu.count === 1 ? "it" : "one"} ${pctOf(fu.find)} of the time`; }
  /* v0.9.11: the whole row shows its state (blue: in my repertoire or prepared; orange: a gap;
     dashed blue: not linked here but it transposes into a position I've prepared), the move
     carries a chess mark (moveMark()), and the Tags column has symbols (rowTags()). */
  const after = fenAfter(fen, [c.san]), trans = !c.prep && !!after && !!walk(S.color).nodes[K(after)];
  const state = c.prep ? "prep" : trans ? "trans" : !myTurn ? "gapmv" : "";
  const stateText = c.prep ? (myTurn ? "in your repertoire" : "prepared") : trans ? "transposes into your prep" : !myTurn ? "not prepared (a gap)" : "";
  const gambit = isGambit(fen, c.san), peerGem = myTurn && c.peer && ex && ex.total ? judgeMove(c.peer, ex, S.color, (n => (n ? n.m : []))(rep(S.color).pos[key])) : null;
  const tags = rowTags({ weapon, fu, gem: flag === "gem" && !weapon ? flagText : peerGem ? (peerGem === "gem" ? "A hidden gem: rarely played at your level, but it scores well" : "Scores better at your level than your move here") : "", gambit, trans, warn: flag === "warn" ? flagText : "" });
  const mark = moveMark(e, gambit || !!peerGem || flag === "gem");
  const head = `<div class="crow c${3 + 2 * statCols().length}">
      ${namedLine(fen, c.san, path)}
      <span class="ctags">${tags.html || (myTurn && !Engine.failed && c.rank < FOLLOW_MAX && !(fu && fu.label) ? `<span class="muted">…</span>` : "")}</span>
      <span class="cmove"><button type="button" class="chip" data-go="${esc(c.san)}" aria-label="${esc(c.san)}${mark.t ? ", " + mark.t : ""}${stateText ? ", " + stateText : ""}">${esc(c.san)}<span class="mark ${mark.k}">${mark.s}</span></button></span>
      <span class="ceng">${engineCell(e)}</span>
      ${statCells(fen, key, c, ex, f, peerScore)}
    </div>`;
  let detail = "";
  if (open) {
    const after = fenAfter(fen, [c.san]), exA = after && cachedExplorer(after);
    if (after && !exA && S.token && !explorerBlocked) explorer(after, { prio: PRIO.now, stale: notHere(key) }).then(d => { if (d) rowsChanged(key); });
    const replies = exA && exA.total ? exA.moves.slice().sort((a, x) => x.n - a.n).slice(0, 2).map(m => `${esc(m.san)} (${pctOf(m.n / exA.total)}, you score ${pctOf(scoreFor(m, S.color))})`).join(", ") : "";
    const bestReply = e && e.best ? uciToSan(e.after, e.best) : "";
    // Every number from the row in full, in case a narrow screen cuts a column short
    const st = strengthOf(e);
    const full = [
      `<b>${esc(moveLabel(path, c.san))}</b>`,
      e ? `eval ${evalText(e)} from White's side${st.t ? ` (${st.t}${e.loss > 0 ? `, ${(e.loss / 100).toFixed(1)} below the best` : ", the best"})` : ""}` : "eval not ready",
      f != null ? `played in ${pctOf(f)} of ${nOf(ex.total)} peer games` : "no peer games",
      peerScore != null ? `your colour scores ${pctOf(peerScore)} after it` : "",
      c.mine ? `you: ${c.mine.n} game${c.mine.n === 1 ? "" : "s"}, ${pctOf(wdlScore(c.mine))}` : "not in your games",
      fu && fu.label ? `${fu.count} good repl${fu.count === 1 ? "y" : "ies"} for your opponent` : "",
    ].filter(Boolean).join(" · ");
    detail = `<div class="cdetail">
      <p class="help cfull">${full}</p>
      ${tags.words.length ? tags.words.map(w => `<p class="flagtext">${w}</p>`).join("") : ""}
      <div class="cbars"><span class="lbl">Peers</span>${c.peer ? barFor(peerWdl(c.peer), "Peers at your level") + `<span class="help">${wdlLine(peerWdl(c.peer))}</span>` : `<span class="help">No peer games with this move</span>`}</div>
      ${mastersOn() ? `<div class="cbars"><span class="lbl">Masters</span>${c.mast ? barFor(peerWdl(c.mast), "Masters") + `<span class="help">${wdlLine(peerWdl(c.mast))}</span>` : `<span class="help">${cachedExplorer(fen, "masters") ? "No master games with this move" : "Loading master games…"}</span>`}</div>` : ""}
      <div class="cbars"><span class="lbl">You</span>${c.mine ? barFor(c.mine, "Your games") + `<span class="help">${wdlLine(c.mine)}</span>` : `<span class="help">Not in your games</span>`}</div>
      ${b ? `<p class="help">Expected score for you: <b>${pctOf(b.score)}</b> (${esc(b.basis)})</p>` : ""}
      <p class="help">${replies ? `Usually ${replies}` : S.token ? (exA ? (exA.total ? "No common replies at your level" : "Peers rarely reach this position") : "Loading likely replies…") : "Add a Lichess token for likely replies"}${bestReply ? ` · Stockfish's best reply: ${esc(bestReply)}` : ""}</p>
      ${myTurn ? fitLine(fen, c, path) : ""}
      ${fu && fu.good ? `<p class="help">Good replies for your opponent (within ${(adv().good / 100).toFixed(1)} of their best): <b>${fu.good.map(esc).join(", ")}</b> (${fu.label.toLowerCase()})${fu.find != null ? ` · players at your level find one ${pctOf(fu.find)} of the time (n = ${nOf(fu.exA.total)})` : ""}</p>` : ""}
    </div>`;
  }
  return `<div class="cand${open ? " open" : ""}${state ? " " + state : ""}" data-cand="${esc(c.san)}" role="button" tabindex="0" aria-expanded="${open}">${head}${detail}</div>`;
}
// The summary line for the position (item 5): my result here against the peers', and the engine
function positionSummary(fen, key, ex) {
  const me = myPosStats(key), peer = ex && ex.total ? posAverage(ex, S.color) : null, pe = evalAt(fen);
  // One short line: "You 33% (3) · peers 53% · engine +0.4, best Nf3 · below par"; detail in the ⓘ
  const parts = [], tip = [];
  if (me && me.n) {
    parts.push(`You <b>${pctOf(wdlScore(me))}</b> (${me.n})`);
    tip.push(`You score ${pctOf(wdlScore(me))} from here in ${me.n} game${me.n === 1 ? "" : "s"}: ${wdlLine(me)}.`);
  }
  if (peer != null) { parts.push(`peers ${pctOf(peer)}`); tip.push(`Peers at your rating score ${pctOf(peer)} from your side (${nOf(ex.total)} games).`); }
  if (pe) { const white = fen.split(" ")[1] === "w" ? pe.cp : -pe.cp; parts.push(`eval ${pawns(white)}${pe.best ? `, best ${esc(uciToSan(fen, pe.best))}` : ""}`); } // + good for White
  if (me && me.n >= 3 && peer != null) {
    const b = blended(me, peer);
    if (b.score < peer - 0.05) { parts.push(`<span class="bad">below par</span>`); tip.push(`Below par: your expected score here (${pctOf(b.score)}, ${b.basis}) is more than 5 points under the peers'. Worth reviewing.`); }
    else if (b.score > peer + 0.05) parts.push(`<span class="ok">above par</span>`);
  }
  return parts.length ? `<p class="possum">${parts.join(" · ")}${tip.length ? " " + info(tip.join(" "), "About this position") : ""}</p>` : "";
}
/* ----- weak moves are hidden on my turn (v0.9.1, v0.9.12) -----
   On my turn a move isn't shown when it's more than the mistake margin worse than the best
   (dubious or bad), or leaves me worse than adv().unplayable. Kept anyway: my repertoire moves,
   gambits (the position after it has "Gambit" in its opening name) and hidden gems (they score
   well at my level): those are the "interesting" !? moves. Opponent moves always show. */
const showWeak = new Set(); // positions where I asked to see the hidden moves
function isGambit(fen, san) {
  const after = fenAfter(fen, [san]), o = after && typeof OPENINGS !== "undefined" && OPENINGS[K(after)];
  return !!(o && /gambit/i.test(o[1]));
}
function unplayable(fen, key, c, ex = cachedExplorer(fen)) {
  if (c.prep) return false;
  const e = engineFor(fen, key, c.san), a = adv();
  if (!e || e.loss == null) return false;
  const weak = e.loss > a.mistake || (e.mine < -a.unplayable && e.loss > a.good);
  if (!weak || isGambit(fen, c.san)) return false;
  const n = rep(S.color).pos[key];
  return !(c.peer && ex && ex.total && judgeMove(c.peer, ex, S.color, n ? n.m : []));
}
function candRows(fen, key, n, path) {
  const ex = cachedExplorer(fen), all = candidates(fen, key, n);
  queueRowEvals(fen, key, all.map(c => c.san));
  all.forEach((c, i) => (c.rank = i));
  queueFollowups(fen, key, all);
  if (!all.length) return positionSummary(fen, key, ex) + `<p class="help">${S.token ? "Loading what players at your level play here…" : "Play a move on the board, or add a Lichess token in Settings to see what players at your level play."}</p>`;
  const myTurn = isMine(key, S.color);
  const weak = myTurn ? all.filter(c => unplayable(fen, key, c, ex)) : [], showing = showWeak.has(key);
  const list = showing ? all : all.filter(c => !weak.includes(c));
  // Best to worst by the engine: the loss against the best move here, for whoever is moving.
  // Moves without an eval yet go last, in the order above (prepared, then most played).
  const lossOf = c => { const e = engineFor(fen, key, c.san); return e && e.loss != null ? e.loss : null; };
  list.sort((a, b) => { const x = lossOf(a), y = lossOf(b); if (x == null || y == null) return (x == null) - (y == null) || a.rank - b.rank; return x - y || a.rank - b.rank; });
  const weakRow = weak.length ? `<p class="help weakrow">${showing ? `Showing ${weak.length} weak move${weak.length === 1 ? "" : "s"}` : `${weak.length} weak move${weak.length === 1 ? "" : "s"} hidden (${weak.map(c => esc(c.san)).join(", ")}): over ${(adv().mistake / 100).toFixed(1)} worse than the best, or leaving you below −${(adv().unplayable / 100).toFixed(1)}`} <button type="button" class="btn ghost quick" data-showweak>${showing ? "Hide them" : "Show"}</button></p>` : "";
  return positionSummary(fen, key, ex) + `<div class="cands">
      ${statsHead()}
      ${list.map(c => candRow(fen, key, c, ex, path)).join("")}
    </div>${weakRow}${deepRow(fen, key, all, myTurn)}${rowsLegend(myTurn, ex)}`;
}
// Under the rows: progress while the engine and the follow-ups run
function deepRow(fen, key, list, myTurn) {
  if (Engine.failed) return "";
  return rowsPending(fen, key, list) ? `<p class="help deeprow" aria-live="polite">Analysing (depth ${DEEP_DEPTH})…</p>` : "";
}
/* ----- "Fits your prep" for a candidate of mine (v0.9.7) -----
   The synergy score from ideas.js (memorability()): the chance of transposing into my lines
   after the likely replies (Lichess, the top 8), or how alike the setup is to my other lines.
   Shown in the expanded row once the replies after the move are loaded. */
function fitFor(fen, c, path) {
  const p1 = fenAfter(fen, [c.san]), exA = p1 && cachedExplorer(p1);
  if (!exA || !exA.total) return null;
  const replies = exA.moves.slice().sort((a, b) => b.n - a.n).slice(0, 8).map(m => ({ p2: fenAfter(p1, [m.san]), f: m.n / exA.total })).filter(r => r.p2);
  return memorability({ san: c.san, p1, replies, cover: replies.reduce((s, r) => s + r.f, 0) }, path, S.color);
}
function fitLine(fen, c, path) {
  const m = fitFor(fen, c, path);
  if (!m) return "";
  const why = [m.transP >= 0.05 ? `transposes into your lines after ${pctOf(m.transP)} of replies` : "", m.setup >= 0.3 && m.like ? `same setup as your ${esc(numbered(0, m.like))} (${pctOf(m.setup)} alike)` : ""].filter(Boolean).join("; ");
  return `<p class="help">Fits your prep: <b>${pctOf(m.score)}</b>${why ? ` (${why})` : " (a new kind of position for you)"}</p>`;
}
/* ----- named lines (v0.9.8) -----
   A row whose move reaches a named position (OPENINGS, or the curated BOOK) gets the name on a
   line of its own above the move, in the accent colour. Where it continues the opening on the board, only the
   new part is shown ("Najdorf Variation" under the Sicilian). */
const namedCache = new Map();
let namedHere = { ps: null, name: "" };
function namedAfter(fen, san) {
  const k = fen + "|" + san;
  if (namedCache.has(k)) return namedCache.get(k);
  const after = fenAfter(fen, [san]), b = after ? bookName(K(after)) : null;
  if (namedCache.size > 3000) namedCache.clear();
  namedCache.set(k, b);
  return b;
}
function namedLine(fen, san, path) {
  const b = namedAfter(fen, san);
  if (!b) return "";
  const ps = (path || []).join(" ");
  if (namedHere.ps !== ps) namedHere = { ps, name: ((ps ? openingFor(path) : null) || {}).name || "" };
  const cur = namedHere.name;
  let name = b.name;
  if (cur && name === cur) return ""; // same name as the position on the board: nothing new
  const fam = cur.split(":")[0].trim(); // the same family as the opening on the board: just the new part
  if (fam && name.startsWith(fam + ": ")) name = name.slice(fam.length + 2);
  return `<span class="cname"><span class="eco">${esc(b.eco)}</span> ${esc(name)}</span>`;
}
// The moves I usually play in a position, from my games: at least 2 games and 15% of them, top 3
function gameMovesHere(key, color = S.color) {
  const mv = myStats(color).mv[key];
  if (!mv) return [];
  const list = Object.entries(mv).map(([san, s]) => ({ san, n: s.n })), total = list.reduce((s, x) => s + x.n, 0);
  return list.filter(x => x.n >= 2 && x.n / total >= 0.15).sort((a, b) => b.n - a.n).slice(0, 3).map(x => ({ ...x, f: x.n / total }));
}
/* ----- marks and tags (v0.9.11) -----
   One mark only (v0.9.12): !? on a move the engine likes less (over half the mistake margin
   worse than the best) that is a gambit or scores well at my level. Dubious and bad moves are
   hidden on my turn instead (unplayable()). */
function moveMark(e, interesting) {
  if (!e || e.loss == null || !interesting || e.loss <= adv().mistake / 2) return { s: "", k: "", t: "" };
  return { s: "!?", k: "m-int", t: "interesting: the engine likes it less, but it's a gambit or it scores well" };
}
// The Tags column: ⚔ practical weapon, 💎 hidden gem / scores well, 🃏 gambit, ⇄ transposes
// into my prep, ⚠ the sources disagree against me. At most two symbols in the row; all of them,
// in words, in the expanded row.
const TAGS = {
  weapon: { s: "⚔", t: "Practical weapon" }, gem: { s: "💎", t: "Hidden gem" }, gambit: { s: "🃏", t: "Gambit" },
  trans: { s: "⇄", t: "Transposes into your prep" }, warn: { s: "⚠", t: "Watch out" },
};
function rowTags(o) {
  const list = [];
  if (o.weapon) list.push(["weapon", `⚔ A practical weapon: only ${o.fu.good.map(esc).join(" or ")} keep${o.fu.count === 1 ? "s" : ""} your opponent level, and players at your level find ${o.fu.count === 1 ? "it" : "one"} ${pctOf(o.fu.find)} of the time.`]);
  if (o.gem) list.push(["gem", `💎 ${esc(o.gem)}.`]);
  if (o.warn) list.push(["warn", `⚠ ${esc(o.warn)}.`]);
  if (o.trans) list.push(["trans", "⇄ Leads into a position you've already prepared, by another move order."]);
  if (o.gambit) list.push(["gambit", "🃏 A gambit: material for time or attack."]);
  const shown = list.slice(0, 2);
  return {
    html: shown.map(([k]) => `<span class="tag t-${k}" aria-label="${TAGS[k].t}">${TAGS[k].s}</span>`).join("") + (list.length > 2 ? `<span class="tag more" aria-label="more tags">+</span>` : ""),
    words: list.map(x => x[1]),
  };
}
// The key under the rows: open by default, and remembered when closed
function rowsLegend(myTurn, ex) {
  const a = adv(), p = x => (x / 100).toFixed(1);
  const open = lsGet("pb_legend", "open") === "open";
  return `<details class="rkey"${open ? " open" : ""} data-rkey><summary>Key</summary>
    <div class="rkeygrid">
      <p class="rk-h">Rows</p>
      <p><span class="ksw ksw-prep"></span>${myTurn ? "In your repertoire" : "A reply you've prepared"}</p>
      ${myTurn ? "" : `<p><span class="ksw ksw-gap"></span>A gap: a reply you haven't prepared</p>`}
      <p><span class="ksw ksw-trans"></span>Transposes into a position you've prepared</p>
      <p class="rk-h">Mark</p>
      <p><b class="mark m-int">!?</b> interesting: the engine likes it less, but it's a gambit or it scores well at your level${myTurn ? ". Weaker moves of yours are hidden (Show brings them back)" : ""}</p>
      <p class="rk-h">Tags</p>
      ${myTurn ? `<p><span class="tag">💎</span> hidden gem: rarely played, or the engine likes it less, but it scores well at your level</p>
      <p><span class="tag">⚔</span> practical weapon: your opponent has only 1 or 2 good replies and often misses them</p>` : ""}
      <p><span class="tag">🃏</span> gambit <span class="tag">⇄</span> transposes into your prep <span class="tag">⚠</span> you score badly here although the engine is happy</p>
      <p class="rk-h">Columns</p>
      <p><b>Eval</b> + good for White, − good for Black (depth ${DEEP_DEPTH}), coloured <span class="ev s-good">strong</span> <span class="ev s-ok">playable</span> <span class="ev s-weak">weak</span></p>
      <p><b>Played %</b> how often it's chosen here, with a bar · <b>Score %</b> how your colour scores after it (win 1, draw ½). Each for <b>Peers</b> (players at your level on Lichess${ex ? `: ${srcLine(ex)}` : ""})${mastersOn() ? `, <b>Masters</b> in grey (the Lichess masters database; switch off in Settings)` : ""} and <b>You</b> (your games). Faint figures rest on few games; tap the row for the counts.</p>
      <p>Names in blue: the move reaches a named opening line. Tap a row for everything in full.</p>
      <p class="rk-h">Arrows on the board</p>
      <p><span class="ksw ksw-a-good"></span>yours <span class="ksw ksw-a-gap"></span>a gap <span class="ksw ksw-gem"></span>gem or better-scoring <span class="ksw ksw-other"></span>other common moves${myTurn ? ` <span class="ksw ksw-games"></span>what you play in your games` : ""}</p>
    </div></details>`;
}
/* ----- the numbers: Played and Score for peers, masters and me (v0.9.24) -----
   Two groups of columns under a two-level header (Played % | Score %, each Peers, Masters, You),
   plain numbers in one weight; the labels are only in the header. Played has a thin bar. A figure
   from a small sample (peers or masters under 20 games, me under 3) is greyed. With masters off
   (Settings > Building your tree) the masters columns go. Masters data is fetched with the peer
   data in renderBuild(). */
const mastersOn = () => S.settings.mastersRows !== false;
const statCols = () => (mastersOn() ? ["p", "m", "y"] : ["p", "y"]);
const STAT_NAMES = { p: ["Peers", "Peer"], m: ["Masters", "Mstr"], y: ["You", "You"] };
function statsHead() {
  const cols = statCols(), n = cols.length;
  const sub = cols.map((k, i) => `<span class="hsub g-${k}${i ? "" : " g0"}"><span class="lg">${STAT_NAMES[k][0]}</span><span class="sm">${STAT_NAMES[k][1]}</span></span>`).join("");
  return `<div class="crow chead c${3 + 2 * n}"><span class="htop" aria-label="Tags"></span><span class="htop">Move</span><span class="htop">Eval</span><span class="hgrp g0" style="grid-column:span ${n}">Played %</span><span class="hgrp g0" style="grid-column:span ${n}">Score %</span>
    ${sub}${sub}</div>`;
}
// One figure: v 0..1 or null. o: {k, first, bar, thin, n, loading}
function statCell(v, label, o) {
  const cls = `cst g-${o.k}${o.first ? " g0" : ""}`;
  if (o.loading) return `<span class="${cls} muted" aria-label="${label}: loading">…</span>`;
  if (v == null) return `<span class="${cls} muted" aria-label="${label}: none">–</span>`;
  const pc = Math.round(v * 100);
  return `<span class="${cls}${o.thin ? " thin" : ""}" aria-label="${label}: ${pc}%${o.n != null ? ` (${nOf(o.n)} game${o.n === 1 ? "" : "s"})` : ""}">${o.bar ? `<i style="width:${Math.max(3, pc)}%"></i>` : ""}<b>${pc}</b></span>`;
}
function statCells(fen, key, c, ex, f, peerScore) {
  const exM = mastersOn() ? cachedExplorer(fen, "masters") : null, me = c.mine ? myPosStats(key) : null;
  const small = { p: !!c.peer && c.peer.n < 20, m: !!c.mast && c.mast.n < 20, y: !!c.mine && c.mine.n < 3 };
  const val = { f: {
    p: f, m: exM && exM.total && c.mast ? c.mast.n / exM.total : null, y: c.mine && me && me.n ? c.mine.n / me.n : null,
  }, s: {
    p: peerScore, m: c.mast ? scoreFor(c.mast, S.color) : null, y: c.mine ? wdlScore(c.mine) : null,
  } };
  const names = { f: { p: "peers play it", m: "masters play it", y: "you play it" }, s: { p: "peers' score", m: "masters' score", y: "your score" } };
  const n = { p: c.peer && c.peer.n, m: c.mast && c.mast.n, y: c.mine && c.mine.n };
  const group = w => statCols().map((k, i) => statCell(val[w][k], names[w][k], { k, first: !i, bar: w === "f", thin: small[k], n: n[k], loading: k === "m" && !exM })).join("");
  return group("f") + group("s");
}
