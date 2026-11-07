"use strict";
/* ---------- repertoire model, PGN parsing, game analysis, scheduler (pure logic, no DOM) ---------- */
/* ---------- repertoire model ---------- */
function rep(color = S.color) { return S.rep[color]; }
function node(key, color = S.color) { const p = rep(color).pos; return p[key] || (p[key] = { m: [] }); }
function newCard() { return { due: Date.now(), iv: 0, ef: 2.5, reps: 0, lapses: 0, flag: 0, seen: 0 }; }

// Walk the tree from the start; fix paths, drop unreachable positions and stale cards.
function walk(color = S.color) {
  const R = rep(color), seen = {}, order = [];
  const q = [[START, []]];
  while (q.length) {
    const [fen, path] = q.shift();
    const key = K(fen);
    if (seen[key]) continue;
    seen[key] = path;
    order.push(key);
    const n = R.pos[key];
    if (!n) continue;
    n.path = path.join(" ");
    const c = new Chess(fen);
    n.m = n.m.filter(m => { const mv = c.move(m); if (mv) { c.undo(); return true; } return false; });
    for (const m of n.m) { const cc = new Chess(fen); cc.move(m); q.push([cc.fen(), path.concat(m)]); }
  }
  for (const k of Object.keys(R.pos)) if (!(k in seen)) delete R.pos[k];
  for (const k of Object.keys(R.cards)) {
    const n = R.pos[k];
    if (!n || !n.m.length || !isMine(k, color)) delete R.cards[k];
  }
  for (const k of order) {
    const n = R.pos[k];
    if (n && n.m.length && isMine(k, color) && !R.cards[k]) R.cards[k] = newCard();
  }
  return { seen, order };
}

// Add a move at the position after `path`. On my turn a position can hold several moves
// (e.g. both 1.e4 and 1.d4); any of them counts as correct in training. Pass `replaces` to
// swap one of my moves for another instead: that move's card starts again, and walk()
// prunes the old move's line if nothing else reaches it.
function addMove(path, san, color = S.color, replaces = null) {
  const fen = fenAfter(START, path);
  const key = K(fen);
  const n = node(key, color);
  if (n.m.includes(san)) return "same";
  const i = replaces != null && isMine(key, color) ? n.m.indexOf(replaces) : -1;
  if (i >= 0) {
    n.m[i] = san;
    rep(color).cards[key] = newCard();
    return "replaced";
  }
  n.m.push(san);
  return "added";
}
function removeMove(path, san, color = S.color) {
  const key = K(fenAfter(START, path));
  const n = rep(color).pos[key];
  if (!n) return;
  n.m = n.m.filter(x => x !== san);
  walk(color);
}

/* ---------- PGN parsing ---------- */
function splitGames(text) {
  const t = text.replace(/\r/g, "");
  const parts = t.split(/\n(?=\[Event\s)/);
  return parts.map(p => p.trim()).filter(Boolean);
}
function parseHeaders(g) {
  const h = {};
  g.replace(/^\[(\w+)\s+"([^"]*)"\]/gm, (_, k, v) => { h[k] = v; return ""; });
  return h;
}
function movetext(g) {
  return g.replace(/^\[.*\]\s*$/gm, " ").replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ");
}
function tokens(mt) { return mt.match(/\(|\)|[^\s()]+/g) || []; }
function cleanTok(t) {
  if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) return null;
  if (/^\$\d+$/.test(t)) return null;
  t = t.replace(/^\d+\.(\.\.)?/, "").replace(/[!?]+$/, "");
  return t || null;
}
// Main line only (for games)
function mainline(g) {
  const out = []; let depth = 0;
  for (const raw of tokens(movetext(g))) {
    if (raw === "(") { depth++; continue; }
    if (raw === ")") { depth--; continue; }
    if (depth) continue;
    const t = cleanTok(raw);
    if (t) out.push(t);
  }
  return out;
}
// Full tree with variations (for repertoire import). Calls onMove(fenBefore, san).
function walkPGNTree(g, onMove) {
  let ch = new Chess(), prev = ch.fen(); const stack = []; let bad = 0;
  for (const raw of tokens(movetext(g))) {
    if (raw === "(") { stack.push({ fen: ch.fen(), prev }); ch = new Chess(prev); continue; }
    if (raw === ")") { const s = stack.pop(); if (s) { ch = new Chess(s.fen); prev = s.prev; } continue; }
    const t = cleanTok(raw);
    if (!t) continue;
    const before = ch.fen();
    const mv = ch.move(t, { sloppy: true });
    if (!mv) { bad++; continue; }
    prev = before;
    onMove(before, mv.san);
  }
  return bad;
}

