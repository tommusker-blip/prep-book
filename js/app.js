"use strict";
/* ---------- chess.com import ---------- */
// chess.com usernames: letters, digits, "_" and "-". An email address is the usual mistake,
// and chess.com answers it without CORS headers, so the browser only reports a network error.
const validChessComUser = u => /^[A-Za-z0-9_-]{3,25}$/.test(u);
const USER_HELP = "Use your chess.com username (as shown on your profile), not your email address.";
async function fetchChessCom() {
  const u = S.settings.user.trim();
  if (!u) { toast("Add your chess.com username in Settings first."); return; }
  const st = $("#importStatus");
  if (!validChessComUser(u)) { st.textContent = `"${u}" isn't a chess.com username. ${USER_HELP} Change it in Settings.`; return; }
  st.textContent = "Fetching your game archive list…";
  try {
    const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u.toLowerCase())}/games/archives`);
    if (!r.ok) throw new Error(r.status === 404 ? "No chess.com player with that username." : "chess.com returned an error (" + r.status + ").");
    const { archives } = await r.json();
    const pick = archives.slice(-S.settings.months);
    let added = 0;
    for (const [i, a] of pick.entries()) {
      st.textContent = `Fetching month ${i + 1} of ${pick.length}…`;
      const rr = await fetch(a);
      if (!rr.ok) continue;
      const { games } = await rr.json();
      const list = games.filter(x => x.rules === "chess" && x.time_class === "rapid" && x.pgn)
        .map(x => { const g = gameFromPGN(x.pgn, u, "rapid"); g.url = x.url || g.url; return g; });
      added += addGames(list);
    }
    st.textContent = `Added ${added} new rapid game${added === 1 ? "" : "s"}.`;
    warmGameKeys(() => { flagMisplays("white"); flagMisplays("black"); render(); });
    render();
  } catch (e) {
    st.textContent = e.message && !/fetch|network|Failed/i.test(e.message)
      ? e.message
      : S.storeMode === "db"
      ? "Can't reach chess.com from here. Inside Claude, outside websites are blocked: use Paste PGN below, or open the hosted copy."
      : "Couldn't reach chess.com. Check your connection, and that Settings has your chess.com username (not your email). You can also use Paste PGN below.";
  }
}

// Analyse every game that has no result yet, newest first (S.games is sorted newest first).
// Runs in the background until done or stopped; results are saved every SAVE_EVERY games,
// so stopping or closing loses at most a few and the next run carries on from there.
let analysing = false, stopAnalysis = false;
const SAVE_EVERY = 20;
function analyseOne(g) {
  const a = analyseGame(g);
  const moves = g.moves.split(" ");
  const last = Math.min(moves.length, a.ply + 8, 40);
  const c = new Chess(); const fens = [c.fen()];
  for (let i = 0; i < last; i++) { c.move(moves[i]); fens.push(c.fen()); }
  return (async () => {
    const ev = [];
    for (const f of fens) ev.push(await Engine.analyse(f, 10));
    const inb = [], post = [];
    for (let i = 0; i < last; i++) {
      if (!isMine(K(fens[i]), g.my)) continue;
      (i < a.ply ? inb : post).push(Math.round(moveAcc(ev[i].cp, -ev[i + 1].cp)));
    }
    const x = Math.min(a.ply, last);
    const exitCp = sideOf(K(fens[x])) === myChar(g.my) ? ev[x].cp : -ev[x].cp;
    return { inb, post, exitCp: Math.round(exitCp) };
  })();
}
async function analyseGamesWithEngine() {
  if (analysing) { stopAnalysis = true; $("#engStatus").textContent = "Stopping after this game…"; return; }
  const todo = S.games.filter(g => !S.acc[g.id]);
  if (!todo.length) { toast("All imported games are analysed."); return; }
  analysing = true; stopAnalysis = false;
  const st = $("#engStatus");
  const persist = () => { saveEvalCache(); if (S.storeMode === "supabase") Dirty.mark("acc"); Store.flush("acc"); };
  let done = 0;
  render();
  try {
    if (!Engine.which) st.textContent = "Starting Stockfish (about 7 MB the first time)…";
    await Engine.init();
    for (const g of todo) {
      if (stopAnalysis) break;
      st.textContent = `Analysing game ${done + 1} of ${todo.length}${g.date ? ` (${g.date})` : ""}…`;
      S.acc[g.id] = await analyseOne(g);
      done++;
      if (done % SAVE_EVERY === 0) { persist(); if (S.view === "games") renderGames(); }
    }
    st.textContent = stopAnalysis
      ? `Stopped. Analysed ${done} game${done === 1 ? "" : "s"}; ${todo.length - done} left for next time.`
      : `Analysed ${done} game${done === 1 ? "" : "s"}. All imported games are done.`;
  } catch (e) {
    st.textContent = done ? `Stopped after ${done} games: the engine failed. Tap again to carry on.` : "The engine couldn't start in this browser.";
  }
  persist();
  analysing = false; stopAnalysis = false;
  render();
}

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
  { id: "green", name: "Tournament green" }, { id: "brown", name: "Brown" }, { id: "blue", name: "Blue" },
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
  const t = S.settings.board || "green";
  if (t === "green") delete document.documentElement.dataset.board; else document.documentElement.dataset.board = t;
}
function redrawBoards() { applyLook(); if (BB) BB.draw(); if (TB) TB.draw(); }

/* ---------- move arrows ---------- */
// arrows: [{from, to, w (0..1, thickness), kind}] where kind is "mine" (in my repertoire),
// "gap" (opponent move I haven't prepared), "gem" (hidden gem / scores better) or "other"
function arrowsSvg(arrows, flip) {
  if (!arrows || !arrows.length) return "";
  const xy = sq => { const f = sq.charCodeAt(0) - 97, r = +sq[1]; return [(flip ? 7 - f : f) + 0.5, (flip ? r - 1 : 8 - r) + 0.5]; };
  const body = arrows.slice().sort((a, b) => a.w - b.w).map(a => {
    const [x1, y1] = xy(a.from), [x2, y2] = xy(a.to);
    const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const sw = 0.07 + 0.23 * a.w, head = 0.22 + 0.2 * a.w;
    const ex = x2 - ux * head, ey = y2 - uy * head; // shaft stops where the head starts
    const px = -uy * head * 0.75, py = ux * head * 0.75;
    return `<g class="arw ${a.kind}"><line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke-width="${sw}"/><polygon points="${x2},${y2} ${ex + px},${ey + py} ${ex - px},${ey - py}"/></g>`;
  }).join("");
  return `<svg class="arrows" viewBox="0 0 8 8" aria-hidden="true">${body}</svg>`;
}
// Arrows for the Build position: Lichess moves at my level, thicker for more common moves
function buildArrows(fen, key, n) {
  if (S.settings.arrows === false) return [];
  const ex = cachedExplorer(fen), mine = n ? n.m : [], myTurn = isMine(key, S.color);
  const c = new Chess(fen), sq = san => { const m = c.move(san, { sloppy: true }); if (m) c.undo(); return m; };
  const out = [];
  if (ex && ex.total) {
    const top = ex.moves.filter(m => m.n / ex.total >= 0.03).sort((a, b) => b.n - a.n).slice(0, 6);
    const maxF = Math.max(...top.map(m => m.n / ex.total), 0.01);
    for (const m of top) {
      const mv = sq(m.san); if (!mv) continue;
      const kind = mine.includes(m.san) ? "mine" : myTurn ? (judgeMove(m, ex, S.color, mine) ? "gem" : "other") : "gap";
      out.push({ from: mv.from, to: mv.to, w: m.n / ex.total / maxF, kind });
    }
  }
  // My moves always show, even without Lichess data
  for (const s of mine) if (!out.some(a => a.kind === "mine" && sq(s) && a.to === sq(s).to && a.from === sq(s).from)) { const mv = sq(s); if (mv) out.push({ from: mv.from, to: mv.to, w: 0.5, kind: "mine" }); }
  return out;
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
function Board(el) {
  const b = { el, fen: START, flip: false, sel: null, last: null, hint: null, bad: null, onMove: null, locked: false, arrows: [] };
  b.set = (fen, opts = {}) => {
    const oldFen = b.fen, oldLast = b.last;
    b.fen = fen; b.sel = null;
    Object.assign(b, { last: null, hint: null, bad: null, arrows: [] }, opts);
    b.anim = opts.animate === false ? null : slideFor(oldFen, oldLast, fen, b.last);
    b.draw();
    b.anim = null;
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
      if (p && p.type === "k" && c.in_check() && p.color === c.turn()) cls.push("check");
      const dot = targets.includes(sq) ? (p ? '<i class="cap"></i>' : '<i class="dot"></i>') : "";
      const coordF = r === 7 ? `<span class="cf">${files[file]}</span>` : "";
      const coordR = f === 0 ? `<span class="cr">${rank}</span>` : "";
      const pc = p ? pieceHtml(p) : "";
      // --f/--r place this square's slice of a board-wide texture (wood, marble)
      html += `<button type="button" class="${cls.join(" ")}" style="--f:${f};--r:${r}" data-sq="${sq}" aria-label="${sq}${p ? " " + (p.color === "w" ? "white " : "black ") + p.type : ""}">${pc}${dot}${coordF}${coordR}</button>`;
    }
    el.innerHTML = html + arrowsSvg(b.arrows, b.flip);
    if (b.anim) slidePieces(el, b.anim, b.flip);
  };
  // A missing piece image falls back to the Unicode pieces
  el.addEventListener("error", e => {
    if (!e.target.classList || !e.target.classList.contains("pimg") || pieceFallback) return;
    pieceFallback = true; toast("Couldn't load the piece images, so the plain pieces are shown instead."); redrawBoards();
  }, true);
  el.addEventListener("click", e => {
    const t = e.target.closest("[data-sq]");
    if (!t || b.locked) return;
    const sq = t.dataset.sq, c = new Chess(b.fen);
    if (b.sel) {
      const mv = c.moves({ square: b.sel, verbose: true }).find(m => m.to === sq);
      if (mv) {
        const from = b.sel; b.sel = null; b.draw();
        const res = c.move({ from, to: sq, promotion: "q" });
        if (b.onMove) b.onMove(res, from, sq);
        return;
      }
    }
    const p = c.get(sq);
    b.sel = p && p.color === c.turn() && b.sel !== sq ? sq : null;
    b.draw();
  });
  return b;
}

/* ---------- views ---------- */
let BB, TB; // build & train boards
function setView(v) {
  S.view = v;
  document.querySelectorAll("[data-view]").forEach(s => (s.hidden = s.dataset.view !== v));
  document.querySelectorAll("[data-nav]").forEach(b => b.setAttribute("aria-current", b.dataset.nav === v ? "page" : "false"));
  render();
}
function render() {
  document.querySelectorAll("[data-color]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.color === S.color)));
  if (S.view === "build") renderBuild();
  if (S.view === "train") renderTrainHome();
  if (S.view === "games") renderGames();
  if (S.view === "settings") renderSettings();
}

/* ----- build ----- */
function curPath() { return S.build[S.color]; }
function renderBuild() {
  const path = curPath();
  const fen = fenAfter(START, path) || START;
  const key = K(fen);
  BB.flip = S.color === "black";
  let last = null;
  if (path.length) { const c = new Chess(fenAfter(START, path.slice(0, -1))); const mv = c.move(path[path.length - 1]); if (mv) last = [mv.from, mv.to]; }
  const n = rep().pos[key];
  BB.set(fen, { last, arrows: buildArrows(fen, key, n) });
  // line strip
  $("#line").innerHTML = lineHtml(path, true);
  const op = openingFor(path);
  const ex = cachedExplorer(fen);
  $("#opName").innerHTML = op ? `<span class="eco">${esc(op.eco)}</span> ${esc(op.name)}` : (path.length ? "Unnamed line" : "Starting position");
  $("#opIdea").textContent = op && op.idea ? op.idea : "";
  // prompt
  const mine = isMine(key, S.color);
  const pr = $("#prompt");
  if (mine) {
    if (n && n.m.length) {
      const many = n.m.length > 1;
      pr.innerHTML = `<p class="lbl">${many ? `Your moves (${n.m.length} options)` : "Your move"}</p>
      <ul class="mymoves">${n.m.map(m => `<li><button type="button" class="chip big" data-go="${esc(m)}">${esc(moveLabel(path, m))}</button><button type="button" class="btn ghost" data-remove="${esc(m)}" aria-label="Remove ${esc(m)} and the line after it">Remove</button></li>`).join("")}</ul>
      <p class="help" style="margin-top:8px">Tap a move to follow it. Play a different move on the board to add it as ${many ? "another" : "a second"} option or to replace one of these. Removing a move also removes the line after it.</p>`;
    } else {
      pr.innerHTML = `<p class="lbl warn">No prep yet</p><p>What do you play here? Make the move on the board, or pick one from the table below. Use the engine if you want a suggestion.</p>`;
    }
    pr.innerHTML += yourMovesTable(fen, key, n, path) + myTable(fen, key, n);
  } else {
    pr.innerHTML = `<p class="lbl">Opponent's options</p>${quickOppButtons(fen, key, n)}${oppTable(fen, key, n)}`;
  }
  if (!ex && S.token && !explorerBlocked) explorer(fen).then(d => { if (d && S.view === "build" && K(fenAfter(START, curPath()) || START) === key) renderBuild(); });
  // engine panel
  const ev = EVALC[key];
  $("#engOut").innerHTML = ev ? `<b class="mono">${fmtEval(ev.cp, ev.mate, sideOf(key))}</b> <span class="muted">depth ${ev.d}, Stockfish ${ev.e === "wasm" ? "17" : "10"}</span> · best <b>${esc(uciToSan(fen, ev.best))}</b>` : `<span class="muted">Not analysed yet.</span>`;
  renderGaps();
  renderSuggest();
}
// A win/draw/loss bar from my side for Lichess counts {w, d, b}
function wdlBar(r, color) {
  const tot = (r.w || 0) + (r.d || 0) + (r.b || 0);
  if (!tot) return `<span class="wdl empty"></span>`;
  const you = color === "white" ? r.w : r.b, them = color === "white" ? r.b : r.w;
  return `<span class="wdl" title="Your results from here at this rating: ${pct(you, tot)}% win, ${pct(r.d, tot)}% draw, ${pct(them, tot)}% loss"><i class="w" style="width:${pct(you, tot)}%"></i><i class="d" style="width:${pct(r.d, tot)}%"></i><i class="l" style="width:${pct(them, tot)}%"></i></span>`;
}
/* ----- opponent's turn: quick picks ----- */
// "common": the most played reply at my level. "weak": my weakest spot here, which is the most
// common reply I haven't prepared, or (if all are prepared) the one I score worst against.
function pickOpp(fen, key, n, mode) {
  const ex = cachedExplorer(fen);
  if (!ex || !ex.total) return null;
  const prepared = n ? n.m : [];
  const moves = ex.moves.filter(m => m.n / ex.total >= 0.03).sort((a, b) => b.n - a.n);
  if (!moves.length) return null;
  const f = m => m.n / ex.total;
  if (mode === "common") { const m = moves[0]; return { san: m.san, why: `${Math.round(f(m) * 100)}% of games` }; }
  const gap = moves.find(m => !prepared.includes(m.san));
  if (gap) return { san: gap.san, why: `not prepared · ${Math.round(f(gap) * 100)}% of games` };
  const worst = moves.slice().sort((a, b) => scoreFor(a, S.color) - scoreFor(b, S.color))[0];
  return { san: worst.san, why: `you score ${Math.round(scoreFor(worst, S.color) * 100)}% after it` };
}
function quickOppButtons(fen, key, n) {
  const common = pickOpp(fen, key, n, "common"), weak = pickOpp(fen, key, n, "weak");
  if (!common) return "";
  const btn = (p, label) => `<button type="button" class="btn ghost quick" data-go="${esc(p.san)}"><b>${label}: ${esc(p.san)}</b><span>${esc(p.why)}</span></button>`;
  const same = weak && weak.san === common.san;
  return `<div class="row quickrow">${btn(same ? weak : common, same ? "Most common · weakest spot" : "Most common")}${weak && !same ? btn(weak, "Weakest spot") : ""}</div>`;
}
// Settings > "After my move": play the opponent's reply automatically ("common" | "weak" | off)
async function autoOpponent(path) {
  const mode = S.settings.autoOpp;
  if (!mode || mode === "off") return;
  const fen = fenAfter(START, path), key = K(fen);
  if (isMine(key, S.color)) return;
  if (!cachedExplorer(fen)) await explorer(fen);
  const same = () => S.view === "build" && curPath() === path && curPath().join(" ") === path.join(" ");
  if (!same()) return;
  const p = pickOpp(fen, key, rep().pos[key], mode);
  if (!p) return;
  setTimeout(() => { if (same()) goMove(p.san); }, 450);
}

