"use strict";
/* ---------- Openings > Add an opening (v0.9.7) ----------
   Search the named openings (Lichess chess-openings, js/openlines.js, loaded on first use),
   pick one, and add its moves to the White or Black repertoire, with any of its deeper
   variations from the same dataset (the lines that continue it). Where my repertoire already
   has a different move of mine, the line's move is added as another option, and the preview
   says how many. Everything goes through addMove(), like Build. */
const AO = { open: false, q: "", pick: null, color: null, sel: new Set(), loading: null, view: null, ply: 0 };
function loadOpeningLines() {
  if (typeof OPENING_LINES !== "undefined") return Promise.resolve();
  if (AO.loading) return AO.loading;
  AO.loading = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "js/openlines.js";
    s.onload = res; s.onerror = () => { AO.loading = null; rej(new Error("Couldn't load the openings list")); };
    document.head.append(s);
  });
  return AO.loading;
}
const aoName = n => n.replace(/Defense/g, "Defence");
// Openings matching every word of the search (name or ECO), shortest lines first
function searchOpenings(q, limit = 40) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return OPENING_LINES.filter(([eco, name]) => { const t = (eco + " " + aoName(name)).toLowerCase(); return words.every(w => t.includes(w)); })
    .sort((a, b) => a[2].split(" ").length - b[2].split(" ").length || a[1].localeCompare(b[1])).slice(0, limit);
}
// Deeper variations of a line: dataset entries whose moves continue it
function variationsOf(sans, limit = 60) {
  const pre = sans + " ";
  return OPENING_LINES.filter(o => o[2].startsWith(pre)).sort((a, b) => a[2].split(" ").length - b[2].split(" ").length || a[1].localeCompare(b[1])).slice(0, limit);
}
// How many of my moves along these lines differ from what I already play
function aoConflicts(lines, color) {
  let n = 0;
  for (const sans of lines) n += lineConflicts(sans.split(" "), color).length;
  return n;
}
function addOpeningLines(lines, color) {
  let added = 0;
  for (const sans of lines) {
    const m = sans.split(" ");
    for (let i = 0; i < m.length; i++) if (addMove(m.slice(0, i), m[i], color) === "added") added++;
  }
  walk(color);
  Store.save(repDoc(color));
  return added;
}

