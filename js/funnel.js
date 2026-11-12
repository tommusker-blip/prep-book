"use strict";
/* ---------- Routes into a position from the start (v0.9.39): Build > My lines ----------
   Pick a position (the one on the Build board, say move 10) and ask for the likely ways to get
   there from move 1. A search from the start position, steering towards the target:
   - Every move must head for the target: a piece lands on a square where it stands in the target
     ("direct"), a pawn advances towards its target square on the same file ("progress"), a piece
     the target doesn't have any more captures something ("exchange", e.g. …cxd4 in the Open
     Sicilian), or a detour: a pawn the target doesn't have moves (c7-c5, to be exchanged later), or
     a piece goes to a square one move from its target square (Nbd2-f3). Each side gets
     FUN_DETOURS detours. A piece already on its target square stays; nothing may be captured
     that the target still has.
   - Opponent moves are the ones Lichess players at my level make at least funMin() of the time
     (Settings: 5–25%, default 25%) and that also head for the target. Anything else is the
     opponent stepping off the route.
   - Value of a position = the chance of reaching the target from it if I choose well: 1 at the
     target; on my move, the best of my moves; on theirs, the sum over their replies of the
     reply's share × its value. Worked out depth first, memoised by position, with my moves tried
     in order (already in my tree first, then direct moves) and only the best FUN_TRY at each
     step, so the Lichess look-ups stay in the tens to low hundreds (cached afterwards).
     A move already in my tree is kept unless another is clearly better (FUN_KEEP).
   The result: the chance of getting there, every line in the plan with its chance, where the
   opponent steps off, and which of my moves differ from my tree. Add puts the whole plan in my
   tree (a move of mine that differs becomes another option), with Undo.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const FUN_MINS = [0.05, 0.1, 0.15, 0.2, 0.25], FUN_DETOURS = 2, FUN_TRY = 3, FUN_KEEP = 0.9, FUN_FETCH_MAX = 220, FUN_REACH_MIN = 0.003, FUN_LINES = 10;
const funMin = () => { const v = S.settings.funMin; return FUN_MINS.includes(v) ? v : 0.25; };
const FUN = { tok: 0, running: false, fetched: 0, nodes: 0, sig: "", res: null, note: "" };
const funSig = (tKey, color) => [tKey, color, S.book, funMin(), walk(color).sig].join("|");

const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
// Could a piece of this type get from square a to square b in one move (ignoring other pieces)?
function oneMove(p, a, b) {
  const df = (b % 8) - (a % 8), dr = Math.floor(b / 8) - Math.floor(a / 8), t = p.toLowerCase();
  if (a === b) return false;
  if (t === "n") return KN.some(([x, y]) => x === df && y === dr);
  if (t === "b") return Math.abs(df) === Math.abs(dr);
  if (t === "r") return df === 0 || dr === 0;
  if (t === "q") return df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr);
  if (t === "k") return Math.abs(df) <= 1 && Math.abs(dr) <= 1;
  return false;
}
// How a move heads for the target: "direct" | "progress" | "exchange" | "detour" | null (it doesn't)
function funKind(m, cur, tA, counts, tCounts) {
  if (m.promotion) return null;
  const from = sqIndex(m.from), to = sqIndex(m.to), pc = pieceChar(m);
  if (m.captured) { const vc = m.color === "w" ? m.captured : m.captured.toUpperCase(); if ((counts[vc] || 0) - 1 < (tCounts[vc] || 0)) return null; }
  if (cur[from] === tA[from]) return null;                       // already where the target has it
  if (tA[to] === pc) return "direct";
  const surplus = (counts[pc] || 0) > (tCounts[pc] || 0);
  if (m.captured && surplus) return "exchange";
  if (m.piece === "p") {
    if (!m.captured) { const f = to % 8, dir = m.color === "w" ? -8 : 8; for (let j = to + dir; j >= 0 && j < 64; j += dir) if (tA[j] === pc && cur[j] !== pc) return "progress"; }
    return surplus ? "detour" : null;
  }
  for (let j = 0; j < 64; j++) if (tA[j] === pc && cur[j] !== pc && oneMove(pc, to, j)) return "detour";
  return null;
}
// Squares a side still has to fill: a lower bound on the moves it needs
function funMissing(cur, tA, white) {
  let n = 0;
  for (let i = 0; i < 64; i++) { const t = tA[i]; if (t !== "." && (t === t.toUpperCase()) === white && cur[i] !== t) n++; }
  return n;
}

async function funSearch(targetFen, targetPly, color, onTick = () => {}) {
  const tok = ++FUN.tok, tA = boardArr(targetFen), tCounts = pieceCounts(tA), tSide = targetFen.split(" ")[1];
  const maxPly = targetPly + 2, min = funMin(), R = rep(color), memo = new Map();
  let partial = false;
  Object.assign(FUN, { running: true, fetched: 0, nodes: 0, note: "", done: 0, t0: Date.now() });
  const live = () => tok === FUN.tok;
  const myChar = color === "white" ? "w" : "b";
  /* v0.9.44: progress. Each call gets a share w of the whole search (the root 1), split evenly between
     the moves it goes on to try; whatever it doesn't hand on is counted done when it returns. Even
     splits make it rough (some branches are much bigger), but it only goes up and ends at 100%. */
  const rec = async (c, ply, detW, detB, reach, w) => {
    const box = { given: 0 };
    try { return await rec0(c, ply, detW, detB, reach, w, box); }
    finally { FUN.done += w - box.given; }
  };
  const rec0 = async (c, ply, detW, detB, reach, w, box) => {
    if (!live()) throw new Error("stale");
    if (++FUN.nodes % 150 === 0) { onTick(); await new Promise(r => setTimeout(r, 0)); }
    const fen = c.fen(), cur = boardArr(fen), side = fen.split(" ")[1];
    if (side === tSide && cur === tA) return { v: 1, end: true };
    if (ply >= maxPly) return { v: 0 };
    const left = maxPly - ply, wLeft = side === "w" ? Math.ceil(left / 2) : Math.floor(left / 2), bLeft = left - wLeft;
    if (funMissing(cur, tA, true) > wLeft + 1 || funMissing(cur, tA, false) > bLeft + 1) return { v: 0 };
    const mk = K(fen) + "|" + ply + "|" + detW + "|" + detB;
    // a result worked out with some lines cut short (too unlikely to matter there) is only
    // reused where the position is no more likely than it was then
    const hit = memo.get(mk);
    if (hit && (!hit.cut || reach <= hit.reach)) return hit;
    if (reach < FUN_REACH_MIN) return { v: 0, cut: true };
    const counts = pieceCounts(cur), white = side === "w", det = white ? detW : detB;
    const kinds = [];
    for (const m of c.moves({ verbose: true })) {
      const k = funKind(m, cur, tA, counts, tCounts);
      if (k && !(k === "detour" && det >= FUN_DETOURS)) kinds.push({ m, k });
    }
    const step = async (m, k, r, share) => {
      box.given += share;
      c.move(m.san);
      try { return await rec(c, ply + 1, detW + (white && k === "detour" ? 1 : 0), detB + (!white && k === "detour" ? 1 : 0), r, share); }
      finally { c.undo(); }
    };
    let out;
    if (side === myChar) {
      const n = R.pos[K(fen)];
      // which of my moves to try: where there's a real choice, what players at my level play here helps
      let ex = cachedExplorer(fen);
      if (!ex && kinds.length > FUN_TRY && FUN.fetched < FUN_FETCH_MAX && S.token && !explorerBlocked) { FUN.fetched++; onTick(); ex = await explorer(fen, { prio: PRIO.soon }); if (!live()) throw new Error("stale"); }
      const pop = san => { const mv = ex && ex.moves.find(x => x.san === san); return mv ? mv.n : 0; };
      // direct moves first, then pawn advances and exchanges, then a piece's stop on the way, then a
      // pawn that will be exchanged later; central squares before the edge
      const rank = x => (x.k === "direct" ? 0 : x.k === "detour" ? (x.m.piece === "p" ? 3 : 2) : 1);
      const central = x => { const s = sqIndex(x.m.to), f = s % 8, r = Math.floor(s / 8); return Math.abs(3.5 - f) + Math.abs(3.5 - r); };
      kinds.sort((a, b) => (n && n.m.includes(b.m.san) ? 1 : 0) - (n && n.m.includes(a.m.san) ? 1 : 0) || rank(a) - rank(b) || pop(b.m.san) - pop(a.m.san) || central(a) - central(b));
      const tried = [];
      let cut = false;
      const tryNow = kinds.slice(0, FUN_TRY);
      for (const { m, k } of tryNow) { const r = await step(m, k, reach, w / tryNow.length); if (r.cut) cut = true; tried.push({ san: m.san, v: r.v }); }
      let best = tried.reduce((a, x) => (x.v > a.v ? x : a), { v: 0 });
      // a move already in my tree stays unless another is clearly better
      const keep = n ? tried.filter(x => n.m.includes(x.san) && x.v > 0).sort((a, b) => b.v - a.v)[0] : null;
      if (keep && keep.v >= best.v * FUN_KEEP) best = keep;
      out = { v: best.v, move: best.san, mine: true, cut };
    } else {
      let ex = cachedExplorer(fen);
      if (!ex) {
        if (FUN.fetched < FUN_FETCH_MAX && S.token && !explorerBlocked) { FUN.fetched++; onTick(); ex = await explorer(fen, { prio: PRIO.soon }); if (!live()) throw new Error("stale"); }
        else partial = true;
      }
      let replies;
      if (ex && ex.total) replies = ex.moves.map(x => ({ san: x.san, f: x.n / ex.total })).filter(x => x.f >= min);
      else { const n = R.pos[K(fen)]; replies = n && n.m.length ? n.m.map(san => ({ san, f: 1 / n.m.length, guess: true })) : []; if (!ex) partial = true; }
      const res = [];
      let v = 0, cut = false;
      const goOn = replies.filter(rp => kinds.some(x => x.m.san === rp.san)).length;
      for (const rp of replies) {
        const hit = kinds.find(x => x.m.san === rp.san);
        if (!hit) { res.push({ ...rp, v: 0, off: true }); continue; }
        const r = await step(hit.m, hit.k, reach * rp.f, w / goOn);
        if (r.cut) cut = true;
        res.push({ ...rp, v: r.v });
        v += rp.f * r.v;
      }
      out = { v, replies: res, mine: false, cut };
    }
    out.reach = reach;
    memo.set(mk, out);
    return out;
  };
  try {
    const root = await rec(new Chess(), 0, 0, 0, 1, 1);
    // the plan: my chosen moves and the replies that lead on, with each line's chance
    const lines = [], exits = [], conflicts = [];
    const walkPlan = async (c, ply, detW, detB, path, p) => {
      const fen = c.fen(), cur = boardArr(fen);
      if (fen.split(" ")[1] === tSide && cur === tA) { lines.push({ moves: path.slice(), p }); return; }
      const node = memo.get(K(fen) + "|" + ply + "|" + detW + "|" + detB);
      if (!node || !node.v) return;
      const counts = pieceCounts(cur), white = fen.split(" ")[1] === "w";
      const kindOf = san => { const m = c.moves({ verbose: true }).find(x => x.san === san); return m ? funKind(m, cur, tA, counts, tCounts) : null; };
      const go = async (san, q) => { const k = kindOf(san); c.move(san); path.push(san); await walkPlan(c, ply + 1, detW + (white && k === "detour" ? 1 : 0), detB + (!white && k === "detour" ? 1 : 0), path, q); path.pop(); c.undo(); };
      if (node.mine) {
        const n = R.pos[K(fen)];
        if (n && n.m.length && !n.m.includes(node.move)) conflicts.push({ path: path.slice(), move: node.move, have: n.m.slice() });
        await go(node.move, p);
      } else {
        const on = node.replies.filter(r => r.v > 0), share = on.reduce((a, r) => a + r.f, 0);
        if (share < 0.999) exits.push({ path: path.slice(), off: 1 - share, reach: p, top: node.replies.filter(r => !r.v).slice(0, 2).map(r => r.san) });
        for (const r of on) await go(r.san, p * r.f);
      }
    };
    await walkPlan(new Chess(), 0, 0, 0, [], 1);
    lines.sort((a, b) => b.p - a.p);
    exits.sort((a, b) => b.off * b.reach - a.off * a.reach);
    return { v: root.v, lines, exits, conflicts, partial, fetched: FUN.fetched };
  } finally {
    if (live()) FUN.running = false;
  }
}