/* ----- my turn: what I play here, and is it any good? ----- */
// Moves I actually played from this position in my games, by this exact move order
// (transpositions aren't counted): san -> {n, pts}
function myGameMoves(path, color) {
  const pre = path.join(" "), out = {};
  for (const g of S.games) {
    if (g.my !== color || !g.moves) continue;
    if (pre && !(g.moves === pre || g.moves.startsWith(pre + " "))) continue;
    const san = g.moves.split(" ")[path.length];
    if (!san) continue;
    const s = myScore(g);
    const o = out[san] || (out[san] = { n: 0, pts: 0, scored: 0 });
    o.n++; if (s != null) { o.pts += s; o.scored++; }
  }
  return out;
}
// Stockfish verdict on a move: centipawns lost against the best move (depth 14, cached)
const VERDICT_DEPTH = 14, verdictBusy = new Set();
function verdictFor(fen, san) {
  const best = EVALC[K(fen)], c = new Chess(fen);
  if (!c.move(san)) return null;
  const after = EVALC[K(c.fen())];
  if (!best || !after || best.d < VERDICT_DEPTH || after.d < VERDICT_DEPTH) return null;
  const loss = Math.max(0, best.cp - -after.cp); // after.cp is from the opponent's side
  const label = loss <= 30 ? "Good" : loss <= 80 ? "OK" : loss <= 180 ? "Dubious" : "Mistake";
  return { loss, label, cls: loss <= 80 ? "ok" : "gap" };
}
// Work out missing verdicts in the background, then redraw if we're still on this position
function queueVerdicts(fen, sans) {
  if (Engine.failed) return;
  const jobs = [fen, ...sans.map(s => fenAfter(fen, [s])).filter(Boolean)].filter(f => { const e = EVALC[K(f)]; return !(e && e.d >= VERDICT_DEPTH && e.e === "wasm") && !verdictBusy.has(K(f)); });
  if (!jobs.length) return;
  jobs.forEach(f => verdictBusy.add(K(f)));
  const key = K(fen);
  Promise.all(jobs.map(f => Engine.analyse(f, VERDICT_DEPTH).catch(() => null))).then(() => {
    jobs.forEach(f => verdictBusy.delete(K(f)));
    saveEvalCache();
    if (S.view === "build" && K(fenAfter(START, curPath()) || START) === key) renderBuild();
  });
}
// How a move fits my prep: it transposes into a position I already have, or it keeps a pawn
// structure from one of my other lines. (A real "fits my style" judgement needs chess
// understanding, so these are only the two signals the data supports.)
function fitPills(fen, san, mineHere) {
  const c = new Chess(fen);
  if (!c.move(san)) return "";
  const idx = indexTree(), k = K(c.fen()), pills = [];
  if (!mineHere.includes(san) && idx[k]) pills.push('<span class="pill gem">Transposes to your prep</span>');
  const pk = pawnKey(k.split(" ")[0]);
  const same = Object.values(idx).find(p => p.path.length >= 8 && pawnKey(K(p.fen).split(" ")[0]) === pk && !p.path.join(" ").startsWith(curPath().join(" ")));
  if (same) { const op = openingFor(same.path); pills.push(`<span class="pill gem" title="${esc(same.path.join(" "))}">Same pawns as your ${esc(op ? op.name.split(":")[0] : "other line")}</span>`); }
  return pills.join(" ");
}
function yourMovesTable(fen, key, n, path) {
  const mine = n ? n.m : [], played = myGameMoves(path, S.color);
  const sans = [...new Set([...mine, ...Object.keys(played).sort((a, b) => played[b].n - played[a].n)])].slice(0, 6);
  if (!sans.length) return "";
  const ex = cachedExplorer(fen);
  queueVerdicts(fen, sans);
  const totalGames = Object.values(played).reduce((a, o) => a + o.n, 0);
  const rows = sans.map(s => {
    const g = played[s], lm = ex && ex.moves.find(m => m.san === s), v = verdictFor(fen, s);
    const tags = (mine.includes(s) ? '<span class="pill ok">Yours</span>' : g ? '<span class="pill gap">Not in your prep</span>' : "") + fitPills(fen, s, mine);
    return `<tr><td><button type="button" class="chip" data-go="${esc(s)}">${esc(s)}</button>${tags ? `<div class="tags">${tags}</div>` : ""}</td>
      <td class="num">${g ? `${g.n}×<br><span class="muted">${g.scored ? Math.round((100 * g.pts) / g.scored) + "%" : "–"}</span>` : "–"}</td>
      <td class="num">${lm ? Math.round(scoreFor(lm, S.color) * 100) + "%" : "–"}</td>
      <td>${v ? `<span class="pill ${v.cls}" title="Loses about ${(v.loss / 100).toFixed(2)} against Stockfish's best move">${v.label}</span>` : Engine.failed ? "–" : '<span class="muted">checking…</span>'}</td></tr>`;
  }).join("");
  return `<p class="lbl" style="margin-top:14px">Your moves here</p>
    <div class="tblwrap"><table class="yours"><thead><tr><th>Move</th><th class="num">Your games<br>(score)</th><th class="num">Lichess<br>score</th><th>Engine</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="src">${totalGames ? `You reached this position in ${totalGames} rapid game${totalGames === 1 ? "" : "s"} by this move order. ` : ""}Engine: Stockfish depth ${VERDICT_DEPTH}, compared with its best move (Good, OK, Dubious, Mistake).</p>`;
}
const srcLine = ex => `Lichess rapid, ${S.settings.band.map(b => b + "+").join(" & ")}, ${ex.total.toLocaleString("en-GB")} games`;
// At my turn: what players at my level play here, how each move scores for me, and which
// ones are hidden gems or score better than my choice
function myTable(fen, key, n) {
  const ex = cachedExplorer(fen);
  if (!ex || !ex.total) return S.token && !explorerBlocked && !ex ? `<p class="help" style="margin-top:10px">Loading how players at your level score here…</p>` : "";
  const mine = n ? n.m : [];
  const avg = posAverage(ex, S.color);
  const rows = ex.moves.slice().sort((a, b) => b.n - a.n).filter((m, i) => i < 8 || mine.includes(m.san) || judgeMove(m, ex, S.color, mine));
  const body = rows.map(m => {
    const kind = judgeMove(m, ex, S.color, mine), sc = scoreFor(m, S.color);
    const pill = mine.includes(m.san) ? '<span class="pill ok">Yours</span>' : kind === "gem" ? '<span class="pill gem">Hidden gem</span>' : kind === "better" ? '<span class="pill gem">Scores better</span>' : "";
    return `<tr><td><button type="button" class="chip" data-go="${esc(m.san)}">${esc(m.san)}</button></td>
      <td class="num">${Math.round((100 * m.n) / ex.total)}%</td><td>${wdlBar(m, S.color)}</td>
      <td class="num">${Math.round(sc * 100)}%</td><td class="num">${m.n.toLocaleString("en-GB")}</td><td>${pill}</td></tr>`;
  }).join("");
  return `<p class="lbl" style="margin-top:14px">At your level on Lichess</p>
    <div class="tblwrap"><table><thead><tr><th>Move</th><th class="num">Freq</th><th>Results</th><th class="num">You score</th><th class="num">Games</th><th></th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="src">${esc(srcLine(ex))}. Average score here ${Math.round(avg * 100)}%. Tap a move to add it.</p>`;
}
function moveLabel(path, san) {
  const n = Math.floor(path.length / 2) + 1;
  return path.length % 2 === 0 ? `${n}. ${san}` : `${n}… ${san}`;
}
function lineHtml(path, clickable) {
  if (!path.length) return `<span class="muted">Start position. ${S.color === "white" ? "Choose your first move." : "Add the first moves you face as Black."}</span>`;
  return path.map((m, i) => {
    const num = i % 2 === 0 ? `<span class="mn">${i / 2 + 1}.</span>` : "";
    return `${num}<button type="button" class="mv${i === path.length - 1 ? " cur" : ""}" ${clickable ? `data-jump="${i + 1}"` : "disabled"}>${esc(m)}</button>`;
  }).join("");
}
function oppTable(fen, key, n) {
  const ex = cachedExplorer(fen);
  const seen = oppSeen()[key] || {};
  const prepared = n ? n.m : [];
  const rows = {};
  if (ex) for (const m of ex.moves) rows[m.san] = { san: m.san, f: ex.total ? m.n / ex.total : 0, n: m.n, w: m.w, d: m.d, b: m.b };
  for (const [s, c] of Object.entries(seen)) (rows[s] = rows[s] || { san: s }).g = c;
  for (const s of prepared) rows[s] = rows[s] || { san: s };
  const list = Object.values(rows).sort((a, b) => (b.f || 0) - (a.f || 0) || (b.g || 0) - (a.g || 0));
  if (!list.length) {
    if (explorerBlocked) return `<p class="muted">Lichess stats can't load here because this page can't reach outside websites. Play the opponent's move you want to prepare for on the board.</p>`;
    return `<p class="muted">${S.token ? "Loading what players at your level play here…" : "No data here yet. Play the opponent's move you want to prepare for on the board, or add a Lichess token in Settings to see the most popular replies at your level."}</p>`;
  }
  const idx = indexTree();
  const body = list.map(r => {
    const ok = prepared.includes(r.san);
    // An unprepared move that leads into a position I already have is a cheap gap to close
    let trans = false;
    if (!ok) { const c = new Chess(fen); trans = !!(c.move(r.san) && idx[K(c.fen())]); }
    return `<tr><td><button type="button" class="chip" data-go="${esc(r.san)}">${esc(r.san)}</button></td>
      <td class="num">${r.f != null ? Math.round(r.f * 100) + "%" : "–"}</td>
      <td>${wdlBar(r, S.color)}</td>
      <td class="num">${r.g ? r.g + "×" : ""}</td>
      <td>${ok ? '<span class="pill ok">Prepared</span>' : trans ? '<span class="pill gem">Transposes to your prep</span>' : '<span class="pill gap">Gap</span>'}</td></tr>`;
  }).join("");
  const src = ex ? srcLine(ex) : "From your games";
  return `<div class="tblwrap"><table class="opp"><thead><tr><th>Move</th><th class="num">Freq</th><th>You score</th><th class="num">Your games</th><th></th></tr></thead><tbody>${body}</tbody></table></div><p class="src">${esc(src)}. Tap a move to follow it.</p>`;
}
function renderGaps() {
  const color = S.color, R = rep(color);
  walk(color);
  const games = oppSeen(color);
  const gaps = [];
  // reach: estimated share of games that get here, from explorer frequencies along the path
  for (const [key, { path, fen, reach }] of Object.entries(indexTree(color))) {
    const n = R.pos[key];
    if (isMine(key, color)) {
      if (!n || !n.m.length) gaps.push({ path, score: reach, text: "Your move is missing", detail: path.length ? "after " + path.slice(-1)[0] : "first move" });
    } else {
      const ex = cachedExplorer(fen); const prepared = n ? n.m : [];
      const cand = {};
      if (ex) for (const m of ex.moves) if (ex.total && m.n / ex.total >= 0.03) cand[m.san] = { f: m.n / ex.total };
      for (const [s, c] of Object.entries(games[key] || {})) (cand[s] = cand[s] || {}).g = c;
      for (const [s, v] of Object.entries(cand)) {
        if (prepared.includes(s)) continue;
        const score = v.f != null ? reach * v.f : (v.g || 0) * 0.02;
        gaps.push({ path, opp: s, score, text: `No answer to ${moveLabel(path, s)}`, detail: [v.f != null ? Math.round(v.f * 100) + "% of games" : "", v.g ? `faced ${v.g}× in your games` : ""].filter(Boolean).join(" · ") });
      }
      if (!prepared.length && !Object.keys(cand).length) gaps.push({ path, score: reach * 0.5, text: path.length ? "Line ends here" : "No opponent first moves yet", detail: path.length ? "add the replies you expect" : "start with 1.e4 and 1.d4" });
    }
  }
  gaps.sort((a, b) => b.score - a.score);
  const el = $("#gaps");
  if (!gaps.length) { el.innerHTML = `<p class="muted">No gaps found in the positions checked so far.</p>`; return; }
  el.innerHTML = gaps.slice(0, 12).map((g, i) => `<li><button type="button" class="gap-row" data-gap="${i}"><span class="gt">${esc(g.text)}</span><span class="gl mono">${esc(g.path.join(" ") || "start")}</span><span class="gd">${esc(g.detail)}</span></button></li>`).join("");
  el._gaps = gaps;
}

