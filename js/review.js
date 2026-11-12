"use strict";
/* ---------- game review (v0.9.26): opening accuracy in a recent game, and where I left prep ----------
   Games > Recent games > a game opens its own screen (S.view "review"):
   - the board, stepping through the game with ◀ ▶ or the move list. Moves still in my prep are
     underlined blue; the move where the game left it is outlined orange; my moves that lost more
     than the good / mistake margins (adv()) at the game's depth-10 analysis get ?! / ?.
   - the opening's accuracy, worked out from the analysis against the repertoire as it is now:
     in book, and for my 8 plies after it (as the importer does), plus my worst moves in the
     first REV_OPENING plies.
   - the deviation card, with what to do about it in my tree:
       I played something else (misplay): make my game move the repertoire move, add it as another
         option, or take Stockfish's move; Compare in Build opens both rows.
       I had no move: add the move I played, or Stockfish's.
       They played something new (opp_new / end): add their move, with my reply from the game.
     Every change goes through RepUndo ("rev"), with Undo. The repertoire move's eval is asked
     from Stockfish (depth 12) when the card opens; the others come from the game's analysis.
   Classic script: shares one global scope with the others (see index.html for the load order). */
const REV_OPENING = 30, REV_LIST = 20;
let RVB = null;
const RV = { g: null, frames: [], i: 0, back: "games", prepCp: null, token: 0, shown: REV_LIST, play: 0, playTo: 0 };
const revColorSign = g => (g.my === "white" ? 1 : -1);
// v0.9.47: evals are always shown from White's side (+ good for White, − good for Black), whoever I am
const whiteTxt = cp => (Math.abs(cp) >= 5000 ? (cp > 0 ? "+M" : "−M") : (cp > 0 ? "+" : cp < 0 ? "−" : "") + Math.abs(cp / 100).toFixed(1));
const pawnsTxt = cp => (Math.abs(cp) >= 5000 ? (cp > 0 ? "winning" : "losing") : (cp > 0 ? "+" : cp < 0 ? "−" : "") + Math.abs(cp / 100).toFixed(1));
// Per ply: who moved, cp lost by the mover (from the game's analysis), and the mark
function revMoves(g, a) {
  const z = S.acc[g.id], ev = z && z.v === 2 ? z.ev : null, moves = g.moves ? g.moves.split(" ") : [], A = adv();
  return moves.map((san, i) => {
    const mine = (i % 2 === 0) === (g.my === "white");
    let loss = null;
    if (ev && ev[i] != null && ev[i + 1] != null) loss = Math.max(-1000, Math.min(1000, (i % 2 === 0 ? 1 : -1) * (ev[i] - ev[i + 1])));
    const mark = mine && loss != null && i < REV_OPENING + 20 ? (loss >= A.mistake ? "?" : loss >= A.good ? "?!" : "") : "";
    return { san, mine, loss, mark, prep: i < a.ply, dev: i === a.ply && a.type !== "full" };
  });
}
// Accuracy of my moves in book, and in my 8 plies after it, from the game's analysis
function revAccuracy(g, a) {
  const z = S.acc[g.id];
  if (!z || z.v !== 2) return null;
  const s = revColorSign(g), mineCp = i => s * z.ev[i], inb = [], post = [];
  for (let i = 0; i + 1 < z.ev.length && i < a.ply + 8; i++) {
    if ((i % 2 === 0) !== (g.my === "white")) continue;
    (i < a.ply ? inb : post).push(moveAcc(mineCp(i), mineCp(i + 1)));
  }
  const avg = x => (x.length ? Math.round(x.reduce((p, q) => p + q, 0) / x.length) : null);
  return { inb: avg(inb), post: avg(post), exitCp: z.ev[Math.min(a.ply, z.ev.length - 1)] * s };
}
const revTypeLabel = { misplay: "You left your prep", you_new: "You had no move ready", opp_new: "Your opponent surprised you", end: "You reached the end of your prep", full: "The game stayed in your prep" };
// at (v0.9.43): open at that ply instead of the deviation, playing the moves up to it (revPlay())
function openReview(id, back, at) {
  const g = S.games.find(x => x.id === id);
  if (!g) return;
  if (!RVB) { RVB = Board($("#rvBoard")); RVB.locked = true; }
  S.color = g.my;
  const a = analyseGame(g);
  Object.assign(RV, { g, back: back || S.view, frames: framesTo(g.moves ? g.moves.split(" ") : []), prepCp: null });
  RV.i = Math.min(at != null ? at : a.ply, RV.frames.length - 1);
  RV.token++; RV.play++;
  RVB.flip = g.my === "black";
  const to = RV.i;
  if (at != null && !reduceMotion()) RV.i = 0;
  setView("review");
  window.scrollTo({ top: 0 });
  askPrepEval();
  if (at != null) revPlay(to);
}
/* Play the game from the start up to ply `to`, in about REV_PLAY_MS at most (one slide per move when
   that fits). Stopped by any other step (revGo()) or a tap on the board. No replay with reduced motion. */