function timeClass(tc) {
  if (!tc || tc === "-") return "unknown";
  if (tc.includes("/")) return "daily";
  const [b, i] = tc.split("+").map(Number);
  const est = (b || 0) + 40 * (i || 0);
  if (est < 180) return "bullet";
  if (est < 600) return "blitz";
  return "rapid";
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

function gameFromPGN(g, user, tcHint) {
  const h = parseHeaders(g);
  const tc = tcHint || timeClass(h.TimeControl);
  const moves = mainline(g);
  // validate moves, keep SAN normalised
  const c = new Chess(); const sans = [];
  for (const m of moves) { const mv = c.move(m, { sloppy: true }); if (!mv) break; sans.push(mv.san); }
  const u = (user || "").toLowerCase();
  let my = null;
  if ((h.White || "").toLowerCase() === u) my = "white";
  else if ((h.Black || "").toLowerCase() === u) my = "black";
  const id = h.Link ? hashStr(h.Link) : hashStr((h.White || "") + (h.Black || "") + (h.Date || "") + (h.UTCTime || h.EndTime || "") + sans.slice(0, 30).join(""));
  return {
    id, my, tc, url: h.Link || "", date: (h.UTCDate || h.Date || "").replace(/\./g, "-"),
    white: h.White || "?", black: h.Black || "?", welo: +h.WhiteElo || 0, belo: +h.BlackElo || 0,
    result: h.Result || "*", moves: sans.join(" "),
  };
}
function myScore(g) {
  if (g.result === "1/2-1/2") return 0.5;
  if (g.result === "1-0") return g.my === "white" ? 1 : 0;
  if (g.result === "0-1") return g.my === "black" ? 1 : 0;
  return null;
}
function addGames(list) {
  const have = new Set(S.games.map(g => g.id));
  let n = 0;
  for (const g of list) if (g.my && g.tc === "rapid" && !have.has(g.id)) { S.games.push(g); have.add(g.id); n++; }
  S.games.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  Store.save("games");
  return n;
}

/* ---------- game analysis against the repertoire ---------- */
function analyseGame(g) {
  const color = g.my, R = rep(color);
  const moves = g.moves ? g.moves.split(" ") : [];
  const c = new Chess();
  for (let i = 0; i < moves.length; i++) {
    const key = K(c.fen()); const n = R.pos[key]; const played = moves[i];
    const mine = isMine(key, color);
    const path = moves.slice(0, i);
    if (mine) {
      if (!n || !n.m.length) return { type: "you_new", ply: i, key, played, path };
      if (!n.m.includes(played)) return { type: "misplay", ply: i, key, played, expected: n.m.join(" / "), path };
    } else {
      if (!n || !n.m.length) return { type: "end", ply: i, key, played, path };
      if (!n.m.includes(played)) return { type: "opp_new", ply: i, key, played, path };
    }
    c.move(played);
  }
  return { type: "full", ply: moves.length, key: K(c.fen()), path: moves };
}
function analysis(color = S.color) {
  return S.games.filter(g => g.my === color).map(g => ({ g, a: analyseGame(g), s: myScore(g) }));
}
// Opponent replies seen in games at positions inside the tree: key -> san -> count
function oppSeen(color = S.color) {
  const out = {};
  for (const { a } of analysis(color)) {
    if (a.type === "opp_new" || a.type === "end") {
      (out[a.key] = out[a.key] || {})[a.played] = (out[a.key][a.played] || 0) + 1;
    }
  }
  return out;
}

/* ---------- training scheduler (SM-2 style) ---------- */
function grade(card, ok) {
  const now = Date.now();
  card.seen++;
  if (ok) {
    card.reps++;
    card.iv = card.reps === 1 ? 1 : card.reps === 2 ? 3 : Math.round(card.iv * card.ef);
    card.ef = Math.min(3, card.ef + 0.1);
    card.due = now + card.iv * DAY;
    if (card.flag) card.flag = Math.max(0, card.flag - 1);
  } else {
    card.reps = 0; card.lapses++; card.iv = 0;
    card.ef = Math.max(1.3, card.ef - 0.2);
    card.due = now + 10 * 60000;
  }
}
function flagMisplays(color = S.color) {
  // Each misplay in a game counts once; flagged cards come first in training.
  // The list of games already counted lives in the repertoire doc so it syncs between devices.
  // Older builds kept it in localStorage; read that once as a migration.
  const R = rep(color);
  if (!R.flagged) R.flagged = lsGet("pb_flagged_" + color, []);
  const done = new Set(R.flagged), before = done.size;
  let n = 0;
  for (const { g, a } of analysis(color)) {
    if (a.type !== "misplay" || done.has(g.id)) continue;
    const card = R.cards[a.key];
    if (card) { card.flag = Math.min(3, (card.flag || 0) + 2); card.due = Math.min(card.due, Date.now()); n++; }
    done.add(g.id);
  }
  R.flagged = [...done];
  if (done.size !== before) Store.save(repDoc(color));
  return n;
}
function dueCards(color = S.color) {
  const R = rep(color), now = Date.now();
  return Object.entries(R.cards)
    .filter(([k, c]) => R.pos[k] && R.pos[k].m.length && (c.due <= now || c.flag))
    .sort((a, b) => (b[1].flag || 0) - (a[1].flag || 0) || a[1].due - b[1].due)
    .map(([k]) => k);
}

/* ---------- repertoire PGN export / import ---------- */
function exportPGN(color) {
  walk(color);
  const R = rep(color), seen = new Set();
  const num = (fen, force) => { const p = fen.split(" "); return p[1] === "w" ? p[5] + ". " : force ? p[5] + "... " : ""; };
  function line(fen, force) {
    const key = K(fen);
    if (seen.has(key)) return "";
    seen.add(key);
    const n = R.pos[key];
    if (!n || !n.m.length) return "";
    const [m0, ...alts] = n.m;
    const vars = alts.map(m => { const c = new Chess(fen); c.move(m); const rest = line(c.fen(), false); return `(${num(fen, true)}${m}${rest ? " " + rest : ""})`; });
    const c0 = new Chess(fen); c0.move(m0);
    const rest = line(c0.fen(), vars.length > 0);
    return [num(fen, force) + m0, ...vars, rest].filter(Boolean).join(" ");
  }
  const body = line(START, true);
  return `[Event "Prep Book repertoire"]\n[White "${color === "white" ? "Me" : "?"}"]\n[Black "${color === "black" ? "Me" : "?"}"]\n[Result "*"]\n\n${body} *\n`;
}
// Adds every move in the PGN, variations included, to the repertoire. Nothing is removed or
// replaced: a different move of mine in a position I already have becomes another option.
function importRepertoire(text, color) {
  let added = 0, options = 0, bad = 0;
  for (const g of splitGames(text)) {
    bad += walkPGNTree(g, (before, san) => {
      const key = K(before); const n = node(key, color);
      if (n.m.includes(san)) return;
      if (isMine(key, color) && n.m.length) options++;
      n.m.push(san); added++;
    });
  }
  walk(color);
  Store.save(repDoc(color));
  return { added, options, bad };
}
