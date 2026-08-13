import type { Platform } from "../../api/types";
import type { MistakeItem } from "../../api/client";
import { readCache, PERMANENT_CACHE_TTL_MS } from "../../storage/cache";
import { studyHeuristicsStoreCacheKey } from "../../storage/studyCacheKeys";
import {
  loadPermanentEvalStore,
  type GlobalGameRecord,
} from "../globalAnalysis";
import type { OpeningGameRow } from "../openingPhase";
import type { MiddlegameGameRow } from "../middlegamePhase";
import type { EndgameGameRow } from "../endgamePhase";
import type { StyleGameRow } from "../styleMetrics";
import {
  classifyEvalDrop,
  userWinProbability,
  type EvalDropKind,
} from "../winProb";

export type CoachMetricMoment = {
  /** 1-based ply index (matches GameCoachPly.ply) */
  ply: number;
  moveNumber: number;
  severity: EvalDropKind;
  dropCp: number;
  playedSan: string;
  bestSan: string | null;
  source: "vault_candidate" | "vault_eval";
};

export type CoachGameMetrics = {
  available: boolean;
  /** Phase-scoped theme boosts from already-scanned metrics */
  themesByPhase: {
    opening: string[];
    middlegame: string[];
    endgame: string[];
  };
  /** Themes that apply across the whole game */
  globalThemes: string[];
  /** Exact turning points keyed by 1-based ply */
  momentsByPly: Record<number, CoachMetricMoment>;
  strengths: string[];
  weaknesses: string[];
};

type HeuristicEntry = {
  opening: OpeningGameRow;
  middlegame: MiddlegameGameRow;
  endgame: EndgameGameRow;
};

type HeuristicStore = {
  games: Record<string, HeuristicEntry>;
};

function uniq(themes: string[]): string[] {
  return [...new Set(themes.filter(Boolean))];
}

function severityFromDropCp(dropCp: number): EvalDropKind {
  if (dropCp >= 300) return "blunder";
  if (dropCp >= 150) return "mistake";
  if (dropCp >= 80) return "inaccuracy";
  return null;
}

function momentFromCandidate(
  item: MistakeItem,
  source: CoachMetricMoment["source"]
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
    playedSan: item.played_san,
    bestSan: item.best_san,
    source,
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
    if (!kind) continue;
    const userBefore = userIsWhite ? before : -before;
    const userAfter = userIsWhite ? after : -after;
    out.push({
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      severity: kind,
      dropCp: Math.max(0, Math.round(userBefore - userAfter)),
      playedSan: "",
      bestSan: null,
      source: "vault_eval",
    });
  }
  return out
    .sort((a, b) => b.dropCp - a.dropCp)
    .slice(0, 6);
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
  evalBucket: GlobalGameRecord["middlegameEval"]
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
  if (row?.had_doubled_pawns || row?.had_backward_pawns) {
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
    themes.push("initiative");
    weaknesses.push("Tactical chances were left on the table.");
  }
  if (
    row?.middlegame_allowed_tactic_pct != null &&
    row.middlegame_allowed_tactic_pct >= 30
  ) {
    themes.push("prophylaxis", "king_safety");
    weaknesses.push("Opponent tactics were allowed too often.");
  }
  if (
    row?.middlegame_outpost_control != null &&
    row.middlegame_outpost_control >= 1
  ) {
    themes.push("piece_activity");
    strengths.push("Outpost control showed up.");
  }

  return { themes: uniq(themes), strengths, weaknesses };
}

function themesFromEndgame(
  row: EndgameGameRow | null | undefined,
  evalBucket: GlobalGameRecord["endgameEval"],
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

  if (style.had_sacrifice) themes.push("initiative");
  if (style.had_early_flank) themes.push("pawn_breaks", "centre");
  if (style.recovered_from_disadvantage) {
    strengths.push("Recovered from a tough position — resilience showed.");
  }
  if (style.blunders >= 2 || style.blunder_rate_pct >= 8) {
    themes.push("prophylaxis", "initiative");
    weaknesses.push("Blunder rate was high for this game.");
  }
  if (style.trades_near_user_king >= 2) {
    themes.push("king_safety");
  }
  if (style.forward_moves > style.backward_moves * 1.4) {
    themes.push("piece_activity", "initiative");
    strengths.push("Pieces kept moving forward.");
  }

  return { themes: uniq(themes), strengths, weaknesses };
}

function buildMoments(
  record: GlobalGameRecord | null,
  userIsWhite: boolean
): Record<number, CoachMetricMoment> {
  const byPly: Record<number, CoachMetricMoment> = {};
  if (!record) return byPly;

  const fromCandidates = [
    ...(record.openingCandidates || []),
    ...(record.mistakeCandidates || []),
  ]
    .map((item) => momentFromCandidate(item, "vault_candidate"))
    .filter((m): m is CoachMetricMoment => Boolean(m));

  for (const m of fromCandidates) {
    const prev = byPly[m.ply];
    if (!prev || m.dropCp > prev.dropCp) byPly[m.ply] = m;
  }

  if (Object.keys(byPly).length < 2 && record.evalsWhiteCp?.length) {
    for (const m of momentsFromEvals(record.evalsWhiteCp, userIsWhite)) {
      if (!byPly[m.ply]) byPly[m.ply] = m;
    }
  }

  return byPly;
}

export function buildCoachGameMetrics(args: {
  record: GlobalGameRecord | null;
  heuristics: HeuristicEntry | null;
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

  const available = Boolean(args.record || args.heuristics);
  return {
    available,
    themesByPhase: {
      opening: uniq([...opening.themes, ...style.themes]),
      middlegame: uniq([...middlegame.themes, ...style.themes]),
      endgame: uniq([...endgame.themes, ...style.themes]),
    },
    globalThemes: uniq([
      ...opening.themes,
      ...middlegame.themes,
      ...endgame.themes,
      ...style.themes,
    ]),
    momentsByPly: buildMoments(args.record, userIsWhite),
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
  };
}

/**
 * Lookup already-calculated vault + heuristic metrics for one game.
 */
export async function lookupCoachGameMetrics(options: {
  platform: Platform;
  username: string;
  gameId: string;
  userColor?: string | null;
}): Promise<CoachGameMetrics> {
  const filters = {
    platform: options.platform,
    username: options.username,
  };
  const gameId = String(options.gameId);

  const [vault, heuristicsCached] = await Promise.all([
    loadPermanentEvalStore(filters),
    readCache<HeuristicStore>(
      studyHeuristicsStoreCacheKey(filters),
      PERMANENT_CACHE_TTL_MS
    ),
  ]);

  const record = vault.games[gameId] || null;
  const heuristics = heuristicsCached?.games?.[gameId] || null;

  return buildCoachGameMetrics({
    record,
    heuristics,
    userColor: options.userColor,
  });
}

export function emptyCoachGameMetrics(): CoachGameMetrics {
  return {
    available: false,
    themesByPhase: { opening: [], middlegame: [], endgame: [] },
    globalThemes: [],
    momentsByPly: {},
    strengths: [],
    weaknesses: [],
  };
}
