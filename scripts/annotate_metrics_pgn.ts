import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "mobile/package.json"));
const { Chess } = require("chess.js") as typeof import("chess.js");

import { analyzeHeuristicGame } from "../mobile/src/engine/heuristicMetricsPass";
import { analyzeEvalBucketMetrics } from "../mobile/src/engine/evalBucketMetrics";
import { middlegameStartPly } from "../mobile/src/engine/middlegameBounds";
import { openingPhaseEndFullmove } from "../mobile/src/engine/openingPhase";
import type { StudyGame } from "../mobile/src/engine/analyzeMistakes";

const EVAL_CLAMP = 1000;
const MATE_CP_THRESHOLD = 50000;

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

const SRC = process.env.PGN_PATH?.trim()
  || process.argv[2]
  || join(ROOT, "game.pgn");
const OUT_DIR = join(ROOT, "samples");
const OUT_ALL = process.env.OUT_ALL?.trim()
  || join(OUT_DIR, "metrics_all.pgn");
const OUT_HEUR = join(OUT_DIR, "metrics_heuristics_only.pgn");
const OUT_EVAL = join(OUT_DIR, "metrics_with_eval.pgn");
const WRITE_SPLIT = process.env.WRITE_SPLIT !== "0";

function stripMoveText(pgn: string): string {
  const idx = pgn.search(/\n\n1\./);
  if (idx >= 0) return pgn.slice(0, idx).trim();
  return pgn.split(/\n\n/)[0]?.trim() || "";
}

