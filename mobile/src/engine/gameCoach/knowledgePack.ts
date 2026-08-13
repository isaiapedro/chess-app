/**
 * On-device knowledge: plans, motifs, structure ideas.
 * Fired only when board/opening tags match — plain coaching phrases.
 */

export type KnowledgeCard = {
  id: string;
  label: string;
  requireThemes: string[];
  rules: string[];
  phases?: Array<"opening" | "middlegame" | "endgame" | "any">;
};

export const KNOWLEDGE_PACK: KnowledgeCard[] = [
  {
    id: "open_c_file",
    label: "Open c-file",
    requireThemes: ["open_c_file"],
    rules: [
      "The open c-file is the highway here — rooks dream of c7/c2, and whoever seizes it first often dictates the queenside.",
      "A familiar motif: trade into the file, then double or swing a rook to the seventh before the opponent contests.",
    ],
    phases: ["middlegame", "any"],
  },
  {
    id: "open_file",
    label: "Open file",
    requireThemes: ["open_file"],
    rules: [
      "An open file only pays rent if a major piece can invade the 7th/2nd — occupancy without entry is temporary noise.",
      "Common plan: contest the file, force a trade of the opponent's active rook, then use the leftover major for the back-rank or seventh.",
    ],
    phases: ["middlegame", "endgame", "any"],
  },
  {
    id: "space",
    label: "Space advantage",
    requireThemes: ["space"],
    rules: [
      "Extra space means you can reshuffle while the cramped side struggles for squares — improve slowly and choke counterbreaks.",
      "Motif to watch: don't rush pawn trades that free the opponent's pieces; first park your own on ideal circuits.",
    ],
    phases: ["middlegame", "any"],
  },
  {
    id: "bishop_pair",
    label: "Bishop pair",
    requireThemes: ["bishop_pair"],
    rules: [
      "With the bishop pair, open the centre so the long diagonals cut across both wings.",
      "Without it, close lines or plant a knight on a hole the bishops can't touch — classic anti-pair plan.",
    ],
    phases: ["middlegame", "endgame", "any"],
  },
  {
    id: "iqp",
    label: "Isolated queen pawn",
    requireThemes: ["iqp"],
    rules: [
      "IQP positions live on activity: open files, piece pressure, and avoiding a dry ending where the isolani is just weak.",
      "Against an IQP, the blockade on the square in front is the motif — then trade into an ending where the pawn can't be protected.",
    ],
    phases: ["middlegame", "any"],
  },
  {
    id: "hanging_pawns",
    label: "Hanging pawns",
    requireThemes: ["hanging_pawns"],
    rules: [
      "Hanging pawns want mobility and piece support; freeze them and they become fixed targets on open files.",
      "Frequent plan against them: pressure the base, provoke an advance, then occupy the new hole or the opened file.",
    ],
    phases: ["middlegame", "any"],
  },
  {
    id: "passed_pawn",
    label: "Passed pawn",
    requireThemes: ["passed_pawn"],
    rules: [
      "A passer is a long-term plan magnet — escort it or force the opponent into a passive block that cedes play elsewhere.",
      "In endings, an outside passer often outweighs a central one because the king can't babysit both.",
    ],
    phases: ["middlegame", "endgame", "any"],
  },
  {
    id: "kings_indian",
    label: "King's Indian plans",
    requireThemes: ["kings_indian"],
    rules: [
      "King's Indian battles often split the board: White grabs queenside space while Black prepares …f5 and kingside play.",
      "Motif for Black — time …f5 carefully; slamming …f4 too early can kill your own attack and leave the dark squares soft.",
    ],
    phases: ["opening", "middlegame", "any"],
  },
  {
    id: "catalan",
    label: "Catalan ideas",
    requireThemes: ["catalan"],
    rules: [
      "Catalan pressure hangs on the g2 bishop — long-term heat on the queenside, even when the centre looks quiet.",
      "Black's fork in the road: grab on c4 and hold the pawn, or keep a solid centre and neutralize the fianchetto slowly.",
    ],
    phases: ["opening", "middlegame", "any"],
  },
  {
    id: "sicilian",
    label: "Sicilian plans",
    requireThemes: ["sicilian"],
    rules: [
      "Open Sicilians often become opposite-side races — tempo, king safety, and who breaks first decide more than quiet manoeuvres.",
      "Black's classic equalizer is …d5; White's job is to keep a central clamp and strike before that break lands cleanly.",
    ],
    phases: ["opening", "middlegame", "any"],
  },
  {
    id: "ruy_lopez",
    label: "Ruy Lopez plans",
    requireThemes: ["ruy_lopez"],
    rules: [
      "Spanish structures lean on queenside space — a2–a4, piece pressure on a7/c7, and slow improvement.",
      "Black's familiar manoeuvre …Be7–d8–b6 (or similar) reorganizes toward a healthier setup before challenging the centre.",
    ],
    phases: ["opening", "middlegame", "any"],
  },
  {
    id: "development",
    label: "Opening fundamentals",
    requireThemes: ["development"],
    rules: [
      "Early on, the plan is simple but easy to forget: develop, castle, connect rooks before launching pawn storms.",
      "Fight for the centre with pawns or pieces — neglect here turns into lasting pressure later.",
    ],
    phases: ["opening", "any"],
  },
];
