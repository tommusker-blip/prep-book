"use strict";
/* ---------- the coverage map (v0.9.24): Openings > Visualise (was Map) ----------
   Every opening of the catalogue as a row of cells, one per move (1 to MAP_MOVES):
   - Coverage: how much of what you'll meet at your level through that opening is still in your
     prep after that move (the catalogue's curve), darker blue for more.
   - Played (v0.9.25): how many of my games through it were still in my prep at that move.
   - Results: your score in your own games through it, by the move where they left your prep
     (blue scores well, orange badly, fainter on few games), as a percentage. The last column
     takes move 12 and later.
   The numbers come from the catalogue (catalogue.js), so the map is as fresh as that page.
   Progress: each time the catalogue is worked out, the overall coverage is noted in the
   repertoire (R.hist, one entry a day, synced), and the map compares with the oldest entry
   from the last 30 days.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const MAP_MOVES = 12;
const mapOpen = new Set();
let mapMode = "cover";
const UNK_SHOW = 0.1; // v0.9.56: mark coverage cells where this share or more has no Lichess data
let mapWho = "all"; // v0.9.55: Played / Results over all games, or only where I / they left the prep
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
// v0.9.56: how many of my positions have no Lichess data, with Scan my tree (shares the scan on the Ideas tab)
function unknownLine() {
  if (!S.token) return "";
  if (Scan.running) return `<p class="help" aria-live="polite">Fetching Lichess data: ${Scan.done} of ${Scan.total} positions… the map updates when it's done.</p>`;
  const todo = scanTodo().length;
  if (!todo) return "";
  return `<p class="help">${todo} of your positions have no Lichess data on this device, so gaps after them can't be seen: cells marked ? may be lower. <button type="button" class="btn ghost quick" data-mapscan>Scan my tree (about ${Math.max(1, Math.ceil((todo * EXPL_GAP) / 60000))} min)</button></p>`;
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
  const short = n => (n >= 1000 ? Math.round(n / 1000) + "k" : String(n));
  // v0.9.55: the exits for the games chosen (all, or where I / they left the prep)
  const exitsOf = s => (mapWho === "me" ? s.exitsMe : mapWho === "them" ? s.exitsThem : s.exits);
  const whoScore = s => { const t = (exitsOf(s) || []).reduce((a, e) => (e ? { n: a.n + e.n, s: a.s + e.s } : a), { n: 0, s: 0 }); return t.n ? t.s / t.n : null; };
  // My games through an entry by the move they left my prep: the last column takes the rest
  const exitAt = (s, m) => {
    const ex = exitsOf(s) || [], list = m < MAP_MOVES ? [ex[m - 1]] : ex.slice(m - 1);
    return list.reduce((a, e) => (e ? { n: a.n + e.n, s: a.s + e.s } : a), { n: 0, s: 0 });
  };
  const totalOf = s => (exitsOf(s) || []).reduce((a, e) => a + (e ? e.n : 0), 0);
  const cell = (c, m) => {
    const s = c.stats || {};
    if (mapMode === "cover") {
      const v = s.curve ? s.curve[m - 1] : null;
      if (v == null) return `<span class="mc"></span>`;
      // v0.9.53: the number in the cell, and the tip says which gaps take it down by then
      const gaps = (s.gapsTop || []).filter(g => g.mv <= m).slice(0, 3).map(g => `${g.l} (${pctOf(g.f)})`);
      // v0.9.56: "?" where a good part of it has no Lichess data yet: gaps there can't be seen, so it may be lower
      const u = s.unk ? s.unk[m - 1] : 0, unsure = u >= UNK_SHOW;
      return `<span class="mc cov pl${v >= 0.5 ? " dk" : ""}${m === coverTo() ? " to" : ""}${unsure ? " unk" : ""}" style="--v:${Math.round(v * 100)}%" data-tip="${esc(`${c.label}: ${pctOf(v)} of games through it still in your prep after move ${m}.${gaps.length ? ` Biggest gaps by then: ${gaps.join("; ")}.` : ""}${unsure ? ` About ${pctOf(u)} of them reach positions with no Lichess data yet, where gaps can't be seen, so it may well be lower: Scan my tree.` : ""}`)}">${Math.round(v * 100)}${unsure ? "?" : ""}</span>`;
    }
    if (mapMode === "played") {
      // my games through it that were still in my prep at move m
      const tot = totalOf(s);
      let left = tot;
      for (let i = 1; i < m; i++) left -= exitAt(s, i).n;
      if (!tot || left <= 0) return `<span class="mc"></span>`;
      const v = left / tot;
      return `<span class="mc cov pl${v >= 0.5 ? " dk" : ""}" style="--v:${Math.round(v * 100)}%" data-tip="${esc(`${c.label}: ${left} of your ${tot} game${tot === 1 ? "" : "s"} through it were still in your prep at move ${m}`)}">${short(left)}</span>`;
    }
    const e = exitAt(s, m);
    if (!e.n) return `<span class="mc"></span>`;
    const sc = e.s / e.n, k = sc >= 0.55 ? "hi" : sc <= 0.45 ? "lo" : "mid";
    return `<span class="mc res ${k}" style="--o:${Math.min(1, 0.35 + e.n / 8)}" data-tip="${esc(`${c.label}: ${e.n} game${e.n === 1 ? "" : "s"} left your prep at move ${m}${m === MAP_MOVES ? " or later" : ""}; you scored ${pctOf(sc)}`)}">${Math.round(sc * 100)}</span>`;
  };
  // v0.9.49: how often each opening comes up (its reach: the opponent's moves at my level multiplied, playing my moves)
  const freqCell = (c, top) => {
    if (top || c.reach == null) return "";
    const r = Math.min(1, c.reach);
    return `<span class="mapfreq" aria-label="${esc(`met in about ${pctOf(r)} of games`)}">${r < 0.01 ? "<1%" : pctOf(r)}</span>`;
  };
  const row = (c, depth, label, top) => {
    const ps = c.path.join(" "), kids = !top && c.children && c.children.length && depth < 2, open = mapOpen.has(ps);
    const s = c.stats || {};
    const end = mapMode === "cover" ? (s.cover == null ? "–" : pctOf(s.cover)) : mapMode === "played" ? short(totalOf(s)) : mapWho === "all" ? (s.score == null ? "–" : pctOf(s.score)) : (whoScore(s) == null ? "–" : pctOf(whoScore(s)));
    return `<div class="maprow d${depth}"><button type="button" class="mapname" ${kids ? `data-mapopen="${esc(ps)}" aria-expanded="${open}"` : "disabled"}>${kids ? `<span class="caret">${open ? "▾" : "▸"}</span>` : ""}<span class="mapnm">${esc(label || c.label)}</span>${freqCell(c, top)}</button>${cols.map(m => cell(c, m)).join("")}<span class="mapend">${end}</span></div>`
      + (kids && open ? c.children.map(k => row(k, depth + 1)).join("") : "");
  };
  const MODES = { cover: "Coverage", played: "Played", res: "Results" };
  const help = {
    cover: "Each cell is the % of games through that opening still in your prep after that move. A parent row also counts the gaps that sit above its sub-openings (a reply you have no move for, or haven't prepared), so it can be lower than each of them. Tap a cell for the biggest gaps by then. Light cells early in a row are where to build next: Gap › in Build goes there first.",
    played: "How many of your games through each opening were still in your prep at each move. Where the numbers drop fast is where your games leave your prep.",
    res: "Your score (%) in the games that left your prep at that move. Orange cells are where leaving your prep costs you: worth building that opening deeper, or training it. Tap a cell for the number of games.",
  };
  box.innerHTML = `<h3>Your openings, move by move ${info("One row per opening, with how often you meet it (freq) next to its name, one cell per move. Coverage: how much of what you'll meet at your level through that opening is still in your prep after each move; darker is more, and the outlined column is the move coverage is counted to (Settings > Building your tree). Played: how many of your own games through that opening were still in your prep at each move. Results: your score in the games that left your prep at that move, blue where you scored well, orange where you scored badly, fainter on few games. The last column takes move 12 and later. Tap a cell for its numbers, and an opening's name for its branches.", "About this view")}</h3>
    ${progressLine(S.color)}
    ${mapMode === "cover" ? unknownLine() : ""}
    <div class="seg small" role="group" aria-label="Show">${Object.entries(MODES).map(([k, t]) => `<button type="button" data-mapmode="${k}" aria-pressed="${mapMode === k}">${t}</button>`).join("")}</div>
    ${mapMode !== "cover" ? `<div class="seg small" role="group" aria-label="Which games" style="margin-top:6px">${[["all", "All games"], ["me", "I left prep"], ["them", "They left prep"]].map(([k, t]) => `<button type="button" data-mapwho="${k}" aria-pressed="${mapWho === k}">${t}</button>`).join("")}</div>` : ""}
    <div class="covmap ${mapMode}" style="--cols:${MAP_MOVES}">
      <div class="maprow mhead"><span class="mapname"><span class="mapnm">Move</span><span class="mapfreq">freq ${info("How often you meet this opening: the share of games at your level that reach it when you play your moves (Lichess). Your own games through it are under Played.", "About frequency")}</span></span>${cols.map(m => `<span class="mc mn${m === coverTo() && mapMode === "cover" ? " to" : ""}">${m}${m === MAP_MOVES ? "+" : ""}</span>`).join("")}<span class="mapend">${mapMode === "cover" ? `to ${coverTo()}` : mapMode === "played" ? "games" : "score"}</span></div>
      ${row(root, 0, `All your ${C} openings`, true)}
      ${root.children.map(c => row(c, 0)).join("")}
    </div>
    <p class="help">${help[mapMode] || help.cover}${mapMode !== "cover" && mapWho !== "all" ? ` Only your games where ${mapWho === "me" ? "you left your prep: a mistake, or a choice of yours" : "your opponent left your prep with a move you hadn't prepared"}.` : ""}</p>`;
}

/* v0.9.39: the Visualise tab (was Map) also holds the pictures (picture.js): one switch between the opening map,
   the tree and the structures */