const REV_PLAY_MS = 3000;
function revPlay(to) {
  const tok = ++RV.play;
  if (reduceMotion() || to <= 0) { RV.i = to; renderReview(); return; }
  const ms = Math.min(SLIDE_MS + 40, REV_PLAY_MS / to);
  const step = () => {
    if (tok !== RV.play || S.view !== "review") return;
    RV.i++; renderReview();
    if (RV.i < to) setTimeout(step, ms); else RV.playTo = 0;
  };
  RV.playTo = to;
  setTimeout(step, ms);
}
// The repertoire move's eval at the deviation, from Stockfish (depth 12), for the misplay card
async function askPrepEval() {
  const g = RV.g, a = analyseGame(g), tok = RV.token;
  if (a.type !== "misplay") return;
  const R = rep(g.my), n = R.pos[a.key], fen = fenAfter(START, a.path);
  if (!n) return;
  const out = {};
  for (const san of n.m) {
    try {
      const f = fenAfter(fen, [san]);
      if (!f) continue;
      const r = await Engine.analyse(f, 12, { prio: PRIO.now });
      out[san] = -r.cp; // the opponent is to move after it: from my side
    } catch (e) { break; } // no engine: show what we have, without "checking…"
    if (tok !== RV.token) return;
  }
  RV.prepCp = { key: a.key, cp: out };
  if (S.view === "review") renderReview();
}
function renderReview() {
  const g = RV.g;
  if (!g) { setView(RV.back || "games"); return; }
  const a = analyseGame(g), mv = revMoves(g, a), acc = revAccuracy(g, a), z = S.acc[g.id];
  const opp = g.my === "white" ? g.black : g.white, oe = g.my === "white" ? g.belo : g.welo, s = myScore(g);
  $("#rvTitle").textContent = `vs ${opp}`;
  // board: at the deviation, arrows for the game move (orange), my prep (blue) and Stockfish (grey)
  const f = RV.frames[RV.i], arrows = [];
  const arrow = (fen, san, kind, w) => { const c = new Chess(fen), m = c.move(san, { sloppy: true }); if (m) arrows.push({ from: m.from, to: m.to, w, kind }); };
  if (RV.i === a.ply && a.type !== "full") {
    const n = rep(g.my).pos[a.key];
    if (n && a.type === "misplay") n.m.forEach(x => arrow(f.fen, x, "mine", 0.7));
    if (mv[a.ply]) arrow(f.fen, mv[a.ply].san, a.type === "misplay" || a.type === "you_new" ? "played" : "gap", 0.7);
    const best = z && z.bm && z.bm[a.ply];
    if (best) { const bs = uciToSan(f.fen, best); if (bs && bs !== (mv[a.ply] || {}).san) arrow(f.fen, bs, "other", 0.45); }
  }
  RVB.set(f.fen, { last: f.last, arrows });
  // the move list
  $("#rvLine").innerHTML = mv.map((m, k) => `${k % 2 === 0 ? `<span class="mn">${k / 2 + 1}.</span>` : ""}<button type="button" class="mv${m.prep ? " prep" : ""}${m.dev ? " dev" : ""}${k + 1 === RV.i ? " cur" : ""}" data-rvply="${k + 1}" aria-label="Go to ${esc(moveLabel(mv.slice(0, k).map(x => x.san), m.san))}${m.prep ? ", in your prep" : ""}${m.dev ? ", where the game left your prep" : ""}${m.mark ? (m.mark === "?" ? ", a mistake" : ", an inaccuracy") : ""}">${esc(m.san)}${m.mark ? `<span class="mk">${m.mark}</span>` : ""}</button>`).join("");
  const cur = $("#rvLine .mv.cur");
  if (cur) cur.scrollIntoView({ block: "nearest" });
  // the deviation card
  $("#rvNote").innerHTML = revNote(g, a, mv);
  // the summary
  const res = s === 1 ? '<span class="pill ok">Won</span>' : s === 0.5 ? '<span class="pill">Draw</span>' : s === 0 ? '<span class="pill gap">Lost</span>' : "";
  const op = openingFor(a.path);
  const worst = mv.map((m, k) => ({ ...m, k })).filter(m => m.mine && m.mark && m.k < REV_OPENING && !m.prep).sort((p, q) => q.loss - p.loss).slice(0, 3);
  $("#rvSum").innerHTML = `<p class="possum">${res} vs ${esc(opp)} <span class="muted">(${oe || "?"})</span> · ${esc(g.date || "")}${g.url ? ` · <a href="${esc(g.url)}" target="_blank" rel="noopener">chess.com</a>` : ""}</p>
    ${op ? `<p class="help">${esc(op.name)}</p>` : ""}
    <p class="help">In your prep until move ${Math.floor(a.ply / 2) + 1}${a.type === "full" ? " (the end of the game or of the opening)" : ""}.</p>
    ${acc ? `<div class="tiles rvtiles"><div><b class="big num">${acc.inb ?? "–"}${acc.inb != null ? "<small>%</small>" : ""}</b><span>accuracy in your prep</span></div><div><b class="big num">${acc.post ?? "–"}${acc.post != null ? "<small>%</small>" : ""}</b><span>accuracy just after it</span></div><div><b class="big num">${whiteTxt(acc.exitCp * revColorSign(g))}</b><span>eval when you left it (+ White, − Black)</span></div></div>`
      : `<p class="help">Not analysed yet: Games &gt; Analyse all gives the accuracy and the marks.</p>`}
    ${worst.length ? `<p class="lbl" style="margin-top:8px">Your costliest opening moves after prep</p><ul class="list rvworst">${worst.map(m => `<li><button type="button" class="linkish" data-rvply="${m.k}">${esc(moveLabel(mv.slice(0, m.k).map(x => x.san), m.san))}${m.mark} <span class="muted">gave up ${pawnsTxt(m.loss).replace(/^\+/, "")}</span></button></li>`).join("")}</ul>` : ""}`;
  $("#rvBack").disabled = RV.i <= 0; $("#rvFwd").disabled = RV.i >= RV.frames.length - 1;
}
function revNote(g, a, mv) {
  const z = S.acc[g.id], ev = z && z.v === 2 ? z.ev : null, sg = revColorSign(g);
  const here = moveLabel(a.path, a.played || ""), fen = fenAfter(START, a.path);
  const best = z && z.bm && z.bm[a.ply] ? uciToSan(fen, z.bm[a.ply]) : "";
  const cpAfter = i => (ev && ev[i] != null ? sg * ev[i] : null);
  const go = `<button type="button" class="btn ghost quick" data-rvgo>Show</button>`;
  const build = (open) => `<button type="button" class="btn ghost quick" data-rvbuild="${esc(open)}">Open in Build</button>`;
  const btn = (act, label, primary) => `<button type="button" class="btn ${primary ? "" : "ghost "}quick" data-rvact="${act}">${esc(label)}</button>`;
  let h = `<p class="lbl ${a.type === "full" ? "ok" : "warn"}">${revTypeLabel[a.type]}${a.type === "full" ? "" : ` at move ${Math.floor(a.ply / 2) + 1}`}</p>`;
  if (a.type === "full") return h + `<p class="help">Every move up to ${a.ply ? esc(moveLabel(a.path.slice(0, -1), a.path[a.path.length - 1])) : "the start"} was in your prep.</p>`;
  const evTxt = cp => (cp == null ? "" : ` <span class="mono">${whiteTxt(cp * sg)}</span>`); // cp is from my side
  if (a.type === "misplay" || a.type === "you_new") {
    const played = a.played, playedCp = cpAfter(a.ply + 1), m = mv[a.ply];
    const prep = a.type === "misplay" ? rep(g.my).pos[a.key].m : [];
    const pc = RV.prepCp && RV.prepCp.key === a.key ? RV.prepCp.cp : null;
    h += a.type === "misplay"
      ? `<p>You played <b>${esc(here)}</b>${evTxt(playedCp)}. Your prep has <b>${prep.map(x => esc(x) + (pc && pc[x] != null ? evTxt(pc[x]) : "")).join(" / ")}</b>${pc ? "" : ` <span class="muted">(checking…)</span>`}.</p>`
      : `<p>You had no move ready here, and played <b>${esc(here)}</b>${evTxt(playedCp)}.</p>`;
    if (best && best !== played) h += `<p class="help">Stockfish's choice: <b>${esc(best)}</b>${evTxt(cpAfter(a.ply))}.${m && m.mark ? ` Your move gave up ${pawnsTxt(m.loss).replace(/^\+/, "")}.` : ""}</p>`;
    else if (best === played) h += `<p class="help">That was Stockfish's choice too.</p>`;
    h += `<p class="help">Evals: + is good for White, − for Black; the game's are depth 10, your prep's depth 12.</p><div class="row rvacts">`;
    if (a.type === "misplay") h += btn("replace", `Make ${played} my move`, true) + btn("add", `Add ${played} as an option`);
    else h += btn("add", `Add ${played} to my tree`, true);
    if (best && best !== played && !prep.includes(best)) h += btn(a.type === "misplay" ? "best" : "bestadd", `Use ${best}`);
    h += go + build([played, ...prep].join(" ")) + `</div>`;
  } else {
    const theirLoss = mv[a.ply] ? mv[a.ply].loss : null, reply = mv[a.ply + 1];
    h += `<p>Your opponent played <b>${esc(here)}</b>, ${a.type === "end" ? "where your prep stops" : "which you hadn't prepared"}.</p>`;
    if (theirLoss != null) h += `<p class="help">${theirLoss >= adv().mistake ? "It was a mistake" : theirLoss >= adv().good ? "It wasn't quite the best" : "It was a good move"}${theirLoss >= adv().good ? ` (it gave you ${pawnsTxt(theirLoss).replace(/^\+/, "")})` : ""} at depth 10${best && best !== a.played ? `; Stockfish preferred ${esc(best)}` : ""}.</p>`;
    if (reply) h += `<p class="help">You answered <b>${esc(moveLabel(a.path.concat(a.played), reply.san))}</b>${reply.mark ? reply.mark : ""}${evTxt(cpAfter(a.ply + 2))}.</p>`;
    h += `<div class="row rvacts">${btn("opp", reply ? `Add ${a.played} and my ${reply.san}` : `Add ${a.played}`, true)}${reply ? btn("opponly", `Add ${a.played} only`) : ""}${go}<button type="button" class="btn ghost quick" data-rvbuild="" data-rvpath="1">Open in Build</button></div>`;
  }
  return h + undoNote("rev");
}
function revGo(i) { RV.play++; RV.playTo = 0; RV.i = Math.max(0, Math.min(RV.frames.length - 1, i)); renderReview(); }
// What the buttons on the deviation card do to the repertoire (with Undo)
function revAct(act) {
  const g = RV.g, a = analyseGame(g), color = g.my, z = S.acc[g.id];
  const fen = fenAfter(START, a.path), best = z && z.bm && z.bm[a.ply] ? uciToSan(fen, z.bm[a.ply]) : "";
  const moves = g.moves.split(" ");
  RepUndo.change("rev", color, () => {
    const n = rep(color).pos[a.key], first = n && n.m.length ? n.m[0] : null;
    if (act === "replace") { addMove(a.path, a.played, color, first); return `${moveLabel(a.path, a.played)} replaces ${first}`; }
    if (act === "add") { addMove(a.path, a.played, color); return `Added ${moveLabel(a.path, a.played)}`; }
    if (act === "best") { addMove(a.path, best, color, first); return `${moveLabel(a.path, best)} replaces ${first}`; }
    if (act === "bestadd") { addMove(a.path, best, color); return `Added ${moveLabel(a.path, best)}`; }
    if (act === "opp" || act === "opponly") {
      addMove(a.path, a.played, color);
      const reply = moves[a.ply + 1];
      if (act === "opp" && reply) { addMove(a.path.concat(a.played), reply, color); return `Added ${numbered(a.ply, [a.played, reply])}`; }
      return `Added ${moveLabel(a.path, a.played)}`;
    }
    return "";
  });
  walk(color);
  RV.prepCp = null;
  renderReview();
  askPrepEval();
}

