# Prep Book — project handover

Prep Book is a personal chess openings trainer, built because the off-the-shelf
apps (Chessable, ChessBase etc.) need subscriptions. It is for one user (me) for
now, but should stay structured so other people could use it later.

- Repo: https://github.com/tommusker-blip/prep-book
- Live site (GitHub Pages, main branch, root): https://tommusker-blip.github.io/prep-book/
- Must work well on **Android Chrome** (installed via "Add to Home screen") and
  on desktop. Mobile-first layout; pieces move by tap or drag.
- I play **rapid** on chess.com, rated about **1500–1600**. Repertoires for both
  White and Black. The repertoire starts empty and is built in the app.

## Current state (v0.9, proof of concept)

Plain static files, no build step and no bundler. GitHub Pages serves the repo
as it is. External scripts come from CDNs:

- chess.js 0.10.3 (cdnjs, UMD global `Chess`): move legality, SAN, FEN
- @supabase/supabase-js 2.45.4 (jsdelivr, UMD global `supabase`)
- Stockfish 17.1 "lite single-threaded" WASM (npm `stockfish@17.1.0`,
  GPLv3), self-hosted in `engine/`:
  - about 7 MB, downloaded once per device and then cached
  - runs as a Web Worker from the `.js` file, which finds its `.wasm` next to
    itself, and talks UCI over postMessage
  - needs no cross-origin isolation headers, which Pages can't send
  - fallback: stockfish.js 10.0.2 asm.js from cdnjs, in a `blob:` worker
  - benchmark in headless Chrome: depth 10 takes 28 ms per position against
    1,290 ms for the old build, and depth 16 takes 368 ms against 7,548 ms.
    Run `tests/engine.html` over HTTP to repeat it.
  - cached evals record their engine (`e: "wasm"`). Old Stockfish 10 evals
    are recomputed.
- Fonts: IBM Plex Sans / Sans Condensed / Mono. Pieces are Unicode glyphs drawn
  with Noto Sans Symbols 2 (Google Fonts, subset with `text=`).

Files, in load order. They are **classic scripts** (not ES modules) and share
one global scope, so a top-level `const`/`function` in one file is visible in
the later ones. Each starts with `"use strict"`. Only `app.js` touches the page
when it loads; the others just define things.

- `index.html`: markup only, plus the script tags
- `css/app.css`: all styles (theme tokens on `:root`, light and dark)
- `js/core.js`: constants, helpers (`K()`, `fenAfter()`, `lsGet`/`lsSet`,
  `toast`), the state object `S`, and the explorer and eval caches
- `js/openings.js`: `OPENINGS`, the Lichess `chess-openings` dataset (CC0,
  3,865 names) as `{positionKey: [ECO, name]}`, keyed ahead of time so nothing
  is replayed at startup. Rebuild it with `tools/build-openings.html` whenever
  `K()` changes.
- `js/book.js`: `BOOK_RAW` (about 130 hand-curated openings `[ECO, name, SAN
  line, idea]`), then `BOOK` and `openingFor()`. Names come from `OPENINGS`
  ("Defense" is shown as "Defence"). The curated list adds the one-line idea,
  taken from the deepest curated position on the path, and supplies a name
  only where the dataset has none.
- `js/store.js`: `Store` (three storage modes, described below) and the
  sign-in screen
- `js/rep.js`: pure logic with no DOM: repertoire model (`walk()`,
  `addMove()`, `removeMove()`), PGN parsing, `analyseGame()`, scheduler
  (`grade()`, `dueCards()`, `flagMisplays()`), and repertoire PGN
  export/import
- `js/games.js` (G1): `Games` keeps `S.games` and `S.acc` in IndexedDB
  locally (`IDB`, timing out after 3 s with a fallback to localStorage). When
  signed in, it saves them to the Supabase `games` table, one row per game.
  `Games.mark(ids)` sends only the games that changed.
- `js/evals.js` (G2): `Evals` gives batched lookups and saves of Stockfish
  results in the Supabase `evals` table (depth 14 and up only).
- `js/jobs.js` (G3): `Jobs`, the one queue for slow work. It has an "engine"
  lane and a "net" lane, and priorities `PRIO.now` / `soon` / `background`.
  Jobs can carry a `key`, which shares one run between duplicate requests,
  and a `stale` check, which drops the job once the user has moved on.
- `js/engine.js`: `Engine` (Stockfish wrapper with an eval cache; it goes
  through `Jobs` and `Evals`) and the accuracy formula
- `js/explore.js`: the Lichess explorer code:
  - client: one shared request queue, about 1 request per second, with a 61 s
    pause after a 429
  - `indexTree()`: every position in the tree with its path, FEN and *reach*,
    memoised
  - `scanTree()`: "Scan my tree", most-reached positions first
  - `suggestions()`: hidden gems, better alternatives, transpositions and
    same pawn structure
- `js/ideas.js`: "Find ideas" (see *Suggestion logic* below):
  `analyseIdeas()` for one position, `findIdeasInTree()` as a background job,
  `memorability()`, `ideaTags()` and `treeIdeas()`. Results are cached in
  `pb_ideas`.
- `js/rows.js` (NOTES items 1, 5 and 8): the Build candidate rows. Each row
  shows the engine eval after the move with ✓ within the good margin, the
  peers' frequency · score, and your games · score. Tapping a row expands it
  to full W/D/L, the blended expected score, the likely replies and the best
  reply. Also here:
  - `positionSummary()`: the "You score X% here against Y% for peers" line
  - `blended()`: the sample-size rule, `(n × mine + k × peers) / (n + k)`
  - `adv()`: thresholds from Settings > Advanced (`good`, `mistake`, `clock`,
    `k`)
  - `Tip`: hover or tap tips (no `title` tooltips); `info(text)` makes an ⓘ
    button for explanations, so they aren't on screen all the time
  - Depth (v0.9): rows get a quick depth-10 eval by default (`QUICK_DEPTH`).
    "Deeper analysis" (`deepKeys`, per session) asks for depth 14 for every
    row and the follow-ups below. Deeper results already cached are always used.
  - `followups()` (item 7, only after Deeper analysis): for each of my top 6 candidates, `Engine.multi()`
    (MultiPV 5 at depth 12, cached in `MPV` / `pb_mpv` and in `evals` as
    `mpv:<key>`) counts the opponent's replies within the good margin. The
    label is "Only move", "Narrow", "Several" or "Many". The Lichess data
    after the move gives how often peers find a good reply (needs 50+ games
    with half the replies listed). `isWeapon()` marks a move a "Practical
    weapon" when it costs me no more than the margin, leaves 1–2 good
    replies, and peers find one 50% of the time or less.
- Build layout: the opening name (with its ⓘ) and the moves sit above the board,
  one line each; the moves line scrolls sideways. On phones the board column is pinned under the header
  (`--hdr` = header height + its bottom margin, so it locks without moving first), and the panel has tabs (Moves, Ideas here; the Gaps tab went in v0.9.8:
  Gap › does its job, and its ranking, the auto-reply and the auto-build shortcut are in
  Settings > Building your tree, and the suggestions tab moved to the Openings page in v0.9.9).
  The
  control row has Start, Back, Next, Explore, Gap and Practise (lines from this position).
  On phones the tabs and the rows' column headers are pinned too (`--bcol`, `--ptabs`, measured in `boot()`).
