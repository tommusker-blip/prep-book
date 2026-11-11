"use strict";
/* ---------- Openings > Picture (v0.9.35, drafts): visual summaries of the repertoire ----------
   Food for thought rather than hard indicators. Five views, all from data the app already has
   (my games' position keys in GAMEKEYS, S.acc, the tree and cached Lichess data), so nothing
   new is fetched or analysed:
   - Squares: a heat map of where my (or the opponent's) pieces stand after move N in my games,
     or at the ends of my lines weighted by reach. "Score" colours each square by my score when
     a piece stands there, against my average, shrunk towards the average with adv().k.
   - Tree: a sunburst of my repertoire from the position chosen (rings = moves, width = how often
     I get there, colour = my score blended with peers', hatched = not prepared).
   - Fights: where captures happen in my games' openings.
   - Structures: the pawn structure after move N in my games (structureOf()), as tiles with
     games and score, and the plans for my side.
   - Clock: per opening family, time spent and centipawns lost on each of my moves, with the
     move where my games usually leave my prep outlined.
   Small samples: square and structure scores are shrunk, and cells with little data are faint.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const PIC = {
  view: "squares",
  sq: { src: "games", move: 10, side: "me", piece: "all", show: "where" },
  sun: { root: [], stack: [], sel: null, color: "score" },
  fight: { who: "all", upto: 15 },
  st: { move: 12 },
  clock: { show: "time" },
};
const PIC_RINGS = 8, PIC_PIECES = ["all", "p", "n", "b", "r", "q", "k"];
const PIECE_NAME = { all: "All", p: "Pawns", n: "Knights", b: "Bishops", r: "Rooks", q: "Queens", k: "King" };
const PIECE_ONE = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const picSeg = (name, cur, opts, label) => `<div class="seg small" role="group" aria-label="${esc(label)}">${opts.map(([v, t]) => `<button type="button" data-${name}="${esc(v)}" aria-pressed="${String(v) === String(cur)}">${esc(t)}</button>`).join("")}</div>`;
const sqName = i => "abcdefgh"[i % 8] + (8 - Math.floor(i / 8));
// The 64 squares of a position key's board, a8 first
function boardCells(key) {
  const out = [];
  for (const ch of key.split(" ")[0]) { if (ch === "/") continue; if (ch >= "1" && ch <= "8") for (let i = 0; i < +ch; i++) out.push(""); else out.push(ch); }
  return out;
}
const picSqIdx = sq => (8 - +sq[1]) * 8 + "abcdefgh".indexOf(sq[0]);
// My games of this colour with a result and their keys worked out
function picGames(color) { return S.games.filter(g => g.my === color && GAMEKEYS.has(g.id) && myScore(g) != null); }
const picMemo = new Map();
function picCached(name, sig, fn) { const m = picMemo.get(name); if (m && m.sig === sig) return m.out; const out = fn(); picMemo.set(name, { sig, out }); return out; }
const picSig = (...a) => [S.color, S.book, gamesSig(), GAMEKEYS.size, ...a].join("|");
// Shrink a score towards the average: few games say little
const shrink = (sum, n, avg) => (sum + adv().k * avg) / (n + adv().k);

/* A heat board. cells[i] (a8 first) = {a: 0..1 strength, tone: "good" | "bad" | "heat", txt, tip};
   drawn from my side, files and ranks along the edges. */
function heatBoard(cells, color) {
  const order = Array.from({ length: 64 }, (_, i) => (color === "black" ? 63 - i : i));
  const files = color === "black" ? "hgfedcba" : "abcdefgh";
  return `<div class="heat">${order.map(i => {
    const c = cells[i], light = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
    if (!c) return `<span class="hc${light ? " l" : ""}"></span>`;
    return `<span class="hc ${c.tone}${light ? " l" : ""}" style="--a:${Math.round(Math.min(1, c.a) * 85)}%" data-tip="${esc(c.tip)}">${c.txt ? esc(c.txt) : ""}</span>`;
  }).join("")}</div><div class="heatf">${[...files].map(f => `<span>${f}</span>`).join("")}</div>`;
}

