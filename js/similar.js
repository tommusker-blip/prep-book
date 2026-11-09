"use strict";
/* ---------- spot the difference (v0.9.24): Train ----------
   Pairs of my positions that look almost the same (at most SIM_DIFF squares differ) but where
   my repertoire move is different, trained one straight after the other, so the difference
   sticks: "with the bishop on c4 I play d3, with it on b5 I play O-O".
   - Only positions where it's my move and I have a training card; the moves must not overlap.
   - Closest pairs first, then the ones that need work most (cardNeed()); each position is used
     in one pair only. With a focus (focus.js), at least one of the two is inside it.
   - At most SIM_POOL positions are compared (the ones that need work most), to stay quick.
   simDiffText() says what's different, shown after the second position of a pair.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const SIM_DIFF = 4, SIM_POOL = 700;
let simMemo = { sig: "", pairs: [] };
function similarPairs(color = S.color) {
  const w = walk(color), R = rep(color), sig = color + "|" + S.book + "|" + w.sig + "|" + focusPath(color).join(" ");
  if (simMemo.sig === sig) return simMemo.pairs;
  const now = Date.now();
  let list = Object.entries(R.cards).map(([key, card]) => {
    const node = w.nodes[key], n = R.pos[key];
    return node && n && n.m.length ? { key, arr: boardArr(node.fen), m: n.m, path: node.path, need: cardNeed(card, now), inF: inFocus(node.path, color) } : null;
  }).filter(Boolean);
  if (list.length > SIM_POOL) list = list.sort((a, b) => b.need - a.need).slice(0, SIM_POOL);
  const cand = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (focusOn(color) && !a.inF && !b.inF) continue;
      let d = 0;
      for (let s = 0; s < 64 && d <= SIM_DIFF; s++) if (a.arr[s] !== b.arr[s]) d++;
      if (!d || d > SIM_DIFF || a.m.some(x => b.m.includes(x))) continue;
      cand.push({ a, b, d, need: a.need + b.need });
    }
  }
  cand.sort((x, y) => x.d - y.d || y.need - x.need);
  const used = new Set(), pairs = [];
  for (const p of cand) {
    if (used.has(p.a.key) || used.has(p.b.key)) continue;
    used.add(p.a.key); used.add(p.b.key);
    pairs.push({ a: p.a.key, b: p.b.key, d: p.d, aArr: p.a.arr, bArr: p.b.arr });
  }
  simMemo = { sig, pairs };
  return pairs;
}
const PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
// What's on the differing squares: "Here: your bishop on c4. In the last one: your bishop on b5."
function simDiffText(hereArr, otherArr, color = S.color) {
  const mineUpper = color === "white", sq = i => "abcdefgh"[i % 8] + (8 - Math.floor(i / 8));
  const who = ch => ((ch === ch.toUpperCase()) === mineUpper ? "your" : "their");
  const name = ch => `${who(ch)} ${PIECE_NAMES[ch.toLowerCase()]}`;
  const here = [], there = [];
  for (let i = 0; i < 64; i++) {
    if (hereArr[i] === otherArr[i]) continue;
    if (hereArr[i] !== ".") here.push(`${name(hereArr[i])} on ${sq(i)}`);
    if (otherArr[i] !== ".") there.push(`${name(otherArr[i])} on ${sq(i)}`);
  }
  const list = a => (a.length ? a.join(", ") : "nothing extra");
  return `Here: ${list(here)}. In the last one: ${list(there)}.`;
}