- Build redraws (v0.9): `renderBuild()` redraws everything after the position or
  the tree changes. Engine and Lichess results go through `rowsChanged()` to
  `refreshBuild()`, which only redraws the move rows and the arrows (`BB.setArrows()`).
  Suggestions (Openings > Suggestions, `S.otab`, `showOpeningsTab()`) only redraw while that tab
  is showing (`sidePanes()`/`sideSoon()`, `sugShowing()`); a suggestion opens in Build.
  v0.9.10: gems, better alternatives, tricks and easy-to-remember rows have Replace <my move> /
  Add as an option (`sugActs()`, `onSugAct()`: `addMove()` with `replaces`), with Undo
  (`sugUndo`, only while the tree hasn't changed since).
  `buildState()` cuts a path that no longer plays out back to its legal start.
- Board (`Board()` in `app.js`): tap-to-move and drag-and-drop (pointer
  events). It redraws only when what it shows changes, keeps a selected piece
  across redraws of the same position, and holds off redraws during a drag.
  Squares with the side to move's pieces get `.own` (`touch-action: none`), so
  dragging doesn't scroll the page.
- Auto-reply in Build (`autoOpponent()`, Settings): default `gap` plays the
  biggest unprepared reply, ranked like the Gaps tab (`gapReply()`). Prepared
  replies are left out, so nothing is played once they're all covered.
- `js/puzzles.js` (item 9, mistake review):
  - `gameMistakes()` finds mistakes in a game's v2 analysis, with the reasons
    one isn't a puzzle: `lost`, `winning`, `clock`, `recapture`, `forced`,
    `unpunished`
  - `scanMistakes()` scans the games in the background, cached per game in
    `MIST`. Since v0.9.3 the results are saved in IndexedDB (`mist:<space>`), per game with
    a stamp of its analysis (`accStamp()`), so a new session only scans new or re-analysed
    games (`mistTodo()`, `mistNeedsScan()`). "In prep" is worked out fresh (`inPrepNow()`).
  - `puzzleQueue()` builds a session: due kept puzzles, then new ones, then
    "later"
  - `suggestKeep()` picks the suggested choice
  - `mistakeOverview()` counts mistakes by phase and by clock
  - Keep / Seen / Later state is in `S.puzzles.map` (the `puzzles` doc in
    `prep_data`, so it syncs), with an SM-2 card for kept ones
  - The UI is in `app.js`: `renderMistakeCard()` and `startPuzzles()` through
    `onPuzzleChoice()`. A puzzle replays the 5 moves before the mistake
    (`PZ_RUNUP`), and judges any move within the good margin at depth 12 as
    correct. ◀ ▶ (`pzStep()`) and the clickable move list (`pzJump()`, in `#tLine`) go
    through the game: up to the puzzle before answering, the whole game after. At the puzzle position,
    arrows show the best move (blue), the game's move (orange) and mine
    (purple). New and "later" puzzles are shuffled (`PZ.rng`).
- `js/autobuild.js` (v0.9.1): Games > Build my tree from my games. `planAutoBuild()`
  walks my games for one colour from the start. On my turn it adds the most-played move
  (at least `minGames`) whose score is at least `minScore` and that gives up at most
  `maxLoss` cp at depth 12; on the opponent's turn, every reply seen `minGames` times.
  Existing moves are kept and followed. The plan is previewed, then `applyAutoBuild()`.
  Options in `S.settings.autobuild`.
  Since v0.9.6 a poor score only flags the move (`poor`) unless `strictScore`: leaving it
  out also dropped every line after it.
- Build row columns are sized in `rem`, not `em` (the smaller header font made `em` columns
  narrower than the rows, so its labels overlapped).
- Build rows (v0.9.11): the row's border and tint show its state (`.cand.prep` blue, `.gapmv` orange,
  `.trans` dashed blue: not prepared here but it reaches a position in my tree). The move chip is a
  uniform width. One mark only (v0.9.12, `moveMark()`): !? for a move over half the `mistake`
  margin worse than the best that is a gambit or a gem. On my turn `unplayable()` hides moves over
  `mistake` worse than the best or below −`unplayable`, except prepared moves, gambits and gems.
  The first column (v0.9.13; it was the last) is Tags (`rowTags()`: ⚔ weapon, 💎 gem from `judgeMove()` or the engine-vs-peers
  flag, 🃏 gambit, ⇄ transposition, ⚠
  warning; two shown, all in words when expanded); it replaced the Rep count, which is in the
  expanded row. `rowsLegend()` is a `<details>` Key, open state in `pb_legend`.
- Masters in the rows (v0.9.20, `mastersOn()`, `S.settings.mastersRows`, on by default): Build fetches
  the masters explorer for the position too (`PRIO.soon`); the expanded row has a Masters bar, and
  masters' moves with 5%+ join the candidates (`c.mast`). v0.9.24: the number columns are a grid,
  `statsHead()` / `statCells()`: Played % and Score %, each with Peers, Masters (grey) and You
  (`statCols()`; masters off drops that column, `.crow.c7` vs `.c9`). One weight for every number,
  a thin bar under Played, faint for small samples (peers/masters < 20 games, me < 3). The labels
  are only in the two-level header. (Earlier tries: "P"/"M" prefixes in v0.9.23, one-line "70%/80%"
  in v0.9.22; both replaced at the user's request.)
- v0.9.24 additions:
  - Gap ranking (`gaps.js`, `S.settings.gapRank`, was `gapMode`): default `depth` = move by move:
    gaps you'd meet in at least `gapFloor()` (Settings, default 2%) of games, lowest move number
    (`gapMoveNo()`) first, then biggest; rarer ones after. `freq` and `impact` as before. The user
    expected the tree to grow 2, 3, 4 moves deep evenly; `freq` went deep down popular lines.
  - Coverage (`catalogue.js`): counted to move `coverTo()` (Settings, default 10; `COVER_MOVES` 15).
    `stats.curve[m-1]` = share still in prep after move m; `stats.exits` = my games through the entry
    by the move they left prep (`{n, s}`). Uses `coverShare()`: reach, but my own options split evenly
    too, so 1.e4 + 1.d4 don't double-count. `indexTree()` now splits reach evenly between prepared
    replies that have no Lichess data. Memo format `v: 2`; `catSig` includes `coverTo()`.
  - Catalogue layout: compact (name | Covered | Score under one `.cathead`), child labels drop the
    parent's name (`short()`), buttons Build / Train set the focus.
  - `js/focus.js`: focus on one opening = `S.settings.practiceRoot[color]` (synced). `focusBar()` on
    Build (`#focusBuild`) and Train (`#focusTrain`); `inFocus()`, `focusGaps()` (Gap ›), `focusCard()`
    (Review positions); ⏮ goes to the focus root first. Practise under the board sets it too.
  - `js/covermap.js`: Openings > Map (`S.otab = "map"`). Rows from the catalogue memo (redrawn when
    it finishes; `renderCoverMap(fromCat)` avoids a loop), cells per move 1–12, Coverage or Results.
    `noteProgress()` keeps one overall coverage entry a day in `R.hist` (repertoire doc, synced).
  - `js/treeview.js`: Build > My lines (`S.ptab = "tree"`): `treeHtml()` writes my saved lines from the
    position as notation (owner pass: a shared position is written in the main line, side lines say
    "= transposes"), `data-tgo` jumps. Notes per position in `R.notes[key]` (repertoire doc;
    `normRep()` keeps `notes` and `hist`), shown on the Moves tab and after a correct Train answer.
  - `js/transpose.js`: routes into the Build position from other tree positions ≤ `TR_PLIES` behind:
    cheap filters (side to move, piece counts, squares different), then a search that only moves a
    piece onto its target square. Memoised; drawn after the rows (`routesBox()`), Show / Add
    (`RepUndo` kind "tr"). Routes where a piece moves twice are missed.
  - `js/similar.js`: Train > Spot the difference: `similarPairs()` (≤ 4 squares differ, no shared
    move, closest then neediest), `simDiffText()`. The session is a cards session with `T.sim`.
  - Train: after a miss, `missThen()` asks Stockfish (depth 12) if my move is within `good` of the
    repertoire move; if so it waits with Compare in Build (`leaveToBuild()`, both rows open) or Carry
    on. A practised line's end has Build from here / Next line (auto-advance after 2.5 s).
  - `tests/smoke.html#focus` covers the map, focus, My lines, notes, routes and spot the difference.
  - v0.9.25: Train froze on big trees: `similarPairs()` called `focusOn()` per pair, and
    `focusPath()` replays the moves and checks the tree (about 2 ms each). Use `focusTest()` /
    `focusCards()` (worked out once) for any list; never call `focusPath()`/`inFocus()` in a loop.
    Build's Moves tab only has the rows: focus bar, note and routes are on My lines (tab order
    Moves, Ideas here, My lines). The map has three views: Coverage, Played (games still in prep
    at each move, from `stats.exits`), Results (score % of games that left prep at that move).