/* ----- suggestions from Lichess (scan, hidden gems, transpositions, structures, alternatives) ----- */
let sugOpen = { gems: 6, better: 6, trans: 6, struct: 6 };
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
function renderSuggest() {
  renderScanBox();
  const out = $("#sugOut");
  if (!S.token) { out.innerHTML = ""; return; }
  const s = suggestions();
  const pc = x => Math.round(x * 100) + "%";
  const section = (id, title, help, rows, fmt) => {
    if (!rows.length) return "";
    const shown = rows.slice(0, sugOpen[id]);
    return `<h4 class="lbl" style="margin-top:14px">${title} <span class="muted">(${rows.length})</span></h4><p class="help">${help}</p>
      <ol class="gaplist">${shown.map((r, i) => `<li>${fmt(r, i)}</li>`).join("")}</ol>
      ${rows.length > shown.length ? `<button type="button" class="btn ghost" data-more="${id}">Show more</button>` : ""}`;
  };
  const row = (id, i, title, line, detail) => `<button type="button" class="gap-row" data-sug="${id}:${i}"><span class="gt">${title}</span><span class="gl mono">${esc(line || "start")}</span><span class="gd">${detail}</span></button>`;
  const html =
    section("gems", "Hidden gems", "Rarely played at your level but score well for you. Check the number of games before trusting the score.", s.gems,
      (r, i) => row("gems", i, `${esc(moveLabel(r.path, r.san))}`, r.path.join(" "), `${pc(r.f)} of games · ${r.n.toLocaleString("en-GB")} games · you score ${pc(r.sc)} vs ${pc(r.avg)} on average`)) +
    section("better", "Better-scoring alternatives", "One move away from your choice, and scoring better at your level.", s.better,
      (r, i) => row("better", i, `${esc(moveLabel(r.path, r.san))} instead of ${esc(r.mine.join(" / "))}`, r.path.join(" "), `${pc(r.sc)} vs ${pc(r.myBest)} for yours · ${r.n.toLocaleString("en-GB")} games`)) +
    section("trans", "Transpositions", "Moves from your positions that lead into another position you've already prepared.", s.trans,
      (r, i) => row("trans", i, `${r.myTurn ? "You could play" : "Opponent plays"} ${esc(moveLabel(r.path, r.san))}`, r.path.join(" "), `${pc(r.f)} of games · joins your line ${esc(r.to.join(" ") || "start")}`)) +
    section("struct", "Same pawn structure", "Named openings that reach the same pawn structure as one of your lines, so your plans carry over.", s.struct,
      (r, i) => `<div class="gap-row"><span class="gt">${esc(r.eco)} ${esc(r.name)}</span><span class="gd">Same pawns as your ${esc(r.myName || "line")}: <span class="mono">${esc(r.mine.join(" "))}</span></span>
        <span class="row" style="margin-top:4px"><button type="button" class="btn ghost" data-sug="struct:${i}">Go to your line</button><a class="btn ghost" href="${lichessAnalysis(r.key)}" target="_blank" rel="noopener">Open on Lichess</a></span></div>`);
  out.innerHTML = html || `<p class="help" style="margin-top:10px">${scanTodo().length ? "Scan your tree to look for suggestions." : "No suggestions with the current thresholds. You can change them in Settings."}</p>`;
  out._s = s;
}
function onScanTick(finished) {
  if (S.view !== "build") return;
  if (finished) renderBuild(); else renderScanBox();
}
function goMove(san) {
  const path = curPath();
  const fen = fenAfter(START, path);
  const c = new Chess(fen);
  const mv = c.move(san, { sloppy: true });
  if (!mv) return;
  onBuildMove(mv);
}
function onBuildMove(mv) {
  const path = curPath();
  const fen = fenAfter(START, path);
  const key = K(fen);
  const n = rep().pos[key];
  if (isMine(key, S.color) && n && n.m.length && !n.m.includes(mv.san)) {
    showAddOrReplace(mv.san, n.m);
    return;
  }
  commitBuildMove(mv.san);
}
// Add (or, with `replaces`, swap in) a move at the current Build position and step into it
function commitBuildMove(san, replaces = null) {
  const path = curPath();
  const myMove = isMine(K(fenAfter(START, path)), S.color);
  const r = addMove(path, san, S.color, replaces);
  path.push(san);
  walk();
  if (r !== "same") Store.save(repDoc(S.color));
  renderBuild();
  if (myMove) autoOpponent(path);
}
// On my turn, a new move where I already have one: add it as another option, or replace one
function showAddOrReplace(newSan, have) {
  const path = curPath();
  const label = esc(moveLabel(path, newSan));
  const list = have.map(m => `<b>${esc(m)}</b>`).join(" and ");
  $("#prompt").innerHTML = `<p class="lbl warn">${have.length > 1 ? "You already have moves here" : "You already have a move here"}</p>
  <p>Your repertoire plays ${list}. Add <b>${label}</b> as another option, or replace ${have.length > 1 ? "one of them" : "it"}? Replacing removes the old move's line.</p>
  <div class="row"><button type="button" class="btn" data-addopt="${esc(newSan)}">Add ${esc(newSan)} as another option</button>
  ${have.map(m => `<button type="button" class="btn ghost" data-replace="${esc(newSan)}" data-old="${esc(m)}">Replace ${esc(m)} with ${esc(newSan)}</button>`).join("")}
  <button type="button" class="btn ghost" data-cancel>Cancel</button></div>`;
}

