import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAnalytics } from "../context/AnalyticsContext";
import { useFilters } from "../context/FilterContext";
import {
  lookupBaseline,
  normalizeSpeed,
  ratingBand,
  type BaselineMetricHit,
  type BaselineStore,
} from "../data/baselines";
import {
  THEORETICAL_KEYS,
  type TheoreticalKey,
  type TheoreticalOutcome,
} from "../engine/endgamePhase";
import { EdgeCard, SectionLabel } from "./ui";
import { colors, font, result, spacing, withAlpha } from "../theme";

type MetricScale =
  | { kind: "fixed"; max: number }
  | { kind: "benchmark"; fallback: number };

type MetricDef = {
  name: string;
  key: string;
  unit: string;
  summary: string;
  detail: string;
  format: (v: number) => string;
  scale: MetricScale;
};

const BLUNDER_METRIC: MetricDef = {
  name: "Blunder Rate on Endgames",
  key: "endgame_blunder_avg",
  unit: "/game",
  summary: "Average blunders per endgame.",
  detail:
    "In the endgame phase (≤7 non-king non-pawn pieces), a blunder is a move that drops win probability by more than 15pp. Reported as the mean blunder count per game that reached an endgame.",
  format: (v) => v.toFixed(1),
  scale: { kind: "benchmark", fallback: 2 },
};

