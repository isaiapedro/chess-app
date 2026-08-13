import type { PositionPov } from "./positionPov";
import { assessBoardFacts, textFitsBoard } from "./noteRelevance";

type PlanSlot = "early" | "mid" | "late";

const OPENING_FAMILY_PLANS: Record<string, string[]> = {
  opening_sicilian: [
    "Sicilian: unequal chances — White presses in the centre/kingside; Black counters on the c-file and with ...d5/...e5 breaks.",
    "Sicilian: race the attack that matches your structure — don't mix a pawn storm with a quiet Scheveningen setup.",
    "If the Sicilian centre opens (...d5), play with pieces; if it stays closed, prepare ...b5 or the f-pawn break.",
  ],
  opening_najdorf: [
    "Najdorf: ...a6 restrains Nb5 and prepares ...b5 — queenside expansion is Black's main counterplay.",
    "Najdorf: choose ...e5 or ...e6 on purpose — they change whether ...d5 or ...f5 is the freeing break.",
    "Najdorf English Attack: opposite-side races — White's g/h pawns vs Black's ...b5/...Bb7 and the ...d5 break.",
  ],
  opening_french: [
    "French: Black challenges e4 with ...d5; the c8 bishop stays awkward until ...c5 and piece trades free it.",
    "French Advance: attack the base of the chain (d4) with ...c5; White uses space on the kingside.",
    "If the French centre locks, play on the wing your chain points to.",
  ],
  opening_caro_kann: [
    "Caro-Kann: solid ...c6/...d5 — develop the light-squared bishop outside the chain before ...e6 when you can.",
    "Caro-Kann: White should use the space lead before the game simplifies.",
    "Caro-Kann: meet ...c5 carefully — that break decides whether the position opens or stays a grind.",
  ],
  opening_queens_gambit: [
    "Queen's Gambit: fight for d5/c4 — Exchange/Carlsbad structures often lead to minority-attack plans.",
    "QGD: White pressures d5 or prepares e4; Black seeks ...c5/...e5 freeing breaks.",
    "QGD Carlsbad: minority attack (b4–b5) aims to create a weak c-pawn.",
  ],
  opening_qgd: [
    "QGD: keep the centre tension until a clear break (...c5/...e5 or e4) improves your worst piece.",
    "QGD: trading into a good bishop ending can justify an earlier structural concession.",
  ],
  opening_kings_indian: [
    "King's Indian: Black fianchettoes and strikes with ...e5 or ...c5; after a closed centre, ...f5 is the classic lever.",
    "KID: White's queenside space vs Black's kingside storm — race the right break, not a third plan.",
    "In g4/Be3 KIDs, Black's ...c5/...a6/...b5 ideas often come before a blind ...f5.",
  ],
  opening_indian: [
    "Indian complex: flexible centre — decide early whether you want a closed King's Indian fight or a Grünfeld-style open centre.",
  ],
  opening_london: [
    "London: solid Bd3/Bf4 setup — White seeks e3–c3 harmony and a controlled e4 or c4 break.",
    "London: knights often head for e5 and d2–f3; keep the pieces coordinated before inventing a storm.",
    "If Black locks the London centre, play on the wing your pieces already face.",
  ],
  opening_ruy_lopez: [
    "Ruy Lopez: White pressures e5 and prepares c3–d4; Black chooses Marshall, Berlin, or Closed structures.",
    "Ruy Closed: manoeuvre (Re1, Nbd2–f1–g3) before forcing the centre open.",
    "When the Ruy centre opens, activity and the bishop pair often beat a lonely pawn.",
  ],
  opening_italian: [
    "Italian: fight for d4/d5 and the long diagonals — Bc4 and ...Bc5 set the early tension.",
    "Italian: choose c3–d4 races or quiet Pianissimo (d3) on purpose — they are different middlegames.",
    "If a knight sits on e5/e4 in the Italian, challenge it or live with the bind.",
  ],
  opening_scandinavian: [
    "Scandinavian: ...d5 challenges e4 at once — develop minors fast and castle before hunting pawns.",
    "Scandinavian: after the early queen trade or retreat, meet White's space with ...c6/...e6 or ...c5.",
    "In the Scandinavian, watch Nb5/Bd2 tricks against the queen before grabbing pawns.",
  ],
  opening_petroff: [
    "Petroff: symmetrical e4–e5 fight — equality from accurate trades and timely ...d5/...c5.",
    "Petroff: improve the worst piece and meet White's kingside space with central counters.",
    "When the Petroff opens up, the first side to get rooks on open files usually takes over.",
  ],
  opening_english: [
    "English: c4 fights for d5 without early e-pawn commitment.",
    "English: clamp ...d5, expand with b4 or e3–d4, use the fianchetto long diagonal.",
    "If Black breaks with ...d5/...b5 in the English, use the open files — don't cling to a dead bind.",
  ],
  named_opening: [
    "Opening phase: develop, fight the centre, prepare castling — keep the pieces working together.",
    "Finish developing the minors before starting a wing attack.",
    "Decide which pawn structure you are heading into — that structure picks the middlegame plan.",
  ],
};

/** True when this ply can still emit a fresh phase-plan slot. */
export function phasePlanSlotOpen(
  phase: "opening" | "middlegame" | "endgame",
  ply: number
): boolean {
  return slotForPly(phase, ply) != null;
}

