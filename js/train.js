"use strict";
/* Train: review positions, mistake review (puzzles.js has the logic) and practise lines.
   Classic script: shares one global scope with the others (see index.html for the load order). */
/* ----- train ----- */
// A session is a queue of position keys. Each card first replays its line from the start
// (board locked, tap to skip), then waits for my move. A miss shows the right move, moves on
// by itself and puts the card back a few places later until it's answered correctly. Only the
// first attempt at each card in a session is graded.
const T = { queue: [], i: 0, key: null, path: [], done: 0, right: 0, retries: 0, graded: new Set(), state: "idle", phase: "", token: 0, timer: null, frames: [] };
const RETRY_GAP = 3; // a missed card comes back after this many other cards
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
    $("#tSummary").innerHTML = T.mode === "puzzles"
      ? `<p>Reviewed <b>${T.done} mistake${T.done === 1 ? "" : "s"}</b>: <b>${T.right}</b> solved first time. Kept ones come back on a schedule.</p>`
      : T.mode === "lines"
      ? `<p>Practised <b>${Math.min(T.lineNo, T.lines)} line${T.lineNo === 1 ? "" : "s"}</b>: <b>${T.right} of ${T.done}</b> of your moves right first time.${missed ? ` The ${missed === 1 ? "position you missed comes" : `${missed} positions you missed come`} back for review in about 10 minutes.` : ""}</p>`
      : `<p><b>${T.right} of ${T.done}</b> right first time.${missed ? ` You went back over ${missed === 1 ? "the one you missed" : `the ${missed} you missed`} until you had ${missed === 1 ? "it" : "them"}, and ${missed === 1 ? "it comes" : "they come"} back for review in about 10 minutes.` : ""}</p>`;
  } else $("#tSummary").hidden = true;
  // Practise lines: from the start, or from the position picked in Build (item 3)
  const root = practiceRoot(), here = root.length ? openingFor(root) : null;
  $("#tRoot").innerHTML = root.length
    ? `From <b class="mono">${esc(root.map((m, i) => (i % 2 ? "" : i / 2 + 1 + ". ") + m).join(" "))}</b>${here ? ` (${esc(here.name)})` : ""}.`
    : `From the start.`;
  $("#tRootReset").hidden = !root.length;
  $("#tLines").disabled = !cards.length;
  renderMistakeCard();
  renderIdeaCard();
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
  renderPzNav(); // the ◀ ▶ row is for puzzles only
  TB.flip = T.mode === "puzzles" && T.pzGame ? T.pzGame.my === "black" : S.color === "black";
  if (T.mode !== "puzzles") $("#tLine").innerHTML = lineHtml(T.path, false); // puzzles: renderPzNav()
  const op = openingFor(T.path);
  $("#tOpening").textContent = op ? `${op.eco} ${op.name}` : "";
  if (T.mode === "puzzles") { $("#tProgress").textContent = `Puzzle ${T.i + 1} / ${T.queue.length}`; $("#tProgress").dataset.tip = `${T.right} of ${T.done} solved first time`; return; }
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
  if (frames.length <= 1 || reduceMotion()) return afterRunup();
  T.phase = "anim"; T.runup = true;
  TB.locked = true;
  $("#tPrompt").innerHTML = `<p class="lbl">Playing the line</p><p class="muted">Tap the board to skip.</p>`;
  const ms = Math.round(Math.max(120, Math.min(250, 4000 / (frames.length - 1))));
  let i = 0;
  const step = () => {
    TB.set(frames[i].fen, { last: frames[i].last });
    i++;
    if (i < frames.length) later(step, ms); else later(() => { T.runup = false; afterRunup(); }, ms);
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
function skipLine() { if (T.phase === "anim" && T.runup) { T.runup = false; afterRunup(); } }
// After the replay up to the position: lines go on, puzzles ask for a move, cards wait for one
function afterRunup() { if (T.mode === "lines") stepLine(); else if (T.mode === "puzzles") showPuzzle(); else showPosition(); }

/* ----- mistake review (NOTES item 9; the logic is in puzzles.js) ----- */
function renderMistakeCard() {
  const box = $("#mistakeBody");
  if (!box) return;
  const analysed = S.games.filter(g => S.acc[g.id] && S.acc[g.id].v === 2).length;
  if (!analysed) { box.innerHTML = `<p class="help">Run Analyse all on the Games tab first: puzzles come from the engine's view of your games.</p>`; return; }
  if (MIST.running) { box.innerHTML = MIST.total ? `<p class="help" aria-live="polite">Finding your mistakes… ${nOf(MIST.done)} of ${nOf(MIST.total)} games</p><progress max="${MIST.total}" value="${MIST.done}"></progress>` : `<p class="help">Loading your mistakes…</p>`; return; }
  if (mistNeedsScan()) { scanMistakes(onMistakeTick); return; }
  const list = puzzleList(), now = Date.now();
  const kept = list.filter(m => (pzState(puzzleId(m)) || {}).st === "keep");
  const due = kept.filter(m => pzState(puzzleId(m)).c && pzState(puzzleId(m)).c.due <= now).length;
  const fresh = list.filter(m => !pzState(puzzleId(m))).length, q = puzzleQueue().length;
  const o = mistakeOverview(), bar = (n, max) => `<span class="mbar"><i style="width:${max ? Math.round((100 * n) / max) : 0}%"></i></span>`;
  const pmax = Math.max(...Object.values(o.phase), 1), cmax = Math.max(...o.clock.map(c => c.n), 1);
  box.innerHTML = `<p class="possum"><b>${nOf(list.length)}</b> puzzles from ${nOf(o.total)} mistakes in ${nOf(o.games)} games · ${fresh} new · ${kept.length} kept${due ? `, <b>${due} due</b>` : ""}</p>
    <div class="mgrid"><div><p class="lbl">By phase</p>${["opening", "middlegame", "endgame"].map(p => `<div class="mrow"><span>${p[0].toUpperCase() + p.slice(1)}</span>${bar(o.phase[p], pmax)}<span class="num">${o.phase[p]}</span></div>`).join("")}</div>
      <div><p class="lbl">By time left ${info("Time on your clock when you made the move. Moves with less than " + adv().clock + " seconds left don't become puzzles (Settings > Advanced).", "About time left")}</p>${o.clock.map(c => `<div class="mrow"><span>${c.label}</span>${bar(c.n, cmax)}<span class="num">${c.n}</span></div>`).join("")}</div></div>
    <div class="row" style="margin:0"><button type="button" class="btn" id="pzStart" ${q ? "" : "disabled"}>${q ? `Review ${q} mistake${q === 1 ? "" : "s"}` : "Nothing to review"}</button></div>`;
  $("#pzStart").onclick = startPuzzles;
}
function onMistakeTick() { if (S.view === "train" && T.state !== "run") renderMistakeCard(); }
function startPuzzles() {
  stopTraining();
  Object.assign(T, { mode: "puzzles", state: "run", queue: puzzleQueue(10), i: 0, done: 0, right: 0, retries: 0, graded: new Set() });
  nextPuzzle();
}
/* A puzzle starts a few moves before the mistake (PZ_RUNUP plies, replayed), then asks for a
   move. ◀ ▶ under the board step through the moves: before answering, only the moves leading up
   to it (the board can be played on at the puzzle position only); after answering, the game's
   moves after it too. At the puzzle position, arrows show the best move (blue), the move played
   in the game (orange) and mine (purple). */
const PZ_RUNUP = 5, PZ_AFTER = 6;
function nextPuzzle() {
  stopTraining();
  if (T.i >= T.queue.length) return endSession();
  const m = T.pz = T.queue[T.i], g = S.games.find(x => x.id === m.gid);
  if (!g) { T.i++; return nextPuzzle(); }
  T.pzGame = g;
  T.path = g.moves.split(" ").slice(0, m.ply);
  const upTo = framesTo(T.path); // every position from the start up to the puzzle
  T.frames = upTo.slice(-(PZ_RUNUP + 1)); // the replay starts a few moves before
  T.tries = 0;
  T.nav = { frames: upTo, moves: T.path, i: upTo.length - 1, pz: upTo.length - 1, arrows: [] };
  renderTrainCard();
  renderPzNav();
  playLine();
}
function showPuzzle() {
  clearTimeout(T.timer);
  const g = T.pzGame, opp = g.my === "white" ? g.black : g.white;
  T.phase = "move";
  T.nav.i = T.nav.pz; pzGo(T.nav.pz);
  $("#tPrompt").innerHTML = `<p class="lbl">${pzState(puzzleId(T.pz)) ? '<span class="pill">Again</span> ' : ""}Find a good move</p>
    <p class="muted">You went wrong here against ${esc(opp)} (${esc(g.date)}). Any good move counts. ◀ ▶ or the moves above step through the game up to here.</p>`;
}
// Show one of the puzzle's frames (frame i = the position after i moves); the board can only
// be played on at the puzzle position
function pzGo(i) {
  const nav = T.nav;
  if (!nav) return;
  nav.i = Math.max(0, Math.min(nav.frames.length - 1, i));
  const f = nav.frames[nav.i];
  TB.locked = !(T.phase === "move" && nav.i === nav.pz);
  TB.set(f.fen, { last: f.last, arrows: nav.i === nav.pz ? nav.arrows : [] });
  renderPzNav();
}
// ◀ Puzzle ▶, and the game's moves as a clickable list: up to the puzzle before answering, the
// whole game after. The current move is highlighted; the mistake is marked.
function renderPzNav() {
  const box = $("#pzNav"), nav = T.nav, on = T.state === "run" && T.mode === "puzzles" && nav;
  box.hidden = !on;
  if (!on) return;
  $("#pzBack").disabled = nav.i <= 0;
  $("#pzFwd").disabled = nav.i >= nav.frames.length - 1;
  $("#pzHere").disabled = nav.i === nav.pz;
  const line = $("#tLine");
  line.innerHTML = nav.moves.map((s, j) => `${j % 2 === 0 ? `<span class="mn">${j / 2 + 1}.</span>` : ""}<button type="button" class="mv${j + 1 === nav.i ? " cur" : ""}${j === nav.pz ? " pzmv" : ""}" data-pzply="${j + 1}" aria-label="Go to ${esc(moveLabel(nav.moves.slice(0, j), s))}">${esc(s)}</button>`).join("") || `<span class="muted">Start position</span>`;
  const cur = line.querySelector(".mv.cur");
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function pzStep(d) {
  if (T.phase === "anim") skipLine(); // stepping skips the replay
  if (!T.nav || T.phase === "checking") return;
  pzGo(d === "start" ? T.nav.pz : T.nav.i + d);
}
function pzJump(i) { // a tap on a move in the list
  if (T.phase === "anim") skipLine();
  if (!T.nav || T.phase === "checking") return;
  pzGo(i);
}
// Is my move good? The engine's best move is; otherwise compare with the best at depth 12
async function judgePuzzleMove(fen, mv) {
  const uci = mv.from + mv.to + (mv.promotion || "");
  if (T.pz.bestUci && uci.slice(0, 4) === T.pz.bestUci.slice(0, 4)) return { ok: true };
  if (mv.san === T.pz.played) { // the game's own mistake: wrong, but still find the best move to show
    if (T.pz.bestUci) return { ok: false };
    try { const b = await Engine.analyse(fen, 12, { prio: PRIO.now }); return { ok: false, best: b.best }; } catch (e) { return { ok: false }; }
  }
  try {
    const after = fenAfter(fen, [mv.san]);
    const [b, a] = await Promise.all([Engine.analyse(fen, 12, { prio: PRIO.now }), Engine.analyse(after, 12, { prio: PRIO.now })]);
    const loss = Math.max(0, b.cp + a.cp); // a.cp is from the opponent's side
    return { ok: loss <= adv().good, loss, best: b.best };
  } catch (e) { return { ok: false }; }
}
// Arrows at the puzzle position: best (blue), played in the game (orange), mine (purple).
// A move that is two of these at once gets one arrow, in the first colour.
function pzArrows(fen, best, played, mine) {
  const c = new Chess(fen), out = [];
  const add = (san, kind, w) => {
    if (!san) return;
    const m = c.move(san, { sloppy: true });
    if (!m) return;
    c.undo();
    if (!out.some(a => a.from === m.from && a.to === m.to)) out.push({ from: m.from, to: m.to, w, kind });
  };
  add(best, "best", 0.85); add(played, "played", 0.6); add(mine, "tried", 0.5);
  return out;
}
async function onPuzzleMove(mv) {
  const fen = T.frames[T.frames.length - 1].fen, m = T.pz, first = T.tries === 0;
  T.phase = "checking"; TB.locked = true; T.tries++;
  $("#tPrompt").innerHTML = `<p class="lbl">Checking ${esc(mv.san)}…</p>`;
  const tok = T.token, r = await judgePuzzleMove(fen, mv);
  if (tok !== T.token || T.state !== "run") return;
  if (first) { T.done++; if (r.ok) T.right++; }
  T.pzSolved = first && r.ok;
  const bestSan = uciToSan(fen, m.bestUci || r.best || "");
  const g = T.pzGame, moves = g.moves.split(" "), after = moves.slice(m.ply, m.ply + PZ_AFTER);
  const opp = g.my === "white" ? g.black : g.white;
  // Now the whole game can be stepped through, before and after the mistake
  const full = framesTo(moves), played = moves.slice(0, full.length - 1);
  T.nav = { frames: full, moves: played, pz: m.ply, i: m.ply, arrows: pzArrows(fen, bestSan, m.played, mv.san) };
  T.phase = "review";
  pzGo(T.nav.pz);
  const shown = new Set(T.nav.arrows.map(a => a.kind));
  const legend = [shown.has("best") && `<span class="key best">best${bestSan ? " " + esc(bestSan) : ""}</span>`, shown.has("played") && `<span class="key played">played in the game</span>`, shown.has("tried") && `<span class="key tried">yours</span>`].filter(Boolean).join("");
  $("#tPrompt").innerHTML = `<p class="lbl ${r.ok ? "ok" : "warn"}">${r.ok ? `Good: ${esc(moveLabel(T.path, mv.san))}` : `Not quite. Better was ${esc(moveLabel(T.path, bestSan))}`}</p>
    <p class="muted">In the game you played <b>${esc(moveLabel(T.path, m.played))}</b> (${pawns(m.before)} → ${pawns(m.after)}) and ${esc(opp)} punished it: <span class="mono">${esc(numbered(T.path.length + 1, after.slice(1, 4)) || "…")}</span></p>
    ${legend ? `<p class="arrowkey">${legend}</p>` : ""}
    <p class="help">▶ or the moves above go through the whole game.</p>`;
  puzzleChoice();
}
function puzzleChoice() {
  const keep = suggestKeep(T.pz, T.pzSolved);
  const b = (v, label, hint) => `<button type="button" class="btn${(v === "keep") === keep && v !== "later" ? "" : " ghost"}" data-pz="${v}" aria-label="${esc(label + ": " + hint)}">${label}</button>`;
  $("#tPrompt").innerHTML += `<p class="help" style="margin-top:6px">${keep ? (T.pzSolved ? "Suggested: Keep (this kind of mistake recurs, or it's from your prep)" : "Suggested: Keep, to see it again") : "Suggested: Seen it (a one-off you solved)"}</p>
    <div class="row" style="margin:4px 0 0">${b("keep", "Keep", "comes back on a schedule")}${b("seen", "Seen it", "retire it")}${b("later", "Later", "show it again in a later session")}</div>`;
}
function onPuzzleChoice(choice) {
  const id = puzzleId(T.pz), st = pzState(id) || {};
  if (choice === "keep") {
    const card = st.c || newCard();
    grade(card, T.pzSolved);
    setPuzzle(id, { st: "keep", c: card, n: (st.n || 0) + 1, ok: (st.ok || 0) + (T.pzSolved ? 1 : 0) });
  } else setPuzzle(id, { st: choice, n: (st.n || 0) + 1, ok: (st.ok || 0) + (T.pzSolved ? 1 : 0) });
  T.i++;
  nextPuzzle();
}

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
  if (T.mode === "puzzles") return onPuzzleMove(mv);
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


/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("pz", d => onPuzzleChoice(d.pz));
onClick("pzply", d => pzJump(+d.pzply));
