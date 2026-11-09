"use strict";
/* The board: piece sets and board looks, arrows, piece animation, and Board() (tap or drag).
   Classic script: shares one global scope with the others (see index.html for the load order). */
let BB, TB; // the Build and Train boards (created in boot())
const reduceMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

/* ---------- board look: piece sets and board themes (saved in settings) ---------- */
// SVG sets live in pieces/<id>/{w,b}{K,Q,R,B,N,P}.svg. Licences: pieces/README.md.
const PIECE_SETS = [
  { id: "cburnett", name: "Cburnett", credit: "Colin M.L. Burnett · GPLv2+" },
  { id: "merida", name: "Merida", credit: "Armando Hernandez Marroquin · GPLv2+" },
  { id: "chessnut", name: "Chessnut", credit: "Alexis Luengas · Apache 2.0" },
  { id: "fantasy", name: "Fantasy", credit: "Maurizio Monge · MIT" },
  { id: "celtic", name: "Celtic", credit: "Maurizio Monge · MIT" },
  { id: "spatial", name: "Spatial", credit: "Maurizio Monge · MIT" },
  { id: "rhosgfx", name: "RhosGFX", credit: "RhosGFX · CC0" },
  { id: "unicode", name: "Unicode", credit: "Noto Sans Symbols 2 font · OFL" },
];
// Colours are set in css/app.css under :root[data-board=…]; wood and marble add generated textures
const BOARD_THEMES = [
  { id: "soft", name: "Soft blue" }, { id: "green", name: "Tournament green" }, { id: "brown", name: "Brown" }, { id: "blue", name: "Blue" },
  { id: "grey", name: "Grey" }, { id: "wood", name: "Wood" }, { id: "marble", name: "Marble" },
];
let pieceFallback = false; // set if an SVG fails to load: use the Unicode pieces for this session
const pieceSet = () => (pieceFallback ? "unicode" : S.settings.pieces || "cburnett");
const pieceSrc = (set, color, type) => `pieces/${set}/${color}${type.toUpperCase()}.svg`;
function pieceHtml(p, set = pieceSet()) {
  if (set === "unicode") return `<span class="pc ${p.color === "w" ? "pw" : "pb"}">${GLYPH[p.type]}︎</span>`;
  return `<img class="pc pimg" src="${pieceSrc(set, p.color, p.type)}" alt="" draggable="false">`;
}
function applyLook() {
  const t = S.settings.board || "soft"; // the soft blue default lives in :root
  if (t === "soft") delete document.documentElement.dataset.board; else document.documentElement.dataset.board = t;
  // Appearance: light (default), dark, or match the phone ("system")
  const th = ["light", "dark", "system"].includes(S.settings.theme) ? S.settings.theme : "light";
  document.documentElement.dataset.theme = th; lsSet("pb_theme", th);
  const meta = document.querySelector("meta[name=theme-color]"); // the phone's status bar follows the page
  if (meta) meta.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#F5F7FA");
}
function redrawBoards() { applyLook(); if (BB) BB.draw(); if (TB) TB.draw(); }

/* ---------- move arrows ---------- */
// arrows: [{from, to, w (0..1, thickness), kind}] where kind is "mine" (in my repertoire),
// "gap" (opponent move I haven't prepared), "gem" (hidden gem / scores better) or "other"
function arrowsSvg(arrows, flip) {
  if (!arrows || !arrows.length) return "";
  const xy = sq => { const f = sq.charCodeAt(0) - 97, r = +sq[1]; return [(flip ? 7 - f : f) + 0.5, (flip ? r - 1 : 8 - r) + 0.5]; };
  const body = arrows.slice().sort((a, b) => (a.kind === "games") - (b.kind === "games") || a.w - b.w).map(a => {
    const [x1, y1] = xy(a.from), [x2, y2] = xy(a.to);
    const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const thin = a.kind === "games", sw = thin ? 0.075 : 0.07 + 0.23 * a.w, head = thin ? 0.26 : 0.22 + 0.2 * a.w;
    const ex = x2 - ux * head, ey = y2 - uy * head; // shaft stops where the head starts
    const px = -uy * head * 0.75, py = ux * head * 0.75;
    return `<g class="arw ${a.kind}"><line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke-width="${sw}"/><polygon points="${x2},${y2} ${ex + px},${ey + py} ${ex - px},${ey - py}"/></g>`;
  }).join("");
  return `<svg class="arrows" viewBox="0 0 8 8" aria-hidden="true">${body}</svg>`;
}

