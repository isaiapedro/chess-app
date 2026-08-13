import type { PositionPov } from "./positionPov";

type PlanSlot = "early" | "mid" | "late";

const OPENING_FAMILY_PLANS: Record<string, string[]> = {
  opening_sicilian: [
    "Sicilian: unequal chances — White presses in the centre/kingside; Black counters on the c-file and with ...d5/...e5 breaks.",
    "Sicilian middlegame seed: race the attack that matches your structure — do not mix Najdorf pawn storms with Scheveningen quietude.",
    "Sicilian checkpoint: if the centre opens (...d5), piece activity beats slow wing play; if it stays closed, prepare the minority or the f-pawn break.",
  ],
  opening_najdorf: [
    "Najdorf: ...a6 restrains Nb5 and prepares ...b5 — queenside expansion is the soul of Black's counterplay.",
    "Najdorf English Attack: opposite-side races — White's g/h pawns vs Black's ...b5/...Bb7 and the ...d5 break.",
    "Najdorf decision: choose ...e5 or ...e6 structures consciously — they change whether d5 or f5 is the freeing break.",
  ],
  opening_french: [
    "French: Black challenges e4 with ...d5; the c8 bishop is the problem child until ...c5 and piece trades free it.",
    "French Advance: attack the base of the chain (d4) with ...c5/...Qb6; White uses space on the kingside.",
    "French plan check: if the centre locks, play on the wing your chain points to — do not forget the other side's break.",
  ],
  opening_caro_kann: [
    "Caro-Kann: solid ...c6/...d5 — develop the light-squared bishop outside the chain before ...e6 when possible.",
    "Caro-Kann: endgames often favour Black's structure; White must use the space lead before simplification.",
    "Caro-Kann: meet ...c5 carefully — that break decides whether the position opens or stays a grind.",
  ],
  opening_queens_gambit: [
    "Queen's Gambit: fight for d5/c4 — Exchange/Carlsbad structures often lead to minority-attack plans.",
    "QGD: White pressures d5 or prepares e4; Black seeks ...c5/...e5 freeing breaks and piece activity.",
    "QGD Carlsbad: minority attack (b4–b5) aims to create a weak c-pawn — time it when pieces already eye the entry squares.",
  ],
  opening_qgd: [
    "QGD: keep the centre tension until a clear break (...c5/...e5 or e4) improves your worst piece.",
    "QGD: trading into a good bishop ending can justify an earlier structural concession.",
  ],
  opening_kings_indian: [
    "King's Indian: Black fianchettoes and strikes with ...e5 or ...c5; after a closed centre, ...f5 is the classic kingside lever.",
    "KID: White's queenside space vs Black's kingside storm — both sides must race the right break, not invent a third plan.",
    "KID checkpoint: if White plays g4/Be3 setups, Black's ...c5/...a6/...b5 counterplay often comes before a blind ...f5.",
  ],
  opening_indian: [
    "Indian complex: flexible centre — decide early whether you want a closed King's Indian fight or a Grünfeld-style open centre.",
  ],
  opening_london: [
    "London: solid Bd3/Bf4 setup — White seeks e3–c3 harmony and a controlled e4 or c4 break, not a random pawn storm.",
    "London middlegame seed: knights to e5/d2–f3, battery on the b1–h7 diagonal; Black's ...c5/...Qb6 tests the bishop.",
    "London checkpoint: if Black locks the centre, play on the wing your pieces already face; do not invent a third plan.",
  ],
  opening_ruy_lopez: [
    "Ruy Lopez: White pressures e5 and prepares c3–d4; Black chooses Marshall, Berlin, or Closed structures — each picks a different middlegame.",
    "Ruy Closed: manoeuvre (Re1, Nbd2–f1–g3) before the central break; premature d4 can leave e4 soft.",
    "Ruy checkpoint: after the centre opens, piece activity and the a-file/bishop pair often outweigh a single pawn.",
  ],
  opening_italian: [
    "Italian: fight for d4/d5 and the a2–g8 / a7–g1 diagonals — Bc4 and ...Bc5 define the early tension.",
    "Italian Giuoco: c3–d4 or quiet Giuoco Pianissimo (d3, a3/a6) — name which race you are in before pushing pawns.",
    "Italian checkpoint: if knights plant on e5/e4, challenge them or accept a lasting bind on the soft squares.",
  ],
  opening_scandinavian: [
    "Scandinavian: ...d5 forces early queen decisions — ...Qa5/...Qd6/...Qd8 each change development order.",
    "Scandinavian plan: develop light pieces fast, castle, then meet White's space with ...c6/...e6 solidity or ...c5 breaks.",
    "Scandinavian checkpoint: do not leave the queen hanging to Nb5/Bd2 discoveries while chasing pawns.",
  ],
  opening_petroff: [
    "Petroff: symmetrical e4–e5 fight — equality comes from accurate piece trades and timely ...d5/...c5.",
    "Petroff middlegame: avoid drifting; improve the worst piece and meet White's kingside space with central counters.",
    "Petroff checkpoint: if the position opens, the side that mobilizes rooks to open files first often seizes the initiative.",
  ],
  opening_english: [
    "English: c4 fights for d5 without committing the e-pawn early — choose Botvinnik, Symmetrical, or reversed-Sicilian setups consciously.",
    "English plan: clamp ...d5, expand with b4 or e3–d4, and use the long diagonal for the fianchetto bishop.",
    "English checkpoint: if Black breaks with ...d5/...b5, piece activity on the open files beats clinging to the bind.",
  ],
  named_opening: [
    "Opening phase: every move should develop, fight the centre, or prepare castling — queen raids without backup lose tempo.",
    "Opening checkpoint: connect the rooks before launching pawn storms; unfinished development becomes lasting pressure.",
    "Opening transition: name the pawn structure you are heading into — that structure picks the middlegame plan.",
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
    "Against an IQP: blockade the square ahead (d5/d4), trade pieces, steer toward an ending where the isolani is weak.",
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
    "Chain breaks (...c5/...f6 or c4/f4) define the whole middlegame — time them with piece support.",
  ],
  space: [
    "Space advantage: manoeuvre behind the wall and restrain counterbreaks — avoid freeing trades for the cramped side.",
    "If cramped: seek a timely pawn break or simplification; waiting only shrinks the options.",
  ],
  open_file: [
    "Open file: occupancy pays only if a rook or queen can invade the 7th/2nd — contest or concede, do not half-measure.",
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
  "Conversion: remove counterplay first, then advance the winning plan — avoid unnecessary complications.",
  "Pawn endings: calculate opposition and key squares before pushing — one tempo decides many of these.",
];

function pickPlan(
  key: string,
  pool: string[],
  usedTips: Set<string>,
  slot: PlanSlot
): string {
  if (!pool.length) return "";
  const usedKey = `plan:${key}:${slot}`;
  if (usedTips.has(usedKey)) return "";
  const idx =
    slot === "early" ? 0 : slot === "mid" ? Math.min(1, pool.length - 1) : Math.min(2, pool.length - 1);
  const text = pool[idx] || pool[0];
  // Avoid identical full text twice
  const fp = `planfp:${text.slice(0, 48)}`;
  if (usedTips.has(fp)) return "";
  usedTips.add(usedKey);
  usedTips.add(fp);
  return text;
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
}): string {
  const slot = slotForPly(args.phase, args.ply);
  if (!slot) return "";

  if (args.phase === "opening") {
    for (const tag of args.openingTags) {
      const pool = OPENING_FAMILY_PLANS[tag];
      if (pool) {
        const bit = pickPlan(tag, pool, args.usedTips, slot);
        if (bit) return bit;
      }
    }
    const generic = OPENING_FAMILY_PLANS.named_opening;
    const label = args.openingLabel ? `${args.openingLabel}. ` : "";
    const bit = pickPlan("named_opening", generic, args.usedTips, slot);
    if (bit) return label + bit;
    return "";
  }

  if (args.phase === "middlegame") {
    for (const s of args.structure) {
      const pool = MG_STRUCTURE_PLANS[s];
      if (pool) {
        const bit = pickPlan(`mg:${s}`, pool, args.usedTips, slot);
        if (bit) return bit;
      }
    }
    if (args.pov.kingMotifLive && args.pov.oppKingExposed) {
      return pickPlan(
        "mg:attack",
        [
          "Middlegame: their king is still a live target — open lines and improve the worst-placed attacker.",
          "Middlegame: keep asking questions against their soft king; slow prophylaxis hands the initiative back.",
        ],
        args.usedTips,
        slot
      );
    }
    if (args.pov.kingMotifLive && args.pov.userKingExposed) {
      return pickPlan(
        "mg:defend",
        [
          "Middlegame: your king needs cover — contest open files, trade their lead attacker, then counterbreak.",
          "Middlegame: fix king safety before chasing pawns; tempo against your king decides races.",
        ],
        args.usedTips,
        slot
      );
    }
    return pickPlan(
      "mg:generic",
      [
        "Middlegame: name a target (weak pawn, open file, or outpost), improve pieces toward it, restrain their break.",
        "Middlegame: compare two candidates — which plan does each serve, and which piece ends up better?",
        "Middlegame: Silman-style — list imbalances (king safety, material, structure, space, activity) and play toward your plusses.",
      ],
      args.usedTips,
      slot
    );
  }

  return pickPlan("eg", EG_PLANS, args.usedTips, slot);
}
