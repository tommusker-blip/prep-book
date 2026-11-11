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
  sun: { root: [], stack: [], sel: null, color: "mine" },
  st: { move: 12 },
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
const SUN_COLOURS = [["mine", "My score"], ["peers", "Peers' score"]];
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
      <p class="help">My games: ${a.games && a.games.n ? `${a.games.n}, I score ${pctOf(wdlScore(a.games))} (${a.games.w} won, ${a.games.d} drawn, ${a.games.l} lost)` : "none yet"}.<br>Peers at my level: ${a.peer != null ? `${a.peerN.toLocaleString("en-GB")} games, my side scores ${pctOf(a.peer)}` : "no data loaded"}.</p>
      <div class="row" style="margin:0">${kids ? `<button type="button" class="btn" data-picsunin="${esc(sel)}">Zoom in here</button>` : ""}<button type="button" class="btn ghost" data-open="${esc(sel)}">Open in Build</button></div></div>`;
  }
  const key = { mine: "Blue: you score well there in your own games; orange: badly. Faint: few games; grey: none.", peers: "Blue: players of your colour at your level score well there on Lichess; orange: badly. Faint: few games." }[o.color] || "";
  return `<div class="picctl">${picSeg("pscolor", o.color, SUN_COLOURS, "Colour by")}</div>
    ${o.root.length ? `<p class="help">From <b>${esc(rootName)}</b>. Tap the centre to back out.</p>` : ""}
    <div class="conwrap"><div class="sunwrap">${svg}</div>${side}</div>
    <p class="help">${key} Each ring is a move; a slice is as wide as how often you get there. Hatched: replies you haven't prepared. Score counts a draw as half.</p>`;
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

/* ----- Structures ----- */
// The centre pawns (files c to f) of both sides, for structures the app doesn't name
function centreOf(cells) {
  const w = [], b = [];
  cells.forEach((ch, i) => { const f = i % 8; if (f < 2 || f > 5) return; const sq = "abcdefgh"[f] + (8 - Math.floor(i / 8)); if (ch === "P") w.push(sq); else if (ch === "p") b.push(sq); });
  const srt = a => a.sort().join(" ") || "none";
  return `White ${srt(w)} · Black ${srt(b)}`;
}
const ST_MIN = 3; // games for an unnamed centre to get its own tile
function structData(color) {
  const o = PIC.st;
  return picCached("st", picSig(o.move), () => {
    const by = new Map();
    let total = 0, sum = 0;
    for (const g of picGames(color)) {
      const keys = gameKeys(g), k = keys[Math.min(2 * o.move, keys.length - 1)], cells = boardCells(k), s = structureOf(k), sc = myScore(g);
      const id = s ? s.id : "c:" + centreOf(cells);
      total++; sum += sc;
      if (!by.has(id)) by.set(id, { s, name: s ? s.name : centreOf(cells), named: !!s, n: 0, sum: 0, pawns: new Map() });
      const e = by.get(id), pk = cells.map(ch => (ch === "P" || ch === "p" ? ch : ".")).join("");
      e.n++; e.sum += sc; e.pawns.set(pk, (e.pawns.get(pk) || 0) + 1);
    }
    // unnamed centres with few games go together as "Other"
    const list = [], other = { s: null, name: "Other structures", named: false, other: true, n: 0, sum: 0, pawns: new Map() };
    for (const e of by.values()) {
      if (e.named || e.n >= ST_MIN) { list.push(e); continue; }
      other.n += e.n; other.sum += e.sum; e.pawns.forEach((v, pk) => other.pawns.set(pk, (other.pawns.get(pk) || 0) + v));
    }
    list.sort((a, b) => b.n - a.n);
    if (other.n) list.push(other);
    return { list, total, avg: total ? sum / total : 0.5 };
  });
}
// A small pawns-only board (64 characters, a8 first)
function pawnBoard(pk, color) {
  const order = Array.from({ length: 64 }, (_, i) => (color === "black" ? 63 - i : i));
  return `<span class="pawnb">${order.map(i => { const c = pk[i], l = (Math.floor(i / 8) + (i % 8)) % 2 === 0; return `<i class="${l ? "l" : ""}${c === "P" ? " w" : c === "p" ? " b" : ""}"></i>`; }).join("")}</span>`;
}
function renderStructures(color) {
  const o = PIC.st, d = structData(color), moves = picSeg("pstmove", o.move, [[8, "Move 8"], [12, "12"], [16, "16"], [20, "20"]], "After move");
  if (!d.total) return `<div class="picctl">${moves}</div><p class="help">No games as ${color} yet.</p>`;
  const tiles = d.list.map(e => {
    const top = [...e.pawns.entries()].sort((a, b) => b[1] - a[1])[0][0], share = e.n / d.total;
    const sc = shrink(e.sum, e.n, d.avg), diff = sc - d.avg, tone = Math.abs(diff) < 0.02 ? "" : diff > 0 ? "good" : "bad";
    const plans = e.s && e.s[color] ? `<details class="stplans"><summary>Plans for you</summary><ul>${e.s[color].map(t => `<li>${esc(t)}</li>`).join("")}</ul></details>` : "";
    return `<div class="sttile ${tone}" style="--w:${Math.round(share * 100)}%">${e.other ? `<span class="pawnb none"></span>` : pawnBoard(top, color)}
      <div><p class="stname">${esc(e.name)}</p>
      <p class="help">${e.n} of my games (${pctOf(share)}) · I score ${pctOf(e.sum / e.n)}${tone ? ` <span class="${tone === "good" ? "ok" : "bad"}">${diff > 0 ? "+" : "−"}${Math.round(Math.abs(diff) * 100)}</span>` : ""}</p>
      <span class="stbar"></span>${plans}</div></div>`;
  }).join("");
  return `<div class="picctl">${moves}</div>
    <div class="sttiles">${tiles}</div>
    <p class="help">The pawn structure after move ${o.move} in your own games as ${color}, most common first; the board is its most common pawn setup. Named structures come with plans. The rest are grouped by the centre pawns (files c to f), and those with fewer than ${ST_MIN} games are under Other. The +/− is your score against your average of ${pctOf(d.avg)}, allowing for the number of games.</p>`;
}

/* ----- the tab ----- */
const PIC_VIEWS = [["tree", "Tree"], ["structures", "Structures"]];
let picWaiting = false;
function renderPicture() {
  const box = $("#picPane");
  if (!box) return;
  const color = S.color;
  if (S.games.some(g => g.my === color && !GAMEKEYS.has(g.id))) {
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
  const v = PIC.view, body = v === "structures" ? renderStructures(color) : renderSun(color);
  box.innerHTML = `<h3>Your repertoire in pictures ${info("Drafts, more food for thought than hard numbers. Tree: your whole repertoire as rings of moves, coloured by your own score or the peers' score; tap a slice to see the position. Structures: the pawn structures your games end up in, with your score in each. Nothing new is fetched: it uses your games and the Lichess data already loaded.", "About pictures")}</h3>
    <div class="picviews">${picSeg("picview", v, PIC_VIEWS, "Picture")}</div>${body}`;
  if (v === "tree") picShowBoard();
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("picview", d => { PIC.view = d.picview; renderPicture(); }, true);
onClick("pscolor", d => { PIC.sun.color = d.pscolor; renderPicture(); }, true);
onClick("picsunin", d => { PIC.sun.stack.push(PIC.sun.root); PIC.sun.root = d.picsunin.split(" "); PIC.sun.sel = null; renderPicture(); }, true);
onClick("pstmove", d => { PIC.st.move = +d.pstmove; renderPicture(); }, true);
