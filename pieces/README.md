# Piece sets

SVG piece sets, copied unchanged from Lichess
(`lichess-org/lila`, `public/piece/<set>/`). Each set's authors and licence are
listed in Lichess's
[COPYING.md](https://github.com/lichess-org/lila/blob/master/COPYING.md),
which is where this list comes from (checked 2026-11-07).

| Set | Author | Licence | Licence text |
|---|---|---|---|
| cburnett | [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett) | GPLv2 or later | [licenses/GPL-2.0.txt](licenses/GPL-2.0.txt) |
| merida | Armando Hernandez Marroquin | GPLv2 or later | [licenses/GPL-2.0.txt](licenses/GPL-2.0.txt) |
| chessnut | [Alexis Luengas](https://github.com/LexLuengas/chessnut-pieces) | Apache 2.0 | [licenses/Apache-2.0-chessnut.txt](licenses/Apache-2.0-chessnut.txt) |
| fantasy, celtic, spatial | [Maurizio Monge](https://github.com/maurimo/chess-art) | MIT | [licenses/MIT-chess-art.txt](licenses/MIT-chess-art.txt) |
| rhosgfx | [RhosGFX](https://rhosgfx.itch.io/) | CC0 1.0 (public domain) | [creativecommons.org/publicdomain/zero/1.0](https://creativecommons.org/publicdomain/zero/1.0/) |

The SVG files are their own source. They haven't been modified.

Not included: Lichess sets licensed CC BY-NC-SA (non-commercial), AGPL, or
"freeware" without clear terms. Adding one means checking its line in
COPYING.md first, then adding it to this table, to `PIECE_SETS` in
`js/app.js`, and to the credits in Settings.

Board textures (wood, marble) are generated in CSS from SVG noise filters.
They contain no image files.
