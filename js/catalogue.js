"use strict";
/* ---------- opening catalogue (v0.9.4) ----------
   The repertoire for one colour as a short tree of key branches, not every line:
   - a new entry where the opening name changes (OPENINGS / BOOK, e.g. Sicilian → Najdorf)
   - a new entry at a major split without a new name: an opponent position where two or more
     prepared replies each carry at least CAT_SPLIT of the entry's reach, or a position where I
     have more than one move ("with 5. Bc4")
   A named entry with a single child that covers nearly all of it is folded into that child (so
   "King's Pawn Game" → "Italian Game" → "Giuoco Piano" doesn't make three nested rows of one).
   At most CAT_DEPTH levels.
   Each entry gets: coverage to move coverTo() (1 − the reach of the gaps under it up to that move ÷ its own reach, from
   findGaps()), my score from my games through it, my accuracy in book and just after
   (analysis v2), training cards learned and due, and a one-line comment. */
const CAT_SPLIT = 0.2, CAT_DEPTH = 5;
/* Coverage (v0.9.24) is counted up to a move (Settings > Building your tree, default 10): every
   line has to stop somewhere, so gaps past that move don't count. Before, the replies after the
   last move of every line counted as gaps, so a deep, complete-looking opening could show 0%. */
const COVER_MOVES = 15;
const coverTo = () => Math.max(2, Math.min(COVER_MOVES, S.settings.coverTo || 10));
const catOpen = new Set(); // paths of expanded entries (this session)

function buildCatalogue(color = S.color) {
  const { nodes } = walk(color), R = rep(color), idx = indexTree(color);
  const reachOf = key => (idx[key] ? idx[key].reach : 0);
  const nameAt = key => { const b = bookName(key); return b ? { eco: b.eco, name: b.name } : null; };
  const root = { path: [], key: K(START), label: "", name: "", eco: "", reach: 1, children: [], depth: 0 };
  // Follow each position only along its own (shortest) path, so a transposition isn't listed twice
  const own = (key, path) => nodes[key] && nodes[key].path.length === path.length && nodes[key].path.join(" ") === path.join(" ");
  const visit = (key, path, cat) => {
    const node = nodes[key];
    if (!node) return;
    const mine = isMine(key, color), n = R.pos[key], kids = node.kids.filter(k => own(k.key, path.concat(k.san)));
    // A split at this position: my options, or the opponent's main prepared replies
    const big = kids.filter(k => reachOf(k.key) >= CAT_SPLIT * cat.reach);
    const split = cat.depth < CAT_DEPTH && ((mine && n && n.m.length > 1) || (!mine && big.length >= 2));
    for (const kid of kids) {
      const p = path.concat(kid.san), nm = nameAt(kid.key);
      let next = cat;
      if (cat.depth < CAT_DEPTH && nm && nm.name !== cat.name) {
        next = { path: p, key: kid.key, label: nm.name, name: nm.name, eco: nm.eco, named: true, reach: reachOf(kid.key), children: [], depth: cat.depth + 1 };
      } else if (split && (mine || big.includes(kid))) {
        next = { path: p, key: kid.key, label: (mine ? "with " : "after ") + moveLabel(path, kid.san), name: cat.name, eco: cat.eco, reach: reachOf(kid.key), children: [], depth: cat.depth + 1 };
      }
      if (next !== cat) cat.children.push(next);
      visit(kid.key, p, next);
    }
  };
  visit(root.key, [], root);
  // Fold a named entry into its only child when the child covers nearly all of it
  const fold = c => {
    c.children = c.children.map(fold);
    if (c !== root && c.children.length === 1 && c.children[0].named && c.children[0].reach >= 0.9 * c.reach) return { ...c.children[0], depth: c.depth };
    return c;
  };
  fold(root);
  // A child named the same as its parent (the dataset reuses names) is labelled by its moves
  const relabel = c => c.children.forEach(k => {
    if (k.named && k.name === c.name) { k.label = numbered(c.path.length, k.path.slice(c.path.length)); k.named = false; }
    else if (k.named && c.name && (k.name.startsWith(c.name + ": ") || k.name.startsWith(c.name + ", "))) k.label = k.name.slice(c.name.length + 2); // "Sicilian Defence: Open" under "Sicilian Defence" reads "Open"
    relabel(k);
  });
  relabel(root);
  groupByFamily(root, color);
  const sortKids = c => { c.children.sort((a, b) => b.reach - a.reach); c.children.forEach(sortKids); };
  sortKids(root);
  return root;
}
/* ----- top level by opening family (v0.9.6) -----
   The tree starts from the first move, so on its own everything sits under "King's Pawn Game"
   or "Queen's Pawn Game". Generic move-order names like those are skipped (their entries are
   replaced by their children), then the top level is grouped by family, the part of the name
   before the colon: "Sicilian Defence: Open" and "Sicilian Defence: Alapin" go under one
   "Sicilian Defence" entry, starting where their moves part. Lines of mine left only in a
   generic entry are kept as "<name>: other lines". */
