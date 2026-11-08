"use strict";
/* ---------- Stockfish ---------- */
// Main engine: Stockfish 17.1 "lite single-threaded" WebAssembly build, self-hosted in engine/
// (GPLv3, see engine/Copying.txt). About 7 MB, downloaded once and then cached by the browser.
// It needs no cross-origin isolation headers, which GitHub Pages can't send.
// Fallback: the old asm.js Stockfish 10 from cdnjs, if WebAssembly or the worker fails.
// Resolved against this script's own URL (js/engine.js), so it works from any page
const SF_WASM = new URL("../engine/stockfish-17.1-lite-single-03e3232.js", (document.currentScript && document.currentScript.src) || location.href).href;
const SF_ASM = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js";
const Engine = {
  w: null, ready: null, handler: null, failed: false, which: "",
  init() {
    if (this.ready) return this.ready;
    const wasmOk = typeof WebAssembly === "object" && location.protocol !== "file:";
    this.ready = (wasmOk ? this.start("wasm", 90000).catch(() => this.start("asm", 25000)) : this.start("asm", 25000))
      .catch(e => { this.failed = true; this.ready = null; throw e; }); // allow a retry later
    return this.ready;
  },
  // Start one engine build and resolve once it answers "uciok"
  start(which, timeout) {
    return new Promise((res, rej) => {
      if (this.w) { this.w.terminate(); this.w = null; }
      let w;
      try {
        w = which === "wasm"
          ? new Worker(SF_WASM)
          : new Worker(URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(SF_ASM)});`], { type: "application/javascript" })));
      } catch (e) { rej(e); return; }
      this.w = w;
      const fail = msg => { clearTimeout(to); w.terminate(); if (this.w === w) this.w = null; rej(new Error(msg)); };
      const to = setTimeout(() => fail(`Engine (${which}) did not start`), timeout);
      w.onmessage = e => {
        const line = typeof e.data === "string" ? e.data : String(e.data);
        if (line === "uciok") { clearTimeout(to); this.which = which; w.postMessage("setoption name Hash value 16"); res(); }
        if (this.handler) this.handler(line);
      };
      w.onerror = () => fail(`Engine (${which}) failed to load`);
      w.postMessage("uci");
    });
  },
  // A cached eval that's good enough: deep enough, and from the WASM engine (old Stockfish 10
  // evals are only reused when that's the engine we're running too)
  cached(fen, depth) {
    const hit = EVALC[K(fen)];
    return hit && hit.d >= depth && (hit.e === "wasm" || this.which === "asm") ? hit : null;
  },
  // Analyse through the job queue (G3). opts: {prio, stale} - see jobs.js; {cache: false} for
  // bulk work (game analysis) that shouldn't fill the local cache or the database. Otherwise
  // results go to the local cache and, through Evals (G2), to the database.
  analyse(fen, depth = 12, opts = {}) {
    const store = opts.cache !== false;
    const hit = this.cached(fen, depth);
    if (hit) return Promise.resolve(hit);
    return Jobs.add("engine", async () => {
      const again = this.cached(fen, depth); // another job may have done it meanwhile
      if (again) return again;
      if (store && typeof Evals !== "undefined") { const remote = await Evals.lookup(fen, depth); if (remote) return remote; }
      const out = await this.search(fen, depth, store);
      if (store && typeof Evals !== "undefined") Evals.put(fen, out);
      return out;
    }, { prio: opts.prio ?? PRIO.background, key: K(fen) + "|" + depth + (store ? "" : "|nc"), stale: opts.stale || null });
  },
  // MultiPV (NOTES item 7): the engine's top n moves in a position, each with its eval (cp from
  // the side to move), through the job queue. Cached locally (MPV, pb_mpv) and in the database
  // (Evals, kind "mpv").
  multi(fen, depth = 12, n = 5, opts = {}) {
    const key = K(fen), ok = h => h && h.d >= depth && h.n >= n;
    if (ok(MPV[key])) return Promise.resolve(MPV[key]);
    return Jobs.add("engine", async () => {
      if (ok(MPV[key])) return MPV[key];
      if (typeof Evals !== "undefined") { const remote = await Evals.lookup(fen, depth, "mpv"); if (ok(remote)) return remote; }
      const out = await this.searchMulti(fen, depth, n);
      MPV[key] = out; saveMpvSoon();
      if (typeof Evals !== "undefined") Evals.put(fen, out, "mpv");
      return out;
    }, { prio: opts.prio ?? PRIO.background, key: "mpv|" + key + "|" + depth + "|" + n, stale: opts.stale || null });
  },
  searchMulti(fen, depth, n) {
    return this.init().then(() => new Promise(res => {
      const lines = {};
      const score = m => (m[1] === "cp" ? +m[2] : +m[2] > 0 ? 3000 - +m[2] : -3000 - +m[2]);
      this.handler = line => {
        if (line.startsWith("info") && line.includes(" multipv ") && line.includes(" score ")) {
          const k = +line.match(/ multipv (\d+)/)[1], m = line.match(/score (cp|mate) (-?\d+)/), pv = line.match(/ pv (\S+)/);
          if (m && pv) lines[k] = { uci: pv[1], cp: score(m), mate: m[1] === "mate" ? +m[2] : undefined };
        } else if (line.startsWith("bestmove")) {
          this.handler = null;
          this.w.postMessage("setoption name MultiPV value 1");
          res({ d: depth, n, e: this.which, lines: Object.keys(lines).sort((a, b) => a - b).map(k => lines[k]) });
        }
      };
      this.w.postMessage("setoption name MultiPV value " + n);
      this.w.postMessage("position fen " + fen);
      this.w.postMessage("go depth " + depth);
    }));
  },
  // One search on the worker. Only ever called from the engine lane, so never two at once.
  search(fen, depth, store = true) {
    const key = K(fen);
    return this.init().then(() => new Promise(res => {
      let last = { cp: 0, best: null, pv: [] };
      this.handler = line => {
        if (line.startsWith("info") && line.includes(" score ")) {
          const m = line.match(/score (cp|mate) (-?\d+)/);
          const pv = line.match(/ pv (.+)$/);
          if (m) last.cp = m[1] === "cp" ? +m[2] : (+m[2] > 0 ? 3000 - +m[2] : -3000 - +m[2]);
          if (m && m[1] === "mate") last.mate = +m[2]; else delete last.mate;
          if (pv) last.pv = pv[1].split(" ").slice(0, 6);
        } else if (line.startsWith("bestmove")) {
          last.best = line.split(" ")[1];
          this.handler = null;
          if (new Chess(fen).game_over()) { last.cp = new Chess(fen).in_checkmate() ? -3000 : 0; }
          const out = { cp: last.cp, mate: last.mate, best: last.best, pv: last.pv, d: depth, e: this.which };
          if (store) EVALC[key] = out;
          res(out);
        }
      };
      this.w.postMessage("position fen " + fen);
      this.w.postMessage("go depth " + depth);
    }));
  },
};
// MultiPV results by position key: {d, n, e, lines: [{uci, cp, mate}]}
let MPV = lsGet("pb_mpv", {}), mpvTimer = null;
function saveMpvSoon() {
  clearTimeout(mpvTimer);
  mpvTimer = setTimeout(() => { const k = Object.keys(MPV); if (k.length > 1500) for (const x of k.slice(0, k.length - 1300)) delete MPV[x]; lsSet("pb_mpv", MPV); }, 1500);
}
function saveEvalCache() {
  const keys = Object.keys(EVALC);
  if (keys.length > 4000) for (const k of keys.slice(0, 800)) delete EVALC[k];
  lsSet("pb_eval", EVALC);
}
function uciToSan(fen, uci) {
  if (!uci) return "";
  const c = new Chess(fen);
  const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
  return mv ? mv.san : uci;
}
function fmtEval(cp, mate, fenSide, persp) {
  // cp is from side-to-move; show from White's view
  const s = fenSide === "w" ? 1 : -1;
  if (mate != null) { const m = mate * s; return (m > 0 ? "#" : "#-") + Math.abs(m); }
  const v = (cp * s) / 100;
  return (v > 0 ? "+" : "") + v.toFixed(2);
}
// Lichess-style move accuracy from centipawn evals (mover's perspective)
const winPct = cp => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1500, Math.min(1500, cp)))) - 1);
const moveAcc = (before, after) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, winPct(before) - winPct(after))) - 3.1669));
