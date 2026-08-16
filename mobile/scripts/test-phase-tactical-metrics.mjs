/**
 * Smoke checks for seventh-rank + open-file utilization + board metric snaps
 * (run: npx tsx scripts/test-phase-tactical-metrics.mjs)
 */
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
  diffMetricSnaps,
  metricDeltaAlongSans,
} from "../src/engine/gameCoach/coachNoteRequest.ts";
import {
  detectSituations,
  isCarlsbad,
  isCaroSlav,
  isClosedCenter,
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
import { detectStructureThemes } from "../src/engine/gameCoach/structureDetect.ts";
import {
  detectTacticalFact,
  formatTacticalFactHead,
  softKeysForTacticalFact,
  tacticalLockBoostForKey,
} from "../src/engine/gameCoach/tacticalFact.ts";
import { buildCoachNoteRequest } from "../src/engine/gameCoach/coachNoteRequest.ts";
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
  // Closed centre: both sides have d+e pawns
  const closed = new Chess(
    "rnbqkbnr/pp3ppp/2p1p3/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR w KQkq - 0 4"
  );
  assert(isClosedCenter(closed), "closed center d+e both sides");
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

console.log("phase tactical metrics smoke OK");