- v0.9.26:
  - Gap filter (`gaps.js`, `S.settings.gapOnly`: `all` default / `faced` / `good`). `oppFaced()`
    = key -> san -> `{n, good, checked}` from my games by position key; "good" = the mover lost ≤
    `adv().good` at the game's depth-10 analysis (unanalysed games don't count). With a filter,
    my-move-missing and line-ends gaps need the position in my games (`myPosStats`).
  - Game review (`js/review.js`, view `review`, board `RVB`): Games > Recent games
    (`recentGamesHtml()`, `data-review`, Show more) opens it. `revMoves()` (prep / dev / ?! ?
    marks from `S.acc` ev), `revAccuracy()` (worked out against the tree as it is now, not the
    stored `inb`/`post`), `revNote()` the deviation card; `revAct()` changes the tree through
    `RepUndo` kind "rev". The prep move's eval is asked at depth 12 (`askPrepEval()`).
    `tests/smoke.html#review`.
- v0.9.27:
  - Build rows: depth 14 at once (`rowDepth()`); `deepKeys` and the Deeper analysis button are gone.
  - Gap › replays the line (`buildReplay()` in gaps.js, `BA`): from the start up to 10 plies, else the
    last `GAP_RUNUP`; `renderBuild()` stops it, `refreshBuild()` leaves the board alone while `BA.on`.
  - Review positions: `sessionCards()` (rep.js) caps flagged cards at `FLAG_SHARE` and takes turns
    between first-two-move branches; `misplayNote()` (train.js, from `misplaysAt()`) on flagged cards.
  - Mistake review: `puzzleQueue()` dedupes by `pzPosId()` (position + move; `pzStateOf()` shares the
    state), at most `PZ_PER_FAMILY` per family and one per game; "later" waits `PZ_LATER_WAIT` (`t`).
  - Fits your prep: `setupSim()` = `pawnSim()`² × (0.3 + 0.7 × pieces Jaccard); `pawnSim()` compares
    whole files of both sides' pawns, over files where either position has moved a pawn.
  - `js/connect.js`: Openings > Connect (`S.otab = "connect"`; Suggestions is now labelled Ideas,
    without its Transpositions section). `sweepConnections()` (chunked) / `findConnections()` (sync,
    tests): `connectFrom()` uses `routesTo()` between tree nodes `k` ≤ `CON_PLIES` plies apart;
    opponent moves ≥ `CON_MIN` where data exists (unknown = `CON_UNKNOWN`, fetched on review by
    `conFetch()`); kinds `gap` / `switch` (Replace prunes the old branch via `walk()`). One at a time
    with a board (`CB`), `RepUndo` kind "con", Skip in `pb_conskip`. `tests/smoke.html#connect`.
  - v0.9.28: `conMin()` (`S.settings.conMin`, default 0.25) filters on `pKnown` (known opponent moves
    only, so chains without data still show and get fetched; the top `CON_PREFETCH` are fetched in the
    background); the queue is sorted by `p` (unknown = `CON_UNKNOWN`); `CON.selId` keeps the chain shown.
  - v0.9.29: during a re-sweep after a change, the old list (filtered by `conValid()`) stays on screen
    (`CON.color`/`CON.book` say whose it is), and the sweep keeps `CON.selId`. Open in Build goes to the
    position before the step shown (`CON.step`), with that move's row in `candOpen`.
  - v0.9.30: approving a chain marks its my-turn positions decided (`conDecide()`, `@color|book|key` = move
    in `pb_conskip`); `conQueue()` hides switch chains from a decided position while that move is there.
  - v0.9.31: `conGroups()` (union-find: same `src`, or the same unordered pair of families `conFam()`,
    not within one family) makes the cards; `CON.sel` = group, `CON.selId` = option shown (`conCurrent()`).
    `conSound()`: my moves' losses summed at `CON_DEPTH` 12 from `EVALC`, over `adv().mistake` = hidden;
    evals asked by `conEval()` (shown chain now, top groups in the background), redraw via `conSoon()`.
  - v0.9.32: tapping an option (`data-conopt`) only shows it; "Use this line" (`rep:0`, or `add` for a gap)
    commits, and `conDecide(c, color, group)` puts the other options away (`#<id>` = `{src, m}` in
    `pb_conskip`, hidden while that move is at `src`, so Undo brings them back). "Keep both" = `add`.
    `conShow(c, g)` draws arrows at step 0: this line (best), same-position options (other), my move (played).
  - v0.9.33: after the sweep, `conVerify()` fetches Lichess data, then Stockfish evals, for every chain
    (at the lowest filter) before anything is shown: `CON.vlist` (with `vColor`/`vBook`) is the verified
    list, `CON.list` the one being worked on; `conProgress()` words the bar. `conCompute()` memoises the
    queue, groups and hidden counts (sig: tree, `skipVer`, `conMin()`, `dataVer`, margin); tests that
    change data directly bump `CON.dataVer`. Same place by another order: options from one `src` whose
    target is the other's target or below it in my tree are hidden unless more likely by `CON_SAME_EDGE`;
    kept ones carry `via` and the card explains it.
