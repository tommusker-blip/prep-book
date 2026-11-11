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
const CON = { sig: "", list: [], vlist: [], running: false, verifying: false, vPhase: "", vDone: 0, vTotal: 0, dataVer: 0, skipVer: 0, done: 0, total: 0, tok: 0, sel: 0, step: 0 };
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
  return { steps, p, pKnown, unlikely, unknown, end: c.fen() };
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
    Object.assign(CON, { running: false, verifying: true, sig, color, book: S.book, list: out.sort((a, b) => conScore(b) - conScore(a)) });
    onTick(false);
    // v0.9.33: then fetch everything the filters need before anything is shown (vlist)
    conVerify(tok, color, onTick).then(ok => {
      if (!ok) return;
      Object.assign(CON, { verifying: false, vlist: CON.list, vColor: color, vBook: S.book });
      CON.dataVer++;
      onTick(true);
    });
  };
  setTimeout(step, 0);
}
/* v0.9.33: the list is worked out in full before it's shown (it used to appear at once and then
   lose chains as their Lichess data and engine checks came in). After the sweep:
   1. Lichess data for every opponent move in a chain that has none (one request a second, so
      the first time can take a minute or two; it's cached after that);
   2. Stockfish (CON_DEPTH) for every position the soundness check needs, for the chains that are
      still likely enough (at the lowest filter, so changing the filter needs nothing new).
   CON.vPhase / vDone / vTotal drive the progress bar. A newer sweep (tree changed) stops it. */
