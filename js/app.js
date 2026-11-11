"use strict";
/* App shell: switching views, the header (background jobs, save status), the Lichess token,
   and boot(), which wires up the page. The screens are in build.js, suggest.js, train.js,
   gamesview.js and settings.js; the board in board.js; chess.com import in importer.js. */
/* ---------- views ---------- */
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
  if (S.view === "updates") renderUpdates();
  if (S.view === "report") renderReport();
  if (S.view === "openings") showOpeningsTab();
  if (S.view === "idea") renderIdea();
  if (S.view === "review") renderReview();
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
/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("nav", d => { if (S.view === "train" && T.state === "run" && d.nav !== "train") { stopTraining(); T.state = "idle"; } setView(d.nav); });
onClick("undo", d => { if (RepUndo.undo(d.undo)) render(); }); // RepUndo, from undoNote()
onClick("color", d => { stopTraining(); S.color = d.color; T.state = "idle"; render(); });

async function boot() {
  BB = Board($("#board"));
  TB = Board($("#tBoard"));
  BB.onMove = mv => onBuildMove(mv);
  TB.onMove = mv => onTrainMove(mv);
  Store.onStatus = renderSaveState;
  const state = await Store.init();
  if (state === "auth") await new Promise(res => showAuth(res));
  applyLook(); syncToken(); renderHeader(); renderNewMark();
  // v0.9: Build plays the biggest-gap reply by default. Switch older settings over once (asked for
  // on 9 Nov 2026); it can be changed back in Settings.
  if (S.settings.autoOppV !== 2) { S.settings.autoOpp = "gap"; S.settings.autoOppV = 2; Store.save("settings"); }
  fetchRating(); // G4, at most once a day, in the background
  walk("white"); walk("black");
  warmGameKeys(() => { if (!(S.view === "train" && T.state === "run")) render(); }); // game positions, in the background
  autoImport(); // v0.9.40: new chess.com games, only the latest months, in the background
  $("#loading").hidden = true;
  window.addEventListener("pagehide", () => Store.flushAll());
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") { Store.flushAll(); return; }
    const docsChanged = await Store.refresh(), gamesChanged = await Games.refresh(); // games after settings (gamesEpoch)
    if (docsChanged || gamesChanged) { walk("white"); walk("black"); applyLook(); syncToken(); renderHeader(); warmGameKeys(() => render()); if (!(S.view === "train" && T.state === "run")) render(); }
    autoImport();
  });
  document.addEventListener("click", e => { const t = e.target.closest("button"); if (t) dispatchClick(t); });
  $("#back").onclick = () => { curPath().pop(); renderBuild(); };
  $("#fwd").onclick = () => {
    if (exploring()) { const line = S.explore[S.color] || [], path = curPath(); if (line.length > path.length && line.slice(0, path.length).join(" ") === path.join(" ")) { path.push(line[path.length]); renderBuild(); return; } }
    const path = curPath(); const key = K(fenAfter(START, path)); const n = rep().pos[key];
    if (n && n.m.length) { path.push(n.m[0]); renderBuild(); }
  };
  // ⏮: with a focus (focus.js), back to where the opening starts; from there, the very start
  $("#toStart").onclick = () => { const f = focusPath(), p = curPath().join(" "); S.build[S.color] = f.length && p !== f.join(" ") && inFocus(p) ? f.slice() : []; renderBuild(); };
  $("#quickGap").onclick = () => { const list = focusGaps(rankedGaps()), t = nextGapTarget(list); if (t) { S.ptab = "moves"; jumpToGap(t.id, list); } else toast(focusOn() ? `No gaps found in ${focusName()} so far. Clear the focus to look everywhere.` : "No gaps found in the positions checked so far."); };
  // Build rows (rows.js): tap a row to expand it; the move button inside plays the move
  Tip.init();
  // Keep --hdr at the header's height, so the pinned Build board sits just under it
  // header height plus its bottom gap: the board's natural position, so it locks without moving first
  const hdr = document.querySelector(".top"), setHdr = () => document.documentElement.style.setProperty("--hdr", hdr.offsetHeight + parseFloat(getComputedStyle(hdr).marginBottom) + "px");
  setHdr(); if (window.ResizeObserver) new ResizeObserver(setHdr).observe(hdr);
  // The Build tabs and the move rows' column headers stay pinned under the board on phones: they
  // need the board column's height (--bcol) and the tabs' height (--ptabs)
  const bcol = $("#buildBoardCol"), ptabs = document.querySelector(".ptabs");
  const setPin = () => { const st = document.documentElement.style; st.setProperty("--bcol", bcol.offsetHeight + "px"); st.setProperty("--ptabs", ptabs.offsetHeight + "px"); };
  setPin(); if (window.ResizeObserver) { const ro = new ResizeObserver(setPin); ro.observe(bcol); ro.observe(ptabs); }
  const toggleCand = san => { const id = K(fenAfter(START, curPath()) || START) + "|" + san; if (candOpen.has(id)) candOpen.delete(id); else candOpen.add(id); renderBuild(); };
  $("#prompt").addEventListener("click", e => { if (e.target.closest("button, a, [data-tip]")) return; const row = e.target.closest(".cand"); if (row) toggleCand(row.dataset.cand); });
  $("#prompt").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("cand")) { e.preventDefault(); toggleCand(e.target.dataset.cand); } });
  $("#tStart").onclick = startTraining;
  $("#repCopyAI").onclick = () => { if (coachReport) copyText(coachPrompt(coachReport), "The report for an AI coach"); };
  $("#repCopyJSON").onclick = () => { if (coachReport) copyText(JSON.stringify(coachReport, null, 1), "The report"); };
  $("#repDownload").onclick = () => { if (!coachReport) return; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(coachReport, null, 1)], { type: "application/json" })); a.download = `prep-book-report-${coachReport.generated}.json`; a.click(); };
  $("#tLines").onclick = startLines;
  $("#simStart").onclick = startSimilar;
  $("#tRootReset").onclick = () => { S.settings.practiceRoot = { ...(S.settings.practiceRoot || {}), [S.color]: [] }; Store.save("settings"); renderTrainHome(); };
  $("#tBoard").addEventListener("click", skipLine); // tap to skip the line replay
  $("#board").addEventListener("click", () => { if (BA.on && BA.done) BA.done(); }); // and the replay up to a gap (gaps.js)
  $("#tStop").onclick = endSession;
  // Catalogue: remember which entries are open across redraws
  document.addEventListener("toggle", e => { if (e.target.dataset && "rkey" in e.target.dataset) lsSet("pb_legend", e.target.open ? "open" : "closed"); }, true);
  $("#catBody").addEventListener("toggle", e => { const p = e.target.dataset && e.target.dataset.catpath; if (p == null) return; if (e.target.open) catOpen.add(p); else catOpen.delete(p); }, true);
  $("#addOpenBox").addEventListener("change", e => { const v = e.target.dataset && e.target.dataset.aovar; if (v != null) aoTick(v, e.target.checked); });
  $("#pzBack").onclick = () => pzStep(-1);
  $("#rvBack").onclick = () => revGo(RV.i - 1);
  $("#rvBoard").addEventListener("click", () => { if (RV.playTo) revGo(RV.playTo); }); // a tap skips the replay
  $("#rvFwd").onclick = () => revGo(RV.i + 1);
  $("#iBack").onclick = () => ideaGo(IV.i - 1);
  $("#iFwd").onclick = () => ideaGo(IV.i + 1);
  $("#iStart").onclick = () => ideaGo(IV.start);
  $("#iClose").onclick = () => { IV.token++; setView(IV.back || "train"); };
  $("#pzFwd").onclick = () => pzStep(1);
  $("#pzHere").onclick = () => pzStep("start");
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
  for (const [id, field, lo, hi, scale] of [["advGood", "good", 10, 300, 100], ["advMistake", "mistake", 30, 900, 100], ["advClock", "clock", 0, 600, 1], ["advK", "k", 1, 200, 1], ["advUnplayable", "unplayable", 50, 900, 100]]) {
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
