"use strict";
/* ---------- Stockfish ---------- */
const SF_URL = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js";
const Engine = {
  w: null, ready: null, queue: Promise.resolve(), handler: null, failed: false,
  init() {
    if (this.ready) return this.ready;
    this.ready = new Promise((res, rej) => {
      try {
        const blob = new Blob([`importScripts(${JSON.stringify(SF_URL)});`], { type: "application/javascript" });
        this.w = new Worker(URL.createObjectURL(blob));
      } catch (e) { this.failed = true; rej(e); return; }
      const to = setTimeout(() => { this.failed = true; rej(new Error("Engine did not start")); }, 25000);
      this.w.onmessage = e => {
        const line = typeof e.data === "string" ? e.data : String(e.data);
        if (line === "uciok") { clearTimeout(to); this.w.postMessage("setoption name Hash value 16"); res(); }
        if (this.handler) this.handler(line);
      };
      this.w.onerror = () => { clearTimeout(to); this.failed = true; rej(new Error("Engine failed to load")); };
      this.w.postMessage("uci");
    });
    return this.ready;
  },
  analyse(fen, depth = 12) {
    const key = K(fen);
    if (EVALC[key] && EVALC[key].d >= depth) return Promise.resolve(EVALC[key]);
    const job = this.queue.then(() => this.init()).then(() => new Promise(res => {
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
          const out = { cp: last.cp, mate: last.mate, best: last.best, pv: last.pv, d: depth };
          EVALC[key] = out;
          res(out);
        }
      };
      this.w.postMessage("position fen " + fen);
      this.w.postMessage("go depth " + depth);
    }));
    this.queue = job.catch(() => {});
    return job;
  },
};
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
