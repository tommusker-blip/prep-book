"use strict";
/* Build: the position, the move rows pane, the opponent's reply (quick picks and auto-reply), Ideas here, Explore mode, and adding moves.
   Classic script: shares one global scope with the others (see index.html for the load order). */
/* ----- build ----- */
function curPath() { return S.build[S.color]; }
// For queued work about the Build position with this key: true once the user has moved on
const notHere = key => () => S.view !== "build" || K(fenAfter(START, curPath()) || START) !== key;
/* Build redraws come in two sizes:
   - renderBuild(): the whole Build screen, after the position or the repertoire changes
   - refreshBuild(key): only what background results change (move rows and arrows), once a burst
     of engine or Lichess results has arrived. The board's squares aren't rebuilt, a selected
     piece stays selected, and the panel keeps its height so the page doesn't jump.
   Gaps and Lichess suggestions go over the whole tree, so they're only worked out while their
   tab is open (sidePanes()), and not on every result. */
// The Build position. A path that no longer plays out (for example after a sync changed the
// tree, or a stored path from an older build) is cut back to its longest legal start, so the
// board never shows a different position from the move list.
function buildState() {
  const path = curPath(), c = new Chess();
  for (let i = 0; i < path.length; i++) if (!c.move(path[i], { sloppy: true })) { path.length = i; break; }
  const fen = c.fen(), key = K(fen);
  return { path, fen, key, n: rep().pos[key], mine: isMine(key, S.color) };
}
function renderBuild() {
  stopBuildReplay(); // gaps.js: a replay up to a gap ends with any redraw
  const { path, fen, key, n, mine } = buildState();
  BB.flip = S.color === "black";
  let last = null;
  if (path.length) { const c = new Chess(fenAfter(START, path.slice(0, -1))); const mv = c.move(path[path.length - 1]); if (mv) last = [mv.from, mv.to]; }
  BB.set(fen, { last, arrows: buildArrows(fen, key, n) });
  BB.el.classList.toggle("exploring", exploring());
  document.querySelectorAll("[data-bmode]").forEach(b => b.setAttribute("aria-pressed", String(exploring())));
  showPane();
  drawFocusBars();
  // line strip
  const lineEl = $("#line"); lineEl.innerHTML = lineHtml(path, true); lineEl.scrollLeft = lineEl.scrollWidth; // one line, latest move in view
  // "Practise from here" (item 3): for a position in the tree with my moves below it
  const branch = branchInfo(S.color)[key];
  const pb = $("#practiseHere"); pb.disabled = !(branch && branch.cards);
  pb.setAttribute("aria-label", branch && branch.cards ? `Practise the lines from this position (${branch.cards} of your moves)` : "Practise: open a position in your repertoire first");
  const op = openingFor(path);
  $("#opName").innerHTML = op ? `<span class="eco">${esc(op.eco)}</span> ${esc(op.name)}` : (path.length ? "Unnamed line" : "Starting position");
  const oi = $("#opInfo"); oi.hidden = !(op && op.idea); if (op && op.idea) oi.dataset.tip = op.idea;
  const pr = $("#prompt");
  // While the opponent's reply is about to be played (autoOpponent), skip the rows for this
  // in-between position: no engine checks, keep the height so nothing jumps
  if (autoPending === path.join(" ")) { pr.style.minHeight = pr.offsetHeight + "px"; pr.dataset.key = key; pr.innerHTML = `<p class="help" aria-live="polite">Playing your opponent's reply…</p>`; sidePanes(); return; }
  pr.style.minHeight = ""; pr.dataset.key = key;
  pr.innerHTML = movesPane(fen, key, n, path, mine);
  // Ideas tab: only for positions where it's my move; only built while the tab is open
  if (S.ptab === "tree") renderTreePane();
  if (S.ptab === "ideas") $("#ideasCard").innerHTML = mine ? ideasPanel(fen, key, n, path) : `<p class="help">Ideas are for positions where it's your move. Play the opponent's reply, or go back one move.</p>`;
  if (!cachedExplorer(fen) && S.token && !explorerBlocked) explorer(fen, { prio: PRIO.now, stale: notHere(key) }).then(d => { if (d) rowsChanged(key); });
  if (mastersOn() && !cachedExplorer(fen, "masters") && S.token && !explorerBlocked) explorer(fen, { src: "masters", prio: PRIO.soon, stale: notHere(key) }).then(d => { if (d) rowsChanged(key); });
  sidePanes();
}
// The Moves tab: my moves (or the opponent's options), then the candidate rows
function movesPane(fen, key, n, path, mine) {
  let h = "";
  if (mine) {
    if (n && n.m.length) {
      const many = n.m.length > 1;
      h = `<div class="myrow"><span class="lbl">${many ? "Your moves" : "Your move"} ${exploring() ? "" : info(`Tap a move to follow it. Play a different move on the board to add it as ${many ? "another" : "a second"} option or to replace one of these. Remove takes the move out with the line after it.`, "About your moves")}</span>
      <div class="mymoves">${n.m.map(m => `<span class="mymove"><button type="button" class="chip" data-go="${esc(m)}">${esc(moveLabel(path, m))}</button>${exploring() ? "" : `<button type="button" class="xbtn" data-remove="${esc(m)}" aria-label="Remove ${esc(m)} and the line after it">✕</button>`}</span>`).join("")}</div></div>`;
    } else {
      h = exploring() ? `<p class="lbl">Your move</p><p class="help">Not in your repertoire yet.</p>` : `<p class="lbl warn">No prep yet: play your move on the board</p>`;
    }
    h += candRows(fen, key, n, path);
  } else {
    h = `<p class="lbl">Opponent's options</p>${quickOppButtons(fen, key, n)}${candRows(fen, key, n, path)}`;
  }
  return (exploring() ? exploreBar() : "") + h; // notes, routes and the focus are on the My lines tab (v0.9.25)
}
function refreshBuild(key) {
  if (autoPending && autoPending === curPath().join(" ")) return; // the reply is on its way
  if (notHere(key)()) return;
  const { path, fen, n, mine } = buildState();
  if (!BA.on) BB.setArrows(buildArrows(fen, key, n)); // not over the replay up to a gap
  const pr = $("#prompt");
  if (pr.dataset.key === key) pr.style.minHeight = pr.offsetHeight + "px"; // grow, never shrink, while results arrive
  const y = window.scrollY;
  pr.innerHTML = movesPane(fen, key, n, path, mine);
  if (window.scrollY !== y) window.scrollTo(0, y);
  sideSoon();
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
  // v0.9.8: on my turn, the moves I usually play here in my own games (thin, dashed, on top)
  if (myTurn) for (const g of gameMovesHere(key)) { const mv = sq(g.san); if (mv) out.push({ from: mv.from, to: mv.to, w: g.f, kind: "games" }); }
  return out;
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
  return { san: worst.san, why: `your side scores ${Math.round(scoreFor(worst, S.color) * 100)}% after it at your level` };
}
function quickOppButtons(fen, key, n) {
  const common = pickOpp(fen, key, n, "common"), weak = pickOpp(fen, key, n, "weak");
  if (!common) return "";
  // one short line each; the reason is in the tip
  const btn = (p, label) => `<button type="button" class="btn ghost quick" data-go="${esc(p.san)}" aria-label="${esc(label)}: ${esc(p.san)}, ${esc(p.why)}">${label} <b>${esc(p.san)}</b></button>`;
  const same = weak && weak.san === common.san;
  return `<div class="row quickrow">${btn(same ? weak : common, same ? "Common · weakest" : "Common")}${weak && !same ? btn(weak, "Weakest") : ""}${info(`Common: the reply played most at your level (${common.why}).${weak ? ` Weakest: your weakest spot here, the most common reply you haven't prepared, or the one you score worst against (${weak.why}).` : ""} Tap one to play it.`, "About these buttons")}</div>`;
}
// Settings > "After my move": play the opponent's reply automatically.
//   "gap" (default): the biggest gap among the replies here, ranked like the Gaps tab (frequency
//          or rating impact). Replies I've already prepared are left out, so if every common
//          reply is prepared, nothing is played and I choose.
//   "common" | "weak": see pickOpp(). "off": I choose.
const autoOppMode = () => S.settings.autoOpp || "gap";
function gapReply(path, color = S.color) {
  const k = gapMode() === "impact" ? "impact" : "freq", here = path.join(" ");
  const list = findGaps(color).filter(g => g.opp && g.path.join(" ") === here).sort((a, b) => b[k] - a[k] || b.freq - a.freq);
  return list.length ? { san: list[0].opp, why: "the biggest gap here" } : null;
}
// v0.9.14: from the moment my move is played until the reply is on the board, Build shows a
// short note instead of the rows (autoPending), so nothing is analysed for that position
let autoPending = null;
async function autoOpponent(path) {
  const ps = path.join(" ");
  const same = () => S.view === "build" && curPath().join(" ") === ps;
  const done = () => { if (autoPending === ps) { autoPending = null; if (same()) renderBuild(); } };
  const mode = autoOppMode();
  if (mode === "off") return done();
  const fen = fenAfter(START, path), key = K(fen);
  if (!fen || isMine(key, S.color)) return done();
  // at most 8 s for the Lichess data (the queue can be paused after a rate limit)
  if (!cachedExplorer(fen) && S.token && !explorerBlocked) await Promise.race([explorer(fen, { prio: PRIO.now }).catch(() => null), new Promise(r => setTimeout(r, 8000))]);
  if (!same()) return done();
  const p = mode === "gap" ? gapReply(path) : pickOpp(fen, key, rep().pos[key], mode);
  if (!p) { done(); return; } // nothing to play: every common reply is prepared, as the rows show
  setTimeout(() => { if (same()) { autoPending = null; goMove(p.san); } else done(); }, 250);
}

