import { Chess, type Square } from "chess.js";
import { GLOBAL_DEPTH } from "../analysisConfig";
import { applyUciMove, uciFromMove } from "../chessMoves";
import { formatOpeningLabel } from "./ecoLabels";
import { retrieveKnowledgeNugget } from "./retrieve";
import {
  detectOpeningFamily,
  detectStructureThemes,
} from "./structureDetect";

export type EvalFn = (
  fen: string,
  depth?: number,
  multiPv?: number,
  movetimeMs?: number
) => Promise<{
  cpWhite: number;
  bestUci: string | null;
  bestPv?: string[];
  multipv?: Array<{ uci: string; cpWhite: number; pv?: string[] }>;
}>;

export type EngineLine = {
  rank: number;
  san: string;
  cpWhite: number;
  pvSan: string[];
};

export type GameCoachPly = {
  ply: number;
  fullmove: number;
  side: "white" | "black";
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  evalBeforeCp: number | null;
  evalAfterCp: number | null;
  deltaCp: number;
  bestSan: string | null;
  bestPvSan: string[];
  lines: EngineLine[];
  note: string;
  analyzed: boolean;
};

export type GameCoachResult = {
  gameId: string;
  openingLabel: string;
  analyzedAt: number;
  depth: number;
  plies: GameCoachPly[];
  notesCount: number;
};

export type AnalyzeProgress = {
  ply: number;
  total: number;
  status: string;
};

function formatEval(cp: number | null): string {
  if (cp == null) return "n/a";
  return `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
}

function phaseForPly(ply: number, pieceCount: number): "opening" | "middlegame" | "endgame" {
  if (ply <= 16 && pieceCount >= 28) return "opening";
  if (pieceCount <= 12) return "endgame";
  return "middlegame";
}

function moveSketch(side: "white" | "black", san: string, fenBefore: string): string {
  const who = side === "white" ? "White" : "Black";
  try {
    const board = new Chess(fenBefore);
    const move = board.move(san);
    if (!move) return `${who} continues.`;
    if (move.flags.includes("k") || move.flags.includes("q")) {
      return `${who} castles, knitting the rooks and tucking the king.`;
    }
    if (move.captured) {
      return `${who} takes on ${move.to}, changing the tension.`;
    }
    if (move.piece === "p") {
      return `${who} pushes to ${move.to}, reshaping the pawn skeleton.`;
    }
    const names: Record<string, string> = {
      n: "knight",
      b: "bishop",
      r: "rook",
      q: "queen",
      k: "king",
    };
    return `${who} steers the ${names[move.piece] || "piece"} toward ${move.to}.`;
  } catch {
    return `${who} plays ${san}.`;
  }
}

function whyAlternative(
  bestSan: string,
  bestPvSan: string[],
  themes: string[]
): string {
  const follow = bestPvSan.slice(1, 3).join(" ");
  if (follow) {
    return `${bestSan} ${follow} keeps clearer control of the fight.`;
  }
  if (themes.includes("open_c_file") || themes.includes("open_file")) {
    return `${bestSan} contests the open file before the opponent digs in.`;
  }
  if (themes.includes("iqp")) {
    return `${bestSan} handles the isolated pawn more purposefully.`;
  }
  if (themes.includes("hanging_pawns")) {
    return `${bestSan} keeps the hanging duo flexible instead of freezing it.`;
  }
  if (themes.includes("passed_pawn")) {
    return `${bestSan} treats the passer with more urgency.`;
  }
  if (themes.includes("bishop_pair")) {
    return `${bestSan} preserves or activates the bishop pair better.`;
  }
  if (themes.includes("space")) {
    return `${bestSan} uses the space edge without giving counterplay.`;
  }
  return `${bestSan} meets the position's demands more cleanly.`;
}

function trainingTip(deltaCp: number, themes: string[]): string {
  if (deltaCp >= 300) {
    return "Drill tactics that force a checks-captures-threats scan before you move.";
  }
  if (deltaCp >= 150) {
    if (themes.includes("open_file") || themes.includes("open_c_file")) {
      return "In training, pause on open-file positions and name the invasion square before choosing a move.";
    }
    if (themes.includes("iqp") || themes.includes("hanging_pawns")) {
      return "Practice structure positions: decide blockade vs break before calculating.";
    }
    return "When a move feels forcing, ask what you leave hanging and what the opponent's next threat is.";
  }
  if (deltaCp >= 80) {
    return "Compare two candidates out loud — yours and the engine's — and say which plan each serves.";
  }
  if (deltaCp >= 40) {
    return "Log the stronger alternative after the game and replay that branch once.";
  }
  return "";
}

/**
 * Weave position concepts (plans/motifs) with move judgment.
 * No labeled sections — only speak when the board or the gap calls for it.
 */
