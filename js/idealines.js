"use strict";
/* ---------- idea lines (v0.9.5): deeper model lines with the idea behind them ----------
   An add-on next to the repertoire, never part of it: idea lines don't go into the tree or
   the training cards.
   - Targets (ideaTargets): positions where my prep ends (leaves of the tree) that my games
     reach, ranked by games × how far my accuracy falls just after book.
   - The line (buildIdeaLine): from there, the move masters play most (Lichess masters
     database), falling back to Lichess 2200+ games, and at most IDEA_MAX_ENGINE engine moves.
     My moves must be sound: at most IDEA_LOSS cp worse than the best at depth 12, or the next
     source is tried. Up to IDEA_PLIES half-moves.
   - The idea: the pawn structure at the end (structures.js) with its typical plans, and up to
     three key moments among my moves: a typical break for the structure, a pawn lever
     (contact with an enemy pawn) or a regrouping retreat.
   Lines are kept in localStorage (pb_idealines); they're cheap to rebuild. */
const IDEA_PLIES = 16, IDEA_MASTERS_MIN = 20, IDEA_CLUB_MIN = 50, IDEA_CLUB_SRC = "2200,2500", IDEA_MAX_ENGINE = 2, IDEA_LOSS = 100, IDEA_MIN_PLIES = 4;
let IDEAL = lsGet("pb_idealines", {});
const IL = { running: false, stop: false, done: 0, total: 0, note: "" };
const ideaId = (color, path, book = S.book) => [book, color, path.join(" ")].join("|");
const saveIdeaLines = () => lsSet("pb_idealines", IDEAL);
// Lines for one colour (and the open book), optionally only those under a path
function ideaLinesFor(color = S.color, under = null) {
  return Object.values(IDEAL).filter(l => l.color === color && l.book === S.book &&
    (under == null || under === "" || l.path.join(" ") === under || l.path.join(" ").startsWith(under + " ")));
}

// My games of one colour with their positions as sets, memoised (the catalogue asks per entry)
let igMemo = { sig: "", sets: [] };
function ideaGameSets(color) {
  const sig = color + "|" + S.games.length + "|" + Object.keys(S.acc).length;
  if (igMemo.sig !== sig) igMemo = { sig, sets: S.games.filter(g => g.my === color).map(g => ({ g, keys: new Set(gameKeys(g)), a: S.acc[g.id] })) };
  return igMemo.sets;
}
// Where my prep ends, with my games and accuracy there. under: only below this path ("" = all)
function ideaTargets(color = S.color, under = null) {
  const { nodes } = walk(color), idx = indexTree(color);
  const games = ideaGameSets(color);
  const out = [];
  for (const [key, node] of Object.entries(nodes)) {
    if (node.kids.length || !idx[key] || !node.path.length) continue;
    const ps = node.path.join(" ");
    if (under && !(ps === under || ps.startsWith(under + " "))) continue;
    let n = 0;
    const post = [], inb = [];
    for (const x of games) if (x.keys.has(key)) { n++; if (x.a && x.a.v === 2) { if (x.a.post) post.push(...x.a.post); if (x.a.inb) inb.push(...x.a.inb); } }
    const avg = a => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : null);
    const p = avg(post), b = avg(inb);
    out.push({ key, path: node.path, n, post: p, inb: b, reach: idx[key].reach, weight: n * (p == null ? 0.5 : Math.max(0.1, 1 - p / 100)) + idx[key].reach * 0.01 });
  }
  return out.sort((x, y) => y.weight - x.weight);
}

