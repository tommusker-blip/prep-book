"use strict";
/* ---------- Connect my lines (v0.9.27): Openings > Connect ----------
   The aim: grow into deeper positions I already know and like, and fill branches by steering
   into them, instead of opening new branches by accident. One sweep over the whole tree (not
   just the Build position) looks for chains of up to CON_PLIES moves that lead from a position
   in my tree to another position in my tree by a different move order:
   - "gap": the chain starts with an opponent reply I haven't prepared (or my move missing), and
     my moves after it steer back into a line I know. Fills a gap without a new branch.
   - "switch": the chain starts with a different move of mine than my repertoire move. Replace
     takes the chain instead, and the branch under my old move goes (walk() prunes what's no
     longer reached); "about N positions" says how much that saves.
   Rules: every opponent move in the chain must be likely: at least CON_MIN of games at my level
   where Lichess data is loaded (unknown counts as CON_UNKNOWN until it's fetched, which happens
   when the chain is reviewed). The chain mustn't pass through another tree position (it's
   found from there instead), and its first move mustn't already be prepared.
   Search: routesTo() from transpose.js (each piece moves at most once, straight to its square),
   only between tree positions with the right number of plies between them, the right side to
   move, few squares different and no piece coming back. Chunked (about 12 ms a step) with a
   progress bar; the result is kept until the tree changes.
   Reviewed one by one: a board steps through the chain; it lists the other replies each
   opponent move in the chain leaves open (the new branches it costs). Add / Replace go through
   RepUndo ("con"); Skip is remembered on this device (pb_conskip).
   Classic script: shares one global scope with the others (see index.html for the load order). */
