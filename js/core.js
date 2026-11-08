"use strict";
/* Constants, helpers and app state. Loaded first; every other script uses these globals. */
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const DAY = 86400000;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Position key: board, side to move, castling, en passant. chess.js 0.10 sets the en-passant
// square after every double pawn push, which would split transpositions, so it is kept only
// when a pawn of the side to move stands next to the pushed pawn (pins are ignored).
function epCapturable(board, side, ep) {
  if (!ep || ep === "-") return false;
  const rows = board.split("/").map(r => r.replace(/\d/g, d => ".".repeat(+d)));
  const file = ep.charCodeAt(0) - 97;
  const rank = side === "w" ? 5 : 4; // rank the capturing pawn stands on
  const row = rows[8 - rank] || "";
  const pawn = side === "w" ? "P" : "p";
  return row[file - 1] === pawn || row[file + 1] === pawn;
}
const K = fen => {
  const [b, s, c, e] = fen.split(" ");
  return [b, s, c, epCapturable(b, s, e) ? e : "-"].join(" ");
};
const sideOf = key => key.split(" ")[1];
const myChar = color => (color === "white" ? "w" : "b");
const isMine = (key, color) => sideOf(key) === myChar(color);
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }
function fenAfter(fen, sans) { const c = new Chess(fen); for (const s of sans) { if (!c.move(s, { sloppy: true })) return null; } return c.fen(); }

/* ---------- state ---------- */
const S = {
  color: "white",
  // Prep books: id -> {white, black}. S.rep points at the open book (S.book); see store.js
  books: { main: { white: { pos: {}, cards: {}, flagged: [] }, black: { pos: {}, cards: {}, flagged: [] } } },
  book: "main",
  rep: null,
  settings: { user: "", band: [1600, 1800], months: 3 },
  token: lsGet("pb_token", ""),
  games: [],
  acc: {},
  puzzles: { map: {} }, // mistake review: puzzle id -> {st, c, n, ok} (puzzles.js)
  view: "build",
  build: { white: [], black: [] }, // current path per colour
  storeMode: "local",
};
S.rep = S.books.main;
let EXPL = lsGet("pb_expl", {}); // key|band -> explorer data
let EVALC = lsGet("pb_eval", {}); // key -> {cp, best}
// "5. Nf3" or "5… Nc6" for a move played after `path`
function moveLabel(path, san) {
  const n = Math.floor(path.length / 2) + 1;
  return path.length % 2 === 0 ? `${n}. ${san}` : `${n}… ${san}`;
}
// Moves with move numbers, starting at ply `ply` (0 = White's first move): "4… Qg5 5. Nxf7 Qxg2"
function numbered(ply, sans) {
  return sans.map((s, i) => { const p = ply + i, n = Math.floor(p / 2) + 1; return p % 2 === 0 ? `${n}. ${s}` : i === 0 ? `${n}… ${s}` : s; }).join(" ");
}
