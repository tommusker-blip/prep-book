"use strict";
/* Settings: board looks, the settings form, and prep books.
   Classic script: shares one global scope with the others (see index.html for the load order). */
/* ----- settings ----- */
function renderLook() {
  const set = pieceSet(), theme = S.settings.board || "green";
  const row = ["wK", "bQ", "wN", "bB", "wR", "bP"];
  $("#lookPreview").innerHTML = row.map((x, i) => `<span class="sq${i % 2 ? " dk" : ""}" style="--f:${i};--r:${i % 2 ? 4 : 3}">${pieceHtml({ color: x[0], type: x[1].toLowerCase() }, set)}</span>`).join("");
  $("#pieceSets").innerHTML = PIECE_SETS.map(p => `<button type="button" class="chip lookchip" aria-pressed="${p.id === set}" data-pieces="${p.id}">${pieceHtml({ color: "w", type: "n" }, p.id)}<span>${esc(p.name)}</span></button>`).join("");
  $("#boardThemes").innerHTML = BOARD_THEMES.map(t => `<button type="button" class="chip lookchip" aria-pressed="${t.id === theme}" data-boardtheme="${t.id}"><span class="swatch" data-swatch="${t.id}"><i></i><i></i></span><span>${esc(t.name)}</span></button>`).join("");
  $("#arrowOpt").innerHTML = [["on", "Show"], ["off", "Hide"]].map(([v, l]) => `<button type="button" class="chip" aria-pressed="${(S.settings.arrows !== false) === (v === "on")}" data-arrows="${v}">${l}</button>`).join("");
  $("#autoOpp").value = autoOppMode();
  const th = ["light", "dark", "system"].includes(S.settings.theme) ? S.settings.theme : "light";
  $("#appTheme").innerHTML = [["light", "Light"], ["dark", "Dark"], ["system", "Match my phone"]].map(([v, l]) => `<button type="button" class="chip" aria-pressed="${v === th}" data-apptheme="${v}">${l}</button>`).join("");
  $("#pieceCredits").innerHTML = PIECE_SETS.map(p => `<li><b>${esc(p.name)}</b>: ${esc(p.credit)}</li>`).join("");
}
function renderSettings() {
  renderBooks();
  renderLook();
  renderGaps(); // Gap › ranking buttons
  $("#setUser").value = S.settings.user;
  $("#setToken").value = S.token;
  $("#setMonths").value = String(S.settings.months);
  const gem = { ...gemDefaults(), ...S.settings.gem };
  $("#gemMin").value = gem.min; $("#gemFreq").value = gem.freq; $("#gemEdge").value = gem.edge;
  $("#gemTrapErr").value = gem.trapErr ?? 30; $("#gemTrapLoss").value = ((gem.trapLoss ?? 150) / 100).toFixed(1);
  const a = adv();
  $("#advGood").value = (a.good / 100).toFixed(1); $("#advMistake").value = (a.mistake / 100).toFixed(1); $("#advClock").value = a.clock; $("#advK").value = a.k; $("#advUnplayable").value = (a.unplayable / 100).toFixed(1);
  const cc = S.settings.ccRating, sug = cc ? bandsFor(cc.r) : null;
  $("#bandHint").innerHTML = !cc ? (validChessComUser(S.settings.user || "") ? "Your chess.com rating will be checked to suggest bands." : "Add your chess.com username to get bands that match your rating.")
    : `Your chess.com rapid rating is <b>${cc.r}</b>, which suggests Lichess <b>${bandLabel(sug)}</b>. ` + (S.settings.bandAuto === false
      ? `You've set the bands by hand. <button type="button" class="linkbtn" data-bandauto>Follow my rating again</button>`
      : "The bands follow your rating automatically; tap a band to set them by hand.");
  $("#bands").innerHTML =BANDS.map(b => `<button type="button" class="chip" aria-pressed="${S.settings.band.includes(b)}" data-band="${b}">${b}${b === 2500 ? "+" : "–" + (b === 2200 ? 2499 : b + 199)}</button>`).join("");
  $("#storeNote").textContent = S.storeMode === "db"
    ? "Your repertoire and games are saved to your Claude account, so they follow you between your phone and computer. The Lichess token stays on this device."
    : S.storeMode === "supabase"
    ? `Saved to your database, signed in as ${Store.user && Store.user.email ? Store.user.email : "you"}. Sign in with the same account on another device to pick up where you left off. The Lichess token stays on this device.`
    : "Your data is saved in this browser only. Use Export regularly as a backup.";
  $("#signOut").hidden = S.storeMode !== "supabase";
  $("#signIn").hidden = !(S.storeMode === "local" && window.supabase && !window.claude);
  const w = Object.keys(rep("white").cards).length, b = Object.keys(rep("black").cards).length;
  $("#repCounts").textContent = `White: ${w} of your moves · Black: ${b} of your moves`;
}

