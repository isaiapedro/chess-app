import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import {
  STYLE_PIECE_VALUE,
  SACRIFICE_MIN_OFFER,
  canRecapture,
  hasMaterialWinTactic,
  maxUndefendedHangingPieces,
  sacrificeOfferAfterMove,
} from "../styleMetrics";
import {
  classifyEvalDrop,
  isMateScore,
  mateMovesFromCp,
  userWinProbability,
  type EvalDropKind,
} from "../winProb";
import {
  detectDelayedPieceCapture,
  detectNewlyTrappedAlongSans,
  findZeroSafeMobilityPieces,
  isLosingTrapCapture,
  safeMobilityForSquare,
  type SafeMobilityResult,
} from "../trappedPiece";
import { measureTacticSharpness } from "./tacticSharpness";
import { detectBoardMotif, type BoardMotifKind } from "./boardMotif";

const PIECE_VALUE = STYLE_PIECE_VALUE;

const PIECE_NAME: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export type TacticalFact = {
  kind:
    | "gave_piece"
    | "missed_capture"
    | "missed_tactic"
    | "missed_mate"
    | "hung_mate"
    | "bad_trade"
    | "sacrifice"
    | "trapped_piece"
    | null;
  motif?: BoardMotifKind | null;
  pieceLabel: string | null;
  captureSan: string | null;
  takenNext: boolean;
  mateIn: number | null;
  trapSquare?: string | null;
  capturePlyDelay?: number | null;
  finalMaterialDelta?: number | null;
  selfInflicted?: boolean;
};

function withMotif(
  fact: TacticalFact,
  motif: ReturnType<typeof detectBoardMotif>
): TacticalFact {
  if (!motif) return fact;
  return {
    ...fact,
    motif: motif.kind,
    pieceLabel: fact.pieceLabel || motif.pieceLabel,
  };
}

function colorOf(userColor: "white" | "black"): Color {
  return userColor === "black" ? "b" : "w";
}

function emptyFact(): TacticalFact {
  return {
    kind: null,
    motif: null,
    pieceLabel: null,
    captureSan: null,
    takenNext: false,
    mateIn: null,
    trapSquare: null,
    capturePlyDelay: null,
    finalMaterialDelta: null,
  };
}

function moverHasMate(cpWhite: number, moverIsWhite: boolean): boolean {
  if (!isMateScore(cpWhite)) return false;
  return moverIsWhite ? cpWhite > 0 : cpWhite < 0;
}