function headerValue(pgn: string, tag: string): string | null {
  const match = pgn.match(new RegExp(`\\[${tag} "([^"]*)"\\]`));
  return match?.[1] ?? null;
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
    user_rating: Number(headerValue(raw, userColor === "white" ? "WhiteElo" : "BlackElo") || "") || undefined,
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

function heuristicHeaders(
  metrics: Awaited<ReturnType<typeof analyzeHeuristicGame>>
): string[] {
  const o = metrics.opening;
  const m = metrics.middlegame;
  const e = metrics.endgame;
  const phaseEnd =
    o?.phase_end_fullmove ??
    openingPhaseEndFullmove(o?.opening_castle_fullmove ?? null);
  const mgPly = m?.middlegame_start_ply ?? middlegameStartPly(phaseEnd);
  const egPly = e?.endgame_start_ply;
  return [
    '[Annotator "chess-app analyzeHeuristicGame"]',
    `[HeuristicUserColor "${o?.user_color || "white"}"]`,
    `[HeuristicCastleFullmove "${o?.opening_castle_fullmove ?? "uncastled"}"]`,
    `[HeuristicOpeningPhaseEndFullmove "${phaseEnd}"]`,
    `[HeuristicMiddlegameStartPly "${m?.reached_middlegame ? mgPly : "n/a"}"]`,
    `[HeuristicMiddlegameStartFullmove "${m?.reached_middlegame ? Math.floor(mgPly / 2) + 1 : "n/a"}"]`,
    `[HeuristicMiddlegameEndPly "${m?.middlegame_end_ply ?? "n/a"}"]`,
    `[HeuristicEndgameStartPly "${egPly ?? "n/a"}"]`,
    `[HeuristicEndgameStartFullmove "${egPly != null ? Math.floor(egPly / 2) + 1 : "n/a"}"]`,
    `[HeuristicMinorsBy10 "${fmt(o?.opening_minors_developed_by_10, 0)}"]`,
    `[HeuristicCenterControlPct "${fmt(o?.opening_center_control_pct)}"]`,
    `[HeuristicTempoWastePct "${fmt(o?.opening_tempo_waste_rate_pct)}"]`,
    `[HeuristicOpeningPawnMoves "${o?.opening_pawn_moves ?? 0}"]`,
    `[HeuristicUncastled "${o?.uncastled ? "true" : "false"}"]`,
    `[HeuristicKingAttackers "${fmt(m?.middlegame_king_attackers_score)}"]`,
    `[HeuristicPawnShieldPct "${fmt(m?.middlegame_pawn_shield_pct)}"]`,
    `[HeuristicOpenFilePct "${fmt(m?.middlegame_open_file_proximity_pct)}"]`,
    `[HeuristicSafeMovesPct "${fmt(m?.middlegame_safe_moves_pct)}"]`,
    `[HeuristicOutpostControl "${fmt(m?.middlegame_outpost_control, 0)}"]`,
    `[HeuristicSpacePct "${fmt(m?.middlegame_space_advantage_pct)}"]`,
    `[HeuristicPawnIslandsAvg "${fmt(m?.middlegame_pawn_islands_avg)}"]`,
    `[HeuristicHadIqp "${m?.had_iqp ? "true" : "false"}"]`,
    `[HeuristicHadDoubledPawns "${m?.had_doubled_pawns ? "true" : "false"}"]`,
    `[HeuristicHadBackwardPawns "${m?.had_backward_pawns ? "true" : "false"}"]`,
    `[HeuristicKingCentralization "${fmt(e?.king_centralization, 2)}"]`,
    `[HeuristicKingDistance "${fmt(e?.king_distance, 2)}"]`,
    `[HeuristicPawnDiff "${fmt(e?.pawn_diff, 2)}"]`,
    `[HeuristicTheoretical "${Object.keys(e?.theoretical || {}).join(",") || "none"}"]`,
  ];
}

function evalHeaders(
  evals: ReturnType<typeof analyzeEvalBucketMetrics>,
  usedEngine: boolean
): string[] {
  const mg = evals.middlegameEval;
  const eg = evals.endgameEval;
  const st = evals.style;
  return [
    '[Annotator "chess-app analyzeEvalBucketMetrics"]',
    `[EvalSource "${usedEngine ? "stockfish-depth-12" : "unavailable-zero-fallback"}"]`,
    `[EvalAnnotator "${usedEngine ? "stockfish" : "no stockfish binary; evals set 0.00 — set STOCKFISH_PATH"}"]`,
    `[EvalOpeningAccuracyPct "${fmt(evals.opening_accuracy_pct)}"]`,
    `[EvalOpeningAccuracyMoves "${evals.opening_accuracy_moves}"]`,
    `[EvalMiddlegameAccuracyPct "${fmt(mg?.accuracy_pct)}"]`,
    `[EvalMiddlegameAccuracyMoves "${mg?.accuracy_moves ?? 0}"]`,
    `[EvalMiddlegameBlunders "${mg?.blunders ?? 0}"]`,
    `[EvalMiddlegameMistakes "${mg?.mistakes ?? 0}"]`,
    `[EvalMiddlegameInaccuracies "${mg?.inaccuracies ?? 0}"]`,
    `[EvalMiddlegameTacticsMade "${mg?.tactics_made ?? 0}"]`,
    `[EvalMiddlegameMissedOpportunityPct "${pct(mg?.missed_opportunities, mg?.missed_opportunity_chances)}"]`,
    `[EvalMiddlegameMissedTacticPct "${pct(mg?.missed_tactics, mg?.missed_tactic_chances)}"]`,
    `[EvalMiddlegameAllowedTacticPct "${pct(mg?.allowed_tactics_found, mg?.allowed_tactic_chances)}"]`,
    `[EvalEndgameBlunders "${eg?.blunders ?? 0}"]`,
    `[EvalEndgameMistakes "${eg?.mistakes ?? 0}"]`,
    `[EvalEndgameInaccuracies "${eg?.inaccuracies ?? 0}"]`,
    `[EvalEndgameTacticsMade "${eg?.tactics_made ?? 0}"]`,
    `[EvalEndgameMissedOpportunityPct "${pct(eg?.missed_opportunities, eg?.missed_opportunity_chances)}"]`,
    `[EvalEndgamePieceTrades "${eg?.piece_trades ?? 0}"]`,
    `[EvalEndgameBeneficialTrades "${eg?.beneficial_trades ?? 0}"]`,
    `[EvalEndgameWinningTrades "${eg?.winning_trades ?? 0}"]`,
    `[EvalEndgameSimplificationTrades "${eg?.simplification_trades ?? 0}"]`,
    `[EvalEndgameMateEpisodes "${eg?.mate_episodes ?? 0}"]`,
    `[EvalEndgameMateConverted "${eg?.mate_converted ?? 0}"]`,
    `[EvalEndgameAccidentalStalemate "${eg?.accidental_stalemate ? "true" : "false"}"]`,
    `[EvalStyleVolatilityCp "${fmt(st?.volatility_cp, 0)}"]`,
    `[EvalStyleSacrificeMoves "${st?.sacrifice_moves ?? 0}"]`,
    `[EvalStyleHadSacrifice "${st?.had_sacrifice ? "true" : "false"}"]`,
    `[EvalStyleEarlyFlankPushes "${st?.early_flank_pushes ?? 0}"]`,
    `[EvalStyleHadEarlyFlank "${st?.had_early_flank ? "true" : "false"}"]`,
    `[EvalStyleHadEndgameAdvantage "${st?.had_endgame_advantage ? "true" : "false"}"]`,
    `[EvalStyleEndgameAdvantageStartPly "${st?.endgame_advantage_start_ply ?? "n/a"}"]`,
    `[EvalStyleConvertedEndgame "${st?.converted_endgame ? "true" : "false"}"]`,
    `[EvalStyleTerritoryOppPct "${fmt(st?.territory_opp_pct)}"]`,
    `[EvalStyleEarlyTrades "${st?.early_trades ?? 0}"]`,
    `[EvalStyleTradesNearEnemyKing "${st?.trades_near_enemy_king ?? 0}"]`,
    `[EvalStyleTradesNearUserKing "${st?.trades_near_user_king ?? 0}"]`,
    `[EvalStyleForwardMoves "${st?.forward_moves ?? 0}"]`,
    `[EvalStyleBackwardMoves "${st?.backward_moves ?? 0}"]`,
    `[EvalStyleLateralMoves "${st?.lateral_moves ?? 0}"]`,
    `[EvalStyleHigherThreats "${st?.higher_threats ?? 0}"]`,
    `[EvalStyleThreatEscapes "${st?.threat_escapes ?? 0}"]`,
    `[EvalStyleDrawishless "${st?.drawishless ? "true" : "false"}"]`,
    `[EvalStyleDeclinedRecaptures "${st?.declined_recaptures ?? 0}"]`,
    `[EvalStyleRecaptureChances "${st?.recapture_chances ?? 0}"]`,
    `[EvalStyleBlunders "${st?.blunders ?? 0}"]`,
    `[EvalStyleBlunderRatePct "${fmt(st?.blunder_rate_pct)}"]`,
    `[EvalStyleHadDisadvantage "${st?.had_disadvantage ? "true" : "false"}"]`,
    `[EvalStyleRecoveredFromDisadvantage "${st?.recovered_from_disadvantage ? "true" : "false"}"]`,
    `[EvalStyleCriticalPositions "${st?.critical_positions ?? 0}"]`,
    `[EvalStyleAvgCriticalTimeS "${fmt(st?.avg_critical_time_s)}"]`,
    `[EvalStyleResult "${st?.result || ""}"]`,
    `[EvalStyleWin "${st?.win ? "true" : "false"}"]`,
    `[EvalStyleAvgTimePerMoveS "${fmt(st?.avg_time_per_move_s)}"]`,
    `[EvalStyleOppAvgTimePerMoveS "${fmt(st?.opp_avg_time_per_move_s)}"]`,
    `[EvalStyleClockDiffS "${fmt(st?.clock_diff_s)}"]`,
    `[EvalStyleAvgDisadvantageTimeS "${fmt(st?.avg_disadvantage_time_s)}"]`,
  ];
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
    if (ply === history.length - 1) {
      const o = metrics.opening;
      const mid = metrics.middlegame;
      const e = metrics.endgame;
      bits.push(
        `metrics summary: castle=${o?.opening_castle_fullmove ?? "none"} phaseEnd=${o?.phase_end_fullmove} mgPly=${mid?.middlegame_start_ply ?? "-"} egPly=${e?.endgame_start_ply ?? "-"} center=${fmt(o?.opening_center_control_pct)} tempoWaste=${fmt(o?.opening_tempo_waste_rate_pct)} space=${fmt(mid?.middlegame_space_advantage_pct)} islands=${fmt(mid?.middlegame_pawn_islands_avg)} kingCentr=${fmt(e?.king_centralization, 2)}`
      );
    }
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
    const comment =
      pawns != null ? ` {[%eval ${pawns.toFixed(2)}]}` : "";
    const num = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) parts.push(`${num}. ${m.san}${comment}`);
    else parts.push(`${m.san}${comment}`);
  }
  return parts.join(" ");
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
  const fromPath = which.stdout.trim();
  return fromPath || null;
}

