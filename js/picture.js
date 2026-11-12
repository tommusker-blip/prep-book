"use strict";
/* ---------- Openings > Picture (v0.9.35, drafts; v0.9.36 cut to two): visual summaries ----------
   Food for thought rather than hard indicators, from data the app already has (my games'
   position keys in GAMEKEYS, the tree and cached Lichess data), so nothing new is fetched:
   - Tree: a sunburst of my repertoire from the position chosen. Rings = moves, width = how often
     I get there, hatched = not prepared. Colour: my score (my games only), peers' score (Lichess
     players at my level, from my side) or how many of my games went there. Tapping a slice shows
     its position on a board.
   - Structures: the pawn structure after move N in my games. Named ones from structureOf(); the
     rest grouped by their centre pawns (files c to f, both sides), so fewer land in "Other".
   (v0.9.36: Squares, Fights and Clock were tried and dropped: not useful.)
   Score = (wins + draws / 2) / games, as everywhere in the app.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const PIC = {
  view: "tree",
  sun: { root: [], stack: [], sel: null, color: "mine", who: "all" },
  st: { move: 12, by: false },
};
const PIC_RINGS = 8;
const picSeg = (name, cur, opts, label) => `<div class="seg small" role="group" aria-label="${esc(label)}">${opts.map(([v, t]) => `<button type="button" data-${name}="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(t)}</button>`).join("")}</div>`;
// The 64 squares of a position key's board, a8 first
function boardCells(key) {
  const out = [];
  for (const ch of key.split(" ")[0]) { if (ch === "/") continue; if (ch >= "1" && ch <= "8") for (let i = 0; i < +ch; i++) out.push(""); else out.push(ch); }
  return out;
}
// My games of this colour with a result and their keys worked out
function picGames(color) { return S.games.filter(g => g.my === color && GAMEKEYS.has(g.id) && myScore(g) != null); }
const picMemo = new Map();
function picCached(name, sig, fn) { const m = picMemo.get(name); if (m && m.sig === sig) return m.out; const out = fn(); picMemo.set(name, { sig, out }); return out; }
const picSig = (...a) => [S.color, S.book, gamesSig(), GAMEKEYS.size, ...a].join("|");
// Shrink a score towards the average: few games say little
const shrink = (sum, n, avg) => (sum + adv().k * avg) / (n + adv().k);
// A colour from blue (good) through neutral to orange (bad), fainter with less data (0..1)
const scoreFill = (score, weight = 1) => {
  const diff = score - 0.5, k = Math.round((Math.min(1, Math.abs(diff) / 0.15) * 75 + 10) * Math.max(0.25, Math.min(1, weight)));
  return `style="fill:color-mix(in srgb,var(${diff >= 0 ? "--good" : "--bad"}) ${k}%,var(--surface))"`;
};

/* ----- Tree (sunburst) ----- */
const PIC_R0 = 30, PIC_R1 = 156;
function sunArcs(color, rootPath) {
  const { nodes } = walk(color), out = [];
  const rootKey = K(fenAfter(START, rootPath));
  if (!nodes[rootKey]) return null;
  const rec = (key, path, a0, a1, d, seen) => {
    if (d >= PIC_RINGS || a1 - a0 < 0.004) return;
    const node = nodes[key], mine = isMine(key, color), kids = node.kids.filter(k => !seen.has(k.key));
    const ex = cachedExplorer(node.fen);
    if (!kids.length) { out.push({ d, a0, a1, gap: true, mine, path, key }); return; }
    let shares;
    if (mine) shares = kids.map(() => 1 / kids.length);
    else if (ex && ex.total) shares = kids.map(k => { const mv = ex.moves.find(m => m.san === k.san); return mv ? mv.n / ex.total : 0.01; });
    else shares = kids.map(() => 1 / kids.length);
    let a = a0;
    const span = a1 - a0, sumShare = shares.reduce((x, y) => x + y, 0);
    kids.forEach((k, i) => {
      const w = span * Math.min(shares[i], 1), p = path.concat(k.san);
      const mv = ex && ex.moves.find(m => m.san === k.san);
      out.push({ d, a0: a, a1: a + w, san: k.san, path: p, key: k.key, mine, games: myPosStatsBy(k.key, color, PIC.sun.who), peer: mv ? scoreFor(mv, color) : null, peerN: mv ? mv.n : 0 });
      const s2 = new Set(seen); s2.add(k.key);
      rec(k.key, p, a, a + w, d + 1, s2);
      a += w;
    });
    if (!mine && sumShare < 0.98 && a1 - a > 0.004) out.push({ d, a0: a, a1, gap: true, mine, path, key, rest: 1 - sumShare });
  };
  rec(rootKey, rootPath, 0, 1, 0, new Set([rootKey]));
  return out;
}
function arcPath(a0, a1, r0, r1) {
  const t = x => x * 2 * Math.PI - Math.PI / 2, pt = (r, x) => `${(r * Math.cos(t(x))).toFixed(2)} ${(r * Math.sin(t(x))).toFixed(2)}`;
  if (a1 - a0 >= 0.9999) a1 = a0 + 0.9999;
  const big = a1 - a0 > 0.5 ? 1 : 0;
  return `M${pt(r1, a0)}A${r1} ${r1} 0 ${big} 1 ${pt(r1, a1)}L${pt(r0, a1)}A${r0} ${r0} 0 ${big} 0 ${pt(r0, a0)}Z`;
}
const SUN_COLOURS = [["mine", "My score"], ["peers", "Peers' score"]];
// v0.9.55: my score over all my games, or only those where I left my prep, or only those where the opponent did
const WHO_OPTS = [["all", "All games"], ["me", "I left prep"], ["them", "They left prep"]];
function renderSun(color) {
  const o = PIC.sun;
  let arcs = sunArcs(color, o.root);
  if (!arcs) { o.root = []; o.sel = null; arcs = sunArcs(color, []); }
  if (!arcs || !arcs.length) return `<p class="help">Nothing in your ${color} repertoire yet.</p>`;
  const ring = (PIC_R1 - PIC_R0) / PIC_RINGS;
  const fill = a => {
    if (a.gap) return `fill="url(#picHatch)"`;
    const none = `style="fill:var(--line)"`;
    if (o.color === "peers") return a.peer == null ? none : scoreFill(a.peer, a.peerN / 100);
    return a.games && a.games.n ? scoreFill(wdlScore(a.games), a.games.n / 10) : none;
  };
  const sel = o.sel;
  const arcId = a => (a.gap ? "gap:" : "") + a.path.join(" ");
  const paths = arcs.map(a => {
    const r0 = PIC_R0 + a.d * ring, r1 = r0 + ring - 0.6, id = arcId(a), on = sel === id;
    let label = "";
    const mid = (a.a0 + a.a1) / 2, len = (a.a1 - a.a0) * 2 * Math.PI * (r0 + ring / 2);
    if (!a.gap && len > 22 && ring > 12) {
      const t = mid * 2 * Math.PI - Math.PI / 2, rm = r0 + ring / 2;
      label = `<text x="${(rm * Math.cos(t)).toFixed(1)}" y="${(rm * Math.sin(t)).toFixed(1)}" class="suntx">${esc(a.san)}</text>`;
    }
    return `<path d="${arcPath(a.a0, a.a1, r0, r1)}" ${fill(a)} class="sunarc${on ? " on" : ""}${a.gap ? " gap" : ""}" data-picsun="${esc(id)}"></path>${label}`;
  }).join("");
  const rootName = o.root.length ? (openingFor(o.root) || {}).name || o.root.join(" ") : "Start";
  const svg = `<svg class="sun" viewBox="-160 -160 320 320" role="img" aria-label="Your repertoire as rings of moves">
    <defs><pattern id="picHatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" style="fill:var(--surface)"/><line x1="0" y1="0" x2="0" y2="5" style="stroke:var(--warn);stroke-width:2"/></pattern></defs>
    ${paths}<circle r="${PIC_R0 - 2}" class="suncore" data-picsunup="1"><title>Back out</title></circle>
    <text class="suntx core" y="3">${o.root.length ? "↑ back" : "start"}</text></svg>`;
  let side = `<p class="help">Tap a slice to see its position.</p>`;
  const a = sel != null ? arcs.find(x => arcId(x) === sel) : null;
  if (a && a.gap) {
    const at = a.path.join(" ");
    side = `<div class="sunsel"><div id="picBoard" class="board aoboard" aria-label="The position"></div>
      <p><b class="mono">${esc(numbered(0, a.path) || "Start")}</b></p>
      <p class="help">${a.mine ? "Your move here isn't prepared." : a.rest ? `Not prepared: ${pctOf(a.rest)} of replies at your level here.` : "Your line ends here: no replies prepared."}</p>
      <div class="row" style="margin:0"><button type="button" class="btn ghost" data-open="${esc(at)}">Open in Build</button></div></div>`;
  } else if (a) {
    const name = (openingFor(a.path) || {}).name, kids = arcs.some(x => x.d === a.d + 1 && x.path.slice(0, a.path.length).join(" ") === sel);
    side = `<div class="sunsel"><div id="picBoard" class="board aoboard" aria-label="The position"></div>
      <p><b class="mono">${esc(numbered(0, a.path))}</b>${name ? `<br><span class="help">${esc(name)}</span>` : ""}</p>
      <p class="help">My games${o.who !== "all" ? ` where ${o.who === "me" ? "I" : "they"} left prep` : ""}: ${a.games && a.games.n ? `${a.games.n}, I score ${pctOf(wdlScore(a.games))} (${a.games.w} won, ${a.games.d} drawn, ${a.games.l} lost)` : "none yet"}.<br>Peers at my level: ${a.peer != null ? `${a.peerN.toLocaleString("en-GB")} games, my side scores ${pctOf(a.peer)}` : "no data loaded"}.</p>
      <div class="row" style="margin:0">${kids ? `<button type="button" class="btn" data-picsunin="${esc(sel)}">Zoom in here</button>` : ""}<button type="button" class="btn ghost" data-open="${esc(sel)}">Open in Build</button></div></div>`;
  }
  const key = { mine: "Blue: you score well there in your own games; orange: badly. Faint: few games; grey: none.", peers: "Blue: players of your colour at your level score well there on Lichess; orange: badly. Faint: few games." }[o.color] || "";
  return `<div class="picctl">${picSeg("pscolor", o.color, SUN_COLOURS, "Colour by")}${o.color === "mine" ? picSeg("pswho", o.who, WHO_OPTS, "Which games") : ""}</div>
    ${o.root.length ? `<p class="help">From <b>${esc(rootName)}</b>. Tap the centre to back out.</p>` : ""}
    <div class="conwrap"><div class="sunwrap">${svg}</div>${side}</div>
    <p class="help">${key}${o.color === "mine" && o.who !== "all" ? ` Only your games where ${o.who === "me" ? "you left your prep (a mistake, or a choice of yours)" : "your opponent left your prep (a move you hadn't prepared)"}.` : ""} Each ring is a move; a slice is as wide as how often you get there. Hatched: replies you haven't prepared. Score counts a draw as half.</p>`;
}
// The board for the slice tapped (re-made after each redraw, like Connect's)
let PB = null;
function picShowBoard() {
  const el = $("#picBoard"), sel = PIC.sun.sel;
  if (!el || sel == null) return;
  const path = sel.replace(/^gap:/, "").split(" ").filter(Boolean);
  if (!PB || PB.el !== el) { PB = Board(el); PB.locked = true; PB.noSlide = true; }
  PB.flip = S.color === "black";
  const c = new Chess();
  let last = null;
  for (const m of path) { const mv = c.move(m); if (!mv) break; last = [mv.from, mv.to]; }
  PB.set(c.fen(), { last });
}

