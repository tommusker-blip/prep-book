"use strict";
/* ---------- v0.9.57: my decisions in Connect and Ideas, synced ----------
   Skipped chains, chains decided ("use this line") and options put away (Connect), and skipped ideas
   (Ideas) used to be kept on the device only (pb_conskip, pb_sugskip), so they came back on another
   device. Now they're in the settings doc (S.settings.decisions[area], with the time each was made
   in S.settings.decidedAt[area]), so they sync. They're meant to be revisited: Connect and Ideas each list
   them ("Skipped and decided") with Bring back for each, or all.
   The local copies are read once and merged in (migrate()), then removed.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const Decide = {
  ver: 0,
  migrated: false,
  migrate() {
    if (this.migrated) return;
    this.migrated = true;
    const d = S.settings.decisions || (S.settings.decisions = {}), at = S.settings.decidedAt || (S.settings.decidedAt = {}), now = Date.now();
    let moved = false;
    for (const [area, ls] of [["con", "pb_conskip"], ["sug", "pb_sugskip"]]) {
      const local = lsGet(ls, null);
      if (!local) continue;
      const m = d[area] || (d[area] = {}), a = at[area] || (at[area] = {});
      for (const [k, v] of Object.entries(local)) if (!(k in m)) { m[k] = v; a[k] = now; moved = true; }
      try { localStorage.removeItem(ls); } catch (e) {}
    }
    if (moved) Store.save("settings");
  },
  // The live object for an area ("con" | "sug"): change it, then save()
  all(area) { this.migrate(); const d = S.settings.decisions || (S.settings.decisions = {}); return d[area] || (d[area] = {}); },
  at(area, key) { return ((S.settings.decidedAt || {})[area] || {})[key] || 0; },
  save(area, obj) {
    const all = S.settings.decidedAt || (S.settings.decidedAt = {}), at = all[area] || (all[area] = {}), now = Date.now();
    for (const k of Object.keys(obj)) if (!at[k]) at[k] = now;
    for (const k of Object.keys(at)) if (!(k in obj)) delete at[k];
    (S.settings.decisions || (S.settings.decisions = {}))[area] = obj;
    this.ver++;
    Store.save("settings");
  },
  drop(area, keys) { const o = this.all(area); keys.forEach(k => delete o[k]); this.save(area, o); },
  // A changing number for memo signatures: changes on a save here and when a sync brings other decisions
  sig(area) { return this.ver + ":" + Object.keys(this.all(area)).length; },
};
// The review list: [{k, html, at}] newest first, as a <details> with Bring back buttons (data-<name>="key")
function decisionsHtml(items, name, label = "Skipped and decided") {
  if (!items.length) return "";
  items.sort((a, b) => b.at - a.at);
  return `<details class="decbox"><summary>${label} (${items.length})</summary>
    <p class="help">Bring one back to see it again; nothing in your tree changes.</p>
    <ul class="declist">${items.map(x => `<li><span>${x.html}${x.at ? ` <span class="muted">· ${esc(agoText(x.at))}</span>` : ""}</span><button type="button" class="btn ghost quick" data-${name}="${esc(x.k)}">Bring back</button></li>`).join("")}</ul>
    ${items.length > 1 ? `<button type="button" class="btn ghost quick" data-${name}="*">Bring all ${items.length} back</button>` : ""}</details>`;
}
