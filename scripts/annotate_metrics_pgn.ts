/**
 * Annotate a PGN with full app metrics + coach note-weight selection dump.
 *
 * Usage:
 *   node scripts/annotate_metrics_pgn.mjs [path/to/game.pgn]
 *   USER_COLOR=black|white  STOCKFISH_PATH=...  OUT_ALL=...  OUT_JSON=...
 *
 * Writes:
 *   samples/metrics_all.pgn   — headers + per-ply comments
 *   samples/metrics_all.json  — full structured dump (all metric rows + candidates)
 *   optional split heur/eval PGNs when WRITE_SPLIT!=0
 *
 * Note weight parts (metricNoteWeights / pickMetricTip):
 *   metricInputKey+16 metricInputFamily+6 themeHit+14/12/4 openingKeyLock+12
 *   sacrificeTheme+10 errorTacticalFamily+8 deltaCpTactical+4
 *   phaseThemeBagSoft+2 endgamePhase+3 theoreticalEndgame+3
 *   situationLock / tacticalLock / gamePlanLock (soft-key boosts)
 *   accept when weight >= METRIC_TIP_MIN_WEIGHT (4); pool = softKeysForNoteRequest
 */
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "mobile/package.json"));
const { Chess } = require("chess.js") as typeof import("chess.js");

import { analyzeHeuristicGame } from "../mobile/src/engine/heuristicMetricsPass";
import type { HeuristicMetricEvent } from "../mobile/src/engine/heuristicMetricsPass";
import {
  analyzeEvalBucketMetrics,
  mergeEndgameHeuristicWithBucket,
  mergeMiddlegameHeuristicWithBucket,
} from "../mobile/src/engine/evalBucketMetrics";
import {
  createStyleScanSession,
  styleScanConsumeRoot,
  styleScanProcessPly,
  sacrificeOfferAfterMove,
  type StyleScanSession,
} from "../mobile/src/engine/styleMetrics";
import {
  COACH_ANALYZE_DEPTH,
  COACH_ANALYZE_MOVETIME,
  COACH_ANALYZE_MULTIPV,
  COACH_CRITICAL_DEPTH,
  COACH_CRITICAL_MOVETIME,
  COACH_CRITICAL_MULTIPV,
  ENGINE_LABEL,
  GLOBAL_HASH_MB,
  GLOBAL_THREADS,
} from "../mobile/src/engine/analysisConfig";
import { middlegameStartPly } from "../mobile/src/engine/middlegameBounds";
import { openingPhaseEndFullmove } from "../mobile/src/engine/openingPhase";
import type { StudyGame } from "../mobile/src/engine/analyzeMistakes";
import {
  buildCoachGameMetrics,
  enrichMomentsWithPlies,
  ensureFixedOpeningMoments,
  upsertLiveMoment,
  type CoachGameMetrics,
  type CoachCandidateItem,
} from "../mobile/src/engine/gameCoach/coachGameMetrics";
import { isPawnBreakMove } from "../mobile/src/engine/phaseTacticalMetrics";
import {
  METRIC_TIP_MIN_WEIGHT,
  STRUCTURE_THEMES,
  explainAttachMetricTip,
  formatWeightBreakdown,
  rankMetricNoteWeights,
  themesForPly,
  type MetricCoachMark,
  type PhaseName,
} from "../mobile/src/engine/gameCoach/metricNoteWeights";
import {
  buildCoachNoteRequest,
  formatCoachNoteRequest,
  lineComparisonMomentInputs,
  coachRequestMetaInputs,
  durableUnusedStructureThemes,
  boardMetricSnap,
  composePlayedAltLine,
  COACH_NOTE_REQUEST_CONFIG,
  engineLineSansBudget,
  isPraiseMark,
  isFixedCheckpointMoment,
  openingEvalGapAllowsEngineLine,
} from "../mobile/src/engine/gameCoach/coachNoteRequest";
import {
  fenAfterUciPv,
  trimPvToHorizon,
} from "../mobile/src/engine/gameCoach/extendEnginePv";
import {
  classifyEvalDrop,
  userWinProbability,
} from "../mobile/src/engine/winProb";
import {
  detectOpeningFamily,
  resolveOpeningPackKey,
  StructureThemeTracker,
} from "../mobile/src/engine/gameCoach/structureDetect";
import {
  emptyGamePlanState,
  advanceGamePlan,
  formatGamePlanShort,
  markPlanKeysTaught,
} from "../mobile/src/engine/gameCoach/gamePlanState";
import { detectSituations, mergeStickySituations } from "../mobile/src/engine/gameCoach/situationProfiles";
import { PawnStormTracker } from "../mobile/src/engine/gameCoach/tier3Metrics";
import { resolveEcoFamily } from "../mobile/src/engine/ecoFamilies";
import {
  enrichOpeningCoachMoments,
} from "../mobile/src/engine/gameCoach/openingCoachInputs";
import {
  enrichMiddlegameCoachMoments,
  enrichLiveMiddlegamePeerGaps,
} from "../mobile/src/engine/gameCoach/middlegameCoachInputs";
import { enrichMiddlegameStrategicMoments } from "../mobile/src/engine/gameCoach/middlegameStructure";
import { enrichEndgameCoachMoments } from "../mobile/src/engine/gameCoach/endgameContext";
import { defaultBundledPeerContext } from "../mobile/src/engine/gameCoach/openingCoachPeers";
import { formatOpeningLabel } from "../mobile/src/engine/gameCoach/ecoLabels";

const EVAL_CLAMP = 1000;
const MATE_CP_THRESHOLD = 50000;

/** Mirror mobile/src/engine/globalAnalysis.ts candidate gates. */
const OPENING_PLY_SKIP = 12;
const MAX_OPENING_PLY = 20;
const OPENING_MIN_DROP_CP = 100;
const MAX_MOMENTS_PER_GAME = 3;

type SfPosition = {
  cpWhite: number;
  bestUci: string | null;
  /** Full best-line UCI tokens (for bad-move engine horizon). */
  bestPvUci: string[];
};

type MetricTimelineEvent = HeuristicMetricEvent & {
  source: "heuristic" | "style" | "eval" | "candidate" | "coach";
};

function formatEvent(ev: MetricTimelineEvent): string {
  const src = ev.source[0]; // h|s|e|c
  if (ev.kind === "set" || ev.kind === "phase") {
    return `+${src}.${ev.field}=${ev.value}`;
  }
  if (ev.prev == null) return `Δ${src}.${ev.field}=${ev.value}`;
  return `Δ${src}.${ev.field}:${ev.prev}→${ev.value}`;
}

function snapshotStyleCounters(session: StyleScanSession): Record<string, number | boolean | null> {
  return {
    sacrifice_moves: session.sacrificeMoves,
    early_flank_pushes: session.earlyFlankPushes,
    early_trades: session.earlyTrades,
    trades_near_enemy_king: session.tradesNearEnemyKing,
    trades_near_user_king: session.tradesNearUserKing,
    forward_moves: session.forwardMoves,
    backward_moves: session.backwardMoves,
    lateral_moves: session.lateralMoves,
    higher_threats: session.higherThreats,
    threat_escapes: session.threatEscapes,
    brilliant_moves: session.brilliantMoves,
    excellent_moves: session.excellentMoves,
    important_moves: session.importantMoves,
    declined_recaptures: session.declinedRecaptures,
    recapture_chances: session.recaptureChances,
    blunders: session.blunders,
    had_disadvantage: session.hadDisadvantage,
    had_endgame_advantage: session.hadEndgameAdvantage,
    endgame_advantage_start_ply: session.endgameAdvantageStartPly,
    mg_blunders: session.mgBlunders,
    mg_mistakes: session.mgMistakes,
    mg_inaccuracies: session.mgInaccuracies,
    eg_blunders: session.egBlunders,
    eg_mistakes: session.egMistakes,
    eg_piece_trades: session.egPieceTrades,
    eg_beneficial_trades: session.egBeneficialTrades,
    critical_positions: session.criticalPositions,
  };
}

const EARLY_TRADE_FIELDS = new Set([
  "early_trades",
  "trades_near_enemy_king",
  "trades_near_user_king",
]);

function traceStyleMetricEvents(
  game: StudyGame,
  evalsCp: number[],
  historySans: string[]
): MetricTimelineEvent[] {
  const session = createStyleScanSession(game);
  if (!session) return [];
  const out: MetricTimelineEvent[] = [];
  if (evalsCp[0] != null) styleScanConsumeRoot(session, evalsCp[0]);
  out.push({
    source: "style",
    ply: 0,
    kind: "phase",
    field: "initial_position",
    value: true,
  });
  let prev = snapshotStyleCounters(session);
  for (let ply = 0; ply < historySans.length; ply += 1) {
    const before = evalsCp[ply] ?? null;
    const after = evalsCp[ply + 1] ?? null;
    if (!styleScanProcessPly(session, historySans[ply], before, after, ply)) {
      break;
    }
    const next = snapshotStyleCounters(session);
    for (const [field, value] of Object.entries(next)) {
      const p = prev[field];
      if (p === value) continue;
      const kind =
        (typeof p === "boolean" && p === false && value === true) ||
        (typeof p === "number" && (p === 0 || p == null) && typeof value === "number" && value !== 0) ||
        (p == null && value != null)
          ? "set"
          : "change";
      const attrPly0 =
        EARLY_TRADE_FIELDS.has(field) && session.lastEarlyTradePly != null
          ? session.lastEarlyTradePly
          : ply;
      out.push({
        source: "style",
        ply: attrPly0 + 1,
        kind,
        field,
        value: value as string | number | boolean,
        prev: p as string | number | boolean | null,
      });
    }
    prev = next;
  }
  return out;
}

function groupEventsByPly(
  events: MetricTimelineEvent[]
): Map<number, MetricTimelineEvent[]> {
  const map = new Map<number, MetricTimelineEvent[]>();
  for (const ev of events) {
    const list = map.get(ev.ply) || [];
    list.push(ev);
    map.set(ev.ply, list);
  }
  return map;
}

type RankedCandidate = CoachCandidateItem & {
  kind: "opening" | "mistake";
  priority: number;
  mark: MetricCoachMark;
  best_uci: string | null;
};

const SRC =
  process.env.PGN_PATH?.trim() ||
  process.argv[2] ||
  join(ROOT, "game.pgn");
const OUT_DIR = join(ROOT, "samples");
const OUT_ALL =
  process.env.OUT_ALL?.trim() || join(OUT_DIR, "metrics_all.pgn");
const OUT_JSON =
  process.env.OUT_JSON?.trim() || join(OUT_DIR, "metrics_all.json");
