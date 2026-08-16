/**
 * Pure coach metric → theme/moment mapping (no React Native / vault I/O).
 * Shared by Games analyze and scripts/annotate_metrics_pgn.ts.
 */

import type { EndgameGameRow } from "../endgamePhase";
import type { MiddlegameEvalBucket, MiddlegameGameRow } from "../middlegamePhase";
import type { OpeningGameRow } from "../openingPhase";
import type { EndgameEvalBucket, StyleGameRow } from "../styleMetrics";
import {
  classifyEvalDrop,
  userWinProbability,
  type EvalDropKind,
} from "../winProb";
import { formatOpeningLabel } from "./ecoLabels";
import { toPhaseMetricKeys } from "./metricThemes";
import { mergeOpeningCoachInputs } from "./openingCoachInputs";

export type CoachMetricMoment = {
  /** 1-based ply index (matches GameCoachPly.ply); 0 unused. */
  ply: number;
  moveNumber: number;
  /** Eval-drop band, or `missed` when failing to punish an opp mistake/blunder. Null on opp-gift reply (gift lives in inputs). */
  severity: EvalDropKind | "missed" | null;
  dropCp: number;
  playedSan: string;
  bestSan: string | null;
  /** Position before the played move (same as MistakeItem.fen). */
  fen: string;
  evalBeforeCp?: number;
  evalAfterCp?: number;
  source: "vault_candidate" | "vault_eval" | "live" | "structural";
  /** Opening vs mistake candidate (vault); null for eval/live/structural. */
  candidateKind?: "opening" | "mistake" | null;
  structuralKind?:
    | "opening_name"
    | "opening_aggregate"
    | "middlegame_aggregate"
    | "endgame_advantage"
    | "decisive_pawn_break"
    | "opponent_mistake"
    | null;
  /** Aggregated metric inputs for structural coach notes. */
  inputs?: Record<string, string | number | boolean | null>;
};

export type CoachGameMetrics = {
  available: boolean;
  themesByPhase: {
    opening: string[];
    middlegame: string[];
    endgame: string[];
  };
  globalThemes: string[];
  momentsByPly: Record<number, CoachMetricMoment>;
  strengths: string[];
  weaknesses: string[];
  /** 0-based ply bounds from heuristics (for live structural gates). */
  phaseBounds?: {
    middlegameStartPly0: number | null;
    endgameStartPly0: number | null;
  };
};

/** Minimal candidate shape (MistakeItem subset) for moment recovery. */
export type CoachCandidateItem = {
  ply: number;
  move_number?: number;
  fen?: string;
  played_san?: string;
  best_san?: string | null;
  eval_before_cp?: number;
  eval_after_cp?: number;
  eval_drop_cp: number;
};

/** Eval-vault / annotate-script record subset used for theme + moment build. */
export type CoachEvalRecord = {
  evalsWhiteCp?: number[];
  mistakeCandidates?: CoachCandidateItem[];
  openingCandidates?: CoachCandidateItem[];
  opening_accuracy_pct?: number | null;
  opening_accuracy_moves?: number;
  middlegameEval?: MiddlegameEvalBucket | null;
  endgameEval?: EndgameEvalBucket | null;
  style?: StyleGameRow | null;
};

export type CoachHeuristicEntry = {
  opening: OpeningGameRow;
  middlegame: MiddlegameGameRow;
  endgame: EndgameGameRow;
};

function uniq(themes: string[]): string[] {
  return [...new Set(themes.filter(Boolean))];
}

function severityFromDropCp(dropCp: number): EvalDropKind {
  if (dropCp >= 300) return "blunder";
  if (dropCp >= 150) return "mistake";
  return null;
}

function momentFromCandidate(
  item: CoachCandidateItem,
  source: CoachMetricMoment["source"],
  candidateKind: CoachMetricMoment["candidateKind"]
): CoachMetricMoment | null {
  const severity =
    severityFromDropCp(item.eval_drop_cp) ||
    (item.eval_drop_cp >= 100 ? "mistake" : null);
  if (!severity) return null;
  return {
    ply: item.ply + 1,
    moveNumber: item.move_number ?? Math.floor(item.ply / 2) + 1,
    severity,
    dropCp: item.eval_drop_cp,
    playedSan: item.played_san || "",
    bestSan: item.best_san ?? null,
    fen: item.fen || "",
    evalBeforeCp: item.eval_before_cp,
    evalAfterCp: item.eval_after_cp,
    source,
    candidateKind: candidateKind ?? null,
  };
}