export function forcingPrefix(pvSan: string[]): string {
  if (!pvSan.length) return "";
  const bits: string[] = [pvSan[0]!];
  let quietStreak =
    /[+#]$/.test(pvSan[0]!) || pvSan[0]!.includes("x") ? 0 : 1;
  for (const san of pvSan.slice(1, 8)) {
    bits.push(san);
    const force = /[+#]$/.test(san) || san.includes("x");
    quietStreak = force ? 0 : quietStreak + 1;
    if (quietStreak >= 2 && bits.length >= 2) break;
  }
  return bits.join(" ");
}

/** Forcing miss: mover skipped a multi-move / check / capture line. */
export function missedForcingLine(args: {
  playedSan: string;
  bestSan: string | null;
  bestPvSan: string[];
  deltaCp: number;
}): string | null {
  if (!args.bestSan || args.bestSan === args.playedSan) return null;
  if (args.deltaCp < 120) return null;
  const forcing = forcingPrefix(args.bestPvSan) || args.bestSan;
  if (!forcing) return null;
  if (/[+#]/.test(forcing) || forcing.includes("x") || forcing.split(" ").length >= 2) {
    return forcing;
  }
  return null;
}

function labelForVal(val: number): string {
  if (val >= 9) return "queen";
  if (val >= 5) return "rook";
  if (val >= 3) return "minor piece";
  return "pawn";
}

function findMaterialWinCapture(
  fen: string,
  preferSan: string | null
): { type: PieceSymbol; san: string; free: boolean; gain: number } | null {
  try {
    const board = new Chess(fen);
    const color = board.turn();
    if (!hasMaterialWinTactic(board, color)) return null;

    const moves = board.moves({ verbose: true }) as Move[];
    const scored: Array<{
      type: PieceSymbol;
      san: string;
      free: boolean;
      gain: number;
    }> = [];

    for (const m of moves) {
      if (!m.isCapture() || !m.captured || m.captured === "k") continue;
      const gain = PIECE_VALUE[m.captured] || 0;
      if (gain < 1) continue;
      const dest = m.to;
      const attacked = board.isAttacked(dest, color === "w" ? "b" : "w");
      if (!attacked) {
        if (gain >= 3 || m.captured !== "p") {
          scored.push({
            type: m.captured,
            san: m.san,
            free: true,
            gain,
          });
        }
        continue;
      }
      const defenders = board.attackers(dest, color === "w" ? "b" : "w");
      let minDef = 99;
      for (const d of defenders) {
        const dp = board.get(d);
        if (!dp) continue;
        minDef = Math.min(minDef, PIECE_VALUE[dp.type] || 99);
      }
      const aVal = PIECE_VALUE[m.piece] || 0;
      if (gain > aVal || (gain >= aVal && aVal <= minDef)) {
        scored.push({
          type: m.captured,
          san: m.san,
          free: gain > aVal,
          gain: gain - aVal,
        });
      }
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.gain - a.gain);
    if (preferSan) {
      const hit = scored.find((s) => s.san === preferSan);
      if (hit) return hit;
    }
    return scored[0];
  } catch {
    return null;
  }
}

function replyTakesSquare(
  fenAfter: string,
  replySan: string | null | undefined,
  sq: Square
): boolean {
  if (!replySan) return false;
  try {
    const board = new Chess(fenAfter);
    const move = board.move(replySan);
    return Boolean(move && move.isCapture() && move.to === sq);
  } catch {
    return false;
  }
}

function replyTakesOnAnyHang(
  fenAfter: string,
  replySan: string | null | undefined,
  user: Color
): boolean {
  if (!replySan) return false;
  try {
    const board = new Chess(fenAfter);
    const beforeHung = maxUndefendedHangingPieces(board, user);
    if (beforeHung < SACRIFICE_MIN_OFFER) return false;
    const move = board.move(replySan);
    return Boolean(move?.isCapture());
  } catch {
    return false;
  }
}

function isEvalDrop(kind: EvalDropKind): boolean {
  return kind === "blunder" || kind === "mistake" || kind === "inaccuracy";
}

function continuationSansForPlayed(args: {
  playedContinuationSans?: string[] | null;
  opponentReplySan?: string | null;
}): string[] {
  const fromLine = (args.playedContinuationSans || []).filter(Boolean);
  if (fromLine.length) return fromLine;
  if (args.opponentReplySan) return [args.opponentReplySan];
  return [];
}

function selfTrapFact(args: {
  pieceLabel: string;
  captureSan: string | null;
  trapSquare: string | null;
  capturePlyDelay: number | null;
  finalMaterialDelta: number | null;
  takenNext: boolean;
}): TacticalFact {
  return {
    kind: "trapped_piece",
    selfInflicted: true,
    pieceLabel: args.pieceLabel,
    captureSan: args.captureSan,
    takenNext: args.takenNext,
    mateIn: null,
    trapSquare: args.trapSquare,
    capturePlyDelay: args.capturePlyDelay,
    finalMaterialDelta: args.finalMaterialDelta,
  };
}

function pickNewlyBoxedOwnPiece(
  fenBefore: string,
  afterBoard: Chess,
  user: Color,
  move: Move
): SafeMobilityResult | null {
  let before: Chess;
  try {
    before = new Chess(fenBefore);
  } catch {
    return null;
  }
  const afterZeros = findZeroSafeMobilityPieces(afterBoard, user);
  const newly: SafeMobilityResult[] = [];
  for (const z of afterZeros) {
    const value = PIECE_VALUE[z.piece] || 0;
    if (value < 3) continue;
    if (z.legalMoves.length) continue;
    if (!isLosingTrapCapture(afterBoard, z.square, user)) continue;
    const prevSame = safeMobilityForSquare(before, z.square);
    if (
      prevSame &&
      prevSame.piece === z.piece &&
      prevSame.color === z.color
    ) {
      if (prevSame.safeMobility > 0) newly.push(z);
      continue;
    }
    if (move.to === z.square) {
      const fromSnap = safeMobilityForSquare(before, move.from as Square);
      if (fromSnap && fromSnap.safeMobility > 0) newly.push(z);
    }
  }
  newly.sort(
    (a, b) => (PIECE_VALUE[b.piece] || 0) - (PIECE_VALUE[a.piece] || 0)
  );
  return newly[0] || null;
}

function detectSelfInflictedTrap(args: {
  fenBefore: string;
  afterBoard: Chess;
  move: Move;
  user: Color;
  continuationSans: string[];
}): TacticalFact | null {
  const fenAfter = args.afterBoard.fen();
  if (args.continuationSans.length) {
    const along = detectNewlyTrappedAlongSans({
      fen: fenAfter,
      sans: args.continuationSans,
      victimColor: args.user,
      maxPly: 6,
    });
    if (along && (PIECE_VALUE[along.piece] || 0) >= 3) {
      return selfTrapFact({
        pieceLabel: along.pieceLabel,
        captureSan: along.winningLine,
        trapSquare: along.square,
        capturePlyDelay: along.capturePlyDelay,
        finalMaterialDelta: along.finalMaterialDelta,
        takenNext:
          along.finalMaterialDelta < 0 && along.capturePlyDelay === 1,
      });
    }
    const trap = detectDelayedPieceCapture({
      fen: fenAfter,
      sans: args.continuationSans,
      victimColor: args.user,
      minPly: 1,
      maxPly: 6,
    });
    if (trap && (PIECE_VALUE[trap.piece] || 0) >= 3) {
      return selfTrapFact({
        pieceLabel: trap.pieceLabel,
        captureSan: trap.winningLine,
        trapSquare: trap.square,
        capturePlyDelay: trap.capturePlyDelay,
        finalMaterialDelta: trap.finalMaterialDelta,
        takenNext: trap.capturePlyDelay === 1,
      });
    }
  }
  const boxed = pickNewlyBoxedOwnPiece(
    args.fenBefore,
    args.afterBoard,
    args.user,
    args.move
  );
  if (!boxed) return null;
  return selfTrapFact({
    pieceLabel: boxed.pieceLabel,
    captureSan: null,
    trapSquare: boxed.square,
    capturePlyDelay: null,
    finalMaterialDelta: null,
    takenNext: false,
  });
}

export function detectTacticalFact(args: {
  fenBefore: string;
  fenAfter?: string;
  playedSan: string;
  bestSan: string | null;
  bestPvSan: string[];
  userColor: "white" | "black";
  deltaCp: number;
  evalBeforeWhite?: number | null;
  evalAfterWhite?: number | null;
  opponentReplySan?: string | null;
  playedContinuationSans?: string[] | null;
  side?: "white" | "black";
  lines?: { cpWhite: number }[] | null;
}): TacticalFact {
  const empty = emptyFact();
  const moverIsWhite = (args.side || args.userColor) === "white";
  const before = args.evalBeforeWhite;
  const after = args.evalAfterWhite;
  const hasMateSignal =
    (before != null && isMateScore(before)) ||
    (after != null && isMateScore(after));
  if (args.deltaCp < 80 && !hasMateSignal) return empty;

  const user = colorOf(args.userColor);
  const userIsWhite = args.userColor === "white";
  const bestMotif =
    args.bestSan && args.bestSan !== args.playedSan
      ? detectBoardMotif({
          fen: args.fenBefore,
          san: args.bestSan,
          color: user,
        })
      : null;

  if (
    before != null &&
    after != null &&
    moverHasMate(before, moverIsWhite) &&
    args.bestSan &&
    args.playedSan !== args.bestSan &&
    !moverHasMate(after, moverIsWhite)
  ) {
    const mateIn = mateMovesFromCp(before);
    const line = forcingPrefix(args.bestPvSan) || args.bestSan;
    return {
      kind: "missed_mate",
      pieceLabel: null,
      captureSan: line,
      takenNext: false,
      mateIn,
    };
  }

  if (
    after != null &&
    moverHasMate(after, !moverIsWhite) &&
    (before == null || !moverHasMate(before, !moverIsWhite))
  ) {
    return {
      kind: "hung_mate",
      pieceLabel: null,
      captureSan: args.bestSan,
      takenNext: Boolean(args.opponentReplySan),
      mateIn: mateMovesFromCp(after),
    };
  }

  let dropKind: EvalDropKind = null;
  if (
    before != null &&
    after != null &&
    Number.isFinite(before) &&
    Number.isFinite(after)
  ) {
    const wpBefore = userWinProbability(before, userIsWhite);
    const wpAfter = userWinProbability(after, userIsWhite);
    dropKind = classifyEvalDrop(wpBefore, wpAfter);
  } else if (args.deltaCp >= 200) {
    dropKind = "blunder";
  } else if (args.deltaCp >= 120) {
    dropKind = "mistake";
  }

  const prefer =
    args.bestSan || (args.bestPvSan[0] ? args.bestPvSan[0] : null);
  const winCap = findMaterialWinCapture(args.fenBefore, prefer);
  const playedContinuation = continuationSansForPlayed(args);

  try {
    const board = new Chess(args.fenBefore);
    const move = board.move(args.playedSan) as Move | null;
    if (!move) return empty;
    const fenAfter = args.fenAfter || board.fen();
    const selfTrap = detectSelfInflictedTrap({
      fenBefore: args.fenBefore,
      afterBoard: board,
      move,
      user,
      continuationSans: playedContinuation,
    });
    if (selfTrap) return selfTrap;
    const toSq = move.to as Square;
    const offered = sacrificeOfferAfterMove(board, move, user);
    const recapturePossible = move.isCapture() && canRecapture(board, toSq);
    const hungVal = maxUndefendedHangingPieces(board, user);
    const replySan = playedContinuation[0] || args.opponentReplySan;
    const takenNext = replyTakesSquare(fenAfter, replySan, toSq);

    if (
      move.isCapture() &&
      recapturePossible &&
      offered < SACRIFICE_MIN_OFFER
    ) {
      if (
        winCap &&
        args.playedSan !== winCap.san &&
        args.deltaCp >= 120
      ) {
        return withMotif(
          {
            kind: "missed_capture",
            pieceLabel: PIECE_NAME[winCap.type],
            captureSan: winCap.san,
            takenNext: false,
            mateIn: null,
          },
          bestMotif
        );
      }
      return empty;
    }

    if (offered >= SACRIFICE_MIN_OFFER) {
      const label = labelForVal(offered);
      if (isEvalDrop(dropKind)) {
        const isLosingTrade =
          move.isCapture() && (takenNext || recapturePossible);
        return {
          kind: isLosingTrade ? "bad_trade" : "gave_piece",
          pieceLabel: label,
          captureSan: null,
          takenNext,
          mateIn: null,
        };
      }
      if (takenNext) {
        return {
          kind: "sacrifice",
          pieceLabel: label,
          captureSan: null,
          takenNext: true,
          mateIn: null,
        };
      }
    }

    if (
      hungVal >= SACRIFICE_MIN_OFFER &&
      (isEvalDrop(dropKind) || args.deltaCp >= 150)
    ) {
      return {
        kind: "gave_piece",
        pieceLabel: labelForVal(hungVal),
        captureSan: null,
        takenNext: replyTakesOnAnyHang(fenAfter, replySan, user),
        mateIn: null,
      };
    }
  } catch {
  }

  if (
    winCap &&
    winCap.gain >= 2 &&
    args.playedSan !== winCap.san &&
    args.deltaCp >= 100
  ) {
    return withMotif(
      {
        kind: "missed_capture",
        pieceLabel: PIECE_NAME[winCap.type],
        captureSan: winCap.san,
        takenNext: false,
        mateIn: null,
      },
      bestMotif
    );
  }

  if (
    args.bestSan &&
    args.playedSan !== args.bestSan &&
    args.deltaCp >= 120 &&
    args.bestPvSan.length >= 2
  ) {
    const opp = user === "w" ? "b" : "w";
    const trap = detectDelayedPieceCapture({
      fen: args.fenBefore,
      sans: args.bestPvSan,
      victimColor: opp,
    });
    if (trap) {
      return {
        kind: "trapped_piece",
        pieceLabel: trap.pieceLabel,
        captureSan: trap.winningLine,
        takenNext: false,
        mateIn: null,
        trapSquare: trap.square,
        capturePlyDelay: trap.capturePlyDelay,
        finalMaterialDelta: trap.finalMaterialDelta,
      };
    }
  }

  const forcing = forcingPrefix(args.bestPvSan);
  const sharp = measureTacticSharpness({
    pvSan: args.bestPvSan,
    lines: args.lines,
    side: args.side || args.userColor,
  });
  if (
    args.bestSan &&
    args.playedSan !== args.bestSan &&
    args.deltaCp >= 120 &&
    (sharp.forcingSharp || bestMotif)
  ) {
    return withMotif(
      {
        kind: "missed_tactic",
        pieceLabel: bestMotif?.pieceLabel || null,
        captureSan: forcing || args.bestSan,
        takenNext: false,
        mateIn: null,
      },
      bestMotif
    );
  }

  try {
    const board = new Chess(args.fenBefore);
    if (
      hasMaterialWinTactic(board, user) &&
      args.deltaCp >= 120 &&
      args.bestSan &&
      args.bestSan !== args.playedSan &&
      (/[+#]$/.test(args.bestSan) || args.bestSan.includes("x"))
    ) {
      return withMotif(
        {
          kind: "missed_tactic",
          pieceLabel: winCap ? PIECE_NAME[winCap.type] : null,
          captureSan: args.bestSan,
          takenNext: false,
          mateIn: null,
        },
        bestMotif
      );
    }
  } catch {
  }

  return empty;
}

/** Soft keys for didactic pack when a tactical fact fires. */
export function softKeysForTacticalFact(
  fact: TacticalFact | null | undefined
): string[] {
  if (!fact?.kind) return [];
  const fromMotif = softKeysForMotif(fact.motif);
  let fromKind: string[] = [];
  switch (fact.kind) {
    case "missed_mate":
    case "hung_mate":
      fromKind = [
        "methodology.visualization",
        "methodology.candidate_moves",
        "attack.initiative",
      ];
      break;
    case "missed_capture":
      fromKind = [
        "methodology.candidate_moves",
        "attack.initiative",
        "methodology.visualization",
      ];
      break;
    case "missed_tactic":
      fromKind = [
        "methodology.visualization",
        "methodology.candidate_moves",
      ];
      break;
    case "trapped_piece":
      fromKind = fact.selfInflicted
        ? [
            "motif.trapped_piece",
            "positional.prophylaxis",
            "methodology.visualization",
          ]
        : [
            "motif.trapped_piece",
            "positional.restriction",
            "methodology.visualization",
          ];
      break;
    case "gave_piece":
      fromKind = [
        "methodology.candidate_moves",
        "positional.prophylaxis",
        "methodology.visualization",
      ];
      break;
    case "bad_trade":
      fromKind = [
        "methodology.comparison_and_elimination",
        "methodology.candidate_moves",
        "piece.simplification",
      ];
      break;
    case "sacrifice":
      fromKind = ["motif.sacrifice", "attack.initiative", "methodology.visualization"];
      break;
    default:
      fromKind = ["methodology.candidate_moves"];
  }
  return [...new Set([...fromMotif, ...fromKind])];
}

function softKeysForMotif(motif: BoardMotifKind | null | undefined): string[] {
  if (!motif) return [];
  if (motif === "pin" || motif === "skewer") {
    return ["motif.pin_and_skewer", "methodology.visualization"];
  }
  if (motif === "fork") {
    return [
      "methodology.candidate_moves",
      "attack.initiative",
    ];
  }
  return ["methodology.candidate_moves", "attack.initiative"];
}

/** One-line accurate diagnosis (no book story). */
export function formatTacticalFactHead(fact: TacticalFact): string {
  if (!fact.kind) return "";
  const piece = (fact.pieceLabel || "material").replace(/_/g, " ");
  const line = fact.captureSan ? ` Best: ${fact.captureSan}.` : "";
  switch (fact.kind) {
    case "missed_mate":
      return fact.mateIn != null
        ? `Missed mate in ${fact.mateIn}.${line}`
        : `Missed a forced mate.${line}`;
    case "hung_mate":
      return fact.mateIn != null
        ? `Allowed mate in ${fact.mateIn}.`
        : `Allowed a forced mate.`;
    case "missed_capture":
      return `Missed capture of the ${piece}.${line}`;
    case "missed_tactic":
      if (fact.motif === "pin") {
        return `Missed a pin on the ${piece}.${line}`;
      }
      if (fact.motif === "skewer") {
        return `Missed a skewer of the ${piece}.${line}`;
      }
      if (fact.motif === "fork") {
        return `Missed a fork of the ${piece}.${line}`;
      }
      if (fact.motif === "hang") {
        return `Missed that the ${piece} hangs.${line}`;
      }
      return `Missed a forcing line.${line}`;
    case "trapped_piece":
      if (fact.selfInflicted) {
        const sq = fact.trapSquare ? ` on ${fact.trapSquare}` : "";
        const hunt = fact.captureSan ? ` ${fact.captureSan} takes it.` : "";
        return `Your ${piece}${sq} has no escape.${hunt}`;
      }
      return fact.trapSquare
        ? `Missed that the ${piece} on ${fact.trapSquare} is trapped.${line}`
        : `Missed a trapped ${piece}.${line}`;
    case "gave_piece":
      return fact.takenNext
        ? `Hung the ${piece} — taken next.`
        : `Left the ${piece} hanging.`;
    case "bad_trade":
      return `Bad trade of the ${piece}.`;
    case "sacrifice":
      return `Sacrificed the ${piece}${fact.takenNext ? " (taken)" : ""}.`;
    default:
      return "";
  }
}

export function formatTacticalFactShort(fact: TacticalFact | null | undefined): string {
  if (!fact?.kind) return "";
  const bits = [fact.kind];
  if (fact.selfInflicted) bits.push("own");
  if (fact.motif) bits.push(fact.motif);
  if (fact.pieceLabel) bits.push(fact.pieceLabel);
  if (fact.trapSquare) bits.push(fact.trapSquare);
  if (fact.captureSan) bits.push(fact.captureSan);
  if (fact.mateIn != null) bits.push(`m${fact.mateIn}`);
  return bits.join(":");
}

/** Moment / request input stamps. */
export function tacticalFactInputs(
  fact: TacticalFact | null | undefined
): Record<string, string | number | boolean | null> {
  if (!fact?.kind) return {};
  return {
    tactical_kind: fact.kind,
    tactical_motif: fact.motif || null,
    tactical_line: fact.captureSan,
    tactical_piece: fact.pieceLabel,
    tactical_mate_in: fact.mateIn,
    tactical_taken_next: fact.takenNext ? 1 : 0,
    tactical_trap_square: fact.trapSquare ?? null,
    tactical_capture_ply_delay: fact.capturePlyDelay ?? null,
    tactical_material_delta: fact.finalMaterialDelta ?? null,
    tactical_self_inflicted: fact.selfInflicted ? 1 : null,
    tactical_head: formatTacticalFactHead(fact),
  };
}

/** Weight boost when ranking soft keys for an active tactical fact. */
export function tacticalLockBoostForKey(
  keyId: string,
  fact: TacticalFact | null | undefined
): number {
  const keys = softKeysForTacticalFact(fact);
  if (!keys.length) return 0;
  const idx = keys.indexOf(keyId);
  if (idx < 0) return 0;
  return Math.max(8, 26 - idx * 4);
}