// The most played move in an explorer result
const topMove = d => (d && d.moves && d.moves.length ? d.moves.slice().sort((a, b) => b.n - a.n)[0].san : null);
async function buildIdeaLine(color, path, onStep = () => {}) {
  const start = fenAfter(START, path);
  if (!start) return null;
  const c = new Chess(start), moves = [], src = [];
  let engineMoves = 0;
  for (let i = 0; i < IDEA_PLIES && !IL.stop; i++) {
    const fen = c.fen();
    if (c.game_over()) break;
    const mine = (fen.split(" ")[1] === "w") === (color === "white");
    const tries = [];
    const m = await explorer(fen, { src: "masters", prio: PRIO.soon });
    if (m && m.total >= IDEA_MASTERS_MIN) tries.push([topMove(m), "masters"]);
    if (!tries.length) { const cl = await explorer(fen, { src: IDEA_CLUB_SRC, prio: PRIO.soon }); if (cl && cl.total >= IDEA_CLUB_MIN) tries.push([topMove(cl), "2200+"]); }
    let pick = null, from = "";
    for (const [san, s] of tries) {
      if (!san) continue;
      if (mine && !Engine.failed) { const loss = await moveLoss(fen, san); if (loss != null && loss > IDEA_LOSS) continue; } // must be sound for me
      pick = san; from = s; break;
    }
    if (!pick) {
      if (engineMoves >= IDEA_MAX_ENGINE || Engine.failed) break;
      try { const e = await Engine.analyse(fen, 12, { prio: PRIO.soon }); pick = e.best ? uciToSan(fen, e.best) : null; from = "engine"; engineMoves++; } catch (e) { break; }
    }
    const mv = pick && c.move(pick, { sloppy: true });
    if (!mv) break;
    moves.push(mv.san); src.push(from);
    onStep(i + 1);
  }
  if (moves.length < IDEA_MIN_PLIES) return null;
  return describeIdeaLine(color, path, moves, src);
}
// Structure and key moments for a line (no network or engine needed)
function describeIdeaLine(color, path, moves, src) {
  const all = path.concat(moves), frames = [];
  const c = new Chess();
  for (const s of path) c.move(s);
  frames.push(c.fen());
  for (const s of moves) { c.move(s); frames.push(c.fen()); }
  let st = null;
  for (let i = frames.length - 1; i >= 0 && !st; i--) st = structureOf(frames[i]);
  const side = color === "white" ? "w" : "b", breaks = st ? st.breaks[side] : [];
  const moments = [];
  const g = new Chess(frames[0]);
  moves.forEach((san, j) => {
    const mineMove = g.turn() === side, mv = g.move(san);
    if (!mineMove || !mv) return;
    let score = 0, why = "";
    if (mv.piece === "p" && breaks.includes(mv.to)) { score = 3; why = `the ${side === "b" ? "…" : ""}${mv.san} break, typical in this structure`; }
    else if (mv.piece === "p" && (mv.captured === "p" || pawnContact(g, mv))) { score = 2; why = "a pawn lever: it challenges the opponent's pawns"; }
    else if ((mv.piece === "n" || mv.piece === "b") && (side === "w" ? +mv.to[1] < +mv.from[1] : +mv.to[1] > +mv.from[1])) { score = 1; why = "a regrouping: the piece heads for a better square"; }
    else if (mv.piece === "p" && (side === "w" ? +mv.to[1] >= 5 : +mv.to[1] <= 4)) { score = 1; why = "a space-gaining advance into the opponent's half"; }
    if (score) moments.push({ j, san: mv.san, score, why });
  });
  const pickM = moments.sort((a, b) => b.score - a.score || a.j - b.j).slice(0, 3).sort((a, b) => a.j - b.j);
  if (!pickM.length) { // no clear moment: the first move of mine in the line
    const first = moves.findIndex((s, j) => new Chess(frames[j]).turn() === side);
    if (first >= 0) pickM.push({ j: first, san: moves[first], score: 0, why: "the first move of the plan" });
  }
  const op = openingFor(all);
  return { id: ideaId(color, path), book: S.book, color, path, moves, src, structure: st ? st.id : null, moments: pickM, name: op ? op.name : "", created: Date.now() };
}
// After a pawn move: is it now in contact with an enemy pawn (attacking one, so also attacked)?
function pawnContact(c, mv) {
  const f = mv.to.charCodeAt(0), r = +mv.to[1], dir = mv.color === "w" ? 1 : -1, enemy = mv.color === "w" ? "b" : "w";
  const at = (df, dr) => { const ff = f + df, rr = r + dr; if (ff < 97 || ff > 104 || rr < 1 || rr > 8) return null; return c.get(String.fromCharCode(ff) + rr); };
  return [-1, 1].some(df => { const x = at(df, dir); return !!(x && x.type === "p" && x.color === enemy); }); // contact works both ways
}