/* ----- Structures (v0.9.39: by pawn features, not by exact pawn setup) -----
   Grouping games by their exact pawns gave many groups with tiny differences. Instead every game
   is described by a few features at a given move, and each feature is counted on its own:
   - the type of centre (after Pachman / Soltis): open, closed, fixed, mobile (whose), tension,
     or no contact yet, from the pawns on the d- and e-files;
   - for each side, by file: missing pawns (no pawn of that side on the file), isolated, doubled,
     backward (no own pawn beside or behind it, and its square in front covered by an enemy pawn)
     and passed pawns;
   - linked into structures (v0.9.41, stCombos()): sets of features that come up together, with frequency and score.
   Each figure is the share of my games with it, and my score in those games against my average
   (pulled towards the average on few games: shrink()). "By move" shows the shares from move 4 to 20. */
const ST_MOVES = [4, 6, 8, 10, 12, 14, 16, 18, 20];
const CENTRES = [
  ["open", "Open", "Each side has at most one centre pawn (d- or e-file), not blocked or attacked (the Open Sicilian, the Scandinavian). Pieces and open lines decide: develop fast."],
  ["closed", "Closed", "Both centre files locked: pawns blocking each other on the d- and e-files (French Advance, King's Indian with d5 and e5). Play on the wings, with pawn breaks that attack the chains."],
  ["fixed", "Fixed", "One pair of centre pawns blocking each other (d4 against d5, or e4 against e5) and no tension. The squares around them are what matter."],
  ["mobile-me", "Mobile (yours)", "You have two centre pawns and the opponent none: yours can advance, theirs can't stop them easily."],
  ["mobile-them", "Mobile (theirs)", "The opponent has two centre pawns and you none: block them or attack them before they advance."],
  ["tension", "Tension", "Centre pawns can take each other: the next exchange decides the structure."],
  ["none", "No contact yet", "Centre pawns that don't touch yet: the structure is still open to both sides."],
];
const FEATS = [["missing", "Missing"], ["isolated", "Isolated"], ["doubled", "Doubled"], ["backward", "Backward"], ["passed", "Passed"]];
const FEAT_HELP = {
  missing: "No pawn of that side on the file: a half-open or open file.",
  isolated: "No pawn of the same side on either neighbouring file.",
  doubled: "Two or more pawns of the same side on the file.",
  backward: "No pawn of the same side beside or behind it to support it, and the square in front of it is covered by an enemy pawn.",
  passed: "No enemy pawn in front of it on its own or the neighbouring files.",
};
// Pawn ranks per file for both sides, from the 64 squares
function stPawnFiles(cells) {
  const P = { w: Array.from({ length: 8 }, () => []), b: Array.from({ length: 8 }, () => []) };
  cells.forEach((ch, i) => { if (ch === "P" || ch === "p") P[ch === "P" ? "w" : "b"][i % 8].push(8 - Math.floor(i / 8)); });
  return P;
}
function sideFeatures(P, s) {
  const own = P[s], opp = P[s === "w" ? "b" : "w"], up = s === "w" ? 1 : -1, ahead = (rr, r) => (s === "w" ? rr > r : rr < r);
  const out = { missing: new Set(), isolated: new Set(), doubled: new Set(), backward: new Set(), passed: new Set() };
  for (let f = 0; f < 8; f++) {
    if (!own[f].length) { out.missing.add(f); continue; }
    if (own[f].length > 1) out.doubled.add(f);
    const adj = [f - 1, f + 1].filter(x => x >= 0 && x < 8), iso = adj.every(x => !own[x].length);
    if (iso) out.isolated.add(f);
    for (const r of own[f]) {
      if (![f - 1, f, f + 1].some(x => x >= 0 && x < 8 && opp[x].some(rr => ahead(rr, r)))) out.passed.add(f);
      if (!iso && adj.every(x => own[x].every(rr => ahead(rr, r))) && adj.some(x => opp[x].includes(r + 2 * up))) out.backward.add(f);
    }
  }
  return out;
}
function centreType(P, me) {
  // centre pawns that have left their starting square (one still on d2 or e7 doesn't shape the centre yet)
  const W = P.w, B = P.b, moved = (a, home) => a.filter(r => r !== home).length, wc = moved(W[3], 2) + moved(W[4], 2), bc = moved(B[3], 7) + moved(B[4], 7);
  let rams = 0, tension = false;
  for (const f of [3, 4]) for (const r of W[f]) if (B[f].includes(r + 1)) rams++;
  for (let f = 2; f <= 5; f++) for (const r of W[f]) for (const x of [f - 1, f + 1]) if (x >= 0 && x < 8 && (f === 3 || f === 4 || x === 3 || x === 4) && B[x].includes(r + 1)) tension = true;
  if (tension) return "tension";
  if (rams >= 2) return "closed";
  if (rams === 1) return "fixed";
  if (wc <= 1 && bc <= 1) return "open";
  if (bc === 0 && wc >= 2) return me === "w" ? "mobile-me" : "mobile-them";
  if (wc === 0 && bc >= 2) return me === "b" ? "mobile-me" : "mobile-them";
  return "none";
}
const stCell = () => ({ n: 0, sum: 0 });
function structAt(color, move) {
  return picCached("st" + move, picSig(), () => {
    const me = color === "white" ? "w" : "b", them = me === "w" ? "b" : "w";
    const side = () => Object.fromEntries(FEATS.map(([k]) => [k, { any: stCell(), files: Array.from({ length: 8 }, stCell) }]));
    const d = { n: 0, sum: 0, centre: Object.fromEntries(CENTRES.map(([k]) => [k, stCell()])), me: side(), them: side(), games: [] };
    const add = (c, sc) => { c.n++; c.sum += sc; };
    for (const g of picGames(color)) {
      const k = gameKeys(g)[2 * move];
      if (!k) continue;
      const sc = myScore(g), P = stPawnFiles(boardCells(k)), ct = centreType(P, me), items = ["c:" + ct];
      add(d, sc); add(d.centre[ct], sc);
      for (const [who, s] of [["me", me], ["them", them]]) {
        const f = sideFeatures(P, s);
        for (const [feat] of FEATS) { if (f[feat].size) add(d[who][feat].any, sc); f[feat].forEach(x => { add(d[who][feat].files[x], sc); items.push(`${who}:${feat}:${x}`); }); }
      }
      d.games.push({ g, id: g.id, sc, k, items: items.sort() });
    }
    d.avg = d.n ? d.sum / d.n : 0.5;
    return d;
  });
}
/* v0.9.41: the indicators linked into structures. A structure is a set of up to ST_SET features
   (the centre, and each side's missing / isolated / doubled / backward / passed pawns by file)
   that comes up together in at least ST_SUPPORT of my games at that move (and ST_MIN_GAMES games).
   Sets are only kept where they add something: a feature that nearly always comes with another
   (in ST_CLOSED of its games) is shown as the pair, not on its own. Most common first; then the
   ones where I score best and worst against my average (shrunk on few games). The most recent game
   with each is its example. */