const CAT_GENERIC = /^(King's Pawn Game|Queen's Pawn Game|King's Knight Opening|Queen's Knight Opening|Indian Defence|Zukertort Opening|Van't Kruijs Opening|Mieses Opening)$/;
const familyOf = c => { const n = c.named ? c.name : ((openingFor(c.path) || {}).name || ""); return n.split(":")[0].trim(); };
function groupByFamily(root, color) {
  const { nodes } = walk(color);
  // Line ends (leaves of the tree) under a path: a generic entry keeps an "other lines" entry
  // only for lines that end outside all of its children, not for the moves leading into them
  const endsUnder = ps => Object.values(nodes).filter(v => { const p = v.path.join(" "); return !v.kids.length && (p === ps || p.startsWith(ps + " ")); }).length;
  const promote = list => list.flatMap(c => {
    if (!CAT_GENERIC.test(familyOf(c)) || !c.children.length) return [c];
    const kids = promote(c.children), own = endsUnder(c.path.join(" ")) - c.children.reduce((s, k) => s + endsUnder(k.path.join(" ")), 0);
    return own > 0 ? [...kids, { ...c, children: [], label: `${familyOf(c)}: other lines`, other: true }] : kids;
  });
  const top = promote(root.children), fams = new Map();
  for (const c of top) { const f = familyOf(c) || c.label; if (!fams.has(f)) fams.set(f, []); fams.get(f).push(c); }
  root.children = [...fams.entries()].map(([f, list]) => {
    if (list.length === 1) return list[0];
    // several entries of one family: a group starting where their moves part
    let n = 0;
    while (list.every(c => c.path.length > n && c.path[n] === list[0].path[n])) n++;
    const path = list[0].path.slice(0, n), key = K(fenAfter(START, path));
    const b = bookName(key);
    list.forEach(c => { if (c.label.startsWith(f + ": ")) c.label = c.label.slice(f.length + 2); });
    return { path, key, label: f, name: f, eco: (b && b.eco) || list[0].eco, named: true, reach: list.reduce((s, c) => s + c.reach, 0), children: list, depth: 1 };
  });
}

/* ----- numbers for every entry -----
   catalogueContext() gathers what all entries share (tree, gaps, games) once; statNode() does
   one entry. The page runs statNode() in small steps with a progress bar, and keeps the result
   until the tree, games, analysis or Lichess data change (catSig). */
/* Coverage share (v0.9.24): like reach (indexTree()), but where I have several moves the games
   are split evenly between them too, so a position with 1.e4 and 1.d4 doesn't count every game
   twice. Gaps are rescaled to it: share(position) ÷ reach(position) × the gap's reach. */
function coverShare(color = S.color) {
  const { nodes } = walk(color), idx = indexTree(color), out = {}, q = [[K(START), 1]];
  while (q.length) {
    const [key, sh] = q.shift(), node = nodes[key];
    if (key in out || !node) continue;
    out[key] = sh;
    const mine = isMine(key, color), r = idx[key] ? idx[key].reach : 0;
    for (const kid of node.kids) {
      const rk = idx[kid.key] ? idx[kid.key].reach : 0;
      q.push([kid.key, mine ? sh / node.kids.length : r > 0 ? sh * Math.min(1, rk / r) : 0]);
    }
  }
  return out;
}
function catalogueContext(color = S.color) {
  return {
    color, R: rep(color), now: Date.now(),
    tree: Object.entries(indexTree(color)).map(([key, v]) => ({ key, ps: v.path.join(" ") })),
    cr: coverShare(color),
    gaps: (() => { const idx = indexTree(color), cr = coverShare(color); return findGaps(color).map(g => { const k = g.id.split("|")[1], r = idx[k] ? idx[k].reach : 0; return { ps: g.path.join(" "), f: (g.freq || 0) * (r > 0 && cr[k] != null ? cr[k] / r : 1), mv: gapMoveNo(g) }; }); })(),
    exits: new Map(analysis(color).map(x => [x.g.id, { mv: Math.floor(x.a.ply / 2) + 1, s: x.s }])),
    games: ideaGameSets(color),
  };
}
const catUnder = (ps, x) => !ps || x === ps || x.startsWith(ps + " ");
function statNode(c, ctx) {
  const ps = c.path.join(" ");
  const cards = ctx.tree.filter(t => catUnder(ps, t.ps)).map(t => ctx.R.cards[t.key]).filter(Boolean);
  // Coverage by move (v0.9.24): curve[m] = the share of games at your level through this entry
  // still in your prep after move m+1 (gaps at that move or before take their share off)
  const under = ctx.gaps.filter(g => catUnder(ps, g.ps)), curve = [];
  const share = c.path.length ? (ctx.cr[c.key] != null ? ctx.cr[c.key] : 0) : 1;
  for (let m = 1; m <= COVER_MOVES; m++) curve.push(share > 0 ? Math.max(0, Math.min(1, 1 - under.filter(g => g.mv <= m).reduce((s, g) => s + g.f, 0) / share)) : null);
  // My results by the move where my games through it left my prep: [{n, s}] per move
  const exits = [];
  const me = c.path.length ? myPosStats(c.key, ctx.color) : null;
  const inb = [], post = [];
  for (const x of ctx.games) {
    if (c.path.length && !x.keys.has(c.key)) continue;
    const ex = ctx.exits.get(x.g.id);
    if (ex && ex.s != null) { const i = Math.min(COVER_MOVES, ex.mv) - 1, e = exits[i] || (exits[i] = { n: 0, s: 0 }); e.n++; e.s += ex.s; }
    if (c.path.length && x.a && x.a.v === 2) { if (x.a.inb) inb.push(...x.a.inb); if (x.a.post) post.push(...x.a.post); }
  }
  const avg = a => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : null);
  c.stats = {
    cover: curve[coverTo() - 1], curve, exits: Array.from({ length: COVER_MOVES }, (_, i) => exits[i] || null),
    positions: cards.length, learned: cards.filter(k => k.reps >= 2).length, due: cards.filter(k => k.due <= ctx.now).length,
    games: me ? me.n : 0, score: me && me.n ? wdlScore(me) : null, wdl: me,
    accIn: avg(inb), accOut: avg(post),
  };
  c.comment = catComment(c.stats);
}
const catNodes = root => { const out = [], walkC = c => { out.push(c); c.children.forEach(walkC); }; root.children.forEach(walkC); return out; };
// All at once (tests, and small trees)
function catalogueStats(root, color = S.color) {
  const ctx = catalogueContext(color);
  catNodes(root).forEach(c => statNode(c, ctx));
  return root;
}
// One plain sentence about an entry
function catComment(s) {
  const parts = [];
  const cov = s.cover == null ? "" : s.cover >= 0.85 ? "Well covered" : s.cover >= 0.6 ? "Mostly covered" : s.cover >= 0.3 ? "Partly prepared" : "Thin, with big gaps";
  if (cov) parts.push(cov);
  if (s.games < 3) parts.push(s.games ? `only ${s.games} of your games get here` : "none of your games get here yet");
  else if (s.score >= 0.55) parts.push(`you score well (${pctOf(s.score)} in ${s.games} games)`);
  else if (s.score <= 0.42) parts.push(`your results are poor (${pctOf(s.score)} in ${s.games} games)`);
  else parts.push(`results are about even (${pctOf(s.score)} in ${s.games} games)`);
  if (s.accIn != null) parts.push(s.accOut != null && s.accOut < s.accIn - 10 ? `accuracy ${s.accIn} in book but ${s.accOut} just after` : `accuracy ${s.accIn} in book`);
  let advice = "";
  if (s.cover != null && s.cover < 0.6) advice = "Fill the gaps first.";
  else if (s.games >= 5 && s.score <= 0.42) advice = "Worth more training, or a rethink.";
  else if (s.due) advice = `${s.due} position${s.due === 1 ? "" : "s"} due for training.`;
  return parts.join("; ").replace(/^./, x => x.toUpperCase()) + "." + (advice ? " " + advice : "");
}