// Build lines for a list of targets, one after another (Lichess at about one request a second)
async function findIdeaLines(color, targets, onTick = () => {}) {
  if (IL.running) return;
  Object.assign(IL, { running: true, stop: false, done: 0, total: targets.length, note: "" });
  onTick(false);
  for (const t of targets) {
    if (IL.stop) break;
    IL.note = "";
    const line = await buildIdeaLine(color, t.path, k => { IL.note = `${k} moves`; onTick(false); });
    if (line) { line.n = t.n; line.post = t.post; IDEAL[line.id] = line; saveIdeaLines(); }
    IL.done++;
    onTick(false);
  }
  IL.running = false;
  onTick(true);
}

/* ----- the viewer (its own screen; Build is untouched) -----
   Step through with ◀ ▶ or the move list. "Quiz me" plays the line from where prep ends and
   stops at each key moment for me to find the move: the line's move, or any move the engine
   rates within the good margin, counts. Results are kept on the line (quiz: {n, best}). */
let IB = null;
const IV = { line: null, frames: [], i: 0, start: 0, mode: "view", quiz: null, back: "train", token: 0 };
const structById = id => STRUCTURES.find(s => s.id === id) || null;
const srcLabel = s => ({ masters: "masters", "2200+": "Lichess 2200+ players", engine: "Stockfish" }[s] || s);
function openIdeaLine(id, back) {
  const line = IDEAL[id];
  if (!line) return;
  if (!IB) { IB = Board($("#iBoard")); IB.onMove = onIdeaMove; }
  Object.assign(IV, { line, back: back || S.view, frames: framesTo(line.path.concat(line.moves)), start: line.path.length, mode: "view", quiz: null });
  IV.i = IV.start; IV.token++;
  IB.flip = line.color === "black";
  setView("idea");
  window.scrollTo({ top: 0 });
}
const momentAt = j => (IV.line ? IV.line.moments.find(m => m.j === j) : null);
function renderIdea() {
  const l = IV.line;
  if (!l) { setView(IV.back || "train"); return; }
  const st = structById(l.structure), j = IV.i - IV.start, next = momentAt(j), q = IV.quiz;
  $("#iTitle").textContent = l.name || "Idea line";
  // board: an arrow shows the key move about to be played (not while being quizzed on it)
  const f = IV.frames[IV.i];
  let arrows = [];
  if (next && IV.mode === "view") { const c = new Chess(f.fen), mv = c.move(next.san, { sloppy: true }); if (mv) arrows = [{ from: mv.from, to: mv.to, w: 0.8, kind: "best" }]; }
  IB.locked = !(IV.mode === "quiz" && q && q.waiting);
  IB.set(f.fen, { last: f.last, arrows });
  // move list: prep greyed, key moments marked, current highlighted
  const all = l.path.concat(l.moves);
  $("#iLine").innerHTML = all.map((s, k) => `${k % 2 === 0 ? `<span class="mn">${k / 2 + 1}.</span>` : ""}<button type="button" class="mv${k < IV.start ? " prep" : ""}${k + 1 === IV.i ? " cur" : ""}${k >= IV.start && momentAt(k - IV.start) ? " moment" : ""}" data-ilply="${k + 1}" aria-label="Go to ${esc(moveLabel(all.slice(0, k), s))}">${esc(s)}</button>`).join("");
  // the note under the moves
  const quizBtn = label => `<button type="button" class="btn" data-iquiz>${label}</button>`;
  let note = "";
  if (IV.mode === "quiz" && q) {
    const m = l.moments[q.k];
    if (q.waiting && m) note = `<p class="lbl">Key moment ${q.k + 1} of ${l.moments.length}</p><p>Your move. Find the move that carries the plan${st ? ` in this ${esc(st.name)} position` : ""}.</p>`;
    else if (q.last) note = `<p class="lbl ${q.last.ok ? "ok" : "warn"}">${q.last.ok ? (q.last.note ? `Good: ${esc(q.last.tried)} works too. The line played ${esc(q.last.san)}` : `Right: ${esc(q.last.san)}`) : `The idea was ${esc(q.last.san)}`}</p><p class="help">${esc(q.last.why)}</p>`;
    else note = `<p class="help">Playing the line…</p>`;
    note += `<div class="row" style="margin-top:6px"><button type="button" class="btn ghost" data-iquitquiz>Stop the quiz</button></div>`;
  } else if (IV.mode === "done" && q) {
    note = `<p class="lbl ok">You found ${q.right} of ${l.moments.length} key moment${l.moments.length === 1 ? "" : "s"}</p><div class="row" style="margin-top:6px">${quizBtn("Quiz me again")}<button type="button" class="btn ghost" data-iquitquiz>Back to the line</button></div>`;
  } else {
    const lastSrc = j > 0 && j <= l.src.length ? `<p class="help">${esc(l.moves[j - 1])} is what ${esc(srcLabel(l.src[j - 1]))} ${l.src[j - 1] === "engine" ? "suggests" : "play most"} here.</p>` : "";
    note = next ? `<p class="lbl">Key moment: ${esc(moveLabel(all.slice(0, IV.i), next.san))}</p><p class="help">${esc(next.why.replace(/^./, x => x.toUpperCase()))}.</p>`
      : j < 0 ? `<p class="help">Your prep. The idea line starts where it ends (Prep end).</p>`
      : j === 0 ? `<p class="help">Your prep ends here. From here the line follows what masters play; the blue moves carry the idea.</p>`
      : j >= l.moves.length ? `<p class="help">End of the line.</p>${lastSrc}` : lastSrc;
    note += `<div class="row" style="margin-top:8px">${quizBtn("Quiz me on the key moments")}</div>${l.quiz ? `<p class="help">Quizzed ${l.quiz.n} time${l.quiz.n === 1 ? "" : "s"}, best ${l.quiz.best} of ${l.moments.length}.</p>` : ""}`;
  }
  $("#iNote").innerHTML = note;
  // the structure and its plans, mine first
  const mine = l.color, theirs = mine === "white" ? "black" : "white";
  $("#iPlans").innerHTML = st
    ? `<p class="lbl">Pawn structure</p><h3>${esc(st.name)}</h3><p class="lbl" style="margin-top:8px">Your plan</p><ul class="plans">${st[mine].map(t => `<li>${esc(t)}</li>`).join("")}</ul><p class="lbl" style="margin-top:6px">Their plan</p><ul class="plans">${st[theirs].map(t => `<li>${esc(t)}</li>`).join("")}</ul>`
    : `<p class="help">No standard pawn structure is recognised at the end of this line. Follow the blue moves: they carry the plan.</p>`;
  $("#iBack").disabled = IV.i <= 0; $("#iFwd").disabled = IV.i >= IV.frames.length - 1; $("#iStart").disabled = IV.i === IV.start;
}
function ideaGo(i) { if (IV.mode === "quiz") { IV.mode = "view"; IV.token++; } IV.i = Math.max(0, Math.min(IV.frames.length - 1, i)); renderIdea(); }
function startIdeaQuiz() {
  IV.token++;
  Object.assign(IV, { mode: "quiz", quiz: { k: 0, right: 0, waiting: false, last: null }, i: IV.start });
  renderIdea();
  ideaQuizStep();
}
function ideaQuizStep() {
  const q = IV.quiz, l = IV.line, tok = IV.token, m = l.moments[q.k];
  if (!m) { // finished
    IV.mode = "done";
    l.quiz = { n: ((l.quiz && l.quiz.n) || 0) + 1, best: Math.max(q.right, (l.quiz && l.quiz.best) || 0) };
    IDEAL[l.id] = l; saveIdeaLines();
    renderIdea();
    return;
  }
  const target = IV.start + m.j;
  if (IV.i < target) { setTimeout(() => { if (tok !== IV.token) return; IV.i++; renderIdea(); ideaQuizStep(); }, reduceMotion() ? 0 : 550); return; }
  q.waiting = true; q.last = null;
  renderIdea();
}
async function onIdeaMove(mv) {
  const q = IV.quiz;
  if (IV.mode !== "quiz" || !q || !q.waiting) return;
  const m = IV.line.moments[q.k], fen = IV.frames[IV.i].fen, tok = IV.token;
  q.waiting = false;
  let ok = mv.san === m.san, alt = false;
  if (!ok) { $("#iNote").innerHTML = `<p class="lbl">Checking ${esc(mv.san)}…</p>`; const loss = await moveLoss(fen, mv.san); ok = alt = loss != null && loss <= adv().good; }
  if (tok !== IV.token) return;
  if (ok) q.right++;
  q.last = { ok, tried: mv.san, san: m.san, why: m.why.replace(/^./, x => x.toUpperCase()) + ".", note: alt };
  IV.i++; // the line's move is played either way
  renderIdea();
  setTimeout(() => { if (tok !== IV.token) return; q.k++; ideaQuizStep(); }, ok && !alt ? 1300 : 2600);
}