const CON_PLIES = 4, CON_MIN = 0.05, CON_UNKNOWN = 0.3, CON_MIN_PLY = 2;
const CON = { sig: "", list: [], running: false, done: 0, total: 0, tok: 0, sel: 0, step: 0 };
let CB = null;
const conSkips = () => lsGet("pb_conskip", {});
const conId = c => c.src + "|" + c.moves.join(" ");
// How often players at my level play `san` here: a share, or null without data
function oppFreq(fen, san) {
  const ex = cachedExplorer(fen);
  if (!ex || !ex.total) return null;
  const m = ex.moves.find(x => x.san === san);
  return m ? m.n / ex.total : 0;
}
function conNodes(color) {
  const w = walk(color), idx = indexTree(color), bi = branchInfo(color);
  return Object.entries(w.nodes).map(([key, n]) => {
    const arr = boardArr(n.fen);
    return { key, path: n.path, ps: n.path.join(" "), fen: n.fen, arr, cnt: pieceCounts(arr), turn: n.fen.split(" ")[1], reach: idx[key] ? idx[key].reach : 0, cards: bi[key] ? bi[key].cards : 0 };
  });
}
// The steps of a chain, with the opponent's frequencies as they're known now
function conSteps(srcFen, moves, color) {
  const c = new Chess(srcFen), steps = [];
  let p = 1, pKnown = 1, unlikely = false, unknown = 0;
  for (const san of moves) {
    const fen = c.fen(), mine = isMine(K(fen), color);
    const f = mine ? null : oppFreq(fen, san);
    if (!mine) { if (f == null) unknown++; else { if (f < CON_MIN) unlikely = true; pKnown *= f; } p *= f == null ? CON_UNKNOWN : f; }
    steps.push({ fen, san, mine, f });
    if (!c.move(san)) break;
  }
  return { steps, p, pKnown, unlikely, unknown };
}
// Chains from one tree position into others. ctx: {byLen, inTree, nodes, R, color}
function connectFrom(src, ctx) {
  const out = [], { byLen, inTree, R, color } = ctx;
  if (src.path.length < CON_MIN_PLY) return out;
  const n = R.pos[src.key], have = n ? n.m : [], other = t => (t === "w" ? "b" : "w");
  for (let k = 1; k <= CON_PLIES; k++) {
    const turn = k % 2 ? other(src.turn) : src.turn;
    for (const t of byLen.get(src.path.length + k) || []) {
      if (t.turn !== turn || t.ps.startsWith(src.ps + " ")) continue; // its own continuation
      let diff = 0;
      for (let i = 0; i < 64 && diff <= 2 * k + 2; i++) if (src.arr[i] !== t.arr[i]) diff++;
      if (!diff || diff > 2 * k + 2) continue;
      if (Object.entries(t.cnt).some(([pc, c]) => (src.cnt[pc] || 0) < c && pc.toLowerCase() !== "q")) continue;
      for (const r of routesTo(src.fen, t.arr, t.key, k)) {
        if (have.includes(r[0])) continue; // already prepared: found from the next position
        const ch = conSteps(src.fen, r, color);
        if (ch.unlikely || ch.steps.length !== r.length) continue;
        if (ch.steps.slice(1).some(s => inTree.has(K(s.fen)))) continue; // passes through my tree
        const kind = ch.steps[0].mine && have.length ? "switch" : "gap";
        // a switch drops the branch under my old move(s): about how many of my positions
        const drop = kind === "switch" ? have.map(m => ({ m, n: ctx.nodes.filter(x => x.cards != null && (x.ps === src.ps + " " + m || x.ps.startsWith(src.ps + " " + m + " ")) && isMine(x.key, color) && R.cards[x.key]).length })) : [];
        out.push({ src: src.key, path: src.path, moves: r, to: t.key, toPath: t.path, kind, reach: src.reach, cards: t.cards, drop, ...ch });
        break;
      }
    }
  }
  return out;
}
const conScore = c => c.reach * c.p * (1 + 0.2 * Math.min(c.cards, 20)) * (c.kind === "switch" ? 1 + Math.min(Math.max(0, ...c.drop.map(d => d.n)), 20) / 4 : 1);
const conSig = color => color + "|" + S.book + "|" + walk(color).sig;
// The sweep, in steps so the page stays responsive. onTick(done) redraws.
function sweepConnections(color = S.color, onTick = () => {}, force = false) {
  const sig = conSig(color);
  if (!force && (CON.sig === sig || (CON.running && CON.runSig === sig))) return;
  const tok = ++CON.tok, nodes = conNodes(color), byLen = new Map(), inTree = new Set(nodes.map(x => x.key));
  for (const x of nodes) { const l = x.path.length; if (!byLen.has(l)) byLen.set(l, []); byLen.get(l).push(x); }
  const ctx = { byLen, inTree, nodes, R: rep(color), color }, out = [];
  Object.assign(CON, { running: true, runSig: sig, done: 0, total: nodes.length });
  let i = 0;
  const step = () => {
    if (tok !== CON.tok) return;
    const end = performance.now() + 12;
    while (i < nodes.length && performance.now() < end) out.push(...connectFrom(nodes[i++], ctx));
    CON.done = i;
    if (i < nodes.length) { onTick(false); setTimeout(step, 0); return; }
    // v0.9.29: keep the place (CON.selId) rather than going back to the first chain
    Object.assign(CON, { running: false, sig, color, book: S.book, list: out.sort((a, b) => conScore(b) - conScore(a)) });
    onTick(true);
  };
  setTimeout(step, 0);
}
// The same, all at once (tests)
function findConnections(color = S.color) {
  const nodes = conNodes(color), byLen = new Map(), inTree = new Set(nodes.map(x => x.key));
  for (const x of nodes) { const l = x.path.length; if (!byLen.has(l)) byLen.set(l, []); byLen.get(l).push(x); }
  const ctx = { byLen, inTree, nodes, R: rep(color), color };
  return nodes.flatMap(x => connectFrom(x, ctx)).sort((a, b) => conScore(b) - conScore(a));
}
// Chains still to review: not skipped, still not in the tree, frequencies brought up to date
/* v0.9.28: a minimum chance for the whole chain (S.settings.conMin, synced; default 25%), and the
   most likely chains first. A chain's chance is the product of its opponent moves' frequencies.
   Moves without data don't count against the filter (they'd never be fetched otherwise), but
   they count as CON_UNKNOWN in the order, and the top few chains' data is fetched in the
   background, so a chain drops out once its real chance is known to be too low. */