- v0.9.34: What's new entries carry `v` (the release); the page says which version is running.
- v0.9.35:
  - `js/picture.js`: Openings > Picture (`S.otab = "pic"`, `#picPane`, state `PIC`), drafts, nothing fetched.
    Squares (`squaresData()`: board at ply 2N from `GAMEKEYS`, or tree leaves × reach; Score = `shrink()`
    towards my average with `adv().k`), Tree (`sunArcs()` sunburst, `PIC_RINGS` plies from `PIC.sun.root`;
    hatched = unprepared share; the SVG is clicked through `box.onclick`, because the app's listener only
    sees buttons and `Tip` captures clicks on `[data-tip]`, so rings have no tips), Fights (capture
    squares), Structures (`structureOf()` at move N, tiles with plans), Clock (time per move from `clk`,
    loss from `S.acc` ev, per family from `bookName()`; median prep exit outlined). Memo `picCached()`.
    `tests/smoke.html#picture`.
  - v0.9.36: Picture cut to Tree and Structures (Squares, Fights, Clock dropped as not useful).
    Tree colours: `mine` (my games only, faint under 10), `peers` (Lichess, my side), `played`;
    a tapped slice shows its position (`picShowBoard()`, board `PB`). Structures: unnamed ones
    grouped by `centreOf()` (pawns on files c–f), fewer than `ST_MIN` games go to Other; pawn
    images come from `boardCells()` (`pawnKey()` keeps the "/" separators, which scrambled them).
    Peer scores are worded "your side scores", never "you score" (that's for my own games).
  - v0.9.37: Tree colours are only `mine` / `peers`. Gap replay: last `GAP_RUNUP` = 6 plies, one move
    per `SLIDE_MS`. The loading screen shows the version (inline script reads `?v=` from the app.css link).
  - v0.9.38: Connect's Keep / Drop lines show the eval after the dropped move(s) and after the new first
    move (switches); `conVerify()` and `conEval()` also evaluate the positions after the dropped moves.
  - v0.9.39:
    - `js/funnel.js`: Build > My lines > Routes from the start (`#funBox`, `funnelBox()`, state `FUN`).
      `funSearch(fen, ply, color)`: depth-first from the start to the target (≤ ply + 2), memo by
      key|ply|detours (a result with cut-short lines is reused only at no higher reach). Moves must
      head for the target (`funKind()`: direct / progress / exchange / detour, `FUN_DETOURS` per side);
      on my move the best of the first `FUN_TRY` (tree moves first, then direct, Lichess popularity,
      centre), a tree move kept unless another is better by more than `FUN_KEEP`; on theirs, replies
      ≥ `funMin()` (`S.settings.funMin`, 5–25%, default 25%) summed by share. Lichess look-ups capped at
      `FUN_FETCH_MAX`; prepared replies split evenly where there's no data. Result: `{v, lines, exits,
      conflicts, partial}`; Add uses `RepUndo` kind "fun". Tests: `funnelTests()` in logic.html.
    - Openings > Map holds the pictures: `renderMapTab()` (covermap.js), `mapView` = map / tree /
      structures; the Picture tab is gone.
    - Structures by feature (`structAt(color, move)`, memo per move): `centreType()` (tension, then
      rams: 2 = closed, 1 = fixed; open = at most one advanced centre pawn each; mobile; none) and
      `sideFeatures()` (missing, isolated, doubled, backward, passed, by file); `structByMove()` grid
      over `ST_MOVES`. Named structures from `structureOf()` underneath.
  - v0.9.40: the Map tab is labelled Visualise (still `S.otab = "map"`). `autoImport()` (importer.js) on
    boot and when the app becomes visible, at most every `AUTO_IMPORT_GAP` (10 min, `pb_autoimp`): only the
    archives from the month of my newest game on (`archiveList()`, `importArchives()`, shared with the
    Import button; fetches use `cache: "no-cache"`). Needs games already imported; off with
    `S.settings.autoImport = false` (Settings checkbox `#setAutoImport`). Test: `importTests()` (stub fetch).
  - v0.9.41: Structures without named structures. `structAt()` keeps each game's features as items
    (`c:<centre>`, `me|them:<feat>:<file>`); `stCombos(d)` finds sets of up to `ST_SET` items in ≥
    `ST_SUPPORT` of games (and `ST_MIN_GAMES`), drops a set that nearly always comes with one more item
    (`ST_CLOSED`), and gives the most common, best and worst (shrunk score, ≥ 10 games), each with its
    newest game as the example (`data-review`). `comboText()` words them. Per-file tables in a `<details>`.
  - v0.9.42: Structures "Worth your attention" (`stAttention()`, `attentionHtml()`): kept sets with ≥
    `ST_ATTN_MIN` games and a shrunk score ≥ 3 points under average, by cost = games × (average − shrunk
    score); sets mostly covering the same games as one listed are skipped (`ST_OVERLAP`). Each has its
    families (`stFamily()`) and the deepest my-turn tree position those games passed (`dec`: path +
    played); actions `data-open` (Build at that choice), `data-focustrain` (practise the line), `data-review`.
  - Connect card: Keep / Drop box (`c.drop` = my moves in the dropped branch), steps with opponent
    chance and the eval after every move (White's side, orange where my move loses ≥ `good`);
    `conEval()` now asks for every step's position. Buttons: "Keep this, drop X", "Add this line", "Keep both".
- v0.9.43:
  - Openings > Ideas is one card at a time (suggest.js): `sugQueue()` merges gems, better-scoring, tricks
    and easy-to-remember per move (one card, several labels), ranked by reach × rough gain in points
    (peers' score − my move's; `err × SUG_TRICK`; `fit × SUG_EASY`); gems my move already matches are
    dropped; Same pawn structure dropped. `sugSure()` = edge vs 2 standard errors (0.45/√n per side);
    `sugEval()` asks Stockfish depth `SUG_DEPTH` for the idea and my moves. Board `SGB` (idea `gem` arrow,
    mine `mine`). Skip = `pb_sugskip` (`color|book|key|san`), "Show them again". `SUG.cur` is what
    `data-sugact` acts on. Scan / Find ideas sit in a "Find more ideas" `<details>`. Data attributes
    with an empty value need `onClick(name, fn, true)`.
  - Structures: `stExample(d, c, costly)` groups a set's games by pawns (`stPawnsOf()`), takes the most
    common group (or the costliest with ≥ 2 games for attention), then its most common exact position
    and newest game; `miniBoard(key, flip, files)` is a static board (tinted files `.sq.mk`); `stMini()`,
    `stExBtn()` (`data-review` + `data-rvat` = 2 × move). `structAt()` games carry `k` (the key at that move).
  - Review: `openReview(id, back, at)` opens at ply `at` and `revPlay()` plays up to it (≤ `REV_PLAY_MS`,
    stopped by `revGo()`, a board tap skips); back goes to Openings when opened from there.
  - Tree: `.sunsel` is centred; a tapped slice scrolls its board into view if it's off screen.
- v0.9.44: Routes from the start shows progress: `rec()` wraps `rec0()` with a share `w` of the search
  (root 1, split evenly between the moves tried); what isn't handed on is added to `FUN.done` on return.
  `funProgText()`: % done, time left once ≥ 10%, look-ups of `FUN_FETCH_MAX`; `#funBar`.
- v0.9.45: square colours fixed: `.dk` when (file + rank) is odd, file 0-7 and rank 1-8 (a1 dark). Every board
  had them swapped since the start. Tested in logic.html ("board colours").
- v0.9.46: `focusMini()` draws the focus as one line in `#focusBuild` under Build's controls (with ✕ Clear), so
  it's visible on every tab; the full bar stays on My lines and Train.
- v0.9.47:
  - Evals shown to me are always from White's side (+ good for White), whatever colour I play: review
    (`whiteTxt()`, my-side values × `revColorSign()`), Ideas card, Ideas here, puzzle feedback. Connect and
    Build rows already were. Keep it that way for any new eval display; "gave up X" losses stay unsigned.
  - Structure cards: no frequency bar; `stMetric()` / `stScoreMetric()` key numbers, `.stms`, `.stacts`;
    attention shows points lost, score (avg), games, "Mostly <family> · your move X", Avoid X / Practise / Example.
  - `js/doubles.js`: Openings > More than one move (`#dblBtn`, `#dblBox`): `multiMovePositions()` (my-turn
    tree positions with 2+ moves, by reach), Keep only (`removeMove()` of the others, `RepUndo` kind "dbl").
- v0.9.48:
  - Structure cards: `.stcombo` is a column: `stBar()` (share across the top), `.sttop` (board | body),
    `stFamsLine()` (every family with counts: `a.fams`, or `stFams()` for common cards), `.stacts` full width.
    "Avoid" removed (the user didn't want "change your opening" advice). `stNext()`: `stMistakes()` = first
    move of mine in the next `ST_NEXT_PLIES` losing ≥ `adv().mistake` (analysed games only), against all my
    games at that move, with the commonest kind (pawn move by wing, capture, piece); plus the feature most often
    added `ST_NEXT_MOVES` moves later (needs move + 4 ≤ 20, the GAMEKEYS limit). "Show a mistake" = review at it.
  - Connect: `conReverse(c)` = the other way round for a switch (from my positions on the target line's path,
    after it parts from mine, `connectFrom()` with only my old move's branch as targets), `conWhich()` recommends
    the way that drops fewer prepared moves (by more than 2), else the one connecting more games (reach × p).
    `data-conact="rev"` applies it (`RepUndo` "con").
  - Catalogue: `movesOf()` puts the moves since the parent entry under each name (`.catnm`, `.catmv`); over
    `CAT_MV_MAX` plies, only the opponent's moves.
- v0.9.49:
  - Structure cards: `stFamily()` strips " Accepted/Declined/Refused/Deferred" (main opening only);
    `stFamsLine()` lists only families with ≥ `ST_FAM_MIN` games and ≥ `ST_FAM_SHARE` of the set, "N other".
  - Catalogue: `.catname` spans the summary row (`grid-column: 2 / -1`), `.catmv` + Covered + Score below. CSS `:has()`
    hides an open entry's siblings and an open child's parent body (everything but `.catkids`).
  - Map: `freqCell()` (`.mapfreq`) = the entry's `reach`. v0.9.52: it sits inside the name button (`.mapnm` + `.mapfreq`), not a
    column: an extra grid column squeezed the move cells on phones. The view is labelled "Move by move".
  - Don't edit files with a PowerShell script that holds non-ASCII text: PowerShell 5.1 reads a BOM-less .ps1 as
    ANSI, so "…" became "â€¦" in catalogue.js (v0.9.48). Use the Edit tool, or keep such scripts ASCII.
- v0.9.50: `stMistakeKind(san, keyBefore)` (picture.js) sorts a mistake by the move: pawn moves by wing, a piece's
  moves, castling, or captures by what took what (board from `gameKeys()` before the move). `ST_MISTAKE_HELP` is the ⓘ.
- v0.9.51: `stMistakes()` returns `kinds` (sorted); What happens next lists up to `ST_KINDS` with ≥ `ST_KIND_MIN` games,
  each a `data-review` link at its mistake. The by-file table shows my score under each share (`scoreOf()`, `.stsc`).
- v0.9.53: Coverage cells show their number; `stats.gapsTop` (catalogue memo format `CAT_MEMO_V` = 3, older saved
  results are recomputed) holds each entry's biggest gaps (`gapLabel()`, share of the entry), listed in the cell tip.
- v0.9.54: `findGaps()` sized a reply met only in my games (under 3% on Lichess, so not in `cand` from the explorer)
  as `games × 0.02` of ALL games, unscaled by reach; a much-played line (King's Gambit) lost all coverage. Now
  `reach × oppShare()` (Lichess share, 1% if unlisted; else share of my games there). `CAT_MEMO_V` = 4.
- v0.9.55: who left the prep: `exitWho()` (rep.js; me = misplay / you_new, them = opp_new), `myPosStatsBy(key, color, who)`
  (memo on the `analysis()` list). Tree: `PIC.sun.who` (`data-pswho`). Map: `mapWho` (`data-mapwho`) picks `stats.exits` /
  `exitsMe` / `exitsThem` for Played and Results (`CAT_MEMO_V` = 5).
- v0.9.56: unknown coverage: `catUnknown()` = shallowest opponent positions with prepared replies and no cached
  explorer data (gaps can't be found past them); `stats.unk[m]` = their share by move; cells ≥ `UNK_SHOW` get "?" and
  `.unk`. `unknownLine()` + `data-mapscan` (Scan my tree); `catStale()` after any scan (catSig leaves explorer data
  out). `CAT_MEMO_V` = 6.
- v0.9.57: more in Supabase.
  - `js/stash.js`: `Stash` (table `stash`, migration 0005: `user_id, kind, key, data`), like `Evals`: batched `get()`,
    `getMany()`, paged `all()`, background `put()`/`flush()` (also on hide), quietly off without the table. Kinds: `expl`
    (key = `K|band` or `K|masters`), `ideas` (`ideaKey()`), `idealine` (`ideaId()`). `stashStartup()` (boot + 2.5 s):
    `explPrefetchTrees()` (both trees from the database), `ideasFromStash()`, `ideaLinesFromStash()`, and once per device
    (`pb_stash_up`) copies the local caches up.
  - Explorer: `fetchExplorer()` asks `Stash` before queueing Lichess; `storeExpl()` (local, `EXPL_MAX`), reads move a
    position to the back (`cachedExplorer()`, every 4th read) so the tree stays; `scanTree()` prefetches from the database first.
  - Ideas: all results in memory, the device copy keeps the last 400. `MIN_REMOTE_DEPTH` (evals.js) 14 -> 12.
  - `js/decisions.js`: `Decide` keeps Connect (`con`) and Ideas (`sug`) decisions in `S.settings.decisions` with times in
    `S.settings.decidedAt` (synced); `pb_conskip`/`pb_sugskip` merged in once. `decisionsHtml()` lists them with Bring back
    (`data-conback`, `data-sugback`, `*` = all); `Decide.sig()` in `conCompute()`'s signature. The user wants decisions revisited.
- v0.9.58: Tree: `.sunsel` is a grid, board (46%) beside `.sunstats`; after a tap the page only scrolls ("nearest") if
  the panel is off the bottom, so the rings stay in view.
- v0.9.59: wording: "your" for my side, "opponent" for theirs, everywhere on screen (see Design). Default book name "Your prep"
  (`bookList()` shows a stored "My prep" as "Your prep").
- `tests/rows.html`: Build's move rows with made-up data at 360 and 412 px, for layout screenshots
  (headless Chrome `--screenshot`); the rows themselves are in `tests/rows-frame.html`.
- Build rows' Eval column (v0.9.2) is from White's side (`engineFor().white`), coloured by
  `strengthOf()`: within `good` of the best = strong (blue), up to `mistake` = playable,
  beyond = weak (orange). No ✓ marks; `g` tags a weak gambit. The column key is a line
  under the rows, not an ⓘ, and an expanded row starts with every value in full (`.cfull`).
- Build rows hide my moves that leave me worse than `adv().unplayable` (default 150 cp)
  unless prepared, a gambit by opening name, or within the good margin of the best
  (`unplayable()`, `showWeak`). Peers are two columns: Played (share, with a bar) and Score.
- Phone layout: `.layout` is `minmax(0,1fr)`; without it the one-line move strip widened
  the page. The Build controls stand in a column beside the board.
- `js/catalogue.js` (v0.9.4): the Openings tab. `buildCatalogue()` groups the tree by key
  moves: a new entry where the opening name changes, or at a split (an opponent position with
  2+ prepared replies each over `CAT_SPLIT` of the entry's reach, or several moves of mine).
  Single named children covering 90%+ are folded in, a child named like its parent is
  labelled by its moves, and nesting stops at `CAT_DEPTH`. `catalogueStats()` adds coverage
  (1 − gap reach ÷ reach), score, accuracy in and after book, cards, and `catComment()`.
  Build and Train this line (practice root) buttons per entry.
  v0.9.6: the top level is grouped by family (`groupByFamily()`): generic names in
  `CAT_GENERIC` (King's Pawn Game…) are replaced by their children, entries of one family share
  a group starting where their moves part, and children drop the parent's name prefix. The page
  is built in steps (`statNode()`) with a progress bar; idea targets are worked out once.
  v0.9.8: the result is kept per book and colour in `catMemo` and in IndexedDB
  (`cat:<space>:<book>:<colour>`, `catStoreKey()`). The last result is always drawn at once; if
  `catSig()` (book, colour, tree, band, game and analysis counts; not explorer data, which
  changes all the time) differs, it's recalculated in the background with a bar in `#catProg`.
  Recalculate forces it. Remove (`removeCatalogueEntry()`) cuts where the line starts
  (`catCutPath()` climbs back while the position before has one move), with Undo
  (`catUndo`, only while the tree hasn't changed since). "Other lines" entries have no Remove.
- `js/addopening.js` (v0.9.7): Openings > Add an opening. Searches `OPENING_LINES`
  (`js/openlines.js`, every named opening with its moves, 370 KB, loaded only when the panel
  opens; made by `tools/build-openings.html` alongside `openings.js`). A picked opening can
  bring its deeper variations (dataset lines that continue it). Lines go in with `addMove()`;
  a different move of mine becomes another option (`lineConflicts()`, now in `rep.js`).
  v0.9.8: a locked preview board (`aoShow()`, `AOB`): tap the main line or a variation's name,
  a move in the list, or ◀ ▶. Updated in place, so the list keeps its scroll.
- Build rows are ordered by the engine (loss against the best move, for the side moving);
  moves without an eval yet come last. An expanded row of mine shows "Fits your prep"
  (`fitFor()`/`fitLine()` in `rows.js`, using `memorability()` from `ideas.js`) once the
  Lichess replies after the move are loaded. `srcLine()` moved to `explore.js`.
  v0.9.8: a row whose move reaches a named position shows the name (`namedLine()`, only the
  part after the family name of the opening on the board). On my turn the board adds thin
  dashed arrows (kind `games`) for the moves I usually play there (`gameMovesHere()`: at least
  2 games and 15%, top 3).
- Idea lines (v0.9.5), an add-on kept out of the repertoire and cards:
  - `js/structures.js`: about 20 pawn structures matched on pawns alone (`structureOf()`,
    first match wins), each with plans for both sides and its break squares.
  - `js/idealines.js`: `ideaTargets()` (leaves of the tree my games reach, ranked by games
    × the accuracy drop after book), `buildIdeaLine()` (most played masters move, then Lichess
    2200+, then at most 2 engine moves; my moves must lose ≤ 1 pawn at depth 12; up to 16
    plies), `describeIdeaLine()` (structure plus up to 3 key moments: a structure break, a
    pawn lever, a space-gaining advance or a regrouping retreat). Lines are kept in
    `pb_idealines` (local). The viewer is the `idea` view (`openIdeaLine()`, ◀ ▶, a
    clickable list, and Quiz me). Ways in: Train > Ideas worth learning, and Typical ideas
    in each catalogue entry (each line shown once, in its most specific entry).
  - `fetchExplorer()` / `explorer()` / `cachedExplorer()` take a source (`opts.src`): my
    bands by default, `masters`, or another band such as `2200,2500`.
- `js/report.js`: the coach data report (backlog 6, without the AI for now).
  `buildCoachReport()` gathers aggregated numbers only: openings from my games (results,
  accuracy in and after book, prep depth, misplays), prep exits, positions where I score below
  peers (`belowPar()`), gaps by both rankings, training lapses, mistakes by phase, clock and
  opening, and practical tricks. `coachPrompt()` adds a short brief. The Coach report page
  (Games) shows it, with Copy for an AI coach, Copy JSON and Download JSON.
- `js/updates.js`: the Updates ("What's new") page
- The screens (v0.9.17; `app.js` used to hold all of them), loaded after the logic files:
  - `js/importer.js`: chess.com rating and games import, engine analysis of my games
  - `js/board.js`: piece sets and board looks, `arrowsSvg()`, piece animation, `Board()`,
    `BB`/`TB` (the Build and Train boards), `reduceMotion()`
  - `js/build.js`: the Build screen (`renderBuild()`, `refreshBuild()`, `buildArrows()`,
    auto-reply, Ideas here, Explore mode, `commitBuildMove()`)
  - `js/suggest.js`: the Openings page's tabs (`showOpeningsTab()`) and Suggestions (scan,
    find ideas across the tree, Replace / Add with Undo)
  - `js/train.js`: review positions, mistake review puzzles, practise lines (`T`)
  - `js/gamesview.js`: the Games tab, the coach report page, the auto-build panel
  - `js/settings.js`: Settings, board looks, prep books
  - `js/app.js`: `setView()`/`render()`, the header (`renderBg()`, save status), the Lichess
    token, the click listener and `boot()`
- Buttons: a screen registers its own `data-*` buttons with `onClick(name, fn, any)` (core.js),
  next to its code; `app.js` has the single click listener (`dispatchClick()`). Don't add
  branches to a central if/else.
- Shared helpers (v0.9.18):
  - `RepUndo` (rep.js): `RepUndo.change(kind, color, fn)` copies the repertoire, runs the change
    (fn returns the text for the Undo line) and saves; `undoNote(kind)` (core.js) draws
    "<text>. Undo" (`data-undo`), offered while the tree hasn't changed since. Used by Remove an
    opening ("cat") and suggestion Replace / Add ("sug"). One slot.
  - Data signatures (rep.js): caches of things worked out from games key on `gamesSig()` /
    `accSig()` (array identity + length + `touchData()`, called where one game or analysis is
    replaced in place), never on counts alone. `contentSig()` (game ids + `accStamp()`) is
    stable across sessions, for results saved to IndexedDB (the catalogue).

Tests (open in a browser, or run headless Chrome with `--dump-dom`; there's no
Node on the dev machine):

- `tests/logic.html`: unit tests for `core.js`, `book.js` and `rep.js`
  (position keys, transpositions, repertoire building, PGN round trip,
  `analyseGame()`, misplay flags, key migration, scheduling)
- `tests/smoke.html#local` / `#hosted` / `#train` / `#multi` / `#explore` / `#books`: loads the real app in an
  iframe and reports what's on screen. `#train` runs a whole training session:
  replay, skip, wrong answer, retry, and first-attempt-only grading. Add
  `--force-prefers-reduced-motion` to check that the replay is skipped.

```sh
chrome --headless=new --allow-file-access-from-files --virtual-time-budget=10000 \
  --dump-dom file:///C:/git/prep-book/tests/logic.html
```

### Data model

- A position key, `K(fen)`, is the first four FEN fields (board, side to move,
  castling, en passant). Keying on this merges transpositions. chess.js 0.10
  always sets the en-passant square after a double pawn push, so `K()` keeps it
  only when a pawn of the side to move stands next to the pushed pawn (pins are
  ignored), and sets it to `-` otherwise. Repertoires saved by older builds are
  re-keyed on load by `normRep()` in `store.js`.
- `S.rep[color].pos[key] = { m: [san...], path: "e4 e5 Nf3" }`
  - On my turn, `m` holds one or more moves of mine, for example both 1.e4
    and 1.d4. In Build, playing a new move where I already have one asks:
    add it as another option, replace one of mine (`addMove(path, san,
    color, replaces)`), or cancel. In training, any of my moves counts as
    correct, since choosing between them is up to me. Each line is still
    drilled through its later positions. `m[0]` is the main line, which the
    Next button and the training hint follow.
  - Build has two modes (`S.buildMode`, per session):
    - **Commit:** every move is saved, as above.
    - **Explore:** nothing is saved. Moves for either side extend
      `S.explore[color]`, and Next follows the explored line. The board has
      an orange edge.
    - Leaving Explore: "Save this whole line" or "Save up to here and keep
      building" (`saveLine()`). Moves of mine that clash with the repertoire
      are listed first, with the choice to add them as options or replace
      mine.
  - On the opponent's turn, `m` lists the replies I've prepared for.
  - `path` is the shortest move sequence from the start, recomputed by `walk()`.
    `walk()` also prunes positions that can no longer be reached.
- `S.rep[color].cards[key] = { due, iv, ef, reps, lapses, flag, seen }`
  - There is one card per my-turn position that has a move.
  - Scheduling is SM-2 style. A fail is due again after 10 minutes. `flag` is
    raised when I misplay that position in a real game, and flagged cards are
    trained first.
- `S.rep[color].flagged = [gameId…]`: games already counted by
  `flagMisplays()`, so a misplay only raises a flag once. It lives in the
  repertoire doc so it syncs. Older builds kept it in localStorage
  `pb_flagged_<color>`, which is read once as a migration.
- `S.games[]`: rapid games only, as `{id, my, tc, tcs, url, date, white,
  black, welo, belo, result, moves: "SAN SAN …", clk: [seconds left after each
  move]}`. `tcs` is the raw TimeControl (e.g. "600+5"). `clk` comes from the
  PGN's `[%clk]` comments and is missing for games imported before v0.7 until
  they're fetched again.
- `S.acc[gameId]` (analysis v2) = `{v: 2, d: 10, ev: [cp from White's side,
  one per position, 0 = start], bm: [best move in UCI per position], inb,
  post, exitCp}`:
  - `ev` and `bm` cover the whole game up to ply 160, at depth 10. Game evals
    don't go into `EVALC`.
  - `inb`/`post` are per-move accuracy (the Lichess formula from centipawn
    loss), in book and up to 8 plies after it. `exitCp` is the eval at book
    exit from my side.
  - v1 entries (no `v`) are redone by "Analyse all" (`needsAnalysis()`).
- My own statistics (G1, `rep.js`): `myPosStats(key)` and
  `myMoveStats(key, san)` give `{n, w, d, l}` from my side. They're matched by
  position key over the first 40 plies (`GAMEKEYS`), so transpositions count.
- `analyseGame()` returns where a game left the tree, as one of these exit types:
  - `misplay`: I played none of my prepared moves (`expected` lists them,
    separated by " / ")
  - `you_new`: I had no move prepared
  - `opp_new`: the opponent played a move I hadn't prepared
  - `end`: we reached the end of my tree
  - `full`: the game ended while still in book

### Storage modes (`Store`)

1. **Inside a claude.ai artifact**: uses the artifact `db` capability. This is
   only for the copy published in Claude. Inside Claude, pages can't reach
   outside sites, so no Supabase, chess.com or Lichess there.
2. **Hosted (GitHub Pages)**: Supabase, with email and password sign-in. On the
   first sign-in, anything saved in the browser is copied up to the database.
   - When the app becomes visible, it pulls changes newer than the last seen
     `updated_at`. The database sets `updated_at` with a trigger, the app reads
     it back after each save, and the values are compared as times.
   - When the app is hidden or closed, pending saves are sent at once.
   - Docs whose save hasn't been confirmed are listed in `pb_dirty`
     (`{doc: localMs}`). On the next load, a dirty local doc that is newer than
     the database copy wins and is pushed up, so a failed save isn't lost on
     reload.
   - Otherwise last write wins, which is fine for a single user.
3. **Local only**: browser `localStorage` (`pb_data`), chosen with "Use
   without an account".

The data is saved as JSON documents: `settings`, `games`, `acc`, and two per
prep book. Each save writes a whole document about 700 ms after the last
change. The explorer cache (`pb_expl`) and the engine eval cache (`pb_eval`)
stay in `localStorage` and never go to the database.

- **Prep books** (`S.books`, `S.book`; `S.rep` points at the open book):
  - Each book has its own White and Black repertoire, cards and flags.
  - The first book, `main`, keeps the doc names `white` and `black`, so
    existing data needs no migration. Other books are `white@<id>` and
    `black@<id>` (`repDoc()` / `parseRepDoc()`).
  - `settings.books` holds `[{id, name}]` and `settings.book` the open book,
    so both sync.
  - Deleting a book saves `{deleted: true}` in its docs, so other devices drop
    it too. `main` can be cleared but not deleted.
  - Always save repertoire changes with `Store.save(repDoc(color))`.
- **Lichess token:** since v0.5 it's in `settings.lichessToken`, so it syncs
  (the user asked for this). It's protected by the table's row-level
  security. The token has no scopes, so it can only read public data.
  `pb_token` is kept as a local copy, removed on sign-out, and migrated into
  settings once by `syncToken()`.
- **Save indicator** in the header: `Store.status()` returns one of
  `pending`, `saving`, `saved`, `error` (will retry; tap to retry now) or
  `device` (local only). The UI updates through `Store.onStatus`.

## Supabase

- Project URL: `https://serjfzitcbixkhnuxhol.supabase.co`
- Publishable key (safe to have in public code, since row-level security
  protects the data): `sb_publishable_sCOcKwpCMuAIbLvPtfmcUw_i6n7FZVF`
- **Never** put the secret or service_role key in this repo or in the frontend.
- Auth: email and password. Site URL and Redirect URLs are set to the Pages
  address. For local testing, add a localhost URL (for example
  `http://localhost:5500/`) to Redirect URLs.
- Schema lives in `supabase/migrations/`. Both files were applied by hand
  through the SQL Editor, so Supabase's own migration history is empty. They
  were checked against the live database on 2026-11-07:
  - `0001_prep_data.sql`: table, RLS policies, grants
  - `0002_server_updated_at.sql`: trigger that sets `updated_at = now()` on
    every write
  - `0003_games_table.sql` (G1, applied 2026-11-08): `games`, one row per game (`game` and
    `analysis` jsonb), with RLS and the same trigger. Before it was applied
    the app fell back to the old `games`/`acc` documents, and still does
    if the table is unreachable. The app copies games in by itself the first
    time (`settings.gamesInTable`). It leaves the old documents as a backup,
    and `settings.gamesEpoch` tells other devices when games were cleared.
  - `0004_evals_table.sql` (G2, applied 2026-11-08): `evals`, Stockfish results by position key.
    Without it, `Evals` does nothing. Sync logic is tested in `tests/sync.html` (fake client).
  - `0005_stash_table.sql` (v0.9.57, applied 2026-11-12, checked: RLS, 4 policies, trigger): `stash`, Lichess data, Find ideas results and idea lines by kind and key.
    Without it, `Stash` does nothing.
- Claude Code reaches the database through the claude.ai Supabase connector,
  which has **write** access. Ask before running anything other than reads.
  Claude Code's permission check blocks `apply_migration` unless the user
  allows it, so migrations are applied by the user (SQL Editor) or with
  their explicit go-ahead.

The whole-document approach is fine for now. If `games` grows large, move games
and accuracy into their own table, with one row per game.

## External APIs

- **chess.com Published-Data API** (no auth):
  - `GET https://api.chess.com/pub/player/{user}/games/archives` lists the
    monthly archives
  - each archive URL returns `{games:[{pgn, time_class, rules, url, …}]}`
  - keep games where `time_class === "rapid"` and `rules === "chess"`
- **Lichess opening explorer**:
  - `GET https://explorer.lichess.ovh/lichess?variant=standard&speeds=rapid&ratings=1600,1800&moves=20&topGames=0&recentGames=0&fen=…`
  - Since mid-2026 it **requires** `Authorization: Bearer <personal token>`.
    The token needs no scopes and is entered in Settings.
  - Requests from the Pages site are allowed, including the `Authorization`
    header (checked 2026-11-07).
  - Responses are cached per position and rating band in `pb_expl`, as
    `{total, w, d, b, moves:[{san, n, w, d, b}]}`, keeping at most 2,500
    positions. Entries cached by older builds have no `w`/`d`/`b` totals, so
    `posAverage()` falls back to summing the moves.
  - Lichess ratings run higher than chess.com, so the default band is
    1600–1999.

## Untested: verify first

- [ ] Board, tap-to-move and Stockfish on Android Chrome. The WASM engine is
      tested on desktop Chrome only. Check the first 7 MB load and the speed
      on the phone.
- [x] chess.com fetch and Lichess explorer from the Pages site (CORS, token),
      2026-11-07. 1,798 games imported.
- [ ] Scan my tree and the suggestions against real Lichess data. The tests
      use a fake server and made-up numbers.
- [x] Supabase sign-up, confirmation, first save, and sync between two devices
      (phone to laptop, 2026-11-07)
- [x] PGN repertoire export and import round trip (logic covered by
      `tests/logic.html`; the Copy/paste UI hasn't been tried on a phone yet)
- [x] App boots on desktop Chrome in local and hosted modes
      (`tests/smoke.html`)

## Known limitations

- Only about 130 openings have a one-line idea. The other names from the
  dataset have none.
- Explorer data comes only from positions I visit, or from "Scan my tree" (one
  colour at a time). Gap ranking and *reach* are the product of opponent move
  frequencies along the path. A move missing from the data counts as 1%, and
  a position with no data counts as 100% (prepared replies without data share it evenly since v0.9.24), so scan first.
- The explorer cache is in `localStorage`, alongside `pb_data` (games are
  about 850 KB). If storage runs out, `lsSet` fails silently. Consider
  IndexedDB for the caches.
- Train has two modes:
  - **Review positions** tests one position at a time, with the line
    replayed first.
  - **Practise lines** (v0.7) plays whole lines from the start or from a
    chosen position (`S.settings.practiceRoot[color]`). The opponent's replies
    are chosen by `pickReply()` in `js/practice.js`: frequency × need ×
    coverage × recency.
- Promotion always makes a queen.
- Errors are shown as toasts (since v0.9.21 Build only uses them for errors and "no gaps found",
  not for things already visible on screen), and there is no offline queue beyond
  `localStorage`.

## Suggestion logic (v0.6)

What I asked for: suggested moves should be **practical**. The two kinds:

1. **Easy to remember.** The move is sound and "looks like" what I already
   play, so it's easy to learn. That includes a good chance of transposing
   into lines I know.
2. **Hidden gems for humans.** The move isn't the most played or the
   engine's top choice, but it works well, either because it scores well at
   my level or because the opponent must find specific, non-obvious moves to
   stay equal. A weaker engine evaluation is fine for these.

How it's measured (`js/ideas.js`, for any position where it's my move). The
candidates are the moves peers play there (at least 30 games, up to 8) plus
Stockfish's choice:

- **Engine:** the eval after the move at depth 14, from my side, and the
  `loss` against the best move.
- **Opponents go wrong (`err`):** for the replies peers play after the
  candidate (Lichess, my bands, covering about 90%, up to 8), Stockfish
  evaluates each resulting position at depth 12. A reply counts as a
  **mistake** if it gives me at least 100 centipawns (`MISTAKE_CP`) more than
  their best defence. `err` is the share of peer replies that are mistakes.
  This measures "not obvious": if peers usually find the good reply, it's
  obvious.
- **Fits your prep (`memorability()`):**
  - Transposition chance: the share of peer replies after which the position
    is in my tree (full weight), or one move of mine away from it (0.7).
  - Setup similarity: the Jaccard similarity of my "developed" pieces and
    pawns (those off their starting squares, e.g. `Pd4 Pe3 Bf4 Nf3`) with
    setups in my other lines at least 6 plies deep. This line, its ancestors
    and its descendants are excluded.
  - The score is the larger of the transposition chance and the average of
    the two.
- **Tags:**
  - **Easy to remember:** loss ≤ 0.8 and fit ≥ 50%.
  - **Practical trick:** not the most played, not the engine's choice, loss
    ≤ `trapLoss` (default 1.5 pawns), `err` ≥ `trapErr` (default 30%), replies
    covering ≥ 50%, and at least 100 games after the move.
  - **Hidden gem:** the peer-score rule from backlog item 4.
  - Both thresholds are in Settings.
- **Cost:** about 10 Lichess lookups (1 per second) and about 70 short engine
  checks per position. It runs on demand ("Find ideas here" in Build) or as a
  background job ("Find ideas across my tree" in Suggestions).
- **Limits:** "looks similar" is only setup and transposition. It doesn't
  understand plans or typical manoeuvres. Depth 12 can underrate a trick: in
  the Blackburne Shilling, 4.Nxe5? Qg5 shows as only about +0.3. The checks
  only cover replies peers actually play.
- **Test:** `tests/ideas.html` (served over HTTP, real Stockfish, fake
  Lichess). It finds 3...Nd4 as a practical trick (40% go wrong with 4.Nxe5)
  and 3...Nf6 as easy to remember (the same setup as the Berlin).

## Backlog: new requirements

1. ~~**Piece sets and board themes.**~~ Done (v0.4). The set and theme live in
   Settings > Board and are saved in `S.settings.pieces` / `S.settings.board`,
   so they sync.
   - Pieces: 7 SVG sets from Lichess in `pieces/<set>/`, plus Unicode, which
     is also the automatic fallback if an image fails. Licences were checked
     against Lichess's COPYING.md: **cburnett is GPLv2+**, not CC BY-SA as
     noted before. CC BY-NC-SA, AGPL and "freeware" sets were left out on
     purpose. `pieces/README.md` lists the sources, and licence texts are in
     `pieces/licenses/`.
   - Boards: green (default), brown, blue, grey, and wood and marble.
     Wood and marble are textures generated from SVG `feTurbulence` in
     `css/app.css`, with no image files. One texture spans the board, and each
     square shows its slice via `--f`/`--r`.
2. ~~**Animate the line before each test.**~~ Done (v0.3). Each card replays
   its line from the start at 250 ms per move, faster for long lines, with
   about 4 s in total at most. The board is locked during the replay, and a tap
   on the board skips it. No replay when `prefers-reduced-motion` is set.
3. ~~**Failed test behaviour.**~~ Done (v0.3). A miss shows the wrong move in
   red and the right one highlighted for 1.5 s, then moves on. The card is put
   back `RETRY_GAP` (3) cards later in the same session until it's answered
   correctly. Only the first attempt is graded (`T.graded`). A correct answer
   also moves on by itself, after 0.9 s, so there's no Next button.
4. ~~**Hidden gems from Lichess peer data.**~~ Done (v0.4).
   - A gem has at least 300 games, is played at most 10% of the time, and
     scores at least 5 points above the position's average. All three numbers
     are set in Settings (`S.settings.gem = {min, freq, edge}`).
   - Gems show in Build, in the "At your level on Lichess" table at my turn,
     and in the Suggestions card, always with the game count.
5. ~~**Neighbouring and transposing lines.**~~ Done (v0.4), in the
   Suggestions card:
   - (a) explorer moves from my positions that reach another position in my
     tree. The opponent's table also marks these "Transposes to your prep".
   - (b) named openings from `OPENINGS` with the same `pawnKey()` (pawns
     only) as one of my positions at least 8 plies deep, excluding my own
     opening family. They link to the Lichess analysis board, since those
     lines aren't in my tree.
   - (c) "better-scoring alternatives": other moves with the minimum games
     that score `edge` points more than my move.
6. **AI training coach.** The AI must not analyse chess itself; the engine
   does that. The app sends it a compact metrics report: per line, win/draw/loss
   rates, accuracy in book and just after it, misplay counts, training lapses,
   gaps by frequency, and peer win rates. It replies with human training advice:
   "drill this line", "your results after X are poor, consider switching to Y",
   "you keep leaving book at move 6".
   - It may search the web for training material on problem positions or
     openings, and should give links with sources.
   - **Architecture:** the API key must never be in the frontend. Use a
     **Supabase Edge Function** that holds the key as a Supabase secret. It
     checks the user's Supabase sign-in, then calls the model API (for example
     Claude through the Anthropic API, with its web search tool turned on
     server-side). Add per-user rate limiting and a monthly spending cap.
     Store each report and the advice in a table so I can look back at
     earlier advice.
   - Keep the report to aggregated numbers and line names (SAN). No raw game
     dumps, to keep cost down.

## Working notes

- Git: commit through GitHub Desktop or the terminal. Pushing to `main` updates
  the Pages site within a minute or two.
- **Styles (v0.9.15):** `css/app.css` has one rule per selector, grouped by area, with the layout media
  queries at the end (phones first). Change a rule where it is; don't append overrides. For a CSS
  refactor, copy the old file to `css/app.old.css` and run `tests/styles.html` (it compares the
  computed style of every element on 12 screens at 360 px and 1100 px; expect `TOTAL 0`), then
  delete the copy. Hover and focus states aren't covered.
- **Cache busting (v0.9.14):** `index.html` loads `css/app.css` and every `js/*.js` with `?v=<version>`.
  Bump it on every release (`sed -i "s/?v=OLD/?v=NEW/g" index.html`), or phones can mix new
  HTML with cached old scripts or styles (Pages caches for about 10 minutes).
- **Auto-reply (v0.9.14):** `autoPending` (the path) makes `renderBuild()`/`refreshBuild()` skip the
  rows for the in-between position until `autoOpponent()` plays the reply (Lichess wait capped at 8 s).
- **Updates page:** when something user-visible ships, add an entry at the top (with `v`, the release, same as `?v=`)
  of `UPDATES` in `js/updates.js`. Give it a new `id`, a date, a title and a few
  plain-language lines. The header shows "New" until the page has been opened
  (`pb_seen_update`).
- **Installable app:** `manifest.webmanifest` (`display: standalone`) and
  `icons/icon-192.png` / `icon-512.png` let Android Chrome install Prep Book
  as an app, which opens without the address bar. The icons are the cburnett
  knight on the app's green, rendered with headless Chrome.
- Local testing: serve the folder (for example the VS Code "Live Server"
  extension, or `npx serve`), then add that localhost URL to Supabase's
  Redirect URLs.
- Supabase isn't reached through Git. Git only holds the code. For the
  database, either:
  - run SQL in the Supabase dashboard's SQL Editor, or
  - use the **Supabase CLI** (`supabase link`, then `supabase db push` for
    migrations kept in `supabase/migrations/`, and
    `supabase functions deploy` for Edge Functions), or
  - connect the **Supabase MCP server** in Claude Code, so Claude can inspect
    the schema and run migrations. Prefer read-only mode, or a development
    branch, for anything risky.
- Design (v0.8): clean, soft and light, all driven by CSS custom properties.
  - Palette: soft cool greys, white cards with faint shadows, and a calm blue
    accent (`--accent`) used sparingly.
  - Colour-blind safe: **good = blue (`--good`), bad or warning = orange
    (`--bad`/`--warn`)**, and never red against green. Purple (`--gem`) marks
    gems and practical weapons. Keep to these tokens; don't hard-code colours.
  - Light is the default. `S.settings.theme` is `light` / `dark` / `system`,
    set on `html[data-theme]`. An inline script in `<head>` applies it from
    `pb_theme` before the first paint.
  - The default board is "Soft blue" (`--sq-l`/`--sq-d` on `:root`). Other
    boards use `html[data-board]`.
  - 44 px tap targets (40 px for the Build controls), and a fixed bottom tab
    bar that respects safe-area insets.
  - Explanations go behind ⓘ (`info()`), not into the page.
  - Wording (v0.9.59, the user's rule): everything on screen says "your" / "you" for the user's side (never "my", "I",
    "me"), and "opponent" / "your opponent" for the other side (never "they", "them", "their"). Peers (Lichess players at
    your level) say "your side scores". Code comments can stay first person. The old release notes in updates.js keep
    their wording.