const ST_SET = 3, ST_SUPPORT = 0.05, ST_MIN_GAMES = 5, ST_CLOSED = 0.9, ST_SHOW = 8;
function stCombos(d) {
  if (d.combos) return d.combos;
  const minN = Math.max(ST_MIN_GAMES, Math.ceil(d.n * ST_SUPPORT)), single = new Map();
  for (const g of d.games) for (const it of g.items) single.set(it, (single.get(it) || 0) + 1);
  const freq = new Set([...single].filter(([, n]) => n >= minN).map(([it]) => it));
  const sets = new Map();
  const bump = (items, g) => { const k = items.join("|"); let c = sets.get(k); if (!c) sets.set(k, (c = { items, n: 0, sum: 0, ex: g.id })); c.n++; c.sum += g.sc; };
  for (const g of d.games) { // games come newest first, so each set's example is its most recent game
    const fi = g.items.filter(it => freq.has(it));
    for (let a = 0; a < fi.length; a++) {
      bump([fi[a]], g);
      for (let b = a + 1; b < fi.length; b++) {
        bump([fi[a], fi[b]], g);
        if (ST_SET > 2) for (let c = b + 1; c < fi.length; c++) bump([fi[a], fi[b], fi[c]], g);
      }
    }
  }
  const all = [...sets.values()].filter(c => c.n >= minN);
  const byKey = new Map(all.map(c => [c.items.join("|"), c]));
  // a set that nearly always comes with one more feature is shown as the bigger set
  for (const y of all) if (y.items.length > 1) y.items.forEach((_, i) => { const x = byKey.get(y.items.filter((__, j) => j !== i).join("|")); if (x && y.n >= ST_CLOSED * x.n) x.covered = true; });
  const kept = all.filter(c => !c.covered);
  const diff = c => shrink(c.sum, c.n, d.avg) - d.avg;
  const common = kept.slice().sort((a, b) => b.n - a.n || a.items.length - b.items.length).slice(0, ST_SHOW);
  const big = kept.filter(c => c.n >= Math.max(minN, 10));
  const best = big.filter(c => diff(c) >= 0.03).sort((a, b) => diff(b) - diff(a)).slice(0, 3);
  const worst = big.filter(c => diff(c) <= -0.03).sort((a, b) => diff(a) - diff(b)).slice(0, 3);
  return (d.combos = { common, best, worst, minN, kept });
}
/* v0.9.42: worth your attention. Structures where I score below my average, ranked by what they
   cost: games × (average − my score there, shrunk on few games), in game points. For each, where it
   comes from, so I can avoid it by choosing another opening move or practise it:
   - the opening families of those games (deepest name in the dataset up to that move);
   - my last prepared choice before it: the deepest position of my tree, on my move, that those games
     went through, and the move I played there. Open in Build shows that choice with its alternatives;
     Practise trains the line after it.
   Sets that mostly describe the same games as one already listed (ST_OVERLAP) are left out. */