const MG_STRUCTURE_PLANS: Record<string, string[]> = {
  iqp: [
    "IQP middlegame: the side with the isolani needs activity and kingside pressure before a dry ending.",
    "Vs an IQP: sit on the square in front (d5/d4), trade pieces, head for an ending where the isolani is weak.",
    "IQP outposts on c5/e5 (or c4/e4) are classic — knights love the holes the isolani creates.",
  ],
  hanging_pawns: [
    "Hanging pawns want mobility; freeze them and they become fixed targets on open files.",
    "Pressure the base of hanging pawns, provoke an advance, then occupy the hole or the newly opened file.",
  ],
  minority_attack: [
    "Minority attack: b4–b5 aims to create a weak c-pawn on the opponent's queenside majority — prepare entry squares first.",
  ],
  pawn_chain: [
    "Locked chain: attack the base; play on the side where your chain tip points.",
    "Chain breaks (...c5/...f6 or c4/f4) shape the whole middlegame — time them with piece support.",
  ],
  space: [
    "Space advantage: manoeuvre behind the wall and restrain counterbreaks — avoid freeing trades for the cramped side.",
    "If cramped: seek a timely pawn break or simplification; waiting only shrinks your options.",
  ],
  open_file: [
    "Open file: occupancy pays only if a rook or queen can invade the 7th/2nd — contest or concede, don't half-measure.",
  ],
  bishop_pair: [
    "Bishop pair: open the centre so the bishops rake both wings; against the pair, close the position or plant knights on holes.",
  ],
  passed_pawn: [
    "Passed pawn: escort it or force the opponent into a passive block — outside passers stretch the defending king.",
  ],
};

const EG_PLANS: string[] = [
  "Endgame: activate the king and create a passed pawn — passive kings lose quiet endings.",
  "Rook endings: rooks belong behind passed pawns — yours or theirs; know Philidor (draw) vs Lucena (win) shapes.",
  "Opposite bishops: middlegame attacks rage on one colour; pure endings are often drawish — choose which version you want.",
  "Conversion: remove counterplay first, then advance the winning plan — skip needless complications.",
  "Pawn endings: calculate opposition and key squares before pushing — one tempo decides many of these.",
];

function pickPlan(
  key: string,
  pool: string[],
  usedTips: Set<string>,
  slot: PlanSlot,
  facts: ReturnType<typeof assessBoardFacts>
): string {
  if (!pool.length) return "";
  const usedKey = `plan:${key}:${slot}`;
  if (usedTips.has(usedKey)) return "";
  const order =
    slot === "early"
      ? [0, 1, 2]
      : slot === "mid"
        ? [1, 0, 2]
        : [2, 1, 0];
  for (const idx of order) {
    const text = pool[idx];
    if (!text) continue;
    if (!textFitsBoard(text, facts)) continue;
    const fp = `planfp:${text.slice(0, 48)}`;
    if (usedTips.has(fp)) continue;
    usedTips.add(usedKey);
    usedTips.add(fp);
    return text;
  }
  return "";
}

function slotForPly(
  phase: "opening" | "middlegame" | "endgame",
  ply: number
): PlanSlot | null {
  if (phase === "opening") {
    if (ply <= 4) return "early";
    if (ply <= 10) return "mid";
    if (ply <= 16) return "late";
    return null;
  }
  if (phase === "middlegame") {
    if (ply <= 24) return "early";
    if (ply <= 40) return "mid";
    return "late";
  }
  if (ply <= 50) return "early";
  return "mid";
}

/**
 * Deeper, multi-step opening / middlegame / endgame plan notes from book themes.
 */
export function phasePlanNote(args: {
  phase: "opening" | "middlegame" | "endgame";
  ply: number;
  openingLabel: string;
  openingTags: string[];
  structure: string[];
  pov: PositionPov;
  usedTips: Set<string>;
  fenAfter: string;
  playedSan: string;
}): string {
  const slot = slotForPly(args.phase, args.ply);
  if (!slot) return "";
  const facts = assessBoardFacts({
    fenAfter: args.fenAfter,
    playedSan: args.playedSan,
    ply: args.ply,
    phase: args.phase,
    themes: args.structure,
  });

  if (args.phase === "opening") {
    for (const tag of args.openingTags) {
      if (tag === "named_opening" || tag === "opening_plan") continue;
      const pool = OPENING_FAMILY_PLANS[tag];
      if (pool) {
        const bit = pickPlan(tag, pool, args.usedTips, slot, facts);
        if (bit) {
          if (args.openingLabel && slot === "early" && !bit.includes(args.openingLabel)) {
            return `${args.openingLabel}. ${bit}`;
          }
          return bit;
        }
      }
    }
    return "";
  }

  if (args.phase === "middlegame") {
    for (const s of args.structure) {
      const pool = MG_STRUCTURE_PLANS[s];
      if (pool) {
        const bit = pickPlan(`mg:${s}`, pool, args.usedTips, slot, facts);
        if (bit) return bit;
      }
    }
    if (args.pov.kingMotifLive && args.pov.oppKingExposed) {
      return pickPlan(
        "mg:attack",
        [
          "Middlegame: their king is still a live target — open lines and improve the worst-placed attacker.",
          "Middlegame: keep asking questions against their soft king; slow defence hands the initiative back.",
        ],
        args.usedTips,
        slot,
        facts
      );
    }
    if (args.pov.kingMotifLive && args.pov.userKingExposed) {
      return pickPlan(
        "mg:defend",
        [
          "Middlegame: your king needs cover — contest open files, trade their lead attacker, then counterbreak.",
          "Middlegame: fix king safety before chasing pawns; tempo against your king decides these races.",
        ],
        args.usedTips,
        slot,
        facts
      );
    }
    return "";
  }

  return pickPlan("eg", EG_PLANS, args.usedTips, slot, facts);
}