async function conVerify(tok, color, onTick) {
  const live = () => tok === CON.tok, minAll = CON_MINS[0];
  const chains = () => CON.list.map(c => conSteps(fenAfter(START, c.path), c.moves, color)).filter(ch => !ch.unlikely && ch.pKnown >= minAll);
  if (S.token && !explorerBlocked) {
    const need = new Map();
    for (const ch of chains()) for (const s of ch.steps) if (!s.mine && s.f == null) need.set(K(s.fen), s.fen);
    Object.assign(CON, { vPhase: "lichess", vDone: 0, vTotal: need.size }); onTick(false);
    for (const fen of need.values()) {
      if (!live()) return false;
      try { await explorer(fen, { prio: PRIO.soon }); } catch (e) { /* counted as no data */ }
      CON.vDone++; onTick(false);
      if (explorerBlocked) break;
    }
  }
  if (!Engine.failed) {
    const need = new Map();
    for (const ch of chains()) ch.steps.forEach((s, j) => { if (s.mine) for (const f of [s.fen, j + 1 < ch.steps.length ? ch.steps[j + 1].fen : ch.end]) if (!evalAt(f, CON_DEPTH)) need.set(K(f), f); });
    Object.assign(CON, { vPhase: "engine", vDone: 0, vTotal: need.size }); onTick(false);
    for (const f of need.values()) {
      if (!live()) return false;
      try { await Engine.analyse(f, CON_DEPTH, { prio: PRIO.soon }); } catch (e) { if (Engine.failed) break; }
      CON.vDone++; onTick(false);
    }
  }
  return live();
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
/* v0.9.30: once I approve a chain, the positions where it has my moves are decided. A later
   "switch" chain from one of them would offer to replace the move I just approved (after 2.d4 was
   approved from 1.c4 Nf6, a chain 2.Nc3 e6 3.d4 offered "Replace d4"), so those are left out
   while the approved move is still there (so Undo brings them back). Kept with the skips. */
const conDecidedKey = (key, color = S.color) => "@" + color + "|" + S.book + "|" + key;
function conDecide(c, color, group = []) {
  const s = conSkips();
  c.moves.forEach((m, i) => { const key = K(fenAfter(START, c.path.concat(c.moves.slice(0, i)))); if (isMine(key, color)) s[conDecidedKey(key, color)] = m; });
  // v0.9.32: the other options of the choice are put away while the chosen line is in the tree
  group.filter(x => x !== c).forEach(x => (s["#" + conId(x)] = { src: c.src, m: c.moves[0] }));
  lsSet("pb_conskip", s); CON.skipVer++;
}
/* v0.9.31: no chain through a bad position. Each of my moves in the chain is checked with
   Stockfish (CON_DEPTH): what it gives up against the best move there, added up over the chain.
   More than the mistake margin (adv().mistake) in all and the chain is hidden. The opponent's
   moves don't count: a bad move of theirs only helps me. Checked lazily, for the chain shown and
   the top few, and the card says so while it's pending. Without the engine, nothing is hidden. */
const CON_DEPTH = 12;
const conMyCp = (fen, color) => { const e = evalAt(fen, CON_DEPTH); return e ? (fen.split(" ")[1] === (color === "white" ? "w" : "b") ? e.cp : -e.cp) : null; };
function conSound(c, color = S.color) {
  if (Engine.failed) return { state: "ok", loss: null };
  let loss = 0, pending = false;
  c.steps.forEach((s, j) => {
    if (!s.mine) return;
    const before = conMyCp(s.fen, color), after = conMyCp(j + 1 < c.steps.length ? c.steps[j + 1].fen : c.end, color);
    if (before == null || after == null) { pending = true; return; }
    loss += Math.max(0, before - after);
  });
  if (loss > adv().mistake) return { state: "bad", loss };
  return { state: pending ? "pending" : "ok", loss };
}
let conTimer = null;
// A result arrived for the chain on show (no token or engine during the check): count it and redraw
const conSoon = () => { clearTimeout(conTimer); conTimer = setTimeout(() => { CON.dataVer++; if (S.view === "openings" && S.otab === "connect") renderConnect(); }, 250); };
const conEvaling = new Set();
function conEval(c, prio = PRIO.now) {
  if (Engine.failed) return;
  c.steps.forEach((s, j) => {
    const after = j + 1 < c.steps.length ? c.steps[j + 1].fen : c.end;
    for (const f of s.mine ? [s.fen, after] : [after]) {
      const k = K(f) + "|" + CON_DEPTH;
      if (evalAt(f, CON_DEPTH) || conEvaling.has(k)) continue;
      conEvaling.add(k);
      Engine.analyse(f, CON_DEPTH, { prio }).then(() => { conEvaling.delete(k); conSoon(); }, () => conEvaling.delete(k));
    }
  });
}
/* v0.9.33: one pass works out the list, the choices and the hidden counts, and is kept until
   something it depends on changes (tree, skips, filter, data), so redraws and taps are cheap.
   It used to be worked out several times on every redraw, with redraws every 250 ms as data
   came in: that was the lag.
   Also v0.9.33, "the same place by another order": when two options from the same position end
   where the other one also leads (the same position, or further down my tree from it), the
   later one only adds something if it gets there more often. Its chance is compared with going
   by the other option and then my tree (the opponent's moves on the way multiplied in). Not
   more likely (by at least CON_SAME_EDGE): hidden as "the same place by another order". More
   likely: kept, and the card says that's the gain (c.via). */
const CON_SAME_EDGE = 1.1;
let conMemo = { sig: "", out: null };
function conCompute() {
  const color = S.color, sig = [color, S.book, walk(color).sig, CON.vColor, CON.vBook, CON.skipVer, conMin(), CON.dataVer, adv().mistake].join("|");
  if (conMemo.sig === sig && conMemo.list === CON.vlist) return conMemo.out;
  const skip = conSkips(), R = rep(color), min = conMin(), nodes = walk(color).nodes, hidden = { rare: 0, bad: 0, same: 0 };
  const decided = c => { const m = skip[conDecidedKey(c.src)]; return !!m && c.kind === "switch" && !!R.pos[c.src] && R.pos[c.src].m.includes(m); };
  const putAway = c => { const o = skip["#" + conId(c)]; return !!o && !!R.pos[o.src] && R.pos[o.src].m.includes(o.m); };
  const mine = CON.vColor === color && CON.vBook === S.book ? CON.vlist : [];
  let q = [];
  for (const c0 of mine) {
    if (skip[conId(c0)] || (R.pos[c0.src] && R.pos[c0.src].m.includes(c0.moves[0])) || decided(c0) || putAway(c0) || !conValid(c0, nodes)) continue;
    const c = { ...c0, ...conSteps(fenAfter(START, c0.path), c0.moves, color) };
    if (c.unlikely) continue;
    if (c.pKnown < min) { hidden.rare++; continue; }
    c.sound = conSound(c, color);
    if (c.sound.state === "bad") { hidden.bad++; continue; }
    q.push(c);
  }
  q.sort((a, b) => b.p - a.p || conScore(b) - conScore(a));
  // the same place by another order
  const drop = new Set(), bySrc = new Map();
  for (const c of q) { if (!bySrc.has(c.src)) bySrc.set(c.src, []); bySrc.get(c.src).push(c); }
  for (const list of bySrc.values()) {
    if (list.length < 2) continue;
    for (const a of list) for (const b of list) {
      if (a === b || drop.has(a) || drop.has(b)) continue;
      const ap = a.toPath.join(" "), bp = b.toPath.join(" ");
      if (!(bp === ap || bp.startsWith(ap + " "))) continue;
      let pv = a.p;
      const ch = new Chess(fenAfter(START, a.toPath));
      for (const m of b.toPath.slice(a.toPath.length)) { const fen = ch.fen(); if (!isMine(K(fen), color)) { const f = oppFreq(fen, m); pv *= f == null ? CON_UNKNOWN : f; } if (!ch.move(m)) break; }
      if (b.p <= pv * CON_SAME_EDGE) drop.add(b); else b.via = { a, pv };
    }
  }
  hidden.same = drop.size;
  q = q.filter(c => !drop.has(c));
  conMemo = { sig, list: CON.vlist, out: { q, groups: conGroups(q), hidden } };
  return conMemo.out;
}
const conQueue = () => conCompute().q;
const conHidden = () => conCompute().hidden;
/* v0.9.31: chains that decide the same thing are one choice, shown together:
   - every chain from the same position (2.d4 or 2.Nc3 e6 3.d4 from 1.c4 Nf6);
   - chains between the same two opening families, either way round (Scandinavian into the
     Blackmar-Diemer, or the Blackmar-Diemer into the Scandinavian): the connection I want may be
     the other direction. Chains inside one family are only grouped by position.
   Groups come in the order of their most likely chain; the options in a group, most likely first. */
const conFam = path => { const o = openingFor(path); return o ? family(o.name) : path.slice(0, 2).join(" "); };
function conGroups(q) {
  const parent = q.map((_, i) => i), find = i => (parent[i] === i ? i : (parent[i] = find(parent[i]))), join = (a, b) => { parent[find(a)] = find(b); };
  const bySrc = new Map(), byPair = new Map();
  q.forEach((c, i) => {
    if (bySrc.has(c.src)) join(i, bySrc.get(c.src)); else bySrc.set(c.src, i);
    const a = conFam(c.path), b = conFam(c.toPath);
    if (a === b) return;
    const pair = [a, b].sort().join(" ↔ ");
    c.pair = pair;
    if (byPair.has(pair)) join(i, byPair.get(pair)); else byPair.set(pair, i);
  });
  const groups = new Map();
  q.forEach((c, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });
  return [...groups.values()];
}
function conFilterHtml() {
  const h = conHidden(), bits = [h.rare && `${h.rare} less likely`, h.bad && `${h.bad} through a bad position`, h.same && `${h.same} reaching the same place as another option, no more often`].filter(Boolean);
  return `<div class="field conmin"><span class="lbl" style="margin:0">Chance of the whole chain, at least</span>
    <div class="seg small" role="group" aria-label="Minimum chance of the whole chain">${CON_MINS.map(v => `<button type="button" data-conmin="${v}" aria-pressed="${v === conMin()}">${Math.round(v * 100)}%</button>`).join("")}</div>
    ${bits.length ? `<p class="help">Hidden: ${bits.join(", ")}.</p>` : ""}</div>`;
}
// The chain on show, and its group: by CON.selId, else the group at CON.sel and its first option
function conCurrent() {
  const { q, groups } = conCompute();
  if (!groups.length) return { q, groups, g: null, c: null, gi: 0 };
  let gi = CON.selId ? groups.findIndex(g => g.some(c => conId(c) === CON.selId)) : -1;
  if (gi < 0) gi = Math.min(CON.sel, groups.length - 1);
  const g = groups[gi], c = g.find(x => conId(x) === CON.selId) || g[0];
  CON.sel = gi; CON.selId = conId(c);
  return { q, groups, g, c, gi };
}

// Where the work is: the sweep, then Lichess, then Stockfish
function conProgress() {
  if (CON.running) return { done: CON.done, total: CON.total, text: `Looking for chains: ${nOf(CON.done)} of ${nOf(CON.total)} positions` };
  if (CON.verifying && CON.vPhase === "lichess") return { done: CON.vDone, total: CON.vTotal, text: `Fetching Lichess data for the moves in them: ${nOf(CON.vDone)} of ${nOf(CON.vTotal)}${CON.vTotal - CON.vDone > 30 ? ` (about ${Math.ceil(((CON.vTotal - CON.vDone) * EXPL_GAP) / 60000)} min)` : ""}` };
  if (CON.verifying && CON.vPhase === "engine") return { done: CON.vDone, total: CON.vTotal, text: `Checking your moves with Stockfish: ${nOf(CON.vDone)} of ${nOf(CON.vTotal)}` };
  return { done: 0, total: 1, text: "Checking your tree…" };
}

/* ----- the Connect tab ----- */
function renderConnect() {
  const box = $("#connectPane");
  if (!box) return;
  sweepConnections(S.color, done => {
    if (!(S.view === "openings" && S.otab === "connect")) return;
    if (done) return renderConnect();
    // progress only: the bar and its words, or the "updating" note over the list on show
    const p = $("#conProg"), t = $("#conProgTxt"), u = $("#conUpd"), pr = conProgress();
    if (p) { p.max = pr.total || 1; p.value = pr.done; }
    if (t) t.textContent = pr.text;
    if (u) u.textContent = "· updating: " + pr.text.toLowerCase();
    if (!p && !u) renderConnect();
  });
  const head = `<h3>Connect your lines ${info("Looks through your whole tree for short chains of likely moves (up to 4 plies) that lead from one of your positions into another of your lines by a different move order. Fill a gap: an opponent reply you haven't prepared, answered with moves that steer back into a line you know. Simplify: a different move of yours that reaches a line you know. Each card says what it keeps and what it drops: Keep this, drop … replaces your old move and removes the branch under it; Keep both adds the new move as another option. Chains that decide the same thing are shown together as a choice: every chain from the same position, and chains between the same two openings either way round. Every opponent move in a chain is one players at your level make at least 5% of the time (where Lichess data is loaded). The chance of a chain is all its opponent moves multiplied together; the filter hides chains below it, and the most likely come first. Your moves in a chain are checked with Stockfish: a chain that gives up more than the mistake margin (Settings > Advanced) on the way is hidden. The eval after each move is shown (White's side, depth 12), orange where your move gives up more than the good margin.", "About connecting lines")}</h3>`;
  // v0.9.29: after Add / Replace the tree has changed and the sweep runs again, but the list so far
  // (minus chains the change spoiled: conValid()) stays on screen meanwhile, so the next chain is there at once
  // v0.9.33: nothing is shown until the list is worked out in full (CON.vlist)
  const stale = CON.running || CON.verifying || CON.sig !== conSig(S.color), have = CON.vColor === S.color && CON.vBook === S.book;
  const checking = () => { const pr = conProgress(); box.innerHTML = head + `<p class="help" aria-live="polite" id="conProgTxt">${esc(pr.text)}</p><progress id="conProg" max="${pr.total || 1}" value="${pr.done}"></progress><p class="help">The list appears once it's complete. The first time can take a few minutes (Lichess allows about one look-up a second); after that it's quick.</p>`; };
  if (stale && !have) return checking();
  const { groups, g, c, gi } = conCurrent();
  if (!c && stale) return checking();
  if (!c) { const h = conHidden(); box.innerHTML = head + conFilterHtml() + `<p class="help" style="margin-top:8px">No connections found${h.rare || h.bad ? " that pass the filters" : ""}${Object.keys(conSkips()).length ? " (apart from the ones you skipped)" : ""}. Scan your tree on the Ideas tab so more opponent moves have data.</p>${undoNote("con")}`; return; }
  /* v0.9.35: a shorter card. What it keeps and what it drops, then the moves: the chance of each
     opponent move and the eval after every move (White's side, as in Build; orange where my
     move gives up more than the good margin). The rest is behind the ⓘ. */
  const R = rep(S.color), from = openingFor(c.path), to = openingFor(c.toPath), n = R.pos[c.src];
  const old = c.kind === "switch" ? n.m : [];
  const whiteCp = f => { const e = evalAt(f, CON_DEPTH); return e ? (f.split(" ")[1] === "w" ? e.cp : -e.cp) : null; };
  const evTxt = cp => (cp == null ? "…" : Math.abs(cp) >= 10000 ? (cp > 0 ? "+M" : "−M") : (cp > 0 ? "+" : cp < 0 ? "−" : "") + (Math.abs(cp) / 100).toFixed(1));
  const after = j => (j + 1 < c.steps.length ? c.steps[j + 1].fen : c.end);
  const stepsHtml = c.steps.map((s, j) => {
    const lbl = moveLabel(c.path.concat(c.moves.slice(0, j)), s.san), ev = whiteCp(after(j));
    const lost = s.mine ? (() => { const b = conMyCp(s.fen, S.color), a = conMyCp(after(j), S.color); return b != null && a != null ? b - a : null; })() : null;
    const pct = s.mine ? "" : `<span class="conpct">${s.f == null ? "?" : pctOf(s.f)}</span>`;
    return `<li><button type="button" class="linkish${CON.step === j + 1 ? " cur" : ""}" data-constep="${j + 1}"><span class="muted">${s.mine ? "You" : "They"}</span> <b class="mono">${esc(lbl)}</b></button>${pct}<span class="conev${lost != null && lost >= adv().good ? " bad" : ""}">${evTxt(ev)}</span></li>`;
  }).join("");
  const dropLine = d => `<b class="mono">${esc(moveLabel(c.path, d.m))}</b> ${d.n ? `and its branch (${d.n} of your moves)` : "(nothing prepared after it)"}`;
  const drops = c.kind === "switch" ? (c.drop && c.drop.length ? c.drop : old.map(m => ({ m, n: 0 }))) : [];
  const kd = `<div class="conkd">
      <p><span class="kdtag keep">Keep</span><span><b class="mono">${esc(numbered(c.path.length, c.moves))}</b>, into your ${esc(to ? to.name : "other")} line${c.cards ? ` (${c.cards} moves prepared)` : ""}</span></p>
      <p><span class="kdtag drop">Drop</span><span>${drops.length ? drops.map(dropLine).join(drops.length > 1 ? "<br>or " : "") : "nothing: this fills a gap"}</span></p>
    </div>`;
  const viaLine = c.via ? `<p class="help">Same place as ${esc(numbered(c.via.a.path.length, c.via.a.moves))}, but more often: ${pctOf(c.p)} against ${pctOf(c.via.pv)}.</p>` : "";
  // v0.9.32: one clear commit. Tapping an option only shows it; the main button commits it (my old
  // move and its branch go, and the other options of this choice are put away; Undo brings them back)
  const acts = (old.length > 1
      ? old.map((m, j) => `<button type="button" class="btn${j ? " ghost" : ""} quick" data-conact="rep:${j}">Keep this, drop ${esc(m)}</button>`).join("")
      : `<button type="button" class="btn quick" data-conact="${old.length ? "rep:0" : "add"}">${old.length ? `Keep this, drop ${esc(old[0])}` : "Add this line"}</button>`)
    + (old.length ? `<button type="button" class="btn ghost quick" data-conact="add">Keep both</button>` : "");
  const optText = x => `<b class="mono">${esc(numbered(x.path.length, x.moves))}</b> <span class="muted">${pctOf(x.p)}</span>`;
  const choice = g.length > 1 ? `<div class="conopts" role="group" aria-label="The ways to connect these lines"><p class="help" style="margin:0">${g.length} ways${c.pair ? ` to connect ${esc(c.pair)}` : " from here"}. Tap one to see it; nothing changes until you press Keep.</p>${g.map(x => `<button type="button" class="conopt" data-conopt="${esc(conId(x))}" aria-pressed="${x === c}">${x.path.length && x !== c && x.src !== c.src ? `<span class="mono muted">${esc(numbered(0, x.path))}</span> ` : ""}${optText(x)}</button>`).join("")}</div>` : "";
  box.innerHTML = head + conFilterHtml() + `<div class="conhead"><span class="lbl">${gi + 1} of ${groups.length}${stale ? ` <span class="muted" aria-live="polite" id="conUpd">· updating for your change…</span>` : ""}</span><span class="row" style="margin:0"><button type="button" class="btn ghost quick" data-connav="-1" ${gi ? "" : "disabled"} aria-label="Previous choice">◀</button><button type="button" class="btn ghost quick" data-connav="1" ${gi < groups.length - 1 ? "" : "disabled"} aria-label="Next choice">▶</button></span></div>
    ${choice}
    <div class="conwrap"><div><div id="conBoard" class="board aoboard" aria-label="The chain on a board"></div><p class="arrowkey conkey" id="conKey"></p></div>
    <div class="conbody">
      <p>From <b class="mono">${esc(numbered(0, c.path))}</b>${from ? ` <span class="muted">${esc(from.name)}</span>` : ""}</p>
      ${kd}
      <ol class="consteps">${stepsHtml}</ol>
      <p class="help">Whole chain: <b>${c.unknown ? "about " : ""}${pctOf(c.p)}</b> of games from here${c.unknown ? " (fetching some moves)" : ""}. Eval after each move, White's side.</p>
      ${viaLine}
      <div class="row conacts">${acts}</div>
      <div class="row conacts"><button type="button" class="btn ghost quick" data-conact="skip">Skip${g.length > 1 ? " this one" : ""}</button>${g.length > 1 ? `<button type="button" class="btn ghost quick" data-conact="skipall">Skip all ${g.length}</button>` : ""}<button type="button" class="btn ghost quick" data-conact="build">Open in Build</button></div>
      ${undoNote("con")}
    </div></div>`;
  conShow(c, g);
  // only for the chain on show, and only if the full check couldn't (no token or engine then)
  if (c.unknown) conFetch(c);
  conEval(c); // evals for every move shown (only missing ones are asked for)
}
// Re-made board: Board() keeps its element, so a new one is needed when the pane redraws
/* v0.9.32: arrows. At the start of the chain: the line shown (blue), the other options of this
   choice that start from the same position (grey), and my move there now (orange), so the options
   can be compared on the board. Further along: the chain's next move (blue). */
function conShow(c, g = [c]) {
  const el = $("#conBoard");
  if (!el) return;
  if (!CB || CB.el !== el) { CB = Board(el); CB.locked = true; CB.noSlide = true; }
  CB.flip = S.color === "black";
  const fr = framesTo(c.path.concat(c.moves)), i = Math.min(c.path.length + CON.step, fr.length - 1), fen = fr[i].fen;
  const arrows = [], kinds = new Set();
  const arrow = (san, kind, w) => {
    const m = new Chess(fen).move(san, { sloppy: true });
    if (!m || arrows.some(a => a.from === m.from && a.to === m.to)) return;
    arrows.push({ from: m.from, to: m.to, w, kind }); kinds.add(kind);
  };
  if (CON.step === 0) {
    arrow(c.moves[0], "mine", 0.85);
    g.filter(x => x !== c && x.src === c.src).forEach(x => arrow(x.moves[0], "other", 0.55));
    const n = rep(S.color).pos[c.src];
    if (n) n.m.forEach(m => arrow(m, "played", 0.55));
  } else if (CON.step < c.moves.length) arrow(c.moves[CON.step], "mine", 0.85);
  CB.set(fen, { last: fr[i].last, arrows });
  const key = $("#conKey");
  if (key) key.innerHTML = [kinds.has("mine") && `<span class="key best">this line</span>`, kinds.has("other") && `<span class="key other">other options</span>`, kinds.has("played") && `<span class="key played">your move now</span>`].filter(Boolean).join("");
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
    explorer(s.fen, { prio }).then(() => { conFetching.delete(k); conSoon(); }, () => conFetching.delete(k));
  }
}
function conAct(how) {
  const { g, c } = conCurrent(), color = S.color;
  if (!c) return;
  if (how === "skip" || how === "skipall") {
    const s = conSkips();
    (how === "skip" ? [c] : g).forEach(x => (s[conId(x)] = 1));
    lsSet("pb_conskip", s); CON.skipVer++;
    const rest = how === "skip" ? g.filter(x => x !== c) : [];
    CON.selId = rest.length ? conId(rest[0]) : null; // stay on the choice while it has options left
    CON.step = 0; renderConnect(); return;
  }
  // v0.9.29: Build opens where the move being looked at is played (the chain's first move, or the step
  // tapped in the list), with that move's row expanded; it used to open at the end of the chain
  if (how === "build") { const j = Math.max(0, CON.step - 1), at = c.path.concat(c.moves.slice(0, j)), next = c.moves[j]; S.build[color] = at; if (next) candOpen.add(K(fenAfter(START, at)) + "|" + next); S.ptab = "moves"; setView("build"); window.scrollTo({ top: 0 }); return; }
  const n = rep(color).pos[c.src], old = how.startsWith("rep:") && n ? n.m[+how.slice(4)] : null;
  conDecide(c, color, g);
  RepUndo.change("con", color, () => {
    c.moves.forEach((m, i) => addMove(c.path.concat(c.moves.slice(0, i)), m, color, i === 0 ? old : null));
    walk(color);
    return old ? `${moveLabel(c.path, c.moves[0])} replaces ${old}; the chain joins your ${(openingFor(c.toPath) || { name: "other" }).name} line` : `Added ${numbered(c.path.length, c.moves)}`;
  });
  CON.step = 0; CON.selId = null;
  renderConnect(); // the tree changed: the sweep runs again
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("conact", d => conAct(d.conact));
onClick("connav", d => { CON.sel = Math.max(0, CON.sel + +d.connav); CON.selId = null; CON.step = 0; renderConnect(); });
onClick("conopt", d => { CON.selId = d.conopt; CON.step = 0; renderConnect(); });
onClick("conmin", d => { S.settings.conMin = +d.conmin; Store.save("settings"); CON.sel = 0; CON.selId = null; CON.step = 0; renderConnect(); });
onClick("constep", d => { CON.step = +d.constep; const { c, g } = conCurrent(); if (c) { conShow(c, g); document.querySelectorAll("[data-constep]").forEach(b => b.classList.toggle("cur", +b.dataset.constep === CON.step)); } });
