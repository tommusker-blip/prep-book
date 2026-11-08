"use strict";
/* ---------- G4: read the chess.com rapid rating and keep the Lichess bands in step (bandsFor in explore.js) ---------- */
async function fetchRating(force = false) {
  const u = (S.settings.user || "").trim();
  const last = S.settings.ccRating;
  if (!validChessComUser(u) || (!force && last && Date.now() - last.at < 86400000)) return;
  try {
    const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u.toLowerCase())}/stats`);
    if (!r.ok) return;
    const d = await r.json(), rating = d.chess_rapid && d.chess_rapid.last && d.chess_rapid.last.rating;
    if (!rating) return;
    S.settings.ccRating = { r: rating, at: Date.now() };
    const want = bandsFor(rating);
    if (S.settings.bandAuto !== false && want.join(",") !== S.settings.band.join(",")) {
      S.settings.band = want;
      toast(`Lichess rating bands set to ${bandLabel(want)} to match your chess.com rapid rating (${rating}).`);
    }
    Store.save("settings");
    if (S.view === "settings") renderSettings();
  } catch (e) { /* offline or blocked: keep the current bands */ }
}

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
    let added = 0, clocks = 0;
    for (const [i, a] of pick.entries()) {
      st.textContent = `Fetching month ${i + 1} of ${pick.length}…`;
      const rr = await fetch(a);
      if (!rr.ok) continue;
      const { games } = await rr.json();
      const list = games.filter(x => x.rules === "chess" && x.time_class === "rapid" && x.pgn)
        .map(x => { const g = gameFromPGN(x.pgn, u, "rapid"); g.url = x.url || g.url; return g; });
      added += addGames(list); clocks += addGames.clocks;
    }
    st.textContent = `${added ? `Added ${added} new rapid game${added === 1 ? "" : "s"}` : "No new rapid games"}${clocks ? `; clock times added to ${clocks} earlier game${clocks === 1 ? "" : "s"}` : ""}.`;
    warmGameKeys(() => { flagMisplays("white"); flagMisplays("black"); render(); });
    fetchRating(true); // G4: keep the Lichess bands in step with the rating
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
let analysing = false, stopAnalysis = false, anaProg = { done: 0, total: 0 };
const SAVE_EVERY = 20;
// G1: analysis of a whole game (v2). Every position up to GAME_EVAL_PLIES gets a Stockfish
// eval at depth 10 and its best move, for mistake review later (NOTES item 9):
//   {v: 2, d, ev: [cp from White's side, one per position, 0 = start], bm: [best move in UCI],
//    inb, post, exitCp}   (inb/post/exitCp as before: accuracy in book and just after, eval at exit)
// Game evals don't go into the interactive eval cache, so they don't push out Build's results.
const ACC_VERSION = 2, GAME_EVAL_DEPTH = 10, GAME_EVAL_PLIES = 160;
const needsAnalysis = g => !S.acc[g.id] || S.acc[g.id].v !== ACC_VERSION;
async function analyseOne(g) {
  const a = analyseGame(g);
  const moves = g.moves ? g.moves.split(" ") : [];
  const c = new Chess(), fens = [c.fen()];
  for (let i = 0; i < Math.min(moves.length, GAME_EVAL_PLIES); i++) { if (!c.move(moves[i])) break; fens.push(c.fen()); }
  const ev = [], bm = [], mine = []; // mine: evals from my side, for accuracy
  for (const f of fens) {
    const r = await Engine.analyse(f, GAME_EVAL_DEPTH, { cache: false });
    const white = f.split(" ")[1] === "w" ? r.cp : -r.cp;
    ev.push(Math.round(white)); bm.push(r.best || "");
    mine.push(g.my === "white" ? white : -white);
  }
  const plies = fens.length - 1, inb = [], post = [];
  for (let i = 0; i < Math.min(plies, a.ply + 8); i++) {
    if (!isMine(K(fens[i]), g.my)) continue;
    (i < a.ply ? inb : post).push(Math.round(moveAcc(mine[i], mine[i + 1])));
  }
  const exitCp = mine[Math.min(a.ply, plies)];
  return { v: ACC_VERSION, d: GAME_EVAL_DEPTH, ev, bm, inb, post, exitCp: Math.round(exitCp) };
}
async function analyseGamesWithEngine() {
  if (analysing) { stopAnalysis = true; $("#engStatus").textContent = "Stopping after this game…"; return; }
  const todo = S.games.filter(needsAnalysis);
  if (!todo.length) { toast("All imported games are analysed."); return; }
  analysing = true; stopAnalysis = false;
  const st = $("#engStatus");
  // Saved through Games (G1): one row per game in the games table, or the old "acc" doc
  const persist = () => { saveEvalCache(); Games.mark(analysed.splice(0)); Store.save("acc"); };
  const analysed = [];
  let done = 0;
  anaProg = { done: 0, total: todo.length };
  render();
  try {
    if (!Engine.which) st.textContent = "Starting Stockfish (about 7 MB the first time)…";
    await Engine.init();
    for (const g of todo) {
      if (stopAnalysis) break;
      st.textContent = `Analysing game ${done + 1} of ${todo.length}${g.date ? ` (${g.date})` : ""}…`;
      S.acc[g.id] = await analyseOne(g);
      analysed.push(g.id);
      done++; anaProg = { done, total: todo.length }; renderBg();
      if (done % SAVE_EVERY === 0) { persist(); if (S.view === "games") renderGames(); }
    }
    st.textContent = stopAnalysis
      ? `Stopped. Analysed ${done} game${done === 1 ? "" : "s"}; ${todo.length - done} left for next time.`
      : `Analysed ${done} game${done === 1 ? "" : "s"}. All imported games are done.`;
  } catch (e) {
    st.textContent = done ? `Stopped after ${done} games: the engine failed. Tap again to carry on.` : "The engine couldn't start in this browser.";
  }
  persist();
  analysing = false; stopAnalysis = false; renderBg();
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
// For queued work about the Build position with this key: true once the user has moved on
const notHere = key => () => S.view !== "build" || K(fenAfter(START, curPath()) || START) !== key;
function renderBuild() {
  const path = curPath();
  const fen = fenAfter(START, path) || START;
  const key = K(fen);
  BB.flip = S.color === "black";
  let last = null;
  if (path.length) { const c = new Chess(fenAfter(START, path.slice(0, -1))); const mv = c.move(path[path.length - 1]); if (mv) last = [mv.from, mv.to]; }
  const n = rep().pos[key];
  BB.set(fen, { last, arrows: buildArrows(fen, key, n) });
  BB.el.classList.toggle("exploring", exploring());
  document.querySelectorAll("[data-bmode]").forEach(b => b.setAttribute("aria-pressed", String(exploring())));
  showPane();
  // line strip
  $("#line").innerHTML = lineHtml(path, true);
  // "Practise from here" (item 3): for a position in the tree with my moves below it
  const branch = path.length ? branchInfo(S.color)[key] : null;
  $("#buildActions").innerHTML = branch && branch.cards ? `<button type="button" class="btn ghost" data-practicehere>Practise from here (${branch.cards} move${branch.cards === 1 ? "" : "s"})</button>` : "";
  const op = openingFor(path);
  const ex = cachedExplorer(fen);
  $("#opName").innerHTML = op ? `<span class="eco">${esc(op.eco)}</span> ${esc(op.name)}` : (path.length ? "Unnamed line" : "Starting position");
  const oi = $("#opInfo"); oi.hidden = !(op && op.idea); if (op && op.idea) oi.dataset.tip = op.idea;
  // prompt
  const mine = isMine(key, S.color);
  const pr = $("#prompt");
  if (mine) {
    if (n && n.m.length) {
      const many = n.m.length > 1;
      pr.innerHTML = `<p class="lbl">${many ? `Your moves (${n.m.length} options)` : "Your move"} ${exploring() ? "" : info(`Tap a move to follow it. Play a different move on the board to add it as ${many ? "another" : "a second"} option or to replace one of these. Remove takes the move out with the line after it.`, "About your moves")}</p>
      <ul class="mymoves">${n.m.map(m => `<li><button type="button" class="chip big" data-go="${esc(m)}">${esc(moveLabel(path, m))}</button>${exploring() ? "" : `<button type="button" class="btn ghost" data-remove="${esc(m)}" aria-label="Remove ${esc(m)} and the line after it">Remove</button>`}</li>`).join("")}</ul>`;
    } else {
      pr.innerHTML = exploring() ? `<p class="lbl">Your move</p><p class="help">Not in your repertoire yet.</p>` : `<p class="lbl warn">No prep yet: play your move on the board</p>`;
    }
    pr.innerHTML += candRows(fen, key, n, path);
  } else {
    pr.innerHTML = `<p class="lbl">Opponent's options</p>${quickOppButtons(fen, key, n)}${candRows(fen, key, n, path)}`;
  }
  if (exploring()) pr.innerHTML = exploreBar() + pr.innerHTML;
  // Ideas tab: only for positions where it's my move; only built while the tab is open
  if (S.ptab === "ideas") $("#ideasCard").innerHTML = mine ? ideasPanel(fen, key, n, path) : `<p class="help">Ideas are for positions where it's your move. Play the opponent's reply, or go back one move.</p>`;
  if (!ex && S.token && !explorerBlocked) explorer(fen, { prio: PRIO.now, stale: notHere(key) }).then(d => { if (d && S.view === "build" && K(fenAfter(START, curPath()) || START) === key) renderBuild(); });
  renderGaps();
  renderSuggest();
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
  if (!cachedExplorer(fen)) await explorer(fen, { prio: PRIO.now });
  const same = () => S.view === "build" && curPath() === path && curPath().join(" ") === path.join(" ");
  if (!same()) return;
  const p = pickOpp(fen, key, rep().pos[key], mode);
  if (!p) return;
  setTimeout(() => { if (same()) goMove(p.san); }, 450);
}

