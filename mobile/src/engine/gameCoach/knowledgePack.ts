/**
 * General positional knowledge — board/phase themes, not opening-named patches.
 * Broader topic coverage; retrieval stays strict (score gates in retrieve.ts).
 */

export type KnowledgeCard = {
  id: string;
  label: string;
  requireThemes: string[];
  rules: string[];
  phases?: Array<"opening" | "middlegame" | "endgame" | "any">;
  /** Higher = more teaching weight when scored */
  weight?: number;
};

export const KNOWLEDGE_PACK: KnowledgeCard[] = [
  {
    id: "development",
    label: "Development",
    requireThemes: ["development"],
    weight: 2,
    rules: [
      "Every early move should develop, fight the centre, or prepare castling — queen raids without backup usually lose tempo.",
      "Connect the rooks before pawn storms; unfinished development becomes lasting pressure.",
      "Improve the piece with no job before a speculative pawn push.",
    ],
    phases: ["opening", "any"],
  },
  {
    id: "centre",
    label: "Centre",
    requireThemes: ["centre"],
    weight: 2,
    rules: [
      "Whoever controls the centre directs the play — occupy it or pressure it from afar.",
      "A fixed centre invites wing plans; a fluid centre needs piece activity and timely breaks.",
      "Before a wing attack, confirm the centre is stable — a central counterbreak often arrives first.",
    ],
    phases: ["opening", "middlegame", "any"],
  },
  {
    id: "pawn_breaks",
    label: "Pawn breaks",
    requireThemes: ["pawn_breaks"],
    weight: 2,
    rules: [
      "Time breaks when pieces already support the squares that open.",
      "Attack a pawn chain at its base; the tip advances, the base is the hinge.",
      "A premature break softens your own pawns; a late one leaves you cramped.",
    ],
    phases: ["opening", "middlegame", "any"],
  },
  {
    id: "piece_activity",
    label: "Piece activity",
    requireThemes: ["piece_activity"],
    weight: 2,
    rules: [
      "Active pieces compensate for small structural flaws — ask which piece has no target.",
      "Improve the worst-placed piece before forcing tactics.",
      "Do not trade your only active piece for a spectator unless the structure clearly improves.",
    ],
    phases: ["middlegame", "any"],
  },
  {
    id: "prophylaxis",
    label: "Prophylaxis",
    requireThemes: ["prophylaxis"],
    weight: 2,
    rules: [
      "Name the opponent's plan before yours — a restraining move often beats a flashy one.",
      "Stop their break or entry square when both sides have plans.",
    ],
    phases: ["middlegame", "any"],
  },
  {
    id: "exchanges",
    label: "Exchanges",
    requireThemes: ["exchanges"],
    weight: 2,
    rules: [
      "Trade to free your position or damage theirs — random exchanges often activate the opponent.",
      "The side with more space usually avoids piece trades; the cramped side seeks them.",
      "Trade into an ending only if the remaining structure favours you.",
    ],
    phases: ["middlegame", "endgame", "any"],
  },
  {
    id: "king_safety",
    label: "King safety",
    requireThemes: ["king_safety", "opp_king_exposed", "user_king_exposed"],
    weight: 3,
    rules: [
      "Opposite-side castling races are decided by open lines and attacker count, not slow manoeuvres.",
      "Extra attackers near the soft king outweigh small material if files can open.",
      "An uncastled king in the centre is a target: open lines before they tuck away.",
      "If your own king is the soft one, fix safety before chasing pawns on the other wing.",
    ],
    phases: ["opening", "middlegame", "any"],
  },
  {
    id: "initiative",
    label: "Initiative",
    requireThemes: ["initiative"],
    weight: 2,
    rules: [
      "Keep making threats the opponent must answer — initiative compounds.",
      "Returning material to keep the attack often beats grabbing a pawn and going passive.",
    ],
    phases: ["middlegame", "opening", "any"],
  },
  {
    id: "attack",
    label: "Attacking the king",
    requireThemes: ["attack", "opp_king_exposed"],
    weight: 3,
    rules: [
      "When you are the attacking side, every move should increase pressure or open a line — quiet shuffles hand the initiative back.",
      "Bring more attackers than defenders before the final break; tempo against their king comes first.",
    ],
    phases: ["opening", "middlegame", "any"],
  },
  {
    id: "missed_opportunity",
    label: "Missed opportunities",
    requireThemes: ["missed_opportunity"],
    weight: 3,
    rules: [
      "A missed opportunity is failing to punish a temporary weakness — uncastled king, loose piece, or open file — while it still exists.",
      "When the opponent creates a target, ask what forcing move asks the hardest question before the chance closes.",
      "Quiet improving moves are fine only after you check whether a concrete hit was available.",
    ],
    phases: ["opening", "middlegame", "any"],
  },
  {
    id: "counterplay",
    label: "Counterplay",
    requireThemes: ["counterplay"],
    weight: 3,
    rules: [
      "Against an opponent plan, either stop it at the source or race a clearer counter-threat.",
      "Hit the base of their pawn chain or the piece that holds their idea together.",
      "If they overextend on a wing, break in the centre or invade the newly soft squares.",
    ],
    phases: ["middlegame", "opening", "any"],
  },
  {
    id: "weakness_exploitation",
    label: "Exploiting weaknesses",
    requireThemes: ["weakness_exploitation"],
    weight: 3,
    rules: [
      "After the opponent softens a square or file, occupy it or force further concessions before they repair it.",
      "Fixed pawn weaknesses want blockade and pressure, not random piece trades that ease the defence.",
      "Loose pieces and undefended entry squares are invitations — calculate the forcing sequence first.",
    ],
    phases: ["middlegame", "opening", "endgame", "any"],
  },
  {
    id: "forcing_moves",
    label: "Forcing moves",
    requireThemes: ["forcing_moves", "tactics"],
    weight: 3,
    rules: [
      "Scan checks, captures, and threats for both sides before choosing a quiet move.",
      "If a candidate is not forcing, ask whether the opponent gets a free tempo to fix their position.",
    ],
    phases: ["opening", "middlegame", "endgame", "any"],
  },
  {
    id: "coordination",
    label: "Coordination",
    requireThemes: ["coordination"],
    weight: 2,
    rules: [
      "Pieces should share targets — two attackers on one weakness beat scattered activity.",
      "When pieces trip over each other, rearrange before launching the break.",
    ],
    phases: ["middlegame", "any"],
  },
  {
    id: "planning",
    label: "Planning",
    requireThemes: ["planning"],
    weight: 2,
    rules: [
      "A plan needs a target: weak pawn, open file, king, or passer — moves without a target drift.",
      "Change plans when the pawn structure changes; old ideas die with the old skeleton.",
    ],
    phases: ["middlegame", "opening", "any"],
  },
  {
    id: "defense",
    label: "Defence",
    requireThemes: ["defense"],
    weight: 2,
    rules: [
      "In defence, exchange the opponent's most active attacker and contest open lines into your camp.",
      "Create a clear counter-threat rather than only answering each check with a retreat.",
    ],
    phases: ["middlegame", "endgame", "any"],
  },
  {
    id: "conversion",
    label: "Conversion",
    requireThemes: ["conversion"],
    weight: 2,
    rules: [
      "With a clear plus, remove counterplay first, then advance the winning plan.",
      "Do not allow unnecessary complications when a simple technical path exists.",
    ],
    phases: ["middlegame", "endgame", "any"],
  },
  {
    id: "open_file",
    label: "Open files",
    requireThemes: ["open_file", "open_c_file"],
    weight: 3,
    rules: [
      "An open file pays only if a rook or queen can invade the 7th/2nd.",
      "Contest the file or concede it; half measures leave a highway.",
      "Double on the file or swing to the seventh before the opponent digs in.",
    ],
    phases: ["middlegame", "endgame", "any"],
  },
  {
    id: "space",
    label: "Space",
    requireThemes: ["space"],
    weight: 2,
    rules: [
      "With more space, improve behind the wall and restrain counterbreaks — avoid freeing trades.",
      "The cramped side needs a timely break or simplification; waiting shrinks options.",
    ],
    phases: ["middlegame", "any"],
  },
  {
    id: "bishop_pair",
    label: "Bishop pair",
    requireThemes: ["bishop_pair"],
    weight: 3,
    rules: [
      "The bishop pair thrives when the centre opens — open lines before one bishop is traded off.",
      "Against the pair, close the position or plant knights on holes the bishops cannot touch.",
    ],
    phases: ["middlegame", "endgame", "any"],
  },
  {
    id: "iqp",
    label: "Isolated queen pawn",
    requireThemes: ["iqp"],
    weight: 3,
    rules: [
      "With an IQP, use open files and activity before a dry ending — outposts in front of the pawn are classic.",
      "Against an IQP, blockade the square ahead, trade pieces, and steer toward an ending where the isolani is weak.",
    ],
    phases: ["middlegame", "any"],
  },
  {
    id: "hanging_pawns",
    label: "Hanging pawns",
    requireThemes: ["hanging_pawns"],
    weight: 3,
    rules: [
      "Hanging pawns want mobility — freeze them and they become fixed targets on open files.",
      "Pressure the base, provoke an advance, then occupy the hole or the newly opened file.",
    ],
    phases: ["middlegame", "any"],
  },
  {
    id: "passed_pawn",
    label: "Passed pawn",
    requireThemes: ["passed_pawn"],
    weight: 3,
    rules: [
      "A passer is a plan magnet — escort it or force the opponent into a passive block.",
      "Outside passers often outweigh central ones in endings because the king cannot babysit both wings.",
    ],
    phases: ["middlegame", "endgame", "any"],
  },
  {
    id: "minority_attack",
    label: "Minority attack",
    requireThemes: ["minority_attack"],
    weight: 3,
    rules: [
      "A minority attack aims to create a weak pawn on the opponent's queenside majority — prepare the break before pushing.",
      "A premature minority push can leave your own pawns soft.",
    ],
    phases: ["middlegame", "any"],
  },
  {
    id: "pawn_chain",
    label: "Pawn chains",
    requireThemes: ["pawn_chain"],
    weight: 2,
    rules: [
      "Attack a pawn chain at its base; the tip advances, the base is the hinge.",
      "The side with the chain tip often plays on that wing; the other side hits the base or breaks elsewhere.",
    ],
    phases: ["middlegame", "opening", "any"],
  },
  {
    id: "outpost",
    label: "Outposts",
    requireThemes: ["outpost"],
    weight: 2,
    rules: [
      "An outpost knight on a hole the opponent cannot challenge with a pawn anchors an attack or bind.",
      "If the opponent plants an outpost, challenge it with a trade or undermine the pawns that support it.",
    ],
    phases: ["middlegame", "any"],
  },
  {
    id: "endgame_technique",
    label: "Endgame principles",
    requireThemes: ["endgame_technique"],
    weight: 2,
    rules: [
      "Activate the king and create a passed pawn — passive kings lose quiet endings.",
      "Trade into a known win; avoid pawn moves that create new weaknesses.",
      "Rooks belong behind passed pawns — yours or theirs.",
    ],
    phases: ["endgame", "any"],
  },
];