const ST_ATTN = 3, ST_OVERLAP = 0.7, ST_ATTN_MIN = 10;
function stFamily(g, plies) {
  let name = "";
  for (const k of gameKeys(g).slice(0, plies + 1)) { const b = bookName(k); if (b) name = b.name; }
  return name ? family(name).replace(/ (Accepted|Declined|Refused|Deferred)$/, "") : "Unnamed"; // v0.9.49: the main opening (King's Gambit, not Accepted / Declined)
}
function stAttention(d, color, move) {
  if (d.attn) return d.attn;
  const cb = stCombos(d), R = rep(color), nodes = walk(color).nodes, plies = 2 * move;
  const cost = c => c.n * (d.avg - shrink(c.sum, c.n, d.avg));
  const cands = cb.kept.filter(c => c.n >= Math.max(cb.minN, ST_ATTN_MIN) && shrink(c.sum, c.n, d.avg) - d.avg <= -0.03).sort((a, b) => cost(b) - cost(a));
  const out = [], taken = new Set();
  for (const c of cands) {
    if (out.length >= ST_ATTN) break;
    const games = d.games.filter(x => c.items.every(it => x.items.includes(it)));
    if (games.filter(x => taken.has(x.id)).length >= ST_OVERLAP * games.length) continue;
    games.forEach(x => taken.add(x.id));
    const fam = new Map(), dec = new Map();
    for (const x of games) {
      const f = stFamily(x.g, plies), e = fam.get(f) || { name: f, n: 0, sum: 0 };
      e.n++; e.sum += x.sc; fam.set(f, e);
      const keys = gameKeys(x.g), moves = x.g.moves.split(" ");
      let at = -1;
      for (let i = 0; i < Math.min(keys.length - 1, plies); i++) { const n = R.pos[keys[i]]; if (isMine(keys[i], color) && n && n.m.length && nodes[keys[i]]) at = i; }
      if (at < 0) continue;
      const k = keys[at] + "|" + moves[at], e2 = dec.get(k) || { key: keys[at], played: moves[at], n: 0, sum: 0 };
      e2.n++; e2.sum += x.sc; dec.set(k, e2);
    }
    const top = [...dec.values()].sort((a, b) => b.n - a.n)[0];
    out.push({ c, cost: cost(c), games, fams: [...fam.values()].sort((a, b) => b.n - a.n), dec: top ? { ...top, path: nodes[top.key].path } : null });
  }
  return (d.attn = out);
}
function attentionHtml(d, color, move) {
  const list = stAttention(d, color, move);
  if (!list.length) return `<p class="lbl">Worth your attention</p><p class="help">No structure at move ${move} where you score clearly below your average (at least ${ST_ATTN_MIN} games). Try another move with ◀ ▶.</p>`;
  return `<p class="lbl">Worth your attention ${info("Structures where you score below your average, the ones costing you most first: games × the drop in your score, in game points. Each lists the openings it comes from and what tends to happen next in those games: the kind of mistake you make most often in the following moves (from your games' analysis), and how the structure most often changes a few moves later. Practise trains the line from your last prepared choice before it; Show a mistake opens one of those games at the mistake.", "About this list")}</p>
    <div class="stcombos">${list.map(a => {
      const c = a.c, dec = a.dec, line = dec ? dec.path.concat(dec.played) : null, nx = stNext(d, c, color, move);
      // v0.9.48: the openings in full, what happens next instead of "Avoid", buttons across the card
      return `<div class="stcombo bad">${stBar(c, d)}<div class="sttop">${stMini(d, c, color, move, true)}<div class="stcbody">
        <p class="stctext">${comboText(c.items)}</p>
        <div class="stms">${stMetric("−" + a.cost.toFixed(1), "points lost", "bad")}${stMetric(pctOf(c.sum / c.n), `you score (avg ${pctOf(d.avg)})`)}${stMetric(c.n, "games")}</div>
      </div></div>
        ${stFamsLine(a.fams)}
        ${nx.html}
        <div class="stacts">${dec ? `<button type="button" class="btn ghost quick" data-focustrain="${esc(line.join(" "))}" aria-label="${esc(`Practise the line after ${numbered(0, line)}`)}">Practise ${esc(moveLabel(dec.path, dec.played))}</button>` : ""}${nx.ex ? `<button type="button" class="btn ghost quick" data-review="${esc(nx.ex.id)}" data-rvat="${nx.ex.ply}">Show a mistake</button>` : ""}${stExBtn(d, c, move, true)}</div></div>`;
    }).join("")}</div>`;
}
// The frequency bar across the top of a card: the share of my games at that move with it
const stBar = (c, d) => `<div class="stbar" role="img" aria-label="${esc(`In ${pctOf(c.n / d.n)} of your games at this move`)}"><i style="width:${Math.max(2, Math.round((c.n / d.n) * 100))}%"></i></div>`;
// Every main opening (family) the games come from: "Sicilian Defence 12 · French Defence 3"
// v0.9.49: only openings with at least ST_FAM_MIN games and ST_FAM_SHARE of them (common, general indicators); the rest counted together
const ST_FAM_MIN = 3, ST_FAM_SHARE = 0.1;
const stFamsLine = fams => {
  const total = fams.reduce((s, f) => s + f.n, 0), main = fams.filter(f => f.n >= ST_FAM_MIN && f.n >= ST_FAM_SHARE * total && f.name !== "Unnamed");
  const rest = total - main.reduce((s, f) => s + f.n, 0);
  if (!main.length) return `<p class="stfrom"><span class="stwho">From</span> a mix of openings, none in ${ST_FAM_MIN}+ games</p>`;
  return `<p class="stfrom"><span class="stwho">From</span> ${main.map(f => `${esc(f.name)} <b>${f.n}</b>`).join(" · ")}${rest ? ` <span class="muted">· ${rest} other</span>` : ""}</p>`;
};
function stFams(d, c, move) {
  if (c.fams) return c.fams;
  const fam = new Map();
  for (const x of d.games) if (c.items.every(it => x.items.includes(it))) { const f = stFamily(x.g, 2 * move), e = fam.get(f) || { name: f, n: 0 }; e.n++; fam.set(f, e); }
  return (c.fams = [...fam.values()].sort((a, b) => b.n - a.n));
}
/* v0.9.48: what tends to happen next in a structure's games, instead of "avoid it":
   - mistakes: my first move in the next ST_NEXT_PLIES plies that loses at least the mistake margin
     (adv().mistake) in the game's analysis, against the same rate in all my games at that move; and
     the most common kind (a pawn move on a wing or in the centre, a capture, or a piece's move);
   - the change: the feature that most often appears ST_NEXT_MOVES moves later, with my score then.
   Only analysed games count for the mistakes. */