/* ----- my turn: what I play here, and is it any good? ----- */
// Stockfish verdict on a move: centipawns lost against the best move (depth 14, cached)
/* ----- my turn: practical, memorable ideas (js/ideas.js) ----- */
let ideaRun = null; // {key, step} while "Find ideas here" is working
const pawns = cp => (cp >= 0 ? "+" : "−") + (Math.abs(cp) / 100).toFixed(1);
function ideaWhy(c, m) {
  const out = [];
  if (m.joins && m.transP >= 0.2) out.push(`${Math.round(m.transP * 100)}% of replies lead into your prep (${esc(m.joins.join(" ") || "start")})`);
  if (m.like && m.setup >= 0.6) { const op = openingFor(m.like); out.push(`same setup as your ${esc(op ? op.name.split(":")[0] : "other line")} (${Math.round(m.setup * 100)}%)`); }
  if (c.err != null && c.cover) {
    const good = c.replies.filter(r => !r.mistake).map(r => r.san), bad = c.replies.filter(r => r.mistake).map(r => r.san);
    if (c.err < 0.1) out.push("opponents rarely go wrong");
    else out.push(`${Math.round(c.err * 100)}% of opponents go wrong (${bad.map(esc).join(", ")}?)${good.length ? `; ${good.map(esc).join(", ")} hold${good.length === 1 ? "s" : ""}` : ""}`);
  }
  if (c.peer) out.push(`you score ${Math.round(c.peer.sc * 100)}% (${c.peer.n.toLocaleString("en-GB")} games)`);
  return out.join(" · ");
}
function ideasPanel(fen, key, n, path) {
  const res = cachedIdeas(fen), mine = n ? n.m : [];
  const head = `<p class="lbl">Ideas for this position ${info(`Checks the moves played here for how memorable they are (they lead back into your prep, or build the same setup as your other lines) and how practical (how often opponents at your level go wrong against them). Engine is from your side. "Go wrong" is the share of replies played at your level that give you at least ${(MISTAKE_CP / 100).toFixed(1)} pawns more than their best defence. "Fits your prep" combines the chance of transposing into your lines with how alike the setup is to your other lines.`, "About ideas")}</p>`;
  if (ideaRun && ideaRun.key === key) return `${head}<p class="help" aria-live="polite">Working: ${esc(ideaRun.step)}… (Lichess lookups go at about one a second)</p>`;
  if (!res) {
    if (Engine.failed) return "";
    return `${head}<div class="row" style="margin:6px 0 0"><button type="button" class="btn ghost" data-ideas="here">Find ideas here (10–20 s)</button></div>`;
  }
  const rows = res.cands.slice().sort((a, b) => a.loss - b.loss).map(c => {
    const { tags, m } = ideaTags(c, path);
    const pills = [mine.includes(c.san) ? '<span class="pill ok">Yours</span>' : "",
      tags.includes("memorable") ? '<span class="pill ok">Easy to remember</span>' : "",
      tags.includes("trick") ? '<span class="pill gem">Practical trick</span>' : "",
      tags.includes("gem") ? '<span class="pill gem">Hidden gem</span>' : "",
      c.engineBest ? '<span class="pill">Engine’s choice</span>' : "", c.top ? '<span class="pill">Most played</span>' : ""].join("");
    return `<tr><td><button type="button" class="chip" data-go="${esc(c.san)}">${esc(c.san)}</button><div class="tags">${pills}</div></td>
      <td class="num">${pawns(c.myEval)}<br><span class="muted">${c.loss >= 5 ? "−" + (c.loss / 100).toFixed(1) : "best"}</span></td>
      <td class="num">${c.err == null ? "–" : Math.round(c.err * 100) + "%"}</td>
      <td class="num">${Math.round(m.score * 100)}%</td></tr>
      <tr class="why"><td colspan="4">${ideaWhy(c, m) || ""}</td></tr>`;
  }).join("");
  return `${head}<div class="tblwrap"><table class="yours"><thead><tr><th>Move</th><th class="num">Engine<br>(vs best)</th><th class="num">Opponents<br>go wrong</th><th class="num">Fits your<br>prep</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="src"><button type="button" class="linkbtn" data-ideas="here">Check again</button></p>`;
}
async function findIdeasHere() {
  const path = curPath().slice(), fen = fenAfter(START, path), key = K(fen);
  if (ideaRun) return;
  ideaRun = { key, step: "starting the engine" };
  renderBuild();
  try {
    await analyseIdeas(fen, S.color, step => {
      ideaRun.step = step;
      if (S.view === "build" && K(fenAfter(START, curPath()) || START) === key) { const p = $("#ideasCard [aria-live]"); if (p) p.textContent = `Working: ${step}… (Lichess lookups go at about one a second)`; }
    }, () => false, PRIO.soon);
  } catch (e) { toast("The engine couldn't run in this browser."); }
  ideaRun = null;
  if (S.view === "build") renderBuild();
}
const srcLine = ex => `Lichess rapid, ${S.settings.band.map(b => b + "+").join(" & ")}, ${ex.total.toLocaleString("en-GB")} games`;
function lineHtml(path, clickable) {
  if (!path.length) return `<span class="muted">Start position. ${S.color === "white" ? "Choose your first move." : "Add the first moves you face as Black."}</span>`;
  return path.map((m, i) => {
    const num = i % 2 === 0 ? `<span class="mn">${i / 2 + 1}.</span>` : "";
    return `${num}<button type="button" class="mv${i === path.length - 1 ? " cur" : ""}" ${clickable ? `data-jump="${i + 1}"` : "disabled"}>${esc(m)}</button>`;
  }).join("");
}