const PRACTICAL_AFTER_SAVED: MetricDef[] = [
  {
    name: "King Centralization",
    key: "endgame_king_centralization",
    unit: "",
    summary: "How close your king sits to the center.",
    detail:
      "Score max(0, 4 − Chebyshev distance) from your king to the nearest of d4/e4/d5/e5. Sampled every 3 endgame plies, then averaged. Higher means a more central king.",
    format: (v) => v.toFixed(2),
    scale: { kind: "fixed", max: 4 },
  },
  {
    name: "King Distance",
    key: "endgame_king_distance",
    unit: "",
    summary: "King moves to fight enemy pawns.",
    detail:
      "Minimum Chebyshev king-moves to any enemy pawn, or to the promotion square of a clear passer. Sampled every 3 endgame plies with king centralization. Lower means your king is closer to stopping enemy pawns.",
    format: (v) => v.toFixed(2),
    scale: { kind: "benchmark", fallback: 4 },
  },
  {
    name: "Pawn Difference",
    key: "endgame_pawn_diff",
    unit: "",
    summary: "Net pawn captures for you after the endgame starts.",
    detail:
      "Starts at 0 when the endgame begins (≤7 non-pawn pieces). Each time you capture an enemy pawn: +1. Each time the opponent captures one of yours: −1. Promotions do not change the counter. Reported value is the final total for the game (not a mean of positions).",
    format: (v) => (v >= 0 ? `+${v.toFixed(0)}` : v.toFixed(0)),
    scale: { kind: "benchmark", fallback: 2 },
  },
  {
    name: "Beneficial Trades",
    key: "endgame_beneficial_trade_pct",
    unit: "%",
    summary: "Piece trades that raise winning chances.",
    detail:
      "Among endgame piece trades (one exchange = two pieces off; minor/major captures completed within three plies). Pawn may finish a trade only if a rook/queen is involved; minor-for-minor finished by a pawn does not count. Share where your win probability or eval improves across the trade.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Simplification Trades",
    key: "endgame_simplification_trade_pct",
    unit: "%",
    summary: "Trading down while already winning.",
    detail:
      "Among endgame trades that start with win probability ≥ 0.7, the share where you give a higher-value piece for a lower-value one and the WP drop stays below the blunder threshold (0.2). Separate from winning-material trades (net material gain including pawns).",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
];

const MATE_METRICS: MetricDef[] = [
  {
    name: "Conversion Rate",
    key: "endgame_mate_conversion_pct",
    unit: "%",
    summary: "Mate evaluations that become real mates.",
    detail:
      "A mate episode starts when the engine eval is mate for you in the endgame. It converts only if every later sample stays mate-for-you until you deliver checkmate. Reported as converted episodes ÷ mate episodes.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Stalemate",
    key: "endgame_stalemate_pct",
    unit: "%",
    summary: "Winning positions that end in accidental stalemate.",
    detail:
      "Share of endgame games that finish in stalemate when the position immediately before the final move had your win probability ≥ 0.7.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Mate Tempo",
    key: "endgame_mate_avg_seconds",
    unit: "s",
    summary: "Think time during mate sequences.",
    detail:
      "Average seconds per move on your turns while a mate-for-you episode is active (from PGN clock tags).",
    format: (v) => v.toFixed(1),
    scale: { kind: "benchmark", fallback: 5 },
  },
];

const THEORETICAL_LABELS: Record<TheoreticalKey, string> = {
  te_pawn_endings: "Pawn Endings",
  te_queen_vs_pawn: "Queen vs Pawn",
  te_rook_vs_pawn: "Rook vs Pawn",
  te_bishop_pawn_vs_knight: "Bishop + Pawn vs Knight",
  te_opp_bishop_two_pawns: "Two Pawns + Opposite Bishops",
  te_pawn_vs_knight: "Pawn vs Knight",
  te_two_pawns_vs_rook: "Two Pawns vs Rook",
  te_knight_pawn_vs_bishop: "Knight + Pawn vs Bishop",
  te_rook_pawn_vs_rook: "Rook + Pawn vs Rook",
};

function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function projectBenchmarkMax(
  hit: BaselineMetricHit | null,
  fallback: number
): number {
  const parts = [fallback];
  if (hit?.mean != null && Number.isFinite(hit.mean) && Math.abs(hit.mean) > 0) {
    parts.push(Math.abs(hit.mean) * 1.6);
  }
  if (hit?.p90 != null && Number.isFinite(hit.p90) && Math.abs(hit.p90) > 0) {
    parts.push(Math.abs(hit.p90) * 1.25);
  } else if (hit?.p75 != null && Number.isFinite(hit.p75) && Math.abs(hit.p75) > 0) {
    parts.push(Math.abs(hit.p75) * 1.45);
  }
  return Math.max(...parts);
}

function resolveScaleMax(
  scale: MetricScale,
  hit: BaselineMetricHit | null
): number {
  if (scale.kind === "fixed") return scale.max;
  return projectBenchmarkMax(hit, scale.fallback);
}

function MetricBulletGraph({
  value,
  peerMean,
  scaleMax,
}: {
  value: number | null | undefined;
  peerMean: number | null | undefined;
  scaleMax: number;
}) {
  if (value == null || !Number.isFinite(value) || !(scaleMax > 0)) return null;
  const fillPct = Math.max(0, (Math.abs(value) / scaleMax) * 100);
  const peerPct =
    peerMean != null && Number.isFinite(peerMean)
      ? Math.max(0, (Math.abs(peerMean) / scaleMax) * 100)
      : null;
  return (
    <View style={styles.bulletWrap}>
      <View style={styles.bulletTrack}>
        <View
          style={[
            styles.bulletFill,
            { width: `${Math.min(fillPct, 100)}%` },
          ]}
        />
        {peerPct != null ? (
          <View
            style={[
              styles.bulletPeer,
              { left: `${Math.min(peerPct, 100)}%` },
            ]}
          />
        ) : null}
      </View>
    </View>
  );
}

function TheoreticalOutcomeBar({
  winPct,
  drawPct,
  peerWin,
}: {
  winPct: number;
  drawPct: number;
  peerWin: number | null;
}) {
  const winW = Math.max(0, Math.min(100, winPct));
  const drawW = Math.max(0, Math.min(100 - winW, drawPct));
  const peerPct =
    peerWin != null && Number.isFinite(peerWin)
      ? Math.max(0, Math.min(100, peerWin))
      : null;
  return (
    <View style={styles.bulletWrap}>
      <View style={styles.bulletTrack}>
        <View style={[styles.stackWin, { width: `${winW}%` }]} />
        <View
          style={[styles.stackDraw, { left: `${winW}%`, width: `${drawW}%` }]}
        />
        {peerPct != null ? (
          <View style={[styles.bulletPeer, { left: `${peerPct}%` }]} />
        ) : null}
      </View>
    </View>
  );
}

function HelpModal({
  content,
  onClose,
}: {
  content: { title: string; summary: string; detail: string } | null;
  onClose: () => void;
}) {
  if (!content) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.helpBackdrop} onPress={onClose}>
        <Pressable style={styles.helpCard} onPress={() => {}}>
          <View style={styles.helpHeader}>
            <Text style={styles.helpTitle}>{content.title}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.helpClose}>✕</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.helpScroll}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.helpSummary}>{content.summary}</Text>
            <Text style={styles.helpDetailLabel}>How we measure it</Text>
            <Text style={styles.helpDetail}>{content.detail}</Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MetricBanner({
  name,
  value,
  unit,
  userNum,
  baselineKey,
  scale,
  baselines,
  peerBand,
  peerSpeed,
  onHelp,
}: {
  name: string;
  value: string;
  unit: string;
  userNum: number | null;
  baselineKey: string;
  scale: MetricScale;
  baselines: BaselineStore | null;
  peerBand: string | null;
  peerSpeed: string | null;
  onHelp?: () => void;
}) {
  const hit =
    baselineKey && peerBand && peerSpeed
      ? lookupBaseline(baselines, baselineKey, peerBand, peerSpeed)
      : null;
  const scaleMax = resolveScaleMax(scale, hit);
  return (
    <EdgeCard style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.cardBody}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.value}>
            {value}
            {unit ? <Text style={styles.unit}> {unit}</Text> : null}
          </Text>
          <MetricBulletGraph
            value={userNum}
            peerMean={hit?.mean}
            scaleMax={scaleMax}
          />
        </View>
        {onHelp ? (
          <Pressable
            onPress={onHelp}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`About ${name}`}
            style={styles.helpButton}
          >
            <Text style={styles.helpButtonText}>?</Text>
          </Pressable>
        ) : null}
      </View>
    </EdgeCard>
  );
}

