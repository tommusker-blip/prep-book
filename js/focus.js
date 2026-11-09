"use strict";
/* ---------- focus on one opening (v0.9.24) ----------
   Pick an opening (Openings > an entry > Build or Train, or Practise under the Build board) and
   Build and Train stay on it until it's cleared:
   - Build: ⏮ goes back to where the opening starts, and Gap › only goes to gaps inside it.
   - Train: Review positions only takes cards inside it, and Practise lines starts there. At the
     end of a practised line, "Build from here" opens Build at that position, so you can test,
     extend, and test again.
   The focus is the practise-lines root kept per colour in settings (S.settings.practiceRoot, so
   it syncs and survives a reload); practiceRoot() (practice.js) drops it if it leaves the tree.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const focusPath = (color = S.color) => practiceRoot(color);
const focusOn = (color = S.color) => focusPath(color).length > 0;
function setFocus(path, color = S.color) {
  S.settings.practiceRoot = { ...(S.settings.practiceRoot || {}), [color]: path.slice() };
  gapLast = null;
  Store.save("settings");
}
const clearFocus = (color = S.color) => setFocus([], color);
// Is this path (array or string) inside the focus? Everything is when there's none.
function inFocus(path, color = S.color) {
  const f = focusPath(color).join(" "), p = Array.isArray(path) ? path.join(" ") : path;
  return !f || p === f || p.startsWith(f + " ");
}
function focusName(color = S.color) {
  const p = focusPath(color), o = p.length ? openingFor(p) : null;
  return o ? o.name : numbered(0, p);
}
// The bar shown on Build and on the Train page while a focus is set
function focusBar(where) {
  if (!focusOn()) return "";
  const p = focusPath();
  const act = where === "build"
    ? `<button type="button" class="btn ghost quick" data-focustrain>Practise it</button>`
    : `<button type="button" class="btn ghost quick" data-focusbuild>Build it</button>`;
  return `<div class="focusbar" role="status"><span class="ftxt"><span class="flbl">Focus</span> <b>${esc(focusName())}</b> <span class="mono muted">${esc(numbered(0, p))}</span></span>
    <span class="fbtns">${act}<button type="button" class="btn ghost quick" data-focusclear aria-label="Clear the focus: stop focusing on this opening">✕</button></span></div>`;
}
function drawFocusBars() {
  const b = $("#focusBuild"), t = $("#focusTrain");
  if (b) b.innerHTML = focusBar("build");
  if (t) t.innerHTML = focusBar("train");
}
// Gaps for Gap ›: only inside the focus
const focusGaps = list => list.filter(g => inFocus(g.opp ? g.path.concat(g.opp) : g.path));
// Training cards inside the focus
const focusCard = key => { const n = rep().pos[key]; return !!n && inFocus(n.path || ""); };

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
function focusBuild(path) { setFocus(path); S.build[S.color] = path.slice(); S.ptab = "moves"; setView("build"); window.scrollTo({ top: 0 }); }
function focusTrain(path) { setFocus(path); setView("train"); startLines(); }
onClick("focusbuild", d => focusBuild(d.focusbuild != null && d.focusbuild !== "" ? d.focusbuild.split(" ") : focusPath()), true);
onClick("focustrain", d => focusTrain(d.focustrain != null && d.focustrain !== "" ? d.focustrain.split(" ") : focusPath()), true);
onClick("focusclear", d => { clearFocus(); render(); }, true);