/* ---------- piece animation ---------- */
// When the board goes from one position to the next by a single move (forwards, or back one
// move), slide the moved piece (and the rook when castling) instead of jumping.
const SLIDE_MS = 180;
function slideFor(oldFen, oldLast, newFen, newLast) {
  if (!oldFen || oldFen === newFen || reduceMotion()) return null;
  const rook = mv => (mv.flags.includes("k") ? ["h", "f"] : mv.flags.includes("q") ? ["a", "d"] : null);
  const withRook = (mv, rev) => {
    const out = [rev ? { from: mv.to, to: mv.from } : { from: mv.from, to: mv.to }];
    const r = rook(mv);
    if (r) { const rank = mv.from[1]; out.push(rev ? { from: r[1] + rank, to: r[0] + rank } : { from: r[0] + rank, to: r[1] + rank }); }
    return out;
  };
  if (newLast) { // forwards: the new last move, played from the old position
    const c = new Chess(oldFen), mv = c.move({ from: newLast[0], to: newLast[1], promotion: "q" });
    if (mv && K(c.fen()) === K(newFen)) return withRook(mv, false);
  }
  if (oldLast) { // back one move: the old last move, played from the new position, gives the old one
    const c = new Chess(newFen), mv = c.move({ from: oldLast[0], to: oldLast[1], promotion: "q" });
    if (mv && K(c.fen()) === K(oldFen)) return withRook(mv, true);
  }
  return null;
}
// FLIP: draw the piece at its new square, offset it back to where it came from, then let it go
function slidePieces(el, moves, flip) {
  const size = el.clientWidth / 8;
  if (!size) return;
  const cr = sq => { const f = sq.charCodeAt(0) - 97, r = +sq[1]; return [flip ? 7 - f : f, flip ? r - 1 : 8 - r]; };
  for (const { from, to } of moves) {
    const pc = el.querySelector(`[data-sq="${to}"] .pc`);
    if (!pc) continue;
    const [fc, fr] = cr(from), [tc, tr] = cr(to);
    pc.style.transition = "none";
    pc.style.transform = `translate(${(fc - tc) * size}px, ${(fr - tr) * size}px)`;
    pc.classList.add("moving");
    pc.getBoundingClientRect(); // apply the offset before animating
    pc.style.transition = `transform ${SLIDE_MS}ms ease-out`;
    pc.style.transform = "";
    setTimeout(() => pc.classList.remove("moving"), SLIDE_MS + 20);
  }
}