/* ----- the panel on the Openings page ----- */
async function renderAddOpening() {
  const box = $("#addOpenBox");
  if (!box) return;
  box.hidden = !AO.open;
  $("#addOpenBtn").setAttribute("aria-expanded", String(AO.open));
  if (!AO.open) return;
  if (typeof OPENING_LINES === "undefined") {
    box.innerHTML = `<p class="help">Loading the list of openings…</p>`;
    try { await loadOpeningLines(); } catch (e) { box.innerHTML = `<p class="help">${esc(e.message)}. Check your connection and try again.</p>`; return; }
    if (!AO.open) return;
  }
  const color = AO.color || S.color;
  if (AO.pick) {
    const [eco, name, sans] = AO.pick, vars = variationsOf(sans), base = aoName(name);
    const chosen = [sans, ...vars.filter(v => AO.sel.has(v[2])).map(v => v[2])];
    const C = c => (c === "white" ? "White" : "Black");
    // A variation's own name without the opening's, and the moves it adds
    const short = v => aoName(v[1]).replace(base + ": ", "").replace(base + ", ", "");
    const extra = v => numbered(sans.split(" ").length, v[2].split(" ").slice(sans.split(" ").length));
    box.innerHTML = `<div class="aohead"><button type="button" class="btn ghost quick" data-aoback>‹ Search</button><b>${esc(eco)} ${esc(base)}</b></div>
      <div class="row aocolor"><span class="lbl">Add to</span><div class="seg small" role="group" aria-label="Which repertoire">${["white", "black"].map(c => `<button type="button" data-aocolor="${c}" aria-pressed="${c === color}">${C(c)}</button>`).join("")}</div></div>
      <div class="aopick">
        <div class="aoprev">
          <div id="aoBoard" class="board aoboard" aria-label="Preview of the line"></div>
          <div class="navrow aonav"><button type="button" class="btn ghost quick" data-aostep="-1" aria-label="Back one move">◀</button><span class="help" id="aoPrevName"></span><button type="button" class="btn ghost quick" data-aostep="1" aria-label="Forward one move">▶</button></div>
          <p class="mono aoline" id="aoPrevLine"></p>
        </div>
        <div class="aolist">
          <button type="button" class="aoview aomain" data-aoview="${esc(sans)}"><b>Main line</b> <span class="mono help">${esc(numbered(0, sans.split(" ")))}</span></button>
          ${vars.length ? `<p class="lbl" style="margin-top:10px">Its variations (${vars.length}${vars.length === 60 ? "+" : ""}): tap a name to see it on the board, tick the ones to add too</p>
            <div class="row" style="margin:2px 0 4px"><button type="button" class="btn ghost quick" data-aoall>${vars.every(v => AO.sel.has(v[2])) ? "Untick all" : "Tick all"}</button></div>
            <div class="aovars">${vars.map(v => `<div class="aovar"><input type="checkbox" data-aovar="${esc(v[2])}" aria-label="Add ${esc(short(v))}" ${AO.sel.has(v[2]) ? "checked" : ""}><button type="button" class="aoview" data-aoview="${esc(v[2])}"><b>${esc(short(v))}</b> <span class="mono help">${esc(extra(v))}</span></button></div>`).join("")}</div>` : `<p class="help">No deeper variations of this line in the list.</p>`}
        </div>
      </div>
      <p class="help" id="aoSum" style="margin-top:8px">${aoSummaryText(chosen, color)}</p>
      <div class="row"><button type="button" class="btn" id="aoAddBtn" data-aoadd>${aoAddLabel(chosen)}</button></div>`;
    aoShow(AO.view && (AO.view === sans || vars.some(v => v[2] === AO.view)) ? AO.view : sans, AO.view ? AO.ply : null);
    return;
  }
  const res = searchOpenings(AO.q);
  box.innerHTML = `<label for="aoSearch" class="lbl">Find an opening by name or ECO code</label>
    <input type="search" id="aoSearch" placeholder="e.g. Benko, Najdorf, Caro-Kann Advance, A57" value="${esc(AO.q)}" autocomplete="off">
    <div class="aores">${AO.q.trim() ? (res.length ? res.map(o => `<button type="button" class="gap-row" data-aopick="${esc(o[2])}"><span class="gt">${esc(o[0])} ${esc(aoName(o[1]))}</span><span class="gl mono">${esc(numbered(0, o[2].split(" ")))}</span></button>`).join("") : `<p class="help">No opening matches “${esc(AO.q)}”.</p>`) : `<p class="help">${OPENING_LINES.length.toLocaleString("en-GB")} named openings and variations.</p>`}</div>`;
  const inp = $("#aoSearch");
  inp.oninput = () => { AO.q = inp.value; const pos = inp.selectionStart; renderAddOpening().then(() => { const i = $("#aoSearch"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }); };
}
function onAddOpeningClick(d) {
  if ("aotoggle" in d) { AO.open = !AO.open; if (AO.open) { AO.pick = null; AO.color = S.color; } renderAddOpening(); if (AO.open) setTimeout(() => { const i = $("#aoSearch"); if (i) i.focus(); }, 50); return true; }
  if ("aopick" in d) { AO.pick = OPENING_LINES.find(o => o[2] === d.aopick) || null; AO.sel = new Set(); AO.view = null; renderAddOpening(); return true; }
  if ("aoback" in d) { AO.pick = null; AO.view = null; renderAddOpening(); return true; }
  if (d.aoview) { aoShow(d.aoview); return true; }
  if (d.aoply) { aoShow(AO.view, +d.aoply); return true; }
  if (d.aostep) { aoShow(AO.view, AO.ply + +d.aostep); return true; }
  if (d.aocolor) { AO.color = d.aocolor; renderAddOpening(); return true; }
  if ("aoall" in d) { const vars = variationsOf(AO.pick[2]); const all = vars.every(v => AO.sel.has(v[2])); AO.sel = all ? new Set() : new Set(vars.map(v => v[2])); renderAddOpening(); return true; }
  if ("aoadd" in d) {
    const color = AO.color || S.color, lines = [AO.pick[2], ...[...AO.sel]];
    const n = addOpeningLines(lines, color);
    toast(`Added ${aoName(AO.pick[1])}: ${n} new move${n === 1 ? "" : "s"} in your ${color === "white" ? "White" : "Black"} repertoire.`);
    Object.assign(AO, { open: false, pick: null, sel: new Set(), q: "" });
    if (color !== S.color) { S.color = color; render(); } else { renderAddOpening(); renderCatalogue(); }
    return true;
  }
  return false;
}
// The line under the variations, and the button: updated in place when a box is ticked, so
// the list doesn't redraw (and jump back to the top) on every tick
function aoChosen() { const vars = AO.pick ? variationsOf(AO.pick[2]) : []; return AO.pick ? [AO.pick[2], ...vars.filter(v => AO.sel.has(v[2])).map(v => v[2])] : []; }
function aoSummaryText(chosen, color) {
  const clash = aoConflicts(chosen, color), C = color === "white" ? "White" : "Black";
  return `${chosen.length} line${chosen.length === 1 ? "" : "s"} to add to your ${C} repertoire (${esc(prepBookName())}).${clash ? ` ${clash} of your move${clash === 1 ? "" : "s"} differ from what you already play: they're added as another option, nothing is replaced.` : ""}`;
}
const aoAddLabel = chosen => `Add ${chosen.length === 1 ? "this line" : chosen.length + " lines"}`;
function aoTick(v, on) {
  if (on) AO.sel.add(v); else AO.sel.delete(v);
  const chosen = aoChosen(), sum = $("#aoSum"), btn = $("#aoAddBtn"), all = $("#addOpenBox [data-aoall]");
  if (sum) sum.innerHTML = aoSummaryText(chosen, AO.color || S.color);
  if (btn) btn.textContent = aoAddLabel(chosen);
  if (all) all.textContent = variationsOf(AO.pick[2]).every(x => AO.sel.has(x[2])) ? "Untick all" : "Tick all";
}
/* ----- the preview board (v0.9.8) -----
   Shows the line being looked at, up to a chosen move: tap a variation's name, a move in the
   list, or ◀ ▶. Updated in place, so the list keeps its scroll position. */
let AOB = null;
function aoShow(sans, ply) {
  const el = $("#aoBoard");
  if (!el || !sans) return;
  const m = sans.split(" ");
  AO.view = sans;
  AO.ply = ply == null ? m.length : Math.max(0, Math.min(m.length, ply));
  if (!AOB || AOB.el !== el) { AOB = Board(el); AOB.locked = true; }
  AOB.flip = (AO.color || S.color) === "black";
  const c = new Chess();
  let last = null;
  for (let i = 0; i < AO.ply; i++) { const mv = c.move(m[i]); if (!mv) break; last = [mv.from, mv.to]; }
  AOB.set(c.fen(), { last });
  const o = OPENING_LINES.find(x => x[2] === sans), at = AO.ply ? openingFor(m.slice(0, AO.ply)) : null;
  $("#aoPrevName").textContent = AO.ply < m.length ? (at && at.name ? at.name : "Start") : o ? aoName(o[1]) : "";
  $("#aoPrevLine").innerHTML = m.map((s, i) => `${i % 2 === 0 ? `<span class="muted">${i / 2 + 1}.</span>` : ""}<button type="button" class="aoply${i + 1 === AO.ply ? " cur" : ""}" data-aoply="${i + 1}">${esc(s)}</button>`).join(" ");
  document.querySelectorAll("#addOpenBox [data-aoview]").forEach(b => b.classList.toggle("cur", b.dataset.aoview === sans));
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick(onAddOpeningClick); // its own data-ao* buttons