const CON_MINS = [0.1, 0.25, 0.5], CON_PREFETCH = 5;
const conMin = () => (S.settings.conMin != null ? S.settings.conMin : 0.25);
// Still a chain after a change to the tree? Both ends still in the tree, and nothing on the way
// now in it (a chain that passes through the tree is found from there instead, at the next sweep)
function conValid(c, nodes) {
  if (!nodes[c.src] || !nodes[c.to]) return false;
  const ch = new Chess(fenAfter(START, c.path));
  for (let i = 0; i < c.moves.length - 1; i++) { if (!ch.move(c.moves[i])) return false; if (nodes[K(ch.fen())]) return false; }
  return true;
}
function conQueue() {
  const skip = conSkips(), R = rep(S.color), min = conMin(), nodes = walk(S.color).nodes;
  return CON.list.filter(c => !skip[conId(c)] && !(R.pos[c.src] && R.pos[c.src].m.includes(c.moves[0])) && conValid(c, nodes))
    .map(c => ({ ...c, ...conSteps(fenAfter(START, c.path), c.moves, S.color) }))
    .filter(c => !c.unlikely && c.pKnown >= min)
    .sort((a, b) => b.p - a.p || conScore(b) - conScore(a));
}
const conHidden = () => { const skip = conSkips(), min = conMin(); return CON.list.filter(c => !skip[conId(c)]).map(c => conSteps(fenAfter(START, c.path), c.moves, S.color)).filter(c => !c.unlikely && c.pKnown < min).length; };
function conFilterHtml() {
  const hidden = conHidden();
  return `<div class="field conmin"><span class="lbl" style="margin:0">Chance of the whole chain, at least</span>
    <div class="seg small" role="group" aria-label="Minimum chance of the whole chain">${CON_MINS.map(v => `<button type="button" data-conmin="${v}" aria-pressed="${v === conMin()}">${Math.round(v * 100)}%</button>`).join("")}</div>
    ${hidden ? `<p class="help">${hidden} less likely chain${hidden === 1 ? "" : "s"} hidden.</p>` : ""}</div>`;
}