let mapView = "map";
const MAP_VIEWS = [["map", "Move by move"], ["tree", "Tree"], ["structures", "Structures"]];
function renderMapTab() {
  const sw = $("#mapViews");
  if (sw) sw.innerHTML = `<div class="seg" role="group" aria-label="Show">${MAP_VIEWS.map(([k, t]) => `<button type="button" data-mapview="${k}" aria-pressed="${mapView === k}">${t}</button>`).join("")}</div>`;
  const map = mapView === "map";
  $("#coverMap").hidden = !map; $("#picPane").hidden = map;
  if (map) renderCoverMap(); else { PIC.view = mapView; renderPicture(); }
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("mapview", d => { mapView = d.mapview; renderMapTab(); }, true);
onClick("mapmode", d => { mapMode = d.mapmode; renderCoverMap(); }, true);
onClick("mapwho", d => { mapWho = d.mapwho; renderCoverMap(); }, true);
onClick("mapscan", () => scanTree(S.color, finished => { catStale(S.color); if (S.view === "openings" && S.otab === "map" && mapView === "map") { if (finished) renderCatalogue(true); else renderCoverMap(true); } }), true);
onClick("mapopen", d => { if (mapOpen.has(d.mapopen)) mapOpen.delete(d.mapopen); else mapOpen.add(d.mapopen); renderCoverMap(); }, true);
