"use strict";
/* ---------- Lichess explorer (works when the page runs outside Claude) ---------- */
let explorerBlocked = false;
async function explorer(fen) {
  const key = K(fen) + "|" + S.settings.band.join(",");
  if (EXPL[key]) return EXPL[key];
  if (!S.token || explorerBlocked) return null;
  const url = `https://explorer.lichess.ovh/lichess?variant=standard&speeds=rapid&ratings=${S.settings.band.join(",")}&moves=12&topGames=0&recentGames=0&fen=${encodeURIComponent(fen)}`;
  try {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + S.token } });
    if (r.status === 401) { toast("Lichess rejected the token. Check it in Settings."); return null; }
    if (!r.ok) return null;
    const d = await r.json();
    const total = d.white + d.draws + d.black;
    const small = {
      total, name: d.opening ? d.opening.name : "", eco: d.opening ? d.opening.eco : "",
      moves: (d.moves || []).map(m => ({ san: m.san, n: m.white + m.draws + m.black, w: m.white, d: m.draws, b: m.black })),
    };
    EXPL[key] = small;
    const keys = Object.keys(EXPL);
    if (keys.length > 1500) for (const k of keys.slice(0, 300)) delete EXPL[k];
    lsSet("pb_expl", EXPL);
    return small;
  } catch (e) {
    explorerBlocked = true;
    return null;
  }
}
function cachedExplorer(fen) { return EXPL[K(fen) + "|" + S.settings.band.join(",")] || null; }

/* ---------- chess.com import ---------- */
async function fetchChessCom() {
  const u = S.settings.user.trim();
  if (!u) { toast("Add your chess.com username in Settings first."); return; }
  const st = $("#importStatus");
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
    flagMisplays("white"); flagMisplays("black");
    render();
  } catch (e) {
    st.textContent = e.message && !/fetch|network|Failed/i.test(e.message)
      ? e.message
      : "Can't reach chess.com from here. Inside Claude, outside websites are blocked: use Paste PGN below, or run the page from your own hosted copy.";
  }
}

let analysing = false;
async function analyseGamesWithEngine(limit = 8) {
  if (analysing) return;
  const todo = S.games.filter(g => !S.acc[g.id]).slice(0, limit);
  if (!todo.length) { toast("All imported games are analysed."); return; }
  analysing = true;
  const st = $("#engStatus");
  try {
    await Engine.init();
    for (const [gi, g] of todo.entries()) {
      const a = analyseGame(g);
      const moves = g.moves.split(" ");
      const last = Math.min(moves.length, a.ply + 8, 40);
      const c = new Chess(); const fens = [c.fen()];
      for (let i = 0; i < last; i++) { c.move(moves[i]); fens.push(c.fen()); }
      const ev = [];
      for (let i = 0; i < fens.length; i++) {
        if (st) st.textContent = `Game ${gi + 1} of ${todo.length}: position ${i + 1} of ${fens.length}`;
        ev.push(await Engine.analyse(fens[i], 10));
      }
      const inb = [], post = [];
      for (let i = 0; i < last; i++) {
        if (!isMine(K(fens[i]), g.my)) continue;
        const accv = moveAcc(ev[i].cp, -ev[i + 1].cp);
        (i < a.ply ? inb : post).push(Math.round(accv));
      }
      const exitCp = sideOf(K(fens[Math.min(a.ply, last)])) === myChar(g.my) ? ev[Math.min(a.ply, last)].cp : -ev[Math.min(a.ply, last)].cp;
      S.acc[g.id] = { inb, post, exitCp: Math.round(exitCp) };
      saveEvalCache();
      Store.save("acc");
    }
    if (st) st.textContent = `Analysed ${todo.length} game${todo.length === 1 ? "" : "s"}.`;
  } catch (e) {
    if (st) st.textContent = "The engine couldn't start in this browser.";
  }
  analysing = false;
  render();
}