/* ----- Squares ----- */
function squaresData(color) {
  const o = PIC.sq;
  return picCached("sq", picSig(o.src, o.move, o.side, o.piece, o.src === "tree" ? repSig(color) : ""), () => {
    const mineUpper = (o.side === "me") === (color === "white");
    const want = ch => ch && (mineUpper ? ch === ch.toUpperCase() : ch === ch.toLowerCase()) && (o.piece === "all" || ch.toLowerCase() === o.piece);
    const n = Array(64).fill(0), s = Array(64).fill(0), kinds = Array.from({ length: 64 }, () => ({}));
    let total = 0, sum = 0;
    const add = (key, w, sc) => {
      total += w; if (sc != null) sum += sc * w;
      boardCells(key).forEach((ch, i) => { if (!want(ch)) return; n[i] += w; if (sc != null) s[i] += sc * w; const p = ch.toLowerCase(); kinds[i][p] = (kinds[i][p] || 0) + w; });
    };
    if (o.src === "tree") {
      const idx = indexTree(color), { nodes } = walk(color);
      for (const [key, p] of Object.entries(idx)) if (nodes[key] && !nodes[key].kids.length) add(key, p.reach, null);
    } else {
      for (const g of picGames(color)) { const keys = gameKeys(g), k = keys[2 * o.move]; if (k) add(k, 1, myScore(g)); }
    }
    return { n, s, kinds, total, avg: total ? sum / total : 0.5 };
  });
}
function renderSquares(color) {
  const o = PIC.sq, d = squaresData(color), tree = o.src === "tree";
  if (tree && o.show === "score") o.show = "where";
  const who = o.side === "me" ? "your" : "the opponent's", what = o.piece === "all" ? "pieces" : PIECE_NAME[o.piece].toLowerCase();
  const when = tree ? "at the end of your lines" : `after move ${o.move}`;
  let body;
  if (!d.total) body = `<p class="help">${tree ? "Nothing in this repertoire yet." : `None of your games as ${color} reach move ${o.move} yet.`}</p>`;
  else {
    const max = Math.max(...d.n), N = tree ? null : Math.round(d.total);
    const cells = d.n.map((v, i) => {
      if (!v) return null;
      const share = v / d.total, top = Object.entries(d.kinds[i]).sort((a, b) => b[1] - a[1])[0][0];
      const piece = o.piece === "all" ? PIECE_ONE[top] : PIECE_ONE[o.piece];
      const where = tree ? `${sqName(i)}: ${who} ${piece} stands here in ${pctOf(share)} of where your lines end (weighted by how often you get there)`
        : `${sqName(i)}: ${who} ${piece} here in ${v} of ${N} games (${pctOf(share)})`;
      if (o.show === "where") return { a: v / max, tone: "heat", txt: share >= 0.1 ? Math.round(share * 100) : "", tip: where };
      if (v < 3) return null;
      const sc = shrink(d.s[i], v, d.avg), diff = sc - d.avg, raw = d.s[i] / v;
      return { a: Math.abs(diff) / 0.08, tone: diff >= 0 ? "good" : "bad", txt: Math.abs(diff) >= 0.02 ? (diff > 0 ? "+" : "−") + Math.round(Math.abs(diff) * 100) : "", tip: `${where}; you scored ${pctOf(raw)} in those games against ${pctOf(d.avg)} overall (${diff >= 0 ? "+" : "−"}${Math.round(Math.abs(diff) * 100)} after allowing for the number of games)` };
    });
    body = heatBoard(cells, color) + `<p class="help">${o.show === "where"
      ? `Where ${who} ${what} stand ${when}. Darker is more often; the number is the share of ${tree ? "your lines" : "games"} (shown from 10%).`
      : `Your score when ${who} ${what === "pieces" ? "pieces stand" : what + " stand"} on each square after move ${o.move}, against your average of ${pctOf(d.avg)}: blue better, orange worse, in points. Squares with few games are pulled towards your average, so they stay faint.`}</p>`;
  }
  return `<div class="picctl">
      ${picSeg("pqsrc", o.src, [["games", "My games"], ["tree", "My lines"]], "Source")}
      ${tree ? "" : picSeg("pqmove", o.move, [[6, "Move 6"], [10, "10"], [15, "15"], [20, "20"]], "After move")}
      ${picSeg("pqside", o.side, [["me", "My pieces"], ["opp", "Opponent's"]], "Whose pieces")}
      ${picSeg("pqpiece", o.piece, PIC_PIECES.map(p => [p, p === "all" ? "All" : PIECE_NAME[p]]), "Which pieces")}
      ${tree ? "" : picSeg("pqshow", o.show, [["where", "Where"], ["score", "Score"]], "Show")}
    </div>${body}`;
}

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
      out.push({ d, a0: a, a1: a + w, san: k.san, path: p, key: k.key, mine, games: myPosStats(k.key, color), peer: mv ? scoreFor(mv, color) : null, peerN: mv ? mv.n : 0 });
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
function renderSun(color) {
  const o = PIC.sun;
  let arcs = sunArcs(color, o.root);
  if (!arcs) { o.root = []; o.sel = null; arcs = sunArcs(color, []); }
  if (!arcs || !arcs.length) return `<p class="help">Nothing in your ${color} repertoire yet.</p>`;
  const ring = (PIC_R1 - PIC_R0) / PIC_RINGS, maxN = Math.max(1, ...arcs.map(a => (a.games ? a.games.n : 0)));
  const fill = a => {
    if (a.gap) return `fill="url(#picHatch)"`;
    if (o.color === "played") { const n = a.games ? a.games.n : 0; return n ? `style="fill:color-mix(in srgb,var(--good) ${Math.round(15 + 75 * Math.log1p(n) / Math.log1p(maxN))}%,var(--surface))"` : `style="fill:var(--line)"`; }
    const b = blended(a.games, a.peer);
    if (!b) return `style="fill:var(--line)"`;
    const diff = b.score - 0.5, k = Math.round(Math.min(1, Math.abs(diff) / 0.15) * 80) + 10;
    return `style="fill:color-mix(in srgb,var(${diff >= 0 ? "--good" : "--bad"}) ${k}%,var(--surface))"`;
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
  let info = `<p class="help">Tap a ring to see that line.</p>`;
  const a = sel != null ? arcs.find(x => arcId(x) === sel) : null;
  if (a && a.gap) {
    const at = a.path.join(" ");
    info = `<div class="sunsel"><p><b>${esc(at || "Start")}</b></p>
      <p class="help">${a.mine ? "Your move here isn't prepared." : a.rest ? `Not prepared: ${pctOf(a.rest)} of replies at your level here.` : "Your line ends here: no replies prepared."}</p>
      <div class="row" style="margin:0"><button type="button" class="btn ghost" data-open="${esc(at)}">Open in Build</button></div></div>`;
  } else if (a) {
    const name = (openingFor(a.path) || {}).name, b = blended(a.games, a.peer), kids = arcs.some(x => x.d === a.d + 1 && x.path.length > a.path.length && x.path.slice(0, a.path.length).join(" ") === sel);
    info = `<div class="sunsel"><p><b>${esc(a.path.join(" "))}</b>${name ? `<br><span class="help">${esc(name)}</span>` : ""}</p>
      <p class="help">${a.games ? `Your games: ${a.games.n}, scoring ${pctOf(wdlScore(a.games))}. ` : "None of your games here yet. "}${a.peer != null ? `Peers score ${pctOf(a.peer)} (${a.peerN} games). ` : ""}${b && a.games && a.peer != null ? `Together: ${pctOf(b.score)}.` : ""}</p>
      <div class="row" style="margin:0">${kids ? `<button type="button" class="btn" data-picsunin="${esc(sel)}">Zoom in here</button>` : ""}<button type="button" class="btn ghost" data-open="${esc(sel)}">Open in Build</button></div></div>`;
  }
  return `<div class="picctl">${picSeg("pscolor", o.color, [["score", "Score"], ["played", "Played"]], "Colour by")}</div>
    ${o.root.length ? `<p class="help">From <b>${esc(rootName)}</b> (${esc(o.root.join(" "))}). Tap the centre to back out.</p>` : ""}
    <div class="sunwrap">${svg}</div>${info}
    <p class="help">${o.color === "score" ? "Rings go outwards one move at a time; a slice is as wide as how often you get there (your own moves share their parent evenly). Blue: you score well there, orange: badly (your games blended with peers', so few games lean on the peers). Hatched: replies you haven't prepared, the holes in the tree." : "Darker slices are where more of your own games have gone. Hatched: replies you haven't prepared."} ${PIC_RINGS} moves are shown at a time.</p>`;
}

/* ----- Fights (captures) ----- */
function fightsData(color) {
  const o = PIC.fight;
  return picCached("fight", picSig(o.who, o.upto), () => {
    const n = Array(64).fill(0), any = Array(64).fill(0);
    let games = 0;
    for (const g of picGames(color)) {
      const mv = g.moves ? g.moves.split(" ") : [];
      if (!mv.length) continue;
      games++;
      const hit = new Set();
      for (let i = 0; i < Math.min(mv.length, 2 * o.upto); i++) {
        if (!mv[i].includes("x")) continue;
        const me = (i % 2 === 0) === (color === "white");
        if ((o.who === "me" && !me) || (o.who === "opp" && me)) continue;
        const m = mv[i].match(/([a-h][1-8])(=[QRBN])?[+#]?$/);
        if (!m) continue;
        const k = picSqIdx(m[1]); n[k]++; hit.add(k);
      }
      hit.forEach(k => any[k]++);
    }
    return { n, any, games };
  });
}
function renderFights(color) {
  const o = PIC.fight, d = fightsData(color);
  let body;
  if (!d.games) body = `<p class="help">No games as ${color} yet.</p>`;
  else {
    const max = Math.max(1, ...d.any);
    const cells = d.any.map((v, i) => (v ? { a: v / max, tone: "heat", txt: v / d.games >= 0.15 ? Math.round((v / d.games) * 100) : "", tip: `${sqName(i)}: a capture here by move ${o.upto} in ${v} of ${d.games} games (${pctOf(v / d.games)}), ${d.n[i]} captures in all` } : null));
    const top = d.any.map((v, i) => [v, i]).filter(x => x[0]).sort((a, b) => b[0] - a[0]).slice(0, 3);
    body = heatBoard(cells, color) + `<p class="help">Where ${o.who === "me" ? "you capture" : o.who === "opp" ? "your opponents capture" : "pieces are taken"} in the first ${o.upto} moves of your games as ${color}. The number is the share of games with a capture on that square (from 15%).${top.length ? ` Most fought over: ${top.map(([v, i]) => `${sqName(i)} (${pctOf(v / d.games)})`).join(", ")}.` : ""}</p>`;
  }
  return `<div class="picctl">${picSeg("pfwho", o.who, [["all", "All captures"], ["me", "Mine"], ["opp", "Theirs"]], "Whose captures")}
    ${picSeg("pfupto", o.upto, [[10, "To move 10"], [15, "15"], [20, "20"]], "Up to move")}</div>${body}`;
}

/* ----- Structures ----- */
function structData(color) {
  const o = PIC.st;
  return picCached("st", picSig(o.move), () => {
    const by = new Map();
    let total = 0, sum = 0;
    for (const g of picGames(color)) {
      const keys = gameKeys(g), k = keys[Math.min(2 * o.move, keys.length - 1)], s = structureOf(k), id = s ? s.id : "other", sc = myScore(g);
      total++; sum += sc;
      if (!by.has(id)) by.set(id, { s, n: 0, sum: 0, pawns: new Map() });
      const e = by.get(id), pk = pawnKey(k.split(" ")[0]);
      e.n++; e.sum += sc; e.pawns.set(pk, (e.pawns.get(pk) || 0) + 1);
    }
    return { list: [...by.values()].sort((a, b) => (a.s ? 0 : 1) - (b.s ? 0 : 1) || b.n - a.n), total, avg: total ? sum / total : 0.5 };
  });
}
// A small pawns-only board from a pawnKey (64 characters, a8 first)
function pawnBoard(pk, color) {
  const order = Array.from({ length: 64 }, (_, i) => (color === "black" ? 63 - i : i));
  return `<span class="pawnb">${order.map(i => { const c = pk[i], l = (Math.floor(i / 8) + (i % 8)) % 2 === 0; return `<i class="${l ? "l" : ""}${c === "P" ? " w" : c === "p" ? " b" : ""}"></i>`; }).join("")}</span>`;
}
function renderStructures(color) {
  const o = PIC.st, d = structData(color);
  if (!d.total) return `<div class="picctl">${picSeg("pstmove", o.move, [[8, "Move 8"], [12, "12"], [16, "16"], [20, "20"]], "After move")}</div><p class="help">No games as ${color} yet.</p>`;
  const tiles = d.list.map(e => {
    const top = [...e.pawns.entries()].sort((a, b) => b[1] - a[1])[0][0], share = e.n / d.total;
    const sc = shrink(e.sum, e.n, d.avg), diff = sc - d.avg, tone = Math.abs(diff) < 0.02 ? "" : diff > 0 ? "good" : "bad";
    const plans = e.s && e.s[color] ? `<details class="stplans"><summary>Plans for you</summary><ul>${e.s[color].map(t => `<li>${esc(t)}</li>`).join("")}</ul></details>` : "";
    return `<div class="sttile ${tone}" style="--w:${Math.round(share * 100)}%">${pawnBoard(top, color)}
      <div><p class="stname">${esc(e.s ? e.s.name : "Other structures")}</p>
      <p class="help">${e.n} game${e.n === 1 ? "" : "s"} (${pctOf(share)}) · you score ${pctOf(e.sum / e.n)}${tone ? ` <span class="${tone === "good" ? "ok" : "bad"}">${diff > 0 ? "+" : "−"}${Math.round(Math.abs(diff) * 100)}</span>` : ""}</p>
      <span class="stbar"></span>${plans}</div></div>`;
  }).join("");
  return `<div class="picctl">${picSeg("pstmove", o.move, [[8, "Move 8"], [12, "12"], [16, "16"], [20, "20"]], "After move")}</div>
    <div class="sttiles">${tiles}</div>
    <p class="help">The pawn structure after move ${o.move} in your games as ${color}, most common first; the board shows its most common pawn setup. The +/− is against your average of ${pctOf(d.avg)}, allowing for the number of games. "Other" is everything the app doesn't name yet.</p>`;
}

/* ----- Clock: time and accuracy by move, per opening family ----- */
const CLOCK_MOVES = 15;
const picFamMemo = new Map();
function gameFamily(g) {
  if (picFamMemo.has(g.id)) return picFamMemo.get(g.id);
  let name = "";
  for (const k of gameKeys(g).slice(0, 24)) { const b = bookName(k); if (b) name = b.name; }
  const f = name ? family(name) : "Unnamed";
  picFamMemo.set(g.id, f);
  return f;
}
function clockData(color) {
  return picCached("clock", picSig(accSig(), analysis(color).length), () => {
    const rows = new Map(), all = { name: `All your ${color === "white" ? "White" : "Black"} games`, n: 0, t: [], l: [], exit: [] };
    const exitOf = new Map(analysis(color).map(x => [x.g.id, x.a]));
    const off = color === "white" ? 0 : 1;
    for (const g of picGames(color)) {
      const f = gameFamily(g);
      if (!rows.has(f)) rows.set(f, { name: f, n: 0, t: [], l: [], exit: [] });
      const rs = [rows.get(f), all];
      const [base, inc] = (g.tcs || "").split("+").map(Number), acc = S.acc[g.id];
      const a = exitOf.get(g.id);
      rs.forEach(r => { r.n++; if (a) r.exit.push(Math.floor(a.ply / 2) + 1); });
      for (let m = 1; m <= CLOCK_MOVES; m++) {
        const i = 2 * (m - 1) + off;
        if (g.clk && g.clk[i] != null) {
          const before = i >= 2 ? g.clk[i - 2] : base;
          if (before != null && !isNaN(before)) { const spent = before - g.clk[i] + (inc || 0); if (spent >= 0 && spent < 600) rs.forEach(r => { (r.t[m - 1] = r.t[m - 1] || [0, 0]); r.t[m - 1][0] += spent; r.t[m - 1][1]++; }); }
        }
        if (acc && acc.ev && acc.ev[i + 1] != null && acc.ev[i] != null) {
          const loss = Math.max(0, Math.min(500, color === "white" ? acc.ev[i] - acc.ev[i + 1] : acc.ev[i + 1] - acc.ev[i]));
          rs.forEach(r => { (r.l[m - 1] = r.l[m - 1] || [0, 0]); r.l[m - 1][0] += loss; r.l[m - 1][1]++; });
        }
      }
    }
    const list = [...rows.values()].filter(r => r.n >= 5).sort((a, b) => b.n - a.n).slice(0, 10);
    const med = xs => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    return [all, ...list].map(r => ({ ...r, exitAt: med(r.exit) }));
  });
}
function renderClock(color) {
  const o = PIC.clock, rows = clockData(color);
  if (!rows[0].n) return `<p class="help">No games as ${color} yet.</p>`;
  const time = o.show === "time", cols = Array.from({ length: CLOCK_MOVES }, (_, i) => i + 1);
  const avg = x => (x && x[1] ? x[0] / x[1] : null);
  const cell = (r, m) => {
    const v = avg(time ? r.t[m - 1] : r.l[m - 1]), n = (time ? r.t[m - 1] : r.l[m - 1]) || [0, 0], ex = r.exitAt === m ? " to" : "";
    if (v == null) return `<span class="mc${ex}"></span>`;
    const a = time ? Math.min(1, v / 40) : Math.min(1, v / 80);
    return `<span class="mc cov pl${a > 0.55 ? " dk" : ""}${time ? "" : " loss"}${ex}" style="--v:${Math.round(a * 100)}%" data-tip="${esc(`${r.name}, move ${m}: ${time ? `${Math.round(v)} s on your move on average` : `you lose ${Math.round(v)} centipawns on average`} (${n[1]} games)${r.exitAt === m ? `; your games usually leave your prep here` : ""}`)}">${Math.round(v)}</span>`;
  };
  return `<div class="picctl">${picSeg("pcshow", o.show, [["time", "Time"], ["loss", "Accuracy"]], "Show")}</div>
    <div class="covmap ${time ? "" : "lossmap"}" style="--cols:${CLOCK_MOVES}">
      <div class="maprow mhead"><span class="mapname">Move</span>${cols.map(m => `<span class="mc mn">${m}</span>`).join("")}<span class="mapend">games</span></div>
      ${rows.map((r, i) => `<div class="maprow${i ? " d1" : ""}"><span class="mapname" title="">${esc(r.name)}</span>${cols.map(m => cell(r, m)).join("")}<span class="mapend">${r.n}</span></div>`).join("")}
    </div>
    <p class="help">${time ? "Seconds you spend on each of your moves, on average (games imported before clock times were read are left out). Darker is longer." : "Centipawns you lose on each of your moves, on average, from your games' analysis. Darker orange is worse."} The outlined cell is the move where your games in that opening usually leave your prep, so you can see whether the thinking, and the mistakes, start there.</p>`;
}

/* ----- the tab ----- */
const PIC_VIEWS = [["squares", "Squares"], ["tree", "Tree"], ["fights", "Fights"], ["structures", "Structures"], ["clock", "Clock"]];
let picWaiting = false;
function renderPicture() {
  const box = $("#picPane");
  if (!box) return;
  const color = S.color;
  if (S.games.some(g => g.my === color && !GAMEKEYS.has(g.id)) && PIC.view !== "tree") {
    box.innerHTML = `<p class="help">Reading your games…</p>`;
    if (!picWaiting) { picWaiting = true; warmGameKeys(() => { picWaiting = false; if (S.view === "openings" && S.otab === "pic") renderPicture(); }); }
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
  };
  const v = PIC.view, body = v === "tree" ? renderSun(color) : v === "fights" ? renderFights(color) : v === "structures" ? renderStructures(color) : v === "clock" ? renderClock(color) : renderSquares(color);
  box.innerHTML = `<h3>Your repertoire in pictures ${info("Drafts: ways of looking at your repertoire and your games, more food for thought than hard numbers. Squares: where pieces stand, and how you score when they do. Tree: your whole repertoire as rings of moves. Fights: where pieces get taken. Structures: the pawn structures you end up in. Clock: time and accuracy move by move in each opening. Nothing new is fetched: it uses your games, their analysis and the Lichess data already loaded.", "About pictures")}</h3>
    <div class="picviews">${picSeg("picview", v, PIC_VIEWS, "Picture")}</div>${body}`;
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("picview", d => { PIC.view = d.picview; renderPicture(); }, true);
onClick("pqsrc", d => { PIC.sq.src = d.pqsrc; renderPicture(); }, true);
onClick("pqmove", d => { PIC.sq.move = +d.pqmove; renderPicture(); }, true);
onClick("pqside", d => { PIC.sq.side = d.pqside; renderPicture(); }, true);
onClick("pqpiece", d => { PIC.sq.piece = d.pqpiece; renderPicture(); }, true);
onClick("pqshow", d => { PIC.sq.show = d.pqshow; renderPicture(); }, true);
onClick("pscolor", d => { PIC.sun.color = d.pscolor; renderPicture(); }, true);
onClick("picsunin", d => { PIC.sun.stack.push(PIC.sun.root); PIC.sun.root = d.picsunin.split(" "); PIC.sun.sel = null; renderPicture(); }, true);
onClick("pfwho", d => { PIC.fight.who = d.pfwho; renderPicture(); }, true);
onClick("pfupto", d => { PIC.fight.upto = +d.pfupto; renderPicture(); }, true);
onClick("pstmove", d => { PIC.st.move = +d.pstmove; renderPicture(); }, true);
onClick("pcshow", d => { PIC.clock.show = d.pcshow; renderPicture(); }, true);
