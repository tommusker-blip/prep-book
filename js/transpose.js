"use strict";
/* ---------- routes into a position from my other lines (v0.9.24) ----------
   On a position I like in Build (often one I reached in Explore), list the ways my existing
   repertoire could get there by another move order: a position in my tree from which a few
   moves (up to TR_PLIES) reach this exact position.
   Cheap enough to run live:
   - only tree positions with the right side to move, at most TR_PLIES behind, with every
     piece of this position still available (nothing to "uncapture"), and few squares different
     (each move changes at most 2 squares, castling 4) are searched;
   - the search only tries moves that put a piece on the square it has in this position, from a
     square where it doesn't (so a piece moves at most once). Routes where a piece moves twice
     (Nb1-d2-f3) are missed; that's the price of being quick.
   Results are memoised by position and tree, and worked out after the rows are drawn.
   Routes that are already all in my tree, and the line on the board itself, are left out.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const TR_PLIES = 4, TR_SHOW = 4;
const trMemo = new Map();
// "rnbqkbnr/pppp..." -> 64 characters, "." for an empty square
function boardArr(fen) {
  return fen.split(" ")[0].split("/").map(r => r.replace(/\d/g, d => ".".repeat(+d))).join("");
}
const sqIndex = sq => (8 - +sq[1]) * 8 + (sq.charCodeAt(0) - 97);
const pieceChar = m => (m.color === "w" ? (m.promotion || m.piece).toUpperCase() : (m.promotion || m.piece));
function pieceCounts(arr) { const c = {}; for (const ch of arr) if (ch !== ".") c[ch] = (c[ch] || 0) + 1; return c; }
// Routes from one position (fen) to the target in exactly k plies; [] if none
function routesTo(fen, target, tKey, k) {
  const out = [], c = new Chess(fen), seq = [];
  const dfs = depth => {
    if (out.length >= 2) return;
    if (depth === k) { if (K(c.fen()) === tKey) out.push(seq.slice()); return; }
    const cur = boardArr(c.fen());
    for (const m of c.moves({ verbose: true })) {
      const from = sqIndex(m.from), to = sqIndex(m.to);
      if (cur[from] === target[from]) continue;         // already right there: leave it
      if (target[to] !== pieceChar(m)) continue;         // must land where it stands in the target
      c.move(m); seq.push(m.san);
      dfs(depth + 1);
      seq.pop(); c.undo();
    }
  };
  dfs(0);
  return out;
}
// Is every move of the route already saved from that position?
function routeSaved(path, moves, color) {
  const R = rep(color);
  for (let i = 0; i < moves.length; i++) {
    const n = R.pos[K(fenAfter(START, path.concat(moves.slice(0, i))))];
    if (!n || !n.m.includes(moves[i])) return false;
  }
  return true;
}
function findRoutesInto(fen, path, color = S.color) {
  const tKey = K(fen), w = walk(color), memoKey = tKey + "|" + color + "|" + S.book + "|" + w.sig;
  if (trMemo.has(memoKey)) return trMemo.get(memoKey);
  const target = boardArr(fen), tCount = pieceCounts(target), turn = fen.split(" ")[1];
  const here = path.join(" "), idx = indexTree(color), out = [];
  for (const [key, node] of Object.entries(w.nodes)) {
    if (key === tKey) continue;
    const ps = node.path.join(" ");
    if (here === ps || here.startsWith(ps + " ") || !ps) continue; // the line on the board (and the start) lead here anyway
    const arr = boardArr(node.fen), qTurn = node.fen.split(" ")[1];
    let diff = 0;
    for (let i = 0; i < 64; i++) if (arr[i] !== target[i]) diff++;
    if (!diff || diff > 2 * TR_PLIES + 2) continue;
    const qCount = pieceCounts(arr);
    if (Object.entries(tCount).some(([p, n]) => (qCount[p] || 0) < n && p.toLowerCase() !== "q")) continue; // nothing comes back once taken
    for (let k = qTurn === turn ? 2 : 1; k <= TR_PLIES; k += 2) {
      if (diff > 2 * k + 2) continue;
      const r = routesTo(node.fen, target, tKey, k)[0];
      // a route whose first move is already saved from here is the same as one found further along it
      if (r) { const n0 = rep(color).pos[key]; if (!(n0 && n0.m.includes(r[0])) && !routeSaved(node.path, r, color)) out.push({ path: node.path, moves: r, k, reach: idx[key] ? idx[key].reach : 0 }); break; }
    }
  }
  out.sort((a, b) => a.k - b.k || b.reach - a.reach || a.path.length - b.path.length);
  const res = out.slice(0, TR_SHOW);
  if (trMemo.size > 200) trMemo.clear();
  trMemo.set(memoKey, res);
  return res;
}
// The box in Build's Moves tab. Worked out after the rows are on screen (pending: null).
const trPending = new Set();
function routesBox(fen, key, path) {
  if (!path.length) return "";
  const w = walk(S.color), memoKey = key + "|" + S.color + "|" + S.book + "|" + w.sig;
  if (!trMemo.has(memoKey)) {
    if (!trPending.has(memoKey)) {
      trPending.add(memoKey);
      setTimeout(() => { trPending.delete(memoKey); if (notHere(key)()) return; if (findRoutesInto(fen, path).length) rowsChanged(key); }, 30);
    }
    return undoNote("tr");
  }
  const list = trMemo.get(memoKey);
  if (!list.length) return undoNote("tr");
  const routeText = r => `<span class="mono">${esc(numbered(0, r.path))}</span> → <b class="mono">${esc(numbered(r.path.length, r.moves))}</b>`;
  return `<div class="trbox"><p class="lbl">Reach this from your other lines ${info("Positions already in your repertoire from which a few moves lead here, by another move order. Add puts those moves into your tree, so this position joins those lines (a move of yours that differs from your move there is added as another option). Routes where a piece moves twice aren't found.", "About these routes")}</p>
    <ul class="trlist">${list.map((r, i) => {
      const o = openingFor(r.path);
      return `<li><span>${o ? `<span class="muted">${esc(o.name)}:</span> ` : ""}${routeText(r)}</span><span class="row" style="margin:0"><button type="button" class="btn ghost quick" data-trgo="${i}">Show</button><button type="button" class="btn ghost quick" data-tradd="${i}">Add</button></span></li>`;
    }).join("")}</ul>${undoNote("tr")}</div>`;
}
function currentRoutes() {
  const { fen, key, path } = buildState(), memoKey = key + "|" + S.color + "|" + S.book + "|" + walk(S.color).sig;
  return trMemo.get(memoKey) || findRoutesInto(fen, path);
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("trgo", d => { const r = currentRoutes()[+d.trgo]; if (r) { S.build[S.color] = r.path.concat(r.moves); renderBuild(); } });
onClick("tradd", d => {
  const r = currentRoutes()[+d.tradd], color = S.color;
  if (!r) return;
  RepUndo.change("tr", color, () => {
    let added = 0;
    r.moves.forEach((m, i) => { if (addMove(r.path.concat(r.moves.slice(0, i)), m, color) !== "same") added++; });
    if (!added) return "";
    walk(color);
    return `Added ${numbered(r.path.length, r.moves)} after ${numbered(0, r.path)}`;
  });
  renderBuild();
});