function composeCoachNote(args: {
  side: "white" | "black";
  san: string;
  fenBefore: string;
  deltaCp: number;
  bestSan: string | null;
  bestPvSan: string[];
  themes: string[];
  concept: string | null;
  openingLabel: string;
  ply: number;
}): string {
  const parts: string[] = [];
  const {
    side,
    san,
    fenBefore,
    deltaCp,
    bestSan,
    bestPvSan,
    themes,
    concept,
    openingLabel,
    ply,
  } = args;

  if (concept) {
    parts.push(concept);
  } else if (openingLabel && ply <= 8) {
    parts.push(
      `Typical ${openingLabel} motifs still matter here — centre control and where the pieces want to live.`
    );
  }

  parts.push(moveSketch(side, san, fenBefore));

  const matchesBest = Boolean(bestSan && bestSan === san);
  if (matchesBest || deltaCp < 40) {
    parts.push(
      matchesBest
        ? "Good choice — it fits what the position is asking for."
        : "Solid enough — the plan stays intact."
    );
  } else if (bestSan) {
    const judgment =
      deltaCp >= 300
        ? "Bad"
        : deltaCp >= 150
          ? "Mistake"
          : deltaCp >= 80
            ? "Inaccurate"
            : "Okay";
    parts.push(
      `${judgment}: ${whyAlternative(bestSan, bestPvSan, themes)}`
    );
    const tip = trainingTip(deltaCp, themes);
    if (tip) parts.push(tip);
  } else if (deltaCp >= 80) {
    parts.push(
      deltaCp >= 150
        ? "Mistake — a calmer look at the threats would have helped."
        : "Inaccurate — the idea is understandable, but the timing is off."
    );
    const tip = trainingTip(deltaCp, themes);
    if (tip) parts.push(tip);
  }

  return parts.join(" ");
}

function shouldSamplePly(ply: number, totalPlies: number): boolean {
  if (totalPlies <= 0) return false;
  if (ply <= 18) return ply % 2 === 0;
  if (ply >= totalPlies - 1) return true;
  return ply % 4 === 0;
}

function sanFromUci(fen: string, uci: string | null): string | null {
  if (!uci || uci.length < 4) return null;
  try {
    const board = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const move = board.move({
      from: from as never,
      to: to as never,
      promotion: promotion as never,
    });
    return move?.san || null;
  } catch {
    return null;
  }
}

function pvToSan(fen: string, pv: string[] | undefined, max = 14): string[] {
  if (!pv?.length) return [];
  try {
    const board = new Chess(fen);
    const out: string[] = [];
    for (const uci of pv.slice(0, max)) {
      if (!uci || uci.length < 4) break;
      const from = uci.slice(0, 2) as Square;
      const to = uci.slice(2, 4) as Square;
      const promotion = uci.length > 4 ? uci[4] : undefined;
      const move = board.move({ from, to, promotion: promotion as never });
      if (!move) break;
      out.push(move.san);
    }
    return out;
  } catch {
    return [];
  }
}

export function linesFromEval(
  fen: string,
  result: {
    cpWhite: number;
    bestUci: string | null;
    bestPv?: string[];
    multipv?: Array<{ uci: string; cpWhite: number; pv?: string[] }>;
  }
): EngineLine[] {
  const rows =
    result.multipv && result.multipv.length
      ? result.multipv
      : result.bestUci
        ? [{ uci: result.bestUci, cpWhite: result.cpWhite, pv: result.bestPv }]
        : [];
  return rows.slice(0, 3).map((row, i) => {
    const pvSan = pvToSan(fen, row.pv?.length ? row.pv : row.uci ? [row.uci] : []);
    return {
      rank: i + 1,
      san: pvSan[0] || sanFromUci(fen, row.uci) || row.uci || "—",
      cpWhite: row.cpWhite,
      pvSan,
    };
  });
}

export function parseGamePlies(pgnOrMoves: string): Array<{
  ply: number;
  fullmove: number;
  side: "white" | "black";
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
}> {
  const board = new Chess();
  const raw = (pgnOrMoves || "").trim();
  if (!raw) return [];

  try {
    if (raw.includes("[") || /^\s*1\./.test(raw)) {
      board.loadPgn(raw, { strict: false });
    } else {
      for (const tok of raw.split(/\s+/)) {
        if (!tok || /^\d+\.+$/.test(tok) || tok === "*" || /^\d-\d/.test(tok)) {
          continue;
        }
        if (!board.move(tok)) return [];
      }
    }
  } catch {
    return [];
  }

  const history = board.history({ verbose: true });
  const walk = new Chess();
  return history.map((move, index) => {
    const fenBefore = walk.fen();
    const fullmove = Number(fenBefore.split(" ")[5] || 1);
    const side = move.color === "w" ? "white" : ("black" as const);
    const uci = uciFromMove(move);
    walk.move(move);
    return {
      ply: index + 1,
      fullmove,
      side,
      san: move.san,
      uci,
      fenBefore,
      fenAfter: walk.fen(),
    };
  });
}