/* ----- the ways in: Train ("Ideas worth learning") and each catalogue entry ----- */
function ideaRow(l) {
  const st = structById(l.structure);
  return `<button type="button" class="gap-row" data-idea="${esc(l.id)}"><span class="gt">${esc(l.name || "Idea line")}${st ? ` · ${esc(st.name)}` : ""}</span><span class="gl mono">${esc(numbered(0, l.path))} …</span><span class="gd">${l.moments.length} key move${l.moments.length === 1 ? "" : "s"}${l.n ? ` · ${l.n} of your games` : ""}${l.post != null ? ` · accuracy after book ${l.post}` : ""}${l.quiz ? ` · best quiz ${l.quiz.best}/${l.moments.length}` : ""}</span></button>`;
}
const ideaProgress = () => `<p class="help" aria-live="polite">Building idea lines… ${IL.done} of ${IL.total}${IL.note ? ` (${esc(IL.note)})` : ""}</p><progress max="${IL.total}" value="${IL.done}"></progress><div class="row"><button type="button" class="btn ghost" data-ilstop>Stop</button></div>`;
function renderIdeaCard() {
  const box = $("#ideaBody");
  if (!box) return;
  if (IL.running) { box.innerHTML = ideaProgress(); return; }
  if (warming || S.games.some(g => !GAMEKEYS.has(g.id))) { box.innerHTML = `<p class="help">Reading your games…</p>`; warmGameKeys(() => { if (S.view === "train" && T.state !== "run") renderIdeaCard(); }); return; }
  const lines = ideaLinesFor(S.color).sort((a, b) => (b.n || 0) - (a.n || 0));
  const todo = ideaTargets(S.color).filter(t => t.n >= 3 && !IDEAL[ideaId(S.color, t.path)]).slice(0, 5);
  const need = !S.token ? `<p class="help">Add a Lichess token in Settings: the lines come from the Lichess masters database.</p>` : "";
  box.innerHTML = `${lines.length ? `<div class="gaplist">${lines.slice(0, 8).map(ideaRow).join("")}</div>` : `<p class="help">Deeper lines with the plan behind them, for where your prep ends in the lines you actually reach.</p>`}
    ${need || (todo.length ? `<div class="row"><button type="button" class="btn${lines.length ? " ghost" : ""}" data-ilfind="train">Find ${todo.length} idea line${todo.length === 1 ? "" : "s"}</button></div><p class="help">About ${todo.length * 20} seconds: Lichess is asked about once a second.</p>` : lines.length ? "" : `<p class="help">None yet: idea lines are for where your prep ends in lines your games reach at least 3 times.</p>`)}`;
}
// Only the lines whose most specific entry this is (not under one of its children)
function ideaBlock(ps, kids = []) {
  const lines = ideaLinesFor(S.color, ps).filter(l => !kids.some(k => { const lp = l.path.join(" "); return lp === k || lp.startsWith(k + " "); }));
  const todo = ideaTargets(S.color, ps).filter(t => !IDEAL[ideaId(S.color, t.path)]).slice(0, 3);
  if (!lines.length && !(todo.length && (S.token || IL.running))) return ""; // nothing to list or to do here
  return `<div class="ideablock"><p class="lbl">Typical ideas</p>${lines.length ? `<div class="gaplist">${lines.map(ideaRow).join("")}</div>` : ""}
    ${IL.running ? `<p class="help">Building idea lines… ${IL.done} of ${IL.total}</p>` : todo.length && S.token ? `<button type="button" class="btn ghost" data-ideafind="${esc(ps)}">Find ideas for this line</button>` : ""}</div>`;
}
function startIdeaSearch(targets) {
  if (!targets.length || IL.running) return;
  findIdeaLines(S.color, targets, done => {
    if (S.view === "train" && T.state !== "run") renderIdeaCard();
    if (S.view === "openings" && done) renderCatalogue();
    if (done) toast(IL.stop ? "Stopped." : "Idea lines are ready.");
  });
}
