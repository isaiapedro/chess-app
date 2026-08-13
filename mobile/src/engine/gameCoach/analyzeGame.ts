import { Chess, type Square } from "chess.js";
import { GLOBAL_DEPTH } from "../analysisConfig";
import { applyUciMove, uciFromMove } from "../chessMoves";
import { toWhiteCp } from "../analyzeMistakes";
import { classifyCoachMark, type CoachMark } from "./coachMarks";
import { formatOpeningLabel } from "./ecoLabels";
import {
  emptyCoachGameMetrics,
  lookupCoachGameMetrics,
  type CoachGameMetrics,
} from "./gameMetricsLookup";
import { composeCoachNote, expandCoachThemes, classifyUserError, shouldComposeNote } from "./noteCompose";
import { assessPositionPov } from "./positionPov";
import { retrieveKnowledgeNuggets } from "./retrieve";
import {
  detectOpeningFamily,
  detectStructureThemes,
} from "./structureDetect";
import type { Platform } from "../../api/types";

const KING_FILTER = new Set([
  "king_safety",
  "opp_king_exposed",
  "user_king_exposed",
  "attack",
]);

function normalizeUserColor(raw?: string | null): "white" | "black" {
  const v = String(raw || "white").trim().toLowerCase();
  if (v === "black" || v === "b") return "black";
  return "white";
}

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
  mark: CoachMark | null;
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

function shouldSamplePly(ply: number, totalPlies: number): boolean {
  if (totalPlies <= 0) return false;
  if (ply <= 24) return true;
  if (ply >= totalPlies - 1) return true;
  return ply % 2 === 0;
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
      cpWhite: toWhiteCp(fen, row.cpWhite),
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
 * Analyze a user-selected game with Stockfish 18 + structure/phase RAG.
 */
export async function analyzeSelectedGame(options: {
  gameId: string;
  pgn?: string | null;
  moves?: string | null;
  eco?: string | null;
  opening?: string | null;
  userColor?: string | null;
  platform?: Platform;
  username?: string;
  metrics?: CoachGameMetrics | null;
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
  const userColor = normalizeUserColor(options.userColor);
  const usedKnowledge = new Set<string>();
  const usedTips = new Set<string>();
  const plies: GameCoachPly[] = [];
  let prevEval: number | null = null;

  let metrics = options.metrics || null;
  if (!metrics && options.platform && options.username) {
    try {
      metrics = await lookupCoachGameMetrics({
        platform: options.platform,
        username: options.username,
        gameId: options.gameId,
        userColor,
      });
    } catch {
      metrics = emptyCoachGameMetrics();
    }
  }
  if (!metrics) metrics = emptyCoachGameMetrics();

  for (let i = 0; i < skeleton.length; i++) {
    if (options.signal?.cancelled) break;
    const sk = skeleton[i];
    const isUserPly = sk.side === userColor;
    const momentAtPly = isUserPly ? metrics.momentsByPly[sk.ply] || null : null;
    const sample =
      shouldSamplePly(sk.ply, skeleton.length) || Boolean(momentAtPly);
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
    let mark: CoachMark | null = null;

    try {
      if (sample) {
        const before = await options.evaluate(sk.fenBefore, depth, multiPv, 0);
        evalBefore = toWhiteCp(sk.fenBefore, before.cpWhite);
        bestSan = sanFromUci(sk.fenBefore, before.bestUci);
        bestPvSan = pvToSan(sk.fenBefore, before.bestPv);
        lines = linesFromEval(sk.fenBefore, before);
      }

      const after = await options.evaluate(sk.fenAfter, depth, 1, 0);
      evalAfter = toWhiteCp(sk.fenAfter, after.cpWhite);
      analyzed = true;

      if (evalBefore != null && evalAfter != null) {
        const loss =
          sk.side === "white"
            ? evalBefore - evalAfter
            : evalAfter - evalBefore;
        deltaCp = Math.max(0, Math.round(loss));
      }

      const playedBest = Boolean(bestSan && bestSan === sk.san);
      mark =
        evalBefore != null && evalAfter != null
          ? classifyCoachMark({
              side: sk.side,
              evalBeforeCp: evalBefore,
              evalAfterCp: evalAfter,
              playedBest,
            })
          : null;

      if (sample) {
        const pieceCount = sk.fenAfter.split(" ")[0].replace(/\d/g, "").length;
        const phase = phaseForPly(sk.ply, pieceCount);
        const structure = detectStructureThemes(sk.fenAfter);
        const pov = assessPositionPov(sk.fenAfter, userColor);
        const moment = momentAtPly;
        const perspective = isUserPly ? "user" : "opponent";
        const provisionalThemes = [
          ...structure,
          ...(pov.kingMotifLive ? pov.themes : []),
          ...(isUserPly ? metrics.themesByPhase[phase] : []),
        ];
        const errorKind = isUserPly
          ? classifyUserError({
              fenBefore: sk.fenBefore,
              playedSan: sk.san,
              bestSan,
              bestPvSan,
              deltaCp,
              themes: provisionalThemes,
              userColor,
              moment,
              pov,
            })
          : null;
        const noteWorthy = shouldComposeNote({
          perspective,
          deltaCp,
          playedBest,
          moment,
          structure,
          errorKind,
          ply: sk.ply,
        });
        // One-shot opening / MG plan even on quiet user plies early
        const wantPhasePlan =
          isUserPly &&
          ((phase === "opening" && sk.ply <= 10) || phase === "middlegame");
        if (!noteWorthy && !wantPhasePlan) {
          note = "";
        } else {
          const metricsThemes = isUserPly
            ? moment || deltaCp >= 80
              ? [
                  ...metrics.themesByPhase[phase],
                  ...(moment ? metrics.globalThemes : []),
                ]
              : []
            : [];
          const themes = expandCoachThemes({
            structure,
            openingTags,
            phase,
            deltaCp,
            playedBest,
            metricsThemes,
            moment,
            perspective,
            errorKind,
            noteWorthy: noteWorthy || wantPhasePlan,
            pov,
            fenBefore: sk.fenBefore,
            playedSan: sk.san,
            bestSan,
            usedTips,
          });
          // Drop king RAG when motif not relevant this ply
          const ragThemes = themes.filter((t) => {
            if (!KING_FILTER.has(t)) return true;
            return themes.includes("opp_king_exposed") || themes.includes("user_king_exposed");
          });
          const wantCount =
            (isUserPly && (errorKind || moment)) ||
            (!isUserPly && deltaCp >= 100)
              ? 1
              : 0;
          const nuggets =
            wantCount > 0
              ? retrieveKnowledgeNuggets(
                  {
                    themes: ragThemes,
                    phase,
                    wantCount,
                    strict: true,
                  },
                  usedKnowledge
                )
              : [];
          note = composeCoachNote({
            side: sk.side,
            userColor,
            san: sk.san,
            fenBefore: sk.fenBefore,
            fenAfter: sk.fenAfter,
            deltaCp,
            bestSan,
            bestPvSan,
            themes,
            concepts: nuggets.map((n) => n.text),
            usedTips,
            openingLabel,
            ply: sk.ply,
            phase,
            metrics,
            moment,
            errorKind,
            pov,
          });
        }
      }
    } catch {
      analyzed = false;
      note = "";
      mark = null;
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
      mark,
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
    mark: null,
  }));
}

export function applyUciOnFen(fen: string, uci: string): string | null {
  const board = new Chess(fen);
  if (!applyUciMove(board, uci)) return null;
  return board.fen();
}

export { formatEval };