/* ----- train ----- */
// A session is a queue of position keys. Each card first replays its line from the start
// (board locked, tap to skip), then waits for my move. A miss shows the right move, moves on
// by itself and puts the card back a few places later until it's answered correctly. Only the
// first attempt at each card in a session is graded.
const T = { queue: [], i: 0, key: null, path: [], done: 0, right: 0, retries: 0, graded: new Set(), state: "idle", phase: "", token: 0, timer: null, frames: [] };
const RETRY_GAP = 3; // a missed card comes back after this many other cards
const reduceMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
// setTimeout that does nothing if the card changed or the session ended in the meantime
function later(fn, ms) { const tok = T.token; clearTimeout(T.timer); T.timer = setTimeout(() => { if (tok === T.token && T.state === "run") fn(); }, ms); }
function stopTraining() { T.token++; clearTimeout(T.timer); T.phase = ""; }

function renderTrainHome() {
  if (T.state === "run") return;
  const R = rep();
  walk();
  const cards = Object.values(R.cards);
  const due = dueCards();
  const flagged = Object.values(R.cards).filter(c => c.flag).length;
  const learned = cards.filter(c => c.reps >= 2).length;
  $("#trainHome").hidden = false; $("#trainRun").hidden = true;
  $("#tStats").innerHTML = `
    <div><b class="big num">${due.length}</b><span>due now</span></div>
    <div><b class="big num">${flagged}</b><span>misplayed in games</span></div>
    <div><b class="big num">${learned}<small>/${cards.length}</small></b><span>moves learned</span></div>`;
  $("#tStart").disabled = !cards.length;
  $("#tStart").textContent = due.length ? `Train ${Math.min(due.length, 20)} position${due.length === 1 ? "" : "s"}` : cards.length ? "Nothing due: practise 10 anyway" : "Add moves in Build first";
  if (T.state === "summary") {
    const missed = T.done - T.right;
    $("#tSummary").hidden = false;
    $("#tSummary").innerHTML = `<p><b>${T.right} of ${T.done}</b> right first time.${missed ? ` You went back over ${missed === 1 ? "the one you missed" : `the ${missed} you missed`} until you had ${missed === 1 ? "it" : "them"}, and ${missed === 1 ? "it comes" : "they come"} back for review in about 10 minutes.` : ""}</p>`;
  } else $("#tSummary").hidden = true;
}
function startTraining() {
  let q = dueCards();
  if (!q.length) {
    const R = rep();
    q = Object.entries(R.cards).sort((a, b) => a[1].ef - b[1].ef || a[1].due - b[1].due).slice(0, 10).map(([k]) => k);
  }
  Object.assign(T, { queue: q.slice(0, 20), i: 0, done: 0, right: 0, retries: 0, graded: new Set(), state: "run" });
  nextCard();
}
function endSession() {
  stopTraining();
  T.state = T.done ? "summary" : "idle";
  Store.save(repDoc(S.color));
  renderTrainHome();
}
function nextCard() {
  stopTraining();
  if (T.i >= T.queue.length) return endSession();
  T.key = T.queue[T.i];
  const n = rep().pos[T.key];
  if (!n || !n.m.length || !rep().cards[T.key]) { T.i++; return nextCard(); }
  T.path = n.path ? n.path.split(" ") : [];
  // Board frames for the replay: the position after each move, with that move highlighted
  const c = new Chess();
  T.frames = [{ fen: c.fen(), last: null }];
  for (const m of T.path) { const mv = c.move(m); if (!mv) break; T.frames.push({ fen: c.fen(), last: [mv.from, mv.to] }); }
  renderTrainCard();
  playLine();
}
function renderTrainCard() {
  $("#trainHome").hidden = true; $("#trainRun").hidden = false;
  TB.flip = S.color === "black";
  $("#tLine").innerHTML = lineHtml(T.path, false);
  const op = openingFor(T.path);
  $("#tOpening").textContent = op ? `${op.eco} ${op.name}` : "";
  const left = T.queue.length - T.i;
  $("#tProgress").textContent = `${T.i + 1} / ${T.queue.length}${T.graded.has(T.key) ? " · again" : ""}`;
  $("#tProgress").title = `${left} left in this session`;
}
function cardPrompt() {
  const card = rep().cards[T.key], n = rep().pos[T.key];
  const again = T.graded.has(T.key);
  const tag = again ? '<span class="pill gap">Try again</span> ' : card && card.flag ? '<span class="pill gap">Misplayed in a game</span> ' : "";
  return `<p class="lbl">${tag}Your move as ${S.color === "white" ? "White" : "Black"}</p><p class="muted">${n && n.m.length > 1 ? `Play one of your repertoire moves (you have ${n.m.length} here).` : "Play the move from your repertoire."}</p>`;
}
// Replay the moves from the start, about 250 ms each (faster for long lines). Tap the board to skip.
function playLine() {
  const frames = T.frames;
  if (frames.length <= 1 || reduceMotion()) return showPosition();
  T.phase = "anim";
  TB.locked = true;
  $("#tPrompt").innerHTML = `<p class="lbl">Playing the line</p><p class="muted">Tap the board to skip.</p>`;
  const ms = Math.round(Math.max(120, Math.min(250, 4000 / (frames.length - 1))));
  let i = 0;
  const step = () => {
    TB.set(frames[i].fen, { last: frames[i].last });
    i++;
    if (i < frames.length) later(step, ms); else later(showPosition, ms);
  };
  step();
}
function showPosition() {
  clearTimeout(T.timer);
  const f = T.frames[T.frames.length - 1];
  T.phase = "move";
  TB.locked = false;
  TB.set(f.fen, { last: f.last });
  $("#tPrompt").innerHTML = cardPrompt();
}
function skipLine() { if (T.phase === "anim") showPosition(); }
function onTrainMove(mv) {
  if (T.phase !== "move") return;
  const n = rep().pos[T.key];
  const card = rep().cards[T.key];
  const fenBefore = T.frames[T.frames.length - 1].fen;
  const first = !T.graded.has(T.key);
  T.phase = "feedback";
  TB.locked = true;
  if (first) { T.graded.add(T.key); T.done++; }
  // Any of my prepared moves here is correct (a position can hold several, e.g. 1.e4 and 1.d4)
  const labels = n.m.map(m => `<b>${esc(moveLabel(T.path, m))}</b>`);
  if (n.m.includes(mv.san)) {
    if (first) { T.right++; grade(card, true); Store.save(repDoc(S.color)); }
    const c = new Chess(fenBefore); c.move(mv.san);
    TB.set(c.fen(), { last: [mv.from, mv.to] });
    const others = n.m.filter(m => m !== mv.san);
    $("#tPrompt").innerHTML = `<p class="lbl ok">Correct: ${esc(moveLabel(T.path, mv.san))}</p><p class="muted">${first ? `Next review in ${card.iv} day${card.iv === 1 ? "" : "s"}.` : "Got it this time."}${others.length ? ` Also in your repertoire: ${others.map(esc).join(", ")}.` : ""}</p>`;
    later(() => { T.i++; nextCard(); }, others.length ? 1300 : 900);
  } else {
    if (first) { grade(card, false); Store.save(repDoc(S.color)); }
    const c = new Chess(fenBefore); const good = c.move(n.m[0]);
    TB.set(fenBefore, { bad: [mv.from, mv.to], hint: good ? [good.from, good.to] : null });
    $("#tPrompt").innerHTML = `<p class="lbl warn">Not your repertoire move</p><p>You played ${esc(mv.san)}. ${n.m.length > 1 ? `Your moves here are ${labels.join(" or ")} (the first is highlighted).` : `Your move is ${labels[0]}.`} This position comes back in a few cards.</p>`;
    T.queue.splice(Math.min(T.queue.length, T.i + 1 + RETRY_GAP), 0, T.key);
    T.retries++;
    later(() => { T.i++; nextCard(); }, 1500);
  }
}

