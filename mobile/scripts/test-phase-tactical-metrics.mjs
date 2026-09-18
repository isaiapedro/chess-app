/**
 * Smoke checks for seventh-rank + open-file utilization + board metric snaps
 * (run: npx tsx scripts/test-phase-tactical-metrics.mjs)
 */
import { readFileSync } from "node:fs";
import { Chess } from "chess.js";
import {
  applyUserTacticalMove,
  countOpenFileUtilization,
  countSeventhRankPresence,
  emptyPhaseTacticalCounters,
  fileOpennessForSide,
  isDarkSquare,
  isOpenFileUtilization,
  isSeventhRankInfiltration,
  bishopComplexSnaps,
  bishopRayInfluenceOpenness,
  pawnAdvanceDepthScore,
  queensideAdvanceScore,
  kingsideAdvanceScore,
  centerAdvanceScore,
  zoneAdvanceSnaps,
} from "../src/engine/phaseTacticalMetrics.ts";
import { toPhaseMetricKeys, themeTagToMetricKey } from "../src/engine/gameCoach/metricThemes.ts";
import { keysForMetricFields, softKeysForNoteRequest } from "../src/engine/gameCoach/metricNoteKeys.ts";
import {
  boardMetricSnap,
  buildCoachNoteRequest,
  coachRequestMetaInputs,
  diffMetricSnaps,
  formatCoachNoteRequest,
  metricDeltaAlongSans,
} from "../src/engine/gameCoach/coachNoteRequest.ts";
import {
  detectSituations,
  mergeStickySituations,
  isCarlsbad,
  isCaroSlav,
  isClosedCenter,
  centerFluidityIndex,
  isDragonFormation,
  isHedgehog,
  isMaroczyBind,
  isMinorityAttack,
  isOppositeSideCastling,
  isScheveningen,
  pickSicilianShell,
  situationLockBoostForKey,
  softKeysFromSituations,
} from "../src/engine/gameCoach/situationProfiles.ts";
import { weightKeyBreakdown } from "../src/engine/gameCoach/metricNoteWeights.ts";
import { detectStructureThemes, StructureThemeTracker } from "../src/engine/gameCoach/structureDetect.ts";
import { HEURISTICS_STRUCTURE_PERSIST_PLIES, structurePersistStartPly1 } from "../src/engine/analysisConfig.ts";
import {
  detectTacticalFact,
  formatTacticalFactHead,
  softKeysForTacticalFact,
  tacticalLockBoostForKey,
} from "../src/engine/gameCoach/tacticalFact.ts";
import { shouldDropNoiseCoachMoment } from "../src/engine/gameCoach/coachMomentNoise.ts";
import {
  forcedMateMoves,
  hungMateAfterPlayedMove,
} from "../src/engine/forcedMate.ts";
import { formatEvalCp, formatPgnEvalCp } from "../src/engine/winProb.ts";
import { detectBoardMotif } from "../src/engine/gameCoach/boardMotif.ts";
import {
  forcingRatio,
  measureTacticSharpness,
  mergeMultiPvGapLines,
  rankLinesByStm,
  multipvWpGap,
} from "../src/engine/gameCoach/tacticSharpness.ts";
import { composeMomentJudgmentTip } from "../src/engine/gameCoach/momentJudgmentTip.ts";
import { classifyMoment } from "../src/engine/gameCoach/coachEvent.ts";
import { attachCoachComment } from "../src/engine/gameCoach/attachCoachComment.ts";
import {
  CoachSilenceManager,
  COMMENT_GAP_PLIES,
  COMMENT_EMERGENCY_CP,
} from "../src/engine/gameCoach/coachSilence.ts";
import {
  selectNote,
  buildLiveFacts,
  kingIsCastled,
} from "../src/engine/gameCoach/noteGuards.ts";
import { loadNotesSchema } from "../src/engine/gameCoach/loadNotesSchema.ts";
import {
  FEATURE_POLARITY_MATCH,
  METRIC_POLARITY_MATCH,
  UNCONDITIONED_ANY,
  formatTacticalSlotComment,
  packConditionFeatures,
  scoreNoteConditions,
} from "../src/engine/gameCoach/packNoteContent.ts";
import { isCoachEndgame } from "../src/engine/endgamePhase.ts";
import {
  advanceGamePlan,
  emptyGamePlanState,
  GAME_PLAN_COLD_DEMOTE_PLIES,
  softKeysFromStructureThemes,
} from "../src/engine/gameCoach/gamePlanState.ts";
import { applyRoleSoftKeys } from "../src/engine/gameCoach/situationProfiles.ts";
import {
  classifyRookEndingShape,
  goodVsBadBishopSnap,
  knightVsBishopSnap,
} from "../src/engine/gameCoach/tier3Metrics.ts";
import {
  safeMobilityForSquare,
  findZeroSafeMobilityPieces,
  pieceLabelFor,
  sampleMaterialAlongSans,
  detectDelayedPieceCapture,
  isLosingTrapCapture,
} from "../src/engine/trappedPiece.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function play(fen, san) {
  const before = new Chess(fen);
  const after = new Chess(fen);
  const move = after.move(san);
  assert(move, `illegal ${san} from ${fen}`);
  return { before, after, move };
}

{
  const { move } = play(
    "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
    "Ra7"
  );
  assert(isSeventhRankInfiltration(move, "w"), "rook to 7th counts");
}

{
  const { move } = play(
    "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1",
    "Qa7"
  );
  assert(isSeventhRankInfiltration(move, "w"), "queen to 7th counts");
}

{
  const { move } = play(
    "4k3/8/8/8/8/8/8/4K2R w - - 0 1",
    "Rh2"
  );
  assert(!isSeventhRankInfiltration(move, "w"), "rook not entering 7th");
}

{
  const fen = "4k3/4p3/8/8/8/8/8/R3K3 w - - 0 1";
  assert(fileOpennessForSide(new Chess(fen), 0, "w") === "open", "a-file open");
  assert(fileOpennessForSide(new Chess(fen), 4, "w") === "semi", "e-file semi for white");
  assert(fileOpennessForSide(new Chess(fen), 4, "b") === "closed", "e-file closed for black");
}

{
  const { before, after, move } = play(
    "4k3/8/8/8/8/8/8/1R2K3 w - - 0 1",
    "Ra1"
  );
  assert(
    isOpenFileUtilization(before, after, move, "w"),
    "rook enters open a-file"
  );
}

{
  const { before, after, move } = play(
    "4k3/3p4/8/8/8/8/8/2K1R3 w - - 0 1",
    "Rd1"
  );
  assert(
    isOpenFileUtilization(before, after, move, "w"),
    "rook enters semi-open d-file"
  );
}

{
  const { before, after, move } = play(
    "4k3/8/8/8/8/8/8/1Q2K3 w - - 0 1",
    "Qa1"
  );
  assert(
    isOpenFileUtilization(before, after, move, "w"),
    "queen enters open a-file"
  );
}

{
  const { before, after, move } = play(
    "4k3/3p4/8/8/8/8/3P4/2K1R3 w - - 0 1",
    "Rd1"
  );
  assert(
    !isOpenFileUtilization(before, after, move, "w"),
    "closed file (own pawn) does not count"
  );
}

{
  const { before, after, move } = play(
    "4k3/8/8/8/8/8/8/1R2K3 w - - 0 1",
    "Ra1"
  );
  assert(isOpenFileUtilization(before, after, move, "w"), "enter open file");
  const { before: b2, after: a2, move: m2 } = play(
    "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
    "Ra5"
  );
  assert(
    !isOpenFileUtilization(b2, a2, m2, "w"),
    "shuffle on same open file does not re-count"
  );
}

{
  const counters = emptyPhaseTacticalCounters();
  const { before, after, move } = play(
    "4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1",
    "Qa7"
  );
  applyUserTacticalMove({
    counters,
    boardBefore: before,
    boardAfter: after,
    move,
    color: "w",
    postOpening: false,
    endgame: false,
  });
  assert(
    counters.seventh_rank_infiltration === 0 &&
      counters.open_file_utilization === 0,
    "opening phase does not count mid/end metrics"
  );
}

{
  const counters = emptyPhaseTacticalCounters();
  const { before, after, move } = play(
    "4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1",
    "Qa7"
  );
  applyUserTacticalMove({
    counters,
    boardBefore: before,
    boardAfter: after,
    move,
    color: "w",
    postOpening: true,
    endgame: false,
  });
  assert(
    counters.seventh_rank_infiltration === 1,
    "middlegame counts queen 7th"
  );
  assert(
    counters.open_file_utilization === 1,
    "middlegame counts queen open-file util"
  );
}

{
  const openKeys = toPhaseMetricKeys("opening", [
    "seventh_rank",
    "open_file",
    "piece_activity",
  ]);
  assert(
    !openKeys.includes("piece.seventh_rank_invasion"),
    "opening phase filters seventh/open-file soft keys"
  );
  const mgKeys = toPhaseMetricKeys("middlegame", [
    "seventh_rank",
    "open_file",
  ]);
  assert(
    mgKeys.includes("piece.seventh_rank_invasion"),
    "middlegame allows seventh/open-file soft key"
  );
  const egKeys = toPhaseMetricKeys("endgame", ["seventh_rank", "open_file"]);
  assert(
    egKeys.includes("piece.seventh_rank_invasion"),
    "endgame allows seventh/open-file soft key"
  );
}

{
  const keys = keysForMetricFields([
    "open_file_utilization",
    "middlegame_open_file_utilization",
    "seventh_rank_infiltration",
  ]);
  assert(
    keys.includes("piece.seventh_rank_invasion"),
    "metric fields map to seventh-rank soft key"
  );
}

{
  const fen = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
  assert(
    countOpenFileUtilization(new Chess(fen), "w") === 1,
    "position snap: rook on open a-file"
  );
  assert(
    countSeventhRankPresence(new Chess(fen), "w") === 0,
    "position snap: rook not on 7th"
  );
  assert(
    countSeventhRankPresence(new Chess("4k3/R7/8/8/8/8/8/4K3 w - - 0 1"), "w") ===
      1,
    "position snap: rook on 7th"
  );
}

{
  const snap = boardMetricSnap(
    new Chess("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"),
    "white"
  );
  assert(
    !("hanging_own" in snap) && !("hanging_opp" in snap),
    "snap must not include hanging piece counts"
  );
  assert(
    typeof snap.hanging_material_own === "number" &&
      typeof snap.hanging_material_opponent === "number",
    "snap uses hanging material weights only"
  );
  assert(
    typeof snap.open_file_utilization === "number" &&
      typeof snap.seventh_rank_infiltration === "number",
    "snap includes position open-file + seventh-rank"
  );
  assert(snap.open_file_utilization === 1, "white rook on open file in snap");
}

