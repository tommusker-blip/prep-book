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
   Each entry gets: coverage (1 − the reach of the gaps under it ÷ its own reach, from
   findGaps()), my score from my games through it, my accuracy in book and just after
   (analysis v2), training cards learned and due, and a one-line comment. */
const CAT_SPLIT = 0.2, CAT_DEPTH = 5;
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
    if (k.label === c.label) { k.label = numbered(c.path.length, k.path.slice(c.path.length)); k.named = false; }
    relabel(k);
  });
  relabel(root);
  const sortKids = c => { c.children.sort((a, b) => b.reach - a.reach); c.children.forEach(sortKids); };
  sortKids(root);
  return root;
}

// Numbers for every entry, worked out once per render
function catalogueStats(root, color = S.color) {
  const R = rep(color), idx = indexTree(color), now = Date.now();
  const tree = Object.entries(idx).map(([key, v]) => ({ key, ps: v.path.join(" ") }));
  const gaps = findGaps(color).map(g => ({ ps: g.path.join(" "), f: g.freq || 0 }));
  const games = S.games.filter(g => g.my === color).map(g => ({ g, keys: new Set(gameKeys(g)), a: S.acc[g.id] }));
  const under = (ps, x) => !ps || x === ps || x.startsWith(ps + " ");
  const stat = c => {
    const ps = c.path.join(" ");
    const pos = tree.filter(t => under(ps, t.ps));
    const cards = pos.map(t => R.cards[t.key]).filter(Boolean);
    const gapReach = gaps.filter(g => under(ps, g.ps)).reduce((s, g) => s + g.f, 0);
    const me = c.path.length ? myPosStats(c.key, color) : null;
    const inb = [], post = [];
    if (c.path.length) for (const x of games) if (x.a && x.a.v === 2 && x.keys.has(c.key)) { if (x.a.inb) inb.push(...x.a.inb); if (x.a.post) post.push(...x.a.post); }
    const avg = a => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : null);
    c.stats = {
      cover: c.reach > 0 ? Math.max(0, Math.min(1, 1 - gapReach / c.reach)) : null,
      positions: cards.length, learned: cards.filter(k => k.reps >= 2).length, due: cards.filter(k => k.due <= now).length,
      games: me ? me.n : 0, score: me && me.n ? wdlScore(me) : null, wdl: me,
      accIn: avg(inb), accOut: avg(post),
    };
    c.comment = catComment(c.stats);
    c.children.forEach(stat);
  };
  root.children.forEach(stat);
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

/* ----- the page ----- */
function renderCatalogue() {
  const box = $("#catBody");
  if (!box) return;
  const C = S.color === "white" ? "White" : "Black";
  $("#catHead").textContent = `Your ${C} openings · ${prepBookName()}`;
  if (warming || S.games.some(g => !GAMEKEYS.has(g.id))) { // game positions first (like the report)
    box.innerHTML = `<p class="help">Reading your games…</p>`;
    warmGameKeys(() => { if (S.view === "openings") renderCatalogue(); });
    return;
  }
  const root = catalogueStats(buildCatalogue(S.color), S.color);
  if (!root.children.length) { box.innerHTML = `<p class="help">Nothing in your ${C} repertoire yet. Add moves in Build, or use Build my tree from my games on the Games tab.</p>`; return; }
  const info = branchInfo(S.color);
  const meter = (v, label, cls = "") => `<span class="cmeter ${cls}" aria-label="${label}"><i style="width:${v == null ? 0 : Math.round(v * 100)}%"></i></span>`;
  const entry = c => {
    const s = c.stats, ps = c.path.join(" "), open = catOpen.has(ps), canTrain = info[c.key] && info[c.key].cards;
    const scoreCls = s.score == null || s.games < 3 ? "" : s.score >= 0.55 ? "good" : s.score <= 0.42 ? "bad" : "";
    return `<details class="cat"${open ? " open" : ""} data-catpath="${esc(ps)}">
      <summary>
        <span class="catname">${c.named ? `<span class="eco">${esc(c.eco)}</span> ` : ""}${esc(c.label)}</span>
        <span class="catline mono">${esc(numbered(0, c.path))}</span>
        <span class="catnums">
          <span>${meter(s.cover, `coverage ${s.cover == null ? "unknown" : pctOf(s.cover)}`, s.cover != null && s.cover < 0.6 ? "warn" : "")}<b>${s.cover == null ? "–" : pctOf(s.cover)}</b> covered</span>
          <span class="${scoreCls}"><b>${s.score == null ? "–" : pctOf(s.score)}</b> score${s.games ? ` (${s.games})` : ""}</span>
          <span><b>${s.accIn ?? "–"}</b> acc.</span>
        </span>
      </summary>
      <div class="catbody">
        <p class="help">${esc(c.comment)}${s.positions ? ` ${s.learned} of ${s.positions} of your moves learned.` : ""}</p>
        <div class="row catbtns"><button type="button" class="btn ghost" data-catbuild="${esc(ps)}">Build</button><button type="button" class="btn ghost" data-cattrain="${esc(ps)}" ${canTrain ? "" : "disabled"}>Train this line</button></div>
        ${ideaBlock(ps, c.children.map(k => k.path.join(" ")))}
        ${c.children.length ? `<div class="catkids">${c.children.map(entry).join("")}</div>` : ""}
      </div>
    </details>`;
  };
  box.innerHTML = root.children.map(entry).join("");
}