/* ----- games ----- */
function renderGames() {
  const color = S.color;
  const A = analysis(color);
  $("#gCount").textContent = `${A.length} rapid game${A.length === 1 ? "" : "s"} as ${color === "white" ? "White" : "Black"}`;
  const typeLabel = { misplay: "You left your prep", you_new: "You had no move ready", opp_new: "Opponent surprised you", end: "Reached the end of your prep", full: "Game ended in book" };
  // summary tiles
  const cnt = t => A.filter(x => x.a.type === t).length;
  const avg = arr => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  const accIn = [], accPost = [];
  for (const { g } of A) { const z = S.acc[g.id]; if (z) { accIn.push(...z.inb); accPost.push(...z.post); } }
  const plies = A.map(x => x.a.ply);
  const avgDepth = plies.length ? (plies.reduce((a, b) => a + b, 0) / plies.length / 2).toFixed(1) : "–";
  $("#gTiles").innerHTML = `
    <div><b class="big num">${avgDepth}</b><span>moves in book on average</span></div>
    <div><b class="big num">${cnt("misplay")}</b><span>games where you left your prep</span></div>
    <div><b class="big num">${avg(accIn) ?? "–"}${avg(accIn) != null ? "<small>%</small>" : ""}</b><span>accuracy on prepared moves</span></div>
    <div><b class="big num">${avg(accPost) ?? "–"}${avg(accPost) != null ? "<small>%</small>" : ""}</b><span>accuracy just after book</span></div>`;
  // exits grouped
  const groups = {};
  for (const x of A) {
    const k = x.a.type + "|" + x.a.key + "|" + (x.a.played || "");
    const gr = groups[k] = groups[k] || { a: x.a, n: 0, score: 0, scored: 0, w: 0, d: 0, l: 0 };
    gr.n++;
    if (x.s != null) { gr.score += x.s; gr.scored++; if (x.s === 1) gr.w++; else if (x.s === 0.5) gr.d++; else gr.l++; }
  }
  const rows = Object.values(groups).sort((a, b) => b.n - a.n).slice(0, 25);
  $("#gExits").innerHTML = rows.length ? rows.map((r, i) => {
    const op = openingFor(r.a.path);
    const mv = r.a.played ? moveLabel(r.a.path, r.a.played) : "";
    const what = r.a.type === "misplay" ? `played ${esc(mv)} instead of ${esc(r.a.expected)}` : r.a.type === "full" ? "" : `then ${esc(mv)}`;
    return `<tr><td><button type="button" class="linkish" data-open="${esc(r.a.path.join(" "))}"><span class="tt">${esc(typeLabel[r.a.type])}</span><span class="sub">${op ? esc(op.name) + " · " : ""}${what}</span></button></td>
      <td class="num">${r.n}</td><td class="num">${r.scored ? Math.round((100 * r.score) / r.scored) + "%" : "–"}</td>
      <td><span class="wdl"><i class="w" style="width:${pct(r.w, r.scored)}%"></i><i class="d" style="width:${pct(r.d, r.scored)}%"></i><i class="l" style="width:${pct(r.l, r.scored)}%"></i></span></td></tr>`;
  }).join("") : `<tr><td colspan="4" class="muted">Import games to see where your prep ends and how those games go.</td></tr>`;
  // conversion by eval at book exit
  const buckets = [["Worse (−1.0 or less)", -1e9, -100], ["Slightly worse", -100, -30], ["Equal (±0.3)", -30, 30], ["Slightly better", 30, 100], ["Better (+1.0 or more)", 100, 1e9]];
  const conv = buckets.map(([label, lo, hi]) => {
    const xs = A.filter(x => S.acc[x.g.id] && x.s != null && S.acc[x.g.id].exitCp >= lo && S.acc[x.g.id].exitCp < hi);
    const sc = xs.reduce((a, x) => a + x.s, 0);
    const w = xs.filter(x => x.s === 1).length, d = xs.filter(x => x.s === 0.5).length, l = xs.length - w - d;
    return { label, n: xs.length, sc: xs.length ? Math.round((100 * sc) / xs.length) : null, w, d, l };
  });
  const anyConv = conv.some(c => c.n);
  $("#gConv").innerHTML = anyConv ? conv.map(c => `<tr><td>${c.label}</td><td class="num">${c.n}</td><td class="num">${c.sc == null ? "–" : c.sc + "%"}</td><td>${c.n ? `<span class="wdl"><i class="w" style="width:${pct(c.w, c.n)}%"></i><i class="d" style="width:${pct(c.d, c.n)}%"></i><i class="l" style="width:${pct(c.l, c.n)}%"></i></span>` : ""}</td></tr>`).join("")
    : `<tr><td colspan="4" class="muted">Run the engine on your games to see how you convert positions coming out of the opening.</td></tr>`;
  const todo = S.games.filter(g => !S.acc[g.id]).length;
  $("#engBtn").textContent = analysing ? "Stop" : todo ? `Analyse all (${todo.toLocaleString("en-GB")} left)` : "All games analysed";
  $("#engBtn").disabled = !todo && !analysing;
  // recent games
  $("#gList").innerHTML = A.slice(0, 15).map(({ g, a, s }) => {
    const opp = g.my === "white" ? g.black : g.white, oe = g.my === "white" ? g.belo : g.welo;
    const res = s === 1 ? '<span class="pill ok">Won</span>' : s === 0.5 ? '<span class="pill">Draw</span>' : s === 0 ? '<span class="pill gap">Lost</span>' : "";
    const z = S.acc[g.id];
    return `<li><button type="button" class="linkish" data-open="${esc(a.path.join(" "))}"><span class="tt">${res} vs ${esc(opp)} <span class="muted">(${oe || "?"})</span></span><span class="sub">${esc(g.date)} · ${esc(typeLabel[a.type])} at move ${Math.floor(a.ply / 2) + 1}${z && z.inb.length ? ` · book accuracy ${Math.round(z.inb.reduce((p, q) => p + q, 0) / z.inb.length)}%` : ""}</span></button></li>`;
  }).join("") || `<li class="muted">No games yet.</li>`;
}
function importPasted() {
  const text = $("#pgnIn").value;
  if (!text.trim()) { toast("Paste one or more games first."); return; }
  if (!S.settings.user.trim()) { toast("Add your chess.com username in Settings so I know which side you played."); return; }
  const list = splitGames(text).map(g => gameFromPGN(g, S.settings.user));
  const mine = list.filter(g => g.my);
  const rapid = mine.filter(g => g.tc === "rapid");
  const added = addGames(list);
  $("#importStatus").textContent = `Read ${list.length} game${list.length === 1 ? "" : "s"}: ${mine.length} with you playing, ${rapid.length} rapid, ${added} new.`;
  $("#pgnIn").value = "";
  warmGameKeys(() => { flagMisplays("white"); flagMisplays("black"); render(); });
  render();
}

