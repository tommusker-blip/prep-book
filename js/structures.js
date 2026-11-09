"use strict";
/* ---------- pawn structures and their typical plans (v0.9.5, idea lines) ----------
   A hand-written list of common structures, matched on pawns alone. The first match wins, so
   the more specific ones come first. Each has the usual plans for each side and its pawn
   breaks (target squares), which idealines.js uses to spot the key moments in a line.
   These are the standard textbook plans, kept short; they're starting points, not analysis. */
function pawnMap(fen) {
  const W = new Set(), B = new Set(), rows = fen.split(" ")[0].split("/");
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const sq = "abcdefgh"[f] + (8 - i);
      if (ch === "P") W.add(sq); else if (ch === "p") B.add(sq);
      f++;
    }
  });
  const on = (S2, file) => [...S2].some(s => s[0] === file);
  return {
    W, B,
    w: (...sq) => sq.every(s => W.has(s)), b: (...sq) => sq.every(s => B.has(s)),
    wf: f => on(W, f), bf: f => on(B, f), // any pawn of that side on the file
  };
}
const STRUCTURES = [
  { id: "iqp-w", name: "Isolated queen's pawn (White)", test: p => p.w("d4") && !p.wf("c") && !p.wf("e") && !p.bf("d"),
    white: ["Keep pieces on and play actively: the pawn gives you space and outposts on e5 and c5.", "Build a kingside attack (Bd3/Bc2, Qd3, Re1, Ne5).", "Break with d4-d5 when your pieces are ready, to trade off the weakness."],
    black: ["Blockade the pawn on d5, ideally with a knight.", "Trade pieces: the isolated pawn gets weaker in the endgame.", "Pile up on d4 (…Rd8, …Nc6, …Bf6)."],
    breaks: { w: ["d5"], b: [] } },
  { id: "iqp-b", name: "Isolated queen's pawn (Black)", test: p => p.b("d5") && !p.bf("c") && !p.bf("e") && !p.wf("d"),
    white: ["Blockade the pawn on d4, ideally with a knight.", "Trade pieces: the isolated pawn gets weaker in the endgame.", "Pile up on d5 (Rd1, Nc3, Bf3)."],
    black: ["Keep pieces on and play actively: outposts on e4 and c4.", "Look for a kingside attack with your pieces.", "Break with …d5-d4 when ready, to trade off the weakness."],
    breaks: { w: [], b: ["d4"] } },
  { id: "hang-w", name: "Hanging pawns (White c4 and d4)", test: p => p.w("c4", "d4") && !p.wf("b") && !p.wf("e") && !p.bf("c") && !p.bf("d"),
    white: ["Use the space and central control for piece play.", "Push d5 or c5 at the right moment to open lines, not too early.", "Avoid being forced to advance one pawn and leave holes."],
    black: ["Attack the pawns with …b5 and …e5 levers and with pieces.", "Make one of them advance, then blockade the square in front."],
    breaks: { w: ["d5", "c5"], b: ["b5", "e5"] } },
  { id: "hang-b", name: "Hanging pawns (Black c5 and d5)", test: p => p.b("c5", "d5") && !p.bf("b") && !p.bf("e") && !p.wf("c") && !p.wf("d"),
    white: ["Attack the pawns with b4 and e4 levers and with pieces.", "Make one of them advance, then blockade the square in front."],
    black: ["Use the space and central control for piece play.", "Push …d4 or …c4 at the right moment to open lines."],
    breaks: { w: ["b4", "e4"], b: ["d4", "c4"] } },
  { id: "hedgehog", name: "Hedgehog", test: p => p.b("a6", "b6", "d6", "e6") && !p.bf("c") && p.w("c4", "e4") && !p.wf("d"),
    white: ["Keep the bind: stop …b5 and …d5 (a4, Nd5 ideas, pieces on the d-file).", "Expand on the kingside (f4, g4) when the centre is secure."],
    black: ["Be patient: regroup behind the pawns (…Qc7, …Rac8, …Rfe8).", "Strike with …b5 or …d5 when it works tactically; that's when Black comes alive."],
    breaks: { w: ["e5", "f5", "g5"], b: ["b5", "d5"] } },
  { id: "maroczy", name: "Maroczy bind", test: p => p.w("c4", "e4") && !p.wf("d") && !p.bf("c") && p.bf("d"),
    white: ["Keep the bind on d5 and stop …b5 and …d5 (Be3, Rc1, b3, f3).", "Squeeze: you have more space, so avoid unnecessary trades."],
    black: ["Trade minor pieces to ease the cramp (…Nxd4, …Bg7 on the long diagonal).", "Prepare …b5 or …f5, or play on the dark squares (…a5, …Nc5)."],
    breaks: { w: ["c5", "e5"], b: ["b5", "d5", "f5"] } },
  { id: "dragon", name: "Dragon (…d6 and …g6)", test: p => p.b("d6", "g6") && !p.bf("c") && p.w("e4") && !p.wf("d"),
    white: ["With opposite-side castling, storm the king: h4-h5 to open the h-file, Bh6 to trade the dragon bishop.", "Keep a knight on d5 or c3 to blunt counterplay."],
    black: ["Use the long diagonal with …Bg7 and the c-file (…Rc8, …Ne5-c4).", "Counter-attack fast: …b5, and the exchange sacrifice …Rxc3 is a standard resource."],
    breaks: { w: ["h5", "g4", "e5"], b: ["b5", "d5"] } },
  { id: "schev", name: "Open Sicilian with …d6 and …e6", test: p => p.b("d6", "e6") && !p.bf("c") && p.w("e4") && !p.wf("d"),
    white: ["Kingside space and attack: f4, g4-g5 against a knight on f6.", "Watch for e4-e5 or Nd5 breakthroughs in the centre."],
    black: ["The freeing break is …d5; also queenside play with …b5 and the c-file.", "Keep the small centre solid: it covers d5 and e5."],
    breaks: { w: ["g5", "f5", "e5"], b: ["d5", "b5"] } },
  { id: "sic-e5", name: "Open Sicilian with …d6 and …e5", test: p => p.b("d6", "e5") && !p.bf("c") && p.w("e4") && !p.wf("d"),
    white: ["Control and occupy d5, ideally with a knight (Nd5, Bxf6, c3/c4).", "Kingside play with f4 or f3-g4, or queenside space with a4."],
    black: ["The key break is …d5: if it comes, the d6 weakness disappears.", "Queenside play with …b5 and the c-file; …f5 in some lines."],
    breaks: { w: ["f4", "f5", "a5"], b: ["d5", "f5", "b5"] } },
  { id: "kid", name: "King's Indian closed centre", test: p => p.w("d5", "e4") && p.b("d6", "e5"),
    white: ["Attack on the queenside: c4-c5, b4, opening the c-file.", "Keep control of the kingside with f3 and g4 if needed."],
    black: ["Attack on the kingside: …f5, …f4, …g5-g4.", "Every tempo matters: it's a race between the two wings."],
    breaks: { w: ["c5", "f4"], b: ["f5", "c6"] } },
  { id: "benoni", name: "Benoni (…c5 and …d6 against d5)", test: p => p.w("d5") && p.b("c5", "d6") && !p.bf("e") && !p.wf("c"),
    white: ["Prepare the e4-e5 break (f4, Re1).", "Stop …b5, and use the space in the centre."],
    black: ["Queenside majority: …a6 and …b5.", "Pressure on e4 and the e-file (…Re8, …Nbd7-e5)."],
    breaks: { w: ["e5", "f5"], b: ["b5", "f5"] } },
  { id: "french", name: "French advance chain", test: p => p.w("d4", "e5") && p.b("d5", "e6"),
    white: ["Kingside space: you're cramping the black king's side (f4-f5, Qg4, Bd3).", "Keep d4 supported (c3, Nf3) or the chain's base falls."],
    black: ["Attack the base of the chain with …c5, then …f6 against the head.", "Queenside play: …Qb6, …Nc6 and pressure on d4."],
    breaks: { w: ["f5", "f4"], b: ["c5", "f6"] } },
  { id: "caro-adv", name: "Caro-Kann advance chain", test: p => p.w("d4", "e5") && p.b("d5", "c6"),
    white: ["Kingside space; chase the bishop on f5 with g4 and h4 in sharp lines.", "Or play c4 to hit the d5 pawn."],
    black: ["Develop the light bishop outside the chain (…Bf5) before …e6.", "Break with …c5 (often in two steps)."],
    breaks: { w: ["c4", "g4", "h4"], b: ["c5", "f6"] } },
  { id: "carlsbad", name: "Carlsbad (Queen's Gambit Exchange)", test: p => p.w("d4") && !p.wf("c") && p.wf("e") && p.b("d5") && (p.b("c6") || p.b("c7")) && !p.bf("e"),
    white: ["Minority attack: b4-b5 to leave Black a weak c-pawn.", "Or the central plan: f3 and e3-e4."],
    black: ["Kingside play with pieces: …Ne4, …f5, …Bd6 and …Qf6/…Qh4 ideas.", "Use the e4 outpost; meet b4-b5 with …cxb5 or …c5 at the right time."],
    breaks: { w: ["b5", "e4"], b: ["f5", "c5"] } },
  { id: "carlsbad-r", name: "Reversed Carlsbad (Caro-Kann Exchange)", test: p => p.w("d4") && (p.w("c3") || p.w("c2")) && !p.wf("e") && p.b("d5") && !p.bf("c") && p.bf("e"),
    white: ["Kingside play: the e5 outpost (Ne5), Bd3 and Qc2 against h7.", "f4-f5 can follow in some lines."],
    black: ["Minority attack: …b5-b4 to hit the c3 pawn.", "Use the c-file and the c4 square."],
    breaks: { w: ["f5", "f4"], b: ["b4", "b5"] } },
  { id: "stonewall-b", name: "Stonewall (Black)", test: p => p.b("c6", "d5", "e6", "f5") && p.w("d4"),
    white: ["Use the e5 hole: a knight on e5 is the classic plan.", "Trade the dark-squared bishops (b3, Ba3) to weaken Black's dark squares."],
    black: ["Plant a knight on e4.", "Kingside attack with pieces and …g5 in some lines."],
    breaks: { w: ["e4", "c5"], b: ["e5", "g5"] } },
  { id: "stonewall-w", name: "Stonewall (White)", test: p => p.w("c3", "d4", "e3", "f4"),
    white: ["Plant a knight on e5.", "Kingside attack: Bd3, Qf3/Qh5, Rf3-h3, g4."],
    black: ["Use the e4 hole and play on the queenside (…b5-b4, …c5).", "Trade White's light-squared bishop if you can."],
    breaks: { w: ["e4", "g4"], b: ["c5", "b4"] } },
  { id: "slav", name: "Slav centre", test: p => p.w("c4", "d4") && p.b("c6", "d5"),
    white: ["Build the centre with e4 when it's safe.", "Keep pressure on d5 (Nc3, Qb3)."],
    black: ["Develop the light-squared bishop before …e6 when you can.", "Free the position with …dxc4 and …b5, or the breaks …e5 and …c5."],
    breaks: { w: ["e4"], b: ["e5", "c5"] } },
  { id: "qgd", name: "Queen's Gambit Declined centre", test: p => p.w("c4", "d4") && p.b("d5", "e6"),
    white: ["Keep the tension; aim for e3-e4 or the minority attack after cxd5.", "Pressure on the c-file and on d5."],
    black: ["Free the position with …c5 or …dxc4 followed by …e5 or …c5.", "Solve the light-squared bishop (…b6 and …Bb7, or …dxc4 and …e5)."],
    breaks: { w: ["e4"], b: ["c5", "e5"] } },
  { id: "pirc", name: "Pirc / Modern (…d6 and …g6 against the big centre)", test: p => p.w("d4", "e4") && p.b("d6", "g6") && p.bf("e") && p.bf("c"),
    white: ["Attack: Be3, Qd2, Bh6 to trade the fianchetto bishop, and h4-h5.", "Or gain space with e5 or f4."],
    black: ["Hit the centre with …e5 or …c5.", "The Bg7 bishop pressures d4; keep it."],
    breaks: { w: ["e5", "h5", "f5"], b: ["e5", "c5"] } },
  { id: "spanish", name: "Closed e4–e5 centre (Spanish / Italian)", test: p => p.w("c3", "e4") && p.wf("d") && p.b("e5"),
    white: ["Prepare d4 with the pieces ready (Re1, Nbd2-f1-g3 regroup).", "Kingside play once the knight reaches g3 or e3."],
    black: ["Counter with …d5 when it works, or …f5 in closed lines.", "Queenside expansion with …b5 and …c5 in the Spanish."],
    breaks: { w: ["d4", "f4"], b: ["d5", "f5", "c5"] } },
  { id: "colle", name: "London / Colle triangle (c3, d4, e3)", test: p => p.w("c3", "d4", "e3") && p.w("f2"),
    white: ["Colle: prepare e3-e4. London: Ne5, Bd3 and a kingside attack.", "Keep the solid triangle; it rarely gets weak."],
    black: ["Play on the queenside with …c5 and …Qb6 (pressure on b2).", "Free the game with …e5 when you can."],
    breaks: { w: ["e4"], b: ["c5", "e5"] } },
  { id: "open", name: "Open centre (no d- or e-pawns)", test: p => !p.wf("d") && !p.wf("e") && !p.bf("d") && !p.bf("e"),
    white: ["Development and open files matter most: get the rooks to d1 and e1.", "Look for active piece play; there are no central pawns to hide behind."],
    black: ["Same for Black: develop fast and fight for the open d- and e-files.", "Trades often lead to a level endgame; avoid falling behind in development."],
    breaks: { w: [], b: [] } },
];
// The structure in a position, or null
function structureOf(fen) {
  const p = pawnMap(fen);
  return STRUCTURES.find(s => { try { return s.test(p); } catch (e) { return false; } }) || null;
}