/**
 * Recover turning points from vault eval series when candidate lists are thin.
 * evalsWhiteCp[0] = start; evalsWhiteCp[i+1] = after ply i (0-based).
 */
function momentsFromEvals(
  evalsWhiteCp: number[],
  userIsWhite: boolean
): CoachMetricMoment[] {
  const out: CoachMetricMoment[] = [];
  if (evalsWhiteCp.length < 2) return out;
  for (let i = 0; i < evalsWhiteCp.length - 1; i += 1) {
    const before = evalsWhiteCp[i];
    const after = evalsWhiteCp[i + 1];
    const wpBefore = userWinProbability(before, userIsWhite);
    const wpAfter = userWinProbability(after, userIsWhite);
    const kind = classifyEvalDrop(wpBefore, wpAfter);
    if (!kind || kind === "inaccuracy") continue;
    const userBefore = userIsWhite ? before : -before;
    const userAfter = userIsWhite ? after : -after;
    out.push({
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      severity: kind,
      dropCp: Math.max(0, Math.round(userBefore - userAfter)),
      playedSan: "",
      bestSan: null,
      fen: "",
      evalBeforeCp: before,
      evalAfterCp: after,
      source: "vault_eval",
    });
  }
  return out
    .sort((a, b) => b.dropCp - a.dropCp)
    .slice(0, 8);
}

export function enrichMomentsWithPlies(
  momentsByPly: Record<number, CoachMetricMoment>,
  plies: Array<{ ply: number; fenBefore: string; san: string }>
): void {
  for (const p of plies) {
    const m = momentsByPly[p.ply];
    if (!m) continue;
    if (!m.fen && p.fenBefore) m.fen = p.fenBefore;
    if (!m.playedSan && p.san) m.playedSan = p.san;
  }
}

function isUserCriticalSeverity(
  severity: CoachMetricMoment["severity"] | null | undefined
): boolean {
  return (
    severity === "blunder" ||
    severity === "mistake" ||
    severity === "missed"
  );
}

export function upsertLiveMoment(
  momentsByPly: Record<number, CoachMetricMoment>,
  moment: CoachMetricMoment
): CoachMetricMoment {
  const prev = momentsByPly[moment.ply];
  // Opp-gift placeholders land on the next user ply with high dropCp +
  // severity mistake/blunder. User critical (incl. missed) must still win.
  const criticalOverOppGift =
    Boolean(prev) &&
    prev!.structuralKind === "opponent_mistake" &&
    !prev!.inputs?.critical_mark &&
    (Boolean(moment.inputs?.critical_mark) ||
      isUserCriticalSeverity(moment.severity));
  // Best/quiet reply after opp gift: clear inherited gift severity even when
  // dropCp shrinks (inject used gift dropCp; reply coach is not a user error).
  const clearOppGiftSeverity =
    Boolean(prev) &&
    prev!.structuralKind === "opponent_mistake" &&
    !prev!.inputs?.critical_mark &&
    (prev!.severity === "mistake" || prev!.severity === "blunder") &&
    moment.severity === null &&
    !moment.inputs?.critical_mark;
  if (
    !prev ||
    moment.dropCp >= prev.dropCp ||
    criticalOverOppGift ||
    clearOppGiftSeverity
  ) {
    const hasStructuralKey = Object.prototype.hasOwnProperty.call(
      moment,
      "structuralKind"
    );
    const merged: CoachMetricMoment = {
      ...prev,
      ...moment,
      fen: moment.fen || prev?.fen || "",
      playedSan: moment.playedSan || prev?.playedSan || "",
      bestSan: moment.bestSan ?? prev?.bestSan ?? null,
      dropCp: criticalOverOppGift
        ? Math.max(moment.dropCp, prev?.dropCp || 0)
        : clearOppGiftSeverity
          ? Math.min(moment.dropCp || 40, 40)
          : moment.dropCp,
      source: prev?.source === "vault_candidate" ? prev.source : moment.source,
      // Explicit null clears; omitted key keeps previous (e.g. opponent_mistake).
      structuralKind: hasStructuralKey
        ? moment.structuralKind || undefined
        : prev?.structuralKind,
    };
    if (hasStructuralKey && !moment.structuralKind) {
      delete merged.structuralKind;
    }
    momentsByPly[moment.ply] = merged;
    return merged;
  }
  if (!prev.fen && moment.fen) prev.fen = moment.fen;
  if (!prev.playedSan && moment.playedSan) prev.playedSan = moment.playedSan;
  if (!prev.bestSan && moment.bestSan) prev.bestSan = moment.bestSan;
  if (
    moment.structuralKind &&
    !prev.structuralKind &&
    moment.structuralKind === "decisive_pawn_break"
  ) {
    prev.structuralKind = moment.structuralKind;
    prev.inputs = { ...moment.inputs, ...prev.inputs };
    prev.source = prev.source || moment.source;
  }
  return prev;
}