function TheoreticalCard({
  label,
  outcome,
  baselineKey,
  baselines,
  peerBand,
  peerSpeed,
}: {
  label: string;
  outcome: TheoreticalOutcome;
  baselineKey: string;
  baselines: BaselineStore | null;
  peerBand: string | null;
  peerSpeed: string | null;
}) {
  const hit =
    peerBand && peerSpeed
      ? lookupBaseline(baselines, baselineKey, peerBand, peerSpeed)
      : null;
  return (
    <EdgeCard style={styles.card}>
      <Text style={styles.name}>{label}</Text>
      <Text style={styles.familyMeta}>
        {outcome.games} games · {fmt(outcome.win_rate_pct)}% W ·{" "}
        {fmt(outcome.draw_rate_pct)}% D
      </Text>
      <TheoreticalOutcomeBar
        winPct={outcome.win_rate_pct}
        drawPct={outcome.draw_rate_pct}
        peerWin={hit?.mean ?? null}
      />
    </EdgeCard>
  );
}

function cardsFromDefs(
  defs: MetricDef[],
  values: Record<string, number | null>
) {
  return defs
    .map((def) => {
      const raw = values[def.key];
      const userNum =
        raw == null || !Number.isFinite(raw) ? null : Number(raw);
      return {
        ...def,
        value: userNum == null ? "—" : def.format(userNum),
        userNum,
      };
    })
    .filter((m) => m.userNum != null);
}

