"use strict";
/* ---------- positions where I have more than one move (v0.9.47) ----------
   Openings > Openings > "More than one move": every position of my tree (this colour, open book)
   where it's my move and I've saved two or more moves, most often reached first (indexTree() reach).
   Each shows the moves with how often players at my level play them and how they score for my side,
   my own games with each, and Keep only <move> (the other moves and their lines are dropped, with
   Undo: RepUndo kind "dbl"), or Open in Build.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const DBL = { open: false, shown: 10 };
// [{key, path, moves, reach}] for the colour, most reached first
function multiMovePositions(color = S.color) {
  const R = rep(color), { nodes } = walk(color), idx = indexTree(color), out = [];
  for (const [key, node] of Object.entries(nodes)) {
    const n = R.pos[key];
    if (!n || n.m.length < 2 || !isMine(key, color)) continue;
    out.push({ key, path: node.path, moves: n.m.slice(), reach: (idx[key] || {}).reach || 0 });
  }
  return out.sort((a, b) => b.reach - a.reach || a.path.length - b.path.length);
}
function renderDoubles() {
  const box = $("#dblBox"), btn = $("#dblBtn");
  if (!box) return;
  const list = multiMovePositions();
  if (btn) { btn.textContent = `More than one move (${list.length})`; btn.setAttribute("aria-expanded", String(DBL.open)); }
  box.hidden = !DBL.open;
  if (!DBL.open) return;
  const color = S.color;
  if (!list.length) { box.innerHTML = undoNote("dbl") + `<p class="help">You have one move in every position of your ${color} repertoire.</p>`; return; }
  const pc = x => Math.round(x * 100) + "%";
  const item = (p, i) => {
    const ex = cachedExplorer(fenAfter(START, p.path));
    const moves = p.moves.map(san => {
      const mv = ex && ex.moves.find(x => x.san === san), my = myMoveStats(p.key, san, color);
      const bits = [mv ? `${pc(mv.n / ex.total)} played, your side scores ${pc(scoreFor(mv, color))}` : "", my && my.n ? `you: ${my.n} game${my.n === 1 ? "" : "s"}, ${pc(wdlScore(my))}` : ""].filter(Boolean).join(" · ");
      return `<li><b class="mono">${esc(moveLabel(p.path, san))}</b>${bits ? ` <span class="help">${bits}</span>` : ""}<button type="button" class="btn ghost quick" data-dblkeep="${i}|${esc(san)}">Keep only ${esc(san)}</button></li>`;
    }).join("");
    return `<div class="dblitem"><p class="dblhead"><span class="mono">${esc(numbered(0, p.path) || "Start")}</span><button type="button" class="btn ghost quick" data-open="${esc(p.path.join(" "))}">Open in Build</button></p><ul class="dblmoves">${moves}</ul></div>`;
  };
  const shown = list.slice(0, DBL.shown);
  box.innerHTML = undoNote("dbl") + `<p class="help">Positions where you've saved two or more moves for ${color}, the ones you reach most often first. Training accepts any of them. ${info("Keep only a move drops the others there, and the lines after them (Undo puts them back). Played and score are Lichess players at your level; you is your own games.", "About this list")}</p>
    ${shown.map(item).join("")}
    ${list.length > shown.length ? `<button type="button" class="btn ghost quick" data-dblmore>Show more (${list.length - shown.length})</button>` : ""}`;
  box._list = list;
}
function dblKeep(spec) {
  const [i, san] = spec.split("|"), p = ($("#dblBox")._list || [])[+i], color = S.color;
  if (!p) return;
  RepUndo.change("dbl", color, () => {
    const drop = p.moves.filter(m => m !== san);
    drop.forEach(m => removeMove(p.path, m, color));
    return `Kept only ${moveLabel(p.path, san)} (dropped ${drop.join(", ")})`;
  });
  renderDoubles();
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("dbltoggle", () => { DBL.open = !DBL.open; renderDoubles(); }, true);
onClick("dblmore", () => { DBL.shown += 10; renderDoubles(); }, true);
onClick("dblkeep", d => dblKeep(d.dblkeep));
