/**
 * Deterministic engine-line coach text from metric diffs + opening principles.
 * No LLM — templates keyed by BoardMetricSnap fields / soft keys.
 */

import type { MetricFieldDelta } from "./coachNoteRequest";
import { keysForMetricFields } from "./metricNoteKeys";
import {
  rankMetricAxes,
  significantRankedAxes,
} from "./metricAxisRank";
import {
  metricKeyLabel,
  openingPrincipleDirectives,
  themeTagToMetricKey,
} from "./metricThemes";

export type EngineLineExplainInput = {
  bestSan?: string | null;
  engineLineSans?: string[];
  playedLineSans?: string[];
  engineVsPlayedMetricDelta?: MetricFieldDelta[];
  engineLineMetricDelta?: MetricFieldDelta[];
  playedLineMetricDelta?: MetricFieldDelta[];
  phase?: string | null;
  openingKeyId?: string | null;
  openingName?: string | null;
  /** Prefer reply/punish framing (opponent_mistake). */
  punishFrame?: boolean;
};

export type MetricSignalPolarity =
  | "betterForEngine"
  | "betterForPlayed"
  | "neutral";

export type MetricSignal = {
  field: string;
  delta: number;
  polarity: MetricSignalPolarity;
  softHint: string | null;
  softKeys: string[];
  /** Short signed phrase for dump / secondary comment lines. */
  phrase: string;
};

export type EngineLineExplainResult = {
  text: string;
  softKeys: string[];
  reasons: string[];
  /** Field behind the top why_better reason (engine-helping Δ). */
  primaryField: string | null;
  primarySoftHint: string | null;
  primarySoftKeys: string[];
  metricSignals: MetricSignal[];
  /** Non-primary signed phrases (space gained on played, etc.). */
  secondaryPhrases: string[];
  /** Compact primary lead for tip composition (why_better first). */
  primaryText: string;
};

/** Fields where higher engine-vs-played is better for the user. */
const HIGHER_BETTER = new Set([
  "mobility",
  "hanging_material_opponent",
  "space_advantage_pct",
  "opp_king_attackers_pct",
  "material_balance",
  "open_file_utilization",
  "seventh_rank_infiltration",
  "queenside_advance",
  "kingside_advance",
  "center_advance",
  "bishop_diagonal_influence_light",
  "bishop_diagonal_influence_dark",
  "bishop_openness_light",
  "bishop_openness_dark",
  "pawn_storm_tempo",
  "center_fluidity_index",
  "pawn_storm_tempo_delta",
  "king_center_file_exposure",
  "knight_vs_bishop",
  "good_vs_bad_bishop",
  "wp",
  "eval_cp",
  "opp_king_in_centre",
  "opp_king_uncastled",
  "king_attack_ratio",
  "attack_setup",
  "opp_king_weaknesses",
  "second_weakness",
  "queen_centralization",
  "connected_rooks",
  "piece_liberation",
  "side_clamp",
  "key_square_control",
  "piece_support",
]);

/** Fields where lower engine-vs-played is better (safer / fewer hangs). */
const LOWER_BETTER = new Set([
  "hanging_material_own",
  "king_attackers_pct",
  "tempo_waste_rate_pct",
  "uncastled_rate_pct",
  "castle_fullmove",
  "queenside_advance_opponent",
  "kingside_advance_opponent",
  "center_advance_opponent",
  "bishop_diagonal_influence_light_opponent",
  "bishop_diagonal_influence_dark_opponent",
  "bishop_openness_light_opponent",
  "bishop_openness_dark_opponent",
]);

const FIELD_REASON: Record<
  string,
  { betterHigh: string; betterLow: string; softHint: string }
