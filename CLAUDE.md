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

## Current state (v0.3, proof of concept)

Plain static files, no build step and no bundler. GitHub Pages serves the repo
as it is. External scripts come from CDNs:

- chess.js 0.10.3 (cdnjs, UMD global `Chess`): move legality, SAN, FEN
- @supabase/supabase-js 2.45.4 (jsdelivr, UMD global `supabase`)
- Stockfish: stockfish.js 10.0.2 (cdnjs). Loaded inside a Web Worker made from a
  `blob:` URL that calls `importScripts`. UCI over postMessage.
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
- `js/engine.js`: `Engine` (Stockfish wrapper with an eval cache) and the
  accuracy formula
- `js/app.js`: Lichess explorer client, chess.com importer, engine game
  analysis, board component, the four views (Build, Train, Games, Settings),
  and `boot()`

Tests (open in a browser, or run headless Chrome with `--dump-dom`; there's no
Node on the dev machine):

- `tests/logic.html`: unit tests for `core.js`, `book.js` and `rep.js`
  (position keys, transpositions, repertoire building, PGN round trip,
  `analyseGame()`, misplay flags, key migration, scheduling)
- `tests/smoke.html#local` / `#hosted` / `#train`: loads the real app in an
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
  - On my turn, `m` has exactly one move (my repertoire choice).
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
- `S.games[]`: rapid games only, as `{id, my, tc, url, date, white, black,
  welo, belo, result, moves: "SAN SAN …"}`
- `S.acc[gameId] = {inb:[…], post:[…], exitCp}`: per-move accuracy, using the
  Lichess formula from centipawn loss. `inb` covers moves inside my book,
  `post` covers up to about 8 plies after leaving book, and `exitCp` is the
  engine eval at book exit from my side.
- `analyseGame()` returns where a game left the tree, as one of these exit types:
  - `misplay`: I deviated from my own move
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

The data is saved as five JSON documents: `white`, `black`, `settings`,
`games`, `acc`. Each save writes a whole document about 700 ms after the last
change. The Lichess token (`pb_token`), the explorer cache (`pb_expl`) and the
engine eval cache (`pb_eval`) stay in `localStorage` and never go to the
database.

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
- Claude Code reaches the database through the claude.ai Supabase connector,
  which has **write** access. Ask before running anything other than reads.

The whole-document approach is fine for now. If `games` grows large, move games
and accuracy into their own table, with one row per game.

## External APIs

- **chess.com Published-Data API** (no auth):
  - `GET https://api.chess.com/pub/player/{user}/games/archives` lists the
    monthly archives
  - each archive URL returns `{games:[{pgn, time_class, rules, url, …}]}`
  - keep games where `time_class === "rapid"` and `rules === "chess"`
- **Lichess opening explorer**:
  - `GET https://explorer.lichess.ovh/lichess?variant=standard&speeds=rapid&ratings=1600,1800&moves=12&topGames=0&recentGames=0&fen=…`
  - Since mid-2026 it **requires** `Authorization: Bearer <personal token>`.
    The token needs no scopes and is entered in Settings.
  - Responses are cached per position and rating band.
  - Lichess ratings run higher than chess.com, so the default band is
    1600–1999.

## Untested: verify first

- [ ] Board, tap-to-move and Stockfish on Android Chrome. stockfish.js 10 is
      the old asm.js build and is slow. Consider the WASM "lite single-thread"
      build from the `stockfish` npm package, self-hosted in the repo.
- [ ] chess.com fetch and Lichess explorer from the Pages site (CORS, token)
- [x] Supabase sign-up, confirmation, first save, and sync between two devices
      (phone to laptop, 2026-11-07)
- [x] PGN repertoire export and import round trip (logic covered by
      `tests/logic.html`; the Copy/paste UI hasn't been tried on a phone yet)
- [x] App boots on desktop Chrome in local and hosted modes
      (`tests/smoke.html`)

## Known limitations

- Only about 130 openings have a one-line idea. The other names from the
  dataset have none.
- Explorer data is only fetched for positions I visit. Gap ranking uses the
  product of opponent move frequencies along the path, so unvisited branches
  rank poorly. Add a "scan my tree" job that prefetches explorer data across
  the repertoire, rate-limited.
- Training tests one position at a time. The line is replayed first, but I
  only play the final move, not every move of mine along the way.
- Promotion always makes a queen.
- Errors are shown as toasts, and there is no offline queue beyond
  `localStorage`.

## Backlog: new requirements

1. **Piece sets and board themes.** Let me choose piece sets and board colours
   or textures, saved in settings.
   - Use SVG piece sets with licences that allow reuse. The Lichess sets have
     mixed licences: cburnett is CC BY-SA, others are GPL. Check each set and
     credit it.
   - Make textures with CSS or generated SVG (wood grain, marble), not
     copyrighted images.
   - Keep the Unicode pieces as a fallback.
2. ~~**Animate the line before each test.**~~ Done (v0.3). Each card replays
   its line from the start at 250 ms per move, faster for long lines, with
   about 4 s in total at most. The board is locked during the replay, and a tap
   on the board skips it. No replay when `prefers-reduced-motion` is set.
3. ~~**Failed test behaviour.**~~ Done (v0.3). A miss shows the wrong move in
   red and the right one highlighted for 1.5 s, then moves on. The card is put
   back `RETRY_GAP` (3) cards later in the same session until it's answered
   correctly. Only the first attempt is graded (`T.graded`). A correct answer
   also moves on by itself, after 0.9 s, so there's no Next button.
4. **Hidden gems from Lichess peer data.** Recommend moves that are rarely
   played but score well at my rating band. A starting rule: at least about 300
   games, frequency at most 10%, and my score from that move at least 5
   percentage points above the position's average. Make the thresholds
   configurable, and show the sample size so small samples aren't over-trusted.
5. **Neighbouring and transposing lines.** Recommend lines that are close to my
   current prep:
   - (a) explorer moves that transpose into positions already in my tree
     (same position key)
   - (b) lines that reach the same pawn structure as my existing lines (compare
     a pawn-only FEN or a pawn-skeleton hash)
   - (c) alternatives one move away from my lines that score better at my band
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