/* ----- my turn: practical, memorable ideas (js/ideas.js) ----- */
let ideaRun = null; // {key, step} while "Find ideas here" is working
function ideaWhy(c, m) {
  const out = [];
  if (m.joins && m.transP >= 0.2) out.push(`${Math.round(m.transP * 100)}% of replies lead into your prep (${esc(m.joins.join(" ") || "start")})`);
  if (m.like && m.setup >= 0.6) { const op = openingFor(m.like); out.push(`same setup as your ${esc(op ? op.name.split(":")[0] : "other line")} (${Math.round(m.setup * 100)}%)`); }
  if (c.err != null && c.cover) {
    const good = c.replies.filter(r => !r.mistake).map(r => r.san), bad = c.replies.filter(r => r.mistake).map(r => r.san);
    if (c.err < 0.1) out.push("opponents rarely go wrong");
    else out.push(`${Math.round(c.err * 100)}% of opponents go wrong (${bad.map(esc).join(", ")}?)${good.length ? `; ${good.map(esc).join(", ")} hold${good.length === 1 ? "s" : ""}` : ""}`);
  }
  if (c.peer) out.push(`your side scores ${Math.round(c.peer.sc * 100)}% at your level (${c.peer.n.toLocaleString("en-GB")} games)`);
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
      <td class="num">${pawns(S.color === "white" ? c.myEval : -c.myEval)}<br><span class="muted">${c.loss >= 5 ? "−" + (c.loss / 100).toFixed(1) : "best"}</span></td>
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
function lineHtml(path, clickable) {
  if (!path.length) return `<span class="muted">Start position</span>`;
  return path.map((m, i) => {
    const num = i % 2 === 0 ? `<span class="mn">${i / 2 + 1}.</span>` : "";
    return `${num}<button type="button" class="mv${i === path.length - 1 ? " cur" : ""}" ${clickable ? `data-jump="${i + 1}"` : "disabled"}>${esc(m)}</button>`;
  }).join("");
}

function goMove(san) {
  const c = new Chess(buildState().fen);
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
  if (S.ptab === "gaps" || S.ptab === "lichess") S.ptab = "moves"; // Gaps moved to Settings (v0.9.8), suggestions to Openings (v0.9.9)
  const tab = S.ptab || "moves";
  document.querySelectorAll("[data-ptab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.ptab === tab)));
  document.querySelectorAll("[data-pane]").forEach(p => (p.hidden = p.dataset.pane !== tab));
}
function setBuildMode(mode) {
  S.buildMode = mode;
  if (mode === "explore") S.explore = { ...(S.explore || {}), [S.color]: curPath().slice() };
  renderBuild();
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
    // no message: the board's orange edge going away shows the mode changed
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
  const filled = fillPath(path);
  const r = addMove(path, san, S.color, replaces);
  path.push(san);
  walk();
  if (r !== "same" || filled) Store.save(repDoc(S.color));
  if (myMove && autoOppMode() !== "off") autoPending = path.join(" "); // the reply comes next: skip its rows
  renderBuild();
  if (myMove) autoOpponent(path);
}
// The Build path can end with opponent moves that aren't saved yet: Next gap plays the
// unprepared reply. Save those before the move played after them. Returns how many it added.
function fillPath(path, color = S.color) {
  let added = 0;
  for (let i = 0; i < path.length; i++) {
    const key = K(fenAfter(START, path.slice(0, i)));
    if (isMine(key, color)) continue; // my moves on a gap path are already in the tree
    if (addMove(path.slice(0, i), path[i], color) === "added") added++;
  }
  return added;
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

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("jump", d => { S.build[S.color] = curPath().slice(0, +d.jump); renderBuild(); });
onClick("go", d => goMove(d.go));
onClick("remove", d => { removeMove(curPath(), d.remove); Store.save(repDoc(S.color)); renderBuild(); });
onClick("addopt", d => commitBuildMove(d.addopt));
onClick("replace", d => commitBuildMove(d.replace, d.old), true);
onClick("cancel", d => renderBuild(), true);
onClick("showweak", d => { const k = buildState().key; if (showWeak.has(k)) showWeak.delete(k); else showWeak.add(k); renderBuild(); }, true);
onClick("bmode", d => setBuildMode(exploring() ? "commit" : "explore"));
onClick("ptab", d => { S.ptab = d.ptab; showPane(); if (d.ptab === "ideas" || d.ptab === "tree") renderBuild(); });
onClick("exwhole", d => exploreSave(true), true);
onClick("exhere", d => exploreSave(false), true);
onClick("exsave", d => { const done = $("#prompt")._exsave; if (done) done(d.exsave); });
onClick("practicehere", d => { S.settings.practiceRoot = { ...(S.settings.practiceRoot || {}), [S.color]: curPath().slice() }; Store.save("settings"); setView("train"); startLines(); }, true);
onClick("open", d => { S.build[S.color] = d.open ? d.open.split(" ") : []; setView("build"); window.scrollTo({ top: 0 }); }, true);
onClick("ideas", d => { if (d.ideas === "here") findIdeasHere(); else if (d.ideas === "tree") findIdeasInTree(S.color, onIdeaTick); });
