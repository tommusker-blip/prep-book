"use strict";
/* Openings page: its two tabs, and Suggestions across the tree (scan, find ideas, the lists, Replace / Add).
   Classic script: shares one global scope with the others (see index.html for the load order). */
// Suggestions are on the Openings page (v0.9.9). While results arrive (scans, Lichess, ideas),
// they're redrawn at most every 1.5 s, and only while that tab is showing.
let sideTimer = null;
const sugShowing = () => S.view === "openings" && S.otab === "sug";
function sidePanes() {
  clearTimeout(sideTimer); sideTimer = null;
  if (sugShowing()) renderSuggest();
}
function sideSoon() { if (!sideTimer && sugShowing()) sideTimer = setTimeout(() => { sideTimer = null; sidePanes(); }, 1500); }
// The Openings page's two tabs
function showOpeningsTab() {
  const tab = ["sug", "map"].includes(S.otab) ? S.otab : "cat";
  document.querySelectorAll("[data-otab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.otab === tab)));
  document.querySelectorAll("[data-opane]").forEach(p => (p.hidden = p.dataset.opane !== tab));
  if (tab === "sug") renderSuggest(); else if (tab === "map") renderCoverMap(); else { renderAddOpening(); renderCatalogue(); }
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
  const row = (id, i, title, line, detail) => `<div class="sugrow"><button type="button" class="gap-row" data-sug="${id}:${i}"><span class="gt">${title}</span><span class="gl mono">${esc(line || "start")}</span><span class="gd">${detail}</span></button>${["memorable", "trick", "gems", "better"].includes(id) ? sugActs(id, i, s[id][i]) : ""}</div>`;
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
  out.innerHTML = undoNote("sug") + (html || `<p class="help" style="margin-top:10px">${scanTodo().length ? "Scan your tree to look for suggestions." : "No suggestions with the current thresholds. You can change them in Settings."}</p>`);
  out._s = s;
}
function onScanTick(finished) {
  renderBg();
  if (sugShowing()) { if (finished) renderSuggest(); else renderScanBox(); }
  else if (finished && S.view === "build") renderBuild();
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
  if (sugShowing()) { if (finished) renderSuggest(); else renderIdeaBox(); }
  else if (finished && S.view === "build") renderBuild();
}
/* ----- acting on a suggestion (v0.9.10) -----
   Gems, better-scoring alternatives, tricks and easy-to-remember moves are all a move of mine
   at one of my positions. Each gets Add as an option, and Replace <my move> for every move I
   have there (addMove() with `replaces`; the old move's line is pruned by walk(), its card is
   reset). Undo: RepUndo (rep.js). */
const sugMove = (id, r) => (id === "memorable" || id === "trick" ? r.c.san : r.san);
function sugActs(id, i, r) {
  const path = r.path, san = sugMove(id, r), n = rep(S.color).pos[K(fenAfter(START, path))], mine = n ? n.m : [];
  if (mine.includes(san)) return `<span class="help sugin">In your repertoire</span>`;
  return `<span class="row sugacts">${mine.map((m, j) => `<button type="button" class="btn ghost quick" data-sugact="${id}:${i}:${j}">Replace ${esc(m)}</button>`).join("")}<button type="button" class="btn ghost quick" data-sugact="${id}:${i}:add">${mine.length ? "Add as an option" : "Add to my repertoire"}</button></span>`;
}
function onSugAct(spec) {
  const [id, i, how] = spec.split(":"), r = $("#sugOut")._s[id][+i];
  if (!r) return;
  const color = S.color, path = r.path, san = sugMove(id, r);
  const n = rep(color).pos[K(fenAfter(START, path))], old = how === "add" ? null : n && n.m[+how];
  RepUndo.change("sug", color, () => {
    if (addMove(path, san, color, old) === "same") return "";
    walk(color);
    return old ? `Replaced ${moveLabel(path, old)} with ${moveLabel(path, san)}` : `Added ${moveLabel(path, san)} as ${n && n.m.length > 1 ? "another option" : "your move"}`;
  });
  renderSuggest();
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("scan", d => scanTree(S.color, onScanTick), true);
onClick("more", d => { sugOpen[d.more] += 10; renderSuggest(); });
onClick("sugact", d => onSugAct(d.sugact));
onClick("otab", d => { S.otab = d.otab; showOpeningsTab(); });
onClick("sug", d => { const [id, i] = d.sug.split(":"), r = $("#sugOut")._s[id][+i]; S.build[S.color] = (id === "struct" ? r.mine : r.path).slice(); S.ptab = "moves"; setView("build"); window.scrollTo({ top: 0 }); });