/* ----- the page -----
   Kept per prep book and colour, in memory and in IndexedDB (cat:<space>:<book>:<colour>), so
   the page opens at once, even in a new session. The last result is always drawn straight
   away; if the tree, games or analysis have changed since (catSig), it's worked out again in
   the background in small steps, with a thin progress bar above the old entries. New Lichess
   data doesn't trigger that on its own (it arrives all the time): Recalculate does. */
let catMemo = {}, catJob = null, catLoaded = {};
const catStoreKey = color => "cat:" + (typeof Games !== "undefined" && Games.space ? Games.space() : "local") + ":" + S.book + ":" + color;
const catSig = color => [S.book, color, walk(color).sig, bandKey(), contentSig(), coverTo()].join("|");
const catCurrent = () => catMemo[catStoreKey(S.color)] || null;
async function renderCatalogue(force) {
  const box = $("#catBody");
  if (!box) return;
  const color = S.color, C = color === "white" ? "White" : "Black", sk = catStoreKey(color);
  $("#catHead").textContent = `Your ${C} openings · ${prepBookName()}`;
  // A saved result from an earlier session: read it once
  if (!catMemo[sk] && !catLoaded[sk] && typeof IDB !== "undefined") {
    catLoaded[sk] = true;
    if (!box.innerHTML.trim()) box.innerHTML = `<p class="help">Loading your openings…</p>`;
    try { const saved = await IDB.get(sk); if (saved && saved.v === 2 && saved.root && !catMemo[sk]) catMemo[sk] = saved; } catch (e) { /* worked out below */ }
    if (S.view !== "openings" || S.color !== color) return;
  }
  const sig = catSig(color), memo = catMemo[sk];
  if (memo) { drawCatalogue(memo.root, memo.targets); if (S.otab === "map") renderCoverMap(true); }
  if (memo && memo.sig === sig && !force) { catJob = null; drawCatProgress(); return; }
  if (catJob && catJob.sig === sig && catJob.sk === sk && !force) { drawCatProgress(); return; } // already on it
  startCatalogueJob(sig, color, sk);
}
function drawCatProgress() {
  const bar = $("#catProg"), j = catJob, memo = catCurrent();
  if (!bar) return;
  const undo = undoNote("cat");
  if (j && j.sk === catStoreKey(S.color)) {
    bar.innerHTML = undo + `<p class="help" aria-live="polite">${memo ? "Updating… " : ""}${esc(j.step)}${j.total ? ` ${j.done} of ${j.total}` : ""}</p><progress max="${j.total || 1}" value="${j.done}"></progress>`;
    return;
  }
  bar.innerHTML = undo + (memo ? `<p class="help catwhen">Worked out ${esc(agoText(memo.at))}. <button type="button" class="btn ghost quick" data-catrecalc>Recalculate</button>${info("Kept so the page opens at once. It's worked out again by itself when your tree, games or analysis change. Recalculate also picks up new Lichess data (coverage), for example after Scan my tree.", "About this page")}</p>` : "");
}
function agoText(t) {
  const m = Math.round((Date.now() - (t || 0)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}
function startCatalogueJob(sig, color, sk) {
  const job = catJob = { sig, sk, step: "Reading your games…", done: 0, total: 0 };
  drawCatProgress();
  const alive = () => catJob === job;
  const finish = (root, targets) => {
    const memo = catMemo[sk] = { v: 2, sig, root, targets, at: Date.now() };
    catJob = null;
    if (typeof IDB !== "undefined") IDB.set(sk, memo).catch(() => {});
    if (S.view === "openings" && catStoreKey(S.color) === sk) { drawCatalogue(root, targets); drawCatProgress(); if (S.otab === "map") renderCoverMap(true); }
  };
  const go = () => {
    if (!alive()) return;
    const root = buildCatalogue(color), nodes = catNodes(root);
    if (!nodes.length) { finish(root, []); return; }
    const ctx = catalogueContext(color);
    Object.assign(job, { step: "Working out your openings…", done: 0, total: nodes.length });
    drawCatProgress();
    let i = 0;
    const step = () => {
      if (!alive()) return;
      const end = performance.now() + 25;
      while (i < nodes.length && performance.now() < end) statNode(nodes[i++], ctx);
      job.done = i;
      if (i < nodes.length) { drawCatProgress(); setTimeout(step, 0); return; }
      statNode(root, ctx); noteProgress(color, root.stats);
      finish(root, ideaTargets(color)); // targets once for every entry's "Typical ideas"
    };
    setTimeout(step, 0);
  };
  if (warming || S.games.some(g => !GAMEKEYS.has(g.id))) warmGameKeys(() => setTimeout(go, 0)); else setTimeout(go, 0);
}
function drawCatalogue(root, targets) {
  const box = $("#catBody"), C = S.color === "white" ? "White" : "Black";
  if (!root.children.length) { box.innerHTML = `<p class="help">Nothing in your ${C} repertoire yet. Add moves in Build, or use Build my tree from my games on the Games tab.</p>`; return; }
  const bi = branchInfo(S.color), fp = focusPath().join(" ");
  /* v0.9.24: compact. One line per entry: the name (up to two lines, so long names show), then
     covered and score in fixed columns under one header; the moves, accuracy, comment and the
     buttons are inside. Build / Train set the focus (focus.js). */
  // A child named like its parent shows only the new part ("Accepted: King's Knight's Gambit" under King's Gambit)
  const short = (label, parent) => {
    if (!parent) return label;
    for (const sep of [": ", ", ", " "]) if (label.startsWith(parent + sep) && label.length > parent.length + sep.length) return label.slice(parent.length + sep.length).replace(/^./, x => x.toUpperCase());
    return label;
  };
  const entry = (c, parent) => {
    const s = c.stats || {}, ps = c.path.join(" "), open = catOpen.has(ps), canTrain = bi[c.key] && bi[c.key].cards;
    const scoreCls = s.score == null || s.games < 3 ? "" : s.score >= 0.55 ? "good" : s.score <= 0.42 ? "bad" : "";
    const covCls = s.cover == null ? "" : s.cover < 0.6 ? "bad" : s.cover >= 0.85 ? "good" : "";
    const focused = fp && fp === ps;
    return `<details class="cat${focused ? " focused" : ""}"${open ? " open" : ""} data-catpath="${esc(ps)}">
      <summary>
        <span class="catname">${esc(short(c.label, parent))}</span>
        <span class="catn ${covCls}"><i style="width:${s.cover == null ? 0 : Math.round(s.cover * 100)}%"></i><b>${s.cover == null ? "–" : pctOf(s.cover)}</b></span>
        <span class="catn ${scoreCls}"><b>${s.score == null ? "–" : pctOf(s.score)}</b>${s.games ? `<small>${s.games}</small>` : ""}</span>
      </summary>
      <div class="catbody">
        <p class="catline mono">${c.named && c.eco ? `<span class="eco">${esc(c.eco)}</span> ` : ""}${esc(numbered(0, c.path))}</p>
        <p class="help">${esc(c.comment || "")}${s.positions ? ` ${s.learned} of ${s.positions} of your moves learned.` : ""}</p>
        <div class="row catbtns"><button type="button" class="btn" data-focusbuild="${esc(ps)}">Build</button><button type="button" class="btn" data-focustrain="${esc(ps)}" ${canTrain ? "" : "disabled"}>Train</button>${c.path.length && !c.other ? `<button type="button" class="btn ghost danger" data-catremove="${esc(ps)}" data-catlabel="${esc(c.label)}">Remove</button>` : ""}${info("Build and Train focus on this opening: Build's ⏮ and Gap › stay inside it, and Train's reviews and lines come only from it, until you clear the focus.", "About Build and Train")}</div>
        ${ideaBlock(ps, c.children.map(k => k.path.join(" ")), targets)}
        ${c.children.length ? `<div class="catkids">${c.children.map(k => entry(k, c.label)).join("")}</div>` : ""}
      </div>
    </details>`;
  };
  box.innerHTML = `<div class="cathead"><span>Opening</span><span>Covered${info(`To move ${coverTo()}: the share of games at your level through this opening that are still in your prep after move ${coverTo()} (Settings > Building your tree). The Map tab shows it move by move.`, "About covered")}</span><span>Score${info("Your score in your own games through this opening (win 1, draw ½), with the number of games under it.", "About score")}</span></div>` + root.children.map(c => entry(c)).join("");
}
/* ----- removing an opening (v0.9.8) -----
   An entry's path can start deeper than the line itself (a folded entry: the French is listed
   at 1.e4 e6 2.d4 d5). So the cut is made where the line starts: climb back up while the
   position before has only this one move or reply, and remove that move (my move, or a reply I'd
   prepared for). Everything under it that no other path still reaches goes too (walk() prunes
   positions and cards). Undo: RepUndo (rep.js). */
function catCutPath(ps, color = S.color) {
  const path = ps.split(" ").filter(Boolean), R = rep(color);
  let i = path.length;
  while (i > 1) {
    const n = R.pos[K(fenAfter(START, path.slice(0, i - 1)))];
    if (!n || n.m.length !== 1) break;
    i--;
  }
  return path.slice(0, i);
}
function catRemoveCount(ps, color = S.color) {
  const cut = catCutPath(ps, color).join(" "), { nodes } = walk(color), R = rep(color);
  return Object.entries(nodes).filter(([k, v]) => catUnder(cut, v.path.join(" ")) && R.pos[k] && R.pos[k].m.length && isMine(k, color)).length;
}
function removeCatalogueEntry(ps, label, color = S.color) {
  const path = catCutPath(ps, color);
  if (!path.length) return false;
  const n = catRemoveCount(ps, color);
  if (!confirm(`Remove ${label} from your ${color === "white" ? "White" : "Black"} repertoire? This takes out ${numbered(0, path)} and everything after it.${n ? ` ${n} position${n === 1 ? "" : "s"} with your move${n === 1 ? "" : "s"} go, with their training cards.` : ""} Positions your other lines also reach are kept.`)) return false;
  return RepUndo.change("cat", color, () => { removeMove(path.slice(0, -1), path[path.length - 1], color); return `Removed ${label}`; });
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("catremove", d => { if (removeCatalogueEntry(d.catremove, d.catlabel || d.catremove)) { catOpen.delete(d.catremove); renderCatalogue(); } });
onClick("catrecalc", d => renderCatalogue(true), true);
