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
const advDefaults = () => ({ good: 50, mistake: 150, clock: 30, k: 10 });
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

/* ----- engine evals for the rows (depth 14, through the job queue) ----- */
const ROW_DEPTH = 14;
const evalAt = fen => { const e = EVALC[K(fen)]; return e && e.d >= ROW_DEPTH ? e : null; };
// My-side eval after a move, and how much the mover gave up against their best move
function engineFor(fen, key, san) {
  const before = evalAt(fen), after = fenAfter(fen, [san]), ea = after && evalAt(after);
  if (!ea) return null;
  const meMoving = isMine(key, S.color);
  const mine = meMoving ? -ea.cp : ea.cp;              // ea.cp is from the side to move after it
  const loss = before ? Math.max(0, before.cp + ea.cp) : null; // mover's best minus what they got
  return { mine, loss, mate: ea.mate != null, best: ea.best, after };
}
let rowsTimer = null;
function rowsChanged(key) { // redraw once a burst of results has arrived, if still here
  clearTimeout(rowsTimer);
  rowsTimer = setTimeout(() => { if (!notHere(key)()) renderBuild(); }, 120);
}
function queueRowEvals(fen, key, sans) {
  if (Engine.failed) return;
  const opts = { prio: PRIO.now, stale: notHere(key) };
  const fens = [fen, ...sans.map(s => fenAfter(fen, [s])).filter(Boolean)].filter(f => !evalAt(f));
  for (const f of fens) Engine.analyse(f, ROW_DEPTH, opts).then(() => rowsChanged(key), () => {});
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
  Object.keys(mineMv).forEach(s => set.add(s));
  const pe = evalAt(fen), bestSan = pe && pe.best ? uciToSan(fen, pe.best) : "";
  if (bestSan) set.add(bestSan);
  const freq = s => (peer.get(s) ? peer.get(s).n : 0);
  return [...set].sort((a, b) => (prep.includes(b) - prep.includes(a)) || freq(b) - freq(a) || ((mineMv[b] || {}).n || 0) - ((mineMv[a] || {}).n || 0)).slice(0, 10)
    .map(san => ({ san, prep: prep.includes(san), peer: peer.get(san) || null, mine: mineMv[san] || null, engineBest: san === bestSan }));
}