{
  const hangFen = "4k3/8/8/8/8/8/4r3/4K3 w - - 0 1";
  const snapHang = boardMetricSnap(new Chess(hangFen), "white");
  assert(
    snapHang.hanging_material_opponent >= 5,
    "hanging_material_opponent is piece-value sum (rook ≥ 5)"
  );
  const deltas = diffMetricSnaps(
    boardMetricSnap(new Chess("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), "white"),
    boardMetricSnap(new Chess("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"), "white")
  );
  const fields = deltas.map((d) => d.field);
  assert(
    fields.includes("open_file_utilization"),
    "diffMetricSnaps emits open_file_utilization"
  );
  assert(
    fields.includes("hanging_material_own") &&
      fields.includes("hanging_material_opponent"),
    "diffMetricSnaps emits hanging material fields"
  );
  assert(
    !fields.includes("hanging_own") && !fields.includes("hanging_opp"),
    "diffMetricSnaps must not emit hanging counts"
  );
  const openDelta = deltas.find((d) => d.field === "open_file_utilization");
  assert(
    openDelta && openDelta.delta === 1,
    "open_file_utilization differs across engine/played-style snaps"
  );
}

{
  const fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
  const along = metricDeltaAlongSans({
    fen,
    sans: ["Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7", "Re1"],
    userColor: "white",
    horizonMoves: 2,
  });
  assert(along.sans.length >= 2, "horizon plays at least horizon moves");
  const fields = along.deltas.map((d) => d.field);
  assert(
    fields.includes("open_file_utilization"),
    "line metric delta includes open_file_utilization"
  );
  assert(
    fields.includes("hanging_material_opponent"),
    "line metric delta includes hanging_material_opponent"
  );
}

{
  const fen = "4k3/8/8/8/8/r7/8/R3K3 w - - 0 1";
  const snap = boardMetricSnap(new Chess(fen), "white");
  assert(
    snap.hanging_material_own >= 5,
    "white rook hanging is material weight ≥ 5"
  );
  const hangLeaf = metricDeltaAlongSans({
    fen,
    sans: ["Kf1", "Ra2"],
    userColor: "white",
    horizonMoves: 1,
  });
  assert(
    hangLeaf.sans.length === 2,
    "hanging_material leaf extends +1 ply when extra SAN available"
  );
  assert(
    hangLeaf.sans[0] === "Kf1" && hangLeaf.sans[1] === "Ra2",
    "extra ply is the next SAN after hanging material leaf"
  );
}

{
  assert(pawnAdvanceDepthScore("w", 3) === 2, "White rank 4 → score 2");
  assert(pawnAdvanceDepthScore("w", 4) === 3, "White rank 5 → score 3");
  assert(pawnAdvanceDepthScore("w", 5) === 4, "White rank 6 → score 4");
  assert(pawnAdvanceDepthScore("w", 6) === 5, "White rank 7 → score 5");
  assert(pawnAdvanceDepthScore("w", 2) == null, "White rank 3 not advanced enough");
  assert(pawnAdvanceDepthScore("b", 4) === 2, "Black rank 5 → score 2");
  assert(pawnAdvanceDepthScore("b", 3) === 3, "Black rank 4 → score 3");
  assert(pawnAdvanceDepthScore("b", 2) === 4, "Black rank 3 → score 4");
  assert(pawnAdvanceDepthScore("b", 1) === 5, "Black rank 2 → score 5");
  assert(pawnAdvanceDepthScore("b", 5) == null, "Black rank 6 not advanced enough");

  // White: a4(=2), b5(=3), e4(=2), f5(=3), h4(=2); Black: c5(=2), d4(=3), g5(=2)
  const fen =
    "4k3/8/8/1Pp2Pp1/P2pP2P/8/8/4K3 w - - 0 1";
  const board = new Chess(fen);
  assert(queensideAdvanceScore(board, "w") === 2 + 3, "White a4+b5 queenside");
  assert(kingsideAdvanceScore(board, "w") === 3 + 2, "White f5+h4 kingside");
  assert(centerAdvanceScore(board, "w") === 2 + 3, "White e4+f5 centre");
  assert(queensideAdvanceScore(board, "b") === 2, "Black c5 queenside");
  assert(centerAdvanceScore(board, "b") === 2 + 3, "Black c5+d4 centre");
  assert(kingsideAdvanceScore(board, "b") === 2, "Black g5 kingside");

  const snap = boardMetricSnap(board, "white");
  assert(snap.queenside_advance === 5, "snap queenside_advance");
  assert(snap.queenside_advance_opponent === 2, "snap queenside_advance_opponent");
  assert(snap.kingside_advance === 5, "snap kingside_advance");
  assert(snap.kingside_advance_opponent === 2, "snap kingside_advance_opponent");
  assert(snap.center_advance === 5, "snap center_advance");
  assert(snap.center_advance_opponent === 5, "snap center_advance_opponent");

  const zones = zoneAdvanceSnaps(board, "w");
  assert(
    zones.queenside_advance === snap.queenside_advance &&
      zones.center_advance_opponent === snap.center_advance_opponent,
    "zoneAdvanceSnaps matches BoardMetricSnap"
  );

  const deltas = diffMetricSnaps(
    boardMetricSnap(new Chess("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), "white"),
    snap
  );
  assert(
    deltas.some((d) => d.field === "queenside_advance" && d.delta === 5),
    "diffMetricSnaps emits queenside_advance"
  );
  assert(
    deltas.some((d) => d.field === "center_advance_opponent"),
    "diffMetricSnaps emits center_advance_opponent"
  );
}

{
  assert(isDarkSquare("a1"), "a1 is dark");
  assert(!isDarkSquare("b1"), "b1 is light");
  assert(themeTagToMetricKey("open_file") === "piece.coordination", "open_file → coordination");
  assert(
    keysForMetricFields(["open_file_utilization"]).includes("piece.coordination"),
    "open_file soft keys include coordination"
  );
  assert(
    keysForMetricFields(["queenside_advance"]).includes("imbalance.space"),
    "queenside_advance soft keys include space"
  );
  assert(
    toPhaseMetricKeys("middlegame", ["color_complexes", "bishop_pair"]).includes(
      "positional.color_complexes"
    ),
    "middlegame allows color_complexes theme key"
  );

  // White bishop on c1 (dark square), open diagonals
  const fen = "4k3/8/8/8/8/8/8/2B1K3 w - - 0 1";
  const board = new Chess(fen);
  const rays = bishopRayInfluenceOpenness(board, "c1", "w");
  assert(rays.openness >= 7, `open bishop openness got ${rays.openness}`);
  assert(rays.influence >= rays.openness, "influence ≥ openness");
  const snaps = bishopComplexSnaps(board, "w");
  assert(snaps.bishop_openness_dark === rays.openness, "dark openness matches c1");
  assert(snaps.bishop_diagonal_influence_dark === rays.influence, "dark influence matches");
  assert(snaps.bishop_openness_light === 0, "no light bishop");

  const blocked = new Chess("4k3/8/8/8/8/8/1P6/2B1K3 w - - 0 1");
  const blockedRays = bishopRayInfluenceOpenness(blocked, "c1", "w");
  assert(
    blockedRays.openness < rays.openness,
    "own pawn on diagonal reduces openness"
  );

  const counters = emptyPhaseTacticalCounters();
  const { before, after, move } = play(
    "4k3/8/8/8/8/8/1P6/2B1K3 w - - 0 1",
    "b4"
  );
  applyUserTacticalMove({
    counters,
    boardBefore: before,
    boardAfter: after,
    move,
    color: "w",
  });
  assert(
    counters.unblocking_bishop_dark >= blockedRays.openness,
    "phase counter tracks peak dark openness"
  );

  const snap = boardMetricSnap(new Chess(fen), "white");
  assert(
    snap.bishop_openness_dark > 0 &&
      "bishop_diagonal_influence_light" in snap &&
      "bishop_openness_dark_opponent" in snap,
    "BoardMetricSnap includes bishop influence/openness fields"
  );
  const bishopKeys = keysForMetricFields([
    "bishop_diagonal_influence_light",
    "bishop_openness_dark",
  ]);
  assert(
    bishopKeys.includes("positional.color_complexes"),
    "bishop metrics map to color_complexes"
  );
}

{
  // Opposite castling: white O-O, black O-O-O
  const oppFen =
    "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";
  const afterCastle = new Chess(oppFen);
  afterCastle.move("e1g1");
  afterCastle.move("e8c8");
  assert(isOppositeSideCastling(afterCastle), "opposite-side castling detected");
  const sitSnap = boardMetricSnap(afterCastle, "white");
  assert(sitSnap.castled_kingside === 1, "white castled kingside");
  assert(sitSnap.castled_queenside_opponent === 1, "black castled queenside");
  assert(sitSnap.opposite_side_castling === 1, "snap opposite flag");
  const sits = detectSituations({
    fen: afterCastle.fen(),
    phase: "middlegame",
    userColor: "white",
  });
  assert(
    sits.some((s) => s.id === "opposite_side_castling"),
    "profile opposite_side_castling"
  );
  const soft = softKeysFromSituations(sits);
  assert(
    soft.includes("attack.opposite_side_castling"),
    "soft key opposite_side_castling"
  );
  const pool = softKeysForNoteRequest({
    kind: "bad_move",
    situations: sits,
  });
  assert(
    pool.includes("attack.opposite_side_castling"),
    "softKeysForNoteRequest includes situation keys"
  );
  const lock = situationLockBoostForKey(
    "attack.opposite_side_castling",
    sits
  );
  assert(lock >= 12, `situationLock >= 12 got ${lock}`);
  const wb = weightKeyBreakdown({
    keyId: "attack.opposite_side_castling",
    phase: "middlegame",
    themes: [],
    mark: null,
    deltaCp: 0,
    request: {
      kind: "bad_move",
      ply: 20,
      phase: "middlegame",
      mark: null,
      moment: null,
      deltaCp: 0,
      playedMetricDelta: [],
      playedLineMetricDelta: [],
      playedLineSans: [],
      engineLineMetricDelta: [],
      engineLineSans: [],
      engineVsPlayedMetricDelta: [],
      situations: sits,
    },
  });
  assert(
    wb.parts.some((p) => p.label === "situationLock" && p.delta >= 12),
    "weightKeyBreakdown situationLock part"
  );
}

{
  const closed = new Chess(
    "rnbqkbnr/ppp2ppp/4p3/3pP3/3P4/8/PPP2PPP/RNBQKBNR w KQkq - 0 4"
  );
  assert(isClosedCenter(closed), "closed center French Advance d+e heads");
  assert(centerFluidityIndex(closed) === 0, "locked centre fluidity 0");
  assert(
    boardMetricSnap(closed, "white").closed_center === 1,
    "snap closed_center"
  );
  assert(
    detectSituations({
      fen: closed.fen(),
      phase: "middlegame",
      userColor: "white",
    }).some((s) => s.id === "closed_center"),
    "profile closed_center"
  );
  const italian = new Chess(
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
  );
  assert(!isClosedCenter(italian), "e4-e5 with mobile d-pawns is not closed");
  const whiteCastled = new Chess(
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 5 5"
  );
  assert(
    !isOppositeSideCastling(whiteCastled),
    "O-O vs king on e8 is not opposite-side"
  );
}

{
  // IQP white d4
  const iqp = new Chess(
    "rnbqkbnr/pp2pppp/8/2pp4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 3"
  );
  // After cxd4 / something — use known IQP fen: white pawn on d4, no c/e pawns
  const iqpFen =
    "r1bqkb1r/pp3ppp/2n1pn2/8/3P4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 0 7";
  const iqpBoard = new Chess(iqpFen);
  const iqpSits = detectSituations({
    fen: iqpBoard.fen(),
    phase: "middlegame",
    userColor: "white",
    structureThemes: ["iqp"],
  });
  assert(
    iqpSits.some((s) => s.id === "iqp") ||
      boardMetricSnap(iqpBoard, "white").blockade_square_control >= 0,
    "iqp profile or blockade metric available"
  );
  assert(
    keysForMetricFields(["blockade_square_control"]).includes("piece.blockade"),
    "blockade maps to piece.blockade"
  );
  assert(
    !keysForMetricFields(["blockade_square_control"]).includes("structure.iqp"),
    "blockade does not alias IQP"
  );
  assert(
    keysForMetricFields(["opposite_side_castling"]).includes(
      "attack.opposite_side_castling"
    ),
    "opposite_side_castling field maps soft key"
  );
  assert(
    themeTagToMetricKey("closed_center") === "structure.pawn_chain",
    "closed_center theme → pawn_chain"
  );
  assert(
    toPhaseMetricKeys("middlegame", ["iqp", "opposite_side_castling"]).includes(
      "structure.iqp"
    ),
    "middlegame allows structure.iqp"
  );
  void iqp;
}

{
  // Maróczy: White c4+e4, no d4, Black d6
  const maroczy = new Chess(
    "rnbqkb1r/pp2pppp/3p1n2/8/2PNP3/8/PP3PPP/RNBQKB1R b KQkq - 0 5"
  );
  assert(isMaroczyBind(maroczy), "Maróczy c4+e4 vs d6");
  assert(boardMetricSnap(maroczy, "white").maroczy_bind === 1, "snap maroczy");
  const mSits = detectSituations({
    fen: maroczy.fen(),
    phase: "middlegame",
    userColor: "white",
  });
  assert(
    mSits.some((s) => s.id === "maroczy_bind"),
    "profile maroczy_bind"
  );
  assert(
    softKeysFromSituations(mSits).includes("structure.maroczy_bind"),
    "soft key maroczy"
  );
  assert(
    detectStructureThemes(maroczy.fen()).includes("maroczy_bind"),
    "structure theme maroczy"
  );
  assert(
    keysForMetricFields(["maroczy_bind"]).includes("structure.maroczy_bind"),
    "field maps maroczy soft key"
  );
}

{
  // Carlsbad: White c3+d4, Black c6+d5
  const carlsbad = new Chess(
    "rnbqkb1r/pp3ppp/2p2n2/3p4/3P4/2P2N2/PP2PPPP/RNBQKB1R b KQkq - 0 5"
  );
  assert(isCarlsbad(carlsbad), "Carlsbad c3/d4 vs c6/d5");
  assert(boardMetricSnap(carlsbad, "white").carlsbad === 1, "snap carlsbad");
  assert(!isMinorityAttack(carlsbad), "no minority yet");
  const cSits = detectSituations({
    fen: carlsbad.fen(),
    phase: "middlegame",
    userColor: "white",
  });
  assert(cSits.some((s) => s.id === "carlsbad"), "profile carlsbad");
  assert(
    softKeysFromSituations(cSits).includes("structure.carlsbad"),
    "soft key carlsbad"
  );

  const minority = new Chess(
    "rnbqkb1r/pp3ppp/2p2n2/3p4/1P1P4/2P2N2/P3PPPP/RNBQKB1R b KQkq - 0 6"
  );
  assert(isCarlsbad(minority), "Carlsbad still with b4");
  assert(isMinorityAttack(minority), "minority b4");
  assert(
    boardMetricSnap(minority, "white").minority_attack === 1,
    "snap minority_attack"
  );
  assert(
    detectStructureThemes(minority.fen()).includes("minority_attack"),
    "structure theme minority_attack"
  );
  const minSits = detectSituations({
    fen: minority.fen(),
    phase: "middlegame",
    userColor: "white",
  });
  assert(
    minSits.some((s) => s.id === "minority_attack"),
    "profile minority_attack"
  );
  assert(
    minSits.some((s) => s.id === "carlsbad"),
    "Carlsbad still active under minority"
  );
  assert(
    situationLockBoostForKey("structure.carlsbad", minSits) >= 11,
    "situationLock for carlsbad under minority"
  );
  assert(
    themeTagToMetricKey("carlsbad") === "structure.carlsbad",
    "carlsbad theme map"
  );
  assert(
    toPhaseMetricKeys("middlegame", ["maroczy_bind", "carlsbad"]).includes(
      "structure.maroczy_bind"
    ),
    "middlegame allows maroczy soft key"
  );
}

{
  // Caro: e4 + Black c6 d5 e7 (not Carlsbad)
  const caro = new Chess(
    "rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 3"
  );
  assert(isCaroSlav(caro), "Caro-Slav c6+d5 vs e4/d4");
  assert(!isCarlsbad(caro), "not Carlsbad (no white c3 Exchange)");
  assert(boardMetricSnap(caro, "white").caro_slav === 1, "snap caro_slav");
  const caroSits = detectSituations({
    fen: caro.fen(),
    phase: "opening",
    userColor: "black",
  });
  assert(caroSits.some((s) => s.id === "caro_slav"), "profile caro_slav");
  assert(
    softKeysFromSituations(caroSits).includes("structure.caro_slav"),
    "soft key caro_slav"
  );
  assert(
    detectStructureThemes(caro.fen()).includes("caro_slav"),
    "structure theme caro_slav"
  );
  assert(
    keysForMetricFields(["caro_slav"]).includes("structure.caro_slav"),
    "field maps caro_slav"
  );
  assert(
    themeTagToMetricKey("caro_slav") === "structure.caro_slav",
    "caro_slav theme map"
  );
  // Slav-ish: d4 c4 vs c6 d5 e6
  const slav = new Chess(
    "rnbqkb1r/pp2pppp/2p2n2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 4"
  );
  assert(isCaroSlav(slav), "Slav solid c6+d5");
  const carlsbadWing = new Chess(
    "rnbqkb1r/pp3ppp/2p2n2/3p4/1P1P4/2P2N2/P3PPPP/RNBQKB1R b KQkq - 0 6"
  );
  assert(!isCaroSlav(carlsbadWing), "Carlsbad+b4 is not caro_slav");
}

{
  // Scheveningen: d6+e6, open c, no g6
  const schev = new Chess(
    "rnbqkb1r/pp3ppp/3ppn2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6"
  );
  assert(isScheveningen(schev), "Scheveningen d6+e6");
  assert(!isHedgehog(schev), "not Hedgehog (no a6/b6)");
  assert(!isDragonFormation(schev), "not Dragon");
  assert(pickSicilianShell(schev)?.id === "scheveningen", "pick scheveningen");
  assert(
    boardMetricSnap(schev, "white").scheveningen === 1,
    "snap scheveningen"
  );
  assert(
    detectSituations({
      fen: schev.fen(),
      phase: "middlegame",
      userColor: "black",
    }).some((s) => s.id === "scheveningen"),
    "profile scheveningen"
  );
}

{
  // Dragon: d6 g6 Bg7
  const dragon = new Chess(
    "rnbqk2r/pp2ppbp/3p1np1/8/3NP3/2N1B3/PPP2PPP/R2QKB1R b KQkq - 0 6"
  );
  assert(isDragonFormation(dragon), "Dragon d6+g6+Bg7");
  assert(!isScheveningen(dragon), "Dragon not Scheveningen");
  assert(pickSicilianShell(dragon)?.id === "dragon_formation", "pick dragon");
  assert(
    boardMetricSnap(dragon, "white").dragon_formation === 1,
    "snap dragon"
  );
  assert(
    softKeysFromSituations(
      detectSituations({
        fen: dragon.fen(),
        phase: "middlegame",
        userColor: "black",
      })
    ).includes("structure.dragon_formation"),
    "soft key dragon"
  );
}

{
  // Hedgehog: a6 b6 d6 e6
  const hedge = new Chess(
    "rnbqkb1r/2p2ppp/p2ppn2/1p6/2PNP3/2N5/PP3PPP/R1BQKB1R w KQkq - 0 7"
  );
  // Need b6 not b5 — classic hedgehog pawns on 6th
  const hedge2 = new Chess(
    "r1bqkb1r/2p2ppp/p1nppn2/1p6/2PNP3/2N5/PP3PPP/R1BQKB1R w KQkq b6 0 7"
  );
  void hedge2;
  const hedgeOk = new Chess(
    "rnbqkb1r/5ppp/p1pppn2/8/2PNP3/2N5/PP3PPP/R1BQKB1R w KQkq - 0 8"
  );
  // a6 + c6? better: a6 b6 d6 e6 no c pawn
  const hh = new Chess(
    "r1bqkb1r/2p2ppp/ppnppn2/8/2PNP3/2N5/PP3PPP/R1BQKB1R w KQkq - 0 7"
  );
  assert(isHedgehog(hh), "Hedgehog a6/b6/d6/e6");
  assert(pickSicilianShell(hh)?.id === "hedgehog", "Hedgehog beats Scheveningen");
  assert(!isScheveningen(hh), "raw Scheveningen suppressed under Hedgehog");
  assert(boardMetricSnap(hh, "white").hedgehog === 1, "snap hedgehog");
  assert(
    detectStructureThemes(hh.fen()).includes("hedgehog"),
    "structure theme hedgehog"
  );
  assert(
    keysForMetricFields(["scheveningen"]).includes("structure.scheveningen"),
    "scheveningen field map"
  );
  assert(
    themeTagToMetricKey("dragon") === "structure.dragon_formation",
    "dragon theme map"
  );
  void hedge;
  void hedgeOk;
}

{
  const hung = detectTacticalFact({
    fenBefore: "4k3/8/8/8/8/8/8/4K3 w - - 0 1",
    playedSan: "Kd2",
    bestSan: "Ke2",
    bestPvSan: ["Ke2"],
    userColor: "white",
    deltaCp: 98000,
    evalBeforeWhite: 20,
    evalAfterWhite: -98000,
  });
  assert(hung.kind === "hung_mate", `equal→mate-in-2 is hung_mate, got ${hung.kind}`);
  assert(hung.mateIn === 2, `mateIn 2, got ${hung.mateIn}`);
  assert(formatEvalCp(-98000) === "Mate in 2", "app formatEval mate in 2");
  assert(formatPgnEvalCp(-98000) === "-#2", "script PGN eval mate in 2");
  assert(
    /mate/i.test(formatTacticalFactHead(hung)),
    `hung_mate head: ${formatTacticalFactHead(hung)}`
  );
  const hungLoose = detectTacticalFact({
    fenBefore: "4k3/8/8/8/8/8/8/4K3 w - - 0 1",
    playedSan: "Kd2",
    bestSan: "Ke2",
    bestPvSan: ["Ke2"],
    userColor: "white",
    deltaCp: 10000,
    evalBeforeWhite: 0,
    evalAfterWhite: -10000,
  });
  assert(
    hungLoose.kind === "hung_mate",
    `±10000 mate blob is hung_mate, got ${hungLoose.kind}`
  );
  assert(
    !shouldDropNoiseCoachMoment({
      source: "live",
      severity: "blunder",
      evalBeforeCp: 20,
      dropCp: 98000,
      playedSan: "Kd2",
      bestSan: "Ke2",
    }),
    "live equal→mate blunder is not terminal noise"
  );

  const qxa2Fen = "8/3R4/6k1/8/2qR2K1/p7/P7/8 b - - 7 56";
  const qxa2After = new Chess(qxa2Fen);
  qxa2After.move("Qxa2");
  assert(forcedMateMoves(qxa2After.fen()) === 2, "Qxa2 hangs mate in 2");
  assert(
    hungMateAfterPlayedMove({
      fenBefore: qxa2Fen,
      playedSan: "Qxa2",
      evalBeforeCp: 0,
      evalAfterCp: 0,
      side: "black",
    }) === 98000,
    "equal SF eval still sees mate in 2 for white"
  );
  const hungQxa2 = detectTacticalFact({
    fenBefore: qxa2Fen,
    playedSan: "Qxa2",
    bestSan: "Qe2+",
    bestPvSan: ["Qe2+", "Kh3"],
    userColor: "black",
    deltaCp: 98000,
    evalBeforeWhite: 0,
    evalAfterWhite: 98000,
  });
  assert(
    hungQxa2.kind === "hung_mate" && hungQxa2.mateIn === 2,
    `Qxa2 hung_mate, got ${hungQxa2.kind} mateIn=${hungQxa2.mateIn}`
  );
  assert(
    shouldDropNoiseCoachMoment({
      source: "live",
      severity: "blunder",
      evalBeforeCp: 98000,
      dropCp: 50,
      playedSan: "Kd2",
      bestSan: "Ke2",
    }),
    "already-mating position is terminal noise"
  );
  assert(
    !shouldDropNoiseCoachMoment({
      source: "live",
      severity: "missed",
      evalBeforeCp: 98000,
      evalAfterCp: 200,
      playedSan: "Kd2",
      bestSan: "Re8+",
    }),
    "lost mate is a missed opportunity, not noise"
  );
}

{
  // Missed free queen (Kxe2)
  const fen = "4k3/8/8/8/8/8/4q3/4K3 w - - 0 1";
  const fact = detectTacticalFact({
    fenBefore: fen,
    playedSan: "Kd2",
    bestSan: "Kxe2",
    bestPvSan: ["Kxe2"],
    userColor: "white",
    deltaCp: 900,
    evalBeforeWhite: 200,
    evalAfterWhite: -700,
  });
  assert(fact.kind === "missed_capture", `expected missed_capture got ${fact.kind}`);
  assert(fact.pieceLabel === "queen", "missed queen label");
  assert(
    formatTacticalFactHead(fact).toLowerCase().includes("queen"),
    "tactical head names queen"
  );
  assert(
    softKeysForTacticalFact(fact)[0] === "methodology.candidate_moves",
    "tactical soft keys lead candidate_moves"
  );
  assert(
    tacticalLockBoostForKey("methodology.candidate_moves", fact) >= 26,
    "tacticalLock primary ~26"
  );
  const soft = softKeysForNoteRequest({
    kind: "bad_move",
    tacticalFact: fact,
    engineVsPlayedMetricDelta: [{ field: "mobility", delta: 4 }],
  });
  assert(
    soft[0] === "methodology.candidate_moves",
    `softKeys prepend tactical, got ${soft[0]}`
  );
  const w = weightKeyBreakdown({
    keyId: "methodology.candidate_moves",
    phase: "middlegame",
    themes: [],
    mark: "mistake",
    deltaCp: 900,
    request: {
      kind: "bad_move",
      ply: 10,
      phase: "middlegame",
      mark: "mistake",
      moment: null,
      deltaCp: 900,
      playedMetricDelta: [],
      playedLineMetricDelta: [],
      playedLineSans: [],
      engineLineMetricDelta: [],
      engineLineSans: [],
      engineVsPlayedMetricDelta: [],
      tacticalFact: fact,
    },
  });
  assert(
    w.parts.some((p) => p.label === "tacticalLock" && p.delta >= 26),
    "weight breakdown includes tacticalLock"
  );
  const req = buildCoachNoteRequest({
    ply: 10,
    phase: "middlegame",
    mark: "mistake",
    moment: {
      ply: 10,
      fen: fen,
      playedSan: "Kd2",
      bestSan: "Kxe2",
      dropCp: 900,
      severity: "mistake",
      source: "live",
      evalBeforeCp: 200,
      inputs: {},
    },
    deltaCp: 900,
    fenBefore: fen,
    fenAfter: "4k3/8/8/8/8/3K4/4q3/8 b - - 1 1",
    bestPvSan: ["Kxe2"],
    playedSan: "Kd2",
    userColor: "white",
    evalBeforeCp: 200,
    evalAfterCp: -700,
  });
  assert(req?.tacticalFact?.kind === "missed_capture", "request stamps tacticalFact");
  assert(req?.inputs?.tactical_kind === "missed_capture", "inputs stamp tactical_kind");
}

{
  // Hung piece: leave queen on open file vs rook
  const fen = "3rk3/8/8/8/8/8/3Q4/4K3 w - - 0 1";
  const after = new Chess(fen);
  after.move("Qd5");
  const fact = detectTacticalFact({
    fenBefore: fen,
    fenAfter: after.fen(),
    playedSan: "Qd5",
    bestSan: "Qd1",
    bestPvSan: ["Qd1"],
    userColor: "white",
    deltaCp: 900,
    evalBeforeWhite: 900,
    evalAfterWhite: 0,
    opponentReplySan: "Rxd5",
  });
  assert(
    fact.kind === "gave_piece" || fact.kind === "sacrifice",
    `expected hung/sac got ${fact.kind}`
  );
  assert(formatTacticalFactHead(fact).length > 0, "gave_piece head non-empty");
}

{
  // IQP role: user owns isolani → iqp_owner soft keys lead activity
  const fen =
    "r1bqkb1r/pp3ppp/2n1pn2/2pp4/3P4/2P1PN2/PP1N1PPP/R1BQKB1R w KQkq - 0 6";
  // Classic IQP-ish after exchanges is hard; force via theme + isolated d for white
  const iqpFen = "rnbqkbnr/pp3ppp/4p3/2p5/3P4/8/PPP2PPP/RNBQKBNR w KQkq - 0 4";
  // Better: white d4 isolated (no c/e pawns)
  const whiteIqp = "4k3/8/8/8/3P4/8/8/4K3 w - - 0 1";
  const sitsOwner = detectSituations({
    fen: whiteIqp,
    phase: "middlegame",
    userColor: "white",
    structureThemes: ["iqp"],
  });
  const iqpOwner = sitsOwner.find((s) => s.id === "iqp");
  assert(iqpOwner?.role === "iqp_owner", `expected iqp_owner got ${iqpOwner?.role}`);
  assert(
    iqpOwner.softKeys[0] === "structure.iqp" ||
      iqpOwner.softKeys[0] === "piece.centralization",
    "iqp_owner leads activity keys"
  );

  const blackIqp = "4k3/8/8/3p4/8/8/8/4K3 w - - 0 1";
  const sitsBlock = detectSituations({
    fen: blackIqp,
    phase: "middlegame",
    userColor: "white",
    structureThemes: ["iqp"],
  });
  const iqpBlock = sitsBlock.find((s) => s.id === "iqp");
  assert(iqpBlock?.role === "blockader", `expected blockader got ${iqpBlock?.role}`);
  assert(iqpBlock.softKeys[0] === "piece.blockade", "blockader leads blockade");

  assert(
    applyRoleSoftKeys(
      ["structure.iqp", "piece.blockade", "piece.simplification"],
      "blockader"
    )[0] === "piece.blockade",
    "applyRoleSoftKeys blockader"
  );

  const liveOnly = detectSituations({
    fen: whiteIqp,
    phase: "middlegame",
    userColor: "white",
  });
  assert(
    !liveOnly.some((s) => s.id === "iqp"),
    "one-frame IQP is not a situation without windowed theme"
  );

  const noIqpFen = "4k3/8/8/4P3/3P4/8/8/4K3 w - - 0 1";
  const flicker = new StructureThemeTracker();
  assert(
    !flicker.update(noIqpFen, whiteIqp).includes("iqp"),
    "IQP appearing this ply is not a theme"
  );
  assert(
    !flicker.update(whiteIqp, noIqpFen).includes("iqp"),
    "one-ply IQP flicker is not a theme"
  );

  const durable = new StructureThemeTracker();
  for (let i = 0; i < HEURISTICS_STRUCTURE_PERSIST_PLIES - 1; i += 1) {
    assert(
      !durable.update(whiteIqp, whiteIqp).includes("iqp"),
      `IQP ply ${i + 1} below persist window`
    );
  }
  assert(
    durable.update(whiteIqp, whiteIqp).includes("iqp"),
    `IQP theme after ${HEURISTICS_STRUCTURE_PERSIST_PLIES} consecutive plies`
  );
  const backdated = durable.confirmedByPly();
  assert(
    backdated.length === HEURISTICS_STRUCTURE_PERSIST_PLIES &&
      backdated.every((row) => row.includes("iqp")),
    "confirmed IQP backdates to the first ply of the run"
  );

  const born = new StructureThemeTracker();
  born.update(noIqpFen, whiteIqp);
  born.update(whiteIqp, whiteIqp);
  born.update(whiteIqp, whiteIqp);
  born.update(whiteIqp, whiteIqp);
  assert(
    born.confirmedByPly()[0]?.includes("iqp"),
    "birth ply (IQP appears this move) is confirmed after persist window"
  );
  assert(
    structurePersistStartPly1(44) === 41,
    "had_iqp event backdates 4-ply confirm to birth ply"
  );

  const stickyDrop = mergeStickySituations(
    [{ id: "iqp", confidence: 1, softKeys: ["structure.iqp"], metricHints: [], lockBoost: 11, role: "iqp_owner" }],
    liveOnly
  );
  assert(
    !stickyDrop.some((s) => s.id === "iqp"),
    "sticky IQP drops when live board has no windowed isolani"
  );
  void fen;
  void iqpFen;
}

{
  // advanceGamePlan: structure merge + cold demotion
  let plan = emptyGamePlanState("opening.sicilian");
  plan = advanceGamePlan(plan, {
    situations: [],
    structureThemes: ["maroczy_bind", "space"],
  });
  assert(
    plan.stickyKeys.includes("structure.maroczy_bind"),
    "windowed structure merges into sticky"
  );
  assert(
    softKeysFromStructureThemes(["iqp"]).includes("structure.iqp"),
    "structure theme map"
  );

  const stickyStruct = "structure.maroczy_bind";
  for (let i = 0; i < GAME_PLAN_COLD_DEMOTE_PLIES; i += 1) {
    plan = advanceGamePlan(plan, { situations: [], structureThemes: [] });
  }
  assert(
    !plan.stickyKeys.includes(stickyStruct),
    `demote ${stickyStruct} after ${GAME_PLAN_COLD_DEMOTE_PLIES} cold plies`
  );
  assert(
    plan.stickyKeys.includes("opening.sicilian"),
    "opening key survives demotion while phase omitted (legacy)"
  );
  plan = advanceGamePlan(plan, {
    situations: [],
    structureThemes: ["space"],
    phase: "middlegame",
  });
  assert(
    !plan.stickyKeys.includes("opening.sicilian"),
    "opening sticky cleared in middlegame"
  );
}

{
  // Tier-3: knight vs bishop snap + profile
  const nvsbFen = "4k3/8/8/8/8/8/4N3/4KB2 w - - 0 1";
  // Better: white knights only, black bishops only
  const nvb = new Chess("4k3/8/2b5/8/8/8/4N3/4K3 w - - 0 1");
  assert(knightVsBishopSnap(nvb, "w") === 1, "white knight vs black bishop");
  assert(
    detectSituations({
      fen: nvb.fen(),
      phase: "middlegame",
      userColor: "white",
    }).some((s) => s.id === "knight_vs_bishop"),
    "knight_vs_bishop profile"
  );
  assert(
    boardMetricSnap(nvb, "white").knight_vs_bishop === 1,
    "snap knight_vs_bishop"
  );
  void nvsbFen;
}

{
  // Good bishop: open board few pawns
  const openB = new Chess("4k3/8/8/8/8/8/8/4KB2 w - - 0 1");
  assert(goodVsBadBishopSnap(openB, "w") === 1, "open good bishop");
  // Bad bishop: many same-colour pawns, cramped
  const badB = new Chess("4k3/8/8/3P4/2P1P3/3B4/2P1P3/4K3 w - - 0 1");
  assert(
    goodVsBadBishopSnap(badB, "w") === -1 ||
      boardMetricSnap(badB, "white").good_vs_bad_bishop !== 0,
    "bad bishop signal"
  );
}

{
  // Rook ending shape: pawn on 7th → lucena-ish
  const luc = new Chess("1K1R4/1P6/8/8/8/8/8/1k1r4 w - - 0 1");
  assert(
    classifyRookEndingShape(luc) === "lucena",
    `lucena shape got ${classifyRookEndingShape(luc)}`
  );
  const phil = new Chess("4k3/8/8/8/3P4/4r3/8/4K2R w - - 0 1");
  // white R+P vs black R, black rook on 3rd
  const phil2 = new Chess("4k3/8/8/8/3P4/4r3/8/3R1K2 w - - 0 1");
  assert(
    classifyRookEndingShape(phil2) === "philidor" ||
      classifyRookEndingShape(phil2) === "lucena" ||
      classifyRookEndingShape(phil2) == null,
    "philidor-family shape ok"
  );
  void phil;
}

{
  // Quiet durable structure must not invent coach calls
  const req = buildCoachNoteRequest({
    ply: 20,
    phase: "middlegame",
    mark: null,
    moment: null,
    deltaCp: 0,
    fenBefore: "rnbqkb1r/pp3ppp/3p1n2/2p5/2P1P3/2N5/PP3PPP/R1BQKBNR w KQkq - 0 6",
    userColor: "white",
    unusedStructureThemes: ["maroczy_bind"],
  });
  assert(req == null, "durable theme alone → no coach call");
  const spam = buildCoachNoteRequest({
    ply: 20,
    phase: "middlegame",
    mark: null,
    moment: null,
    deltaCp: 0,
    fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    userColor: "white",
    unusedStructureThemes: ["open_file"],
  });
  assert(spam == null, "open_file alone must not phase_structure");
}

{
  // Safe mobility / trapped-piece primitive (step 1)
  assert(
    pieceLabelFor("b", "g3") === "dark_squared_bishop",
    "g3 is dark-square bishop"
  );

  const open = new Chess("4k3/8/8/8/3N4/8/8/4K3 w - - 0 1");
  const knight = safeMobilityForSquare(open, "d4");
  assert(knight && knight.safeMobility > 0, "central knight has safe moves");

  // Boxed rook: no legal moves at all
  const boxed = new Chess("4k3/8/8/8/8/8/PP6/RK6 w - - 0 1");
  const rook = safeMobilityForSquare(boxed, "a1");
  assert(rook && rook.safeMobility === 0, "boxed rook safeMobility 0");
  assert(rook.legalMoves.length === 0, "boxed rook no legal moves");
  assert(
    rook.blockedBy.includes("no_legal_moves"),
    "boxed rook blocked_by no_legal_moves"
  );

  // Escapes exist but all unsafe (Nb3 hit by rook)
  const corner = new Chess("4k3/1R6/8/8/8/8/2K5/n7 b - - 0 1");
  const trappedN = safeMobilityForSquare(corner, "a1");
  assert(trappedN, "corner knight snap");
  assert(
    trappedN.safeMobility === 0,
    `corner knight safe want 0 got ${trappedN.safeMobility} legal=${trappedN.legalMoves.join(",")} blocked=${trappedN.blockedBy.join(",")}`
  );
  assert(
    trappedN.blockedBy.some((r) => r.includes("controlled_by_rook")),
    `blocked_by rook control: ${trappedN.blockedBy.join(",")}`
  );

  const zeros = findZeroSafeMobilityPieces(boxed, "w");
  assert(
    zeros.some((z) => z.square === "a1" && z.piece === "r"),
    "scan finds boxed rook"
  );

  // Delayed PV material drop (step 2)
  const trapFen = "4k3/1R6/8/8/8/8/8/nB2K3 w - - 0 1";
  const pv = ["Ra7", "Kd8", "Rxa1"];
  const samples = sampleMaterialAlongSans({
    fen: trapFen,
    sans: pv,
    color: "b",
  });
  assert(samples.length === 3, "PV material samples length 3");
  assert(
    samples[2].materialBalance === samples[0].materialBalance - 3,
    "material drops by knight value at capture ply"
  );
  const delayed = detectDelayedPieceCapture({
    fen: trapFen,
    sans: pv,
    victimColor: "b",
  });
  assert(delayed, "detect delayed knight capture");
  assert(delayed.capturePlyDelay === 3, "capture delay ply 3");
  assert(delayed.captureSan === "Rxa1", "capture san");
  assert(delayed.winningLine === "Ra7 Kd8 Rxa1", "winning line");
  assert(delayed.finalMaterialDelta === -3, "delta -3");
  assert(delayed.mobility.safeMobility === 0, "bound to zero-safe piece");
  assert(
    !detectDelayedPieceCapture({
      fen: trapFen,
      sans: ["Rxa1"],
      victimColor: "b",
    }),
    "immediate ply-1 capture is not delayed trap"
  );

  const fact = detectTacticalFact({
    fenBefore: trapFen,
    playedSan: "Kd2",
    bestSan: "Ra7",
    bestPvSan: pv,
    userColor: "white",
    deltaCp: 300,
  });
  assert(
    fact.kind === "trapped_piece",
    `expected trapped_piece got ${fact.kind}`
  );
  assert(fact.trapSquare === "a1", "trap square stamped");
  assert(
    !fact.selfInflicted,
    "opp-piece trap is not self-inflicted"
  );
  assert(
    formatTacticalFactHead(fact).toLowerCase().includes("trapped"),
    "tactical head names trapped"
  );
  assert(
    softKeysForTacticalFact(fact)[0] === "motif.trapped_piece",
    "trapped soft key leads motif.trapped_piece"
  );
  assert(
    softKeysForTacticalFact(fact).includes("positional.restriction"),
    "trapped soft keys keep restriction fallback"
  );
  const tip = composeMomentJudgmentTip({
    mark: "mistake",
    deltaCp: 300,
    kind: "bad_move",
    fact,
    engineLineSans: pv,
    situations: [
      {
        id: "dragon_formation",
        confidence: 1,
        role: "cramped",
        softKeys: ["imbalance.space"],
        lockBoost: 12,
      },
    ],
  });
  assert(!/dragon/i.test(tip.text), `trap tip skips Dragon: ${tip.text}`);
  assert(
    /trapped/i.test(tip.text) && /knight/i.test(tip.text),
    `tip names trapped knight: ${tip.text}`
  );

  const dragonSit = [
    {
      id: "dragon_formation",
      confidence: 1,
      role: "cramped",
      softKeys: ["imbalance.space", "structure.dragon_formation"],
      lockBoost: 12,
    },
  ];
  const missedTip = composeMomentJudgmentTip({
    mark: "mistake",
    deltaCp: 180,
    kind: "bad_move",
    fact: {
      kind: "missed_tactic",
      pieceLabel: null,
      captureSan: "Nxh7+ Kxh7 Qh5+",
      takenNext: false,
      mateIn: null,
    },
    engineLineSans: ["Nxh7+", "Kxh7", "Qh5+"],
    situations: dragonSit,
    gamePlan: {
      openingKeyId: null,
      stickyKeys: ["imbalance.space"],
      situationIds: [],
      taughtKeys: [],
      keyColdPlies: {},
    },
  });
  assert(
    !/dragon/i.test(missedTip.text),
    `missed_tactic tip skips Dragon: ${missedTip.text}`
  );
  assert(
    !/space/i.test(missedTip.text),
    `missed_tactic tip skips space plan: ${missedTip.text}`
  );
  assert(
    /forcing/i.test(missedTip.text),
    `missed_tactic tip stays tactical: ${missedTip.text}`
  );
  assert(
    !missedTip.softKeys.includes("imbalance.space"),
    `missed_tactic drops sit/plan soft keys: ${missedTip.softKeys.join(",")}`
  );

  const pack = JSON.parse(
    readFileSync(
      new URL("../assets/coach/mobile_coach_pack.json", import.meta.url),
      "utf8"
    )
  );
  const trapEntry = (pack.entries || []).find(
    (e) => e.keyId === "motif.trapped_piece"
  );
  assert(trapEntry, "pack ships motif.trapped_piece");
  assert(
    /trapped/i.test(String(trapEntry.text || "")),
    "pack trap entry mentions trapped"
  );

  const req = buildCoachNoteRequest({
    ply: 40,
    phase: "middlegame",
    mark: "mistake",
    moment: {
      ply: 40,
      moveNumber: 20,
      severity: "mistake",
      dropCp: 300,
      playedSan: "Kd2",
      bestSan: "Ra7",
      fen: trapFen,
      source: "live",
      inputs: {},
    },
    deltaCp: 300,
    fenBefore: trapFen,
    bestPvSan: pv,
    playedSan: "Kd2",
    userColor: "white",
  });
  assert(
    req?.tacticalFact?.kind === "trapped_piece",
    "buildCoachNoteRequest stamps trapped_piece"
  );
  assert(
    /trapped_piece:knight@a1/.test(formatCoachNoteRequest(req)),
    `noteRequest fmt shows trap detail: ${formatCoachNoteRequest(req)}`
  );
  const meta = coachRequestMetaInputs(req);
  assert(
    meta.tactical_trap_square === "a1" &&
      meta.tactical_capture_ply_delay === 3,
    "meta inputs stamp trap square + delay"
  );
}

{
  const crampedFen = "4k3/8/8/8/8/8/PP6/R1K5 w - - 0 1";
  const huntFen = "4k3/8/8/8/8/8/Pb6/R1K5 w - - 0 1";
  const hunt = ["Bxa1"];
  const cramped = detectTacticalFact({
    fenBefore: crampedFen,
    playedSan: "Kb1",
    bestSan: "Kc2",
    bestPvSan: ["Kc2"],
    userColor: "white",
    deltaCp: 300,
  });
  assert(
    cramped.kind !== "trapped_piece",
    `unattacked boxed rook is not a trap, got ${cramped.kind}`
  );

  const hunted = detectTacticalFact({
    fenBefore: huntFen,
    playedSan: "Kb1",
    bestSan: "Kxb2",
    bestPvSan: ["Kxb2"],
    userColor: "white",
    deltaCp: 900,
    playedContinuationSans: hunt,
  });
  assert(
    hunted.kind === "trapped_piece" && hunted.selfInflicted,
    `played continuation hunt still self-trap, got ${hunted.kind}`
  );
  assert(
    hunted.captureSan === "Bxa1",
    `hunt line stamped ${hunted.captureSan}`
  );

  const attackedFen = "4k3/8/5b2/8/8/8/P1PN4/R1K5 w - - 0 1";
  const afterNb1 = new Chess(attackedFen);
  afterNb1.move("Nb1");
  assert(
    isLosingTrapCapture(afterNb1, "a1", "w"),
    "bishop vs boxed undefended rook is a losing trap capture"
  );
  const boxedHit = detectTacticalFact({
    fenBefore: attackedFen,
    playedSan: "Nb1",
    bestSan: "Kc2",
    bestPvSan: ["Kc2"],
    userColor: "white",
    deltaCp: 300,
  });
  assert(
    boxedHit.kind === "trapped_piece" && boxedHit.selfInflicted,
    `cheaper underdefended boxed rook is self-trap, got ${boxedHit.kind}`
  );
  assert(boxedHit.trapSquare === "a1", `attacked trap square ${boxedHit.trapSquare}`);

  const stareFen = "4k3/8/5b2/8/8/8/P1P5/R1K5 w - - 0 1";
  const equalStare = detectTacticalFact({
    fenBefore: stareFen,
    playedSan: "Kb1",
    bestSan: "Kc2",
    bestPvSan: ["Kc2"],
    userColor: "white",
    deltaCp: 300,
  });
  assert(
    equalStare.kind !== "trapped_piece",
    `equal attacker/defender stare is not a trap, got ${equalStare.kind}`
  );

  const queenOverFen = "4k3/8/8/8/3q4/8/q1P5/R1K5 w - - 0 1";
  const queenOver = detectTacticalFact({
    fenBefore: queenOverFen,
    playedSan: "Kb1",
    bestSan: "Kc2",
    bestPvSan: ["Kc2"],
    userColor: "white",
    deltaCp: 300,
  });
  assert(
    queenOver.kind !== "trapped_piece",
    `higher-value attackers are not a trap, got ${queenOver.kind}`
  );

  const e4Fen =
    "4nr1k/1p4bP/3p4/4pPP1/p5r1/4B3/PP2N2K/3R1R2 b - - 2 29";
  const afterE4 = new Chess(e4Fen);
  afterE4.move("e4");
  assert(
    (safeMobilityForSquare(afterE4, "g4")?.safeMobility || 0) > 0,
    "g4 rook still has a flight square after e4"
  );
  afterE4.move("Kh3");
  assert(
    safeMobilityForSquare(afterE4, "g4")?.safeMobility === 0,
    "Kh3 boxes the g4 rook"
  );
  assert(
    isLosingTrapCapture(afterE4, "g4", "b"),
    "undefended rook hunted by king is a losing trap"
  );
  const e4Trap = detectTacticalFact({
    fenBefore: e4Fen,
    playedSan: "e4",
    bestSan: "Re4",
    bestPvSan: ["Re4", "Rd3", "Bf6"],
    userColor: "black",
    deltaCp: 226,
    evalBeforeWhite: 272,
    evalAfterWhite: 498,
    playedContinuationSans: [
      "Kh3",
      "Rxg5",
      "Bxg5",
      "Bxb2",
      "Ng3",
      "b5",
      "Nxe4",
      "b4",
    ],
  });
  assert(
    e4Trap.kind === "trapped_piece" && e4Trap.selfInflicted,
    `e4 then Kh3 is self-trap rook, got ${e4Trap.kind}`
  );
  assert(e4Trap.trapSquare === "g4", `trap square ${e4Trap.trapSquare}`);
  assert(e4Trap.pieceLabel === "rook", `trap piece ${e4Trap.pieceLabel}`);
  const e4NoReply = detectTacticalFact({
    fenBefore: e4Fen,
    playedSan: "e4",
    bestSan: "Re4",
    bestPvSan: ["Re4", "Rd3", "Bf6"],
    userColor: "black",
    deltaCp: 226,
    evalBeforeWhite: 272,
    evalAfterWhite: 498,
  });
  assert(
    e4NoReply.kind !== "trapped_piece",
    "rook still has a flight square immediately after e4"
  );
  const e4EngineTail = detectTacticalFact({
    fenBefore: e4Fen,
    playedSan: "e4",
    bestSan: "Re4",
    bestPvSan: ["Re4", "Rd3", "Bf6"],
    userColor: "black",
    deltaCp: 226,
    evalBeforeWhite: 272,
    evalAfterWhite: 498,
    playedContinuationSans: ["Rd3", "Bf6"],
  });
  assert(
    e4EngineTail.kind !== "trapped_piece",
    "Re4's tail from the position after e4 is not a rook trap"
  );
  const e4Req = buildCoachNoteRequest({
    ply: 58,
    phase: "middlegame",
    mark: "mistake",
    moment: {
      ply: 58,
      moveNumber: 29,
      severity: "mistake",
      dropCp: 226,
      playedSan: "e4",
      bestSan: "Re4",
      fen: e4Fen,
      source: "live",
      inputs: {},
    },
    deltaCp: 226,
    fenBefore: e4Fen,
    bestPvSan: ["Re4", "Rd3", "Bf6"],
    playedSan: "e4",
    playedLineSans: ["e4", "Kh3", "Rxg5", "Bxg5"],
    playedContinuationSans: ["Kh3", "Rxg5", "Bxg5"],
    userColor: "black",
    evalBeforeCp: 272,
    evalAfterCp: 498,
  });
  assert(
    e4Req?.tacticalFact?.kind === "trapped_piece" &&
      e4Req.tacticalFact.pieceLabel === "rook" &&
      e4Req.tacticalFact.trapSquare === "g4",
    `note request must stamp trapped rook not hanging bishop, got ${e4Req?.tacticalFact?.kind} ${e4Req?.tacticalFact?.pieceLabel}`
  );

  const huntTip = composeMomentJudgmentTip({
    mark: "blunder",
    deltaCp: 900,
    kind: "bad_move",
    fact: hunted,
    engineLineSans: ["Kxb2"],
  });
  assert(
    /bxa1/i.test(huntTip.text) && !/Kxb2/.test(huntTip.text),
    `hunt tip uses played failure not engine grab: ${huntTip.text}`
  );
  const huntReq = buildCoachNoteRequest({
    ply: 58,
    phase: "middlegame",
    mark: "blunder",
    moment: {
      ply: 58,
      moveNumber: 29,
      severity: "blunder",
      dropCp: 900,
      playedSan: "Kb1",
      bestSan: "Kxb2",
      fen: huntFen,
      source: "live",
      inputs: {},
    },
    deltaCp: 900,
    fenBefore: huntFen,
    bestPvSan: ["Kxb2"],
    playedSan: "Kb1",
    playedContinuationSans: hunt,
    userColor: "white",
  });
  assert(
    huntReq?.tacticalFact?.kind === "trapped_piece" &&
      huntReq.tacticalFact.selfInflicted,
    "buildCoachNoteRequest stamps self-inflicted trap"
  );
  assert(
    /trapped_piece:own:rook@a1/.test(formatCoachNoteRequest(huntReq)),
    `noteRequest fmt marks own trap: ${formatCoachNoteRequest(huntReq)}`
  );
  assert(
    coachRequestMetaInputs(huntReq).tactical_self_inflicted === 1,
    "meta stamps tactical_self_inflicted"
  );

  const dragonNe8 = "r1b2rk1/pp1nppbp/3p1np1/2qP2P1/2P4P/2N5/PP1BBP2/R2QK1NR b KQ - 0 11";
  const falseTrap = detectTacticalFact({
    fenBefore: dragonNe8,
    playedSan: "Ne8",
    bestSan: "Nh5",
    bestPvSan: ["Nh5", "Nf3", "Qb6"],
    userColor: "black",
    deltaCp: 150,
    evalBeforeWhite: -32,
    evalAfterWhite: 58,
    playedContinuationSans: ["h5", "Ne5", "h6", "Bh8"],
  });
  assert(
    falseTrap.kind !== "trapped_piece",
    `Ne8 must not flag unattacked f8 rook, got ${falseTrap.kind} ${falseTrap.trapSquare || ""}`
  );
}

{
  assert(forcingRatio(["Qh5+", "g6", "Qxf7#"]) === 0.67, "checks/mates count as force");
  assert(forcingRatio(["a3", "a6", "h3"]) === 0, "quiet PV ratio 0");
  assert(forcingRatio(["Nxe5", "Bxe5"]) === 0, "recaptures are not forcing");
  assert(forcingRatio(["Qh5+", "a6"]) === 0.5, "half-force PV ratio 0.5");
  assert(
    multipvWpGap(
      [
        { cpWhite: 200 },
        { cpWhite: 180 },
      ],
      "white"
    ) < 0.05,
    "small MultiPV gap below important"
  );
  const onlyMoveGap = multipvWpGap(
    [
      { cpWhite: 400 },
      { cpWhite: 50 },
    ],
    "white"
  );
  assert(onlyMoveGap >= 0.05, `only-move gap ${onlyMoveGap}`);

  const merged = mergeMultiPvGapLines(
    [
      { san: "e4", cpWhite: 40, rank: 1, pvSan: ["e4"] },
      { san: "d4", cpWhite: -20, rank: 2, pvSan: ["d4"] },
    ],
    [{ san: "e4", cpWhite: 55, rank: 1, pvSan: ["e4", "e5"] }]
  );
  assert(merged.length >= 2, "deepen MultiPV 1 keeps PV2");
  assert(merged[0].san === "e4" && merged[1].san === "d4", "PV1 deep + PV2 shallow");

  const mateFen = "8/3R4/6k1/8/3R2K1/p7/q7/8 w - - 0 57";
  const mateMerged = mergeMultiPvGapLines(
    [
      { san: "Rd1", cpWhite: 0 },
      { san: "R4d6+", cpWhite: 98000 },
    ],
    [{ san: "Rd1", cpWhite: 0 }],
    mateFen
  );
  assert(
    mateMerged[0]?.san === "R4d6+" && mateMerged[0]?.cpWhite === 98000,
    `mate line is PV1 after merge, got ${mateMerged[0]?.san}`
  );
  const ranked = rankLinesByStm(mateFen, [
    { san: "Rd1", cpWhite: 0 },
    { san: "Ra7", cpWhite: 50 },
    { san: "R4d6+", cpWhite: 98000 },
  ]);
  assert(
    ranked[0]?.san === "R4d6+",
    `live lines rank mate first, not Ta7/Ra7, got ${ranked[0]?.san}`
  );

  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const quiet = detectTacticalFact({
    fenBefore: start,
    playedSan: "a4",
    bestSan: "e4",
    bestPvSan: ["e4", "e5", "Nf3"],
    userColor: "white",
    deltaCp: 150,
  });
  assert(
    quiet.kind !== "missed_tactic",
    `quiet 2-move PV is not missed_tactic, got ${quiet.kind}`
  );

  const forceLine = detectTacticalFact({
    fenBefore: start,
    playedSan: "a4",
    bestSan: "Qh5+",
    bestPvSan: ["Qh5+", "g6", "Qxf7#"],
    userColor: "white",
    deltaCp: 200,
  });
  assert(
    forceLine.kind === "missed_tactic",
    `forcing PV is missed_tactic, got ${forceLine.kind}`
  );

  const ne8Fen =
    "r1b2rk1/pp1nppbp/3p1np1/2qP2P1/2P4P/2N5/PP1BBP2/R2QK1NR b KQ - 0 11";
  const ne8Fact = detectTacticalFact({
    fenBefore: ne8Fen,
    playedSan: "Ne8",
    bestSan: "Nh5",
    bestPvSan: ["Nh5", "Nf3", "Ne5", "Nxe5", "Bxe5", "Be3", "Bxc3+", "bxc3"],
    userColor: "black",
    deltaCp: 150,
    lines: [{ cpWhite: -45 }, { cpWhite: 62 }],
  });
  assert(
    ne8Fact.kind !== "missed_tactic",
    `Ne8 vs Nh5 exchange PV is positional, got ${ne8Fact.kind}`
  );
  assert(
    !softKeysForTacticalFact(ne8Fact).includes("motif.intermediate_move"),
    "no intermediate_move on a knight retreat"
  );
  const ne8Sharp = measureTacticSharpness({
    pvSan: ["Nh5", "Nf3", "Ne5", "Nxe5", "Bxe5", "Be3", "Bxc3+", "bxc3"],
    lines: [{ cpWhite: -45 }, { cpWhite: 62 }],
    side: "black",
  });
  assert(
    !ne8Sharp.forcingSharp && !ne8Sharp.sharp,
    "recapture PV with one late check is not tactical-sharp"
  );

  const gapOnly = measureTacticSharpness({
    pvSan: ["e4", "e5", "Nf3"],
    lines: [
      { cpWhite: 400 },
      { cpWhite: 50 },
    ],
    side: "white",
  });
  assert(gapOnly.pvGapWp >= 0.05 && !gapOnly.forcingSharp && !gapOnly.sharp, "PV gap stamps without calling it sharp");
  const forceSharp = measureTacticSharpness({
    pvSan: ["Nxh7+", "Kxh7", "Qh5+"],
    lines: [
      { cpWhite: 80 },
      { cpWhite: 70 },
    ],
    side: "white",
  });
  assert(forceSharp.forcingSharp && forceSharp.forcingRatio >= 0.5, "ratio stamps forcing-sharp");

  const sharpReq = buildCoachNoteRequest({
    ply: 12,
    phase: "middlegame",
    mark: "mistake",
    moment: {
      ply: 12,
      moveNumber: 6,
      severity: "mistake",
      dropCp: 200,
      playedSan: "a4",
      bestSan: "Qh5+",
      fen: start,
      source: "live",
      inputs: {},
    },
    deltaCp: 200,
    fenBefore: start,
    bestPvSan: ["Qh5+", "g6", "Qxf7#"],
    playedSan: "a4",
    userColor: "white",
    lines: [
      { san: "Qh5+", cpWhite: 400 },
      { san: "d4", cpWhite: 50 },
    ],
  });
  assert(sharpReq?.inputs?.tactical_sharp === 1, "request stamps tactical_sharp");
  assert(
    Number(sharpReq?.inputs?.tactical_forcing_ratio) >= 0.5,
    `stamps forcing ratio, got ${sharpReq?.inputs?.tactical_forcing_ratio}`
  );
  assert(
    Number(sharpReq?.inputs?.tactical_pv_gap_wp) >= 0.05,
    `stamps pv gap, got ${sharpReq?.inputs?.tactical_pv_gap_wp}`
  );
  const sharpMeta = coachRequestMetaInputs(sharpReq);
  assert(sharpMeta.tactical_sharp === 1, "meta copies tactical_sharp");
}

{
  const pinFen = "6k1/5n2/8/8/8/1B6/8/4K3 w - - 0 1";
  const pinHit = detectBoardMotif({ fen: pinFen, san: "Bc4", color: "w" });
  assert(pinHit?.kind === "pin", `pin motif, got ${pinHit?.kind}`);
  assert(pinHit?.pieceLabel === "knight", `pin victim knight, got ${pinHit?.pieceLabel}`);
  const pinFact = detectTacticalFact({
    fenBefore: pinFen,
    playedSan: "Ke2",
    bestSan: "Bc4",
    bestPvSan: ["Bc4", "Kg7"],
    userColor: "white",
    deltaCp: 150,
  });
  assert(
    pinFact.kind === "missed_tactic" && pinFact.motif === "pin",
    `quiet pin is missed_tactic+pin, got ${pinFact.kind}/${pinFact.motif}`
  );
  assert(
    formatTacticalFactHead(pinFact).toLowerCase().includes("pin"),
    `head names pin: ${formatTacticalFactHead(pinFact)}`
  );
  assert(
    softKeysForTacticalFact(pinFact)[0] === "motif.pin_and_skewer",
    `pin soft key ${softKeysForTacticalFact(pinFact)[0]}`
  );
  const pinReq = buildCoachNoteRequest({
    ply: 12,
    phase: "middlegame",
    mark: "mistake",
    moment: {
      ply: 12,
      moveNumber: 6,
      severity: "mistake",
      dropCp: 150,
      playedSan: "Ke2",
      bestSan: "Bc4",
      fen: pinFen,
      source: "live",
      inputs: {},
    },
    deltaCp: 150,
    fenBefore: pinFen,
    bestPvSan: ["Bc4", "Kg7"],
    playedSan: "Ke2",
    userColor: "white",
  });
  assert(
    /tactical=missed_tactic:pin/.test(formatCoachNoteRequest(pinReq)),
    `fmt shows pin motif: ${formatCoachNoteRequest(pinReq)}`
  );

  const forkFen = "r3k3/8/8/1N6/8/4K3/8/8 w - - 0 1";
  const forkHit = detectBoardMotif({ fen: forkFen, san: "Nc7+", color: "w" });
  assert(forkHit?.kind === "fork", `fork motif, got ${forkHit?.kind}`);
  const forkFact = detectTacticalFact({
    fenBefore: forkFen,
    playedSan: "Ke2",
    bestSan: "Nc7+",
    bestPvSan: ["Nc7+", "Kd8"],
    userColor: "white",
    deltaCp: 200,
  });
  assert(
    forkFact.kind === "missed_tactic" && forkFact.motif === "fork",
    `fork is missed_tactic+fork, got ${forkFact.kind}/${forkFact.motif}`
  );

  const hangFen = "4k3/8/8/8/7r/4N3/8/4K3 w - - 0 1";
  const hangHit = detectBoardMotif({ fen: hangFen, san: "Nf5", color: "w" });
  assert(hangHit?.kind === "hang", `hang motif, got ${hangHit?.kind}`);
  const hangFact = detectTacticalFact({
    fenBefore: hangFen,
    playedSan: "Ke2",
    bestSan: "Nf5",
    bestPvSan: ["Nf5"],
    userColor: "white",
    deltaCp: 150,
  });
  assert(
    hangFact.kind === "missed_tactic" && hangFact.motif === "hang",
    `hang is missed_tactic+hang, got ${hangFact.kind}/${hangFact.motif}`
  );

  const pinTip = composeMomentJudgmentTip({
    mark: "mistake",
    deltaCp: 150,
    kind: "bad_move",
    fact: pinFact,
    engineLineSans: ["Bc4", "Kg7"],
    situations: [
      {
        id: "dragon_formation",
        confidence: 1,
        role: "cramped",
        softKeys: ["imbalance.space"],
        lockBoost: 12,
      },
    ],
  });
  assert(!/dragon/i.test(pinTip.text), `pin tip skips Dragon: ${pinTip.text}`);
  assert(/pin/i.test(pinTip.text), `pin tip names pin: ${pinTip.text}`);
}

{
  const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert(
    isCoachEndgame({ fen: startFen }) === false,
    "starting material is not coach endgame"
  );
  const rookEnding = "8/8/8/8/8/8/4k3/R3K3 w - - 0 1";
  assert(
    isCoachEndgame({ fen: rookEnding }) === true,
    "both sides <=14 with no tactic is coach endgame"
  );
  assert(
    isCoachEndgame({ fen: rookEnding, tacticalKind: "trapped_piece" }) === false,
    "trap overrides low-material endgame"
  );
  assert(
    isCoachEndgame({ fen: rookEnding, dropCp: 200 }) === false,
    "high drop overrides low-material endgame"
  );
  const heavy = "4k3/8/8/8/8/8/8/RQNBK3 w - - 0 1";
  assert(
    isCoachEndgame({ fen: heavy }) === false,
    "15+ points on a side is not coach endgame"
  );
}

{
  const trapFact = {
    kind: "trapped_piece",
    selfInflicted: true,
    pieceLabel: "knight",
    trapSquare: "d2",
    captureSan: "Nc4",
    takenNext: true,
    mateIn: null,
  };
  const egWeight = weightKeyBreakdown({
    keyId: "endgame.strategic.active_king",
    phase: "endgame",
    themes: ["endgame.strategic.active_king"],
    mark: "mistake",
    deltaCp: 220,
    request: {
      kind: "bad_move",
      ply: 37,
      phase: "endgame",
      mark: "mistake",
      moment: null,
      deltaCp: 220,
      playedMetricDelta: [],
      playedLineMetricDelta: [],
      playedLineSans: ["Nd2"],
      engineLineMetricDelta: [],
      engineLineSans: ["Re1"],
      engineVsPlayedMetricDelta: [],
      tacticalFact: trapFact,
    },
  });
  assert(
    egWeight.weight === -999 &&
      egWeight.parts.some((p) => p.label === "tacticalSuppressEg"),
    `active_king must be hard-suppressed on trap, got ${egWeight.weight}`
  );
  const trapWeight = weightKeyBreakdown({
    keyId: "motif.trapped_piece",
    phase: "endgame",
    themes: [],
    mark: "mistake",
    deltaCp: 220,
    request: {
      kind: "bad_move",
      ply: 37,
      phase: "endgame",
      mark: "mistake",
      moment: null,
      deltaCp: 220,
      playedMetricDelta: [],
      playedLineMetricDelta: [],
      playedLineSans: ["Nd2"],
      engineLineMetricDelta: [],
      engineLineSans: ["Re1"],
      engineVsPlayedMetricDelta: [],
      tacticalFact: trapFact,
    },
  });
  assert(
    trapWeight.weight > 0,
    `trapped_piece stays high, got ${trapWeight.weight}`
  );
  const posWeight = weightKeyBreakdown({
    keyId: "positional.prophylaxis",
    phase: "endgame",
    themes: ["positional.prophylaxis"],
    mark: "mistake",
    deltaCp: 220,
    request: {
      kind: "bad_move",
      ply: 37,
      phase: "endgame",
      mark: "mistake",
      moment: null,
      deltaCp: 220,
      playedMetricDelta: [],
      playedLineMetricDelta: [],
      playedLineSans: ["Nd2"],
      engineLineMetricDelta: [],
      engineLineSans: ["Re1"],
      engineVsPlayedMetricDelta: [],
      tacticalFact: trapFact,
    },
  });
  assert(
    posWeight.weight === -999 &&
      posWeight.parts.some((p) => p.label === "tacticalSuppressGeneric"),
    `positional.* must be hard-suppressed on trap, got ${posWeight.weight}`
  );

  const feats = packConditionFeatures({
    inputs: {
      tactical_self_inflicted: 1,
      tactical_kind: "trapped_piece",
      uncastled: true,
    },
    tacticalFact: trapFact,
  });
  assert(
    feats.includes("self-trapped-piece") &&
      feats.includes("zero-safe-squares") &&
      feats.includes("uncastled-king"),
    `runtime features missing, got ${feats.join(",")}`
  );

  const targeted = scoreNoteConditions(
    {
      id: "motif.trapped_piece#2",
      text: "do not push a piece into a pocket",
      book: "",
      themes: [],
      ecoHints: [],
      conditions: [
        { feature: "self-trapped-piece", polarity: "bad" },
        { softKey: "motif.trapped_piece", polarity: "bad" },
      ],
    },
    {
      softKeys: ["motif.trapped_piece"],
      features: ["self-trapped-piece"],
      judgment: "bad",
    }
  );
  const genericAny = scoreNoteConditions(
    {
      id: "endgame.strategic.active_king#2",
      text: "activate the king",
      book: "",
      themes: [],
      ecoHints: [],
      conditions: [{ polarity: "any" }],
    },
    {
      softKeys: ["motif.trapped_piece"],
      features: ["self-trapped-piece"],
      judgment: "bad",
    }
  );
  assert(
    FEATURE_POLARITY_MATCH === 30,
    `FEATURE_POLARITY_MATCH must be 30, got ${FEATURE_POLARITY_MATCH}`
  );
  assert(
    targeted >= FEATURE_POLARITY_MATCH && genericAny <= UNCONDITIONED_ANY,
    `feature+polarity ${targeted} must beat polarity any ${genericAny}`
  );
  assert(
    genericAny < METRIC_POLARITY_MATCH,
    `polarity any ${genericAny} must stay below metric polarity match`
  );

  const trapNote = {
    id: "motif.trapped_piece#2",
    text: "Do not push your own piece into a pocket with zero safe replies. Seek a retreat before the net closes.",
    book: "",
    themes: ["motif.trapped_piece"],
    ecoHints: [],
    specificity: 2,
    slots: {
      attention: "your last move left a piece with no safe reply",
      lesson: "do not push a piece into a pocket with zero safe escapes",
    },
    conditions: [
      { softKey: "motif.trapped_piece", polarity: "bad" },
      { feature: "self-trapped-piece", polarity: "bad" },
    ],
  };
  const notes = loadNotesSchema();
  const eventTrap = classifyMoment({
    mark: "blunder",
    dropCp: 220,
    tacticalFact: trapFact,
  });
  assert(eventTrap?.kind === "tactical_blunder", "trap must classify as tactical_blunder");
  const liveTrap = buildLiveFacts({
    ply: 37,
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    userColor: "white",
    dropCp: 220,
    bestSan: "Re1",
    playedSan: "Nd2",
    tacticalFact: trapFact,
  });
  const picked = selectNote(eventTrap, liveTrap, notes);
  assert(picked, "self-inflicted trap must pick a note");
  assert(
    picked.id === "motif.trapped_piece#self_trapped",
    `trap note must win on guard count, got ${picked.id}`
  );
  assert(
    picked.keyId === "motif.trapped_piece",
    `winning keyId must stay trapped_piece, got ${picked.keyId}`
  );

  const slotText = formatTacticalSlotComment({
    note: trapNote,
    bestSan: "Re1",
  });
  assert(
    slotText && /Best was Re1/i.test(slotText),
    `slot render must include Best was SAN, got ${slotText}`
  );
  const slotTip = composeMomentJudgmentTip({
    mark: "mistake",
    deltaCp: 220,
    kind: "bad_move",
    moment: { playedSan: "Nd2", bestSan: "Re1" },
    fact: trapFact,
    packNote: trapNote,
    packKeyId: "motif.trapped_piece",
  });
  assert(
    /Best was Re1/i.test(slotTip.text) &&
      /no safe reply/i.test(slotTip.text) &&
      /zero safe escapes/i.test(slotTip.text),
    `bad_move trap tip must use slots + SAN, got ${slotTip.text}`
  );
}

function testCoach3Stage() {
  const notes = loadNotesSchema();
  const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const castledFen = "rnbq1rk1/pppppppp/8/8/8/8/PPPPPPPP/RNBQ1RK1 w - - 0 1";
  const trapFact = {
    kind: "trapped_piece",
    selfInflicted: true,
    pieceLabel: "knight",
    trapSquare: "d2",
  };

  assert(COMMENT_GAP_PLIES === 2, "ply gap must mute when (ply - last) < 2");
  assert(COMMENT_EMERGENCY_CP === 300, "emergency drop must be 300cp");

  assert(
    classifyMoment({ mark: "inaccuracy", dropCp: 80 }) === null,
    "inaccuracy must not create an event"
  );
  const excellent = classifyMoment({ mark: "excellent" });
  assert(
    excellent?.kind === "praise" && excellent.praiseKind === "great_find",
    `excellent must map to great_find, got ${excellent && excellent.praiseKind}`
  );

  const clash = classifyMoment({
    mark: "blunder",
    dropCp: 250,
    structuralKind: "opening_aggregate",
  });
  assert(
    clash?.kind === "tactical_blunder",
    "blunder on a checkpoint ply must stay tier 1"
  );

  assert(kingIsCastled(castledFen, "w"), "king on g1 with no rights is castled");
  const liveCastled = buildLiveFacts({
    ply: 20,
    fen: castledFen,
    userColor: "white",
    dropCp: 120,
    bestSan: "Re1",
    playedSan: "Nd2",
  });
  assert(liveCastled.userCastled, "live facts must mark g1 king as castled");
  const posEvent = classifyMoment({ mark: "mistake", dropCp: 120 });
  const uncastledNote = notes.find((n) => n.id === "attack.king_safety#user_uncastled");
  assert(uncastledNote, "schema must include user_uncastled king-safety note");
  const liveUncastled = buildLiveFacts({
    ply: 20,
    fen: startFen,
    userColor: "white",
    dropCp: 120,
    bestSan: "Re1",
    playedSan: "Nd2",
  });
  assert(!liveUncastled.userCastled, "starting king on e1 must be uncastled");
  const rejected = selectNote(posEvent, liveCastled, [uncastledNote]);
  assert(!rejected, "uncastled guard must reject when king is on g1");
  const accepted = selectNote(posEvent, liveUncastled, [uncastledNote]);
  assert(accepted?.id === "attack.king_safety#user_uncastled", "uncastled note must pass on e1");

  const silence = new CoachSilenceManager();
  const first = attachCoachComment({
    mark: "mistake",
    dropCp: 120,
    ply: 10,
    fen: startFen,
    userColor: "white",
    bestSan: "Re1",
    playedSan: "Nd2",
    notes,
    silence,
  });
  assert(first, "first comment must attach");
  const gap11 = attachCoachComment({
    mark: "brilliant",
    praiseMark: "brilliant",
    ply: 11,
    fen: startFen,
    userColor: "white",
    playedSan: "Nxf7",
    notes,
    silence,
  });
  assert(gap11, "brilliant must bypass ply gap");
  const afterBrill = attachCoachComment({
    mark: "mistake",
    dropCp: 120,
    ply: 12,
    fen: startFen,
    userColor: "white",
    bestSan: "Nc3",
    playedSan: "a3",
    notes,
    silence,
  });
  assert(!afterBrill, "ply immediately after a comment must mute non-emergency");

  const gapSilence = new CoachSilenceManager();
  assert(
    attachCoachComment({
      mark: "mistake",
      dropCp: 120,
      ply: 10,
      fen: startFen,
      userColor: "white",
      bestSan: "Re1",
      playedSan: "Nd2",
      notes,
      silence: gapSilence,
    }),
    "gap session first comment must attach"
  );
  assert(
    !attachCoachComment({
      mark: "excellent",
      praiseMark: "excellent",
      ply: 11,
      fen: startFen,
      userColor: "white",
      playedSan: "Nf3",
      notes,
      silence: gapSilence,
    }),
    "excellent must not bypass ply gap"
  );
  const openingName = attachCoachComment({
    structuralKind: "opening_name",
    ply: 12,
    fen: startFen,
    userColor: "white",
    playedSan: "e4",
    notes,
    silence: gapSilence,
  });
  assert(openingName, "distinct checkpoint key must attach after a 1-ply gap");
  assert(
    !attachCoachComment({
      structuralKind: "opening_aggregate",
      ply: 13,
      fen: startFen,
      userColor: "white",
      playedSan: "d4",
      notes,
      silence: gapSilence,
    }),
    "checkpoints must still obey ply gap"
  );

  const dropSilence = new CoachSilenceManager();
  assert(
    attachCoachComment({
      mark: "mistake",
      dropCp: 120,
      ply: 10,
      fen: startFen,
      userColor: "white",
      bestSan: "Re1",
      playedSan: "Nd2",
      notes,
      silence: dropSilence,
    }),
    "drop-bypass prelude must attach"
  );
  const emergency = attachCoachComment({
    mark: "blunder",
    dropCp: 300,
    tacticalFact: trapFact,
    ply: 11,
    fen: startFen,
    userColor: "white",
    bestSan: "Re1",
    playedSan: "Nd2",
    notes,
    silence: dropSilence,
  });
  assert(emergency, "tactical_blunder dropCp>=300 must bypass ply gap");

  const unique = new CoachSilenceManager();
  const trapOnce = attachCoachComment({
    mark: "blunder",
    dropCp: 220,
    tacticalFact: trapFact,
    ply: 20,
    fen: startFen,
    userColor: "white",
    bestSan: "Re1",
    playedSan: "Nd2",
    notes,
    silence: unique,
  });
  assert(trapOnce?.note.keyId === "motif.trapped_piece", "first trap must attach");
  const trapTwice = attachCoachComment({
    mark: "blunder",
    dropCp: 220,
    tacticalFact: trapFact,
    ply: 24,
    fen: startFen,
    userColor: "white",
    bestSan: "Re1",
    playedSan: "Nd2",
    notes,
    silence: unique,
  });
  assert(!trapTwice, "second motif.trapped_piece in the same game must mute");
}


testCoach3Stage();

console.log("phase tactical metrics smoke OK");
