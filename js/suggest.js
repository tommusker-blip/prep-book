"use strict";
/* Openings page: its tabs, and Ideas across the tree (scan, find ideas, one idea at a time, Replace / Add).
   Classic script: shares one global scope with the others (see index.html for the load order). */
// Ideas are on the Openings page (v0.9.9). While results arrive (scans, Lichess, ideas),
// they're redrawn at most every 1.5 s, and only while that tab is showing.
let sideTimer = null;
const sugShowing = () => S.view === "openings" && S.otab === "sug";
function sidePanes() {
  clearTimeout(sideTimer); sideTimer = null;
  if (sugShowing()) renderSuggest();
}
function sideSoon() { if (!sideTimer && sugShowing()) sideTimer = setTimeout(() => { sideTimer = null; sidePanes(); }, 1500); }
// The Openings page's tabs
function showOpeningsTab() {
  const tab = ["sug", "map", "connect"].includes(S.otab) ? S.otab : "cat";
  document.querySelectorAll("[data-otab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.otab === tab)));
  document.querySelectorAll("[data-opane]").forEach(p => (p.hidden = p.dataset.opane !== tab));
  if (tab === "sug") renderSuggest(); else if (tab === "map") renderMapTab(); else if (tab === "connect") renderConnect(); else { renderAddOpening(); renderDoubles(); renderCatalogue(); }
}

/* ----- the scan box: Lichess data for every position of the tree ----- */
function renderScanBox() {
  const box = $("#scanBox");
  if (!box) return;
  if (!S.token) { box.innerHTML = `<p class="help">Add a Lichess token in Settings to get suggestions.</p>`; return; }
  if (explorerBlocked) { box.innerHTML = `<p class="help">Lichess can't be reached from here.</p>`; return; }
  const who = S.color === "white" ? "White" : "Black";
  if (Scan.running) {
    box.innerHTML = `<div class="scanrow"><span class="help" aria-live="polite">Fetching ${Scan.done} of ${Scan.total} positions for your ${Scan.color === "white" ? "White" : "Black"} repertoire…${Scan.note ? " " + esc(Scan.note) : ""}</span><button type="button" class="btn ghost" data-scan>Stop</button></div>
      <progress max="${Scan.total}" value="${Scan.done}"></progress>`;
    return;
  }
  const todo = scanTodo().length;
  box.innerHTML = `<div class="scanrow"><span class="help">${Scan.note ? esc(Scan.note) + " " : ""}${todo
    ? `${todo} position${todo === 1 ? "" : "s"} in your ${who} repertoire ${todo === 1 ? "has" : "have"} no Lichess data yet.`
    : `Lichess data is loaded for every position in your ${who} repertoire.`}</span>
    ${todo ? `<button type="button" class="btn" data-scan>Scan my tree (about ${Math.max(1, Math.ceil((todo * EXPL_GAP) / 60000))} min)</button>` : ""}</div>`;
}

/* ----- Ideas, one at a time (v0.9.43) -----
   The lists (gems, better-scoring, tricks, easy to remember, same structure) were too much at once.
   Now one queue across the tree, best first, shown one card at a time:
   - a move found by more than one check is one card with all its labels;
   - rank = reach of the position (indexTree) × a rough gain in game points: for gems and better-
     scoring moves, its peers' score minus my move's (or the position's average if mine has no data);
     for tricks err × SUG_TRICK; for easy-to-remember fit × SUG_EASY. Gems my move already scores as
     well as are left out;
   - how sure: the peers' edge against its sampling error (sugSure()), Stockfish at SUG_DEPTH on both
     moves (asked when the card shows), and my own games in the position;
   - Skip hides it on this device (pb_sugskip: colour|book|key|san).
   Same pawn structure (links to Lichess, nothing to act on here) was dropped. */
const SUG_TRICK = 0.2, SUG_EASY = 0.04, SUG_DEPTH = 12;
const SUG = { i: 0, cur: null, tok: 0 };
const SUG_KINDS = {
  gems: ["Hidden gem", "Rarely played at your level, but players of your side score well with it."],
  better: ["Scores better than yours", "Players of your side at your level score better with it than with your move."],
  trick: ["Practical trick", "Opponents at your level often go wrong against it."],
  memorable: ["Easy to remember", "It leads back into your prep or builds the same setup as your other lines."],
};
const sugSkips = () => lsGet("pb_sugskip", {});
function sugQueue(color = S.color) {
  const s = suggestions(color), ti = treeIdeas(color), R = rep(color), skip = sugSkips(), idx = indexTree(color), by = new Map();
  const add = (kind, path, san, gain, r) => {
    const key = K(fenAfter(START, path)), mine = (R.pos[key] || { m: [] }).m;
    if (mine.includes(san)) return;
    const id = `${color}|${S.book}|${key}|${san}`;
    let e = by.get(id);
    if (!e) by.set(id, (e = { id, key, path, san, mine: mine.slice(), kinds: [], gain: 0, reach: (idx[key] || {}).reach || 0 }));
    if (!e.kinds.includes(kind)) e.kinds.push(kind);
    e[kind] = r; e.gain = Math.max(e.gain, gain);
  };
  s.gems.forEach(r => { const g = r.sc - (r.myBest >= 0 ? r.myBest : r.avg); if (g > 0) add("gems", r.path, r.san, g, r); });
  s.better.forEach(r => add("better", r.path, r.san, r.sc - r.myBest, r));
  ti.trick.forEach(r => add("trick", r.path, r.c.san, r.c.err * SUG_TRICK, r));
  ti.memorable.forEach(r => add("memorable", r.path, r.c.san, r.m.score * SUG_EASY, r));
  const all = [...by.values()].map(e => ({ ...e, rank: e.reach * Math.max(0.005, e.gain) })).sort((a, b) => b.rank - a.rank);
  return { list: all.filter(e => !skip[e.id]), skipped: all.filter(e => skip[e.id]).length };
}
// How sure the peers' numbers are: the edge against two standard errors (a score's spread per game is at most about 0.45)
function sugSure(e, color = S.color) {
  const r = e.gems || e.better;
  if (!r) return null;
  const ex = cachedExplorer(fenAfter(START, e.path));
  const my = ex ? ex.moves.filter(x => e.mine.includes(x.san) && x.n).sort((a, b) => scoreFor(b, color) - scoreFor(a, color))[0] : null;
  const base = my ? scoreFor(my, color) : r.avg, se = 0.45 * Math.sqrt(1 / r.n + (my ? 1 / my.n : 0));
  const edge = r.sc - base, z = edge / se;
  return { my, base, edge, margin: 2 * se, word: z >= 2 ? ["good", "Unlikely to be chance"] : z >= 1 ? ["", "Probably real, but could partly be chance"] : ["bad", "Could easily be chance"] };
}
// My side's eval after a move of mine (cached, depth SUG_DEPTH), or null; asks Stockfish if missing
function sugEval(path, san) {
  const f = fenAfter(START, path.concat(san));
  if (!f) return null;
  const e = evalAt(f, SUG_DEPTH);
  if (e) return -e.cp; // the opponent is to move after my move: flip to my side
  if (!Engine.failed) { const tok = SUG.tok; Engine.analyse(f, SUG_DEPTH, { prio: PRIO.now }).then(() => { if (tok === SUG.tok && sugShowing()) renderSuggest(); }, () => {}); }
  return null;
}
let SGB = null;
function renderSuggest() {
  renderScanBox(); renderIdeaBox();
  const out = $("#sugOut");
  if (!S.token) { out.innerHTML = `<p class="help">Add a Lichess token in Settings to get ideas.</p>`; return; }
  const color = S.color, q = sugQueue(color), list = q.list;
  const again = q.skipped ? `<p class="help">${q.skipped} skipped. <button type="button" class="linkish" data-sugunskip>Show them again</button></p>` : "";
  if (!list.length) {
    SUG.cur = null;
    out.innerHTML = undoNote("sug") + `<p class="help" style="margin-top:10px">${scanTodo().length ? "Scan your tree (Find more ideas, below) to look for ideas." : "No ideas with the current thresholds. You can change them in Settings."}</p>` + again;
    return;
  }
  SUG.i = Math.max(0, Math.min(SUG.i, list.length - 1));
  const e = list[SUG.i];
  if (!SUG.cur || SUG.cur.id !== e.id) SUG.tok++;
  SUG.cur = e;
  const pc = x => Math.round(x * 100) + "%", op = openingFor(e.path.concat(e.san));
  const sure = sugSure(e, color), ev = sugEval(e.path, e.san), myEv = e.mine.map(m => [m, sugEval(e.path, m)]);
  const evTxt = cp => (cp == null ? "…" : pawns(color === "white" ? cp : -cp)); // shown from White's side (v0.9.47)
  const lines = [];
  if (sure) {
    const r = e.gems || e.better;
    lines.push(`<li><b>At your level</b>: played in ${pc(r.f)} of games; your side scores <b>${pc(r.sc)}</b> with it in ${r.n.toLocaleString("en-GB")} games, ${sure.my ? `${pc(sure.base)} with ${esc(sure.my.san)} (${sure.my.n.toLocaleString("en-GB")} games)` : `${pc(r.avg)} on average`}.
      <span class="${sure.word[0] === "good" ? "ok" : sure.word[0] === "bad" ? "bad" : ""}">${sure.word[1]}</span> <span class="muted">(±${Math.round(sure.margin * 100)} points)</span></li>`);
  }
  if (e.trick) lines.push(`<li><b>Opponents go wrong</b>: ${pc(e.trick.c.err)} of replies at your level give you at least a pawn.</li>`);
  if (e.memorable) lines.push(`<li><b>Fits your prep</b>: ${pc(e.memorable.m.score)}. ${ideaWhy(e.memorable.c, e.memorable.m)}</li>`);
  if (!Engine.failed) {
    const got = myEv.map(([, cp]) => cp).filter(cp => cp != null), best = got.length ? Math.max(...got) : null;
    const lose = ev != null && best != null ? best - ev : null;
    lines.push(`<li><b>Stockfish</b> (depth ${SUG_DEPTH}, + good for White): ${esc(e.san)} ${evTxt(ev)}${myEv.length ? `, ${myEv.map(([m, cp]) => `your ${esc(m)} ${evTxt(cp)}`).join(", ")}` : ""}.${lose != null && lose >= adv().mistake ? ` <span class="bad">It gives up ${(lose / 100).toFixed(1)} against yours.</span>` : lose != null && lose >= adv().good ? ` <span class="muted">A little worse than yours for the engine.</span>` : ""}</li>`);
  }
  const ps = myPosStats(e.key, color), ms = myMoveStats(e.key, e.san, color);
  lines.push(`<li><b>Your games</b>: ${ps && ps.n ? `${ps.n} reached this position, you scored ${pc(wdlScore(ps))}${ms && ms.n ? `; ${ms.n} with ${esc(e.san)}, ${pc(wdlScore(ms))}` : ""}` : "none reached this position"}. You'd get here in about ${e.reach >= 0.1 ? pc(e.reach) : (e.reach * 100).toFixed(1) + "%"} of your games as ${color}.</li>`);
  const acts = e.mine.map((m, j) => `<button type="button" class="btn quick${j ? " ghost" : ""}" data-sugact="${j}">Replace ${esc(m)}</button>`).join("")
    + `<button type="button" class="btn ${e.mine.length ? "ghost " : ""}quick" data-sugact="add">${e.mine.length ? "Add as an option" : "Add to my repertoire"}</button>`;
  out.innerHTML = undoNote("sug") + `<div class="sugcard">
    <div class="row sugnav"><button type="button" class="btn ghost quick" data-sugstep="-1" ${SUG.i ? "" : "disabled"} aria-label="Previous idea">◀</button><b>Idea ${SUG.i + 1} of ${list.length}</b><button type="button" class="btn ghost quick" data-sugstep="1" ${SUG.i < list.length - 1 ? "" : "disabled"} aria-label="Next idea">▶</button></div>
    <p class="sugkinds">${e.kinds.map(k => `<span class="pill gem">${SUG_KINDS[k][0]}</span>`).join(" ")}</p>
    <div class="conwrap"><div id="sugBoard" class="board aoboard" aria-label="The position"></div>
      <div class="sugbody">
        <p class="sugmove"><b class="mono">${esc(moveLabel(e.path, e.san))}</b>${e.mine.length ? ` <span class="help">instead of ${e.mine.map(esc).join(" / ")}</span>` : ""}</p>
        <p class="help">After <span class="mono">${esc(numbered(0, e.path) || "the start")}</span>${op ? ` · ${esc(op.name)}` : ""}</p>
        <p class="help">${e.kinds.map(k => SUG_KINDS[k][1]).join(" ")}</p>
        <ul class="sugev">${lines.join("")}</ul>
      </div></div>
    <div class="row sugacts">${acts}<button type="button" class="btn ghost quick" data-sugskip>Skip</button><button type="button" class="btn ghost quick" data-sugopen>Open in Build</button></div>
    ${again}
  </div>`;
  // the board: the idea (purple) and my move(s) (blue)
  const el = $("#sugBoard");
  if (!SGB || SGB.el !== el) { SGB = Board(el); SGB.locked = true; SGB.noSlide = true; }
  SGB.flip = color === "black";
  const fen = fenAfter(START, e.path), arrows = [];
  const arrow = (san, kind, w) => { const m = new Chess(fen).move(san, { sloppy: true }); if (m) arrows.push({ from: m.from, to: m.to, kind, w }); };
  e.mine.forEach(m => arrow(m, "mine", 0.45));
  arrow(e.san, "gem", 0.8);
  SGB.set(fen, { arrows });
}
function onScanTick(finished) {
  if (finished) catStale(Scan.color || S.color);
  renderBg();
  if (sugShowing()) { if (finished) renderSuggest(); else renderScanBox(); }
  else if (finished && S.view === "build") renderBuild();
}
function renderIdeaBox() {
  const box = $("#ideaBox");
  if (!box) return;
  if (Engine.failed) { box.innerHTML = ""; return; }
  if (IdeaJob.running) {
    box.innerHTML = `<div class="scanrow"><span class="help" aria-live="polite">Finding ideas: ${IdeaJob.done} of ${IdeaJob.total} of your positions${IdeaJob.note ? ", " + esc(IdeaJob.note) : ""}…</span><button type="button" class="btn ghost" data-ideas="tree">Stop</button></div>
      <progress max="${IdeaJob.total}" value="${IdeaJob.done}"></progress>`;
    return;
  }
  const todo = ideaTodo().length;
  box.innerHTML = `<div class="scanrow"><span class="help">${IdeaJob.note && !IdeaJob.running ? esc(IdeaJob.note) + " " : ""}${todo
    ? `${todo} of your move positions haven't been checked for practical tricks and easy-to-remember moves (Stockfish).`
    : "Every position where it's your move has been checked for practical tricks and easy-to-remember moves."}</span>
    ${todo ? `<button type="button" class="btn ghost" data-ideas="tree">Find ideas across my tree (about ${Math.max(1, Math.round(todo * 15 / 60))} min)</button>` : ""}</div>`;
}
function onIdeaTick(finished) {
  renderBg();
  if (sugShowing()) { if (finished) renderSuggest(); else renderIdeaBox(); }
  else if (finished && S.view === "build") renderBuild();
}
/* ----- acting on an idea (v0.9.10): Add as an option, or Replace one of my moves there (addMove()
   with `replaces`; the old move's line is pruned by walk(), its card is reset). Undo: RepUndo (rep.js). */
function onSugAct(how) {
  const e = SUG.cur;
  if (!e) return;
  const color = S.color, n = rep(color).pos[e.key], old = how === "add" ? null : n && n.m[+how];
  RepUndo.change("sug", color, () => {
    if (addMove(e.path, e.san, color, old) === "same") return "";
    walk(color);
    return old ? `Replaced ${moveLabel(e.path, old)} with ${moveLabel(e.path, e.san)}` : `Added ${moveLabel(e.path, e.san)} as ${n && n.m.length > 1 ? "another option" : "your move"}`;
  });
  renderSuggest();
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("scan", d => scanTree(S.color, onScanTick), true);
onClick("sugact", d => onSugAct(d.sugact));
onClick("sugstep", d => { SUG.i += +d.sugstep; renderSuggest(); }, true);
onClick("sugskip", () => { if (!SUG.cur) return; const s = sugSkips(); s[SUG.cur.id] = 1; lsSet("pb_sugskip", s); renderSuggest(); }, true);
onClick("sugunskip", () => { const s = sugSkips(), pre = `${S.color}|${S.book}|`; Object.keys(s).forEach(k => { if (k.startsWith(pre)) delete s[k]; }); lsSet("pb_sugskip", s); renderSuggest(); }, true);
onClick("otab", d => { S.otab = d.otab; showOpeningsTab(); });
onClick("sugopen", () => { const e = SUG.cur; if (!e) return; S.build[S.color] = e.path.slice(); candOpen.add(e.key + "|" + e.san); S.ptab = "moves"; setView("build"); window.scrollTo({ top: 0 }); }, true);