/* ----- suggestions from Lichess (scan, hidden gems, transpositions, structures, alternatives) ----- */
let sugOpen = { memorable: 6, trick: 6, gems: 6, better: 6, trans: 6, struct: 6 };
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
  renderScanBox(); renderIdeaBox();
  const out = $("#sugOut");
  if (!S.token) { out.innerHTML = ""; return; }
  const s = suggestions();
  const pc = x => Math.round(x * 100) + "%";
  const section = (id, title, help, rows, fmt) => {
    if (!rows.length) return "";
    const shown = rows.slice(0, sugOpen[id]);
    return `<h4 class="lbl" style="margin-top:14px">${title} <span class="muted">(${rows.length})</span> ${info(help, "About " + title)}</h4>
      <ol class="gaplist">${shown.map((r, i) => `<li>${fmt(r, i)}</li>`).join("")}</ol>
      ${rows.length > shown.length ? `<button type="button" class="btn ghost" data-more="${id}">Show more</button>` : ""}`;
  };
  const row = (id, i, title, line, detail) => `<button type="button" class="gap-row" data-sug="${id}:${i}"><span class="gt">${title}</span><span class="gl mono">${esc(line || "start")}</span><span class="gd">${detail}</span></button>`;
  const ti = treeIdeas();
  s.memorable = ti.memorable; s.trick = ti.trick;
  const html =
    section("memorable", "Easy to remember", "Sound moves (Stockfish rates them OK or better) that lead back into your prep or build the same setup as your other lines. From \"Find ideas\".", ti.memorable,
      (r, i) => row("memorable", i, `${esc(moveLabel(r.path, r.c.san))} · fits your prep ${pc(r.m.score)}`, r.path.join(" "), ideaWhy(r.c, r.m))) +
    section("trick", "Practical tricks", "Not the most played move or the engine's choice, but opponents at your level often go wrong against them. A little worse for the engine is accepted. From \"Find ideas\".", ti.trick,
      (r, i) => row("trick", i, `${esc(moveLabel(r.path, r.c.san))} · ${pc(r.c.err)} go wrong`, r.path.join(" "), `engine ${pawns(r.c.myEval)} (${r.c.loss >= 5 ? "−" + (r.c.loss / 100).toFixed(1) + " vs best" : "best"}) · ${ideaWhy(r.c, r.m)}`)) +
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
  renderBg();
  if (S.view !== "build") return;
  if (finished) renderBuild(); else renderScanBox();
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
    ? `${todo} of your move positions haven't been checked for easy-to-remember moves and practical tricks.`
    : "Every position where it's your move has been checked for ideas."}</span>
    ${todo ? `<button type="button" class="btn ghost" data-ideas="tree">Find ideas across my tree (about ${Math.max(1, Math.round(todo * 15 / 60))} min)</button>` : ""}</div>`;
}
function onIdeaTick(finished) {
  renderBg();
  if (S.view !== "build") return;
  if (finished) renderBuild(); else renderIdeaBox();
}
function goMove(san) {
  const path = curPath();
  const fen = fenAfter(START, path);
  const c = new Chess(fen);
  const mv = c.move(san, { sloppy: true });
  if (!mv) return;
  onBuildMove(mv);
}
/* ----- Explore and Commit modes (NOTES item 6) -----
   Commit: every move played in Build goes into the repertoire (as before).
   Explore: nothing is saved. Moves for either side just extend the explored line
   (S.explore[color]), Back and Next step through it, and all the statistics and the engine
   follow along. The explored line can then be saved whole, or up to the current position
   (switching to Commit there). Where the line plays a different move of mine than the
   repertoire has, the user chooses: add it as another option, or replace mine. */
const exploring = () => S.buildMode === "explore";
// Build's panel tabs (Moves, Gaps, Ideas, Lichess): one section at a time, so on a phone the
// board and the section stay close together
function showPane() {
  const tab = S.ptab || "moves";
  document.querySelectorAll("[data-ptab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.ptab === tab)));
  document.querySelectorAll("[data-pane]").forEach(p => (p.hidden = p.dataset.pane !== tab));
}
function setBuildMode(mode) {
  S.buildMode = mode;
  if (mode === "explore") S.explore = { ...(S.explore || {}), [S.color]: curPath().slice() };
  renderBuild();
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
// Save an explored line into the repertoire. how: "add" (extra options) or "replace"
function saveLine(moves, how = "add") {
  const color = S.color, conflicts = new Map(lineConflicts(moves, color).map(c => [c.i, c]));
  for (let i = 0; i < moves.length; i++) {
    const c = conflicts.get(i);
    addMove(moves.slice(0, i), moves[i], color, c && how === "replace" ? c.have[0] : null);
  }
  walk(color);
  Store.save(repDoc(color));
}
function exploreSave(whole) {
  const line = whole ? (S.explore[S.color] || curPath()) : curPath();
  const moves = line.slice(), conflicts = lineConflicts(moves);
  const done = how => {
    saveLine(moves, how);
    if (!whole) S.buildMode = "commit";
    toast(whole ? `Saved the line (${moves.length} moves) to your repertoire.` : "Saved up to here. You're building again: moves are saved.");
    renderBuild();
  };
  if (!conflicts.length) return done("add");
  const list = conflicts.map(c => `${esc(moveLabel(c.path, c.san))} where you play ${c.have.map(esc).join(" / ")}`).join("; ");
  $("#prompt").innerHTML = `<p class="lbl warn">This line changes your repertoire</p><p>It plays ${list}. Add ${conflicts.length === 1 ? "it" : "them"} as another option, or replace yours (the old line after it is removed)?</p>
    <div class="row"><button type="button" class="btn" data-exsave="add" data-whole="${whole ? 1 : 0}">Add as another option</button>
    <button type="button" class="btn ghost" data-exsave="replace" data-whole="${whole ? 1 : 0}">Replace mine</button><button type="button" class="btn ghost" data-cancel>Cancel</button></div>`;
  $("#prompt")._exsave = done;
}
function exploreBar() {
  if (!exploring()) return "";
  const line = S.explore[S.color] || [], path = curPath(), beyond = line.length > path.length;
  return `<div class="explorebar"><p class="lbl warn">Exploring: nothing is saved ${info("Play moves for either side, and use Back and Next to step through the line. The statistics and the engine follow along. Save the line when you like it.", "About exploring")}</p>
    <div class="row" style="margin:6px 0 0">${line.length ? `<button type="button" class="btn ghost" data-exwhole>Save this whole line${beyond ? ` (${line.length} moves)` : ""}</button>` : ""}
      ${path.length ? `<button type="button" class="btn ghost" data-exhere>Save up to here and keep building</button>` : ""}</div></div>`;
}

function onBuildMove(mv) {
  const path = curPath();
  if (exploring()) { // just extend the explored line
    const line = S.explore[S.color] || [];
    path.push(mv.san);
    // keep the rest of the explored line if this is the move it already had
    S.explore[S.color] = line.length >= path.length && line[path.length - 1] === mv.san && line.slice(0, path.length).join(" ") === path.join(" ") ? line : path.slice();
    renderBuild();
    return;
  }
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
    $("#tSummary").innerHTML = T.mode === "lines"
      ? `<p>Practised <b>${Math.min(T.lineNo, T.lines)} line${T.lineNo === 1 ? "" : "s"}</b>: <b>${T.right} of ${T.done}</b> of your moves right first time.${missed ? ` The ${missed === 1 ? "position you missed comes" : `${missed} positions you missed come`} back for review in about 10 minutes.` : ""}</p>`
      : `<p><b>${T.right} of ${T.done}</b> right first time.${missed ? ` You went back over ${missed === 1 ? "the one you missed" : `the ${missed} you missed`} until you had ${missed === 1 ? "it" : "them"}, and ${missed === 1 ? "it comes" : "they come"} back for review in about 10 minutes.` : ""}</p>`;
  } else $("#tSummary").hidden = true;
  // Practise lines: from the start, or from the position picked in Build (item 3)
  const root = practiceRoot(), here = root.length ? openingFor(root) : null;
  $("#tRoot").innerHTML = root.length
    ? `Starting from <b class="mono">${esc(root.map((m, i) => (i % 2 ? "" : i / 2 + 1 + ". ") + m).join(" "))}</b>${here ? ` (${esc(here.name)})` : ""}.`
    : `Starting from the beginning. To practise one part of your repertoire, open a position in Build and choose "Practise from here".`;
  $("#tRootReset").hidden = !root.length;
  $("#tLines").disabled = !cards.length;
}
function startTraining() {
  let q = dueCards();
  if (!q.length) {
    const R = rep();
    q = Object.entries(R.cards).sort((a, b) => a[1].ef - b[1].ef || a[1].due - b[1].due).slice(0, 10).map(([k]) => k);
  }
  Object.assign(T, { mode: "cards", queue: q.slice(0, 20), i: 0, done: 0, right: 0, retries: 0, graded: new Set(), state: "run" });
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
  if (T.mode === "lines") {
    $("#tProgress").textContent = `Line ${Math.min(T.lineNo + 1, T.lines)} / ${T.lines}${T.retryLine ? " · retry" : ""}`;
    $("#tProgress").dataset.tip = `${T.done} moves so far, ${T.right} right first time${T.retry.length ? `; ${T.retry.length} to retry` : ""}`;
    return;
  }
  const left = T.queue.length - T.i;
  $("#tProgress").textContent = `${T.i + 1} / ${T.queue.length}${T.graded.has(T.key) ? " · again" : ""}`;
  $("#tProgress").dataset.tip = `${left} left in this session`;
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
  if (frames.length <= 1 || reduceMotion()) return T.mode === "lines" ? stepLine() : showPosition();
  T.phase = "anim"; T.runup = true;
  TB.locked = true;
  $("#tPrompt").innerHTML = `<p class="lbl">Playing the line</p><p class="muted">Tap the board to skip.</p>`;
  const ms = Math.round(Math.max(120, Math.min(250, 4000 / (frames.length - 1))));
  let i = 0;
  const step = () => {
    TB.set(frames[i].fen, { last: frames[i].last });
    i++;
    if (i < frames.length) later(step, ms); else later(() => { T.runup = false; if (T.mode === "lines") stepLine(); else showPosition(); }, ms);
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
function skipLine() { if (T.phase === "anim" && T.runup) { T.runup = false; if (T.mode === "lines") stepLine(); else showPosition(); } }

/* ----- practise lines (NOTES items 2 and 3) -----
   Whole lines from a starting position (the start, or one picked in Build): I play my moves,
   the app plays the opponent's, chosen by pickReply() (practice.js) so every branch comes up.
   Grading is the same as for single positions: the first attempt at each position this
   session counts. A miss shows the right move, the line carries on with it, and that position
   is the start of a line two lines later. */
const LINES_PER_SESSION = 10, LINE_RETRY_AFTER = 2;
const framesTo = path => { const c = new Chess(), fr = [{ fen: c.fen(), last: null }]; for (const m of path) { const mv = c.move(m); if (!mv) break; fr.push({ fen: c.fen(), last: [mv.from, mv.to] }); } return fr; };
function startLines() {
  stopTraining();
  Object.assign(T, { mode: "lines", state: "run", done: 0, right: 0, retries: 0, graded: new Set(), lineNo: 0, lines: LINES_PER_SESSION,
    root: practiceRoot(), retry: [], session: { visited: new Set(), recent: {} }, info: branchInfo(S.color), key: null });
  nextLine();
}
function nextLine() {
  stopTraining();
  const i = T.retry.findIndex(r => r.at <= T.lineNo || T.lineNo >= T.lines); // after the last line, finish the retries
  if (T.lineNo >= T.lines && i < 0) return endSession();
  T.retryLine = i >= 0;
  T.path = (i >= 0 ? T.retry.splice(i, 1)[0].path : T.root).slice();
  T.key = null;
  T.frames = framesTo(T.path);
  renderTrainCard();
  if (T.frames.length <= 1) return stepLine();
  playLine();
}
// Advance the line: end it, wait for my move, or play the opponent's reply
function stepLine() {
  clearTimeout(T.timer);
  const fen = fenAfter(START, T.path), key = K(fen), n = rep().pos[key], f = framesTo(T.path).pop();
  T.frames = [f];
  TB.set(fen, { last: f.last });
  renderTrainCard();
  if (!n || !n.m.length) { // the end of this line
    T.session.visited.add(key); T.lineNo++;
    T.phase = "feedback"; TB.locked = true;
    $("#tPrompt").innerHTML = `<p class="lbl ok">End of the line</p><p class="muted">${T.lineNo < T.lines || T.retry.length ? "Next line…" : "That was the last one."}</p>`;
    return later(nextLine, 1100);
  }
  if (isMine(key, S.color)) { T.key = key; T.phase = "move"; TB.locked = false; $("#tPrompt").innerHTML = cardPrompt(); return; }
  const san = pickReply(fen, key, S.color, T.session, T.info);
  notePick(T.session, key, san);
  T.phase = "opp"; TB.locked = true;
  $("#tPrompt").innerHTML = `<p class="lbl">Your opponent plays ${esc(moveLabel(T.path, san))}</p>`;
  later(() => { T.path.push(san); stepLine(); }, 550);
}
function onTrainMove(mv) {
  if (T.phase !== "move") return;
  if (T.mode === "lines") return onLineMove(mv);
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
// My move while practising a line: graded like a single position, then the line goes on
function onLineMove(mv) {
  const n = rep().pos[T.key], card = rep().cards[T.key], fenBefore = T.frames[T.frames.length - 1].fen;
  const first = !T.graded.has(T.key);
  T.phase = "feedback"; TB.locked = true;
  if (first) { T.graded.add(T.key); T.done++; }
  if (n.m.includes(mv.san)) {
    if (first) { T.right++; grade(card, true); Store.save(repDoc(S.color)); }
    $("#tPrompt").innerHTML = `<p class="lbl ok">Correct: ${esc(moveLabel(T.path, mv.san))}</p>`;
    T.path.push(mv.san);
    return later(stepLine, 350);
  }
  if (first) { grade(card, false); Store.save(repDoc(S.color)); }
  const c = new Chess(fenBefore), good = c.move(n.m[0]);
  TB.set(fenBefore, { bad: [mv.from, mv.to], hint: good ? [good.from, good.to] : null, animate: false });
  const labels = n.m.map(m => `<b>${esc(moveLabel(T.path, m))}</b>`);
  $("#tPrompt").innerHTML = `<p class="lbl warn">Not your repertoire move</p><p>You played ${esc(mv.san)}. ${n.m.length > 1 ? `Your moves here are ${labels.join(" or ")}.` : `Your move is ${labels[0]}.`} The line carries on with it, and this position comes back in a later line.</p>`;
  T.retry.push({ path: T.path.slice(), at: T.lineNo + LINE_RETRY_AFTER });
  T.retries++;
  later(() => { T.path.push(n.m[0]); stepLine(); }, 1500);
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
      <td>${barFor({ w: r.w, d: r.d, l: r.l }, "Your games from here")}</td></tr>`;
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
  $("#gConv").innerHTML = anyConv ? conv.map(c => `<tr><td>${c.label}</td><td class="num">${c.n}</td><td class="num">${c.sc == null ? "–" : c.sc + "%"}</td><td>${c.n ? barFor(c, "Your games") : ""}</td></tr>`).join("")
    : `<tr><td colspan="4" class="muted">Run the engine on your games to see how you convert positions coming out of the opening.</td></tr>`;
  const todo = S.games.filter(needsAnalysis).length;
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
  $("#gemTrapErr").value = gem.trapErr ?? 30; $("#gemTrapLoss").value = ((gem.trapLoss ?? 150) / 100).toFixed(1);
  const a = adv();
  $("#advGood").value = (a.good / 100).toFixed(1); $("#advMistake").value = (a.mistake / 100).toFixed(1); $("#advClock").value = a.clock; $("#advK").value = a.k;
  const cc = S.settings.ccRating, sug = cc ? bandsFor(cc.r) : null;
  $("#bandHint").innerHTML = !cc ? (validChessComUser(S.settings.user || "") ? "Your chess.com rating will be checked to suggest bands." : "Add your chess.com username to get bands that match your rating.")
    : `Your chess.com rapid rating is <b>${cc.r}</b>, which suggests Lichess <b>${bandLabel(sug)}</b>. ` + (S.settings.bandAuto === false
      ? `You've set the bands by hand. <button type="button" class="linkbtn" data-bandauto>Follow my rating again</button>`
      : "The bands follow your rating automatically; tap a band to set them by hand.");
  $("#bands").innerHTML =BANDS.map(b => `<button type="button" class="chip" aria-pressed="${S.settings.band.includes(b)}" data-band="${b}">${b}${b === 2500 ? "+" : "–" + (b === 2200 ? 2499 : b + 199)}</button>`).join("");
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