const ST_NEXT_PLIES = 12, ST_NEXT_MOVES = 4, ST_KIND_MIN = 2, ST_KINDS = 3;
function stMistakes(list, color, move) {
  const sg = color === "white" ? 1 : -1, from = 2 * move, A = adv();
  let n = 0, hit = 0;
  const kinds = new Map();
  for (const x of list) {
    const z = S.acc[x.id];
    if (!z || z.v !== 2) continue;
    n++;
    const moves = x.g.moves.split(" ");
    for (let i = from; i < from + ST_NEXT_PLIES && i + 1 < z.ev.length && i < moves.length; i++) {
      if ((i % 2 === 0) !== (color === "white")) continue;
      const loss = sg * (z.ev[i] - z.ev[i + 1]);
      if (loss < A.mistake) continue;
      hit++;
      const kind = stMistakeKind(moves[i], gameKeys(x.g)[i]);
      const e = kinds.get(kind) || { kind, n: 0, ex: null };
      e.n++; if (!e.ex) e.ex = { id: x.id, ply: i }; kinds.set(kind, e);
      break;
    }
  }
  const sorted = [...kinds.values()].sort((a, b) => b.n - a.n);
  return { n, hit, kinds: sorted, top: sorted[0] || null };
}
/* The kind of a mistake, from the move itself (what was moved, not why it was bad). v0.9.50: captures
   say what took what, from the board before the move (keyBefore: GAMEKEYS, so up to move 20):
   a pawn taking, a piece taking a pawn, or a piece taking a piece (a trade, or winning or losing material). */