export function EndgameInsightsPanel() {
  const { speed } = useFilters();
  const {
    games,
    gamesLoading,
    endgamePhase,
    endgamePhaseLoading,
    baselines,
  } = useAnalytics();
  const [helpContent, setHelpContent] = useState<{
    title: string;
    summary: string;
    detail: string;
  } | null>(null);

  const peerBand = useMemo(() => {
    const ratings = games
      .map((g) => Number(g.user_rating))
      .filter((n) => Number.isFinite(n));
    if (!ratings.length) return null;
    const mid = [...ratings].sort((a, b) => a - b)[
      Math.floor(ratings.length / 2)
    ];
    return ratingBand(mid);
  }, [games]);

  const inferredSpeed = useMemo(() => {
    const speedCounts = new Map<string, number>();
    for (const g of games) {
      const s = String(g.speed || "").toLowerCase();
      if (!s) continue;
      speedCounts.set(s, (speedCounts.get(s) || 0) + 1);
    }
    return (
      [...speedCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
    );
  }, [games]);

  const peerSpeed = normalizeSpeed(speed) || normalizeSpeed(inferredSpeed);
  const agg = endgamePhase?.aggregate ?? null;
  const profileReady = !!agg && !endgamePhaseLoading;

  const blunderCard = useMemo(() => {
    if (!agg || agg.endgame_blunder_avg == null) return null;
    return {
      ...BLUNDER_METRIC,
      value: BLUNDER_METRIC.format(agg.endgame_blunder_avg),
      userNum: agg.endgame_blunder_avg,
    };
  }, [agg]);

  const practicalAfterCards = useMemo(() => {
    if (!agg) return [];
    return cardsFromDefs(PRACTICAL_AFTER_SAVED, {
      endgame_king_centralization: agg.endgame_king_centralization,
      endgame_king_distance: agg.endgame_king_distance,
      endgame_pawn_diff: agg.endgame_pawn_diff,
      endgame_beneficial_trade_pct: agg.endgame_beneficial_trade_pct,
      endgame_simplification_trade_pct: agg.endgame_simplification_trade_pct,
    });
  }, [agg]);

  const mateCards = useMemo(() => {
    if (!agg) return [];
    return cardsFromDefs(MATE_METRICS, {
      endgame_mate_conversion_pct: agg.endgame_mate_conversion_pct,
      endgame_stalemate_pct: agg.endgame_stalemate_pct,
      endgame_mate_avg_seconds: agg.endgame_mate_avg_seconds,
    });
  }, [agg]);

  const theoreticalCards = useMemo(() => {
    if (!agg?.outcomes) return [];
    return THEORETICAL_KEYS.map((key) => {
      const outcome = agg.outcomes[key];
      if (!outcome || outcome.games < 1) return null;
      return { key, label: THEORETICAL_LABELS[key], outcome };
    }).filter(Boolean) as Array<{
      key: TheoreticalKey;
      label: string;
      outcome: TheoreticalOutcome;
    }>;
  }, [agg]);

  const savedGames = agg?.endgame_theoretical_saved_games ?? 0;
  const savedWins = agg?.endgame_theoretical_saved_wins ?? 0;
  const savedDraws = agg?.endgame_theoretical_saved_draws ?? 0;
  const savedRatePct =
    savedGames > 0
      ? Math.round(((savedWins + savedDraws) / savedGames) * 1000) / 10
      : null;
  const showSaved = !!agg && savedGames > 0;

  if (!agg && (gamesLoading || endgamePhaseLoading)) {
    return <Text style={styles.hint}>Loading endgame metrics…</Text>;
  }
  if (!gamesLoading && games.length <= 0 && !agg) {
    return <Text style={styles.hint}>No games in this filter set.</Text>;
  }

  return (
    <View>
      <HelpModal
        content={helpContent}
        onClose={() => setHelpContent(null)}
      />

      {blunderCard || showSaved || practicalAfterCards.length ? (
        <View style={styles.section}>
          <SectionLabel>Practical Endgames</SectionLabel>
          {blunderCard ? (
            <MetricBanner
              name={blunderCard.name}
              value={blunderCard.value}
              unit={blunderCard.unit}
              userNum={blunderCard.userNum}
              baselineKey={blunderCard.key}
              scale={blunderCard.scale}
              baselines={baselines}
              peerBand={peerBand}
              peerSpeed={peerSpeed}
              onHelp={() =>
                setHelpContent({
                  title: blunderCard.name,
                  summary: blunderCard.summary,
                  detail: blunderCard.detail,
                })
              }
            />
          ) : null}
          {showSaved && agg && savedRatePct != null ? (
            <MetricBanner
              name="Theoretical Endgames Saved"
              value={savedRatePct.toFixed(1)}
              unit="%"
              userNum={savedRatePct}
              baselineKey="endgame_theoretical_saved_win_pct"
              scale={{ kind: "fixed", max: 100 }}
              baselines={baselines}
              peerBand={peerBand}
              peerSpeed={peerSpeed}
              onHelp={() =>
                setHelpContent({
                  title: "Theoretical Endgames Saved",
                  summary:
                    "Share of weaker-side theoretical endings you won or drew.",
                  detail:
                    "Covers Queen vs Pawn, Rook vs Pawn, Bishop + Pawn vs Knight, and Two Pawns + Opposite Bishops when you held the disadvantaged side (not shown in Theoretical). Drawish types kept for both sides are excluded. Value is (wins + draws) / total such games × 100.",
                })
              }
            />
          ) : null}
          {practicalAfterCards.map((metric) => (
            <MetricBanner
              key={metric.key}
              name={metric.name}
              value={metric.value}
              unit={metric.unit}
              userNum={metric.userNum}
              baselineKey={metric.key}
              scale={metric.scale}
              baselines={baselines}
              peerBand={peerBand}
              peerSpeed={peerSpeed}
              onHelp={() =>
                setHelpContent({
                  title: metric.name,
                  summary: metric.summary,
                  detail: metric.detail,
                })
              }
            />
          ))}
        </View>
      ) : null}

      {mateCards.length ? (
        <View style={styles.section}>
          <SectionLabel>Mates</SectionLabel>
          {mateCards.map((metric) => (
            <MetricBanner
              key={metric.key}
              name={metric.name}
              value={metric.value}
              unit={metric.unit}
              userNum={metric.userNum}
              baselineKey={metric.key}
              scale={metric.scale}
              baselines={baselines}
              peerBand={peerBand}
              peerSpeed={peerSpeed}
              onHelp={() =>
                setHelpContent({
                  title: metric.name,
                  summary: metric.summary,
                  detail: metric.detail,
                })
              }
            />
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionLabel>Theoretical Endgames</SectionLabel>
        {theoreticalCards.length ? (
          theoreticalCards.map((card) => (
            <TheoreticalCard
              key={card.key}
              label={card.label}
              outcome={card.outcome}
              baselineKey={`${card.key}_win_rate_pct`}
              baselines={baselines}
              peerBand={peerBand}
              peerSpeed={peerSpeed}
            />
          ))
        ) : profileReady ? (
          <Text style={styles.hint}>
            No theoretical endgame fingerprints in this sample yet.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    color: colors.textDim,
    fontFamily: font.sans,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  section: { marginBottom: spacing.md },
  familyMeta: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  card: { marginBottom: spacing.sm },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardBody: {
    flex: 1,
    flexShrink: 1,
  },
  name: {
    color: colors.text,
    fontFamily: font.displayMedium,
    fontSize: 16,
    lineHeight: 21,
    marginBottom: 8,
  },
  helpButton: {
    width: 33,
    height: 33,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: withAlpha(colors.cream, 0.75),
    backgroundColor: withAlpha(colors.cream, 0.22),
    alignItems: "center",
    justifyContent: "center",
  },
  helpButtonText: {
    color: colors.text,
    fontFamily: font.monoBold,
    fontSize: 16,
    lineHeight: 18,
  },
  value: {
    color: colors.text,
    fontFamily: font.displayLight,
    fontSize: 26,
    marginBottom: 2,
  },
  unit: {
    color: colors.textMuted,
    fontFamily: font.mono,
    fontSize: 13,
  },
  bulletWrap: {
    marginTop: 10,
    paddingVertical: 4,
  },
  bulletTrack: {
    height: 8,
    backgroundColor: withAlpha("#ffffff", 0.08),
    position: "relative",
    justifyContent: "center",
  },
  bulletFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: result.win,
  },
  stackWin: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: result.win,
  },
  stackDraw: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: result.draw,
  },
  bulletPeer: {
    position: "absolute",
    top: -2,
    bottom: -2,
    width: 2,
    marginLeft: -1,
    backgroundColor: colors.cream,
  },
  helpBackdrop: {
    flex: 1,
    backgroundColor: withAlpha("#000000", 0.55),
    justifyContent: "center",
    padding: spacing.lg,
  },
  helpCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: withAlpha(colors.cream, 0.35),
    padding: spacing.md,
    maxHeight: "70%",
  },
  helpHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  helpTitle: {
    color: colors.text,
    fontFamily: font.displayMedium,
    fontSize: 20,
    flex: 1,
    paddingRight: spacing.sm,
  },
  helpClose: {
    color: colors.textMuted,
    fontFamily: font.mono,
    fontSize: 18,
  },
  helpScroll: { maxHeight: 360 },
  helpSummary: {
    color: colors.text,
    fontFamily: font.sans,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  helpDetailLabel: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  helpDetail: {
    color: colors.textMuted,
    fontFamily: font.sans,
    fontSize: 13,
    lineHeight: 19,
  },
});