/* ----- Games > Recent games: the list that opens the review ----- */
function recentGamesHtml(A) {
  const list = A.slice(0, RV.shown);
  if (!list.length) return `<li class="muted">No games yet.</li>`;
  const items = list.map(({ g, a, s }) => {
    const opp = g.my === "white" ? g.black : g.white, oe = g.my === "white" ? g.belo : g.welo;
    const res = s === 1 ? '<span class="pill ok">Won</span>' : s === 0.5 ? '<span class="pill">Draw</span>' : s === 0 ? '<span class="pill gap">Lost</span>' : "";
    const acc = revAccuracy(g, a);
    const dev = a.type === "misplay" ? `<span class="warnt">left prep: ${esc(moveLabel(a.path, a.played))} (prep ${esc(a.expected)})</span>`
      : a.type === "full" ? "stayed in prep" : `${esc(revTypeLabel[a.type])} at move ${Math.floor(a.ply / 2) + 1}${a.played ? ` (${esc(moveLabel(a.path, a.played))})` : ""}`;
    return `<li><button type="button" class="linkish" data-review="${esc(g.id)}"><span class="tt">${res} vs ${esc(opp)} <span class="muted">(${oe || "?"})</span>${acc && acc.inb != null ? ` <span class="muted">· prep ${acc.inb}%${acc.post != null ? ` · after ${acc.post}%` : ""}</span>` : ""}</span><span class="sub">${esc(g.date || "")} · ${dev}</span></button></li>`;
  }).join("");
  return items + (A.length > RV.shown ? `<li><button type="button" class="btn ghost quick" data-rvmore>Show more</button></li>` : "");
}

/* ----- buttons (data-* attributes; see onClick() in core.js) ----- */
onClick("review", d => openReview(d.review, S.view === "openings" ? "openings" : "games", d.rvat != null ? +d.rvat : undefined));
onClick("rvply", d => revGo(+d.rvply), true);
onClick("rvact", d => revAct(d.rvact));
onClick("rvgo", d => revGo(analyseGame(RV.g).ply), true);
onClick("rvmore", d => { RV.shown += REV_LIST; renderGames(); }, true);
onClick("rvbuild", (d, b) => {
  const g = RV.g, a = analyseGame(g);
  S.color = g.my;
  if (b && b.dataset.rvpath) { S.build[S.color] = a.path.concat(a.played); }
  else { S.build[S.color] = a.path.slice(); (d.rvbuild || "").split(" ").filter(Boolean).forEach(san => candOpen.add(a.key + "|" + san)); }
  S.ptab = "moves";
  setView("build");
  window.scrollTo({ top: 0 });
}, true);
