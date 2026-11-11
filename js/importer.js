"use strict";
/* chess.com import (rating, games) and the engine analysis of my games (Games tab).
   Classic script: shares one global scope with the others (see index.html for the load order). */
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
      // no message: Settings shows the bands and why
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
async function archiveList(u) {
  const r = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(u.toLowerCase())}/games/archives`, { cache: "no-cache" });
  if (!r.ok) throw new Error(r.status === 404 ? "No chess.com player with that username." : "chess.com returned an error (" + r.status + ").");
  return (await r.json()).archives || [];
}
// Fetch these monthly archives and add my rapid games (existing ones are kept, not fetched again)
async function importArchives(urls, u, onMonth = () => {}) {
  let added = 0, clocks = 0;
  for (const [i, a] of urls.entries()) {
    onMonth(i, urls.length);
    const rr = await fetch(a, { cache: "no-cache" }); // the current month changes: ask chess.com, not the browser cache
    if (!rr.ok) continue;
    const { games } = await rr.json();
    const list = games.filter(x => x.rules === "chess" && x.time_class === "rapid" && x.pgn)
      .map(x => { const g = gameFromPGN(x.pgn, u, "rapid"); g.url = x.url || g.url; return g; });
    added += addGames(list); clocks += addGames.clocks;
  }
  return { added, clocks };
}
/* v0.9.40: new games come in by themselves. When the app opens or comes back to the screen (at most
   every AUTO_IMPORT_GAP), it fetches only the archives from the month of my newest game onwards,
   usually one or two, so nothing already imported is fetched again. The first import, and older
   months, are still the Import button's job. Not inside Claude (no outside sites there). */
const AUTO_IMPORT_GAP = 10 * 60000;
let autoImporting = false;
async function autoImport() {
  const u = (S.settings.user || "").trim();
  if (autoImporting || S.storeMode === "db" || S.settings.autoImport === false || !validChessComUser(u) || !S.games.length) return;
  if (Date.now() - (+lsGet("pb_autoimp", 0) || 0) < AUTO_IMPORT_GAP) return;
  autoImporting = true;
  try {
    const archives = await archiveList(u);
    const newest = S.games.reduce((m, g) => (g.date && g.date > m ? g.date : m), ""), since = newest.slice(0, 7).replace("-", "/");
    const urls = since ? archives.filter(a => a.slice(-7) >= since) : archives.slice(-1);
    const { added } = await importArchives(urls, u);
    lsSet("pb_autoimp", Date.now());
    if (added) {
      toast(`${added} new game${added === 1 ? "" : "s"} from chess.com`);
      warmGameKeys(() => { flagMisplays("white"); flagMisplays("black"); if (!(S.view === "train" && T.state === "run")) render(); });
    }
  } catch (e) { /* offline or chess.com unreachable: try again next time */ }
  finally { autoImporting = false; }
}
async function fetchChessCom() {
  const u = S.settings.user.trim();
  if (!u) { toast("Add your chess.com username in Settings first."); return; }
  const st = $("#importStatus");
  if (!validChessComUser(u)) { st.textContent = `"${u}" isn't a chess.com username. ${USER_HELP} Change it in Settings.`; return; }
  st.textContent = "Fetching your game archive list…";
  try {
    const pick = (await archiveList(u)).slice(-S.settings.months);
    const { added, clocks } = await importArchives(pick, u, (i, n) => { st.textContent = `Fetching month ${i + 1} of ${n}…`; });
    lsSet("pb_autoimp", Date.now());
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
      touchData();
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