/* ---------- header: background work in progress (any screen) ---------- */
// Shows the long job that's running, with progress; tapping it opens that job's screen
function renderBg() {
  const el = $("#bgState");
  if (!el) return;
  const n = x => x.toLocaleString("en-GB");
  let text = "", view = "";
  if (analysing) { text = `Analysing games ${n(anaProg.done)} / ${n(anaProg.total)}`; view = "games"; }
  else if (Scan.running) { text = `Lichess scan ${n(Scan.done)} / ${n(Scan.total)}`; view = "build"; }
  else if (IdeaJob.running) { text = `Finding ideas ${n(IdeaJob.done)} / ${n(IdeaJob.total)}`; view = "build"; }
  el.hidden = !text;
  el.querySelector("span").textContent = text;
  el.dataset.view = view;
  el.setAttribute("aria-label", text ? `${text}. Open ${view === "games" ? "Games" : "Build"}` : "");
}

/* ---------- header: open book and save status ---------- */
function renderHeader() { $("#bookName").textContent = prepBookName(); }
const SAVE_TEXT = {
  idle: "", pending: "Unsaved changes…", saving: "Saving…",
  saved: () => `Saved ${new Date(Store.savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
  error: "Not saved · tap to retry", device: "Saved locally",
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
  fetchRating(); // G4, at most once a day, in the background
  walk("white"); walk("black");
  warmGameKeys(() => { if (!(S.view === "train" && T.state === "run")) render(); }); // game positions, in the background
  $("#loading").hidden = true;
  window.addEventListener("pagehide", () => Store.flushAll());
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") { Store.flushAll(); return; }
    const docsChanged = await Store.refresh(), gamesChanged = await Games.refresh(); // games after settings (gamesEpoch)
    if (docsChanged || gamesChanged) { walk("white"); walk("black"); applyLook(); syncToken(); renderHeader(); warmGameKeys(() => render()); if (!(S.view === "train" && T.state === "run")) render(); }
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
    else if (d.ideas === "here") findIdeasHere();
    else if (d.ideas === "tree") findIdeasInTree(S.color, onIdeaTick);
    else if (d.more) { sugOpen[d.more] += 10; renderSuggest(); }
    else if (d.sug) {
      const [id, i] = d.sug.split(":"), r = $("#sugOut")._s[id][+i];
      S.build[S.color] = (id === "struct" ? r.mine : r.path).slice(); renderBuild(); window.scrollTo({ top: 0, behavior: "smooth" });
    }
    else if (d.bmode) setBuildMode(exploring() ? "commit" : "explore");
    else if (d.ptab) { S.ptab = d.ptab; showPane(); if (d.ptab === "ideas" || d.ptab === "gaps" || d.ptab === "lichess") renderBuild(); }
    else if ("exwhole" in d) exploreSave(true);
    else if ("exhere" in d) exploreSave(false);
    else if (d.exsave) { const done = $("#prompt")._exsave; if (done) done(d.exsave); }
    else if ("practicehere" in d) { S.settings.practiceRoot = { ...(S.settings.practiceRoot || {}), [S.color]: curPath().slice() }; Store.save("settings"); setView("train"); startLines(); }
    else if (d.nextgap) jumpToGap(d.nextgap);
    else if (d.gapmode) { S.settings.gapMode = d.gapmode; gapLast = null; Store.save("settings"); renderGaps(); }
    else if ("open" in d) { S.build[S.color] = d.open ? d.open.split(" ") : []; setView("build"); window.scrollTo({ top: 0 }); }
    else if ("bandauto" in d) { S.settings.bandAuto = true; Store.save("settings"); if (S.settings.ccRating) { S.settings.band = bandsFor(S.settings.ccRating.r); } fetchRating(true); renderSettings(); }
    else if (d.band) {
      const b = +d.band, set = new Set(S.settings.band);
      set.has(b) ? set.delete(b) : set.add(b);
      if (!set.size) { toast("Keep at least one rating band."); return; }
      S.settings.band = [...set].sort((x, y) => x - y); S.settings.bandAuto = false; Store.save("settings"); renderSettings();
    }
  });
  $("#back").onclick = () => { curPath().pop(); renderBuild(); };
  $("#fwd").onclick = () => {
    if (exploring()) { const line = S.explore[S.color] || [], path = curPath(); if (line.length > path.length && line.slice(0, path.length).join(" ") === path.join(" ")) { path.push(line[path.length]); renderBuild(); return; } }
    const path = curPath(); const key = K(fenAfter(START, path)); const n = rep().pos[key];
    if (n && n.m.length) { path.push(n.m[0]); renderBuild(); }
  };
  $("#toStart").onclick = () => { S.build[S.color] = []; renderBuild(); };
  $("#quickGap").onclick = () => { const t = nextGapTarget(rankedGaps()); if (t) { S.ptab = "moves"; jumpToGap(t.id); } else toast("No gaps found in the positions checked so far."); };
  // Build rows (rows.js): tap a row to expand it; the move button inside plays the move
  Tip.init();
  // Keep --hdr at the header's height, so the pinned Build board sits just under it
  const hdr = document.querySelector(".top"), setHdr = () => document.documentElement.style.setProperty("--hdr", hdr.offsetHeight + "px");
  setHdr(); if (window.ResizeObserver) new ResizeObserver(setHdr).observe(hdr);
  const toggleCand = san => { const id = K(fenAfter(START, curPath()) || START) + "|" + san; if (candOpen.has(id)) candOpen.delete(id); else candOpen.add(id); renderBuild(); };
  $("#prompt").addEventListener("click", e => { if (e.target.closest("button, a, [data-tip]")) return; const row = e.target.closest(".cand"); if (row) toggleCand(row.dataset.cand); });
  $("#prompt").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("cand")) { e.preventDefault(); toggleCand(e.target.dataset.cand); } });
  $("#tStart").onclick = startTraining;
  $("#tLines").onclick = startLines;
  $("#tRootReset").onclick = () => { S.settings.practiceRoot = { ...(S.settings.practiceRoot || {}), [S.color]: [] }; Store.save("settings"); renderTrainHome(); };
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
  // Settings > Advanced (rows.js adv()): pawns are stored as centipawns
  for (const [id, field, lo, hi, scale] of [["advGood", "good", 10, 300, 100], ["advMistake", "mistake", 30, 900, 100], ["advClock", "clock", 0, 600, 1], ["advK", "k", 1, 200, 1]]) {
    $("#" + id).onchange = e => {
      const v = Math.round(+e.target.value * scale);
      if (!(v >= lo && v <= hi)) { toast(`Use a number from ${lo / scale} to ${hi / scale}.`); renderSettings(); return; }
      S.settings.adv = { ...adv(), [field]: v }; Store.save("settings");
    };
  }
  $("#autoOpp").onchange = e => { S.settings.autoOpp = e.target.value; Store.save("settings"); };
  $("#saveState").onclick = onSaveStateTap;
  $("#bgState").onclick = e => { const v = e.currentTarget.dataset.view; if (v) setView(v); };
  setInterval(() => { if (Store.status() === "saved") renderSaveState("saved"); }, 30000);
  $("#setMonths").onchange = e => { S.settings.months = +e.target.value; Store.save("settings"); };
  for (const [id, field, lo, hi] of [["gemMin", "min", 50, 100000], ["gemFreq", "freq", 1, 50], ["gemEdge", "edge", 1, 30], ["gemTrapErr", "trapErr", 10, 90], ["gemTrapLoss", "trapLoss", 0, 500]]) {
    $("#" + id).onchange = e => {
      const v = Math.round(+e.target.value * (id === "gemTrapLoss" ? 100 : 1)); // pawns are stored as centipawns
      if (!(v >= lo && v <= hi)) { toast(id === "gemTrapLoss" ? "Use a number of pawns from 0 to 5." : `Use a number from ${lo} to ${hi}.`); renderSettings(); return; }
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
  $("#confirmYes").onclick = () => { Games.clearAll(); GAMEKEYS.clear(); for (const id of Object.keys(S.books)) for (const c of ["white", "black"]) { S.books[id][c].flagged = []; Store.save(repDoc(c, id)); } Store.save("games"); Store.save("acc"); $("#confirmClear").hidden = true; render(); toast("Imported games cleared. Your repertoire is untouched."); };
  setView("build");
}
boot();
