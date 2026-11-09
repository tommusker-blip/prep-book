"use strict";
/* ---------- Updates page ("What's new") ----------
   Newest first. Each entry: {id (unique, newest is compared with pb_seen_update to show the
   header's "New" marker), date, title, items: [plain-language lines]}. Add a new entry at the
   top whenever something user-visible ships. */
const UPDATES = [
  {
    id: "2026-11-09w", date: "9 Nov 2026", title: "Peers and masters on one line",
    items: [
      "Played and Score now read peers/masters on one line, for example 70%/80%, with the masters' figure smaller and grey.",
    ],
  },
  {
    id: "2026-11-09v", date: "9 Nov 2026", title: "Fewer pop-ups in Build",
    items: [
      "The dark messages at the bottom of Build are gone for things you can already see: going to a gap, removing a move, saving an explored line, every reply being prepared, and the rating bands following your chess.com rating.",
      "They still appear when something goes wrong (the engine or Lichess), or when Gap › has nowhere to go.",
    ],
  },
  {
    id: "2026-11-09u", date: "9 Nov 2026", title: "Masters next to your peers",
    items: [
      "Build's Played and Score columns now show masters too: your peers' figure on top, and a grey M line under it from the Lichess masters database.",
      "Moves masters often play are listed even when players at your level rarely choose them.",
      "Tap a row to see the masters' wins, draws and losses next to your peers'.",
      "It's a trial: switch it off in Settings → Building your tree if the rows feel too busy.",
    ],
  },
  {
    id: "2026-11-09t", date: "9 Nov 2026", title: "Move rows spread out",
    items: [
      "The columns in Build's move rows now share the width evenly, with the numbers centred under their headings, instead of bunching up on the left.",
      "An opening's name now sits above its move rather than below it.",
      "Behind the scenes: the app's code has been tidied up into one file per screen, which should make future changes quicker and safer.",
    ],
  },
  {
    id: "2026-11-09s", date: "9 Nov 2026", title: "Fixes found while tidying up",
    items: [
      "Your browser's password manager no longer pops up in Settings. The Lichess token box is still hidden as you type, but it isn't a password field any more.",
      "On a computer, Build shows the board on the left and the moves on the right again (since v0.9.1 they were stacked).",
      "The Explore button turns orange while Explore mode is on (its text had become invisible).",
    ],
  },
  {
    id: "2026-11-09r", date: "9 Nov 2026", title: "Snappier auto-reply, and the card is back",
    items: [
      "When Build plays your opponent's reply for you, it no longer works out the rows for the position in between. You see “Playing your opponent's reply…” for a moment, and the rows appear once it's your move again.",
      "Gambits are marked with the playing card 🃏 again, a little bigger.",
      "The Score column is now headed Peer score: how your colour scores after the move in Lichess games at your level.",
      "Fixed: after an update, the app could mix new and old files from your phone's cache (for example the Tags column still on the right). Each release now loads fresh.",
    ],
  },
  {
    id: "2026-11-09q", date: "9 Nov 2026", title: "Simpler move marks",
    items: [
      "Gambits are now marked with 🎲, which shows clearly on phones. The tags (🎲 💎 ⚔ ⇄ ⚠) now sit just left of the move.",
      "Only one mark is left on the moves: !? for an interesting move, one the engine likes less but that's a gambit or scores well at your level.",
      "On your turn, dubious and bad moves are hidden: anything more than 1.5 worse than the best move, as well as moves that leave you below −1.5. Gambits, hidden gems and your own repertoire moves still show, and Show brings the rest back.",
    ],
  },
  {
    id: "2026-11-09p", date: "9 Nov 2026", title: "Clearer move rows: a key, marks and symbols",
    items: [
      "Each row now shows its state across the whole row: blue for your repertoire or a prepared reply, orange for a gap, and a dashed blue outline for a move that transposes into a position you've already prepared.",
      "Moves carry chess marks for whoever is moving: ! strong, ?! dubious, ? bad, and !? for a move the engine dislikes that's a gambit or scores well at your level.",
      "The last column is now Tags: 💎 hidden gem, ⚔ practical weapon, 🃏 gambit, ⇄ transposes into your prep, ⚠ watch out. Tap a row to read them in full.",
      "The move buttons are all the same size.",
      "A Key under the rows explains every colour, mark, symbol, column and board arrow. Close it once you know it; it stays closed.",
    ],
  },
  {
    id: "2026-11-09o", date: "9 Nov 2026", title: "Act on suggestions directly",
    items: [
      "Openings → Suggestions: hidden gems, better-scoring alternatives, practical tricks and easy-to-remember moves now have buttons to Replace your move with the suggestion, or Add it as another option, without going to Build.",
      "Replacing a move also takes out the line that followed it. Undo straight after puts everything back.",
      "Moves already in your repertoire say so. Tap the suggestion itself to look at it in Build first.",
    ],
  },
  {
    id: "2026-11-09n", date: "9 Nov 2026", title: "Suggestions move to the Openings page",
    items: [
      "The Whole tree tab has moved out of Build to the Openings page, as Suggestions next to Your openings: a review of your whole repertoire in one place.",
      "Scan my tree and Find ideas across my tree are there too. Tap any suggestion to open it in Build.",
      "Build now has two tabs: Moves, and Ideas here for the position on the board.",
    ],
  },
  {
    id: "2026-11-09m", date: "9 Nov 2026", title: "Openings kept, Remove, and a preview board",
    items: [
      "The Openings tab is now saved on your device, so it opens at once, even after closing the app. When your tree, games or analysis change, it updates in the background with a thin progress bar, and you can still use the page meanwhile. Recalculate picks up new Lichess data.",
      "Each opening in the Openings tab has a Remove button. It takes the line out from where it starts, along with its training cards, and you can Undo straight after.",
      "Add an opening now has a board: tap the main line or any variation's name to see it, then step through it with ◀ ▶ or by tapping a move. The tick box still chooses what gets added.",
      "In Build, a move that reaches a named opening line shows the name under its row, in blue.",
      "On your turn in Build, thin dashed arrows show the moves you usually play there in your own games.",
      "The Gaps tab has gone from Build: Gap › does the same job and now says which gap it went to. How gaps are ranked, the automatic opponent reply and Build my tree from my games are together in Settings → Building your tree.",
      "Build's other tabs are renamed: Ideas here (this position) and Whole tree (suggestions from every line you have, formerly Lichess).",
    ],
  },
  {
    id: "2026-11-09l", date: "9 Nov 2026", title: "Add an opening by name",
    items: [
      "Openings → Add an opening: search all 3,865 named openings and variations (for example Benko, Najdorf or A57), pick one, choose White or Black, and its moves go into your repertoire.",
      "It also lists that opening's deeper variations: tick the ones you want and they're added too, so you have a few lines to build around.",
      "If you already play a different move somewhere along the line, the new move is added as another option; nothing is replaced.",
      "In Build, the candidate moves are now ranked by the engine, best first.",
      "Tap one of your candidate moves in Build to see how well it fits your prep: the chance it transposes into your lines, or how alike its setup is to your other lines.",
    ],
  },
  {
    id: "2026-11-09k", date: "9 Nov 2026", title: "Faster Openings tab, grouped by name",
    items: [
      "The Openings tab is kept once worked out, so coming back to it is instant. When something has changed, a progress bar shows while it updates.",
      "The top level is now grouped by opening name (Italian Game, Ruy Lopez, Sicilian Defence…) instead of starting with 1.e4. Variations sit under their family, without repeating its name.",
      "Build my tree from my games no longer drops a line because you score badly with an early move: the move is added and flagged in orange, so the prep after it is kept. Run it again to fill in what was missed. A tick box brings back the old behaviour.",
    ],
  },
  {
    id: "2026-11-09j", date: "9 Nov 2026", title: "Idea lines: deeper lines with the plan behind them",
    items: [
      "New on the Train page, Ideas worth learning: deeper model lines from where your prep ends, in the lines your games actually reach, worst accuracy after book first.",
      "The moves are what masters play most (Lichess masters database; strong Lichess games where masters run out), checked by Stockfish.",
      "Each line names its pawn structure (French advance chain, Carlsbad, Maroczy bind and about 20 more) with the usual plans for both sides, and marks the two or three moves that carry the idea in blue.",
      "Step through it with ◀ ▶ or the move list, or tap Quiz me: the line plays itself and stops at each key moment for you to find the move.",
      "Also in the Openings tab: each entry has its typical ideas, and a button to find some for that line.",
      "Idea lines are separate: they're never added to your repertoire or training cards, and Build is unchanged.",
    ],
  },
  {
    id: "2026-11-09i", date: "9 Nov 2026", title: "Opening catalogue",
    items: [
      "New Openings tab: your repertoire grouped by opening, opening out into its main lines. Branches are made where the opening name changes or the line splits into main replies, not for every move.",
      "Each entry shows how much of what you'll meet is covered, your score and accuracy from your own games, and a short comment, such as 'Mostly covered; your results are poor (38% in 21 games). Worth more training, or a rethink.'",
      "Build opens that line on the board; Train this line practises just that branch.",
      "Fixed: the Score and You column headings in Build no longer overlap.",
    ],
  },
  {
    id: "2026-11-09h", date: "9 Nov 2026", title: "Faster Train, easier to find auto-build",
    items: [
      "Train no longer looks through all your games for mistakes every time. The results are kept on this device, and only new or re-analysed games are checked.",
      "Build my tree from my games is now near the top of the Games tab, and there's a shortcut to it in Build → Gaps.",
    ],
  },
  {
    id: "2026-11-09g", date: "9 Nov 2026", title: "Clearer move rows",
    items: [
      "Evals are now from White's side whichever colour you play: + is good for White, − for Black.",
      "No more ✓ and −x marks. The eval's colour shows how the move compares with the best one: blue strong, plain playable, orange weak. A small g marks a gambit.",
      "Narrower Move and Eval columns, so the numbers fit without resizing. The column key is written under the rows.",
      "Tap a row to see all its numbers in full, in case a column is cut short.",
    ],
  },
  {
    id: "2026-11-09f", date: "9 Nov 2026", title: "Mistake review: the whole game",
    items: [
      "◀ now goes all the way back to the first move of the game, not just a few moves.",
      "Tap any move in the list above the board to jump to it. Before you answer, the list runs up to the puzzle; after, it shows the whole game, with your mistake underlined.",
    ],
  },
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
