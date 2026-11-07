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

## Current state (v0.2, proof of concept)

Everything lives in one file, `index.html`: markup, CSS and one inline script.
No build step. External scripts come from CDNs:

- chess.js 0.10.3 (cdnjs, UMD global `Chess`): move legality, SAN, FEN
- @supabase/supabase-js 2.45.4 (jsdelivr, UMD global `supabase`)
- Stockfish: stockfish.js 10.0.2 (cdnjs). Loaded inside a Web Worker made from a
  `blob:` URL that calls `importScripts`. UCI over postMessage.
- Fonts: IBM Plex Sans / Sans Condensed / Mono. Pieces are Unicode glyphs drawn
  with Noto Sans Symbols 2 (Google Fonts, subset with `text=`).

The code is laid out in this order:

1. `BOOK_RAW`: about 130 hand-curated named openings `[ECO, name, SAN line, idea]`
2. Constants, helpers and state object `S`
3. `Store`: storage layer (three modes, described below)
4. Repertoire model: `walk()`, `addMove()`, `removeMove()`
5. PGN parsing: main line for games, full variation tree for repertoire import
6. `analyseGame()`: compares a game with the repertoire
7. Scheduler: `grade()`, `dueCards()`, `flagMisplays()`
8. Lichess explorer client
9. chess.com importer
10. `Engine`: Stockfish wrapper with an eval cache
11. Board component, then the four views: Build, Train, Games, Settings

**Suggested first job:** split it into `index.html`, `css/app.css`,
`js/book.js`, `js/store.js`, `js/engine.js`, `js/app.js`. Use plain ES modules
or classic scripts, with no bundler unless there's a clear reason. GitHub Pages
serves it as it is.

### Data model

- A position key is the first four FEN fields (board, side to move, castling,
  en passant). Keying on this merges transpositions. Note: chess.js 0.10 always
  sets the en-passant square after a double pawn push, so a few transpositions
  are missed. Consider normalising en passant to "-" unless a capture is
  actually legal.
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
   On `visibilitychange`, it pulls changes newer than the last seen
   `updated_at`. Last write wins, which is fine for a single user.
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
- Schema, already applied through the SQL Editor. Save it as
  `supabase/migrations/0001_prep_data.sql` so the schema lives in the repo:

```sql
create table public.prep_data (user_id uuid not null default auth.uid() references auth.users(id) on delete cascade, doc text not null, data jsonb not null, updated_at timestamptz not null default now(), primary key (user_id, doc));
alter table public.prep_data enable row level security;
create policy "read own" on public.prep_data for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own" on public.prep_data for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own" on public.prep_data for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own" on public.prep_data for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.prep_data to authenticated;
```

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
- [ ] Supabase sign-up, confirmation, first save, and sync between two devices
- [ ] PGN repertoire export and import round trip

## Known limitations

- Opening names come from a hand-curated list of about 130 lines. Replace it
  with the full Lichess `chess-openings` dataset (TSV files, CC0, about 3,400
  names): https://github.com/lichess-org/chess-openings. Bundle it or load it
  as JSON.
- Explorer data is only fetched for positions I visit. Gap ranking uses the
  product of opponent move frequencies along the path, so unvisited branches
  rank poorly. Add a "scan my tree" job that prefetches explorer data across
  the repertoire, rate-limited.
- Training drills single positions, not whole lines.
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
2. **Animate the line before each test.** Before a training position, play the
   moves from the start position quickly (about 200–300 ms per move), with the
   board locked until it finishes. Allow a tap to skip. Respect
   `prefers-reduced-motion`.
3. **Failed test behaviour.** On a wrong move:
   - show the miss and highlight the correct move for about 1.5 seconds
   - **move on automatically** to the next test
   - re-insert the failed position a few cards later **in the same session**,
     and repeat until it's answered correctly
   - only the first attempt counts for scheduling
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
