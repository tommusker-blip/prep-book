"use strict";
/* ---------- the coverage map (v0.9.24): Openings > Map ----------
   Every opening of the catalogue as a row of cells, one per move (1 to MAP_MOVES):
   - Coverage: how much of what you'll meet at your level through that opening is still in your
     prep after that move (the catalogue's curve), darker blue for more.
   - Results: your score in your own games through it, by the move where they left your prep
     (blue scores well, orange badly, fainter on few games), with the number of games.
   The numbers come from the catalogue (catalogue.js), so the map is as fresh as that page.
   Progress: each time the catalogue is worked out, the overall coverage is noted in the
   repertoire (R.hist, one entry a day, synced), and the map compares with the oldest entry
   from the last 30 days.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const MAP_MOVES = 12;
const mapOpen = new Set();
let mapMode = "cover";
const todayStr = () => new Date().toISOString().slice(0, 10);
function noteProgress(color, st) {
  if (!st || st.cover == null) return;
  const R = rep(color), h = R.hist || (R.hist = []), d = todayStr(), v = Math.round(st.cover * 1000) / 1000, to = coverTo();
  const last = h[h.length - 1];
  if (last && last.d === d && last.c === v && last.to === to) return;
  if (last && last.d === d) h.pop();
  h.push({ d, c: v, to, n: st.positions || 0 });
  if (h.length > 120) h.splice(0, h.length - 120);
  Store.save(repDoc(color));
}
function progressLine(color) {
  const h = (rep(color).hist || []).filter(x => x.to === coverTo()), now = h[h.length - 1];
  if (!now) return "";
  const since = Date.now() - 30 * 864e5, old = h.find(x => Date.parse(x.d) >= since && x !== now);
  const date = x => new Date(x.d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (!old) return `<p class="possum">Covered to move ${coverTo()}: <b>${pctOf(now.c)}</b> across your ${color === "white" ? "White" : "Black"} openings, ${now.n} of your moves.</p>`;
  const dc = Math.round((now.c - old.c) * 100);
  return `<p class="possum">Covered to move ${coverTo()}: <b>${pctOf(now.c)}</b>, <span class="${dc > 0 ? "ok" : dc < 0 ? "bad" : ""}">${dc > 0 ? "up" : dc < 0 ? "down" : "no change"}${dc ? ` ${Math.abs(dc)} points` : ""}</span> since ${date(old)} (${old.n} → ${now.n} of your moves).</p>`;
}
function renderCoverMap(fromCat) {
  const box = $("#coverMap");
  if (!box) return;
  if (!fromCat && !catJob) renderCatalogue(); // starts a recalculation if the tree or games changed; its end redraws the map
  const memo = catCurrent(), C = S.color === "white" ? "White" : "Black";
  if (!memo) { box.innerHTML = `<p class="help">Working out your openings…</p>`; return; }
  const root = memo.root;
  if (!root.children.length) { box.innerHTML = `<p class="help">Nothing in your ${C} repertoire yet.</p>`; return; }
  const cols = Array.from({ length: MAP_MOVES }, (_, i) => i + 1);
  const cell = (c, m) => {
    const s = c.stats || {};
    if (mapMode === "cover") {
      const v = s.curve ? s.curve[m - 1] : null;
      if (v == null) return `<span class="mc"></span>`;
      return `<span class="mc cov${m === coverTo() ? " to" : ""}" style="--v:${Math.round(v * 100)}%" data-tip="${esc(`${c.label}: ${pctOf(v)} still in your prep after move ${m}`)}"></span>`;
    }
    const e = s.exits ? s.exits[m - 1] : null;
    if (!e || !e.n) return `<span class="mc"></span>`;
    const sc = e.s / e.n, k = sc >= 0.55 ? "hi" : sc <= 0.45 ? "lo" : "mid";
    return `<span class="mc res ${k}" style="--o:${Math.min(1, 0.35 + e.n / 8)}" data-tip="${esc(`${c.label}: ${e.n} game${e.n === 1 ? "" : "s"} left your prep at move ${m}${m === MAP_MOVES ? " or later" : ""}; you scored ${pctOf(sc)}`)}">${e.n}</span>`;
  };
  const row = (c, depth, label, top) => {
    const ps = c.path.join(" "), kids = !top && c.children && c.children.length && depth < 2, open = mapOpen.has(ps);
    const s = c.stats || {};
    const end = mapMode === "cover" ? (s.cover == null ? "–" : pctOf(s.cover)) : (s.score == null ? "–" : pctOf(s.score));
    return `<div class="maprow d${depth}"><button type="button" class="mapname" ${kids ? `data-mapopen="${esc(ps)}" aria-expanded="${open}"` : "disabled"}>${kids ? `<span class="caret">${open ? "▾" : "▸"}</span>` : ""}${esc(label || c.label)}</button>${cols.map(m => cell(c, m)).join("")}<span class="mapend">${end}</span></div>`
      + (kids && open ? c.children.map(k => row(k, depth + 1)).join("") : "");
  };
  box.innerHTML = `<h3>Coverage map ${info("One row per opening, one cell per move. Coverage: how much of what you'll meet at your level through that opening is still in your prep after each move; darker is more, and the outlined column is the move coverage is counted to (Settings > Building your tree). Results: your own games through that opening, by the move where they left your prep, with the number of games: blue where you scored well, orange where you scored badly. Tap a cell for its numbers, and an opening's name for its branches.", "About the map")}</h3>
    ${progressLine(S.color)}
    <div class="seg small" role="group" aria-label="Show"><button type="button" data-mapmode="cover" aria-pressed="${mapMode === "cover"}">Coverage</button><button type="button" data-mapmode="res" aria-pressed="${mapMode === "res"}">Results</button></div>
    <div class="covmap ${mapMode}" style="--cols:${MAP_MOVES}">
      <div class="maprow mhead"><span class="mapname">Move</span>${cols.map(m => `<span class="mc mn${m === coverTo() && mapMode === "cover" ? " to" : ""}">${m}</span>`).join("")}<span class="mapend">${mapMode === "cover" ? `to ${coverTo()}` : "score"}</span></div>
      ${row(root, 0, `All your ${C} openings`, true)}
      ${root.children.map(c => row(c, 0)).join("")}
    </div>
    <p class="help">${mapMode === "cover" ? "Light cells early in a row are where to build next: Gap › in Build goes there first (Move by move)." : "Orange cells are where leaving your prep costs you: worth building that opening deeper, or training it."}</p>`;
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("mapmode", d => { mapMode = d.mapmode; renderCoverMap(); }, true);
onClick("mapopen", d => { if (mapOpen.has(d.mapopen)) mapOpen.delete(d.mapopen); else mapOpen.add(d.mapopen); renderCoverMap(); }, true);