/* ----- the box on Build > My lines ----- */
function funnelBox() {
  const { fen, key, path } = buildState();
  if (path.length < 4) return "";
  const sig = funSig(key, S.color), res = FUN.sig === sig ? FUN.res : null;
  const mins = `<div class="seg small" role="group" aria-label="Opponent moves at least">${FUN_MINS.map(v => `<button type="button" data-funmin="${v}" aria-pressed="${v === funMin()}">${Math.round(v * 100)}%</button>`).join("")}</div>`;
  const head = `<p class="lbl">Routes from the start ${info("Finds the likely ways to get to this position from move 1, by any move order, and puts them together as one plan. Your moves only head for this position (a piece goes to its square here, a pawn the position doesn't have is exchanged, or a piece makes one stop on the way). The opponent's moves are the ones players at your level make at least the percentage chosen; anything else is them stepping off the route. The chance is how often you'd get here following the plan. The first time it looks up the opponent's moves on Lichess, about one a second.", "About routes from the start")}</p>
    <div class="row" style="margin:0 0 6px;gap:6px;align-items:center"><span class="help" style="margin:0">Opponent moves played at least</span>${mins}</div>`;
  if (FUN.running && FUN.sig === sig) return head + `<p class="help" aria-live="polite" id="funProg">${funProgText()}</p><progress id="funBar" max="100" value="${Math.round((FUN.done || 0) * 100)}"></progress><button type="button" class="btn ghost quick" data-funstop>Stop</button>`;
  if (!res) return head + (S.token ? `<button type="button" class="btn" data-funrun>Find routes into this position</button>` : `<p class="help">Add a Lichess token in Settings to look up the opponent's moves.</p>`) + (FUN.note ? `<p class="help">${esc(FUN.note)}</p>` : "");
  if (!res.v) return head + `<p class="help">No route gets here with opponent moves played at least ${Math.round(funMin() * 100)}% of the time${res.partial ? " (some positions had no Lichess data)" : ""}. Try a lower percentage.</p><button type="button" class="btn ghost quick" data-funrun>Search again</button>`;
  const lineHtml = l => `<li><span class="mono">${esc(numbered(0, l.moves))}</span><span class="conpct">${pctOf(l.p)}</span><button type="button" class="btn ghost quick" data-open="${esc(l.moves.join(" "))}">Show</button></li>`;
  const shown = res.lines.slice(0, FUN_LINES);
  return head + `<div class="funres">
      <p class="funbig"><b>${pctOf(res.v)}</b> <span class="help">of games reach this position if you follow the plan${res.partial ? " (some positions had no Lichess data yet, so it may be more)" : ""}</span></p>
      <ul class="funlines">${shown.map(lineHtml).join("")}</ul>
      ${res.lines.length > shown.length ? `<p class="help">…and ${res.lines.length - shown.length} more.</p>` : ""}
      ${res.exits.length ? `<p class="lbl" style="margin-top:6px">Where your opponent steps off</p><ul class="funlines">${res.exits.slice(0, 3).map(e => `<li><span><span class="mono">${esc(numbered(0, e.path) || "Start")}</span> <span class="help">${e.top.length ? esc(e.top.join(", ")) + (e.top.length > 1 ? "…" : "") : "other moves"}</span></span><span class="conpct">${pctOf(e.off)}</span></li>`).join("")}</ul>` : ""}
      ${res.conflicts.length ? `<p class="help"><b>Differs from your tree:</b> ${res.conflicts.map(x => `${esc(moveLabel(x.path, x.move))} where you play ${esc(x.have.join(" / "))}`).join("; ")}. Add makes ${res.conflicts.length === 1 ? "it" : "them"} another option.</p>` : ""}
      <div class="row conacts"><button type="button" class="btn quick" data-funadd>Add the plan to your tree</button><button type="button" class="btn ghost quick" data-funrun>Search again</button></div>
    </div>${undoNote("fun")}`;
}
// "Searching… about 35% done, roughly 2 min left. 140 of at most 220 Lichess look-ups…"
function funProgText() {
  const p = Math.min(0.99, FUN.done || 0), secs = (Date.now() - (FUN.t0 || Date.now())) / 1000;
  let eta = "";
  if (p >= 0.1 && secs > 5) { const s = (secs * (1 - p)) / p; eta = s < 60 ? ", under a minute left" : `, roughly ${Math.round(s / 60)} min left`; }
  return `Searching… about ${Math.round(p * 100)}% done${eta}. ${FUN.fetched} of at most ${FUN_FETCH_MAX} Lichess look-ups (about one a second; after that it only uses data already loaded).`;
}
function funRedraw() { if (S.view === "build" && S.ptab === "tree") { const b = $("#funBox"); if (b) b.innerHTML = funnelBox(); } }
async function funRun() {
  const { fen, key, path } = buildState(), color = S.color, sig = funSig(key, color);
  FUN.sig = sig; FUN.res = null;
  funRedraw();
  let last = 0;
  try {
    const res = await funSearch(fen, path.length, color, () => { const now = Date.now(); if (now - last > 400) { last = now; const p = $("#funProg"); if (p) p.textContent = funProgText(); const b = $("#funBar"); if (b) b.value = Math.round(FUN.done * 100); } });
    if (FUN.sig === sig) { FUN.res = res; FUN.note = ""; }
  } catch (e) {
    if (e.message !== "stale") { FUN.note = "Something went wrong: " + e.message; FUN.running = false; }
  }
  funRedraw();
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("funrun", () => { funRun(); }, true);
onClick("funstop", () => { FUN.tok++; FUN.running = false; FUN.sig = ""; FUN.note = "Stopped."; funRedraw(); }, true);
onClick("funmin", d => { S.settings.funMin = +d.funmin; Store.save("settings"); funRedraw(); });
onClick("funadd", () => {
  const res = FUN.res, color = S.color;
  if (!res) return;
  RepUndo.change("fun", color, () => {
    let added = 0;
    for (const l of res.lines) l.moves.forEach((m, i) => { if (addMove(l.moves.slice(0, i), m, color) !== "same") added++; });
    if (!added) return "";
    walk(color);
    return `Added ${added} move${added === 1 ? "" : "s"} on ${res.lines.length} route${res.lines.length === 1 ? "" : "s"}`;
  });
  FUN.sig = ""; FUN.res = null;
  renderBuild();
});
