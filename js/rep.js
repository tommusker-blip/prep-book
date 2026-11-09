"use strict";
/* ---------- repertoire model, PGN parsing, game analysis, scheduler (pure logic, no DOM) ---------- */
/* ---------- repertoire model ---------- */
function rep(color = S.color) { return S.rep[color]; }
function node(key, color = S.color) { const p = rep(color).pos; return p[key] || (p[key] = { m: [] }); }
function newCard() { return { due: Date.now(), iv: 0, ef: 2.5, reps: 0, lapses: 0, flag: 0, seen: 0 }; }

// A cheap fingerprint of a repertoire's moves and cards, to tell whether anything changed
const treeHash = R => hashStr(Object.entries(R.pos).map(([k, n]) => k + ":" + n.m.join()).join("|")) + ":" + Object.keys(R.cards).length;
// Walk the tree from the start; fix paths, drop unreachable positions and stale cards.
// Returns {seen: key -> path, order: keys breadth first, nodes: key -> {path, fen, kids:[{san, key}]}}.
// Replaying moves with chess.js is the slow part, so the result is memoised until the tree
// changes (walk is called from many places on every redraw).
const walkMemo = {};
function walk(color = S.color) {
  const R = rep(color), mk = color + "|" + S.book;
  const memo = walkMemo[mk];
  if (memo && memo.R === R && memo.sig === treeHash(R)) return memo;
  const seen = {}, order = [], nodes = {};
  const q = [[START, []]];
  while (q.length) {
    const [fen, path] = q.shift();
    const key = K(fen);
    if (seen[key]) continue;
    seen[key] = path;
    order.push(key);
    const node = nodes[key] = { path, fen, kids: [] };
    const n = R.pos[key];
    if (!n) continue;
    n.path = path.join(" ");
    const c = new Chess(fen), keep = [];
    for (const m of n.m) {
      if (!c.move(m)) continue; // illegal here: dropped
      const cf = c.fen();
      c.undo();
      keep.push(m);
      node.kids.push({ san: m, key: K(cf) });
      q.push([cf, path.concat(m)]);
    }
    if (keep.length !== n.m.length) n.m = keep;
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
  return (walkMemo[mk] = { R, sig: treeHash(R), seen, order, nodes });
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
// Moves of mine in `moves` that differ from what the repertoire already plays there
function lineConflicts(moves, color = S.color) {
  const out = [];
  for (let i = 0; i < moves.length; i++) {
    const fen = fenAfter(START, moves.slice(0, i)), key = fen && K(fen), n = key && rep(color).pos[key];
    if (key && isMine(key, color) && n && n.m.length && !n.m.includes(moves[i])) out.push({ i, san: moves[i], have: n.m.slice(), path: moves.slice(0, i) });
  }
  return out;
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
function mainline(g) { return mainlineWithClocks(g).moves; }
// Clock comment after a move, e.g. {[%clk 0:04:12.3]} -> 252.3 seconds left
function clockSeconds(comment) {
  const m = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/.exec(comment);
  return m ? Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 10) / 10 : null;
}
// Main line moves, plus the clock left after each move where the PGN has %clk comments
// (chess.com writes them for every move). clk[i] belongs to moves[i]; null if missing.
function mainlineWithClocks(g) {
  const body = g.replace(/^\[.*\]\s*$/gm, " ").replace(/;[^\n]*/g, " ");
  const moves = [], clk = [];
  let depth = 0;
  for (const raw of body.match(/\{[^}]*\}|\(|\)|[^\s(){}]+/g) || []) {
    if (raw === "(") { depth++; continue; }
    if (raw === ")") { depth--; continue; }
    if (depth) continue;
    if (raw[0] === "{") { const s = clockSeconds(raw); if (s != null && moves.length) clk[moves.length - 1] = s; continue; }
    const t = cleanTok(raw);
    if (t) { moves.push(t); clk.push(null); }
  }
  return { moves, clk };
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
  const { moves, clk } = mainlineWithClocks(g);
  // validate moves, keep SAN normalised
  const c = new Chess(); const sans = [];
  for (const m of moves) { const mv = c.move(m, { sloppy: true }); if (!mv) break; sans.push(mv.san); }
  const clocks = clk.slice(0, sans.length);
  const u = (user || "").toLowerCase();
  let my = null;
  if ((h.White || "").toLowerCase() === u) my = "white";
  else if ((h.Black || "").toLowerCase() === u) my = "black";
  const id = h.Link ? hashStr(h.Link) : hashStr((h.White || "") + (h.Black || "") + (h.Date || "") + (h.UTCTime || h.EndTime || "") + sans.slice(0, 30).join(""));
  return {
    id, my, tc, url: h.Link || "", date: (h.UTCDate || h.Date || "").replace(/\./g, "-"),
    white: h.White || "?", black: h.Black || "?", welo: +h.WhiteElo || 0, belo: +h.BlackElo || 0,
    result: h.Result || "*", moves: sans.join(" "),
    tcs: h.TimeControl || "",                                      // e.g. "600+5"
    clk: clocks.some(x => x != null) ? clocks : undefined,         // seconds left after each move
  };
}
function myScore(g) {
  if (g.result === "1/2-1/2") return 0.5;
  if (g.result === "1-0") return g.my === "white" ? 1 : 0;
  if (g.result === "0-1") return g.my === "black" ? 1 : 0;
  return null;
}
// Adds new rapid games of mine. Games imported before clocks were read get their clock times
// (and time control) filled in when they're fetched again. Returns the number of new games.
function addGames(list) {
  const byId = new Map(S.games.map(g => [g.id, g]));
  const changed = [];
  let n = 0;
  for (const g of list) {
    if (!g.my || g.tc !== "rapid") continue;
    const old = byId.get(g.id);
    if (!old) { S.games.push(g); byId.set(g.id, g); changed.push(g.id); n++; continue; }
    if (!old.clk && g.clk) { old.clk = g.clk; old.tcs = g.tcs; changed.push(g.id); }
  }
  S.games.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (typeof Games !== "undefined") Games.mark(changed);
  Store.save("games");
  addGames.clocks = changed.length - n; // older games that got their clock times now
  return n;
}

/* ---------- game analysis against the repertoire ---------- */
// Position keys of a game's opening (before ply 0, 1, …), worked out once per game and reused.
// Replaying games with chess.js is slow (SAN parsing); with 1,800 games, doing it on every
// redraw made Build take seconds. Openings rarely stay in book past GAME_PLIES.
const GAME_PLIES = 40, GAMEKEYS = new Map();
function gameKeys(g) {
  let keys = GAMEKEYS.get(g.id);
  if (keys) return keys;
  const c = new Chess(), moves = g.moves ? g.moves.split(" ") : [];
  keys = [K(c.fen())];
  for (let i = 0; i < Math.min(moves.length, GAME_PLIES); i++) { if (!c.move(moves[i])) break; keys.push(K(c.fen())); }
  GAMEKEYS.set(g.id, keys);
  return keys;
}
// Fill GAMEKEYS in small batches so the page stays responsive; onDone runs when all are ready
let warming = false, warmWaiting = [];
function warmGameKeys(onDone) {
  if (onDone) warmWaiting.push(onDone);
  if (warming) return;
  const finish = () => { warming = false; const cbs = warmWaiting; warmWaiting = []; cbs.forEach(cb => cb()); };
  if (!S.games.some(g => !GAMEKEYS.has(g.id))) { finish(); return; }
  warming = true;
  const step = () => {
    const end = performance.now() + 12; // ~12 ms of work per tick keeps taps responsive
    let left = false;
    for (const g of S.games) { if (GAMEKEYS.has(g.id)) continue; if (performance.now() > end) { left = true; break; } gameKeys(g); }
    if (left) setTimeout(step, 0); else finish();
  };
  setTimeout(step, 0);
}
function analyseGame(g) {
  const color = g.my, R = rep(color);
  const moves = g.moves ? g.moves.split(" ") : [];
  const keys = gameKeys(g);
  for (let i = 0; i < moves.length; i++) {
    const key = keys[i];
    if (!key) return { type: "full", ply: i, key: keys[keys.length - 1], path: moves.slice(0, i) }; // past GAME_PLIES and still in book
    const n = R.pos[key], played = moves[i];
    const mine = isMine(key, color);
    const path = moves.slice(0, i);
    if (mine) {
      if (!n || !n.m.length) return { type: "you_new", ply: i, key, played, path };
      if (!n.m.includes(played)) return { type: "misplay", ply: i, key, played, expected: n.m.join(" / "), path };
    } else {
      if (!n || !n.m.length) return { type: "end", ply: i, key, played, path };
      if (!n.m.includes(played)) return { type: "opp_new", ply: i, key, played, path };
    }
  }
  return { type: "full", ply: moves.length, key: keys[keys.length - 1], path: moves };
}
// Every game of mine with this colour, analysed against the open repertoire. Memoised until
// the repertoire or the games change. While game keys are still being worked out in the
// background, games without keys are left out, and the view redraws when they're ready.
let analysisMemo = { sig: "", out: null };
function analysis(color = S.color, all = false) {
  // all = true works out any missing keys now (slow the first time); used where completeness matters
  const ready = all || !(warming || S.games.some(g => !GAMEKEYS.has(g.id))) ? S.games : S.games.filter(g => GAMEKEYS.has(g.id));
  const sig = color + "|" + S.book + "|" + ready.length + "|" + S.games.length + "|" + hashStr(Object.entries(rep(color).pos).map(([k, n]) => k + ":" + n.m.join()).join("|"));
  if (analysisMemo.sig === sig) return analysisMemo.out;
  const out = ready.filter(g => g.my === color).map(g => ({ g, a: analyseGame(g), s: myScore(g) }));
  analysisMemo = { sig, out };
  return out;
}
// G1: my own results by position and by move, from my games. Positions are matched by key, so
// a transposition counts. Covers the first GAME_PLIES plies (from GAMEKEYS); a position that
// repeats within a game counts once. Memoised until the games change.
//   pos: key -> {n, w, d, l}      mv: key -> san -> {n, w, d, l}      (from my side)
const wdlAdd = (o, s) => { o.n++; if (s === 1) o.w++; else if (s === 0.5) o.d++; else if (s === 0) o.l++; };
const newWdl = () => ({ n: 0, w: 0, d: 0, l: 0 });
let myStatsMemo = {};
function myStats(color = S.color) {
  const ready = S.games.filter(g => g.my === color && GAMEKEYS.has(g.id));
  const sig = S.games.length + "|" + ready.length;
  if (myStatsMemo[color] && myStatsMemo[color].sig === sig) return myStatsMemo[color];
  const pos = {}, mv = {};
  for (const g of ready) {
    const s = myScore(g), keys = GAMEKEYS.get(g.id), moves = g.moves ? g.moves.split(" ") : [], seen = new Set();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (seen.has(key)) continue;
      seen.add(key);
      wdlAdd(pos[key] || (pos[key] = newWdl()), s);
      if (i < moves.length && i + 1 < keys.length) { const m = mv[key] || (mv[key] = {}); wdlAdd(m[moves[i]] || (m[moves[i]] = newWdl()), s); }
    }
  }
  return (myStatsMemo[color] = { sig, pos, mv });
}
const myPosStats = (key, color = S.color) => myStats(color).pos[key] || null;
const myMoveStats = (key, san, color = S.color) => ((myStats(color).mv[key] || {})[san]) || null;
const wdlScore = o => (o && o.n ? (o.w + o.d / 2) / o.n : null);

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
  for (const { g, a } of analysis(color, true)) {
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