/**
 * Analyze a user-selected game with Stockfish 18 + structure-gated knowledge.
 */
export async function analyzeSelectedGame(options: {
  gameId: string;
  pgn?: string | null;
  moves?: string | null;
  eco?: string | null;
  opening?: string | null;
  evaluate: EvalFn;
  depth?: number;
  multiPv?: number;
  onProgress?: (p: AnalyzeProgress) => void;
  signal?: { cancelled: boolean };
}): Promise<GameCoachResult> {
  const depth = options.depth ?? GLOBAL_DEPTH;
  const multiPv = options.multiPv ?? 3;
  const source = options.pgn || options.moves || "";
  const skeleton = parseGamePlies(source);
  const openingLabel = formatOpeningLabel(options.eco, options.opening);
  const openingTags = detectOpeningFamily(options.eco, options.opening);
  const usedKnowledge = new Set<string>();
  const plies: GameCoachPly[] = [];
  let prevEval: number | null = null;

  for (let i = 0; i < skeleton.length; i++) {
    if (options.signal?.cancelled) break;
    const sk = skeleton[i];
    const sample = shouldSamplePly(sk.ply, skeleton.length);
    options.onProgress?.({
      ply: i + 1,
      total: skeleton.length,
      status: sample
        ? `Evaluating ${sk.fullmove}${sk.side === "white" ? "." : "..."} ${sk.san}`
        : "Replaying…",
    });

    let evalBefore: number | null = prevEval;
    let evalAfter: number | null = null;
    let bestSan: string | null = null;
    let bestPvSan: string[] = [];
    let lines: EngineLine[] = [];
    let deltaCp = 0;
    let note = "";
    let analyzed = false;

    if (sample) {
      try {
        const before = await options.evaluate(sk.fenBefore, depth, multiPv, 0);
        evalBefore = before.cpWhite;
        bestSan = sanFromUci(sk.fenBefore, before.bestUci);
        bestPvSan = pvToSan(sk.fenBefore, before.bestPv);
        lines = linesFromEval(sk.fenBefore, before);

        const after = await options.evaluate(sk.fenAfter, depth, 1, 0);
        evalAfter = after.cpWhite;
        const loss =
          sk.side === "white"
            ? (evalBefore ?? 0) - (evalAfter ?? 0)
            : (evalAfter ?? 0) - (evalBefore ?? 0);
        deltaCp = Math.max(0, Math.round(loss));
        analyzed = true;

        const pieceCount = sk.fenAfter.split(" ")[0].replace(/\d/g, "").length;
        const phase = phaseForPly(sk.ply, pieceCount);
        const structure = detectStructureThemes(sk.fenAfter);
        // Opening-family tags only in opening; structure tags always board-true.
        const themes =
          phase === "opening"
            ? [...structure, ...openingTags, "development"]
            : [...structure];
        const nugget = retrieveKnowledgeNugget({ themes, phase }, usedKnowledge);
        note = composeCoachNote({
          side: sk.side,
          san: sk.san,
          fenBefore: sk.fenBefore,
          deltaCp,
          bestSan,
          bestPvSan,
          themes,
          concept: nugget?.text || null,
          openingLabel,
          ply: sk.ply,
        });
      } catch {
        analyzed = false;
        note = "";
      }
    }

    prevEval = evalAfter ?? evalBefore ?? prevEval;
    plies.push({
      ...sk,
      evalBeforeCp: evalBefore,
      evalAfterCp: evalAfter,
      deltaCp,
      bestSan,
      bestPvSan,
      lines,
      note,
      analyzed,
    });

    await new Promise((r) => setTimeout(r, 0));
  }

  return {
    gameId: options.gameId,
    openingLabel,
    analyzedAt: Date.now(),
    depth,
    plies,
    notesCount: plies.filter((p) => p.note).length,
  };
}

export function buildReplayPlies(pgnOrMoves: string): GameCoachPly[] {
  return parseGamePlies(pgnOrMoves).map((p) => ({
    ...p,
    evalBeforeCp: null,
    evalAfterCp: null,
    deltaCp: 0,
    bestSan: null,
    bestPvSan: [],
    lines: [],
    note: "",
    analyzed: false,
  }));
}

export function applyUciOnFen(fen: string, uci: string): string | null {
  const board = new Chess(fen);
  if (!applyUciMove(board, uci)) return null;
  return board.fen();
}

export { formatEval };