/* ---------- board ---------- */
const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
function Board(el) {
  const b = { el, fen: START, flip: false, sel: null, last: null, hint: null, bad: null, onMove: null, locked: false };
  b.set = (fen, opts = {}) => { b.fen = fen; b.sel = null; Object.assign(b, { last: null, hint: null, bad: null }, opts); b.draw(); };
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
      const pc = p ? `<span class="pc ${p.color === "w" ? "pw" : "pb"}">${GLYPH[p.type]}︎</span>` : "";
      html += `<button type="button" class="${cls.join(" ")}" data-sq="${sq}" aria-label="${sq}${p ? " " + (p.color === "w" ? "white " : "black ") + p.type : ""}">${pc}${dot}${coordF}${coordR}</button>`;
    }
    el.innerHTML = html;
  };
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
  BB.set(fen, { last });
  // line strip
  $("#line").innerHTML = lineHtml(path, true);
  const op = openingFor(path);
  const ex = cachedExplorer(fen);
  $("#opName").innerHTML = op ? `<span class="eco">${esc(op.eco)}</span> ${esc(op.name)}` : (path.length ? "Unnamed line" : "Starting position");
  $("#opIdea").textContent = op && op.idea ? op.idea : "";
  // prompt
  const n = rep().pos[key];
  const mine = isMine(key, S.color);
  const pr = $("#prompt");
  if (mine) {
    if (n && n.m.length) {
      pr.innerHTML = `<p class="lbl">Your move</p><div class="mymove"><button type="button" class="chip big" data-go="${esc(n.m[0])}">${esc(moveLabel(path, n.m[0]))}</button><span class="muted">Play a different move on the board to replace it.</span></div>
      <div class="row"><button type="button" class="btn ghost" data-remove="${esc(n.m[0])}">Remove ${esc(n.m[0])} and the line after it</button></div>`;
    } else {
      pr.innerHTML = `<p class="lbl warn">No prep yet</p><p>What do you play here? Make the move on the board. Use the engine below if you want a suggestion.</p>`;
    }
  } else {
    pr.innerHTML = `<p class="lbl">Opponent's options</p>${oppTable(fen, key, n)}`;
    if (!ex) explorer(fen).then(d => { if (d && S.view === "build" && K(fenAfter(START, curPath()) || START) === key) renderBuild(); });
  }
  // engine panel
  const ev = EVALC[key];
  $("#engOut").innerHTML = ev ? `<b class="mono">${fmtEval(ev.cp, ev.mate, sideOf(key))}</b> <span class="muted">depth ${ev.d}</span> · best <b>${esc(uciToSan(fen, ev.best))}</b>` : `<span class="muted">Not analysed yet.</span>`;
  renderGaps();
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
  const meW = S.color === "white";
  const body = list.map(r => {
    const tot = (r.w || 0) + (r.d || 0) + (r.b || 0);
    const you = meW ? r.w : r.b, them = meW ? r.b : r.w;
    const bar = tot ? `<span class="wdl" title="Your results from here at this rating: ${pct(you, tot)}% win, ${pct(r.d, tot)}% draw, ${pct(them, tot)}% loss"><i class="w" style="width:${pct(you, tot)}%"></i><i class="d" style="width:${pct(r.d, tot)}%"></i><i class="l" style="width:${pct(them, tot)}%"></i></span>` : `<span class="wdl empty"></span>`;
    const ok = prepared.includes(r.san);
    return `<tr><td><button type="button" class="chip" data-go="${esc(r.san)}">${esc(r.san)}</button></td>
      <td class="num">${r.f != null ? Math.round(r.f * 100) + "%" : "–"}</td>
      <td>${bar}</td>
      <td class="num">${r.g ? r.g + "×" : ""}</td>
      <td>${ok ? '<span class="pill ok">Prepared</span>' : '<span class="pill gap">Gap</span>'}</td></tr>`;
  }).join("");
  const src = ex ? `Lichess rapid, ${S.settings.band.map(b => b + "+").join(" & ")}, ${ex.total.toLocaleString()} games` : "From your games";
  return `<div class="tblwrap"><table class="opp"><thead><tr><th>Move</th><th class="num">Freq</th><th>You score</th><th class="num">Your games</th><th></th></tr></thead><tbody>${body}</tbody></table></div><p class="src">${esc(src)}. Tap a move to follow it.</p>`;
}
function renderGaps() {
  const color = S.color, R = rep(color);
  const { seen } = walk(color);
  const games = oppSeen(color);
  const gaps = [];
  // reach estimate from explorer frequencies along the path
  for (const [key, path] of Object.entries(seen)) {
    const n = R.pos[key];
    const fen = fenAfter(START, path);
    if (!fen) continue;
    let reach = 1;
    { const c = new Chess(); for (const m of path) { const k = K(c.fen()); if (!isMine(k, color)) { const ex = cachedExplorer(c.fen()); const mv = ex && ex.moves.find(x => x.san === m); if (ex && mv && ex.total) reach *= mv.n / ex.total; } c.move(m); } }
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
  if (isMine(key, S.color) && n && n.m.length && n.m[0] !== mv.san) {
    showReplace(mv.san, n.m[0]);
    return;
  }
  const r = addMove(path, mv.san);
  path.push(mv.san);
  walk();
  if (r === "added") Store.save(S.color);
  renderBuild();
}
function showReplace(newSan, oldSan) {
  const pr = $("#prompt");
  pr.innerHTML = `<p class="lbl warn">Change your move?</p><p>Your repertoire plays <b>${esc(oldSan)}</b> here. Replace it with <b>${esc(newSan)}</b>? The old line after ${esc(oldSan)} is removed.</p>
  <div class="row"><button type="button" class="btn" data-replace="${esc(newSan)}">Replace with ${esc(newSan)}</button><button type="button" class="btn ghost" data-cancel>Keep ${esc(oldSan)}</button></div>`;
}

/* ----- train ----- */
const T = { queue: [], i: 0, key: null, path: [], tries: 0, done: 0, right: 0, state: "idle" };
function renderTrainHome() {
  if (T.state === "run") return renderTrainCard();
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
    $("#tSummary").hidden = false;
    $("#tSummary").innerHTML = `<p><b>${T.right} of ${T.done}</b> right first time. Missed positions come back in about 10 minutes.</p>`;
  } else $("#tSummary").hidden = true;
}
function startTraining() {
  let q = dueCards();
  if (!q.length) {
    const R = rep();
    q = Object.entries(R.cards).sort((a, b) => a[1].ef - b[1].ef || a[1].due - b[1].due).slice(0, 10).map(([k]) => k);
  }
  T.queue = q.slice(0, 20); T.i = 0; T.done = 0; T.right = 0; T.state = "run";
  nextCard();
}
function nextCard() {
  if (T.i >= T.queue.length) { T.state = "summary"; Store.save(S.color); renderTrainHome(); return; }
  T.key = T.queue[T.i];
  const n = rep().pos[T.key];
  if (!n || !n.m.length) { T.i++; return nextCard(); }
  T.path = n.path ? n.path.split(" ") : [];
  T.tries = 0;
  renderTrainCard();
}
function renderTrainCard() {
  $("#trainHome").hidden = true; $("#trainRun").hidden = false;
  const n = rep().pos[T.key];
  const fen = fenAfter(START, T.path);
  TB.flip = S.color === "black";
  let last = null;
  if (T.path.length) { const c = new Chess(fenAfter(START, T.path.slice(0, -1))); const mv = c.move(T.path[T.path.length - 1]); if (mv) last = [mv.from, mv.to]; }
  TB.locked = false;
  TB.set(fen, { last });
  const card = rep().cards[T.key];
  $("#tLine").innerHTML = lineHtml(T.path, false);
  const op = openingFor(T.path);
  $("#tOpening").textContent = op ? `${op.eco} ${op.name}` : "";
  $("#tProgress").textContent = `${T.i + 1} / ${T.queue.length}`;
  $("#tPrompt").innerHTML = `<p class="lbl">${card && card.flag ? '<span class="pill gap">Misplayed in a game</span> ' : ""}Your move as ${S.color === "white" ? "White" : "Black"}</p><p class="muted">Play the move from your repertoire.</p>`;
  $("#tNext").hidden = true;
}
function onTrainMove(mv) {
  const n = rep().pos[T.key];
  const want = n.m[0];
  const card = rep().cards[T.key];
  const fenBefore = fenAfter(START, T.path);
  if (mv.san === want) {
    if (T.tries === 0) { T.right++; grade(card, true); }
    T.done += T.tries === 0 ? 1 : 0;
    TB.locked = true;
    const c = new Chess(fenBefore); c.move(want);
    TB.set(c.fen(), { last: [mv.from, mv.to] });
    $("#tPrompt").innerHTML = `<p class="lbl ok">Correct: ${esc(moveLabel(T.path, want))}</p>${T.tries ? '<p class="muted">Logged as a miss. It comes back soon.</p>' : `<p class="muted">Next review in ${card.iv} day${card.iv === 1 ? "" : "s"}.</p>`}`;
    $("#tNext").hidden = false; $("#tNext").focus();
  } else {
    if (T.tries === 0) { grade(card, false); T.done++; }
    T.tries++;
    const c = new Chess(fenBefore); const good = c.move(want);
    TB.set(fenBefore, { bad: [mv.from, mv.to], hint: T.tries >= 1 && good ? [good.from, good.to] : null });
    $("#tPrompt").innerHTML = `<p class="lbl warn">Not your repertoire move</p><p>You played ${esc(mv.san)}. The highlighted squares show your prepared move. Play it to continue.</p>`;
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
  $("#engBtn").textContent = todo ? `Analyse ${Math.min(8, todo)} more game${todo === 1 ? "" : "s"} (${todo} left)` : "All games analysed";
  $("#engBtn").disabled = !todo || analysing;
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
  flagMisplays("white"); flagMisplays("black");
  render();
}

/* ----- settings ----- */
const BANDS = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
function renderSettings() {
  $("#setUser").value = S.settings.user;
  $("#setToken").value = S.token;
  $("#setMonths").value = String(S.settings.months);
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

/* ---------- wiring ---------- */
async function boot() {
  BB = Board($("#board"));
  TB = Board($("#tBoard"));
  BB.onMove = mv => onBuildMove(mv);
  TB.onMove = mv => onTrainMove(mv);
  const state = await Store.init();
  if (state === "auth") await new Promise(res => showAuth(res));
  walk("white"); walk("black");
  $("#loading").hidden = true;
  window.addEventListener("pagehide", () => Store.flushAll());
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") { Store.flushAll(); return; }
    if (await Store.refresh()) { walk("white"); walk("black"); if (!(S.view === "train" && T.state === "run")) render(); }
  });
  document.addEventListener("click", e => {
    const t = e.target.closest("button");
    if (!t) return;
    const d = t.dataset;
    if (d.nav) { if (S.view === "train" && T.state === "run" && d.nav !== "train") T.state = "idle"; setView(d.nav); }
    else if (d.color) { S.color = d.color; T.state = "idle"; render(); }
    else if (d.jump) { S.build[S.color] = curPath().slice(0, +d.jump); renderBuild(); }
    else if (d.go) goMove(d.go);
    else if (d.remove) { removeMove(curPath(), d.remove); Store.save(S.color); renderBuild(); toast("Removed " + d.remove + " and the line after it."); }
    else if ("replace" in d) {
      const path = curPath(); addMove(path, d.replace); path.push(d.replace); walk(); Store.save(S.color); renderBuild();
    }
    else if ("cancel" in d) renderBuild();
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
    $("#engOut").innerHTML = `<span class="muted">Thinking…</span>`;
    try { await Engine.analyse(fen, 16); saveEvalCache(); } catch (e) { $("#engOut").innerHTML = `<span class="muted">The engine couldn't start in this browser.</span>`; return; }
    if (K(fenAfter(START, curPath())) === key) renderBuild();
  };
  $("#tStart").onclick = startTraining;
  $("#tNext").onclick = () => { T.i++; nextCard(); };
  $("#tStop").onclick = () => { T.state = T.done ? "summary" : "idle"; Store.save(S.color); renderTrainHome(); };
  $("#fetchBtn").onclick = fetchChessCom;
  $("#pasteBtn").onclick = importPasted;
  $("#pgnFile").onchange = async e => { const f = e.target.files[0]; if (f) { $("#pgnIn").value = await f.text(); importPasted(); } e.target.value = ""; };
  $("#engBtn").onclick = () => analyseGamesWithEngine(8);
  $("#setUser").onchange = e => { S.settings.user = e.target.value.trim(); Store.save("settings"); };
  $("#setToken").onchange = e => { S.token = e.target.value.trim(); lsSet("pb_token", S.token); explorerBlocked = false; };
  $("#setMonths").onchange = e => { S.settings.months = +e.target.value; Store.save("settings"); };
  $("#exportBtn").onclick = () => { $("#ioText").value = exportPGN(S.color); toast(`${S.color === "white" ? "White" : "Black"} repertoire exported below.`); };
  $("#copyBtn").onclick = async () => { const ta = $("#ioText"); try { await navigator.clipboard.writeText(ta.value); toast("Copied."); } catch (e) { ta.select(); toast("Selected: copy it with your keyboard or long-press."); } };
  $("#importRepBtn").onclick = () => {
    const txt = $("#ioText").value; if (!txt.trim()) { toast("Paste a PGN first."); return; }
    const r = importRepertoire(txt, S.color);
    toast(`Added ${r.added} moves${r.conflicts ? `, skipped ${r.conflicts} that clash with your existing choices` : ""}${r.bad ? `, ${r.bad} unreadable` : ""}.`);
    renderSettings();
  };
  $("#signOut").onclick = () => Store.signOut();
  $("#signIn").onclick = () => { try { localStorage.removeItem("pb_local_only"); } catch (e) {} location.reload(); };
  $("#clearGames").onclick = () => { $("#confirmClear").hidden = false; };
  $("#confirmNo").onclick = () => { $("#confirmClear").hidden = true; };
  $("#confirmYes").onclick = () => { S.games = []; S.acc = {}; rep("white").flagged = []; rep("black").flagged = []; Store.save("games"); Store.save("acc"); Store.save("white"); Store.save("black"); $("#confirmClear").hidden = true; toast("Imported games cleared. Your repertoire is untouched."); };
  setView("build");
}
boot();