const OUT_HEUR = join(OUT_DIR, "metrics_heuristics_only.pgn");
const OUT_EVAL = join(OUT_DIR, "metrics_with_eval.pgn");
const WRITE_SPLIT = process.env.WRITE_SPLIT !== "0";

function clampCp(value: number): number {
  const abs = Math.abs(value);
  if (abs >= MATE_CP_THRESHOLD) {
    return value > 0 ? EVAL_CLAMP + 50 : -(EVAL_CLAMP + 50);
  }
  return Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, value));
}

function toWhiteCp(fen: string, sideToMoveCp: number): number {
  const turn = fen.split(" ")[1];
  return turn === "b" ? -sideToMoveCp : sideToMoveCp;
}

function stripMoveText(pgn: string): string {
  const idx = pgn.search(/\n\n1\./);
  if (idx >= 0) return pgn.slice(0, idx).trim();
  return pgn.split(/\n\n/)[0]?.trim() || "";
}

function headerValue(pgn: string, tag: string): string | null {
  const match = pgn.match(new RegExp(`\\[${tag} "([^"]*)"\\]`));
  return match?.[1] ?? null;
}

function resolveUserColor(raw: string): "white" | "black" {
  const env = process.env.USER_COLOR?.trim().toLowerCase();
  if (env === "black" || env === "white") return env;

  const white = (headerValue(raw, "White") || "").toLowerCase();
  const black = (headerValue(raw, "Black") || "").toLowerCase();
  const link = headerValue(raw, "Link") || "";
  const linkUser = (
    link.match(/[?&]username=([^&]+)/i)?.[1] || ""
  ).toLowerCase();

  if (linkUser) {
    if (black === linkUser || black.includes(linkUser)) return "black";
    if (white === linkUser || white.includes(linkUser)) return "white";
  }

  const needles = ["pedro", "samplewhite", "sampleblack"].filter(Boolean);
  for (const n of needles) {
    const inW = white.includes(n);
    const inB = black.includes(n);
    if (inB && !inW) return "black";
    if (inW && !inB) return "white";
  }
  return "white";
}

function toStudyGame(raw: string, userColor: "white" | "black"): StudyGame {
  const chess = new Chess();
  chess.loadPgn(raw, { strict: false });
  return {
    id: "sample-game",
    created_at: headerValue(raw, "Date") || "",
    user_color: userColor,
    result: headerValue(raw, "Result") || "",
    opening_name: headerValue(raw, "Opening") || undefined,
    opening_eco: headerValue(raw, "ECO") || undefined,
    opponent_name:
      userColor === "white"
        ? headerValue(raw, "Black") || undefined
        : headerValue(raw, "White") || undefined,
    pgn_str: raw,
    moves_str: chess.history().join(" "),
    speed: undefined,
    time_control: headerValue(raw, "TimeControl") || undefined,
    user_rating:
      Number(
        headerValue(raw, userColor === "white" ? "WhiteElo" : "BlackElo") || ""
      ) || undefined,
    opp_rating:
      Number(
        headerValue(raw, userColor === "white" ? "BlackElo" : "WhiteElo") || ""
      ) || undefined,
  };
}

function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "n/a";
  return Number(v).toFixed(digits);
}

function pct(
  num: number | null | undefined,
  den: number | null | undefined,
  digits = 1
): string {
  if (num == null || den == null || !den) return "n/a";
  return fmt((num / den) * 100, digits);
}

function tagEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, "'");
}

function tagList(values: string[], fallback = "none"): string {
  return values.length ? values.map(tagEscape).join(",") : fallback;
}

function flattenHeaders(
  prefix: string,
  obj: Record<string, unknown> | null | undefined
): string[] {
  if (!obj) return [`[${prefix} "null"]`];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) {
      out.push(`[${prefix}_${k} "n/a"]`);
      continue;
    }
    if (typeof v === "boolean") {
      out.push(`[${prefix}_${k} "${v ? "true" : "false"}"]`);
      continue;
    }
    if (typeof v === "number") {
      out.push(`[${prefix}_${k} "${Number.isFinite(v) ? v : "n/a"}"]`);
      continue;
    }
    if (Array.isArray(v)) {
      out.push(`[${prefix}_${k} "${tagList(v.map(String))}"]`);
      continue;
    }
    if (typeof v === "object") {
      const keys = Object.keys(v as object);
      out.push(
        `[${prefix}_${k} "${keys.length ? keys.join(",") : "none"}"]`
      );
      continue;
    }
    out.push(`[${prefix}_${k} "${tagEscape(String(v))}"]`);
  }
  return out;
}

function resolveStockfishBin(): string | null {
  if (process.env.STOCKFISH_PATH?.trim()) {
    return process.env.STOCKFISH_PATH.trim();
  }
  const bundled = join(
    ROOT,
    "bin/stockfish/stockfish-ubuntu-x86-64-avx2"
  );
  try {
    accessSync(bundled, constants.X_OK);
    return bundled;
  } catch {
    /* fall through */
  }
  const which = spawnSync("which", ["stockfish"], { encoding: "utf8" });
  return which.stdout.trim() || null;
}

/**
 * Same engine preset as Games analysis tab / analyzeGame:
 * COACH_ANALYZE_* first pass; COACH_CRITICAL_* on mistake/missed/blunder.
 * Still extend short PVs up to coach horizon for metric diffs.
 */
type SfGoOpts = {
  depth: number;
  multipv: number;
  movetime: number;
  quiet?: boolean;
};

const SF_ANALYZE: SfGoOpts = {
  depth: COACH_ANALYZE_DEPTH,
  multipv: COACH_ANALYZE_MULTIPV,
  movetime: COACH_ANALYZE_MOVETIME,
};

const SF_CRITICAL: SfGoOpts = {
  depth: COACH_CRITICAL_DEPTH,
  multipv: COACH_CRITICAL_MULTIPV,
  movetime: COACH_CRITICAL_MOVETIME,
};

const SF_ANALYZE_HASH = GLOBAL_HASH_MB;
const SF_ANALYZE_THREADS = GLOBAL_THREADS;

