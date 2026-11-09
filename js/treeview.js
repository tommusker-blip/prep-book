"use strict";
/* ---------- My lines (v0.9.24): Build's third tab ----------
   The same board as Build, but the panel shows only what I've saved: my repertoire from the
   position on the board, written out as notation (main line first, other options and prepared
   replies as indented variations), with my notes. Tap a move to go there. My moves are in blue.
   A position reached again by another move order is marked "= transposes" and not repeated.
   Notes: one per position (R.notes[key], in the repertoire doc, so they sync and travel with
   the book). They show in the notation as comments, and after a correct answer in Train.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const TREE_MAX = 500; // moves written out at most; deeper lines end in "…"
let noteTimer = null;
function noteFor(key, color = S.color) { const N = rep(color).notes; return (N && N[key]) || ""; }
function setNote(key, text, color = S.color) {
  const R = rep(color);
  R.notes = R.notes || {};
  const t = text.trim();
  if (t) R.notes[key] = t; else delete R.notes[key];
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => Store.save(repDoc(color)), 600);
}
// The notation from a position: {html, count}
function treeHtml(key, path, color = S.color) {
  const { nodes } = walk(color);
  let count = 0;
  // My moves in my order (the first is the main line); prepared replies most played first
  const kidsOf = k => {
    const node = nodes[k];
    if (!node) return [];
    const ex = !isMine(k, color) && node.kids.length > 1 ? cachedExplorer(node.fen) : null;
    if (!ex || !ex.total) return node.kids;
    const f = s => (ex.moves.find(m => m.san === s) || { n: 0 }).n;
    return node.kids.slice().sort((a, b) => f(b.san) - f(a.san));
  };
  // Which path writes out each position: the first one met going down main lines first, so a
  // position shared with a side line is written in the main line, and the side line says "= transposes"
  const owner = new Map([[key, path.join(" ")]]);
  const claim = (k, p) => { for (const kid of kidsOf(k)) { const q = p.concat(kid.san); if (!owner.has(kid.key)) { owner.set(kid.key, q.join(" ")); claim(kid.key, q); } } };
  claim(key, path);
  const num = (ply, force) => (ply % 2 === 0 ? `<span class="tmn">${ply / 2 + 1}.</span>` : force ? `<span class="tmn">${(ply - 1) / 2 + 1}…</span>` : "");
  const mv = (k, p, force) => {
    count++;
    const mine = !isMine(k.key, color); // the move was mine if the position after it is the opponent's
    const note = noteFor(k.key, color);
    return `${num(p.length, force)}<button type="button" class="tmv${mine ? " mine" : ""}" data-tgo="${esc(p.concat(k.san).join(" "))}">${esc(k.san)}</button>${note ? ` <span class="tc">${esc(note)}</span> ` : " "}`;
  };
  const owns = (kid, p) => owner.get(kid.key) === p.concat(kid.san).join(" ");
  const line = (k0, p0, force0) => {
    let out = "", k = k0, p = p0, force = force0;
    for (;;) {
      if (count >= TREE_MAX) return out + `<span class="tend">…</span>`;
      const kids = kidsOf(k);
      if (!kids.length) return out;
      const [main, ...rest] = kids;
      out += mv(main, p, force);
      for (const v of rest) out += `<div class="tv">${mv(v, p, true)}${owns(v, p) ? line(v.key, p.concat(v.san), true) : `<span class="tend">= transposes</span>`}</div>`;
      if (!owns(main, p)) return out + `<span class="tend">= transposes</span>`;
      k = main.key; p = p.concat(main.san); force = rest.length > 0;
    }
  };
  return { html: line(key, path, true), count };
}
function renderTreePane() {
  const box = $("#treeCard");
  if (!box) return;
  const { path, key } = buildState(), inTree = !!walk(S.color).nodes[key];
  const { html, count } = inTree ? treeHtml(key, path) : { html: "", count: 0 };
  const note = noteFor(key);
  box.innerHTML = `<label class="lbl" for="tNote">Your note on this position ${info("Anything you want to remember here: the plan, a trap, why you chose this move. Saved with your repertoire and synced. Notes show in the lines below and after a correct answer in Train.", "About notes")}</label>
    <textarea id="tNote" class="tnote" placeholder="A plan, a trap, why this move…">${esc(note)}</textarea>
    <p class="lbl" style="margin-top:10px">${inTree ? (count ? `Your lines from here (${count} move${count === 1 ? "" : "s"})` : "Your prep ends here") : "Not in your repertoire"}</p>
    ${inTree ? (count ? `<div class="tree">${html}</div>` : `<p class="help">Nothing saved after this position yet. Add moves on the Moves tab.</p>`) : `<p class="help">This position isn't in your saved lines. ⏮ or ◀ go back, or tap a move above.</p>`}
    ${count ? `<p class="help">Blue moves are yours. Tap any move to go there.</p>` : ""}`;
  const ta = $("#tNote");
  ta.oninput = () => setNote(key, ta.value);
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("tgo", d => { S.build[S.color] = d.tgo ? d.tgo.split(" ") : []; renderBuild(); });