/* ---------- prep books ---------- */
const prepBookName = (id = S.book) => (bookList().find(b => b.id === id) || { name: "My prep" }).name;
const bookCount = (id, color) => Object.keys((S.books[id] && S.books[id][color].cards) || {}).length;
function resetWorkspace() {
  stopTraining(); T.state = "idle";
  S.build = { white: [], black: [] };
  walk("white"); walk("black");
}
function switchBook(id) {
  S.settings.book = id; openBook(id); resetWorkspace();
  Store.save("settings");
  renderHeader(); render();
  toast(`Opened "${prepBookName()}".`);
}
function createBook(copy) {
  const id = Date.now().toString(36);
  const list = bookList(); // before the new book exists, so it isn't listed twice
  const name = copy ? `${prepBookName()} (copy)` : `Book ${list.length + 1}`;
  S.books[id] = copy ? JSON.parse(JSON.stringify(S.rep)) : { white: emptyRep(), black: emptyRep() };
  S.settings.books = [...list, { id, name }];
  Store.save(repDoc("white", id)); Store.save(repDoc("black", id));
  switchBook(id);
}
function deleteBook() {
  const id = S.book;
  if (id === "main") return;
  delete S.books[id];
  S.settings.books = bookList().filter(b => b.id !== id);
  Store.save(repDoc("white", id)); Store.save(repDoc("black", id)); // saved as deleted, so other devices drop it too
  switchBook("main");
}
function clearRep(color) {
  S.rep[color] = emptyRep(); S.build[color] = []; stopTraining(); T.state = "idle";
  Store.save(repDoc(color));
  render();
}
function renderBooks() {
  const list = bookList();
  $("#bookList").innerHTML = list.map(b => `<li class="bookrow"><div><b>${esc(b.name)}</b>${b.id === S.book ? ' <span class="pill ok">Open</span>' : ""}
    <div class="help">White: ${bookCount(b.id, "white")} of your moves · Black: ${bookCount(b.id, "black")}</div></div>
    ${b.id === S.book ? "" : `<button type="button" class="btn ghost" data-openbook="${esc(b.id)}">Open</button>`}</li>`).join("");
  $("#bookRename").value = prepBookName();
  $("#bookDelete").hidden = S.book === "main";
  $("#bookConfirm").hidden = true;
}
// Inline "are you sure?" for destructive book actions
function confirmBook(text, label, fn) {
  const box = $("#bookConfirm");
  box.innerHTML = `<p>${text}</p><div class="row"><button type="button" class="btn" id="bcYes">${esc(label)}</button><button type="button" class="btn ghost" id="bcNo">Cancel</button></div>`;
  box.hidden = false;
  $("#bcYes").onclick = () => { box.hidden = true; fn(); };
  $("#bcNo").onclick = () => { box.hidden = true; };
}
function onBookAction(act) {
  const nm = esc(prepBookName());
  if (act === "new") createBook(false);
  else if (act === "copy") createBook(true);
  else if (act === "delete") confirmBook(`Delete the book <b>${nm}</b> with both its repertoires and its training history? This can't be undone. Export it first if you might want it back.`, "Delete book", deleteBook);
  else if (act.startsWith("clear-")) {
    const c = act.slice(6), C = c === "white" ? "White" : "Black";
    confirmBook(`Remove every move from the ${C} repertoire in <b>${nm}</b>, with its training history? Other books aren't affected. Export it first if you might want it back.`, `Clear ${C}`, () => { clearRep(c); renderBooks(); toast(`${C} repertoire cleared.`); });
  }
}


/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("arrows", d => { S.settings.arrows = d.arrows === "on"; Store.save("settings"); renderLook(); });
onClick("openbook", d => switchBook(d.openbook));
onClick("bookact", d => onBookAction(d.bookact));
onClick("pieces", d => { S.settings.pieces = d.pieces; pieceFallback = false; Store.save("settings"); redrawBoards(); renderLook(); });
onClick("apptheme", d => { S.settings.theme = d.apptheme; lsSet("pb_theme", d.apptheme); Store.save("settings"); applyLook(); renderLook(); });
onClick("boardtheme", d => { S.settings.board = d.boardtheme; Store.save("settings"); redrawBoards(); renderLook(); });
onClick("bandauto", d => { S.settings.bandAuto = true; Store.save("settings"); if (S.settings.ccRating) { S.settings.band = bandsFor(S.settings.ccRating.r); } fetchRating(true); renderSettings(); }, true);
onClick("band", d => { const b = +d.band, set = new Set(S.settings.band); set.has(b) ? set.delete(b) : set.add(b); if (!set.size) { toast("Keep at least one rating band."); return; } S.settings.band = [...set].sort((x, y) => x - y); S.settings.bandAuto = false; Store.save("settings"); renderSettings(); });