/* ----- the rows ----- */
const candOpen = new Set(); // "key|san" of expanded rows
function engineCell(e, myTurn) {
  if (!e) return Engine.failed ? "–" : `<span class="muted">…</span>`;
  const v = e.mate ? (e.mine > 0 ? "mate" : "−mate") : pawns(e.mine);
  if (e.loss == null) return v;
  if (e.loss <= adv().good) return `${v} <span class="ok" aria-label="a good move">✓</span>`;
  // my move: show what it gives up; their move: a slip that helps me
  return myTurn ? `${v} <span class="bad">−${(e.loss / 100).toFixed(1)}</span>` : `${v} <span class="ok">?!</span>`;
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
  // One line per row: Prepared / Yours / Gap is the chip's colour, and on my turn the number of
  // good replies has its own narrow column (purple for a practical weapon)
  const state = c.prep ? "prep" : !myTurn ? "gapmv" : "";
  const stateText = c.prep ? (myTurn ? "in your repertoire" : "prepared") : !myTurn ? "not prepared (a gap)" : "";
  const rep = !myTurn ? "" : fu && fu.label
    ? `<span class="crep${weapon ? " weapon" : ""}" aria-label="${esc(fu.label)}: ${fu.count} good repl${fu.count === 1 ? "y" : "ies"}">${fu.count >= MPV_N ? MPV_N + "+" : fu.count}</span>`
    : `<span class="crep muted">${!Engine.failed && c.rank < FOLLOW_MAX ? "…" : "–"}</span>`;
  const head = `<div class="crow${myTurn ? " c5" : ""}">
      <span class="cmove"><button type="button" class="chip ${state}" data-go="${esc(c.san)}" aria-label="${esc(c.san)}${stateText ? ", " + stateText : ""}">${esc(c.san)}</button></span>
      <span class="ceng">${engineCell(e, myTurn)}</span>
      <span class="cpeer">${c.peer && f != null ? `${pctOf(f)} · ${pctOf(peerScore)}` : `<span class="muted">–</span>`}</span>
      <span class="cyou">${c.mine ? `${c.mine.n} · ${pctOf(wdlScore(c.mine))}` : `<span class="muted">–</span>`}</span>
      ${rep}
    </div>`;
  let detail = "";
  if (open) {
    const after = fenAfter(fen, [c.san]), exA = after && cachedExplorer(after);
    if (after && !exA && S.token && !explorerBlocked) explorer(after, { prio: PRIO.now, stale: notHere(key) }).then(d => { if (d) rowsChanged(key); });
    const replies = exA && exA.total ? exA.moves.slice().sort((a, x) => x.n - a.n).slice(0, 2).map(m => `${esc(m.san)} (${pctOf(m.n / exA.total)}, you score ${pctOf(scoreFor(m, S.color))})`).join(", ") : "";
    const bestReply = e && e.best ? uciToSan(e.after, e.best) : "";
    detail = `<div class="cdetail">
      ${flagText ? `<p class="flagtext">${esc(flagText)}</p>` : ""}
      <div class="cbars"><span class="lbl">Peers</span>${c.peer ? barFor(peerWdl(c.peer), "Peers at your level") + `<span class="help">${wdlLine(peerWdl(c.peer))}</span>` : `<span class="help">No peer games with this move</span>`}</div>
      <div class="cbars"><span class="lbl">You</span>${c.mine ? barFor(c.mine, "Your games") + `<span class="help">${wdlLine(c.mine)}</span>` : `<span class="help">Not in your games</span>`}</div>
      ${b ? `<p class="help">Expected score for you: <b>${pctOf(b.score)}</b> (${esc(b.basis)})</p>` : ""}
      <p class="help">${replies ? `Usually ${replies}` : S.token ? (exA ? (exA.total ? "No common replies at your level" : "Peers rarely reach this position") : "Loading likely replies…") : "Add a Lichess token for likely replies"}${bestReply ? ` · Stockfish's best reply: ${esc(bestReply)}` : ""}</p>
      ${fu && fu.good ? `<p class="help">Good replies for your opponent (within ${(adv().good / 100).toFixed(1)} of their best): <b>${fu.good.map(esc).join(", ")}</b> (${fu.label.toLowerCase()})${fu.find != null ? ` · players at your level find one ${pctOf(fu.find)} of the time (n = ${nOf(fu.exA.total)})` : ""}</p>` : ""}
    </div>`;
  }
  return `<div class="cand${open ? " open" : ""}${flag ? " " + flag : ""}" data-cand="${esc(c.san)}" role="button" tabindex="0" aria-expanded="${open}">${head}${detail}</div>`;
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
  if (pe) { const mine = sideOf(key) === myChar(S.color) ? pe.cp : -pe.cp; parts.push(`engine ${pawns(mine)}${pe.best ? `, best ${esc(uciToSan(fen, pe.best))}` : ""}`); }
  if (me && me.n >= 3 && peer != null) {
    const b = blended(me, peer);
    if (b.score < peer - 0.05) { parts.push(`<span class="bad">below par</span>`); tip.push(`Below par: your expected score here (${pctOf(b.score)}, ${b.basis}) is more than 5 points under the peers'. Worth reviewing.`); }
    else if (b.score > peer + 0.05) parts.push(`<span class="ok">above par</span>`);
  }
  return parts.length ? `<p class="possum">${parts.join(" · ")}${tip.length ? " " + info(tip.join(" "), "About this position") : ""}</p>` : "";
}
function candRows(fen, key, n, path) {
  const ex = cachedExplorer(fen), list = candidates(fen, key, n);
  queueRowEvals(fen, key, list.map(c => c.san));
  list.forEach((c, i) => (c.rank = i));
  queueFollowups(fen, key, list);
  if (!list.length) return positionSummary(fen, key, ex) + `<p class="help">${S.token ? "Loading what players at your level play here…" : "Play a move on the board, or add a Lichess token in Settings to see what players at your level play."}</p>`;
  const myTurn = isMine(key, S.color);
  return positionSummary(fen, key, ex) + `<div class="cands">
      <div class="crow chead${myTurn ? " c5" : ""}"><span>Move ${info(`Move: a green outline means ${myTurn ? "it's in your repertoire" : "you've prepared it"}${myTurn ? "" : ", orange means a gap (not prepared)"}. Engine: Stockfish depth ${ROW_DEPTH}, from your side; ✓ means within ${(adv().good / 100).toFixed(1)} of the best move. Peers: how often it's played · your colour's score after it${ex ? ` (${srcLine(ex)})` : ""}. You: your games · your score.${myTurn ? ` Rep: how many good replies your opponent has (within ${(adv().good / 100).toFixed(1)} of their best); purple means a practical weapon, few good replies that players at your level often miss.` : ""} Tap a row for details, or a move to play it.`, "What the columns mean")}</span><span>Engine</span><span>Peers</span><span>You</span>${myTurn ? "<span>Rep</span>" : ""}</div>
      ${list.map(c => candRow(fen, key, c, ex, path)).join("")}
    </div>`;
}
