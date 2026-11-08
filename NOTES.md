# Prep Book — feedback and feature notes (8 Nov 2026)

Notes collected on mobile after testing the app. They add to the backlog in
`CLAUDE.md` and take priority where they overlap with it. Tick items off as
they're done.

## General principles

- **Never block the page.** Anything slow (Stockfish, Lichess lookups, game
  analysis) runs in the background. The page shows straight away with
  placeholders, and each piece of information fills in as it arrives. The board
  and buttons always stay responsive. Drop stale results if the user has moved
  to another position.
- **One sample-size rule everywhere.** When the user has only a few games in a
  position, blend their results with the peer (Lichess) score, moving towards
  their own results as games add up. Show the sample size next to every
  statistic, so small samples are never over-trusted.
- **Keep the UI clean.** Show summaries by default and details on demand: hover
  on PC, tap on Android. Don't use the browser's built-in `title` tooltip,
  because it doesn't show on mobile.
- **One place for all thresholds.** Every tunable number lives in an "Advanced"
  part of Settings, with sensible defaults:
  - the "good move" margin (default 0.5 pawns)
  - the mistake size (default 1.5 pawns)
  - the time-pressure cut-off (default 30 seconds)
  - the hidden-gem rules

## Groundwork (do first)

- [x] **G1. Store more per game.** Needed for the items marked below.
  (Done 2026-11-08. Migration `0003_games_table.sql` applied the same day.)
  - [x] Keep clock times. chess.com PGNs have `{[%clk 0:04:12.3]}` after each
    move, but the current parser strips comments, so change it to read them.
    *Done:* `mainlineWithClocks()` gives `game.clk`, seconds left after each
    move, plus `game.tcs`. Games imported before this get their clocks on the
    next chess.com fetch.
  - [x] Store an engine evaluation for every analysed move. *Done:* analysis
    v2 has `ev` (cp from White's side) and `bm` (best move) for every position
    up to ply 160, at depth 10. Older analyses are redone by "Analyse all".
  - [x] Build per-position statistics from the user's own games: games, wins,
    draws, losses. *Done:* `myPosStats(key)` and `myMoveStats(key, san)`,
    matched by position, so transpositions count.
  - [x] Move games and their analysis into their own Supabase table, with one
    row per game, instead of one large JSON document. *Code done* (`js/games.js`).
    It switches over by itself once migration 0003 is applied, and copies the
    games across the first time. Locally, games are now in IndexedDB instead
    of localStorage.
- [x] **G2. Save engine results to the database.** Store Stockfish results by
  position key in Supabase, so analysis run on the PC is instantly available on
  the phone. Use them alongside the local cache. Also switch to the faster
  WASM Stockfish build (see `CLAUDE.md`).
  (Done. WASM build in v0.5. Database code in `js/evals.js`: lookups are
  batched, and results of depth 14 and up are saved. Migration
  `0004_evals_table.sql`, applied 2026-11-08.)
- [x] **G3. One background job queue.** All slow work goes through one queue,
  with the current screen's requests first. That covers engine analysis, MultiPV
  follow-up counts, Lichess lookups, game analysis and puzzle extraction.
  Features shouldn't compete for the engine.
  (Done 2026-11-08: `js/jobs.js`, with "engine" and "net" lanes. Priorities
  are now / soon / background, same-key requests are shared, and stale jobs
  are dropped. MultiPV and puzzle jobs will use it when they're built.)
- [x] **G4. Rating band that keeps up.** Read the user's current chess.com
  rapid rating and suggest the matching Lichess rating band. Lichess ratings
  run higher; 1500–1600 on chess.com is roughly 1600–1999 on Lichess. The user
  can still override it.
  (Done 2026-11-08: `bandsFor()` estimates chess.com + 250 and picks the two
  bands around it. The rating is checked daily and after each fetch. Bands
  follow it automatically until the user sets them by hand.)

## Changes to existing features

- [x] **1. Win/draw/loss as numbers, not just bars.** (Done 2026-11-08: bars carry
  `data-tip`; numbers show on hover or tap via `Tip` in `js/rows.js`. No `title` tooltips remain.)
  - Applies wherever a results bar appears: the opponent-moves table in Build,
    "Where your prep ends", and "Conversion out of the opening" in Games.
  - Keep the bars as the default view. Show the numbers on hover (PC) and on
    tap (Android), for example "W 48% · D 12% · L 40% (n = 312)".
- [ ] **2. Smarter choice of opponent replies when practising lines.** Always
  picking the most popular reply sends the user down the same line every time.
  Instead, weight each reply by:
  - how often it's played at the user's rating band, so practice stays
    realistic
  - how well the user knows that branch, favouring due, weak or flagged
    positions
  - how recently it was seen, so the same branch doesn't repeat back to back

  Over a session, every prepared branch should come up.
- [ ] **3. Start practice from a chosen position.** Pick any position in the
  tree (for example after 1.e4 c5 2.Nf3) and practise only the branches that
  grow from there.
- [ ] **4. Replace the gaps list with a single "Next biggest gap" button.**
  Remove the long "Biggest gaps" list from Build. One button jumps the board to
  the most important gap, and each tap moves to the next one. The button can
  show what it will jump to, for example "Next gap: 2…d6 (31%)".

  There are two ranking modes, with a toggle between them:
  - **Frequency:** how often the user will reach the position, as now.
  - **Rating impact:** how often the user will reach it × how far their
    expected score there falls below par. A rare position where they always
    lose can then outrank a common one where they do fine.

  Unplayed positions need sensible handling in rating-impact mode:
  - With no games of the user's own, use the peer score at their rating band.
    Rank by frequency × how badly peers do there.
  - With a few games, blend their results with the peer score, using the
    general sample-size rule above.
  - Show the basis in the label, for example "your 4 games" or "peer data".
  - Give unprepared positions a small extra weight, because no prep is a risk
    in itself.
- [x] **5. Clearer statistics, including the user's own win rate.** (Done
  2026-11-08: own W/D/L per move and position from G1, peers labelled as peers, and a
  summary line per position. The sample-size rule is `blended()` in `js/rows.js`.) Today the
  Build table doesn't show the user's own results at all. Its "You score" column
  is actually peer data, which is confusing.
  - Show the user's own record (games, W/D/L) for every position and move,
    using G1.
  - Label peer statistics clearly as peer data, and show them side by side with
    the user's own. For example, "You: 7 games, W 29% · D 14% · L 57%" next to
    "Peers 1600–1999: 4,210 games, W 46% · D 8% · L 46%".
  - Add a one-line summary for the current position, for example "You score 36%
    here against 54% for peers. Below par, worth reviewing."
- [ ] **6. Explore and Commit modes in Build.** Add a clear toggle at the top
  of Build.
  - **Explore:** nothing is saved. The user can play moves for either side,
    step back and forward through the line, and try different branches. All
    statistics and the engine update as they go. Use a distinct look (a
    coloured board edge or an "Exploring" badge) so it's obvious nothing is
    being saved.
  - **Commit:** works as Build does now, and every move is saved to the
    repertoire.
  - From Explore, the user can commit the whole explored line in one go or
    switch to Commit at the current position. Warn before replacing an existing
    repertoire move.

## New features

- [ ] **7. Follow-up information for each candidate move.**
  - **Likely replies:** the one or two most common replies at the user's band,
    with frequency and peer score after each. For example, "Usually 3…Nf6
    (62%), 3…d6 (21%)".
  - **How many good replies:** run Stockfish MultiPV and count the replies
    within the "good move" margin of the best. Show it as a label:
    - "Only move" or "Narrow" (1–2 good replies) means a trappy line
    - "Several" (3–4)
    - "Many" (5 or more) means a flexible, positional line
  - **How often peers find a good reply:** the share of players at the user's
    band who played one of the good replies, from the explorer data. A move with
    one good reply that only 30% find is a strong practical weapon.
  - Optionally, a sort or filter that surfaces these practical-weapon moves.
    This also feeds the hidden-gems feature in `CLAUDE.md`.
  - **Loading:** analyse candidates one at a time through G3, starting with the
    most played. Fill in each row as its result arrives, and show
    "analysing…" while a row waits. Cache results, using G2.
- [x] **8. One combined row per candidate move.** (Done 2026-11-08 in `js/rows.js`,
  apart from the "good replies" column, which comes with item 7. The opponent
  table, the "Lichess at your level" table, "Your moves here" and the Stockfish
  card are gone.) Bring the engine, peer and
  personal information together on each suggested move, so the three sources
  can be compared at a glance. This replaces the separate opponent table and
  engine panel in Build.

  A compact row on mobile:

  ```
  Nf6   +0.3 ✓    31% · 52%    You 7 · 43%    Narrow
  move  engine    peers         your games     good replies
  ```

  - **Move**, with a "Prepared" or "Gap" marker.
  - **Engine:** the evaluation after the move, with a tick when it's within the
    "good move" margin. On a mistake it shows the size of the drop.
  - **Peers:** frequency at the user's band and their colour's score after it.
  - **You:** how many times the user has had it and their score, or "–" if
    they haven't.
  - **Good replies:** the label from item 7, on the user's own candidate moves.

  Tapping the row expands it. Tapping the move itself plays it on the board.
  The expanded detail shows:
  - the full W/D/L for peers and for the user (item 1)
  - the likely follow-ups (item 7)
  - how often peers find a good reply
  - the sample sizes

  On PC, the extra width allows the detail to sit inline.

  Use colour to flag where the sources disagree, for example a move the engine
  likes but the user scores badly with. Keep the three sources visually
  distinct. Each part fills in independently as it loads.
- [ ] **9. Mistake review (new section, separate from openings).** Turn the
  user's real mistakes into puzzles, using the game analysis.

  **What becomes a puzzle:**
  - A move by the user that loses at least the mistake size of evaluation, or
    that turns a win into a draw or a draw into a loss.
  - **Only mistakes the opponent actually punished,** meaning their next move
    or two matched engine best play (within the "good move" margin). This
    keeps out mistakes that only an engine would exploit.
  - **No moves under clock pressure.** Leave out moves made with less than the
    time-pressure cut-off left, using the clock data from G1.
  - Also leave out positions that were already lost before the mistake, and
    forced recapture sequences.

  **How a puzzle works:**
  - Animate the game quickly up to the position before the mistake.
  - The goal is to find **any good move** (within the margin), not one exact
    answer.
  - On success, show what the user actually played and the punishing line. On a
    miss, highlight a good move and animate the punishing line.
  - Stockfish gives no written explanations, so the punishing line, shown as a
    short animation, is the explanation.

  **Keep or retire:** after each puzzle, the user chooses **Keep** (spaced
  repetition), **Seen it** (retire it) or **Later**. The app suggests one:
  - Suggest Keep when the same kind of mistake recurs across games, when the
    position came from the user's opening prep, or when they failed the puzzle.
  - Suggest Seen it for one-offs in unusual positions, or puzzles solved
    straight away.

  **Overview:** count mistakes by game phase (opening, middlegame, endgame) and
  by time left on the clock.

  Shares engine work with Games through G2 and G3.

## Connections to the existing backlog in `CLAUDE.md`

- Line practice (items 2 and 3) and mistake review (item 9) should reuse the
  animated run-up and the "show the correct move, then retry later in the
  session" behaviour already in the backlog, not separate versions of them.
- The planned **AI coach** should receive the new metrics:
  - rating impact by position
  - mistakes by phase and by time left
  - practical-weapon moves
  - lines where the user is below the peer par

## Suggested build order

1. Groundwork: G1, G2, G3 (and G4 when convenient)
2. Statistics and combined move rows: items 1, 5, 8
3. Gaps and practice: items 4, 2, 3, 6
4. Follow-ups and mistake review: items 7, 9
5. The AI coach (from `CLAUDE.md`), once there's good data to feed it
