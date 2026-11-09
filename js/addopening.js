"use strict";
/* ---------- Openings > Add an opening (v0.9.7) ----------
   Search the named openings (Lichess chess-openings, js/openlines.js, loaded on first use),
   pick one, and add its moves to the White or Black repertoire, with any of its deeper
   variations from the same dataset (the lines that continue it). Where my repertoire already
   has a different move of mine, the line's move is added as another option, and the preview
   says how many. Everything goes through addMove(), like Build. */
const AO = { open: false, q: "", pick: null, color: null, sel: new Set(), loading: null };
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
    const [eco, name, sans] = AO.pick, vars = variationsOf(sans);
    const chosen = [sans, ...vars.filter(v => AO.sel.has(v[2])).map(v => v[2])];
    const C = c => (c === "white" ? "White" : "Black");
    box.innerHTML = `<div class="aohead"><button type="button" class="btn ghost quick" data-aoback>‹ Search</button><b>${esc(eco)} ${esc(aoName(name))}</b></div>
      <p class="mono aoline">${esc(numbered(0, sans.split(" ")))}</p>
      <div class="row aocolor"><span class="lbl">Add to</span><div class="seg small" role="group" aria-label="Which repertoire">${["white", "black"].map(c => `<button type="button" data-aocolor="${c}" aria-pressed="${c === color}">${C(c)}</button>`).join("")}</div></div>
      ${vars.length ? `<p class="lbl" style="margin-top:10px">Its variations (${vars.length}${vars.length === 60 ? "+" : ""}): tick the ones to add too</p>
        <div class="row" style="margin:2px 0 4px"><button type="button" class="btn ghost quick" data-aoall>${vars.every(v => AO.sel.has(v[2])) ? "Untick all" : "Tick all"}</button></div>
        <div class="aovars">${vars.map(v => `<label class="check aovar"><input type="checkbox" data-aovar="${esc(v[2])}" ${AO.sel.has(v[2]) ? "checked" : ""}><span><b>${esc(aoName(v[1]).replace(aoName(name) + ": ", "").replace(aoName(name) + ", ", ""))}</b> <span class="mono help">${esc(numbered(0, v[2].split(" ")).split(" ").slice(-4).join(" "))}</span></span></label>`).join("")}</div>` : `<p class="help">No deeper variations of this line in the list.</p>`}
      <p class="help" id="aoSum" style="margin-top:8px">${aoSummaryText(chosen, color)}</p>
      <div class="row"><button type="button" class="btn" id="aoAddBtn" data-aoadd>${aoAddLabel(chosen)}</button></div>`;
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
  if ("aopick" in d) { AO.pick = OPENING_LINES.find(o => o[2] === d.aopick) || null; AO.sel = new Set(); renderAddOpening(); return true; }
  if ("aoback" in d) { AO.pick = null; renderAddOpening(); return true; }
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