/* ----- the Connect tab ----- */
function renderConnect() {
  const box = $("#connectPane");
  if (!box) return;
  const C = S.color === "white" ? "White" : "Black";
  sweepConnections(S.color, done => { if (S.view === "openings" && S.otab === "connect") { if (done) renderConnect(); else { const p = $("#conProg"); if (p) { p.max = CON.total; p.value = CON.done; } } } });
  const head = `<h3>Connect your lines ${info("Looks through your whole tree for short chains of likely moves (up to 4 plies) that lead from one of your positions into another of your lines by a different move order. Fill a gap: an opponent reply you haven't prepared, answered with moves that steer back into a line you know. Simplify: a different move of yours that reaches a line you know; Replace drops the branch under your old move. Every opponent move in a chain is one players at your level make at least 5% of the time (where Lichess data is loaded). The chance of a chain is all its opponent moves multiplied together; the filter hides chains below it, and the most likely come first. Each chain can leave other replies open along the way: those are listed, so you can judge if the chain is worth it.", "About connecting lines")}</h3>
    <p class="help">Reach deeper positions you already know, instead of opening new branches. One at a time, for your ${C} repertoire.</p>`;
  // v0.9.29: after Add / Replace the tree has changed and the sweep runs again, but the list so far
  // (minus chains the change spoiled: conValid()) stays on screen meanwhile, so the next chain is there at once
  const stale = CON.running || CON.sig !== conSig(S.color), have = CON.color === S.color && CON.book === S.book && CON.list.length;
  if (stale && !have) { box.innerHTML = head + `<p class="help" aria-live="polite">Checking your tree…</p><progress id="conProg" max="${CON.total || 1}" value="${CON.done}"></progress>`; return; }
  const q = conQueue();
  if (!q.length && stale) { box.innerHTML = head + `<p class="help" aria-live="polite">Checking your tree…</p><progress id="conProg" max="${CON.total || 1}" value="${CON.done}"></progress>`; return; }
  if (!q.length) { box.innerHTML = head + conFilterHtml() + `<p class="help" style="margin-top:8px">No connections found${conHidden() ? " at this chance or above" : ""}${Object.keys(conSkips()).length ? " (apart from the ones you skipped)" : ""}. Scan your tree on the Ideas tab so more opponent moves have data.</p>${undoNote("con")}`; return; }
  // stay on the same chain while the order shifts (new Lichess data), else the same place in the list
  let at = CON.selId ? q.findIndex(x => conId(x) === CON.selId) : -1;
  if (at < 0) at = Math.min(CON.sel, q.length - 1);
  CON.sel = at; CON.selId = conId(q[at]);
  const c = q[CON.sel], R = rep(S.color);
  const from = openingFor(c.path), to = openingFor(c.toPath);
  const all = c.path.concat(c.moves), stepsHtml = c.steps.map((s, j) => {
    const ply = c.path.length + j, lbl = moveLabel(c.path.concat(c.moves.slice(0, j)), s.san);
    let extra = "";
    if (!s.mine) {
      const ex = cachedExplorer(s.fen), others = ex && ex.total ? ex.moves.filter(m => m.san !== s.san && m.n / ex.total >= 0.03).slice(0, 3) : [];
      extra = s.f == null ? ` <span class="muted">(no data yet)</span>` : ` <span class="muted">${pctOf(s.f)} of games</span>${j > 0 && others.length ? `<br><span class="help">leaves open: ${others.map(m => `${esc(m.san)} ${pctOf(m.n / ex.total)}`).join(", ")}</span>` : ""}`;
    }
    return `<li><button type="button" class="linkish${CON.step === j + 1 ? " cur" : ""}" data-constep="${j + 1}">${s.mine ? "You" : "They"}: <b class="mono">${esc(lbl)}</b></button>${extra}</li>`;
  }).join("");
  const n = R.pos[c.src], first = c.moves[0];
  const kindLine = c.kind === "switch"
    ? `<p class="help">Simplify: instead of your <b>${esc(n.m.join(" / "))}</b> here. Replace drops the branch under it: ${c.drop.map(d => `about ${d.n} of your positions after ${esc(d.m)}`).join(", ")}.</p>`
    : n && n.m.length ? `<p class="help">Fill a gap: <b>${esc(moveLabel(c.path, first))}</b> isn't in your prep here.</p>` : `<p class="help">Fill a gap: you have no move here yet.</p>`;
  const acts = c.kind === "switch"
    ? n.m.map((m, j) => `<button type="button" class="btn${j ? " ghost" : ""} quick" data-conact="rep:${j}">Replace ${esc(m)}</button>`).join("") + `<button type="button" class="btn ghost quick" data-conact="add">Add as an option</button>`
    : `<button type="button" class="btn quick" data-conact="add">Add the chain</button>`;
  box.innerHTML = head + conFilterHtml() + `<div class="conhead"><span class="lbl">${CON.sel + 1} of ${q.length}${stale ? ` <span class="muted" aria-live="polite">· updating for your change…</span>` : ""}</span><span class="row" style="margin:0"><button type="button" class="btn ghost quick" data-connav="-1" ${CON.sel ? "" : "disabled"} aria-label="Previous connection">◀</button><button type="button" class="btn ghost quick" data-connav="1" ${CON.sel < q.length - 1 ? "" : "disabled"} aria-label="Next connection">▶</button></span></div>
    <div class="conwrap"><div id="conBoard" class="board aoboard" aria-label="The chain on a board"></div>
    <div class="conbody">
      <p>From <b class="mono">${esc(numbered(0, c.path))}</b>${from ? ` <span class="muted">(${esc(from.name)})</span>` : ""}, you reach it in ${pctOf(c.reach)} of games.</p>
      <ol class="consteps">${stepsHtml}</ol>
      <p>…and you're in your <b>${esc(to ? to.name : "other line")}</b> line at <span class="mono">${esc(numbered(0, c.toPath))}</span>${c.cards ? `, with ${c.cards} of your moves prepared after it` : ""}.</p>
      ${kindLine}
      <p class="help">The whole chain happens in ${c.unknown ? "about " : ""}${pctOf(c.p)} of games from here${c.unknown ? " (some moves have no data yet: fetching)" : ""}.</p>
      <div class="row conacts">${acts}<button type="button" class="btn ghost quick" data-conact="skip">Skip</button><button type="button" class="btn ghost quick" data-conact="build">Open in Build</button></div>
      ${undoNote("con")}
    </div></div>`;
  conShow(c);
  conFetch(c);
  q.slice(0, CON_PREFETCH).forEach(x => { if (x !== c) conFetch(x, PRIO.soon); }); // so the order is right near the top
}
// Re-made board: Board() keeps its element, so a new one is needed when the pane redraws
function conShow(c) {
  const el = $("#conBoard");
  if (!el) return;
  if (!CB || CB.el !== el) { CB = Board(el); CB.locked = true; CB.noSlide = true; }
  CB.flip = S.color === "black";
  const fr = framesTo(c.path.concat(c.moves)), i = Math.min(c.path.length + CON.step, fr.length - 1);
  CB.set(fr[i].fen, { last: fr[i].last });
}
// Fetch Lichess data for the chain's opponent moves that have none, then redraw
const conFetching = new Set();
function conFetch(c, prio = PRIO.now) {
  if (!S.token || explorerBlocked) return;
  for (const s of c.steps) {
    if (s.mine || s.f != null) continue;
    const k = K(s.fen);
    if (conFetching.has(k)) continue;
    conFetching.add(k);
    explorer(s.fen, { prio }).then(() => { conFetching.delete(k); if (S.view === "openings" && S.otab === "connect") renderConnect(); }, () => conFetching.delete(k));
  }
}
function conAct(how) {
  const q = conQueue(), c = q[CON.sel], color = S.color;
  if (!c) return;
  if (how === "skip") { const s = conSkips(); s[conId(c)] = 1; lsSet("pb_conskip", s); CON.step = 0; renderConnect(); return; }
  // v0.9.29: Build opens where the move being looked at is played (the chain's first move, or the step
  // tapped in the list), with that move's row expanded; it used to open at the end of the chain
  if (how === "build") { const j = Math.max(0, CON.step - 1), at = c.path.concat(c.moves.slice(0, j)), next = c.moves[j]; S.build[color] = at; if (next) candOpen.add(K(fenAfter(START, at)) + "|" + next); S.ptab = "moves"; setView("build"); window.scrollTo({ top: 0 }); return; }
  const n = rep(color).pos[c.src], old = how.startsWith("rep:") && n ? n.m[+how.slice(4)] : null;
  RepUndo.change("con", color, () => {
    c.moves.forEach((m, i) => addMove(c.path.concat(c.moves.slice(0, i)), m, color, i === 0 ? old : null));
    walk(color);
    return old ? `${moveLabel(c.path, c.moves[0])} replaces ${old}; the chain joins your ${(openingFor(c.toPath) || { name: "other" }).name} line` : `Added ${numbered(c.path.length, c.moves)}`;
  });
  CON.step = 0;
  renderConnect(); // the tree changed: the sweep runs again
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("conact", d => conAct(d.conact));
onClick("connav", d => { CON.sel = Math.max(0, CON.sel + +d.connav); CON.selId = null; CON.step = 0; renderConnect(); });
onClick("conmin", d => { S.settings.conMin = +d.conmin; Store.save("settings"); CON.sel = 0; CON.selId = null; CON.step = 0; renderConnect(); });
onClick("constep", d => { CON.step = +d.constep; const q = conQueue(); if (q[CON.sel]) { conShow(q[CON.sel]); document.querySelectorAll("[data-constep]").forEach(b => b.classList.toggle("cur", +b.dataset.constep === CON.step)); } });
