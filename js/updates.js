"use strict";
/* ---------- Updates page ("What's new") ----------
   Newest first. Each entry: {id (unique, newest is compared with pb_seen_update to show the
   header's "New" marker), date, title, items: [plain-language lines]}. Add a new entry at the
   top whenever something user-visible ships. */
const UPDATES = [
  {
    id: "2026-11-09e", date: "9 Nov 2026", title: "Build your tree from your games",
    items: [
      "Games → Build my tree from my games: goes through your games and adds the moves you play often, if you score well with them and Stockfish doesn't think they're dubious, plus the replies you meet often. You see the list first, and nothing in your repertoire is replaced.",
      "Fixed: the page no longer gets wider after playing several moves in Build.",
      "On phones the Build buttons stand beside the board, so there's more room for the moves.",
      "Moves that leave you worse than −1.5 are hidden on your turn (gambits and your own moves still show). Tap Show to see them. Change the number in Settings → Advanced.",
      "The rows now show how common each move is (Played, with a bar) and the score after it in separate columns.",
    ],
  },
  {
    id: "2026-11-09d", date: "9 Nov 2026", title: "Smoother Build, drag to move, better mistake review",
    items: [
      "Drag pieces to move them, or tap as before. Dragging a piece doesn't scroll the page.",
      "Build is lighter: results arriving in the background only update the move rows, so the board no longer redraws and a piece you've picked up stays selected.",
      "Each move gets a quick engine check. Tap Deeper analysis under the rows for a full check and the Rep column.",
      "After you add a move, the opponent's reply is played for you: the biggest gap among the replies you haven't prepared. Change it in Settings.",
      "On phones the tabs and the column headers stay in place under the board, so only the moves scroll. The board is back to its bigger size.",
      "Mistake review: puzzles come in a random order, start 5 moves before the mistake, and show arrows for the best move (blue), the game's move (orange) and yours (purple). ◀ ▶ step through the moves before it, and after you answer, through what happened next.",
    ],
  },
  {
    id: "2026-11-09c", date: "9 Nov 2026", title: "Coach report, and two fixes",
    items: [
      "Games → Coach report: a summary of your openings, where you leave prep, lines where you score below peers, gaps, training and mistakes. Copy it for an AI coach, or copy or download it as JSON.",
      "Gaps now clear as soon as you add a move, in Rating impact mode too. Prepared lines where you score badly have moved to the coach report.",
      "Next gap now plays the opponent's unprepared reply for you, so you land on your own move. The reply is saved when you answer it.",
      "Lichess no longer stops working after a dropped connection. It waits a few seconds and tries again, so you shouldn't need to paste your token again.",
    ],
  },
  {
    id: "2026-11-09b", date: "9 Nov 2026", title: "A softer, lighter look",
    items: [
      "A new light colour scheme: soft greys, white cards and a calm blue accent.",
      "Colour-blind friendly: good is blue and bad is orange everywhere (results bars, ✓ and drops, prepared and gap moves, arrows).",
      "Purple still marks hidden gems and practical weapons.",
      "New default board, Soft blue (your own board choice is kept).",
      "Settings → Board → Appearance: Light, Dark, or Match my phone. Light is the default.",
      "Less text on the Train screen: explanations are behind ⓘ.",
    ],
  },
  {
    id: "2026-11-09a", date: "9 Nov 2026", title: "Mistake review: puzzles from your own games",
    items: [
      "Train → Mistake review turns your real mistakes into puzzles: moves that lost 1.5 pawns or more (or threw away a win or a draw) and that your opponent actually punished.",
      "Moves made with under 30 seconds left, positions that were already lost, recaptures and only-moves are left out.",
      "The game replays up to the moment; find any good move. Then you see what you played and how it was punished.",
      "Choose Keep (it comes back on a schedule), Seen it, or Later. The app suggests one.",
      "An overview counts all your mistakes by game phase and by time left on the clock.",
      "The thresholds are in Settings → Advanced.",
    ],
  },
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
