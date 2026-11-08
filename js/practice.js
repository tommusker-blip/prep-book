"use strict";
/* ---------- line practice: choosing the opponent's reply (NOTES items 2 and 3) ----------
   In "Practise lines" the app plays the opponent's moves from my prepared replies. Always
   taking the most popular reply would send me down the same line every time, so each prepared
   reply is weighted by:
     frequency - how often it's played at my rating bands (Lichess); unknown counts as an even
                 share, and nothing goes below FREQ_FLOOR so rare lines still come up
     need      - how much the branch behind it needs work: my cards there that are due,
                 flagged (misplayed in games), never learnt, or often missed
     coverage  - branches with line ends I haven't reached yet this session get a boost, so
                 over a session every prepared branch comes up
     recency   - a reply picked at this position in the last line or two is damped, so the same
                 branch doesn't come up back to back
   pickReply() takes a random number in [0, 1) so it can be tested. */
const FREQ_FLOOR = 0.05;
// How much one of my positions needs practice (0 = well known)
function cardNeed(c, now = Date.now()) {
  if (!c) return 0;
  return (c.due <= now ? 1 : 0) + (c.flag ? 1 : 0) + (c.reps === 0 ? 1 : 0) + Math.min(1, (c.lapses || 0) * 0.5);
}
// For every position in the tree: the average need of my cards in the branch below it (itself
// included), and the line ends ("leaves") it leads to. Positions reached by transposition are
// counted once per branch.
function branchInfo(color = S.color, now = Date.now()) {
  const { nodes } = walk(color), R = rep(color), memo = {};
  const visit = (key, stack) => {
    if (memo[key]) return memo[key];
    const node = nodes[key];
    if (!node || stack.has(key)) return { need: 0, cards: 0, leaves: new Set() };
    stack.add(key);
    let need = 0, cards = 0;
    const leaves = new Set();
    if (isMine(key, color) && R.cards[key]) { need += cardNeed(R.cards[key], now); cards++; }
    if (!node.kids.length) leaves.add(key);
    for (const kid of node.kids) {
      const b = visit(kid.key, stack);
      need += b.need * b.cards; cards += b.cards; // b.need is an average; weight it back up
      b.leaves.forEach(l => leaves.add(l));
    }
    stack.delete(key);
    return (memo[key] = { need: cards ? need / cards : 0, cards, leaves });
  };
  visit(K(START), new Set());
  return memo;
}
// Pick the opponent's reply at a position (key/fen) from my prepared replies.
//   session: {visited: Set of leaf keys reached, recent: {key: [san of last picks, newest last]}}
function replyWeights(fen, key, color, session, info) {
  const R = rep(color), n = R.pos[key], { nodes } = walk(color);
  if (!n || !n.m.length) return [];
  const ex = cachedExplorer(fen), kids = (nodes[key] || { kids: [] }).kids;
  const recent = (session.recent && session.recent[key]) || [];
  return n.m.map(san => {
    const kid = kids.find(k => k.san === san), b = kid && info[kid.key];
    const em = ex && ex.total ? ex.moves.find(m => m.san === san) : null;
    const freq = Math.max(FREQ_FLOOR, em ? em.n / ex.total : 1 / n.m.length);
    const need = 1 + 2 * (b ? b.need : 0);
    const unseen = b && b.leaves.size ? [...b.leaves].filter(l => !session.visited.has(l)).length / b.leaves.size : 0;
    const coverage = 1 + 2 * unseen;
    const ago = recent.length - 1 - recent.lastIndexOf(san); // 0 = picked in the last line here
    const recency = recent.includes(san) ? (ago === 0 ? 0.3 : ago === 1 ? 0.6 : 1) : 1;
    return { san, w: freq * need * coverage * recency, freq, need, coverage, recency };
  });
}
function pickReply(fen, key, color, session, info, rnd = Math.random()) {
  const ws = replyWeights(fen, key, color, session, info);
  if (!ws.length) return null;
  const total = ws.reduce((a, x) => a + x.w, 0);
  let r = rnd * total;
  for (const x of ws) { if ((r -= x.w) < 0) return x.san; }
  return ws[ws.length - 1].san;
}
// Remember a pick for the recency damping (last 3 per position)
function notePick(session, key, san) {
  const r = session.recent[key] || (session.recent[key] = []);
  r.push(san);
  if (r.length > 3) r.shift();
}
// Where "Practise lines" starts for a colour (item 3): a path in the tree, or [] for the start
function practiceRoot(color = S.color) {
  const p = (S.settings.practiceRoot || {})[color] || [];
  const fen = fenAfter(START, p);
  return fen && walk(color).nodes[K(fen)] ? p : []; // fall back to the start if it left the tree
}