> = {
  mobility: {
    betterHigh: "pieces had more activity (mobility)",
    betterLow: "activity was lower",
    softHint: "piece_activity",
  },
  tempo_waste_rate_pct: {
    betterHigh: "more tempi spent re-moving developed pieces",
    betterLow: "development without wasting tempi",
    softHint: "piece_activity",
  },
  minors_developed: {
    betterHigh: "more minors developed",
    betterLow: "fewer minors developed",
    softHint: "piece_activity",
  },
  king_attackers_pct: {
    betterHigh: "own king was under more fire",
    betterLow: "own king was safer",
    softHint: "king_safety",
  },
  opp_king_attackers_pct: {
    betterHigh: "more pressure on the enemy king",
    betterLow: "less pressure on the enemy king",
    softHint: "attack",
  },
  space_advantage_pct: {
    betterHigh: "more space",
    betterLow: "less space",
    softHint: "space",
  },
  hanging_material_own: {
    betterHigh: "more of your material hanging",
    betterLow: "less of your material hanging",
    softHint: "prophylaxis",
  },
  hanging_material_opponent: {
    betterHigh: "more opponent material hanging",
    betterLow: "less opponent material hanging",
    softHint: "tactics",
  },
  open_file_utilization: {
    betterHigh: "heavy pieces better occupied open/semi-open files",
    betterLow: "less open-file occupation",
    softHint: "open_file",
  },
  seventh_rank_infiltration: {
    betterHigh: "more heavy pieces on the seventh",
    betterLow: "fewer pieces on the seventh",
    softHint: "seventh_rank",
  },
  queenside_advance: {
    betterHigh: "more queenside pawn advance",
    betterLow: "less queenside pawn advance",
    softHint: "space",
  },
  queenside_advance_opponent: {
    betterHigh: "opponent advanced more on the queenside",
    betterLow: "opponent advanced less on the queenside",
    softHint: "pawn_break",
  },
  kingside_advance: {
    betterHigh: "more kingside pawn advance",
    betterLow: "less kingside pawn advance",
    softHint: "space",
  },
  kingside_advance_opponent: {
    betterHigh: "opponent advanced more on the kingside",
    betterLow: "opponent advanced less on the kingside",
    softHint: "pawn_break",
  },
  center_advance: {
    betterHigh: "more central pawn advance",
    betterLow: "less central pawn advance",
    softHint: "centre",
  },
  center_advance_opponent: {
    betterHigh: "opponent advanced more in the centre",
    betterLow: "opponent advanced less in the centre",
    softHint: "pawn_break",
  },
  bishop_diagonal_influence_light: {
    betterHigh: "light-square bishop saw more of the board",
    betterLow: "light-square bishop was more restricted",
    softHint: "color_complexes",
  },
  bishop_diagonal_influence_dark: {
    betterHigh: "dark-square bishop saw more of the board",
    betterLow: "dark-square bishop was more restricted",
    softHint: "color_complexes",
  },
  bishop_diagonal_influence_light_opponent: {
    betterHigh: "opponent's light-square bishop saw more",
    betterLow: "opponent's light-square bishop saw less",
    softHint: "color_complexes",
  },
  bishop_diagonal_influence_dark_opponent: {
    betterHigh: "opponent's dark-square bishop saw more",
    betterLow: "opponent's dark-square bishop saw less",
    softHint: "color_complexes",
  },
  bishop_openness_light: {
    betterHigh: "light-square bishop diagonals were more open",
    betterLow: "light-square bishop diagonals were more blocked",
    softHint: "color_complexes",
  },
  bishop_openness_dark: {
    betterHigh: "dark-square bishop diagonals were more open",
    betterLow: "dark-square bishop diagonals were more blocked",
    softHint: "color_complexes",
  },
  bishop_openness_light_opponent: {
    betterHigh: "opponent's light-square bishop was more open",
    betterLow: "opponent's light-square bishop was more blocked",
    softHint: "color_complexes",
  },
  bishop_openness_dark_opponent: {
    betterHigh: "opponent's dark-square bishop was more open",
    betterLow: "opponent's dark-square bishop was more blocked",
    softHint: "color_complexes",
  },
  material_balance: {
    betterHigh: "better material balance",
    betterLow: "worse material balance",
    softHint: "exchanges",
  },
  wp: {
    betterHigh: "higher win probability",
    betterLow: "lower win probability",
    softHint: "initiative",
  },
  eval_cp: {
    betterHigh: "better evaluation",
    betterLow: "worse evaluation",
    softHint: "initiative",
  },
  pawn_storm_tempo: {
    betterHigh: "faster pawn-storm race on the attack wing",
    betterLow: "slower pawn-storm race on the attack wing",
    softHint: "attack",
  },
  center_fluidity_index: {
    betterHigh: "a more fluid centre for a central break",
    betterLow: "a more locked centre",
    softHint: "pawn_break",
  },
  pawn_storm_tempo_delta: {
    betterHigh: "queenside counterplay ahead of their kingside storm",
    betterLow: "trailing the kingside pawn storm",
    softHint: "attack",
  },
  king_center_file_exposure: {
    betterHigh: "open d/e files against their central king",
    betterLow: "closed d/e files toward their king",
    softHint: "king_safety",
  },
  knight_vs_bishop: {
    betterHigh: "stronger knight-vs-bishop imbalance for you",
    betterLow: "weaker knight-vs-bishop imbalance for you",
    softHint: "knight_vs_bishop",
  },
  good_vs_bad_bishop: {
    betterHigh: "better bishop (more open / fewer same-colour pawns)",
    betterLow: "worse bishop (more blocked / same-colour pawns)",
    softHint: "good_vs_bad_bishop",
  },
  opp_king_in_centre: {
    betterHigh: "opponent king stuck in the centre",
    betterLow: "opponent king left the centre",
    softHint: "king_safety",
  },
  opp_king_uncastled: {
    betterHigh: "opponent king still uncastled",
    betterLow: "opponent king castled",
    softHint: "king_safety",
  },
  king_attack_ratio: {
    betterHigh: "more attackers than defenders around their king",
    betterLow: "fewer attackers than defenders around their king",
    softHint: "attack",
  },
  attack_setup: {
    betterHigh: "stronger attack build-up on the enemy king",
    betterLow: "weaker attack build-up",
    softHint: "attack",
  },
  opp_king_weaknesses: {
    betterHigh: "more holes in the opponent king shield",
    betterLow: "fewer holes in the opponent king shield",
    softHint: "king_safety",
  },
  second_weakness: {
    betterHigh: "a clearer second weakness to attack",
    betterLow: "less of a second-weakness theme",
    softHint: "two_weaknesses",
  },
  queen_centralization: {
    betterHigh: "queen more central",
    betterLow: "queen less central",
    softHint: "piece_activity",
  },
  connected_rooks: {
    betterHigh: "rooks connected",
    betterLow: "rooks disconnected",
    softHint: "piece_activity",
  },
  piece_liberation: {
    betterHigh: "minors freer (more open lines)",
    betterLow: "minors more restricted",
    softHint: "piece_activity",
  },
  side_clamp: {
    betterHigh: "stronger side clamp / wing space skew",
    betterLow: "less side clamp",
    softHint: "space",
  },
  key_square_control: {
    betterHigh: "better grip on key outpost squares",
    betterLow: "weaker key-square control",
    softHint: "outpost",
  },
  piece_support: {
    betterHigh: "pieces covering one another",
    betterLow: "pieces less supported",
    softHint: "piece_activity",
  },
};

