"use strict";
/* Games tab: the games list, the coach report page, Build my tree from my games, and pasted PGN.
   Classic script: shares one global scope with the others (see index.html for the load order). */
/* ----- coach report (report.js): a readable page, plus copy and download ----- */
let coachReport = null;
function renderReport() {
  const box = $("#reportBody");
  // The report needs every game's positions (worked out in the background at start-up); if some
  // are still missing, wait for them rather than freezing the page
  if (warming || S.games.some(g => !GAMEKEYS.has(g.id))) {
    box.innerHTML = `<p class="help">Reading your games…</p>`;
    warmGameKeys(() => { if (S.view === "report") renderReport(); });
    return;
  }
  // Mistakes need the background scan; build once it's done
  const analysed = S.games.filter(g => S.acc[g.id] && S.acc[g.id].v === 2).length;
  if (analysed && (MIST.running || mistNeedsScan())) {
    box.innerHTML = `<p class="help">Gathering your mistakes first… ${MIST.running ? `${nOf(MIST.done)} of ${nOf(MIST.total)} games` : ""}</p>`;
    if (!MIST.running) scanMistakes(done => { if (S.view === "report") { if (done) renderReport(); else box.querySelector("p").textContent = `Gathering your mistakes first… ${nOf(MIST.done)} of ${nOf(MIST.total)} games`; } });
    return;
  }
  box.innerHTML = `<p class="help">Building your report…</p>`;
  setTimeout(() => { // let the page paint first
    coachReport = buildCoachReport();
    box.innerHTML = reportHtml(coachReport);
  }, 30);
}
function reportHtml(r) {
  const pc = x => (x == null ? "–" : Math.round(x) + "%");
  const table = (head, rows) => rows.length ? `<div class="tblwrap"><table class="rep"><thead><tr>${head.map(h => `<th${h.n ? ' class="num"' : ""}>${esc(h.t || h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` : `<p class="help">Nothing yet.</p>`;
  const td = (v, num) => `<td${num ? ' class="num"' : ""}>${esc(v == null ? "–" : v)}</td>`;
  const side = c => {
    const s = r[c], C = c === "white" ? "White" : "Black";
    return `<article class="card"><h3>As ${C}</h3>
      <p class="lbl" style="margin-top:8px">Openings you play</p>
      ${table(["Opening", { t: "Games", n: 1 }, { t: "Score", n: 1 }, { t: "Acc. book / after", n: 1 }, { t: "Moves in prep", n: 1 }, { t: "Misplay", n: 1 }],
        s.openings.map(o => `<tr>${td(o.opening)}${td(o.games, 1)}${td(pc(o.score), 1)}${td(`${o.accuracyInBook ?? "–"} / ${o.accuracyAfterBook ?? "–"}`, 1)}${td(o.avgMovesInPrep, 1)}${td(pc(o.leftPrepByMisplayPct), 1)}</tr>`))}
      <p class="lbl" style="margin-top:10px">Below peer par</p>
      ${table(["Line", { t: "You", n: 1 }, { t: "Peers", n: 1 }], s.belowPeerPar.map(b => `<tr>${td(b.line)}${td(`${pc(b.myScore)} (${b.myGames})`, 1)}${td(pc(b.peerScore), 1)}</tr>`))}
      <p class="lbl" style="margin-top:10px">Biggest gaps by rating impact</p>
      ${table(["Gap", { t: "Reach", n: 1 }, { t: "Expected", n: 1 }], s.biggestGapsByRatingImpact.slice(0, 6).map(g => `<tr>${td(g.what + ": " + g.line)}${td(pc(g.reachPct), 1)}${td(g.expectedScore == null ? "–" : pc(g.expectedScore), 1)}</tr>`))}
      <p class="lbl" style="margin-top:10px">Training: hardest positions</p>
      <p class="help">${s.training.learned} of ${s.training.positions} learned · ${s.training.due} due · ${s.training.flaggedFromGames} flagged from games · ${s.training.totalLapses} misses in all</p>
      ${table(["Line", "Your move", { t: "Misses", n: 1 }], s.training.hardest.slice(0, 5).map(h => `<tr>${td(h.line)}${td(h.myMove)}${td(h.lapses, 1)}</tr>`))}
      ${s.practicalWeapons.length ? `<p class="lbl" style="margin-top:10px">Practical tricks found</p>${table(["Line", "Move", { t: "Go wrong", n: 1 }], s.practicalWeapons.map(w => `<tr>${td(w.line)}${td(w.move)}${td(pc(w.opponentsGoWrongPct), 1)}</tr>`))}` : ""}
    </article>`;
  };
  const m = r.mistakes;
  return `<article class="card"><p class="possum"><b>${nOf(r.player.rapidGames)}</b> rapid games · score W ${pc(r.player.winPct)} · D ${pc(r.player.drawPct)} · L ${pc(r.player.lossPct)} · chess.com ${r.player.chesscomRapid ?? "–"} · Lichess bands ${esc(r.player.lichessBands)} · ${nOf(r.player.gamesAnalysed)} analysed</p></article>
    <article class="card"><h3>Mistakes</h3>${m.note ? `<p class="help">${esc(m.note)}</p>` : `
      <p class="help">${nOf(m.mistakes)} mistakes in ${nOf(m.gamesScanned)} games · by phase: opening ${m.byPhase.opening}, middlegame ${m.byPhase.middlegame}, endgame ${m.byPhase.endgame}</p>
      <p class="help">By time left: ${Object.entries(m.byTimeLeft).map(([k, v]) => `${esc(k)} ${v}`).join(" · ")}</p>
      ${table(["Where they cluster", "Phase", { t: "Mistakes", n: 1 }], m.clusters.map(c => `<tr>${td(c.opening)}${td(c.phase)}${td(c.mistakes, 1)}</tr>`))}`}</article>
    ${side("white")}${side("black")}
    <p class="help">The copy for an AI coach starts with a short brief asking for training advice from these numbers (no chess analysis of its own), then the report as JSON (about ${Math.round(JSON.stringify(r).length / 1024)} KB).</p>`;
}
async function copyText(text, label) {
  try { await navigator.clipboard.writeText(text); toast(`${label} copied.`); }
  catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.append(ta); ta.select(); try { document.execCommand("copy"); toast(`${label} copied.`); } catch (x) { toast("Couldn't copy: try Download instead."); } ta.remove(); }
}

/* ----- games ----- */
function renderGames() {
  renderAutoBuild();
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
  const buckets = [["You were worse by a pawn or more", -1e9, -100], ["Slightly worse", -100, -30], ["Level (within 0.3)", -30, 30], ["Slightly better", 30, 100], ["Better by a pawn or more", 100, 1e9]];
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
  $("#gList").innerHTML = recentGamesHtml(A); // review.js: each game opens its review
}
/* ----- Games > Build my tree from my games (autobuild.js) ----- */
function renderAutoBuild() {
  const box = $("#abBody");
  if (!box) return;
  const o = abOpts(), C = S.color === "white" ? "White" : "Black", mine = S.games.filter(g => g.my === S.color).length;
  if (AB.running) {
    const p = AB.plan;
    box.innerHTML = `<p class="help" aria-live="polite">Checking your ${AB.color === "white" ? "White" : "Black"} games… ${AB.checks} engine checks · ${p ? p.adds.filter(a => a.mine).length : 0} of your moves found so far</p>
      <button type="button" class="btn ghost" id="abStop">Stop</button>`;
    $("#abStop").onclick = () => { AB.stop = true; };
    return;
  }
  const p = AB.plan && AB.plan.color === S.color ? AB.plan : null;
  if (p) {
    const myAdds = p.adds.filter(a => a.mine), opp = p.adds.length - myAdds.length;
    const row = a => `<li><span class="mono">${esc(numbered(0, a.path.concat(a.san)))}</span> <span class="help">${a.games} games · you score ${a.score == null ? "–" : pctOf(a.score)}${a.loss != null ? ` · engine −${(a.loss / 100).toFixed(1)}` : ""}${a.poor ? ` · <span class="warnt">you score under ${Math.round(abOpts().minScore * 100)}% with it: worth a look</span>` : ""}${a.why ? ` · ${a.why === "engine" ? "dubious for the engine" : "results too poor"}` : ""}</span></li>`;
    box.innerHTML = `<p class="possum">${p.stopped ? "Stopped early. " : ""}<b>${myAdds.length}</b> of your moves and <b>${opp}</b> opponent replies to add to your ${C} repertoire (${esc(prepBookName())}).</p>
      ${myAdds.length ? `<p class="lbl" style="margin-top:8px">Your moves</p><ol class="ablist">${myAdds.map(row).join("")}</ol>` : ""}
      ${p.skipped.length ? `<details style="margin-top:6px"><summary class="help">${p.skipped.length} move${p.skipped.length === 1 ? "" : "s"} left out</summary><ol class="ablist">${p.skipped.map(row).join("")}</ol></details>` : ""}
      <div class="row" style="margin-top:10px">${p.adds.length ? `<button type="button" class="btn" id="abAdd">Add ${p.adds.length} move${p.adds.length === 1 ? "" : "s"}</button>` : ""}<button type="button" class="btn ghost" id="abDiscard">${p.adds.length ? "Discard" : "Close"}</button></div>`;
    if (p.adds.length) $("#abAdd").onclick = () => { const n = applyAutoBuild(p); AB.plan = null; renderGames(); toast(`Added ${n} move${n === 1 ? "" : "s"} to your ${C} repertoire.`); };
    $("#abDiscard").onclick = () => { AB.plan = null; renderAutoBuild(); };
    return;
  }
  const num = (id, label, v, attrs) => `<label for="${id}">${label.replace("#", `<input type="number" id="${id}" value="${v}" ${attrs}>`)}</label>`;
  box.innerHTML = `<p class="help">For your <b>${C}</b> repertoire, from ${nOf(mine)} games as ${C}. Switch colour at the top.</p>
    <div class="gemgrid abopts">
      ${num("abGames", "Played at least # times", o.minGames, 'inputmode="numeric" min="1" max="100"')}
      ${num("abScore", "Flag moves you score under # %", Math.round(o.minScore * 100), 'inputmode="numeric" min="0" max="100"')}
      ${num("abLoss", "Engine: gives up at most # pawns", (o.maxLoss / 100).toFixed(1), 'inputmode="decimal" min="0.1" max="5" step="0.1"')}
      ${num("abPlies", "Up to move #", Math.round(o.plies / 2), 'inputmode="numeric" min="2" max="20"')}
    </div>
    <label class="check" style="margin-top:6px"><input type="checkbox" id="abStrict" ${o.strictScore ? "checked" : ""}> Leave those moves out instead (this also drops every line after them)</label>
    <button type="button" class="btn" id="abRun" style="margin-top:8px" ${mine ? "" : "disabled"}>${mine ? "Find moves to add" : `Import games first`}</button>`;
  const save = () => {
    const v = id => +$("#" + id).value;
    S.settings.autobuild = { minGames: Math.max(1, Math.round(v("abGames")) || 3), minScore: Math.min(1, Math.max(0, v("abScore") / 100)), maxLoss: Math.max(10, Math.round(v("abLoss") * 100) || 70), plies: Math.max(4, Math.round(v("abPlies") * 2) || 20), strictScore: $("#abStrict").checked };
    Store.save("settings");
  };
  box.querySelectorAll("input").forEach(i => (i.onchange = save));
  $("#abRun").onclick = async () => {
    save();
    Object.assign(AB, { running: true, stop: false, checks: 0, plan: null, color: S.color });
    renderAutoBuild();
    let last = 0;
    try {
      AB.plan = await planAutoBuild(AB.color, abOpts(), p => { AB.plan = p; if (Date.now() - last > 400 && S.view === "games") { last = Date.now(); renderAutoBuild(); } });
    } catch (e) { toast("Couldn't finish: " + e.message); }
    AB.running = false;
    if (S.view === "games") renderAutoBuild();
    else toast("Your tree from your games is ready to review on the Games tab.");
  };
}
function importPasted() {
  const text = $("#pgnIn").value;
  if (!text.trim()) { toast("Paste one or more games first."); return; }
  if (!S.settings.user.trim()) { toast("Add your chess.com username in Settings so the app knows which side you played."); return; }
  const list = splitGames(text).map(g => gameFromPGN(g, S.settings.user));
  const mine = list.filter(g => g.my);
  const rapid = mine.filter(g => g.tc === "rapid");
  const added = addGames(list);
  $("#importStatus").textContent = `Read ${list.length} game${list.length === 1 ? "" : "s"}: ${mine.length} with you playing, ${rapid.length} rapid, ${added} new.`;
  $("#pgnIn").value = "";
  warmGameKeys(() => { flagMisplays("white"); flagMisplays("black"); render(); });
  render();
}


/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("goab", d => { setView("games"); const c = $("#abCard"); if (c) c.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }); }, true);