const ST_PIECE = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight" };
function stMistakeKind(san, keyBefore) {
  const sq = (san.match(/[a-h][1-8]/g) || []).pop(), file = sq ? sq[0] : "d";
  const wing = "abc".includes(file) ? "queenside" : "fgh".includes(file) ? "kingside" : "centre";
  if (san.startsWith("O-O")) return "castling";
  const piece = ST_PIECE[san[0]];
  if (san.includes("x")) {
    let took = "p"; // en passant leaves the square empty
    if (sq && keyBefore) { const ch = boardCells(keyBefore)[(8 - +sq[1]) * 8 + (sq.charCodeAt(0) - 97)]; if (ch) took = ch.toLowerCase(); }
    if (!piece) return took === "p" ? "pawn takes pawn" : "pawn takes a piece";
    return took === "p" ? "a piece takes a pawn" : "piece takes piece";
  }
  return piece ? `${piece} moves` : `pawn moves on the ${wing}`;
}
const ST_MISTAKE_HELP = "A mistake here is one of your moves that lost at least the mistake margin (Settings > Advanced) in the game's Stockfish analysis (depth 10); only the first one in each game counts. It's sorted by the move itself, so the kind says what you moved, not why it was bad: pawn moves (on the queenside a–c, in the centre d–e, or on the kingside f–h), a piece's move (knight, bishop, rook, queen, king), castling, or a capture: pawn takes pawn, pawn takes a piece, a piece takes a pawn (often grabbing a pawn that was poisoned, or opening lines for the opponent), or piece takes piece (a trade that gave something away, or taking a piece that wasn't free). Show a mistake opens one of those games at the mistake.";
function stNext(d, c, color, move) {
  const memo = "next";
  if (c[memo]) return c[memo];
  const games = d.games.filter(x => c.items.every(it => x.items.includes(it))), lines = [];
  let ex = null;
  const m = stMistakes(games, color, move), all = stMistakes(d.games, color, move);
  if (m.n >= 3) {
    const rate = m.hit / m.n, base = all.n ? all.hit / all.n : null;
    let t = `<b>${m.hit} of ${m.n}</b> analysed games had a mistake of yours in the next ${ST_NEXT_PLIES / 2} moves${base != null ? ` <span class="muted">(${pctOf(rate)}, against ${pctOf(base)} in all your games here)</span>` : ""}`;
    // v0.9.51: every kind in at least ST_KIND_MIN games, up to ST_KINDS, each opening one of its games at the mistake
    const top = m.kinds.filter(k => k.n >= ST_KIND_MIN).slice(0, ST_KINDS);
    if (top.length) {
      ex = top[0].ex;
      const rest = m.hit - top.reduce((s, k) => s + k.n, 0);
      t += `. Most often: ${top.map(k => `<button type="button" class="linkish" data-review="${esc(k.ex.id)}" data-rvat="${k.ex.ply}" aria-label="${esc(`Show a game with ${k.kind}`)}"><b>${esc(k.kind)}</b></button> (${k.n})`).join(", ")}${rest ? `, other kinds (${rest})` : ""}`;
    }
    lines.push(t + ".");
  }
  const later = move + ST_NEXT_MOVES;
  if (later <= 20) {
    const d2 = structAt(color, later), byId = new Map(d2.games.map(x => [x.id, x])), gained = new Map();
    let n2 = 0;
    for (const x of games) {
      const y = byId.get(x.id);
      if (!y) continue;
      n2++;
      for (const it of y.items) if (!x.items.includes(it)) { const e = gained.get(it) || { it, n: 0, sum: 0 }; e.n++; e.sum += y.sc; gained.set(it, e); }
    }
    const top = [...gained.values()].filter(e => e.n >= 2 && e.n >= 0.25 * n2).sort((a, b) => b.n - a.n)[0];
    if (top) lines.push(`By move ${later}, <b>${top.n} of ${n2}</b> games add <b>${comboText([top.it]).replace(/<[^>]+>/g, "")}</b>; you score ${pctOf(top.sum / top.n)} in them.`);
  }
  return (c[memo] = { html: lines.length ? `<div class="stnext"><span class="stwho">What happens next</span> ${info(ST_MISTAKE_HELP, "About the mistakes")}<ul>${lines.map(l => `<li>${l}</li>`).join("")}</ul></div>` : "", ex });
}
/* v0.9.43: a typical position for a structure, drawn small on its card. Its games are grouped by
   their pawns (every other piece left out); the group is the most common one, or for "worth your
   attention" the one costing most (games × the drop, at least 2 games). Within it, the most common
   exact position, and its newest game is the example (opened at that move). */