/* ---------- board ---------- */
const GLYPH ={ k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
// Moves by tapping (piece, then square) or by dragging a piece. The board only redraws when
// something it shows has changed, and keeps a selected piece across redraws of the same
// position, so results arriving in the background never undo a half-made move. A redraw asked
// for while a piece is being dragged waits until the drag ends.
function Board(el) {
  const b = { el, fen: START, flip: false, sel: null, last: null, hint: null, bad: null, onMove: null, locked: false, arrows: [], drag: null, pending: null };
  const sig = () => JSON.stringify([b.fen, b.flip, b.last, b.hint, b.bad, b.arrows]);
  let drawn = "";
  b.set = (fen, opts = {}) => {
    if (b.drag) { b.pending = [fen, opts]; return; }
    const oldFen = b.fen, oldLast = b.last, same = fen === oldFen;
    b.fen = fen;
    if (!same) b.sel = null;
    Object.assign(b, { last: null, hint: null, bad: null, arrows: [] }, opts);
    if (b.sel) { const p = new Chess(fen).get(b.sel); if (!p || p.color !== fen.split(" ")[1]) b.sel = null; }
    b.anim = opts.animate === false || b.noSlide ? null : slideFor(oldFen, oldLast, fen, b.last);
    b.noSlide = false;
    if (!b.anim && same && sig() === drawn) return; // nothing to change
    b.draw();
    b.anim = null;
  };
  // Just the arrows (move rows filling in): no need to rebuild the squares
  b.setArrows = arrows => {
    b.arrows = arrows || [];
    if (b.drag) return;
    const old = el.querySelector("svg.arrows");
    if (old) old.remove();
    el.insertAdjacentHTML("beforeend", arrowsSvg(b.arrows, b.flip));
    drawn = sig();
  };
  b.draw = () => {
    const c = new Chess(b.fen);
    const targets = b.sel ? c.moves({ square: b.sel, verbose: true }).map(m => m.to) : [];
    const files = "abcdefgh";
    let html = "";
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const file = b.flip ? 7 - f : f, rank = b.flip ? r + 1 : 8 - r;
      const sq = files[file] + rank;
      const p = c.get(sq);
      const dark = (file + rank) % 2 === 1 ? "" : " dk";
      const cls = ["sq" + dark];
      if (b.last && (b.last[0] === sq || b.last[1] === sq)) cls.push("last");
      if (b.hint && (b.hint[0] === sq || b.hint[1] === sq)) cls.push("hint");
      if (b.bad && (b.bad[0] === sq || b.bad[1] === sq)) cls.push("bad");
      if (b.sel === sq) cls.push("sel");
      if (p && p.color === c.turn() && !b.locked) cls.push("own"); // can be dragged: touch-action in the CSS
      if (p && p.type === "k" && c.in_check() && p.color === c.turn()) cls.push("check");
      const dot = targets.includes(sq) ? (p ? '<i class="cap"></i>' : '<i class="dot"></i>') : "";
      const coordF = r === 7 ? `<span class="cf">${files[file]}</span>` : "";
      const coordR = f === 0 ? `<span class="cr">${rank}</span>` : "";
      const pc = p ? pieceHtml(p) : "";
      // --f/--r place this square's slice of a board-wide texture (wood, marble)
      html += `<button type="button" class="${cls.join(" ")}" style="--f:${f};--r:${r}" data-sq="${sq}" aria-label="${sq}${p ? " " + (p.color === "w" ? "white " : "black ") + p.type : ""}">${pc}${dot}${coordF}${coordR}</button>`;
    }
    el.innerHTML = html + arrowsSvg(b.arrows, b.flip);
    drawn = sig();
    if (b.anim) slidePieces(el, b.anim, b.flip);
  };
  // Play a move from one square to another if it's legal; returns true if it was
  const tryMove = (from, to) => {
    const c = new Chess(b.fen), mv = c.moves({ square: from, verbose: true }).find(m => m.to === to);
    if (!mv) return false;
    b.sel = null; b.draw();
    const res = c.move({ from, to, promotion: "q" });
    if (b.onMove) b.onMove(res, from, to);
    return true;
  };
  const sqAt = (x, y) => { const t = document.elementFromPoint(x, y); const s = t && t.closest && t.closest("[data-sq]"); return s && el.contains(s) ? s.dataset.sq : null; };
  /* ----- drag and drop (pointer events: mouse, touch and pen alike) -----
     Press on one of the side to move's pieces and move a few pixels to start dragging. Pieces
     have touch-action: none (CSS), so dragging a piece doesn't scroll the page; swiping on an
     empty square still does. A press without movement is left to the click handler (tap-to-move). */
  const DRAG_PX = 6;
  let press = null, swallowClick = false;
  el.addEventListener("pointerdown", e => {
    if (b.locked || (e.pointerType === "mouse" && e.button !== 0)) return;
    const t = e.target.closest("[data-sq]");
    if (!t) return;
    const p = new Chess(b.fen).get(t.dataset.sq);
    if (!p || p.color !== b.fen.split(" ")[1]) return;
    press = { sq: t.dataset.sq, x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  el.addEventListener("pointermove", e => {
    if (!press || e.pointerId !== press.id) return;
    if (!b.drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_PX) return;
      const pc = el.querySelector(`[data-sq="${press.sq}"] .pc`);
      if (!pc || b.locked) { press = null; return; }
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      b.sel = press.sq; b.draw(); // show the targets
      const src = el.querySelector(`[data-sq="${press.sq}"]`), size = src.getBoundingClientRect().width;
      const ghost = el.querySelector(`[data-sq="${press.sq}"] .pc`).cloneNode(true);
      ghost.classList.add("ghost");
      Object.assign(ghost.style, { width: size + "px", height: size + "px", fontSize: (size * 0.8) + "px" });
      document.body.append(ghost);
      el.querySelector(`[data-sq="${press.sq}"]`).classList.add("dragfrom");
      b.drag = { from: press.sq, ghost, size, over: null };
    }
    e.preventDefault();
    const d = b.drag;
    d.ghost.style.transform = `translate(${e.clientX - d.size / 2}px, ${e.clientY - d.size / 2}px)`;
    const over = sqAt(e.clientX, e.clientY);
    if (over !== d.over) {
      if (d.over) { const o = el.querySelector(`[data-sq="${d.over}"]`); if (o) o.classList.remove("dragover"); }
      d.over = over;
      if (over) { const o = el.querySelector(`[data-sq="${over}"]`); if (o) o.classList.add("dragover"); }
    }
  });
  const endDrag = (e, cancel) => {
    if (!press || (e && e.pointerId !== press.id)) return;
    press = null;
    const d = b.drag;
    if (!d) return;
    b.drag = null;
    d.ghost.remove();
    swallowClick = true; setTimeout(() => (swallowClick = false), 0); // the click that follows the drop
    const to = cancel || !e ? null : sqAt(e.clientX, e.clientY);
    const pend = b.pending; b.pending = null;
    if (pend) { b.sel = null; b.set(pend[0], pend[1]); return; } // the position changed meanwhile
    // the piece is already where it was dropped, so the redraw that follows shouldn't slide it there
    if (to && to !== d.from && !b.locked) { b.noSlide = true; const moved = tryMove(d.from, to); setTimeout(() => (b.noSlide = false), 0); if (moved) return; }
    b.sel = to === d.from ? d.from : null; // dropped back where it started: keep it selected
    b.draw();
  };
  el.addEventListener("pointerup", e => endDrag(e, false));
  el.addEventListener("pointercancel", e => endDrag(e, true));
  el.addEventListener("lostpointercapture", e => { if (b.drag) endDrag(e, true); });
  // A missing piece image falls back to the Unicode pieces
  el.addEventListener("error", e => {
    if (!e.target.classList || !e.target.classList.contains("pimg") || pieceFallback) return;
    pieceFallback = true; toast("Couldn't load the piece images, so the plain pieces are shown instead."); redrawBoards();
  }, true);
  el.addEventListener("click", e => {
    const t = e.target.closest("[data-sq]");
    if (!t || b.locked || swallowClick || b.drag) return;
    const sq = t.dataset.sq, c = new Chess(b.fen);
    if (b.sel && tryMove(b.sel, sq)) return;
    const p = c.get(sq);
    b.sel = p && p.color === c.turn() && b.sel !== sq ? sq : null;
    b.draw();
  });
  return b;
}