/* ----- settings ----- */
const BANDS = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
function renderLook() {
  const set = pieceSet(), theme = S.settings.board || "green";
  const row = ["wK", "bQ", "wN", "bB", "wR", "bP"];
  $("#lookPreview").innerHTML = row.map((x, i) => `<span class="sq${i % 2 ? " dk" : ""}" style="--f:${i};--r:${i % 2 ? 4 : 3}">${pieceHtml({ color: x[0], type: x[1].toLowerCase() }, set)}</span>`).join("");
  $("#pieceSets").innerHTML = PIECE_SETS.map(p => `<button type="button" class="chip lookchip" aria-pressed="${p.id === set}" data-pieces="${p.id}">${pieceHtml({ color: "w", type: "n" }, p.id)}<span>${esc(p.name)}</span></button>`).join("");
  $("#boardThemes").innerHTML = BOARD_THEMES.map(t => `<button type="button" class="chip lookchip" aria-pressed="${t.id === theme}" data-boardtheme="${t.id}"><span class="swatch" data-swatch="${t.id}"><i></i><i></i></span><span>${esc(t.name)}</span></button>`).join("");
  $("#arrowOpt").innerHTML = [["on", "Show"], ["off", "Hide"]].map(([v, l]) => `<button type="button" class="chip" aria-pressed="${(S.settings.arrows !== false) === (v === "on")}" data-arrows="${v}">${l}</button>`).join("");
  $("#autoOpp").value = S.settings.autoOpp || "off";
  $("#pieceCredits").innerHTML = PIECE_SETS.map(p => `<li><b>${esc(p.name)}</b>: ${esc(p.credit)}</li>`).join("");
}
function renderSettings() {
  renderBooks();
  renderLook();
  $("#setUser").value = S.settings.user;
  $("#setToken").value = S.token;
  $("#setMonths").value = String(S.settings.months);
  const gem = { ...gemDefaults(), ...S.settings.gem };
  $("#gemMin").value = gem.min; $("#gemFreq").value = gem.freq; $("#gemEdge").value = gem.edge;
  $("#bands").innerHTML = BANDS.map(b => `<button type="button" class="chip" aria-pressed="${S.settings.band.includes(b)}" data-band="${b}">${b}${b === 2500 ? "+" : "–" + (b === 2200 ? 2499 : b + 199)}</button>`).join("");
  $("#storeNote").textContent = S.storeMode === "db"
    ? "Your repertoire and games are saved to your Claude account, so they follow you between your phone and computer. The Lichess token stays on this device."
    : S.storeMode === "supabase"
    ? `Saved to your database, signed in as ${Store.user && Store.user.email ? Store.user.email : "you"}. Sign in with the same account on another device to pick up where you left off. The Lichess token stays on this device.`
    : "Your data is saved in this browser only. Use Export regularly as a backup.";
  $("#signOut").hidden = S.storeMode !== "supabase";
  $("#signIn").hidden = !(S.storeMode === "local" && window.supabase && !window.claude);
  const w = Object.keys(rep("white").cards).length, b = Object.keys(rep("black").cards).length;
  $("#repCounts").textContent = `White: ${w} of your moves · Black: ${b} of your moves`;
}

