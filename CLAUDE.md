# Prep Book — project handover

Prep Book is a personal chess openings trainer, built because the off-the-shelf
apps (Chessable, ChessBase etc.) need subscriptions. It is for one user (me) for
now, but should stay structured so other people could use it later.

- Repo: https://github.com/tommusker-blip/prep-book
- Live site (GitHub Pages, main branch, root): https://tommusker-blip.github.io/prep-book/
- Must work well on **Android Chrome** (installed via "Add to Home screen") and
  on desktop. Mobile-first layout, tap-to-move board.
- I play **rapid** on chess.com, rated about **1500–1600**. Repertoires for both
  White and Black. The repertoire starts empty and is built in the app.

## Current state (v0.7, proof of concept)

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
- `js/app.js`: chess.com importer, engine game analysis, board component, the
  four views (Build, Train, Games, Settings), and `boot()`

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
  - `0003_games_table.sql` (G1): `games`, one row per game (`game` and
    `analysis` jsonb), with RLS and the same trigger. **Not applied yet** (as
    of 2026-11-08). The app falls back to the old `games`/`acc` documents
    until it is. Once applied, the app copies games in by itself the first
    time (`settings.gamesInTable`). It leaves the old documents as a backup,
    and `settings.gamesEpoch` tells other devices when games were cleared.
  - `0004_evals_table.sql` (G2): `evals`, Stockfish results by position key.
    **Not applied yet.** Without it, `Evals` does nothing.
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
  a position with no data counts as 100%, so scan first.
- The explorer cache is in `localStorage`, alongside `pb_data` (games are
  about 850 KB). If storage runs out, `lsSet` fails silently. Consider
  IndexedDB for the caches.
- Training tests one position at a time. The line is replayed first, but I
  only play the final move, not every move of mine along the way.
- Promotion always makes a queen.
- Errors are shown as toasts, and there is no offline queue beyond
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
- Design: plain, functional tool. Green tournament-board palette, light and
  dark themes driven by CSS custom properties, 44 px tap targets, and a fixed
  bottom tab bar that respects safe-area insets.