function stockfishEvals(fens: string[]): number[] | null {
  const bin = resolveStockfishBin();
  if (!bin) return null;
  console.log("Using stockfish:", bin);
  const input = [
    "uci",
    "isready",
    "setoption name Hash value 16",
    "setoption name Threads value 1",
    ...fens.flatMap((fen) => [
      "ucinewgame",
      `position fen ${fen}`,
      "go depth 12",
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
  const cps: number[] = [];
  let lastCp = 0;
  for (const line of lines) {
    const score = line.match(/score cp (-?\d+)/);
    const mate = line.match(/score mate (-?\d+)/);
    if (score) lastCp = Number(score[1]);
    if (mate) lastCp = Number(mate[1]) > 0 ? 10000 : -10000;
    if (line.startsWith("bestmove")) cps.push(lastCp);
  }
  if (cps.length !== fens.length) return null;
  return cps.map((stm, i) => toWhiteCp(fens[i], stm));
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

function extractClkTags(raw: string): string[] {
  return [...raw.matchAll(/\[%clk\s+([^\]]+)\]/gi)].map((m) => m[1].trim());
}

function buildAllMoveText(
  raw: string,
  metrics: Awaited<ReturnType<typeof analyzeHeuristicGame>>,
  evalsPawns: Array<number | null>
): string {
  const chess = new Chess();
  chess.loadPgn(raw, { strict: false });
  const history = chess.history({ verbose: true });
  const clks = extractClkTags(raw);
  const parts: string[] = [];
  for (let ply = 0; ply < history.length; ply += 1) {
    const m = history[ply];
    const bits: string[] = [];
    if (clks[ply]) bits.push(`[%clk ${clks[ply]}]`);
    const pawns = evalsPawns[ply + 1];
    if (pawns != null) bits.push(`[%eval ${pawns.toFixed(2)}]`);
    const phase = phaseComment(ply, metrics);
    if (phase) bits.push(phase);
    if (ply === history.length - 1) {
      const o = metrics.opening;
      const mid = metrics.middlegame;
      const e = metrics.endgame;
      bits.push(
        `metrics summary: castle=${o?.opening_castle_fullmove ?? "none"} phaseEnd=${o?.phase_end_fullmove} mgPly=${mid?.middlegame_start_ply ?? "-"} egPly=${e?.endgame_start_ply ?? "-"} center=${fmt(o?.opening_center_control_pct)} tempoWaste=${fmt(o?.opening_tempo_waste_rate_pct)} space=${fmt(mid?.middlegame_space_advantage_pct)} islands=${fmt(mid?.middlegame_pawn_islands_avg)} kingCentr=${fmt(e?.king_centralization, 2)}`
      );
    }
    const comment = bits.length ? ` {${bits.join(" ")}}` : "";
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
  const white = headerValue(raw, "White") || "";
  const userColor: "white" | "black" =
    process.env.USER_COLOR === "black"
      ? "black"
      : process.env.USER_COLOR === "white"
        ? "white"
        : white.toLowerCase().includes("pedro") ||
            white.toLowerCase().includes("samplewhite")
          ? "white"
          : "white";

  const studyGame = toStudyGame(raw, userColor);
  const metrics = await analyzeHeuristicGame(studyGame);
  if (!metrics.opening || !metrics.middlegame || !metrics.endgame) {
    throw new Error("Heuristic analysis returned empty metrics");
  }

  const baseHeaders = stripMoveText(raw);
  const heurHeaders = heuristicHeaders(metrics);

  const fens = collectFens(raw);
  const cps = stockfishEvals(fens);
  const usedEngine = Boolean(cps);
  const evalsCp = cps || fens.map(() => 0);
  const evalsPawns = evalsCp.map((cp) => cp / 100);
  const evalMetrics = analyzeEvalBucketMetrics(studyGame, evalsCp);
  const evalHdr = evalHeaders(evalMetrics, usedEngine);

  const allHeaders = [
    '[Annotator "chess-app heuristics+eval"]',
    ...heurHeaders.filter((h) => !h.startsWith("[Annotator")),
    ...evalHdr.filter((h) => !h.startsWith("[Annotator")),
  ];
  const allBody = buildAllMoveText(raw, metrics, evalsPawns);
  writeFileSync(OUT_ALL, `${baseHeaders}\n${allHeaders.join("\n")}\n\n${allBody}\n`);
  console.log("Wrote", OUT_ALL);

  if (WRITE_SPLIT) {
    const heurBody = buildHeuristicMoveText(raw, metrics);
    writeFileSync(OUT_HEUR, `${baseHeaders}\n${heurHeaders.join("\n")}\n\n${heurBody}\n`);
    const evalBody = buildEvalMoveText(raw, evalsPawns);
    writeFileSync(OUT_EVAL, `${baseHeaders}\n${evalHdr.join("\n")}\n\n${evalBody}\n`);
    console.log("Wrote", OUT_HEUR);
    console.log("Wrote", OUT_EVAL);
  }

  console.log("user_color", userColor);
  console.log("plies", fens.length - 1);
  console.log("castle", metrics.opening.opening_castle_fullmove);
  console.log("phase_end", metrics.opening.phase_end_fullmove);
  console.log("mg_start", metrics.middlegame.middlegame_start_ply);
  console.log("eg_start", metrics.endgame.endgame_start_ply);
  console.log("style_sac", evalMetrics.style?.sacrifice_moves);
  console.log("style_escapes", evalMetrics.style?.threat_escapes);
  console.log("style_near_enemy_king", evalMetrics.style?.trades_near_enemy_king);
  console.log("mg_blunders", evalMetrics.middlegameEval?.blunders);
  console.log("eg_blunders", evalMetrics.endgameEval?.blunders);
  if (!usedEngine) {
    console.log("NOTE: stockfish not found; eval metrics use zero CP fallback");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