export function deltaHelpsEngine(field: string, delta: number): boolean | null {
  if (Math.abs(delta) < 1e-9) return null;
  if (HIGHER_BETTER.has(field)) return delta > 0;
  if (LOWER_BETTER.has(field)) return delta < 0;
  return delta > 0;
}

function softKeysForField(field: string): string[] {
  const fromMap = keysForMetricFields([field]);
  const hint = FIELD_REASON[field]?.softHint;
  const fromHint = hint ? themeTagToMetricKey(hint) : null;
  return [...new Set([...fromMap, ...(fromHint ? [fromHint] : [])])];
}

function reasonForDelta(d: MetricFieldDelta): string | null {
  if (d.delta == null || typeof d.delta !== "number") return null;
  const helps = deltaHelpsEngine(d.field, d.delta);
  if (!helps) return null;
  const meta = FIELD_REASON[d.field];
  if (!meta) {
    return `${d.field.replace(/_/g, " ")} improved`;
  }
  if (LOWER_BETTER.has(d.field)) return meta.betterLow;
  return meta.betterHigh;
}

function phraseForSignal(
  field: string,
  delta: number,
  polarity: MetricSignalPolarity
): string {
  const meta = FIELD_REASON[field];
  if (polarity === "neutral") {
    return meta
      ? `${meta.softHint} unchanged`
      : `${field.replace(/_/g, " ")} unchanged`;
  }
  if (!meta) {
    return polarity === "betterForEngine"
      ? `engine better on ${field.replace(/_/g, " ")}`
      : `your line better on ${field.replace(/_/g, " ")}`;
  }
  if (polarity === "betterForEngine") {
    return LOWER_BETTER.has(field) ? meta.betterLow : meta.betterHigh;
  }
  if (LOWER_BETTER.has(field)) {
    return delta > 0
      ? "your line left the king safer relative to the engine"
      : meta.betterHigh;
  }
  return delta < 0
    ? `your line gained ${meta.betterHigh.replace(/^more /, "")}`
    : meta.betterLow;
}

/**
 * Signed metric signals from engine-leaf − played-alt-leaf (or line Δ).
 * betterForEngine = this field favors the engine line at this moment.
 */
