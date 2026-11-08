"use strict";
/* ---------- Updates page ("What's new") ----------
   Newest first. Each entry: {id (unique, newest is compared with pb_seen_update to show the
   header's "New" marker), date, title, items: [plain-language lines]}. Add a new entry at the
   top whenever something user-visible ships. */
const UPDATES = [
  {
    id: "2026-11-08c", date: "8 Nov 2026", title: "Tighter Build on the phone, and an installable app",
    items: [
      "The opening name and the moves sit above the board, one line each; swipe the moves sideways.",
      "The board stays put when you scroll, and is a little smaller so more moves fit underneath.",
      "Each move row is one line: green outline = in your repertoire, orange = a gap.",
      "New Rep column: how many good replies your opponent has. Purple = a practical weapon.",
      "Practise is now a button under the board: practise the lines from the position you're on.",
      "Explanations moved behind ⓘ buttons; the summary line is shorter.",
      "Prep Book can be installed as an app (Chrome menu → Install app), which removes the address bar.",
    ],
  },
  {
    id: "2026-11-08b", date: "8 Nov 2026", title: "Practising lines, gaps, explore mode and follow-ups",
    items: [
      "Practise lines: play whole lines; the app mixes your opponent's replies so every branch comes up.",
      "Gap ›: jumps to your next gap. In Gaps, rank by how often you'll get there or by rating impact.",
      "Explore mode: try moves for either side without saving, then save the line if you like it.",
      "For your moves: how many good replies your opponent has and how often players at your level find one.",
      "Build moves show engine, peers and your own games side by side; tap a row for the full W/D/L.",
      "Settings → Advanced holds every threshold in one place.",
    ],
  },
  {
    id: "2026-11-08a", date: "8 Nov 2026", title: "Groundwork: your games, clocks and the engine",
    items: [
      "Each game is stored on its own in the database, so saving is quicker and lighter on data.",
      "Clock times are kept for each move (fetch from chess.com again to add them to older games).",
      "Analyse all now gives every move of every game an engine evaluation (for mistake review, coming next).",
      "Engine results are shared between your devices.",
      "The Lichess rating bands follow your chess.com rapid rating unless you set them by hand.",
      "Slow work (engine, Lichess) runs in the background; what's on screen goes first.",
    ],
  },
  {
    id: "2026-11-07", date: "7 Nov 2026", title: "Faster, smoother, more to explore",
    items: [
      "The board is much faster with lots of games, and pieces slide when they move.",
      "Prep books: keep separate repertoires; clear White or Black; a save indicator in the header.",
      "Hidden gems, easy-to-remember moves and practical tricks from Lichess and Stockfish.",
      "Move arrows on the board, sized by how often each move is played.",
      "Piece sets and board colours (Settings → Board).",
      "Stockfish 17, about 20–45 times faster than before.",
    ],
  },
];
const updatesNew = () => lsGet("pb_seen_update", "") !== UPDATES[0].id;
function renderUpdates() {
  $("#updatesList").innerHTML = UPDATES.map(u => `<article class="card upd">
    <p class="lbl">${esc(u.date)}</p><h3>${esc(u.title)}</h3>
    <ul>${u.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></article>`).join("");
  lsSet("pb_seen_update", UPDATES[0].id);
  renderNewMark();
}
// The header's "New" marker: shown until the Updates page has been opened
function renderNewMark() { const b = $("#newMark"); if (b) b.hidden = !updatesNew(); }