function stockfishAnalyzeOnce(
  fens: string[],
  opts?: Partial<SfGoOpts> & { quiet?: boolean }
): SfPosition[] | null {
  const bin = resolveStockfishBin();
  if (!bin) return null;
  const depth = opts?.depth ?? SF_ANALYZE.depth;
  const multipv = opts?.multipv ?? SF_ANALYZE.multipv;
  const movetime = opts?.movetime ?? SF_ANALYZE.movetime;
  if (!opts?.quiet) {
    console.log(
      "Using stockfish:",
      bin,
      `depth=${depth} multipv=${multipv} movetime=${movetime} (${ENGINE_LABEL})`
    );
  }
  const input = [
    "uci",
    "isready",
    `setoption name Hash value ${SF_ANALYZE_HASH}`,
    `setoption name Threads value ${SF_ANALYZE_THREADS}`,
    `setoption name MultiPV value ${multipv}`,
    ...fens.flatMap((fen) => [
      "ucinewgame",
      `position fen ${fen}`,
      `go depth ${depth} movetime ${movetime}`,
    ]),
    "quit",
  ].join("\n");
  const res = spawnSync(bin, [], {
    input,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!res.stdout) return null;
  const lines = res.stdout.split(/\r?\n/);
  const out: SfPosition[] = [];
  let lastCp = 0;
  let bestUci: string | null = null;
  let multipv1Uci: string | null = null;
  let multipv1Pv: string[] = [];
  let bestDepth = -1;
  for (const line of lines) {
    const mpv = line.match(/\bmultipv (\d+)\b/);
    const depthM = line.match(/\bdepth (\d+)\b/);
    const score = line.match(/score cp (-?\d+)/);
    const mate = line.match(/score mate (-?\d+)/);
    const pvMatch = line.match(/\bpv (.+)$/);
    const mpvN = mpv ? Number(mpv[1]) : null;
    const depthN = depthM ? Number(depthM[1]) : -1;
    if (mpvN == null || mpvN === 1) {
      if (score) lastCp = Number(score[1]);
      if (mate) lastCp = Number(mate[1]) > 0 ? 10000 : -10000;
      if (pvMatch) {
        const toks = pvMatch[1]
          .trim()
          .split(/\s+/)
          .filter((t) => /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(t));
        if (toks.length) {
          // Prefer deepest search; at same depth keep the longest PV.
          if (
            depthN > bestDepth ||
            (depthN === bestDepth && toks.length > multipv1Pv.length) ||
            (depthN < 0 && toks.length > multipv1Pv.length)
          ) {
            if (depthN >= 0) bestDepth = depthN;
            multipv1Pv = toks;
            multipv1Uci = toks[0] || null;
          } else if (toks.length > multipv1Pv.length) {
            multipv1Pv = toks;
            multipv1Uci = toks[0] || null;
          }
        }
      }
    }
    if (line.startsWith("bestmove")) {
      const bm = line.match(/^bestmove (\S+)/);
      bestUci =
        multipv1Uci || (bm?.[1] !== "(none)" ? bm?.[1] || null : null);
      out.push({
        cpWhite: clampCp(lastCp),
        bestUci,
        bestPvUci: multipv1Pv.length
          ? multipv1Pv
          : bestUci
            ? [bestUci]
            : [],
      });
      lastCp = 0;
      bestUci = null;
      multipv1Uci = null;
      multipv1Pv = [];
      bestDepth = -1;
    }
  }
  if (out.length !== fens.length) return null;
  return out.map((row, i) => ({
    cpWhite: toWhiteCp(fens[i], row.cpWhite),
    bestUci: row.bestUci,
    bestPvUci: row.bestPvUci,
  }));
}

/**
 * If SF returned a short PV (< budget), chain-search from the leaf until
 * we have horizon+1 UCI plies (extra ply used when leaf has hangings).
 */
function extendShortPvs(
  fens: string[],
  positions: SfPosition[],
  horizon: number,
  go: SfGoOpts = SF_ANALYZE
): SfPosition[] {
  const out = positions.map((p) => ({
    ...p,
    bestPvUci: [...(p.bestPvUci || [])],
  }));
  for (let round = 0; round < 4; round += 1) {
    const jobs: { index: number; leaf: string }[] = [];
    for (let i = 0; i < out.length; i += 1) {
      if (out[i]!.bestPvUci.length >= horizon) continue;
      const leaf = fenAfterUciPv(fens[i]!, out[i]!.bestPvUci);
      if (!leaf) continue;
      jobs.push({ index: i, leaf });
    }
    if (!jobs.length) break;
    const ext = stockfishAnalyzeOnce(jobs.map((j) => j.leaf), {
      ...go,
      quiet: true,
    });
    if (!ext) break;
    for (let j = 0; j < jobs.length; j += 1) {
      const job = jobs[j]!;
      const add = ext[j]?.bestPvUci || [];
      if (!add.length) continue;
      const cur = out[job.index]!;
      for (const u of add) {
        if (cur.bestPvUci.length >= horizon) break;
        cur.bestPvUci.push(u);
      }
    }
  }
  // After base horizon, drop the spare ply unless leaf still has hangings.
  for (let i = 0; i < out.length; i += 1) {
    const row = out[i]!;
    row.bestPvUci = trimPvToHorizon(fens[i]!, row.bestPvUci, horizon);
  }
  return out;
}

function stockfishAnalyze(
  fens: string[],
  go: SfGoOpts = SF_ANALYZE
): SfPosition[] | null {
  const once = stockfishAnalyzeOnce(fens, go);
  if (!once) return null;
  const budget = engineLineSansBudget();
  const short = once.filter((p) => p.bestPvUci.length < budget).length;
  if (short) {
    console.log(
      `Extending ${short}/${once.length} short PVs to budget ${budget} (horizon ${COACH_NOTE_REQUEST_CONFIG.engineLineHorizonMoves}+hanging extra)`
    );
  }
  return extendShortPvs(fens, once, budget, go);
}

/**
 * Deepen fenBefore (+ fenAfter) at COACH_CRITICAL_* for metric coach calls:
 * mistake/missed/blunder, fixed checkpoints, praise marks, and optional extra plies.
 */
function deepenCriticalPositions(args: {
  fens: string[];
  positions: SfPosition[];
  historySans: string[];
  userIsWhite: boolean;
  /** Extra 0-based before-fen indices (fixed checkpoints / pawn-break plies). */
  extraBeforePly0?: number[];
}): SfPosition[] {
  const { fens, positions, historySans, userIsWhite } = args;
  const out = positions.map((p) => ({
    ...p,
    bestPvUci: [...(p.bestPvUci || [])],
  }));
  const criticalFenIdx = new Set<number>();
  let pendingOppKind: "mistake" | "blunder" | null = null;
  let pendingOppWp: number | null = null;

  const addPair = (ply0: number) => {
    if (ply0 < 0 || ply0 >= historySans.length) return;
    criticalFenIdx.add(ply0);
    if (ply0 + 1 < fens.length) criticalFenIdx.add(ply0 + 1);
  };

  for (const ply0 of args.extraBeforePly0 || []) addPair(ply0);

  for (let ply0 = 0; ply0 < historySans.length; ply0 += 1) {
    const fenBefore = fens[ply0] || "";
    const san = historySans[ply0] || "";
    const isUser = userIsWhite ? ply0 % 2 === 0 : ply0 % 2 === 1;
    const before = out[ply0]?.cpWhite ?? 0;
    const after = out[ply0 + 1]?.cpWhite ?? before;
    const bestUci = out[ply0]?.bestUci || null;
    const bestSan = uciToSan(fenBefore, bestUci);
    const playedBest = Boolean(bestSan && bestSan === san);
    const wpBefore = userWinProbability(before, userIsWhite);
    const wpAfter = userWinProbability(after, userIsWhite);
    const wpDrop = Math.max(0, wpBefore - wpAfter);

    if (!isUser) {
      const gift = oppGiftKind(wpBefore, wpAfter);
      pendingOppKind = gift;
      pendingOppWp = gift ? wpAfter : null;
      continue;
    }

    let missedOpportunity = false;
    if (pendingOppKind && pendingOppWp != null) {
      missedOpportunity = annotateMissedOpportunity({
        wpBefore,
        wpAfter,
        pendingPeakWp: pendingOppWp,
        playedBest,
      });
      pendingOppKind = null;
      pendingOppWp = null;
    } else if (pendingOppKind) {
      pendingOppKind = null;
      pendingOppWp = null;
    }

    const mark = annotateCoachMark({
      playedBest,
      wpDrop,
      wpBefore,
      wpAfter,
      fenBefore,
      playedSan: san,
      userIsWhite,
      missedOpportunity,
    });

    if (
      (!playedBest &&
        (mark === "blunder" || mark === "mistake" || mark === "missed")) ||
      mark === "brilliant" ||
      mark === "important"
    ) {
      addPair(ply0);
    }
  }

  if (!criticalFenIdx.size) return out;

  const idxList = [...criticalFenIdx].sort((a, b) => a - b);
  const deepFens = idxList.map((i) => fens[i]!);
  console.log(
    `Deepening ${idxList.length} coach-call FENs (mistakes/fixed/praise): depth=${SF_CRITICAL.depth} multipv=${SF_CRITICAL.multipv} movetime=${SF_CRITICAL.movetime}`
  );
  const deep = stockfishAnalyzeOnce(deepFens, { ...SF_CRITICAL, quiet: true });
  if (!deep) return out;
  for (let j = 0; j < idxList.length; j += 1) {
    out[idxList[j]!] = deep[j]!;
  }
  const budget = engineLineSansBudget();
  const extended = extendShortPvs(deepFens, deep, budget, SF_CRITICAL);
  for (let j = 0; j < idxList.length; j += 1) {
    out[idxList[j]!] = extended[j]!;
  }
  return out;
}

function collectFens(raw: string): string[] {
  const board = new Chess();
  board.loadPgn(raw, { strict: false });
  const history = board.history();
  board.reset();
  const fens = [board.fen()];
  for (const san of history) {
    board.move(san);
    fens.push(board.fen());
  }
  return fens;
}

function uciToSan(fen: string, uci: string | null): string | null {
  if (!uci || uci.length < 4) return null;
  try {
    const board = new Chess(fen);
    const move = board.move({
      from: uci.slice(0, 2) as `${string}${string}`,
      to: uci.slice(2, 4) as `${string}${string}`,
      promotion: (uci[4] as "q" | "r" | "b" | "n" | undefined) || undefined,
    });
    return move?.san || null;
  } catch {
    return null;
  }
}

function playedAltLineFromPositions(args: {
  fenBefore: string;
  fenAfter: string;
  playedSan: string;
  positions: SfPosition[];
  ply0: number;
}): { playedLineSans: string[]; continuationSans: string[] } {
  const continuationSans = pvUciToSan(
    args.fenAfter,
    args.positions[args.ply0 + 1]?.bestPvUci || [],
    Math.max(1, engineLineSansBudget() - 1)
  );
  return {
    continuationSans,
    playedLineSans: composePlayedAltLine({
      playedSan: args.playedSan,
      continuationSans,
    }),
  };
}

function pvUciToSan(
  fen: string,
  pvUci: string[],
  maxMoves = engineLineSansBudget()
): string[] {
  if (!pvUci.length) return [];
  try {
    const board = new Chess(fen);
    const out: string[] = [];
    for (const uci of pvUci.slice(0, maxMoves)) {
      if (!uci || uci.length < 4) break;
      try {
        const move = board.move({
          from: uci.slice(0, 2) as `${string}${string}`,
          to: uci.slice(2, 4) as `${string}${string}`,
          promotion: (uci[4] as "q" | "r" | "b" | "n" | undefined) || undefined,
        });
        if (!move) break;
        out.push(move.san);
      } catch {
        break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

function extractClkTags(raw: string): string[] {
  return [...raw.matchAll(/\[%clk\s+([^\]]+)\]/gi)].map((m) => m[1].trim());
}

function markFromWpDrop(wpDrop: number): MetricCoachMark | null {
  if (wpDrop >= 0.2) return "blunder";
  if (wpDrop >= 0.1) return "mistake";
  if (wpDrop >= 0.05) return "inaccuracy";
  if (wpDrop >= 0.02) return "good";
  if (wpDrop >= 0) return "excellent";
  return null;
}

/** Node-safe praise/error band (no RN coachMarks GIF imports). */
function annotateCoachMark(args: {
  playedBest: boolean;
  wpDrop: number;
  wpBefore?: number;
  wpAfter?: number;
  fenBefore?: string;
  playedSan?: string;
  userIsWhite?: boolean;
  /** Prior opp mistake/blunder → missed opportunity, not mistake. */
  missedOpportunity?: boolean;
}): MetricCoachMark | null {
  // Best move is never miss/error — even right after an opp gift.
  if (args.playedBest) {
    if (
      args.fenBefore &&
      args.playedSan &&
      args.wpBefore != null &&
      args.wpAfter != null &&
      args.userIsWhite != null &&
      args.wpBefore < 0.85 &&
      args.wpAfter >= 0.2 &&
      !(args.wpBefore < 0.25 && args.wpAfter < 0.45)
    ) {
      try {
        const board = new Chess(args.fenBefore);
        const color = args.userIsWhite ? "w" : "b";
        const move = board.move(args.playedSan);
        if (move && sacrificeOfferAfterMove(board, move, color) >= 2) {
          return "brilliant";
        }
      } catch {
        /* ignore */
      }
    }
    return "best";
  }
  if (args.missedOpportunity) return "missed";
  if (
    args.fenBefore &&
    args.playedSan &&
    args.wpBefore != null &&
    args.wpAfter != null &&
    args.userIsWhite != null &&
    args.wpBefore < 0.85 &&
    args.wpAfter >= 0.2 &&
    !(args.wpBefore < 0.25 && args.wpAfter < 0.45) &&
    args.wpDrop < 0.02
  ) {
    try {
      const board = new Chess(args.fenBefore);
      const color = args.userIsWhite ? "w" : "b";
      const move = board.move(args.playedSan);
      if (move && sacrificeOfferAfterMove(board, move, color) >= 2) {
        return "brilliant";
      }
    } catch {
      /* ignore */
    }
  }
  return markFromWpDrop(args.wpDrop);
}

function oppGiftKind(
  wpBefore: number,
  wpAfter: number
): "mistake" | "blunder" | null {
  const gift = wpAfter - wpBefore;
  if (gift >= 0.2) return "blunder";
  if (gift >= 0.1) return "mistake";
  return null;
}

function annotateMissedOpportunity(args: {
  wpBefore: number;
  wpAfter: number;
  pendingPeakWp: number;
  playedBest?: boolean;
}): boolean {
  if (args.playedBest) return false;
  const drop = Math.max(0, args.wpBefore - args.wpAfter);
  // Eval drop after opp gift → missed opportunity (not raw mistake).
  if (drop >= 0.05) return true;
  return Math.round((args.pendingPeakWp - args.wpAfter) * 100) >= 5;
}

function mistakePriority(
  userBefore: number,
  userAfter: number,
  drop: number
): number {
  let priority = drop;
  if (userBefore >= 50 && userAfter <= -50) {
    priority += 3000;
    priority += Math.min(userBefore, 500);
    priority += Math.min(-userAfter, 500);
  } else if (userBefore >= 0) {
    priority += 800;
  }
  priority += Math.max(0, 500 - Math.abs(userBefore)) * 1.2;
  priority -= Math.max(0, -userBefore - 300) * 1.5;
  return priority;
}

function buildVaultCandidates(args: {
  evalsCp: number[];
  fens: string[];
  historySans: string[];
  positions: SfPosition[];
  userIsWhite: boolean;
}): { opening: RankedCandidate[]; mistake: RankedCandidate[] } {
  const pool: RankedCandidate[] = [];
  for (let ply0 = 0; ply0 < args.evalsCp.length - 1; ply0 += 1) {
    const isUser = args.userIsWhite ? ply0 % 2 === 0 : ply0 % 2 === 1;
    if (!isUser) continue;
    const before = args.evalsCp[ply0];
    const after = args.evalsCp[ply0 + 1];
    const wpBefore = userWinProbability(before, args.userIsWhite);
    const wpAfter = userWinProbability(after, args.userIsWhite);
    const wpDrop = Math.max(0, wpBefore - wpAfter);
    const mark = markFromWpDrop(wpDrop);
    if (
      mark !== "inaccuracy" &&
      mark !== "mistake" &&
      mark !== "blunder" &&
      mark !== "missed"
    ) {
      continue;
    }
    const userBefore = args.userIsWhite ? before : -before;
    const userAfter = args.userIsWhite ? after : -after;
    const dropCp = Math.max(0, Math.round(userBefore - userAfter));
    if (dropCp < OPENING_MIN_DROP_CP) continue;
    const fen = args.fens[ply0] || "";
    const bestUci = args.positions[ply0]?.bestUci || null;
    const bestSan = uciToSan(fen, bestUci);
    const playedSan = args.historySans[ply0] || "";
    // Skip non-deviations and terminal eval explosions (mate clamp flips).
    if (bestSan && playedSan && bestSan === playedSan) continue;
    if (Math.abs(before) >= 9000 || Math.abs(after) >= 9000) continue;
    if (dropCp >= 800) continue;
    pool.push({
      kind: ply0 < MAX_OPENING_PLY ? "opening" : "mistake",
      ply: ply0,
      move_number: Math.floor(ply0 / 2) + 1,
      fen,
      played_san: playedSan,
      best_san: bestSan,
      best_uci: bestUci,
      eval_before_cp: Math.round(before * 10) / 10,
      eval_after_cp: Math.round(after * 10) / 10,
      eval_drop_cp: Math.round(dropCp * 10) / 10,
      priority: mistakePriority(userBefore, userAfter, dropCp),
      mark,
    });
  }

  pool.sort((a, b) => b.priority - a.priority || b.eval_drop_cp - a.eval_drop_cp);

  const opening: RankedCandidate[] = [];
  const mistake: RankedCandidate[] = [];
  for (const item of pool) {
    if (
      item.ply < MAX_OPENING_PLY &&
      opening.length < MAX_MOMENTS_PER_GAME
    ) {
      opening.push({ ...item, kind: "opening" });
    }
    if (
      item.ply >= OPENING_PLY_SKIP &&
      mistake.length < MAX_MOMENTS_PER_GAME
    ) {
      mistake.push({ ...item, kind: "mistake" });
    }
  }
  return { opening, mistake };
}

function phaseForPly(
  ply0: number,
  metrics: Awaited<ReturnType<typeof analyzeHeuristicGame>>
): PhaseName {
  const o = metrics.opening;
  const m = metrics.middlegame;
  const e = metrics.endgame;
  const phaseEnd =
    o?.phase_end_fullmove ??
    openingPhaseEndFullmove(o?.opening_castle_fullmove ?? null);
  const mgPly = m?.middlegame_start_ply ?? middlegameStartPly(phaseEnd);
  const egPly = e?.endgame_start_ply;
  if (egPly != null && ply0 >= egPly) return "endgame";
  if (m?.reached_middlegame && ply0 >= mgPly) return "middlegame";
  return "opening";
}

function phaseComment(
  ply: number,
  metrics: Awaited<ReturnType<typeof analyzeHeuristicGame>>
): string | null {
  const o = metrics.opening;
  const m = metrics.middlegame;
  const e = metrics.endgame;
  const phaseEnd =
    o?.phase_end_fullmove ??
    openingPhaseEndFullmove(o?.opening_castle_fullmove ?? null);
  const mgPly = m?.middlegame_start_ply ?? middlegameStartPly(phaseEnd);
  const egPly = e?.endgame_start_ply;
  if (m?.reached_middlegame && ply === mgPly) {
    return `middlegame_start ply=${mgPly} (fullmove ${Math.floor(mgPly / 2) + 1})`;
  }
  if (egPly != null && ply === egPly) {
    return `endgame_start ply=${egPly} (fullmove ${Math.floor(egPly / 2) + 1}) nonPawn<=7`;
  }
  return null;
}

function candidateHeaders(cands: {
  opening: RankedCandidate[];
  mistake: RankedCandidate[];
}): string[] {
  const fmtOne = (c: RankedCandidate) =>
    `p${c.ply + 1}:${c.mark}:${c.eval_drop_cp}cp:pri=${Math.round(c.priority)}:played=${c.played_san}:best=${c.best_san || c.best_uci || "?"}`;
  return [
    `[CandidateRules "userPly;mark in {inaccuracy,mistake,blunder,missed};dropCp>=${OPENING_MIN_DROP_CP};openingPly<${MAX_OPENING_PLY} max${MAX_MOMENTS_PER_GAME};mistakePly>=${OPENING_PLY_SKIP} max${MAX_MOMENTS_PER_GAME};sort=priority"]`,
    `[OpeningCandidatesCount "${cands.opening.length}"]`,
    `[OpeningCandidates "${tagList(cands.opening.map(fmtOne))}"]`,
    `[MistakeCandidatesCount "${cands.mistake.length}"]`,
    `[MistakeCandidates "${tagList(cands.mistake.map(fmtOne))}"]`,
  ];
}

function coachHeaders(
  coach: CoachGameMetrics,
  openingKeyId: string | null,
  openingTags: string[],
  ecoFamily: string | null
): string[] {
  const moments = Object.values(coach.momentsByPly)
    .sort((a, b) => a.ply - b.ply)
    .map((m) =>
      m.structuralKind
        ? `p${m.ply}:structural:${m.structuralKind}`
        : `p${m.ply}:${m.severity || "?"}:${m.dropCp}cp${m.candidateKind ? `:${m.candidateKind}` : ""}`
    );
  return [
    `[CoachAvailable "${coach.available ? "true" : "false"}"]`,
    `[CoachOpeningKey "${openingKeyId || "none"}"]`,
    `[CoachOpeningTags "${tagList(openingTags)}"]`,
    `[CoachEcoFamily "${ecoFamily || "none"}"]`,
    `[CoachThemesOpening "${tagList(coach.themesByPhase.opening)}"]`,
    `[CoachThemesMiddlegame "${tagList(coach.themesByPhase.middlegame)}"]`,
    `[CoachThemesEndgame "${tagList(coach.themesByPhase.endgame)}"]`,
    `[CoachGlobalThemes "${tagList(coach.globalThemes)}"]`,
    `[CoachMoments "${tagList(moments)}"]`,
    `[CoachStrengths "${tagList(coach.strengths)}"]`,
    `[CoachWeaknesses "${tagList(coach.weaknesses)}"]`,
    `[CoachNoteWeightRules "metricInputKey+16;metricInputFamily+6;themeHit+14/12/4;openingKeyLock+12;minAccept=${METRIC_TIP_MIN_WEIGHT}"]`,
    `[CoachNoteAttachRules "requestKinds=${COACH_NOTE_REQUEST_CONFIG.alwaysAttachKinds.join(",")};engineHorizon=${engineLineSansBudget()};fixed=${COACH_NOTE_REQUEST_CONFIG.fixedCheckpoints.map((c) => c.structuralKind).join(",")};live=${COACH_NOTE_REQUEST_CONFIG.liveStructuralKinds.join(",")};openingAlwaysAttach=${COACH_NOTE_REQUEST_CONFIG.openingAlwaysAttach}"]`,
    `[CoachNoteSelectRules "pool soft-keys from metricNoteKeys(softKeysForNoteRequest) only; pick highest weight>=${METRIC_TIP_MIN_WEIGHT}; didactic mid-specificity"]`,
    `[CoachNoteBadMovePayload "playedMetricDelta+playedLine+engineLine+engineVsPlayed(horizon=${engineLineSansBudget()})"]`,
  ];
}

function buildAllMoveText(args: {
  raw: string;
  metrics: Awaited<ReturnType<typeof analyzeHeuristicGame>>;
  coach: CoachGameMetrics;
  evalsPawns: Array<number | null>;
  evalsCp: number[];
  positions: SfPosition[];
  fens: string[];
  userIsWhite: boolean;
  openingKeyId: string | null;
  eco: string | null;
  opening: string | null;
  openingCands: RankedCandidate[];
  mistakeCands: RankedCandidate[];
  eventsByPly: Map<number, MetricTimelineEvent[]>;
}): string {
  const chess = new Chess();
  chess.loadPgn(args.raw, { strict: false });
  const history = chess.history({ verbose: true });
  const clks = extractClkTags(args.raw);
  const structureThemeUsed = new Set<string>();
  const structureTracker = new StructureThemeTracker();
  const pawnStormTracker = new PawnStormTracker(4);
  let gamePlan = emptyGamePlanState(args.openingKeyId);
  let stickySituations: import("../mobile/src/engine/gameCoach/situationProfiles").DetectedSituation[] =
    [];
  const candByPly = new Map<number, RankedCandidate>();
  for (const c of [...args.openingCands, ...args.mistakeCands]) {
    const prev = candByPly.get(c.ply);
    if (!prev || c.priority > prev.priority) candByPly.set(c.ply, c);
  }
  const parts: string[] = [];
  let pendingOppKind: "mistake" | "blunder" | null = null;
  let pendingOppWp: number | null = null;

  for (let ply = 0; ply < history.length; ply += 1) {
    const m = history[ply];
    const ply1 = ply + 1;
    const isUser = args.userIsWhite ? ply % 2 === 0 : ply % 2 === 1;
    const bits: string[] = [];
    if (clks[ply]) bits.push(`[%clk ${clks[ply]}]`);
    const pawns = args.evalsPawns[ply + 1];
    if (pawns != null) bits.push(`[%eval ${pawns.toFixed(2)}]`);
    const phaseBoundary = phaseComment(ply, args.metrics);
    if (phaseBoundary) bits.push(phaseBoundary);

    const plyEvents = args.eventsByPly.get(ply1) || [];
    if (plyEvents.length) {
      // Prefer inserts/phase first, then changes; cap noise.
      const ranked = [...plyEvents].sort((a, b) => {
        const rank = (k: string) =>
          k === "phase" ? 0 : k === "set" ? 1 : k === "change" ? 2 : 3;
        return rank(a.kind) - rank(b.kind);
      });
      bits.push(`metricΔ[${ranked.slice(0, 12).map(formatEvent).join(" ")}]`);
    }

    const phase = phaseForPly(ply, args.metrics);
    const before = args.evalsCp[ply] ?? 0;
    const after = args.evalsCp[ply + 1] ?? before;
    const wpBefore = userWinProbability(before, args.userIsWhite);
    const wpAfter = userWinProbability(after, args.userIsWhite);
    const wpDrop = Math.max(0, wpBefore - wpAfter);
    const userBefore = args.userIsWhite ? before : -before;
    const userAfter = args.userIsWhite ? after : -after;
    const deltaCp = Math.max(0, Math.round(userBefore - userAfter));
    const dropKind = classifyEvalDrop(wpBefore, wpAfter);
    const bestUci = args.positions[ply]?.bestUci || null;
    const bestSan = uciToSan(args.fens[ply] || "", bestUci);
    const playedSan = history[ply]?.san || "";

    const playedBest = Boolean(bestSan && bestSan === playedSan);
    let missedOpportunity = false;
    let missedAfterOpp: "mistake" | "blunder" | null = null;
    if (isUser && pendingOppKind && pendingOppWp != null) {
      missedOpportunity = annotateMissedOpportunity({
        wpBefore,
        wpAfter,
        pendingPeakWp: pendingOppWp,
        playedBest,
      });
      if (missedOpportunity) missedAfterOpp = pendingOppKind;
      pendingOppKind = null;
      pendingOppWp = null;
    } else if (isUser && pendingOppKind) {
      pendingOppKind = null;
      pendingOppWp = null;
    }

    const markRaw = isUser
      ? annotateCoachMark({
          playedBest,
          wpDrop,
          wpBefore,
          wpAfter,
          fenBefore: args.fens[ply] || "",
          playedSan,
          userIsWhite: args.userIsWhite,
          missedOpportunity,
        })
      : null;
    const isTerminalPly =
      ply >= history.length - 1 ||
      Math.abs(before) >= 9000 ||
      Math.abs(after) >= 9000;
    const wpSwing = Math.abs(wpAfter - wpBefore);
    const errorMarks = new Set(["blunder", "mistake", "inaccuracy", "missed"]);
    const mark =
      markRaw &&
      errorMarks.has(markRaw) &&
      (isTerminalPly || wpSwing < 0.02)
        ? null
        : markRaw;
    const moment = args.coach.momentsByPly[ply1] || null;
    const cand = candByPly.get(ply) || null;

    const pushMomentBits = () => {
      if (!moment) return;
      if (moment.structuralKind) {
        const inputBits = moment.inputs
          ? Object.entries(moment.inputs)
              .filter(([, v]) => v != null && v !== "")
              .slice(0, 8)
              .map(([k, v]) => `${k}=${v}`)
              .join(",")
          : "";
        bits.push(
          `moment=structural:${moment.structuralKind}${inputBits ? `{${inputBits}}` : ""}`
        );
      } else {
        bits.push(
          `moment=${moment.severity}:${moment.dropCp}cp${moment.candidateKind ? `:${moment.candidateKind}` : ""}`
        );
      }
    };

    if (!isUser) {
      structureTracker.update(args.fens[ply] || "", args.fens[ply + 1] || "");
      bits.push(`phase=${phase}`);
      if (bestSan) bits.push(`best=${bestSan}`);
      pushMomentBits();
      const gift = oppGiftKind(wpBefore, wpAfter);
      pendingOppKind = gift;
      pendingOppWp = gift ? wpAfter : null;
    }

    if (isUser) {
      const structure = structureTracker.update(
        args.fens[ply] || "",
        args.fens[ply + 1] || ""
      );
      let stormTempo = 0;
      try {
        const afterBoard = new Chess(args.fens[ply + 1] || "");
        stormTempo = pawnStormTracker.update(
          afterBoard,
          args.userIsWhite ? "w" : "b"
        );
      } catch {
        stormTempo = 0;
      }
      const phaseThemes = args.coach.themesByPhase[phase] || [];
      const liveSituations = detectSituations({
        fen: args.fens[ply + 1] || args.fens[ply] || "",
        phase,
        userColor: args.userIsWhite ? "white" : "black",
        structureThemes: structure,
        pawnStormTempo: stormTempo,
      });
      stickySituations = mergeStickySituations(
        stickySituations,
        liveSituations
      );
      const planSituations = stickySituations;
      const unusedStructure = durableUnusedStructureThemes({
        windowedStructure: structure,
        situations: planSituations,
        structureThemeUsed,
        phaseThemesFallback: phaseThemes,
      });
      gamePlan = advanceGamePlan(gamePlan, {
        situations: planSituations,
        structureThemes: structure,
        phase,
      });
      const noteRequest = buildCoachNoteRequest({
        ply: ply1,
        phase,
        mark,
        moment,
        deltaCp,
        fenBefore: args.fens[ply] || "",
        fenAfter: args.fens[ply + 1] || "",
        bestPvSan: pvUciToSan(
          args.fens[ply] || "",
          args.positions[ply]?.bestPvUci || [],
          engineLineSansBudget()
        ),
        ...(() => {
          const alt = playedAltLineFromPositions({
            fenBefore: args.fens[ply] || "",
            fenAfter: args.fens[ply + 1] || "",
            playedSan,
            positions: args.positions,
            ply0: ply,
          });
          return {
            playedLineSans: alt.playedLineSans,
            playedSan,
            playedContinuationSans: alt.continuationSans,
          };
        })(),
        userColor: args.userIsWhite ? "white" : "black",
        evalBeforeCp: before,
        evalAfterCp: after,
        unusedStructureThemes: unusedStructure,
        structureThemes: structure,
        pawnStormTempo: stormTempo,
        situations: planSituations,
      });
      if (noteRequest && moment) {
        const lineInputs = lineComparisonMomentInputs(noteRequest);
        const metaInputs = coachRequestMetaInputs(noteRequest);
        if (
          Object.keys(lineInputs).length ||
          Object.keys(metaInputs).length ||
          bestSan
        ) {
          moment.inputs = {
            ...(moment.inputs || {}),
            ...lineInputs,
            ...metaInputs,
            game_plan: formatGamePlanShort(gamePlan) || null,
          };
          if (!moment.bestSan && bestSan) {
            moment.bestSan = bestSan;
          }
          if (!moment.playedSan && playedSan) moment.playedSan = playedSan;
          args.coach.momentsByPly[ply1] = moment;
        }
      } else if (moment && bestSan && !moment.bestSan) {
        moment.bestSan = bestSan;
        if (!moment.playedSan && playedSan) moment.playedSan = playedSan;
        args.coach.momentsByPly[ply1] = moment;
      }
      const attachInfo = explainAttachMetricTip({
        phase,
        moment,
        mark,
        deltaCp,
        phaseThemes,
        structureThemeUsed,
        request: noteRequest,
      });
      const themes = themesForPly({
        metrics: args.coach,
        phase,
        moment,
        deltaCp,
        request: noteRequest,
      });

      bits.push(`phase=${phase}`);
      if (mark) bits.push(`mark=${mark}`);
      if (missedAfterOpp) bits.push(`missedAfterOpp=${missedAfterOpp}`);
      if (dropKind && !(isTerminalPly || wpSwing < 0.02)) {
        bits.push(`wpDrop=${dropKind}`);
      }
      if (deltaCp > 0 && !(isTerminalPly && deltaCp >= 300)) {
        bits.push(`deltaCp=${deltaCp}`);
      }
      if (bestSan) bits.push(`best=${bestSan}`);
      if (noteRequest) {
        bits.push(`noteRequest=${formatCoachNoteRequest(noteRequest)}`);
      }
      const planShort = formatGamePlanShort(gamePlan);
      if (planShort) bits.push(`gamePlan=${planShort}`);
      pushMomentBits();
      if (cand) {
        bits.push(
          `candidate=${cand.kind}:pri=${Math.round(cand.priority)}:drop=${cand.eval_drop_cp}:best=${cand.best_san || "?"}`
        );
      }

      bits.push(
        `noteAttach=${attachInfo.attach ? "yes" : "no"}` +
          (attachInfo.reasons.length
            ? `(${attachInfo.reasons.join("|")})`
            : "(noRule)")
      );
      if (themes.length) bits.push(`themes=${themes.slice(0, 10).join(",")}`);

      if (attachInfo.attach) {
        const errorNow =
          mark === "blunder" ||
          mark === "mistake" ||
          mark === "missed";
        const rankedAll = rankMetricNoteWeights({
          phase,
          themes,
          mark,
          deltaCp,
          moment,
          openingKeyId: args.openingKeyId,
          eco: args.eco,
          opening: args.opening,
          limit: 12,
          request: noteRequest,
          gamePlan,
        });
        const ranked = rankedAll.filter((row) => {
          const tail = row.keyId.split(".").pop() || "";
          if (!STRUCTURE_THEMES.has(tail)) return true;
          if (!structureThemeUsed.has(tail)) return true;
          return Boolean(moment) || errorNow || Boolean(noteRequest?.kind === "fixed_checkpoint");
        }).slice(0, 6);
        if (ranked.length) {
          bits.push(
            `noteCalc ${ranked
              .map((r, i) => `#${i + 1}:${formatWeightBreakdown(r)}`)
              .join(" ")}`
          );
          const selected = ranked[0]!;
          bits.push(
            `notePick selected=${selected.keyId} score=${selected.weight} rule=maxWeight>=${METRIC_TIP_MIN_WEIGHT};structureOnceUnlessMomentError parts=${selected.parts
              .filter((p) => p.delta)
              .map((p) => `${p.label}+${p.delta}`)
              .join(",")}`
          );
          if (ranked.length > 1) {
            bits.push(
              `noteAlt ${ranked
                .slice(1)
                .map((r) => `${r.keyId}=${r.weight}`)
                .join(",")}`
            );
          }
          const skippedStruct = rankedAll
            .filter((r) => {
              const tail = r.keyId.split(".").pop() || "";
              return (
                STRUCTURE_THEMES.has(tail) &&
                structureThemeUsed.has(tail) &&
                !moment &&
                !errorNow
              );
            })
            .slice(0, 3)
            .map((r) => r.keyId);
          if (skippedStruct.length) {
            bits.push(`noteSkip structureUsed=${skippedStruct.join(",")}`);
          }
          const tail = selected.keyId.split(".").pop() || "";
          if (STRUCTURE_THEMES.has(tail)) structureThemeUsed.add(tail);
          gamePlan = markPlanKeysTaught(gamePlan, [selected.keyId]);
          if (moment) {
            moment.inputs = {
              ...(moment.inputs || {}),
              key_id: selected.keyId,
              game_plan: formatGamePlanShort(gamePlan) || null,
            };
            args.coach.momentsByPly[ply1] = moment;
          }
        } else {
          bits.push(
            `notePick selected=none score=0 rule=noKeyReachMin${METRIC_TIP_MIN_WEIGHT} fallback=metricTemplateInApp`
          );
        }
      } else {
        bits.push("notePick selected=skip rule=attach=false");
      }
    }

    if (ply === history.length - 1) {
      const o = args.metrics.opening;
      const mid = args.metrics.middlegame;
      const e = args.metrics.endgame;
      bits.push(
        `metrics summary: user=${args.userIsWhite ? "white" : "black"} castle=${o?.opening_castle_fullmove ?? "none"} phaseEnd=${o?.phase_end_fullmove} mgPly=${mid?.middlegame_start_ply ?? "-"} egPly=${e?.endgame_start_ply ?? "-"} openingKey=${args.openingKeyId || "none"} openCands=${args.openingCands.length} mistakeCands=${args.mistakeCands.length} coachThemes=${tagList(args.coach.globalThemes)}`
      );
    }

    const comment = bits.length ? ` {${bits.join(" ")}}` : "";
    const num = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) parts.push(`${num}. ${m.san}${comment}`);
    else parts.push(`${m.san}${comment}`);
  }
  return parts.join(" ");
}

function buildHeuristicMoveText(
  raw: string,
  metrics: Awaited<ReturnType<typeof analyzeHeuristicGame>>
): string {
  const chess = new Chess();
  chess.loadPgn(raw, { strict: false });
  const history = chess.history({ verbose: true });
  const parts: string[] = [];
  for (let ply = 0; ply < history.length; ply += 1) {
    const m = history[ply];
    const bits: string[] = [];
    const phase = phaseComment(ply, metrics);
    if (phase) bits.push(phase);
    const comment = bits.length ? ` {${bits.join("; ")}}` : "";
    const num = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) parts.push(`${num}. ${m.san}${comment}`);
    else parts.push(`${m.san}${comment}`);
  }
  return parts.join(" ");
}

function buildEvalMoveText(
  raw: string,
  evalsPawns: Array<number | null>
): string {
  const chess = new Chess();
  chess.loadPgn(raw, { strict: false });
  const history = chess.history({ verbose: true });
  const parts: string[] = [];
  for (let ply = 0; ply < history.length; ply += 1) {
    const m = history[ply];
    const pawns = evalsPawns[ply + 1];
    const comment = pawns != null ? ` {[%eval ${pawns.toFixed(2)}]}` : "";
    const num = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) parts.push(`${num}. ${m.san}${comment}`);
    else parts.push(`${m.san}${comment}`);
  }
  return parts.join(" ");
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log("Reading", SRC);
  const raw = readFileSync(SRC, "utf8");
  const userColor = resolveUserColor(raw);
  const userIsWhite = userColor === "white";
  const eco = headerValue(raw, "ECO");
  const openingName = headerValue(raw, "Opening");
  const ecoFamily = resolveEcoFamily(
    String(eco || "").trim().toUpperCase() || null,
    openingName
  );
  const openingTags = detectOpeningFamily(eco, openingName);
  let openingKeyId = resolveOpeningPackKey(eco, openingName);
  // London fingerprint when ECO is anti-indian / A4x and name missing.
  if (!openingKeyId && /^A4[5-9]$/i.test(String(eco || ""))) {
    openingKeyId = "opening.london_system";
  }
  if (
    openingKeyId === "opening.london_system" &&
    !openingTags.includes("opening_london")
  ) {
    openingTags.push("opening_london");
  }
  if (
    openingKeyId === "opening.kings_indian" &&
    !openingTags.includes("opening_kings_indian")
  ) {
    openingTags.push("opening_kings_indian");
  }

  const studyGame = toStudyGame(raw, userColor);
  const metrics = await analyzeHeuristicGame(studyGame, { trace: true });
  if (!metrics.opening || !metrics.middlegame || !metrics.endgame) {
    throw new Error("Heuristic analysis returned empty metrics");
  }
  const resolvedOpeningName =
    openingName ||
    (openingKeyId === "opening.london_system" ? "London System" : null) ||
    ecoFamily?.name ||
    (openingKeyId
      ? openingKeyId.replace(/^opening\./, "").replace(/_/g, " ")
      : null);
  if (!metrics.opening.opening_name && resolvedOpeningName) {
    metrics.opening.opening_name = resolvedOpeningName;
  }

  const fens = collectFens(raw);
  const chessForSans = new Chess();
  chessForSans.loadPgn(raw, { strict: false });
  const historySans = chessForSans.history();
  const sf = stockfishAnalyze(fens, SF_ANALYZE);
  const usedEngine = Boolean(sf);
  let positions: SfPosition[] =
    sf || fens.map(() => ({ cpWhite: 0, bestUci: null, bestPvUci: [] }));
  if (usedEngine) {
    const fixedBeforePly0: number[] = [];
    const pushUserFullmove = (fm: number) => {
      const ply1 = userIsWhite ? fm * 2 - 1 : fm * 2;
      fixedBeforePly0.push(ply1 - 1);
    };
    const snapUserPly0FromPly1 = (ply1: number) => {
      const userParity = userIsWhite ? 1 : 0;
      let p = ply1 < 1 ? (userIsWhite ? 1 : 2) : ply1;
      if (p % 2 !== userParity) p += 1;
      fixedBeforePly0.push(Math.max(0, p - 1));
    };
    pushUserFullmove(5);
    pushUserFullmove(10);
    const egStart0 = metrics.endgame.endgame_start_ply;
    if (egStart0 != null && egStart0 >= 0) {
      snapUserPly0FromPly1(egStart0 + 1);
    }
    const egAdv = (metrics.endgame as { endgame_advantage_start_ply?: number })
      .endgame_advantage_start_ply;
    if (egAdv != null && egAdv >= 0) {
      snapUserPly0FromPly1(egAdv + 1);
    }
    positions = deepenCriticalPositions({
      fens,
      positions,
      historySans,
      userIsWhite,
      extraBeforePly0: fixedBeforePly0,
    });
  }
  const evalsCp = positions.map((p) => p.cpWhite);
  const evalsPawns = evalsCp.map((cp) => cp / 100);
  const evalMetrics = analyzeEvalBucketMetrics(studyGame, evalsCp);

  const vaultCands = buildVaultCandidates({
    evalsCp,
    fens,
    historySans,
    positions,
    userIsWhite,
  });

  const mergedMg = mergeMiddlegameHeuristicWithBucket(
    metrics.middlegame,
    evalMetrics.middlegameEval
  );
  const mergedEg = mergeEndgameHeuristicWithBucket(
    metrics.endgame,
    evalMetrics.endgameEval
  );
  const openingMerged = {
    ...metrics.opening,
    opening_accuracy_pct:
      evalMetrics.opening_accuracy_pct ?? metrics.opening.opening_accuracy_pct,
    accuracy_moves:
      evalMetrics.opening_accuracy_moves || metrics.opening.accuracy_moves,
  };

  // Themes: MG uses raw+bucket (don't double-merge); EG uses merged row only.
  const coach = buildCoachGameMetrics({
    record: {
      evalsWhiteCp: evalsCp,
      openingCandidates: vaultCands.opening,
      mistakeCandidates: vaultCands.mistake,
      opening_accuracy_pct: evalMetrics.opening_accuracy_pct,
      opening_accuracy_moves: evalMetrics.opening_accuracy_moves,
      middlegameEval: evalMetrics.middlegameEval,
      endgameEval: null,
      style: evalMetrics.style,
    },
    heuristics: {
      opening: openingMerged,
      middlegame: metrics.middlegame,
      endgame: mergedEg,
    },
    userColor,
  });

  enrichMomentsWithPlies(
    coach.momentsByPly,
    historySans.map((san, i) => ({
      ply: i + 1,
      fenBefore: fens[i] || "",
      san,
    }))
  );
  ensureFixedOpeningMoments(coach.momentsByPly, userIsWhite, historySans.length, {
    eco: studyGame.opening_eco || eco || null,
    opening: studyGame.opening_name || openingName || null,
  });
  const peerCtx = defaultBundledPeerContext({
    rating:
      studyGame.user_rating == null ? null : Number(studyGame.user_rating),
    speed: studyGame.speed ?? null,
    timeControl: studyGame.time_control ?? null,
  });
  enrichOpeningCoachMoments({
    momentsByPly: coach.momentsByPly,
    opening: openingMerged,
    userColor,
    badAccuracyMoves: vaultCands.opening.length,
    peer: peerCtx,
    openingName:
      formatOpeningLabel(
        studyGame.opening_eco || eco,
        studyGame.opening_name || openingName
      ) ||
      studyGame.opening_name ||
      openingName ||
      null,
  });
  enrichMiddlegameCoachMoments({
    momentsByPly: coach.momentsByPly,
    middlegame: mergedMg,
    peer: peerCtx,
    styleExtras: {
      brilliant_moves: evalMetrics.style?.brilliant_moves ?? null,
      excellent_moves: evalMetrics.style?.excellent_moves ?? null,
      important_moves: evalMetrics.style?.important_moves ?? null,
    },
  });
  enrichMiddlegameStrategicMoments({
    momentsByPly: coach.momentsByPly,
    userColor: userIsWhite ? "w" : "b",
  });
  enrichEndgameCoachMoments({
    momentsByPly: coach.momentsByPly,
    userColor: userIsWhite ? "w" : "b",
    eg: mergedEg,
    style: evalMetrics.style,
  });

  // Live MG + praise moments (mirrors analyzeGame).
  let pendingOppKind: "mistake" | "blunder" | null = null;
  let pendingOppWp: number | null = null;
  for (let ply0 = 0; ply0 < historySans.length; ply0 += 1) {
    const ply1 = ply0 + 1;
    const fenBefore = fens[ply0] || "";
    const fenAfter = fens[ply0 + 1] || "";
    const san = historySans[ply0] || "";
    const isUser = userIsWhite ? ply0 % 2 === 0 : ply0 % 2 === 1;
    const phase = phaseForPly(ply0, metrics);
    const before = evalsCp[ply0] ?? 0;
    const after = evalsCp[ply0 + 1] ?? before;
    const bestUci = positions[ply0]?.bestUci || null;
    const bestSan = uciToSan(fenBefore, bestUci);
    const bestPvSan = pvUciToSan(
      fenBefore,
      positions[ply0]?.bestPvUci || [],
      engineLineSansBudget()
    );
    const playedBest = Boolean(bestSan && bestSan === san);
    const wpBefore = userWinProbability(before, userIsWhite);
    const wpAfter = userWinProbability(after, userIsWhite);
    const wpDrop = Math.max(0, wpBefore - wpAfter);

    let missedOpportunity = false;
    let missedAfterOpp: "mistake" | "blunder" | null = null;
    if (isUser && pendingOppKind && pendingOppWp != null) {
      missedOpportunity = annotateMissedOpportunity({
        wpBefore,
        wpAfter,
        pendingPeakWp: pendingOppWp,
        playedBest,
      });
      if (missedOpportunity) missedAfterOpp = pendingOppKind;
      pendingOppKind = null;
      pendingOppWp = null;
    } else if (isUser && pendingOppKind) {
      pendingOppKind = null;
      pendingOppWp = null;
    }

    const mark = isUser
      ? annotateCoachMark({
          playedBest,
          wpDrop,
          wpBefore,
          wpAfter,
          fenBefore,
          playedSan: san,
          userIsWhite,
          missedOpportunity,
        })
      : null;

    if (
      isUser &&
      !playedBest &&
      (mark === "blunder" || mark === "mistake" || mark === "missed")
    ) {
      const severity =
        mark === "blunder" ? "blunder" : mark === "missed" ? "missed" : "mistake";
      const userBeforeCp = userIsWhite ? before : -before;
      const userAfterCp = userIsWhite ? after : -after;
      const deltaCp = Math.max(0, Math.round(userBeforeCp - userAfterCp));
      const prevLive = coach.momentsByPly[ply1];
      const keepStructural =
        prevLive?.structuralKind === "decisive_pawn_break" ||
        isFixedCheckpointMoment(prevLive)
          ? prevLive!.structuralKind
          : null;
      const alt = playedAltLineFromPositions({
        fenBefore,
        fenAfter,
        playedSan: san,
        positions,
        ply0,
      });
      const previewReq = buildCoachNoteRequest({
        ply: ply1,
        phase,
        mark,
        moment: prevLive || null,
        deltaCp,
        fenBefore,
        fenAfter,
        bestPvSan,
        playedLineSans: alt.playedLineSans,
        playedSan: san,
        playedContinuationSans: alt.continuationSans,
        userColor: userIsWhite ? "white" : "black",
        evalBeforeCp: before,
        evalAfterCp: after,
      });
      const lineInputs = previewReq
        ? lineComparisonMomentInputs(previewReq)
        : bestPvSan.length
          ? { engine_line: bestPvSan.join(" ") }
          : {};
      const metaInputs = coachRequestMetaInputs(previewReq);
      upsertLiveMoment(coach.momentsByPly, {
        ply: ply1,
        moveNumber: Math.floor(ply0 / 2) + 1,
        severity,
        dropCp: Math.max(
          deltaCp,
          severity === "blunder" ? 300 : severity === "missed" ? 150 : 150
        ),
        playedSan: san,
        bestSan,
        fen: fenBefore,
        evalBeforeCp: before,
        evalAfterCp: after,
        source: "live",
        structuralKind: keepStructural,
        inputs: {
          ...(prevLive?.inputs || {}),
          ...lineInputs,
          ...metaInputs,
          critical_mark: mark,
          ...(missedAfterOpp ? { missed_after_opp: missedAfterOpp } : {}),
        },
      });
    }

    if (isUser && isPraiseMark(mark)) {
      const praiseDrop = mark === "brilliant" ? 35 : 28;
      const prevLive = coach.momentsByPly[ply1];
      upsertLiveMoment(coach.momentsByPly, {
        ply: ply1,
        moveNumber: Math.floor(ply0 / 2) + 1,
        severity: null,
        dropCp: Math.max(prevLive?.dropCp || 0, praiseDrop),
        playedSan: san,
        bestSan,
        fen: fenBefore,
        evalBeforeCp: before,
        evalAfterCp: after,
        source: "live",
        inputs: {
          ...(prevLive?.inputs || {}),
          praise_mark: mark,
        },
      });
    }

    if (isUser && phase === "middlegame") {
      try {
        const afterBoard = new Chess(fenAfter);
        const probe = new Chess(fenBefore);
        const mv = probe.move(san);
        if (mv && isPawnBreakMove(afterBoard, mv, userIsWhite ? "w" : "b")) {
          const alt = playedAltLineFromPositions({
            fenBefore,
            fenAfter,
            playedSan: san,
            positions,
            ply0,
          });
          const prevLive = coach.momentsByPly[ply1];
          const breakMoment = upsertLiveMoment(coach.momentsByPly, {
            ply: ply1,
            moveNumber: Math.floor(ply0 / 2) + 1,
            severity: null,
            dropCp: Math.max(prevLive?.dropCp || 0, 40),
            playedSan: san,
            bestSan,
            fen: fenBefore,
            evalBeforeCp: before,
            evalAfterCp: after,
            source: "structural",
            structuralKind: "decisive_pawn_break",
            inputs: {
              opening: studyGame.opening_name || null,
              eco: studyGame.opening_eco || null,
              pawn_break: true,
              played_best: playedBest,
              san,
            },
          });
          const breakReq = buildCoachNoteRequest({
            ply: ply1,
            phase,
            mark,
            moment: breakMoment,
            deltaCp: Math.max(
              0,
              Math.round(
                (userIsWhite ? before : -before) -
                  (userIsWhite ? after : -after)
              )
            ),
            fenBefore,
            fenAfter,
            bestPvSan,
            playedLineSans: alt.playedLineSans,
            playedSan: san,
            playedContinuationSans: alt.continuationSans,
            userColor: userIsWhite ? "white" : "black",
            evalBeforeCp: before,
            evalAfterCp: after,
          });
          if (breakReq && breakMoment) {
            upsertLiveMoment(coach.momentsByPly, {
              ...breakMoment,
              inputs: {
                ...(breakMoment.inputs || {}),
                ...lineComparisonMomentInputs(breakReq),
                ...coachRequestMetaInputs(breakReq),
              },
            });
          }
        }
      } catch {
        /* ignore */
      }
    }

    if (!isUser && after != null) {
      const gift = oppGiftKind(wpBefore, wpAfter);
      pendingOppKind = gift;
      pendingOppWp = gift ? wpAfter : null;
    }

    if (isUser) {
      const existing = coach.momentsByPly[ply1];
      if (existing) {
        if (!existing.bestSan && bestSan) existing.bestSan = bestSan;
        if (!existing.playedSan) existing.playedSan = san;
        if (!existing.fen) existing.fen = fenBefore;
        if (
          !playedBest &&
          (existing.structuralKind === "opening_name" ||
            (existing.structuralKind === "opening_aggregate" &&
              openingEvalGapAllowsEngineLine({
                mark,
                deltaCp: Math.max(
                  0,
                  Math.round(
                    (userIsWhite ? before : -before) -
                      (userIsWhite ? after : -after)
                  )
                ),
                fenBefore,
                userColor: userIsWhite ? "white" : "black",
                evalBeforeCp: before,
                evalAfterCp: after,
              }))) &&
          (bestPvSan.length || bestSan)
        ) {
          const alt = playedAltLineFromPositions({
            fenBefore,
            fenAfter,
            playedSan: san,
            positions,
            ply0,
          });
          const req = buildCoachNoteRequest({
            ply: ply1,
            phase,
            mark,
            moment: existing,
            deltaCp: Math.max(
              0,
              Math.round(
                (userIsWhite ? before : -before) -
                  (userIsWhite ? after : -after)
              )
            ),
            fenBefore,
            fenAfter,
            bestPvSan,
            playedLineSans: alt.playedLineSans,
            playedSan: san,
            playedContinuationSans: alt.continuationSans,
            userColor: userIsWhite ? "white" : "black",
            evalBeforeCp: before,
            evalAfterCp: after,
          });
          if (req) {
            existing.inputs = {
              ...(existing.inputs || {}),
              ...lineComparisonMomentInputs(req),
              ...coachRequestMetaInputs(req),
            };
            if (bestSan) existing.bestSan = bestSan;
          } else if (bestSan && !existing.bestSan) {
            existing.bestSan = bestSan;
          }
        }
      }
    }
  }

  // Opp gifts never become coach moments (legacy strip).
  for (const [ply, m] of Object.entries(coach.momentsByPly)) {
    if (m.structuralKind !== "opponent_mistake") continue;
    if (m.inputs?.critical_mark) {
      delete m.structuralKind;
      coach.momentsByPly[Number(ply)] = m;
    } else {
      delete coach.momentsByPly[Number(ply)];
    }
  }

  enrichLiveMiddlegamePeerGaps({
    momentsByPly: coach.momentsByPly,
    middlegame: mergedMg,
    peer: peerCtx,
  });
  enrichMiddlegameStrategicMoments({
    momentsByPly: coach.momentsByPly,
    userColor: userIsWhite ? "w" : "b",
  });
  enrichEndgameCoachMoments({
    momentsByPly: coach.momentsByPly,
    userColor: userIsWhite ? "w" : "b",
    eg: mergedEg,
    style: evalMetrics.style,
  });

  // Drop terminal eval explosions / non-deviations from moment map.
  // Keep structural, praise, and live bad-move moments (except terminal noise).
  for (const [ply, m] of Object.entries(coach.momentsByPly)) {
    const ply0 = Number(ply) - 1;
    const played = historySans[ply0] || "";
    if (m.structuralKind || m.inputs?.praise_mark) continue;
    if (m.severity && m.source === "live") {
      if (
        m.dropCp >= 500 ||
        Math.abs(m.evalBeforeCp || 0) >= 9000
      ) {
        delete coach.momentsByPly[Number(ply)];
      }
      continue;
    }
    if (
      m.dropCp >= 500 ||
      Math.abs(m.evalBeforeCp || 0) >= 9000 ||
      (m.playedSan && played && m.bestSan && m.bestSan === played)
    ) {
      delete coach.momentsByPly[Number(ply)];
    }
  }

  // Opening near-misses (below vault gate) for header visibility when cand=0.
  const openingNear: string[] = [];
  for (let ply0 = 0; ply0 < Math.min(MAX_OPENING_PLY, evalsCp.length - 1); ply0 += 1) {
    const isUser = userIsWhite ? ply0 % 2 === 0 : ply0 % 2 === 1;
    if (!isUser) continue;
    const before = evalsCp[ply0];
    const after = evalsCp[ply0 + 1];
    const userBefore = userIsWhite ? before : -before;
    const userAfter = userIsWhite ? after : -after;
    const dropCp = Math.max(0, Math.round(userBefore - userAfter));
    if (dropCp < 40 || dropCp >= OPENING_MIN_DROP_CP) continue;
    const best = uciToSan(fens[ply0] || "", positions[ply0]?.bestUci || null);
    openingNear.push(
      `p${ply0 + 1}:${historySans[ply0]}->${best || "?"}(${dropCp}cp)`
    );
  }
  openingNear.sort((a, b) => {
    const da = Number(a.match(/\((\d+)cp\)/)?.[1] || 0);
    const db = Number(b.match(/\((\d+)cp\)/)?.[1] || 0);
    return db - da;
  });

  const timeline: MetricTimelineEvent[] = [
    ...(metrics.events || []).map((ev) => ({
      ...ev,
      source: "heuristic" as const,
    })),
    ...traceStyleMetricEvents(studyGame, evalsCp, historySans),
  ];
  for (const c of [...vaultCands.opening, ...vaultCands.mistake]) {
    timeline.push({
      source: "candidate",
      ply: c.ply + 1,
      kind: "set",
      field: `${c.kind}_candidate`,
      value: `${c.mark}:${c.eval_drop_cp}cp:${c.played_san}->${c.best_san || "?"}`,
    });
  }
  for (const m of Object.values(coach.momentsByPly)) {
    timeline.push({
      source: "coach",
      ply: m.ply,
      kind: "set",
      field: "moment",
      value: m.structuralKind
        ? `structural:${m.structuralKind}`
        : `${m.severity}:${m.dropCp}cp${m.candidateKind ? `:${m.candidateKind}` : ""}`,
    });
  }
  // Eval mark / delta inserts on user plies.
  for (let ply0 = 0; ply0 < historySans.length; ply0 += 1) {
    const isUser = userIsWhite ? ply0 % 2 === 0 : ply0 % 2 === 1;
    if (!isUser) continue;
    const before = evalsCp[ply0] ?? 0;
    const after = evalsCp[ply0 + 1] ?? before;
    const wpBefore = userWinProbability(before, userIsWhite);
    const wpAfter = userWinProbability(after, userIsWhite);
    const wpSwing = Math.abs(wpAfter - wpBefore);
    const isTerminal =
      ply0 >= historySans.length - 1 ||
      Math.abs(before) >= 9000 ||
      Math.abs(after) >= 9000;
    const mark = markFromWpDrop(Math.max(0, wpBefore - wpAfter));
    const userBefore = userIsWhite ? before : -before;
    const userAfter = userIsWhite ? after : -after;
    const deltaCp = Math.max(0, Math.round(userBefore - userAfter));
    if (
      mark &&
      mark !== "excellent" &&
      mark !== "good" &&
      !isTerminal &&
      wpSwing >= 0.02
    ) {
      timeline.push({
        source: "eval",
        ply: ply0 + 1,
        kind: "set",
        field: "mark",
        value: mark,
      });
    }
    if (deltaCp >= 40 && !isTerminal && wpSwing >= 0.02) {
      timeline.push({
        source: "eval",
        ply: ply0 + 1,
        kind: "change",
        field: "deltaCp",
        value: deltaCp,
      });
    }
  }
  timeline.sort((a, b) => a.ply - b.ply || a.field.localeCompare(b.field));
  const eventsByPly = groupEventsByPly(timeline);

  const baseHeaders = stripMoveText(raw);
  const allHeaders = [
    '[Annotator "chess-app full-metrics+timeline+noteWeights"]',
    `[HeuristicUserColor "${userColor}"]`,
    `[HeuristicUserIsWhite "${userIsWhite ? "true" : "false"}"]`,
    `[MetricTimelineEvents "${timeline.length}"]`,
    `[MetricTimelineLegend "+src.field=value insert; Δsrc.field:prev→next change; sources h=heuristic s=style e=eval c=candidate|coach"]`,
    ...flattenHeaders("Opening", openingMerged as unknown as Record<string, unknown>),
    ...flattenHeaders("Middlegame", mergedMg as unknown as Record<string, unknown>),
    ...flattenHeaders("Endgame", mergedEg as unknown as Record<string, unknown>),
    ...flattenHeaders(
      "Style",
      (evalMetrics.style || {}) as unknown as Record<string, unknown>
    ),
    `[EvalSource "${usedEngine ? `stockfish-analyze-d${SF_ANALYZE.depth}-mpv${SF_ANALYZE.multipv}-mt${SF_ANALYZE.movetime}+critical-d${SF_CRITICAL.depth}-mpv${SF_CRITICAL.multipv}-mt${SF_CRITICAL.movetime}` : "unavailable-zero-fallback"}"]`,
    ...flattenHeaders(
      "EvalMG",
      (evalMetrics.middlegameEval || {}) as unknown as Record<string, unknown>
    ),
    ...flattenHeaders(
      "EvalEG",
      (evalMetrics.endgameEval || {}) as unknown as Record<string, unknown>
    ),
    ...candidateHeaders(vaultCands),
    `[OpeningNearMisses "${tagList(openingNear.slice(0, 5))}"]`,
    ...coachHeaders(
      coach,
      openingKeyId,
      openingTags,
      ecoFamily ? `${ecoFamily.key}:${ecoFamily.name}` : null
    ),
  ];

  const allBody = buildAllMoveText({
    raw,
    metrics,
    coach,
    evalsPawns,
    evalsCp,
    positions,
    fens,
    userIsWhite,
    openingKeyId,
    eco,
    opening: openingName,
    openingCands: vaultCands.opening,
    mistakeCands: vaultCands.mistake,
    eventsByPly,
  });
  writeFileSync(
    OUT_ALL,
    `${baseHeaders}\n${allHeaders.join("\n")}\n\n${allBody}\n`
  );
  console.log("Wrote", OUT_ALL);

  const jsonDump = {
    source: SRC,
    userColor,
    eco,
    openingName,
    openingKeyId,
    openingTags,
    ecoFamily,
    opening: openingMerged,
    middlegame: mergedMg,
    endgame: mergedEg,
    style: evalMetrics.style,
    evalBuckets: {
      opening_accuracy_pct: evalMetrics.opening_accuracy_pct,
      opening_accuracy_moves: evalMetrics.opening_accuracy_moves,
      middlegameEval: evalMetrics.middlegameEval,
      endgameEval: evalMetrics.endgameEval,
    },
    candidates: {
      rules: {
        OPENING_PLY_SKIP,
        MAX_OPENING_PLY,
        OPENING_MIN_DROP_CP,
        MAX_MOMENTS_PER_GAME,
      },
      opening: vaultCands.opening,
      mistake: vaultCands.mistake,
      openingNearMisses: openingNear.slice(0, 8),
    },
    coach,
    timeline,
    timelineByPly: Object.fromEntries(
      [...eventsByPly.entries()].map(([ply, evs]) => [
        ply,
        evs.map((e) => ({
          source: e.source,
          kind: e.kind,
          field: e.field,
          value: e.value,
          prev: e.prev ?? null,
        })),
      ])
    ),
    noteWeightRules: {
      minAccept: METRIC_TIP_MIN_WEIGHT,
      parts: [
        "metricInputKey+16",
        "metricInputFamily+6",
        "themeHit+14/12/4",
        "openingKeyLock+12",
        "sacrificeTheme+10",
        "errorTacticalFamily+8",
        "deltaCpTactical+4",
        "phaseThemeBagSoft+2",
        "endgamePhase+3",
        "theoreticalEndgame+3",
      ],
      attach:
        "requestKinds=bad_move|fixed_checkpoint|structural_moment|praise_move;engineHorizon=8;openingAlwaysAttach=false;allowPhaseStructure=false",
      select:
        "pool soft-keys from softKeysForNoteRequest only; pick max if >= minAccept; didactic mid-specificity",
      badMovePayload:
        "playedMetricDelta + playedLineMetricDelta + engineLineMetricDelta + engineVsPlayedMetricDelta (8-move PV, all BoardMetricSnap fields)",
    },
  };
  writeFileSync(OUT_JSON, `${JSON.stringify(jsonDump, null, 2)}\n`);
  console.log("Wrote", OUT_JSON);

  if (WRITE_SPLIT) {
    writeFileSync(
      OUT_HEUR,
      `${baseHeaders}\n${flattenHeaders("Opening", openingMerged as unknown as Record<string, unknown>).join("\n")}\n\n${buildHeuristicMoveText(raw, metrics)}\n`
    );
    writeFileSync(
      OUT_EVAL,
      `${baseHeaders}\n[EvalSource "${usedEngine ? "stockfish" : "zero"}"]\n\n${buildEvalMoveText(raw, evalsPawns)}\n`
    );
    console.log("Wrote", OUT_HEUR);
    console.log("Wrote", OUT_EVAL);
  }

  console.log("user_color", userColor);
  console.log("plies", fens.length - 1);
  console.log("opening_key", openingKeyId || "none");
  console.log("opening_tags", openingTags.join(",") || "none");
  console.log("opening_cands", vaultCands.opening.length);
  console.log("mistake_cands", vaultCands.mistake.length);
  console.log(
    "opening_cands_detail",
    vaultCands.opening
      .map((c) => `p${c.ply + 1}:${c.played_san}->${c.best_san || "?"}(${c.eval_drop_cp})`)
      .join(" | ") || "none"
  );
  console.log(
    "mistake_cands_detail",
    vaultCands.mistake
      .map((c) => `p${c.ply + 1}:${c.played_san}->${c.best_san || "?"}(${c.eval_drop_cp})`)
      .join(" | ") || "none"
  );
  console.log("coach_themes", coach.globalThemes.join(",") || "none");
  console.log("mg_blunders", mergedMg.middlegame_blunders);
  console.log("eg_blunders", mergedEg.blunders);
  console.log("timeline_events", timeline.length);
  console.log(
    "timeline_sample",
    timeline
      .slice(0, 8)
      .map((e) => `p${e.ply}:${formatEvent(e)}`)
      .join(" | ")
  );
  if (!usedEngine) {
    console.log("NOTE: stockfish not found; eval metrics use zero CP fallback");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