const stPawnsOf = k => boardCells(k).map(ch => (ch === "P" || ch === "p" ? ch : "")).join(",");
function stExample(d, c, costly) {
  const memo = costly ? "exCost" : "exPos";
  if (c[memo]) return c[memo];
  const games = d.games.filter(x => c.items.every(it => x.items.includes(it))), groups = new Map();
  for (const x of games) { const p = stPawnsOf(x.k); let e = groups.get(p); if (!e) groups.set(p, (e = { n: 0, sum: 0, games: [] })); e.n++; e.sum += x.sc; e.games.push(x); }
  const cost = e => e.n * (d.avg - shrink(e.sum, e.n, d.avg));
  const list = [...groups.values()];
  let pick = costly ? list.filter(e => e.n >= 2 && cost(e) > 0).sort((a, b) => cost(b) - cost(a))[0] : null;
  if (!pick) pick = list.sort((a, b) => b.n - a.n)[0];
  const keys = new Map();
  for (const x of pick.games) keys.set(x.k, (keys.get(x.k) || 0) + 1);
  const key = [...keys].sort((a, b) => b[1] - a[1])[0][0], ex = pick.games.find(x => x.k === key); // games are newest first
  return (c[memo] = { key, n: pick.n, sum: pick.sum, same: keys.get(key), ex: ex.id });
}
// A small static board for a position key, with the files a structure is about tinted
function miniBoard(key, flip, files) {
  const cells = boardCells(key);
  let h = "";
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const rr = flip ? 7 - r : r, ff = flip ? 7 - f : f, ch = cells[rr * 8 + ff], rank = 8 - rr;
    const p = ch ? { color: ch === ch.toUpperCase() ? "w" : "b", type: ch.toLowerCase() } : null;
    h += `<span class="sq${(ff + rank) % 2 === 1 ? " dk" : ""}${files.has(ff) ? " mk" : ""}">${p ? pieceHtml(p) : ""}</span>`;
  }
  return `<div class="board mini" aria-hidden="true">${h}</div>`;
}
function stMini(d, c, color, move, costly) {
  const x = stExample(d, c, costly), files = new Set(c.items.filter(it => !it.startsWith("c:")).map(it => +it.split(":")[2]));
  return `<div class="stmini">${miniBoard(x.key, color === "black", files)}</div>`;
}
// One key number with its label underneath
const stMetric = (big, small, cls) => `<span class="stm${cls ? " " + cls : ""}"><b>${big}</b><small>${small}</small></span>`;
// "52% (+4)" against my average, shrunk on few games
function stScoreMetric(c, d) {
  const diff = Math.round((shrink(c.sum, c.n, d.avg) - d.avg) * 100);
  return stMetric(pctOf(c.sum / c.n), `you score${Math.abs(diff) >= 2 ? ` (${diff > 0 ? "+" : "−"}${Math.abs(diff)})` : ""}`, diff >= 2 ? "good" : diff <= -2 ? "bad" : "");
}
const stExBtn = (d, c, move, costly) => `<button type="button" class="btn ghost quick" data-review="${esc(stExample(d, c, costly).ex)}" data-rvat="${2 * move}">Example</button>`;
const FEAT_WORD = { missing: f => `no ${f}-pawn`, isolated: f => `isolated ${f}-pawn`, doubled: f => `doubled ${f}-pawns`, backward: f => `backward ${f}-pawn`, passed: f => `passed ${f}-pawn` };
// ["c:fixed", "me:isolated:3", "them:missing:2"] -> "Fixed centre · You: isolated d-pawn · Them: no c-pawn"
function comboText(items) {
  const centre = items.find(it => it.startsWith("c:")), part = who => items.filter(it => it.startsWith(who + ":")).map(it => { const [, feat, f] = it.split(":"); return FEAT_WORD[feat]("abcdefgh"[+f]); });
  const me = part("me"), them = part("them"), bits = [];
  if (centre) { const c = CENTRES.find(([k]) => k === centre.slice(2)); bits.push(`<span class="stc">${esc(c ? c[1] : centre)} centre</span>`); }
  if (me.length) bits.push(`<span class="stwho">You</span> ${esc(me.join(", "))}`);
  if (them.length) bits.push(`<span class="stwho">Them</span> ${esc(them.join(", "))}`);
  return bits.join(" · ");
}
// "In 34% of games · I score 52% (+4)"
function stScore(c, d) {
  if (!c.n) return "";
  const sc = shrink(c.sum, c.n, d.avg), diff = Math.round((sc - d.avg) * 100);
  return `I score ${pctOf(c.sum / c.n)}${Math.abs(diff) >= 2 ? ` <span class="${diff > 0 ? "ok" : "bad"}">${diff > 0 ? "+" : "−"}${Math.abs(diff)}</span>` : ""}`;
}
const stTone = (c, d) => { if (!c.n) return ""; const diff = shrink(c.sum, c.n, d.avg) - d.avg; return diff >= 0.02 ? "good" : diff <= -0.02 ? "bad" : ""; };
function renderStructures(color) {
  const o = PIC.st, mv = o.move, d = structAt(color, mv);
  const stepper = `<div class="row ststep" style="gap:6px;align-items:center">${o.by ? "" : `<button type="button" class="btn ghost quick" data-pstmove="${mv - 2}" ${mv <= ST_MOVES[0] ? "disabled" : ""} aria-label="Earlier">◀</button><b>Move ${mv}</b><button type="button" class="btn ghost quick" data-pstmove="${mv + 2}" ${mv >= ST_MOVES[ST_MOVES.length - 1] ? "disabled" : ""} aria-label="Later">▶</button>`}
    ${picSeg("pstby", o.by ? "by" : "at", [["at", "At one move"], ["by", "By move"]], "Show")}</div>`;
  if (o.by) return stepper + structByMove(color);
  if (!d.n) return stepper + `<p class="help">None of your games as ${color} reach move ${mv}.</p>`;
  const share = c => pctOf(c.n / d.n), cb = stCombos(d);
  const comboRow = c => `<div class="stcombo ${stTone(c, d)}">${stBar(c, d)}<div class="sttop">${stMini(d, c, color, mv)}<div class="stcbody">
      <p class="stctext">${comboText(c.items)}</p>
      <div class="stms">${stMetric(share(c), `of games (${c.n})`)}${stScoreMetric(c, d)}</div></div></div>
      ${stFamsLine(stFams(d, c, mv))}
      <div class="stacts">${stExBtn(d, c, mv)}</div></div>`;
  const centre = CENTRES.filter(([k]) => d.centre[k].n).sort((a, b) => d.centre[b[0]].n - d.centre[a[0]].n).map(([k, name, help]) => {
    const c = d.centre[k];
    return `<div class="sttile2 ${stTone(c, d)}"><p class="stbig">${share(c)}</p><p class="stname">${esc(name)} ${info(help, "About " + name)}</p><p class="help">${stScore(c, d)}</p></div>`;
  }).join("");
  // v0.9.51: my score in each cell too, under the frequency: blue / orange against my average, faint on fewer than 5 games
  const scoreOf = c => !c.n ? "" : `<small class="stsc ${stTone(c, d)}${c.n < 5 ? " few" : ""}">${Math.round((c.sum / c.n) * 100)}%</small>`;
  const table = (who, title) => `<div class="stfeat"><p class="lbl">${title}</p>
    <div class="stfrow sthead"><span></span><span>Any</span>${[..."abcdefgh"].map(f => `<span>${f}</span>`).join("")}</div>
    ${FEATS.map(([k, name]) => {
      const row = d[who][k], max = Math.max(1, ...row.files.map(c => c.n));
      return `<div class="stfrow"><span class="stfname">${name} ${info(FEAT_HELP[k], "About " + name.toLowerCase())}</span>
        <span class="stany ${stTone(row.any, d)}" data-tip="${esc(`${title}: ${name.toLowerCase()} pawns in ${row.any.n} of ${d.n} games at move ${mv}; ${stScore(row.any, d).replace(/<[^>]+>/g, "")}`)}"><b>${share(row.any)}</b>${scoreOf(row.any)}</span>
        ${row.files.map((c, f) => c.n ? `<span class="stfc" style="--v:${Math.round((c.n / max) * 55)}%" data-tip="${esc(`${"abcdefgh"[f]}-file, ${name.toLowerCase()} (${who === "me" ? "yours" : "theirs"}): ${c.n} games (${share(c)}); ${stScore(c, d).replace(/<[^>]+>/g, "")}`)}"><span>${Math.round((c.n / d.n) * 100)}</span>${scoreOf(c)}</span>` : `<span class="stfc"></span>`).join("")}</div>`;
    }).join("")}</div>`;
  const list = (title, rows, help) => rows.length ? `<p class="lbl">${title}</p>${help ? `<p class="help">${help}</p>` : ""}<div class="stcombos">${rows.map(comboRow).join("")}</div>` : "";
  return stepper + `<p class="funbig"><b>${d.n}</b> <span class="help">games reached move ${mv}; you scored ${pctOf(d.avg)}</span></p>
    ${attentionHtml(d, color, mv)}
    ${list(`Your most common structures ${info(`Features that come up together at move ${mv}, in at least ${cb.minN} games; a game can have more than one. The small board is the most common position with that structure (in Worth your attention, the one costing you most), with the files it's about tinted. Your score is against your average, pulled towards it on few games. Example plays that game up to move ${mv}.`, "About these structures")}`, cb.common)}
    ${list("Where you score best", cb.best)}
    <p class="lbl">The centre</p><div class="sttiles2">${centre}</div>
    <details class="stdetail"><summary>Each indicator by file</summary>${table("me", "Your pawns")}${table("them", "Their pawns")}
      <p class="help">Top: the share of your games (%) with each at move ${mv}, by file (a to h). Under it: your score in those games, blue / orange when better / worse than your ${pctOf(d.avg)} average, faint on fewer than 5 games. Tap a cell for the numbers.</p></details>`;
}
// The shares from move 4 to 20: when structures form
function structByMove(color) {
  const ds = ST_MOVES.map(m => structAt(color, m));
  const cell = (pick, label) => `<div class="maprow"><span class="mapname">${label}</span>${ds.map((d, i) => {
    const c = d.n ? pick(d) : null;
    if (!c || !c.n) return `<span class="mc"></span>`;
    const v = c.n / d.n;
    return `<span class="mc cov pl${v >= 0.5 ? " dk" : ""}" style="--v:${Math.round(v * 100)}%" data-tip="${esc(`${label}, move ${ST_MOVES[i]}: ${c.n} of ${d.n} games (${pctOf(v)}); ${stScore(c, d).replace(/<[^>]+>/g, "")}`)}">${Math.round(v * 100)}</span>`;
  }).join("")}<span class="mapend"></span></div>`;
  const head = `<div class="maprow mhead"><span class="mapname">Move</span>${ST_MOVES.map(m => `<span class="mc mn">${m}</span>`).join("")}<span class="mapend"></span></div>`;
  return `<div class="covmap" style="--cols:${ST_MOVES.length}">${head}
      <div class="maprow mhead"><span class="mapname lbl">The centre</span></div>
      ${CENTRES.map(([k, name]) => cell(d => d.centre[k], name)).join("")}
      <div class="maprow mhead"><span class="mapname lbl">Your pawns</span></div>
      ${FEATS.map(([k, name]) => cell(d => d.me[k].any, name)).join("")}
      <div class="maprow mhead"><span class="mapname lbl">Their pawns</span></div>
      ${FEATS.map(([k, name]) => cell(d => d.them[k].any, name)).join("")}
    </div>
    <p class="help">The share of your games (%) with each at every second move, so you can see when structures form. Tap a cell for your score.</p>`;
}