export function buildMetricSignals(
  deltas: MetricFieldDelta[]
): MetricSignal[] {
  const out: MetricSignal[] = [];
  for (const d of deltas) {
    if (d.delta == null || typeof d.delta !== "number") continue;
    if (Math.abs(d.delta) < 1e-9) continue;
    const helps = deltaHelpsEngine(d.field, d.delta);
    const polarity: MetricSignalPolarity =
      helps == null ? "neutral" : helps ? "betterForEngine" : "betterForPlayed";
    const meta = FIELD_REASON[d.field];
    out.push({
      field: d.field,
      delta: d.delta,
      polarity,
      softHint: meta?.softHint ?? null,
      softKeys: softKeysForField(d.field),
      phrase: phraseForSignal(d.field, d.delta, polarity),
    });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function pickReasonRows(
  deltas: MetricFieldDelta[],
  limit = 4,
  phase?: string | null
): Array<{ field: string; abs: number; reason: string }> {
  const ranked = significantRankedAxes(rankMetricAxes({ deltas, phase }), limit);
  const byField = new Map(deltas.map((d) => [d.field, d]));
  const out: Array<{ field: string; abs: number; reason: string }> = [];
  const seen = new Set<string>();
  for (const row of ranked) {
    const d = byField.get(row.field);
    if (!d) continue;
    const reason = reasonForDelta(d);
    if (!reason || seen.has(reason)) continue;
    seen.add(reason);
    out.push({ field: row.field, abs: row.abs, reason });
  }
  return out;
}

function softKeysFromSignals(
  signals: MetricSignal[],
  primaryField: string | null
): { softKeys: string[]; primarySoftKeys: string[] } {
  const primarySoftKeys = primaryField
    ? softKeysForField(primaryField)
    : [];
  const engineKeys: string[] = [];
  const playedKeys: string[] = [];
  for (const s of signals) {
    const target =
      s.polarity === "betterForEngine"
        ? engineKeys
        : s.polarity === "betterForPlayed"
          ? playedKeys
          : engineKeys;
    for (const k of s.softKeys) target.push(k);
  }
  const softKeys = [
    ...new Set([...primarySoftKeys, ...engineKeys, ...playedKeys]),
  ];
  return { softKeys, primarySoftKeys: [...new Set(primarySoftKeys)] };
}

function formatMetricSignalShort(signals: MetricSignal[], limit = 8): string {
  return signals
    .slice(0, limit)
    .map((s) => {
      const sign = s.delta > 0 ? "+" : "";
      const hint = s.softHint ? `:${s.softHint}` : "";
      return `${s.field}:${sign}${s.delta}/${s.polarity}${hint}`;
    })
    .join(",");
}

export { formatMetricSignalShort };

/**
 * Build deterministic “why engine line is better” prose + soft keys to attach.
 */
export function explainEngineLineVsPlayed(
  args: EngineLineExplainInput
): EngineLineExplainResult {
  const vs = args.engineVsPlayedMetricDelta || [];
  const engine = args.engineLineMetricDelta || [];
  const deltas = vs.length ? vs : engine;
  const reasonRows = pickReasonRows(deltas, 4, args.phase);
  const reasons = reasonRows.map((r) => r.reason);
  const primaryField = reasonRows[0]?.field ?? null;
  const primarySoftHint = primaryField
    ? FIELD_REASON[primaryField]?.softHint ?? null
    : null;
  const metricSignals = buildMetricSignals(deltas);
  const { softKeys, primarySoftKeys } = softKeysFromSignals(
    metricSignals,
    primaryField
  );

  const best =
    args.bestSan ||
    (args.engineLineSans && args.engineLineSans[0]) ||
    null;
  const engineLine = (args.engineLineSans || []).join(" ");
  const playedLine = (args.playedLineSans || []).join(" ");

  const primaryBits: string[] = [];
  if (args.punishFrame) {
    primaryBits.push(
      best
        ? `Take advantage with ${best}`
        : "Take advantage of the gifted chance"
    );
  } else if (best) {
    primaryBits.push(`Prefer ${best}`);
  }
  if (reasons.length) {
    primaryBits.push(reasons.slice(0, 3).join("; "));
  }
  const primaryText = primaryBits.join(" — ").trim();

  const secondaryPhrases = metricSignals
    .filter(
      (s) =>
        s.field !== primaryField &&
        s.polarity === "betterForPlayed" &&
        Math.abs(s.delta) >= 1
    )
    .slice(0, 3)
    .map((s) => s.phrase);

  const bits: string[] = [];
  if (primaryText) bits.push(primaryText);
  if (secondaryPhrases.length) {
    bits.push(secondaryPhrases.join("; "));
  }
  if (args.phase === "opening") {
    const principles = openingPrincipleDirectives(args.openingKeyId);
    if (principles[0]) {
      bits.push(principles[0]);
    }
  }
  if (softKeys.length) {
    const labels = softKeys.slice(0, 3).map(metricKeyLabel).join(", ");
    bits.push(`Key ideas: ${labels}`);
  }

  const text = bits.join(" — ").replace(/\s+/g, " ").trim();
  void engineLine;
  void playedLine;
  return {
    text,
    softKeys,
    reasons,
    primaryField,
    primarySoftHint,
    primarySoftKeys,
    metricSignals,
    secondaryPhrases,
    primaryText,
  };
}