export function isCriticalCoachMoment(
  moment: CoachMetricMoment | null | undefined
): boolean {
  if (!moment?.severity) return false;
  return (
    moment.severity === "blunder" ||
    moment.severity === "mistake" ||
    moment.severity === "missed"
  );
}

function themesFromOpening(row: OpeningGameRow | null | undefined): {
  themes: string[];
  strengths: string[];
  weaknesses: string[];
} {
  if (!row) return { themes: [], strengths: [], weaknesses: [] };
  const themes: string[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (row.opening_accuracy_pct != null && row.opening_accuracy_pct >= 85) {
    strengths.push("Clean opening accuracy — development and centre ideas held.");
  } else if (row.opening_accuracy_pct != null && row.opening_accuracy_pct < 70) {
    themes.push("development", "centre");
    weaknesses.push("Opening accuracy dipped — development and centre fights need review.");
  }

  if (
    row.opening_minors_developed_by_10 != null &&
    row.opening_minors_developed_by_10 < 3
  ) {
    themes.push("development");
    weaknesses.push("Minors lagged behind the clock of development.");
  } else if (
    row.opening_minors_developed_by_10 != null &&
    row.opening_minors_developed_by_10 >= 4
  ) {
    strengths.push("Minors came out on time.");
  }

  if (row.uncastled || (row.opening_castle_fullmove != null && row.opening_castle_fullmove >= 14)) {
    themes.push("king_safety", "development");
    weaknesses.push("King stayed central too long.");
  }

  if (
    row.opening_tempo_waste_rate_pct != null &&
    row.opening_tempo_waste_rate_pct >= 25
  ) {
    themes.push("development", "initiative");
    weaknesses.push("Tempo wastes in the opening invited pressure.");
  }

  if (
    row.opening_center_control_pct != null &&
    row.opening_center_control_pct < 40
  ) {
    themes.push("centre", "pawn_breaks");
    weaknesses.push("Centre control stayed soft.");
  } else if (
    row.opening_center_control_pct != null &&
    row.opening_center_control_pct >= 60
  ) {
    strengths.push("Centre was contested well.");
  }

  if (row.opening_pawn_moves >= 5) {
    themes.push("pawn_breaks", "development");
  }

  return { themes: uniq(themes), strengths, weaknesses };
}

function themesFromMiddlegame(
  row: MiddlegameGameRow | null | undefined,
  evalBucket: MiddlegameEvalBucket | null | undefined
): {
  themes: string[];
  strengths: string[];
  weaknesses: string[];
} {
  if (!row?.reached_middlegame && !evalBucket) {
    return { themes: [], strengths: [], weaknesses: [] };
  }
  const themes: string[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const blunders =
    (row?.middlegame_blunders ?? 0) + (evalBucket?.blunders ?? 0);
  const mistakes =
    (row?.middlegame_mistakes ?? 0) + (evalBucket?.mistakes ?? 0);
  const inaccuracies =
    (row?.middlegame_inaccuracies ?? 0) + (evalBucket?.inaccuracies ?? 0);

  if (blunders >= 1) {
    themes.push("initiative", "prophylaxis", "king_safety");
    weaknesses.push("A middlegame blunder swung the evaluation.");
  }
  if (mistakes >= 2) {
    themes.push("piece_activity", "exchanges");
    weaknesses.push("Repeated middlegame mistakes suggest plan or calculation gaps.");
  } else if (mistakes === 0 && inaccuracies <= 1 && (row?.middlegame_accuracy_pct ?? 0) >= 85) {
    strengths.push("Middlegame accuracy stayed high.");
  }

  if (row?.had_iqp) themes.push("iqp");
  if (row?.had_doubled_pawns) themes.push("doubled_pawns", "pawn_chain");
  if (row?.had_backward_pawns) {
    themes.push("pawn_breaks", "pawn_chain");
  }
  if (
    row?.middlegame_pawn_shield_pct != null &&
    row.middlegame_pawn_shield_pct < 45
  ) {
    themes.push("king_safety");
  }
  if (
    row?.middlegame_open_file_proximity_pct != null &&
    row.middlegame_open_file_proximity_pct >= 55
  ) {
    themes.push("open_file", "king_safety");
  }
  if (
    row?.middlegame_space_advantage_pct != null &&
    row.middlegame_space_advantage_pct < 40
  ) {
    themes.push("space", "pawn_breaks");
  } else if (
    row?.middlegame_space_advantage_pct != null &&
    row.middlegame_space_advantage_pct >= 60
  ) {
    themes.push("space");
    strengths.push("Space advantage was real — keep restraining counterplay.");
  }
  if (
    row?.middlegame_missed_tactic_pct != null &&
    row.middlegame_missed_tactic_pct >= 30
  ) {
    themes.push("initiative", "tactics", "sacrifice");
    weaknesses.push("Tactical chances were left on the table.");
  }
  if (
    row?.middlegame_allowed_tactic_pct != null &&
    row.middlegame_allowed_tactic_pct >= 30
  ) {
    themes.push("prophylaxis", "king_safety", "tactics");
    weaknesses.push("Opponent tactics were allowed too often.");
  }
  if (
    row?.middlegame_outpost_control != null &&
    row.middlegame_outpost_control >= 1
  ) {
    themes.push("piece_activity", "outpost");
    strengths.push("Outpost control showed up.");
  }
  if ((row?.middlegame_pawn_breaks ?? 0) >= 1) {
    themes.push("pawn_breaks", "space");
  }
  if ((row?.middlegame_checks ?? 0) >= 1) {
    themes.push("tactics", "initiative");
  }
  if ((row?.middlegame_unblocking_bishop_light ?? 0) >= 4) {
    themes.push("piece_activity", "bishop_pair", "color_complexes");
    strengths.push("Light-square bishop found open diagonals.");
  }
  if ((row?.middlegame_unblocking_bishop_dark ?? 0) >= 4) {
    themes.push("piece_activity", "bishop_pair", "color_complexes");
    strengths.push("Dark-square bishop found open diagonals.");
  }
  if ((row?.middlegame_king_attackers_rises ?? 0) >= 2) {
    themes.push("king_safety", "initiative");
  }
  if ((row?.middlegame_opp_king_attackers_rises ?? 0) >= 2) {
    themes.push("king_safety", "initiative", "attack");
  }
  if ((row?.middlegame_seventh_rank_infiltration ?? 0) >= 1) {
    themes.push("seventh_rank", "piece_activity");
    strengths.push("Heavy pieces reached the seventh.");
  }
  if ((row?.middlegame_open_file_utilization ?? 0) >= 1) {
    themes.push("open_file", "piece_activity", "space");
    strengths.push("Heavy pieces used an open or semi-open file.");
  }

  return { themes: uniq(themes), strengths, weaknesses };
}

function themesFromEndgame(
  row: EndgameGameRow | null | undefined,
  evalBucket: EndgameEvalBucket | null | undefined,
  style: StyleGameRow | null | undefined
): {
  themes: string[];
  strengths: string[];
  weaknesses: string[];
} {
  if (!row?.reached_endgame && !evalBucket && !style?.had_endgame_advantage) {
    return { themes: [], strengths: [], weaknesses: [] };
  }
  const themes: string[] = ["endgame_technique"];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const blunders = (row?.blunders ?? 0) + (evalBucket?.blunders ?? 0);
  if (blunders >= 1) {
    themes.push("exchanges", "passed_pawn");
    weaknesses.push("Endgame technique wobbled at a decisive moment.");
  }

  if (style?.had_endgame_advantage && style.converted_endgame) {
    strengths.push("Endgame advantage was converted.");
  } else if (style?.had_endgame_advantage && !style.converted_endgame) {
    themes.push("exchanges", "passed_pawn");
    weaknesses.push("A winning endgame slipped away.");
  }

  if (
    row &&
    row.piece_trades > 0 &&
    row.beneficial_trades / row.piece_trades < 0.35
  ) {
    themes.push("exchanges");
  }

  if (row?.king_centralization != null && row.king_centralization < 0.35) {
    themes.push("endgame_technique");
    weaknesses.push("King activity stayed low in the ending.");
  } else if (row?.king_centralization != null && row.king_centralization >= 0.6) {
    strengths.push("King activation in the ending was good.");
  }

  if (row?.accidental_stalemate) {
    weaknesses.push("Stalemate patterns need a final-check habit.");
  }
  if ((row?.endgame_seventh_rank_infiltration ?? 0) >= 1) {
    themes.push("seventh_rank", "piece_activity");
    strengths.push("Heavy pieces reached the seventh.");
  }
  if ((row?.endgame_open_file_utilization ?? 0) >= 1) {
    themes.push("open_file", "piece_activity");
    strengths.push("Heavy pieces used an open or semi-open file.");
  }
  if ((row?.endgame_opposition ?? 0) >= 1) {
    themes.push("active_king", "opposition", "pawn_break");
  }

  const te = row?.theoretical;
  if (te) {
    if (te.te_rook_pawn_vs_rook) {
      themes.push("lucena", "philidor", "vancura");
    }
    if (te.te_opp_bishop_two_pawns) {
      themes.push("opposite_bishops");
    }
    if (te.te_pawn_endings) {
      themes.push("active_king", "pawn_break");
    }
    if (te.te_queen_vs_pawn || te.te_rook_vs_pawn) {
      themes.push("fortress", "active_king");
    }
    if (
      te.te_bishop_pawn_vs_knight ||
      te.te_knight_pawn_vs_bishop ||
      te.te_pawn_vs_knight
    ) {
      themes.push("opposite_bishops", "active_king");
    }
  }

  return { themes: uniq(themes), strengths, weaknesses };
}

function themesFromStyle(style: StyleGameRow | null | undefined): {
  themes: string[];
  strengths: string[];
  weaknesses: string[];
} {
  if (!style) return { themes: [], strengths: [], weaknesses: [] };
  const themes: string[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (style.had_sacrifice) themes.push("initiative", "sacrifice");
  if (style.had_early_flank) themes.push("pawn_breaks", "centre");
  if (style.recovered_from_disadvantage) {
    strengths.push("Recovered from a tough position — resilience showed.");
  }
  if (style.blunders >= 2 || style.blunder_rate_pct >= 8) {
    themes.push("prophylaxis", "initiative", "tactics");
    weaknesses.push("Blunder rate was high for this game.");
  }
  if (style.trades_near_user_king >= 2) {
    themes.push("king_safety");
  }
  if (style.forward_moves > style.backward_moves * 1.4) {
    themes.push("piece_activity", "initiative");
    strengths.push("Pieces kept moving forward.");
  }
  if (style.declined_recaptures >= 2) {
    themes.push("prophylaxis", "simplification");
  }

  return { themes: uniq(themes), strengths, weaknesses };
}

function buildMoments(
  _record: CoachEvalRecord | null,
  _userIsWhite: boolean
): Record<number, CoachMetricMoment> {
  // Coach moments are only the defined structural checkpoints + live
  // praise / decisive_pawn_break (injected later). Opp gifts never become moments.
  // Vault candidates and eval-drop moments are not coach moments.
  return {};
}

function ply1ForUserFullmove(fullMove: number, userIsWhite: boolean): number {
  return userIsWhite ? fullMove * 2 - 1 : fullMove * 2;
}

/** Snap any 1-based ply onto a user ply (for note attach). Prefer forward. */
function snapToUserPly1(ply1: number, userIsWhite: boolean): number {
  const userParity = userIsWhite ? 1 : 0; // white moves odd, black even
  if (ply1 < 1) return userIsWhite ? 1 : 2;
  if (ply1 % 2 === userParity) return ply1;
  // Opponent ply — attach on the NEXT user ply (not the previous one).
  return ply1 + 1;
}

function putStructuralMoment(
  byPly: Record<number, CoachMetricMoment>,
  moment: CoachMetricMoment,
  maxPly1: number
): void {
  if (moment.ply < 1) return;
  // Only clip when we know game length; never drop @5/@10 for short eval series.
  if (maxPly1 > 0 && maxPly1 < 9990 && moment.ply > maxPly1) return;
  const prev = byPly[moment.ply];
  if (prev?.structuralKind && prev.structuralKind === moment.structuralKind) {
    byPly[moment.ply] = { ...prev, ...moment, inputs: { ...prev.inputs, ...moment.inputs } };
    return;
  }
  if (prev && prev.source !== "structural" && prev.dropCp >= 80) {
    // Keep bad-move moment; stash structural on same ply via inputs merge.
    byPly[moment.ply] = {
      ...prev,
      structuralKind: moment.structuralKind,
      inputs: { ...moment.inputs, ...prev.inputs },
      source: prev.source,
    };
    return;
  }
  byPly[moment.ply] = moment;
}

/**
 * Structural coach checkpoints (always try to attach a note):
 * - move 5: opening ECO + name
 * - move 10: opening aggregates (development, pawns, castle, accuracy)
 * - endgame_start_ply: middlegame aggregates
 * - endgame_advantage_start_ply: engine eval / WP at conversion start
 */
export function injectStructuralCoachMoments(args: {
  momentsByPly: Record<number, CoachMetricMoment>;
  heuristics: CoachHeuristicEntry | null;
  record: CoachEvalRecord | null;
  userIsWhite: boolean;
  /** Optional 1-based last ply of the game (skeleton length). */
  maxPly1?: number;
}): void {
  const opening = args.heuristics?.opening;
  const mg = args.heuristics?.middlegame;
  const mgEval = args.record?.middlegameEval;
  const style = args.record?.style;
  const evals = args.record?.evalsWhiteCp || [];
  // Prefer skeleton length when known; eval series alone can truncate @10.
  const maxPly1 =
    args.maxPly1 != null
      ? args.maxPly1
      : evals.length > 20
        ? evals.length - 1
        : 9999;

  putStructuralMoment(
    args.momentsByPly,
    {
      ply: ply1ForUserFullmove(5, args.userIsWhite),
      moveNumber: 5,
      severity: null,
      dropCp: 0,
      playedSan: "",
      bestSan: null,
      fen: "",
      source: "structural",
      structuralKind: "opening_name",
      inputs: mergeOpeningCoachInputs(
        {
          opening_name:
            formatOpeningLabel(
              opening?.opening_eco,
              opening?.opening_name
            ) ||
            opening?.opening_name ||
            null,
        },
        opening || null,
        {
          userColor: args.userIsWhite ? "white" : "black",
          badAccuracyMoves: (args.record?.openingCandidates || []).length,
        }
      ),
    },
    9999
  );

  const openBad = (args.record?.openingCandidates || []).length;
  putStructuralMoment(
    args.momentsByPly,
    {
      ply: ply1ForUserFullmove(10, args.userIsWhite),
      moveNumber: 10,
      severity: null,
      dropCp: 0,
      playedSan: "",
      bestSan: null,
      fen: "",
      source: "structural",
      structuralKind: "opening_aggregate",
      inputs: mergeOpeningCoachInputs(
        {
          opening_name:
            formatOpeningLabel(
              opening?.opening_eco,
              opening?.opening_name
            ) ||
            opening?.opening_name ||
            null,
        },
        opening || null,
        {
          userColor: args.userIsWhite ? "white" : "black",
          badAccuracyMoves: openBad,
        }
      ),
    },
    9999
  );

  const egStart0 = args.heuristics?.endgame?.endgame_start_ply;
  if (egStart0 != null) {
    putStructuralMoment(
      args.momentsByPly,
      {
        ply: snapToUserPly1(egStart0 + 1, args.userIsWhite),
        moveNumber: Math.floor(egStart0 / 2) + 1,
        severity: null,
        dropCp: 0,
        playedSan: "",
        bestSan: null,
        fen: "",
        source: "structural",
        structuralKind: "middlegame_aggregate",
        inputs: {
          space_advantage_pct: mg?.middlegame_space_advantage_pct ?? null,
          king_attackers_score: mg?.middlegame_king_attackers_score ?? null,
          pawn_shield_pct: mg?.middlegame_pawn_shield_pct ?? null,
          blunders: mgEval?.blunders ?? mg?.middlegame_blunders ?? null,
          mistakes: mgEval?.mistakes ?? mg?.middlegame_mistakes ?? null,
          inaccuracies:
            mgEval?.inaccuracies ?? mg?.middlegame_inaccuracies ?? null,
          accuracy_pct:
            mgEval?.accuracy_pct ?? mg?.middlegame_accuracy_pct ?? null,
          brilliant_moves: style?.brilliant_moves ?? null,
          excellent_moves: style?.excellent_moves ?? null,
          important_moves: style?.important_moves ?? null,
        },
      },
      maxPly1
    );
  }

  const egAdv0 = style?.endgame_advantage_start_ply;
  if (egAdv0 != null) {
    const cpAfter = evals[egAdv0 + 1] ?? evals[egAdv0] ?? null;
    const wp =
      cpAfter != null
        ? Math.round(userWinProbability(cpAfter, args.userIsWhite) * 1000) / 1000
        : null;
    putStructuralMoment(
      args.momentsByPly,
      {
        ply: snapToUserPly1(egAdv0 + 1, args.userIsWhite),
        moveNumber: Math.floor(egAdv0 / 2) + 1,
        severity: null,
        dropCp: 0,
        playedSan: "",
        bestSan: null,
        fen: "",
        source: "structural",
        structuralKind: "endgame_advantage",
        inputs: {
          endgame_advantage_start_ply: egAdv0 + 1,
          best_line_eval_cp: cpAfter,
          best_line_wp: wp,
          had_endgame_advantage: style?.had_endgame_advantage ?? false,
          converted_endgame: style?.converted_endgame ?? false,
        },
      },
      maxPly1
    );
  }
}

/**
 * Map vault heuristics + eval buckets → phase themes, strengths/weaknesses, moments.
 * Theme rules (current): phase themes = soft-key metric ids
 * (see metricThemes.ts PHASE_METRIC_KEYS / THEME_TO_METRIC_KEY).
 * - Opening: accuracy, minors@10, castle/uncastled, tempo waste, centre, pawn moves
 * - Middlegame: blunder/mistake counts, IQP/doubled/backward, shield/open-file/space,
 *   missed/allowed tactics, outposts, seventh-rank / open-file utilization (R+Q)
 * - Endgame: blunders, conversion, trades, king activity, theoretical fingerprints,
 *   seventh-rank / open-file utilization (R+Q), opposition
 * - Style: sacrifice, early flank, recovery, blunder rate, king-side trades, forward bias,
 *   declined recaptures
 * - Candidates: mistake density → tactics/prophylaxis/initiative; opening dens → development/centre
 */
export function buildCoachGameMetrics(args: {
  record: CoachEvalRecord | null;
  heuristics: CoachHeuristicEntry | null;
  userColor?: string | null;
}): CoachGameMetrics {
  const userIsWhite =
    String(args.userColor || "white").toLowerCase() !== "black";
  const opening = themesFromOpening(
    args.heuristics?.opening ||
      (args.record
        ? {
            opening_accuracy_pct: args.record.opening_accuracy_pct ?? null,
            opening_minors_developed_by_10: null,
            opening_center_control_pct: null,
            opening_castle_fullmove: null,
            uncastled: false,
            opening_tempo_waste_rate_pct: null,
            opening_pawn_moves: 0,
            accuracy_moves: args.record.opening_accuracy_moves ?? 0,
            phase_end_fullmove: 11,
          }
        : null)
  );
  const middlegame = themesFromMiddlegame(
    args.heuristics?.middlegame,
    args.record?.middlegameEval
  );
  const endgame = themesFromEndgame(
    args.heuristics?.endgame,
    args.record?.endgameEval,
    args.record?.style
  );
  const style = themesFromStyle(args.record?.style);

  const openingCandN = args.record?.openingCandidates?.length ?? 0;
  const mistakeCandN = args.record?.mistakeCandidates?.length ?? 0;
  const candidateThemes: string[] = [];
  if (mistakeCandN >= 1) candidateThemes.push("tactics", "prophylaxis");
  if (mistakeCandN >= 2) candidateThemes.push("initiative");
  if (openingCandN >= 1) candidateThemes.push("development", "centre");

  const momentsByPly = buildMoments(args.record, userIsWhite);
  injectStructuralCoachMoments({
    momentsByPly,
    heuristics: args.heuristics,
    record: args.record,
    userIsWhite,
  });

  const available = Boolean(args.record || args.heuristics);
  const mgStart0 = args.heuristics?.middlegame?.middlegame_start_ply ?? null;
  const egStart0 = args.heuristics?.endgame?.endgame_start_ply ?? null;
  return {
    available,
    themesByPhase: {
      opening: toPhaseMetricKeys("opening", [
        ...opening.themes,
        ...style.themes,
        ...candidateThemes,
      ]),
      middlegame: toPhaseMetricKeys("middlegame", [
        ...middlegame.themes,
        ...style.themes,
        ...candidateThemes,
      ]),
      endgame: toPhaseMetricKeys("endgame", [
        ...endgame.themes,
        ...style.themes,
      ]),
    },
    globalThemes: uniq([
      ...toPhaseMetricKeys("opening", [
        ...opening.themes,
        ...style.themes,
        ...candidateThemes,
      ]),
      ...toPhaseMetricKeys("middlegame", [
        ...middlegame.themes,
        ...style.themes,
        ...candidateThemes,
      ]),
      ...toPhaseMetricKeys("endgame", [...endgame.themes, ...style.themes]),
    ]),
    momentsByPly,
    strengths: uniq([
      ...opening.strengths,
      ...middlegame.strengths,
      ...endgame.strengths,
      ...style.strengths,
    ]),
    weaknesses: uniq([
      ...opening.weaknesses,
      ...middlegame.weaknesses,
      ...endgame.weaknesses,
      ...style.weaknesses,
    ]),
    phaseBounds: {
      middlegameStartPly0: mgStart0,
      endgameStartPly0: egStart0,
    },
  };
}

/**
 * Ensure opening@5 / opening@10 exist when game is long enough.
 */
export function ensureFixedOpeningMoments(
  momentsByPly: Record<number, CoachMetricMoment>,
  userIsWhite: boolean,
  maxPly1: number,
  opening?: { eco?: string | null; opening?: string | null }
): void {
  const hasKind = (kind: NonNullable<CoachMetricMoment["structuralKind"]>) =>
    Object.values(momentsByPly).some((m) => m.structuralKind === kind);

  const openingName =
    formatOpeningLabel(opening?.eco, opening?.opening) ||
    opening?.opening ||
    null;

  const namePly = ply1ForUserFullmove(5, userIsWhite);
  if (namePly <= maxPly1 && !hasKind("opening_name")) {
    putStructuralMoment(
      momentsByPly,
      {
        ply: namePly,
        moveNumber: 5,
        severity: null,
        dropCp: 0,
        playedSan: "",
        bestSan: null,
        fen: "",
        source: "structural",
        structuralKind: "opening_name",
        inputs: {
          opening_name: openingName,
        },
      },
      9999
    );
  }

  const aggPly = ply1ForUserFullmove(10, userIsWhite);
  if (aggPly <= maxPly1 && !hasKind("opening_aggregate")) {
    putStructuralMoment(
      momentsByPly,
      {
        ply: aggPly,
        moveNumber: 10,
        severity: null,
        dropCp: 0,
        playedSan: "",
        bestSan: null,
        fen: "",
        source: "structural",
        structuralKind: "opening_aggregate",
        inputs: {
          opening_name: openingName,
        },
      },
      9999
    );
  }
}

export function emptyCoachGameMetrics(): CoachGameMetrics {
  return {
    available: false,
    themesByPhase: { opening: [], middlegame: [], endgame: [] },
    globalThemes: [],
    momentsByPly: {},
    strengths: [],
    weaknesses: [],
    phaseBounds: { middlegameStartPly0: null, endgameStartPly0: null },
  };
}