/* ---------- prep books ---------- */
const prepBookName = (id = S.book) => (bookList().find(b => b.id === id) || { name: "My prep" }).name;
const bookCount = (id, color) => Object.keys((S.books[id] && S.books[id][color].cards) || {}).length;
function resetWorkspace() {
  stopTraining(); T.state = "idle";
  S.build = { white: [], black: [] };
  walk("white"); walk("black");
}
function switchBook(id) {
  S.settings.book = id; openBook(id); resetWorkspace();
  Store.save("settings");
  renderHeader(); render();
  toast(`Opened "${prepBookName()}".`);
}
function createBook(copy) {
  const id = Date.now().toString(36);
  const list = bookList(); // before the new book exists, so it isn't listed twice
  const name = copy ? `${prepBookName()} (copy)` : `Book ${list.length + 1}`;
  S.books[id] = copy ? JSON.parse(JSON.stringify(S.rep)) : { white: emptyRep(), black: emptyRep() };
  S.settings.books = [...list, { id, name }];
  Store.save(repDoc("white", id)); Store.save(repDoc("black", id));
  switchBook(id);
}
function deleteBook() {
  const id = S.book;
  if (id === "main") return;
  delete S.books[id];
  S.settings.books = bookList().filter(b => b.id !== id);
  Store.save(repDoc("white", id)); Store.save(repDoc("black", id)); // saved as deleted, so other devices drop it too
  switchBook("main");
}
function clearRep(color) {
  S.rep[color] = emptyRep(); S.build[color] = []; stopTraining(); T.state = "idle";
  Store.save(repDoc(color));
  render();
}
function renderBooks() {
  const list = bookList();
  $("#bookList").innerHTML = list.map(b => `<li class="bookrow"><div><b>${esc(b.name)}</b>${b.id === S.book ? ' <span class="pill ok">Open</span>' : ""}
    <div class="help">White: ${bookCount(b.id, "white")} of your moves · Black: ${bookCount(b.id, "black")}</div></div>
    ${b.id === S.book ? "" : `<button type="button" class="btn ghost" data-openbook="${esc(b.id)}">Open</button>`}</li>`).join("");
  $("#bookRename").value = prepBookName();
  $("#bookDelete").hidden = S.book === "main";
  $("#bookConfirm").hidden = true;
}
// Inline "are you sure?" for destructive book actions
function confirmBook(text, label, fn) {
  const box = $("#bookConfirm");
  box.innerHTML = `<p>${text}</p><div class="row"><button type="button" class="btn" id="bcYes">${esc(label)}</button><button type="button" class="btn ghost" id="bcNo">Cancel</button></div>`;
  box.hidden = false;
  $("#bcYes").onclick = () => { box.hidden = true; fn(); };
  $("#bcNo").onclick = () => { box.hidden = true; };
}
function onBookAction(act) {
  const nm = esc(prepBookName());
  if (act === "new") createBook(false);
  else if (act === "copy") createBook(true);
  else if (act === "delete") confirmBook(`Delete the book <b>${nm}</b> with both its repertoires and its training history? This can't be undone. Export it first if you might want it back.`, "Delete book", deleteBook);
  else if (act.startsWith("clear-")) {
    const c = act.slice(6), C = c === "white" ? "White" : "Black";
    confirmBook(`Remove every move from the ${C} repertoire in <b>${nm}</b>, with its training history? Other books aren't affected. Export it first if you might want it back.`, `Clear ${C}`, () => { clearRep(c); renderBooks(); toast(`${C} repertoire cleared.`); });
  }
}