/* ----- the tab ----- */
let picWaiting = false;
function renderPicture() {
  const box = $("#picPane");
  if (!box) return;
  const color = S.color;
  if (S.games.some(g => g.my === color && !GAMEKEYS.has(g.id))) {
    box.innerHTML = `<p class="help">Reading your games…</p>`;
    if (!picWaiting) { picWaiting = true; warmGameKeys(() => { picWaiting = false; if (S.view === "openings" && S.otab === "map" && mapView !== "map") renderPicture(); }); }
    return;
  }
  // The rings are SVG, not buttons, so the app's click listener doesn't see them
  box.onclick = e => {
    const t = e.target.closest("[data-picsun],[data-picsunup]");
    if (!t) return;
    const o = PIC.sun;
    if (t.dataset.picsunup != null) { if (!o.root.length) return; o.sel = o.root.join(" "); o.root = o.stack.pop() || []; }
    else o.sel = t.dataset.picsun;
    renderPicture();
    // v0.9.43: bring the board into the middle of the screen if it's partly off it (on phones it's under the rings)
    const b = $("#picBoard"), r = b && b.getBoundingClientRect();
    if (r && (r.top < 0 || r.bottom > innerHeight)) b.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
  };
  const v = PIC.view, body = v === "structures" ? renderStructures(color) : renderSun(color);
  box.innerHTML = (v === "structures" ? `<h3>Pawn structures ${info("How the pawns stand in your own games at a given move: the type of centre and each side's missing, isolated, doubled, backward and passed pawns by file, linked into structures: the features that come up together. Each figure is the share of your games, with your score in them against your average.", "About pawn structures")}</h3>` : `<h3>Your tree ${info("Your whole repertoire as rings of moves, one ring per move. A slice is as wide as how often you get there; colour it by your own score or the peers' score at your level. Tap a slice to see the position.", "About the tree")}</h3>`)
    + body;
  if (v === "tree") picShowBoard();
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("pscolor", d => { PIC.sun.color = d.pscolor; renderPicture(); }, true);
onClick("pswho", d => { PIC.sun.who = d.pswho; renderPicture(); }, true);
onClick("picsunin", d => { PIC.sun.stack.push(PIC.sun.root); PIC.sun.root = d.picsunin.split(" "); PIC.sun.sel = null; renderPicture(); }, true);
onClick("pstmove", d => { PIC.st.move = Math.max(ST_MOVES[0], Math.min(ST_MOVES[ST_MOVES.length - 1], +d.pstmove)); renderPicture(); }, true);
onClick("pstby", d => { PIC.st.by = d.pstby === "by"; renderPicture(); }, true);
