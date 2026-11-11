"use strict";
/* ---------- Updates page ("What's new") ----------
   Newest first. Each entry: {id (unique, newest is compared with pb_seen_update to show the
   header's "New" marker), v (the release, same as ?v= in index.html), date, title,
   items: [plain-language lines]}. Entries before v0.9 have no v. Add a new entry at the
   top whenever something user-visible ships. */
const UPDATES = [
  {
    id: "2026-11-11s", v: "0.9.45", date: "11 Nov 2026", title: "Board squares the right way round",
    items: [
      "The light and dark squares were swapped on every board (a1 was light). a1 is now dark and h1 light, as on a real board.",
    ],
  },
  {
    id: "2026-11-11r", v: "0.9.44", date: "11 Nov 2026", title: "Routes from the start: how far along it is",
    items: [
      "While Routes from the start searches, it shows roughly how much is done (with a bar) and, once it's a tenth of the way, roughly how long is left.",
      "It also says how many Lichess look-ups it has made out of the most it will make (220). After that it only uses data already loaded, so the rest goes quickly.",
    ],
  },
  {
    id: "2026-11-11q", v: "0.9.43", date: "11 Nov 2026", title: "Ideas one at a time, and structures you can see",
    items: [
      "Openings > Ideas now shows one idea at a time, the one most likely to win you points first, on a board with your move (blue) and the idea (purple). Keep it with Replace or Add, Skip it, or step through with ◀ ▶.",
      "Each idea says how sure it is: whether the score difference at your level could be chance, what Stockfish thinks of it against your move, and your own games there. Gems your move already scores as well as are left out, and \"Same pawn structure\" is gone.",
      "Visualise > Structures: each structure has a small board with its most common position in your games (in \"Worth your attention\", the one costing you most), with the files it's about tinted.",
      "Example now opens the game at the move you're looking at and plays the moves up to it (tap the board to skip).",
      "Tree: the board for a tapped slice is centred, and scrolls into view on a phone.",
    ],
  },
  {
    id: "2026-11-11p", v: "0.9.42", date: "11 Nov 2026", title: "Structures: what's costing you, and where it comes from",
    items: [
      "Visualise > Structures starts with \"Worth your attention\": up to 3 structures where you score below your average, the ones costing you most points first (games × the drop in your score).",
      "Each one says where it comes from: the openings of those games, and your last prepared choice before it (for example 5.d4 after 1.e4 c5 2.Nf3 d6).",
      "Two ways to act on it: \"Avoid: other moves in Build\" opens that choice so you can pick a different move, and \"Practise this line\" trains the line if you'd rather get better at it. Example opens a game.",
    ],
  },
  {
    id: "2026-11-11o", v: "0.9.41", date: "11 Nov 2026", title: "Structures: the indicators linked together",
    items: [
      "Visualise > Structures now links the indicators into structures: the features that come up together in your games at that move. For example \"You no d-pawn · Them no c-pawn\", or \"Fixed centre · You backward d-pawn\".",
      "Your most common structures come first, each with how often you get it (large), the number of games and your score against your average. Then the ones where you score best and worst. Example opens your most recent game with it.",
      "Named structures are gone. The per-file tables are still there, folded away under \"Each indicator by file\".",
    ],
  },
  {
    id: "2026-11-11n", v: "0.9.40", date: "11 Nov 2026", title: "New games come in by themselves",
    items: [
      "When the app opens, or comes back to the screen, it checks chess.com for new rapid games (at most every 10 minutes). It only fetches the month of your newest game and any later ones, so your other games aren't loaded again. A short message says how many arrived. You can turn it off in Settings, next to your chess.com username.",
      "Openings: the Map tab is now called Visualise.",
    ],
  },
  {
    id: "2026-11-11m", v: "0.9.39", date: "11 Nov 2026", title: "Routes from the start, pawn features, and one Map tab",
    items: [
      "New in Build > My lines: Routes from the start. On a position (say move 10), it finds the likely ways to get there from move 1 by any move order and puts them together as one plan. It shows how often you'd get there, each line with its chance, where opponents step off, and any move that differs from your tree. Add the plan to my tree, with Undo. Choose how often an opponent move must be played to count: 5, 10, 15, 20 or 25% (25% by default).",
      "Openings: Map and Picture are one tab now, with three views: Openings map, Tree and Structures.",
      "Structures, redone: at a move you choose (◀ ▶), the type of centre (open, closed, fixed, mobile, tension, no contact yet) and each side's missing, isolated, doubled, backward and passed pawns by file, with the share of your games and your score in them shown large. By move shows how often each comes up from move 4 to 20. Named structures and their plans are listed underneath.",
    ],
  },
  {
    id: "2026-11-11l", v: "0.9.38", date: "11 Nov 2026", title: "Connect: the eval of the move you'd drop",
    items: [
      "Connect: the Drop line shows the eval after the move you'd give up, and the Keep line the eval after your new move from the same position, so you can compare the two directly (White's side, as everywhere).",
    ],
  },
  {
    id: "2026-11-11k", v: "0.9.37", date: "11 Nov 2026", title: "Quicker gap replay, and the version on the loading screen",
    items: [
      "Gap ›: the replay is quicker and shorter. It plays only the last 6 moves before the gap (3 each), at one move per slide, so it's over in about a second however deep the gap is. Tap the board to skip it.",
      "Picture > Tree: one toggle between My score and Peers' score.",
      "The loading screen shows the version, so you can check your phone has the latest.",
    ],
  },
  {
    id: "2026-11-11j", v: "0.9.36", date: "11 Nov 2026", title: "Pictures: Tree and Structures, fixed",
    items: [
      "Picture now has two views. Squares, Fights and Clock are gone.",
      "Tree: tap a slice to see its position on a board, with your own results there and the peers' results, kept apart. Colour it by your own score, the peers' score, or how many of your games went there.",
      "Structures: the pawn pictures now show the right structure (they were scrambled). Structures the app doesn't name are grouped by their centre pawns instead of all going under Other.",
      "Fixed wording: where a score comes from Lichess players at your level, it now says \"your side scores\" instead of \"you score\" (gaps, Ideas here and hidden gems).",
    ],
  },
  {
    id: "2026-11-11i", v: "0.9.35", date: "11 Nov 2026", title: "Your repertoire in pictures, and a shorter Connect card",
    items: [
      "New: Openings > Picture, five first drafts for looking at your repertoire and games. They are food for thought, not hard numbers.",
      "Squares: a heat map of where your pieces (or your opponent's) stand after a given move, and how you score when they're there.",
      "Tree: your whole repertoire as rings of moves. Width shows how often you get there, colour shows how you score, and hatching marks the holes. Tap a ring to zoom in or open it in Build.",
      "Fights: where pieces get taken in your openings. Structures: the pawn structures you end up in, with your score and the plans for your side.",
      "Clock: the time you spend and the centipawns you lose on each move, for each opening, with the move where you usually leave your prep outlined.",
      "Connect: the card is much shorter. It says what you keep and what you drop (with the size of any branch that goes), the chance of each opponent move and the eval after every move. The button now says what it does: Keep this, drop …, or Add this line.",
    ],
  },
  {
    id: "2026-11-11h", v: "0.9.34", date: "11 Nov 2026", title: "Version numbers here",
    items: [
      "Each entry on this page now shows its version, and the top says which version you're on, so you can check your phone has the latest.",
    ],
  },
  {
    id: "2026-11-11g", v: "0.9.33", date: "11 Nov 2026", title: "Connect: complete before you start, and quicker",
    items: [
      "Connect now works the whole list out before showing it: it fetches the Lichess data and runs the Stockfish checks for every chain first, with a progress bar, so options no longer disappear while you look. The first time can take a few minutes; after that it is quick.",
      "Connect is much quicker to use: the list is worked out once, not on every tap.",
      "Options that only reach the same position as another option by a different move order are hidden, unless they get there more often. When they do, the card says so and gives both chances.",
    ],
  },
  {
    id: "2026-11-11f", v: "0.9.32", date: "11 Nov 2026", title: "Connect: one clear button to commit",
    items: [
      "Tapping an option on a Connect card only shows it. Nothing changes until you press Use this line, which replaces your old move (and the line after it) and puts the other options of that choice away. Keep both adds the line as another option instead. Undo brings everything back.",
      "At the start of a chain the board shows arrows: blue for the line you are looking at, grey for the other options from the same position, and orange for your move there now.",
    ],
  },
  {
    id: "2026-11-11e", v: "0.9.31", date: "11 Nov 2026", title: "Connect: choices side by side, and only sound chains",
    items: [
      "Chains that decide the same thing are now one choice, with the options listed together: every way on from the same position, and chains between the same two openings either way round (Scandinavian into Blackmar-Diemer, or Blackmar-Diemer into Scandinavian). Tap an option to see it on the board, then approve it, or skip one or all.",
      "Your moves in a chain are checked with Stockfish. A chain that gives up more than the mistake margin on the way (Settings > Advanced, 1.5 pawns by default) is hidden, and the card says how much your moves give up.",
    ],
  },
  {
    id: "2026-11-11d", v: "0.9.30", date: "11 Nov 2026", title: "Connect: approved moves stay approved",
    items: [
      "Once you approve a chain, Connect no longer comes back with another chain from the same position offering to replace the move you just approved. Undo brings those back.",
    ],
  },
  {
    id: "2026-11-11c", v: "0.9.29", date: "11 Nov 2026", title: "Connect: quicker after each change",
    items: [
      "After you add or replace a chain, the next one shows straight away while Connect re-checks your tree in the background (it says \"updating\" meanwhile).",
      "Open in Build goes to the position where the chain's move is played, with that move's row open, not to the end of the chain.",
    ],
  },
  {
    id: "2026-11-11b", v: "0.9.28", date: "11 Nov 2026", title: "Connect: likely chains first",
    items: [
      "Connect has a filter for the chance of the whole chain (all the opponent moves in it, multiplied together): at least 10%, 25% (the default) or 50%. The most likely chains now come first, and the count of the ones hidden is shown.",
    ],
  },
  {
    id: "2026-11-11a", v: "0.9.27", date: "11 Nov 2026", title: "Connect your lines, and more variety in training",
    items: [
      "New on the Openings page: Connect. It checks your whole tree for short chains of likely moves that lead from one of your positions into another of your lines, so you can fill a gap by steering into a line you know, or swap a move for one that joins a line you know (the old branch is removed). You go through them one at a time on a board, with the other replies each chain leaves open. Suggestions is now called Ideas, for the tricks, gems and better-scoring moves.",
      "Review positions no longer fills up with positions you misplayed in games: they take at most 8 of the 20, and the rest come from all your openings in turn. On a misplayed position you now see how many games you went wrong in, against whom, when, and what you played.",
      "Mistake review: the same slip in the same position in several games is now one puzzle, a session takes at most two from one opening and one per game, and Later ones wait at least a day.",
      "Build analyses every move at depth 14 straight away, so the Deeper analysis button is gone.",
      "Gap › plays the line up to the gap on the board first (tap the board to skip).",
      "Fits your prep compares pawn structures properly: the opponent's pawns count, and a pawn on f2 against one on f4 is a different structure, not a near match.",
    ],
  },
  {
    id: "2026-11-10a", v: "0.9.26", date: "10 Nov 2026", title: "Review your recent games; fewer, better gaps",
    items: [
      "Games > Recent games: tap a game to review its opening. It shows your accuracy in your prep and just after it, marks your inaccurate moves (?! and ?), and outlines in orange the move where the game left your prep.",
      "Where you played something other than your prep, you can make your game move the repertoire move, add it as another option, take Stockfish's move instead, or open both in Build to compare. Where your opponent surprised you, you can add their move together with your reply from the game. Every change can be undone.",
      "Settings > Building your tree has a new choice for Gap ›: all gaps, only replies played against you, or only replies played against you that were good moves, so you don't prep against blunders.",
    ],
  },
  {
    id: "2026-11-09z", v: "0.9.25", date: "9 Nov 2026", title: "Train no longer freezes; a tidier Build",
    items: [
      "Fixed: the Train tab could freeze with a big repertoire. The new look-alike positions check was far too slow; it now takes a fraction of a second.",
      "Build's Moves tab is back to just the moves. The focus, your notes and the routes from your other openings are on the My lines tab, which now sits after Ideas here.",
      "The map on the Openings page has three views: Coverage, Played (how many of your games through each opening were still in your prep at each move) and Results (your score in the games that left your prep at that move).",
      "Spot the difference no longer pairs a position with the same line a move later.",
    ],
  },
  {
    id: "2026-11-09y", v: "0.9.24", date: "9 Nov 2026", title: "Focus on an opening, a coverage map, My lines and more",
    items: [
      "Build's move rows: Played % and Score % now each have three columns, Peers, Masters and You, labelled once at the top. Every number has the same weight; faint ones rest on only a few games.",
      "Gap › now goes move by move: every common gap at move 2 first, then move 3, then 4, so the tree grows evenly. Most frequent and Rating impact are still in Settings.",
      "Covered on the Openings page now counts up to move 10 (Settings). Before, the replies after the last move of every line counted as gaps, so a well-built opening like the King's Gambit could show 0%.",
      "The Openings list is compact: one line per opening with Covered and Score in columns, and longer names show in full.",
      "Focus on an opening: tap Build or Train on an opening. Build's ⏮ and Gap › stay inside it, and Train only reviews and practises it. At the end of a practised line, Build from here takes you to extend it.",
      "New Map tab on the Openings page: every opening move by move, by coverage or by your results, with your progress over time.",
      "New My lines tab in Build: only your saved moves, written out as notation, with a note for each position.",
      "In Train, if you play a good move that isn't your repertoire move, you can open both in Build to decide which one you want.",
      "Spot the difference in Train: look-alike positions where your move is different, one straight after the other.",
      "On a position you like, Build lists ways to reach it from your other openings, with Add to link them up.",
    ],
  },
  {
    id: "2026-11-09x", v: "0.9.23", date: "9 Nov 2026", title: "P for peers, M for masters",
    items: [
      "Played and Score are back to two lines: your peers on top, labelled P, and masters underneath in grey, labelled M.",
    ],
  },
  {
    id: "2026-11-09v", v: "0.9.21", date: "9 Nov 2026", title: "Fewer pop-ups in Build",
    items: [
      "The dark messages at the bottom of Build are gone for things you can already see: going to a gap, removing a move, saving an explored line, every reply being prepared, and the rating bands following your chess.com rating.",
      "They still appear when something goes wrong (the engine or Lichess), or when Gap › has nowhere to go.",
    ],
  },
  {
    id: "2026-11-09u", v: "0.9.20", date: "9 Nov 2026", title: "Masters next to your peers",
    items: [
      "Build's Played and Score columns now show masters too: your peers' figure on top, and a grey M line under it from the Lichess masters database.",
      "Moves masters often play are listed even when players at your level rarely choose them.",
      "Tap a row to see the masters' wins, draws and losses next to your peers'.",
      "It's a trial: switch it off in Settings → Building your tree if the rows feel too busy.",
    ],
  },
  {
    id: "2026-11-09t", v: "0.9.19", date: "9 Nov 2026", title: "Move rows spread out",
    items: [
      "The columns in Build's move rows now share the width evenly, with the numbers centred under their headings, instead of bunching up on the left.",
      "An opening's name now sits above its move rather than below it.",
      "Behind the scenes: the app's code has been tidied up into one file per screen, which should make future changes quicker and safer.",
    ],
  },
  {
    id: "2026-11-09s", v: "0.9.16", date: "9 Nov 2026", title: "Fixes found while tidying up",
    items: [
      "Your browser's password manager no longer pops up in Settings. The Lichess token box is still hidden as you type, but it isn't a password field any more.",
      "On a computer, Build shows the board on the left and the moves on the right again (since v0.9.1 they were stacked).",
      "The Explore button turns orange while Explore mode is on (its text had become invisible).",
    ],
  },
  {
    id: "2026-11-09r", v: "0.9.14", date: "9 Nov 2026", title: "Snappier auto-reply, and the card is back",
    items: [
      "When Build plays your opponent's reply for you, it no longer works out the rows for the position in between. You see “Playing your opponent's reply…” for a moment, and the rows appear once it's your move again.",
      "Gambits are marked with the playing card 🃏 again, a little bigger.",
      "The Score column is now headed Peer score: how your colour scores after the move in Lichess games at your level.",
      "Fixed: after an update, the app could mix new and old files from your phone's cache (for example the Tags column still on the right). Each release now loads fresh.",
    ],
  },
  {
    id: "2026-11-09q", v: "0.9.12", date: "9 Nov 2026", title: "Simpler move marks",
    items: [
      "Gambits are now marked with 🎲, which shows clearly on phones. The tags (🎲 💎 ⚔ ⇄ ⚠) now sit just left of the move.",
      "Only one mark is left on the moves: !? for an interesting move, one the engine likes less but that's a gambit or scores well at your level.",
      "On your turn, dubious and bad moves are hidden: anything more than 1.5 worse than the best move, as well as moves that leave you below −1.5. Gambits, hidden gems and your own repertoire moves still show, and Show brings the rest back.",
    ],
  },
  {
    id: "2026-11-09p", v: "0.9.11", date: "9 Nov 2026", title: "Clearer move rows: a key, marks and symbols",
    items: [
      "Each row now shows its state across the whole row: blue for your repertoire or a prepared reply, orange for a gap, and a dashed blue outline for a move that transposes into a position you've already prepared.",
      "Moves carry chess marks for whoever is moving: ! strong, ?! dubious, ? bad, and !? for a move the engine dislikes that's a gambit or scores well at your level.",
      "The last column is now Tags: 💎 hidden gem, ⚔ practical weapon, 🃏 gambit, ⇄ transposes into your prep, ⚠ watch out. Tap a row to read them in full.",
      "The move buttons are all the same size.",
      "A Key under the rows explains every colour, mark, symbol, column and board arrow. Close it once you know it; it stays closed.",
    ],
  },
  {
    id: "2026-11-09o", v: "0.9.10", date: "9 Nov 2026", title: "Act on suggestions directly",
    items: [
      "Openings → Suggestions: hidden gems, better-scoring alternatives, practical tricks and easy-to-remember moves now have buttons to Replace your move with the suggestion, or Add it as another option, without going to Build.",
      "Replacing a move also takes out the line that followed it. Undo straight after puts everything back.",
      "Moves already in your repertoire say so. Tap the suggestion itself to look at it in Build first.",
    ],
  },
  {
    id: "2026-11-09n", v: "0.9.9", date: "9 Nov 2026", title: "Suggestions move to the Openings page",
    items: [
      "The Whole tree tab has moved out of Build to the Openings page, as Suggestions next to Your openings: a review of your whole repertoire in one place.",
      "Scan my tree and Find ideas across my tree are there too. Tap any suggestion to open it in Build.",
      "Build now has two tabs: Moves, and Ideas here for the position on the board.",
    ],
  },
  {
    id: "2026-11-09m", v: "0.9.8", date: "9 Nov 2026", title: "Openings kept, Remove, and a preview board",
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
    id: "2026-11-09l", v: "0.9.7", date: "9 Nov 2026", title: "Add an opening by name",
    items: [
      "Openings → Add an opening: search all 3,865 named openings and variations (for example Benko, Najdorf or A57), pick one, choose White or Black, and its moves go into your repertoire.",
      "It also lists that opening's deeper variations: tick the ones you want and they're added too, so you have a few lines to build around.",
      "If you already play a different move somewhere along the line, the new move is added as another option; nothing is replaced.",
      "In Build, the candidate moves are now ranked by the engine, best first.",
      "Tap one of your candidate moves in Build to see how well it fits your prep: the chance it transposes into your lines, or how alike its setup is to your other lines.",
    ],
  },
  {
    id: "2026-11-09k", v: "0.9.6", date: "9 Nov 2026", title: "Faster Openings tab, grouped by name",
    items: [
      "The Openings tab is kept once worked out, so coming back to it is instant. When something has changed, a progress bar shows while it updates.",
      "The top level is now grouped by opening name (Italian Game, Ruy Lopez, Sicilian Defence…) instead of starting with 1.e4. Variations sit under their family, without repeating its name.",
      "Build my tree from my games no longer drops a line because you score badly with an early move: the move is added and flagged in orange, so the prep after it is kept. Run it again to fill in what was missed. A tick box brings back the old behaviour.",
    ],
  },
  {
    id: "2026-11-09j", v: "0.9.5", date: "9 Nov 2026", title: "Idea lines: deeper lines with the plan behind them",
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
    id: "2026-11-09i", v: "0.9.4", date: "9 Nov 2026", title: "Opening catalogue",
    items: [
      "New Openings tab: your repertoire grouped by opening, opening out into its main lines. Branches are made where the opening name changes or the line splits into main replies, not for every move.",
      "Each entry shows how much of what you'll meet is covered, your score and accuracy from your own games, and a short comment, such as 'Mostly covered; your results are poor (38% in 21 games). Worth more training, or a rethink.'",
      "Build opens that line on the board; Train this line practises just that branch.",
      "Fixed: the Score and You column headings in Build no longer overlap.",
    ],
  },
  {
    id: "2026-11-09h", v: "0.9.3", date: "9 Nov 2026", title: "Faster Train, easier to find auto-build",
    items: [
      "Train no longer looks through all your games for mistakes every time. The results are kept on this device, and only new or re-analysed games are checked.",
      "Build my tree from my games is now near the top of the Games tab, and there's a shortcut to it in Build → Gaps.",
    ],
  },
  {
    id: "2026-11-09g", v: "0.9.2", date: "9 Nov 2026", title: "Clearer move rows",
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
    id: "2026-11-09e", v: "0.9.1", date: "9 Nov 2026", title: "Build your tree from your games",
    items: [
      "Games → Build my tree from my games: goes through your games and adds the moves you play often, if you score well with them and Stockfish doesn't think they're dubious, plus the replies you meet often. You see the list first, and nothing in your repertoire is replaced.",
      "Fixed: the page no longer gets wider after playing several moves in Build.",
      "On phones the Build buttons stand beside the board, so there's more room for the moves.",
      "Moves that leave you worse than −1.5 are hidden on your turn (gambits and your own moves still show). Tap Show to see them. Change the number in Settings → Advanced.",
      "The rows now show how common each move is (Played, with a bar) and the score after it in separate columns.",
    ],
  },
  {
    id: "2026-11-09d", v: "0.9", date: "9 Nov 2026", title: "Smoother Build, drag to move, better mistake review",
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
  const cur = UPDATES.find(u => u.v);
  $("#updatesList").innerHTML = (cur ? `<p class="help">You're on version ${esc(cur.v)}.</p>` : "") + UPDATES.map(u => `<article class="card upd">
    <p class="lbl">${u.v ? `v${esc(u.v)} · ` : ""}${esc(u.date)}</p><h3>${esc(u.title)}</h3>
    <ul>${u.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></article>`).join("");
  lsSet("pb_seen_update", UPDATES[0].id);
  renderNewMark();
}
// The header's "New" marker: shown until the Updates page has been opened
function renderNewMark() { const b = $("#newMark"); if (b) b.hidden = !updatesNew(); }