/* ---------- header: open book and save status ---------- */
function renderHeader() { $("#bookName").textContent = prepBookName(); }
const SAVE_TEXT = {
  idle: "", pending: "Unsaved changes…", saving: "Saving…",
  saved: () => `Saved ${new Date(Store.savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
  error: "Not saved yet · tap to retry", device: "Saved on this device",
};
function renderSaveState(state) {
  const el = $("#saveState"), t = SAVE_TEXT[state];
  el.dataset.state = state;
  el.querySelector("span").textContent = typeof t === "function" ? t() : t;
  el.hidden = state === "idle";
}
function onSaveStateTap() {
  const st = Store.status();
  if (st === "error") { toast("Trying to save again…"); Store.flushAll(); return; }
  toast(S.storeMode === "supabase" ? "Changes are saved to your account about a second after you make them, and sent straight away when you leave the app."
    : S.storeMode === "db" ? "Changes are saved to your Claude account about a second after you make them."
    : "You're using the app without an account, so changes are saved in this browser only. Sign in from Settings to sync.");
}

/* ---------- Lichess token: saved in settings so every device has it ---------- */
// Older builds kept it in this browser only (pb_token); that copy is moved into settings once.
function syncToken() {
  const t = S.settings.lichessToken;
  if (t) { S.token = t; lsSet("pb_token", t); }
  else if (S.token) { S.settings.lichessToken = S.token; Store.save("settings"); }
}

/* ---------- wiring ---------- */
async function boot() {
  BB = Board($("#board"));
  TB = Board($("#tBoard"));
  BB.onMove = mv => onBuildMove(mv);
  TB.onMove = mv => onTrainMove(mv);
  Store.onStatus = renderSaveState;
  const state = await Store.init();
  if (state === "auth") await new Promise(res => showAuth(res));
  applyLook(); syncToken(); renderHeader();
  walk("white"); walk("black");
  warmGameKeys(() => { if (!(S.view === "train" && T.state === "run")) render(); }); // game positions, in the background
  $("#loading").hidden = true;
  window.addEventListener("pagehide", () => Store.flushAll());
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") { Store.flushAll(); return; }
    if (await Store.refresh()) { walk("white"); walk("black"); applyLook(); syncToken(); renderHeader(); warmGameKeys(() => render()); if (!(S.view === "train" && T.state === "run")) render(); }
  });
  document.addEventListener("click", e => {
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.nav) { if (S.view === "train" && T.state === "run" && d.nav !== "train") { stopTraining(); T.state = "idle"; } setView(d.nav); }
    else if (d.color) { stopTraining(); S.color = d.color; T.state = "idle"; render(); }
    else if (d.jump) { S.build[S.color] = curPath().slice(0, +d.jump); renderBuild(); }
    else if (d.go) goMove(d.go);
    else if (d.remove) { removeMove(curPath(), d.remove); Store.save(repDoc(S.color)); renderBuild(); toast("Removed " + d.remove + " and the line after it."); }
    else if (d.addopt) commitBuildMove(d.addopt);
    else if ("replace" in d) commitBuildMove(d.replace, d.old);
    else if ("cancel" in d) renderBuild();
    else if (d.arrows) { S.settings.arrows = d.arrows === "on"; Store.save("settings"); renderLook(); }
    else if (d.openbook) switchBook(d.openbook);
    else if (d.bookact) onBookAction(d.bookact);
    else if (d.pieces) { S.settings.pieces = d.pieces; pieceFallback = false; Store.save("settings"); redrawBoards(); renderLook(); }
    else if (d.boardtheme) { S.settings.board = d.boardtheme; Store.save("settings"); redrawBoards(); renderLook(); }
    else if ("scan" in d) scanTree(S.color, onScanTick);
    else if (d.more) { sugOpen[d.more] += 10; renderSuggest(); }
    else if (d.sug) {
      const [id, i] = d.sug.split(":"), r = $("#sugOut")._s[id][+i];
      S.build[S.color] = (id === "struct" ? r.mine : r.path).slice(); renderBuild(); window.scrollTo({ top: 0, behavior: "smooth" });
    }
    else if (d.gap) { const g = $("#gaps")._gaps[+d.gap]; S.build[S.color] = g.path.slice(); renderBuild(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else if ("open" in d) { S.build[S.color] = d.open ? d.open.split(" ") : []; setView("build"); window.scrollTo({ top: 0 }); }
    else if (d.band) {
      const b = +d.band, set = new Set(S.settings.band);
      set.has(b) ? set.delete(b) : set.add(b);
      if (!set.size) { toast("Keep at least one rating band."); return; }
      S.settings.band = [...set].sort((x, y) => x - y); Store.save("settings"); renderSettings();
    }
  });
  $("#back").onclick = () => { curPath().pop(); renderBuild(); };
  $("#fwd").onclick = () => {
    const path = curPath(); const key = K(fenAfter(START, path)); const n = rep().pos[key];
    if (n && n.m.length) { path.push(n.m[0]); renderBuild(); }
  };
  $("#toStart").onclick = () => { S.build[S.color] = []; renderBuild(); };
  $("#engRun").onclick = async () => {
    const fen = fenAfter(START, curPath()); const key = K(fen);
    $("#engOut").innerHTML = `<span class="muted">${Engine.which ? "Thinking…" : "Starting Stockfish (about 7 MB the first time)…"}</span>`;
    try { await Engine.init(); await Engine.analyse(fen, Engine.which === "wasm" ? 20 : 16); saveEvalCache(); } catch (e) { $("#engOut").innerHTML = `<span class="muted">The engine couldn't start in this browser.</span>`; return; }
    if (K(fenAfter(START, curPath())) === key) renderBuild();
  };
  $("#tStart").onclick = startTraining;
  $("#tBoard").addEventListener("click", skipLine); // tap to skip the line replay
  $("#tStop").onclick = endSession;
  $("#fetchBtn").onclick = fetchChessCom;
  $("#pasteBtn").onclick = importPasted;
  $("#pgnFile").onchange = async e => { const f = e.target.files[0]; if (f) { $("#pgnIn").value = await f.text(); importPasted(); } e.target.value = ""; };
  $("#engBtn").onclick = () => analyseGamesWithEngine();
  $("#setUser").onchange = e => {
    const v = e.target.value.trim();
    if (v && !validChessComUser(v)) { toast(USER_HELP); e.target.setAttribute("aria-invalid", "true"); return; }
    e.target.removeAttribute("aria-invalid");
    S.settings.user = v; Store.save("settings");
  };
  $("#setToken").onchange = e => { S.token = e.target.value.trim(); S.settings.lichessToken = S.token; lsSet("pb_token", S.token); Store.save("settings"); explorerBlocked = false; };
  $("#bookRename").onchange = e => { const v = e.target.value.trim(); if (!v) { renderBooks(); return; } S.settings.books = bookList().map(b => (b.id === S.book ? { ...b, name: v } : b)); Store.save("settings"); renderHeader(); renderBooks(); };
  $("#bookName").onclick = () => setView("settings");
  $("#autoOpp").onchange = e => { S.settings.autoOpp = e.target.value; Store.save("settings"); };
  $("#saveState").onclick = onSaveStateTap;
  setInterval(() => { if (Store.status() === "saved") renderSaveState("saved"); }, 30000);
  $("#setMonths").onchange = e => { S.settings.months = +e.target.value; Store.save("settings"); };
  for (const [id, field, lo, hi] of [["gemMin", "min", 50, 100000], ["gemFreq", "freq", 1, 50], ["gemEdge", "edge", 1, 30]]) {
    $("#" + id).onchange = e => {
      const v = Math.round(+e.target.value);
      if (!(v >= lo && v <= hi)) { toast(`Use a number from ${lo} to ${hi}.`); renderSettings(); return; }
      S.settings.gem = { ...gemDefaults(), ...S.settings.gem, [field]: v }; Store.save("settings");
    };
  }
  $("#exportBtn").onclick = () => { $("#ioText").value = exportPGN(S.color); toast(`${S.color === "white" ? "White" : "Black"} repertoire exported below.`); };
  $("#copyBtn").onclick = async () => { const ta = $("#ioText"); try { await navigator.clipboard.writeText(ta.value); toast("Copied."); } catch (e) { ta.select(); toast("Selected: copy it with your keyboard or long-press."); } };
  $("#importRepBtn").onclick = () => {
    const txt = $("#ioText").value; if (!txt.trim()) { toast("Paste a PGN first."); return; }
    const r = importRepertoire(txt, S.color);
    toast(`Added ${r.added} moves${r.options ? ` (${r.options} as extra options where you already had a move)` : ""}${r.bad ? `, ${r.bad} unreadable` : ""}.`);
    renderSettings();
  };
  $("#signOut").onclick = () => Store.signOut();
  $("#signIn").onclick = () => { try { localStorage.removeItem("pb_local_only"); } catch (e) {} location.reload(); };
  $("#clearGames").onclick = () => { $("#confirmClear").hidden = false; };
  $("#confirmNo").onclick = () => { $("#confirmClear").hidden = true; };
  $("#confirmYes").onclick = () => { S.games = []; S.acc = {}; for (const id of Object.keys(S.books)) for (const c of ["white", "black"]) { S.books[id][c].flagged = []; Store.save(repDoc(c, id)); } Store.save("games"); Store.save("acc"); $("#confirmClear").hidden = true; toast("Imported games cleared. Your repertoire is untouched."); };
  setView("build");
}
boot();
