import {
  buildTopLineVsPlayed,
  classifyCoachMark,
  confirmedSacrificeMaterialLoss,
  isRoutineExcellentMove,
  isSimpleThreatEscape,
  mergeRestampedCoachMark,
  potentialSacrificeMaterialLoss,
  type CoachEngineLine,
} from "../src/engine/gameCoach/coachMarkClassify";
import { shouldDropNoiseCoachMoment } from "../src/engine/gameCoach/coachMomentNoise";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// PV1 is the same move as the played move, so its root comparison is exactly
// zero even when a separate child-position search has horizon drift.
{
  const fen =
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
  const comparison = buildTopLineVsPlayed({
    side: "white",
    topLineSan: "Bxf7",
    playedSan: "Bxf7",
    topLineCpWhite: -300,
    playedCpWhite: -700,
    fenBefore: fen,
    lines: [{ rank: 1, san: "Bxf7", cpWhite: -300 }],
    playedBest: true,
  });
  assert(comparison, "PV1 comparison should be available");
  assert(comparison.winProbabilityGap === 0, "PV1 compared with itself must have zero gap");
  assert(
    comparison.playedEvaluationSource === "top-line",
    `PV1 source should be top-line, got ${comparison.playedEvaluationSource}`
  );

  const mark = classifyCoachMark({
    side: "white",
    evalBeforeCp: -300,
    evalAfterCp: -700,
    playedBest: true,
    topLineVsPlayed: comparison,
    fenBefore: fen,
    playedSan: "Bxf7",
    opponentReplySan: "Kxf7",
  });
  assert(
    mark === "brilliant",
    `best sacrifice above the completely-lost floor should survive child-search drift, got ${mark}`
  );
}

{
  const mark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 800,
    evalAfterCp: 640,
    playedBest: false,
  });
  assert(mark === "inaccuracy", `+800→+640 is inaccuracy via 160cp, got ${mark}`);
}

{
  const mark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 800,
    evalAfterCp: 670,
    playedBest: false,
  });
  assert(mark === "excellent", `+800→+670 under 150cp stays excellent, got ${mark}`);
}

{
  const mark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 30,
    evalAfterCp: -80,
    playedBest: false,
  });
  assert(mark === "mistake" || mark === "blunder", `WP drop still beats cp floor, got ${mark}`);
}

{
  const fen =
    "rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2";
  const recap = classifyCoachMark({
    side: "black",
    evalBeforeCp: -20,
    evalAfterCp: -15,
    playedBest: false,
    fenBefore: fen,
    playedSan: "Qxd5",
    prevCaptureTo: "d5",
  });
  assert(recap === "good", `recapture demotes excellent to good, got ${recap}`);

  const keep = classifyCoachMark({
    side: "black",
    evalBeforeCp: -20,
    evalAfterCp: -15,
    playedBest: false,
    fenBefore: fen,
    playedSan: "e6",
    prevCaptureTo: "d5",
  });
  assert(keep === "excellent", `non-recapture pawn still excellent, got ${keep}`);
}

{
  const lost = classifyCoachMark({
    side: "white",
    evalBeforeCp: 98000,
    evalAfterCp: 200,
    playedBest: false,
  });
  assert(lost === "missed", `lost mate is missed, got ${lost}`);

  const converted = classifyCoachMark({
    side: "white",
    evalBeforeCp: 98000,
    evalAfterCp: 97000,
    playedBest: true,
  });
  assert(converted === "best", `kept mate on best stays best, got ${converted}`);
}

{
  const hung = classifyCoachMark({
    side: "black",
    evalBeforeCp: 0,
    evalAfterCp: 98000,
    playedBest: false,
    fenBefore: "8/3R4/6k1/8/2qR2K1/p7/P7/8 b - - 7 56",
    playedSan: "Qxa2",
  });
  assert(hung === "blunder", `hung mate stays blunder, got ${hung}`);
}

assert(
  shouldDropNoiseCoachMoment({
    source: "live",
    severity: "blunder",
    evalBeforeCp: 98000,
    playedSan: "Kd2",
    bestSan: "Ke2",
  }),
  "already-mating without after-eval still noise"
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
  "lost mate is not terminal noise"
);

function gapLines(san: string, side: "white" | "black"): CoachEngineLine[] {
  const bestCp = side === "white" ? 350 : -350;
  const altCp = side === "white" ? -80 : 80;
  return [
    { rank: 1, san, cpWhite: bestCp },
    { rank: 2, san: "a3", cpWhite: altCp },
  ];
}

const hangingQueenFen = "4k3/8/8/8/3Q4/8/6K1/3r4 w - - 0 1";

assert(
  isSimpleThreatEscape(hangingQueenFen, "Qc3"),
  "hanging queen step-off is simple escape"
);
assert(
  !isSimpleThreatEscape(hangingQueenFen, "Qe3"),
  "hanging queen retreat that checks is not simple escape"
);
assert(
  !isSimpleThreatEscape(hangingQueenFen, "Qe3+"),
  "check suffix SAN still not a simple escape"
);
assert(
  !isSimpleThreatEscape(hangingQueenFen, "Qxd1"),
  "hanging queen takes attacker is not simple escape"
);

{
  const mark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 40,
    evalAfterCp: 280,
    playedBest: true,
    lines: gapLines("Qc3", "white"),
    fenBefore: hangingQueenFen,
    playedSan: "Qc3",
  });
  assert(mark === "best", `simple queen flee must not be important, got ${mark}`);
}

{
  const mark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 40,
    evalAfterCp: 280,
    playedBest: true,
    lines: gapLines("Qe3", "white"),
    fenBefore: hangingQueenFen,
    playedSan: "Qe3",
  });
  assert(mark === "important", `checking retreat stays important, got ${mark}`);
}

{
  const mark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 40,
    evalAfterCp: 280,
    playedBest: false,
    lines: gapLines("Qe3", "white"),
    fenBefore: hangingQueenFen,
    playedSan: "Qe3+",
  });
  assert(
    mark === "important",
    `SAN-suffix best still important, got ${mark}`
  );
}

{
  const mark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 40,
    evalAfterCp: 280,
    playedBest: true,
    lines: gapLines("Qxd1", "white"),
    fenBefore: hangingQueenFen,
    playedSan: "Qxd1",
  });
  assert(mark === "best", `QxR trade must not be important, got ${mark}`);
}

const hangingKnightFen = "5k2/8/8/8/4n3/8/4R3/4K3 b - - 0 1";
assert(
  isSimpleThreatEscape(hangingKnightFen, "Nf6"),
  "hanging knight hop to safety is simple escape"
);
{
  const mark = classifyCoachMark({
    side: "black",
    evalBeforeCp: -40,
    evalAfterCp: -280,
    playedBest: true,
    lines: gapLines("Nf6", "black"),
    fenBefore: hangingKnightFen,
    playedSan: "Nf6",
  });
  assert(mark === "best", `simple knight flee must not be important, got ${mark}`);
}

const lesserQueenFen = "4k3/8/8/8/3Q4/4P3/2n5/6K1 w - - 0 1";
assert(
  isSimpleThreatEscape(lesserQueenFen, "Qc3"),
  "queen stepping off cheaper attacker is simple escape"
);

const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
assert(
  !isSimpleThreatEscape(startFen, "e4"),
  "unattacked pawn break is not a threat escape"
);
{
  const mark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 20,
    evalAfterCp: 40,
    playedBest: true,
    lines: gapLines("e4", "white"),
    fenBefore: startFen,
    playedSan: "e4",
  });
  assert(mark === "important", `quiet only-move pawn break stays important, got ${mark}`);
}

const kingCheckFen = "4k3/8/8/8/8/8/4R3/4K3 b - - 0 1";
assert(
  isSimpleThreatEscape(kingCheckFen, "Kf8"),
  "king stepping out of check with no extra idea is simple escape"
);

{
  const hangCapFen = "4k3/8/8/4n3/8/8/4Q3/4K3 w - - 0 20";
  assert(
    isRoutineExcellentMove(hangCapFen, "Qxe5"),
    "taking hanging knight is routine excellent"
  );
  const hangMark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 300,
    evalAfterCp: 310,
    playedBest: false,
    fenBefore: hangCapFen,
    playedSan: "Qxe5",
  });
  assert(hangMark === "good", `hanging capture demotes excellent to good, got ${hangMark}`);
}

{
  const checkFen = "4k3/8/8/8/8/8/4Q3/4K3 w - - 0 20";
  assert(
    isRoutineExcellentMove(checkFen, "Qh5+"),
    "giving check is routine excellent"
  );
  const checkMark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 20,
    evalAfterCp: 25,
    playedBest: false,
    fenBefore: checkFen,
    playedSan: "Qh5+",
  });
  assert(checkMark === "good", `check demotes excellent to good, got ${checkMark}`);
}

{
  const blockFen = "4k3/8/8/8/8/8/4N3/R3K2r w - - 0 20";
  assert(
    isRoutineExcellentMove(blockFen, "Ng1"),
    "blocking check is routine excellent"
  );
  const blockMark = classifyCoachMark({
    side: "white",
    evalBeforeCp: -400,
    evalAfterCp: -390,
    playedBest: false,
    fenBefore: blockFen,
    playedSan: "Ng1",
  });
  assert(blockMark === "good", `block check demotes excellent to good, got ${blockMark}`);
}

{
  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert(
    isRoutineExcellentMove(start, "Nf3"),
    "opening knight develop is routine excellent"
  );
  const developMark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 20,
    evalAfterCp: 25,
    playedBest: false,
    fenBefore: start,
    playedSan: "Nf3",
  });
  assert(
    developMark === "good",
    `opening develop demotes excellent to good, got ${developMark}`
  );
}

{
  const quietFen = "6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 30";
  assert(
    !isRoutineExcellentMove(quietFen, "h3"),
    "quiet late pawn is not routine excellent"
  );
  const quietMark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 20,
    evalAfterCp: 22,
    playedBest: false,
    fenBefore: quietFen,
    playedSan: "h3",
  });
  assert(quietMark === "excellent", `quiet late pawn stays excellent, got ${quietMark}`);
}

{
  const blockFen = "4k3/8/8/8/8/8/4N3/R3K2r w - - 0 20";
  const blockImportant = classifyCoachMark({
    side: "white",
    evalBeforeCp: -400,
    evalAfterCp: -50,
    playedBest: true,
    lines: gapLines("Ng1", "white"),
    fenBefore: blockFen,
    playedSan: "Ng1",
  });
  assert(
    blockImportant === "best",
    `block check must not be important, got ${blockImportant}`
  );
}

{
  const hangPawnFen = "4k3/8/8/4p3/8/8/4Q3/4K3 w - - 0 20";
  assert(
    isRoutineExcellentMove(hangPawnFen, "Qxe5"),
    "taking hanging pawn is routine excellent"
  );
  const hangPawnExcellent = classifyCoachMark({
    side: "white",
    evalBeforeCp: 300,
    evalAfterCp: 310,
    playedBest: false,
    fenBefore: hangPawnFen,
    playedSan: "Qxe5",
  });
  assert(
    hangPawnExcellent === "good",
    `hanging pawn capture demotes excellent to good, got ${hangPawnExcellent}`
  );
  const hangPawnImportant = classifyCoachMark({
    side: "white",
    evalBeforeCp: 300,
    evalAfterCp: 400,
    playedBest: true,
    lines: gapLines("Qxe5", "white"),
    fenBefore: hangPawnFen,
    playedSan: "Qxe5",
  });
  assert(
    hangPawnImportant === "best",
    `hanging pawn capture must not be important, got ${hangPawnImportant}`
  );
}

{
  const equalFen = "4k3/8/8/4n3/8/3N4/8/4K3 w - - 0 20";
  const equalImportant = classifyCoachMark({
    side: "white",
    evalBeforeCp: 20,
    evalAfterCp: 25,
    playedBest: true,
    lines: gapLines("Nxe5", "white"),
    fenBefore: equalFen,
    playedSan: "Nxe5",
  });
  assert(
    equalImportant === "best",
    `equal NxN trade must not be important, got ${equalImportant}`
  );
}

{
  const lesserFen = "4k3/8/8/4n3/8/8/4Q3/4K3 w - - 0 20";
  const lesserImportant = classifyCoachMark({
    side: "white",
    evalBeforeCp: 20,
    evalAfterCp: 80,
    playedBest: true,
    lines: gapLines("Qxe5", "white"),
    fenBefore: lesserFen,
    playedSan: "Qxe5",
  });
  assert(
    lesserImportant === "best",
    `QxN lesser trade must not be important, got ${lesserImportant}`
  );
}

// Fresh review: a bishop-for-pawn offer may lose up to 10 percentage points
// against the engine's top line and still receive a Brilliant mark.
{
  const sacrificeFen =
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
  assert(
    potentialSacrificeMaterialLoss({
      fenBefore: sacrificeFen,
      playedSan: "Bxf7",
    }) === 2,
    "declined bishop-for-pawn offer should expose two net material points"
  );
  assert(
    confirmedSacrificeMaterialLoss({
      fenBefore: sacrificeFen,
      playedSan: "Bxf7",
      opponentReplySan: "Kxf7",
    }) === 2,
    "Bishop-for-pawn captured by the king confirms a two-point sacrifice"
  );
  const comparison = buildTopLineVsPlayed({
    side: "white",
    topLineSan: "d3",
    playedSan: "Bxf7",
    topLineCpWhite: 150,
    playedCpWhite: 80,
  });
  assert(comparison, "comparison should be available with both evaluations");
  assert(
    comparison.winProbabilityGap < 0.1,
    `expected a sub-10pp gap, got ${comparison.winProbabilityGap}`
  );
  const freshMark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 150,
    evalAfterCp: 80,
    playedBest: false,
    topLineVsPlayed: comparison,
    fenBefore: sacrificeFen,
    playedSan: "Bxf7",
    opponentReplySan: "Kxf7",
  });
  assert(freshMark === "brilliant", `fresh sacrifice should be brilliant, got ${freshMark}`);

  // Cached review: an existing positive mark must be promoted rather than
  // skipped when the stored evaluations now qualify.
  const cachedMark = mergeRestampedCoachMark("best", freshMark);
  assert(cachedMark === "brilliant", `cached best should promote, got ${cachedMark}`);

  // A Brilliant from an older classifier is not authoritative.  Reopening a
  // cached review must be able to replace a stale false positive.
  const repairedCachedMark = mergeRestampedCoachMark("brilliant", "good");
  assert(
    repairedCachedMark === "good",
    `stale brilliant should be demoted, got ${repairedCachedMark}`
  );
}

{
  const sacrificeFen =
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
  const comparison = buildTopLineVsPlayed({
    side: "white",
    topLineSan: "d3",
    playedSan: "Bxf7",
    topLineCpWhite: 900,
    playedCpWhite: 650,
  });
  assert(comparison, "comparison should be available with both evaluations");
  const mark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 900,
    evalAfterCp: 650,
    playedBest: false,
    topLineVsPlayed: comparison,
    fenBefore: sacrificeFen,
    playedSan: "Bxf7",
    opponentReplySan: "Kxf7",
  });
  assert(
    mark === "brilliant",
    `a winning-position sacrifice with a small gap should be brilliant, got ${mark}`
  );
}

// A queen taking an offered rook is not a sacrifice when the queen is
// immediately recaptured for more material.
{
  const exchangeFen = "4k3/4q3/8/8/3P4/8/4R3/4K3 w - - 0 1";
  assert(
    confirmedSacrificeMaterialLoss({
      fenBefore: exchangeFen,
      playedSan: "Re5",
      opponentReplySan: "Qxe5",
    }) === 0,
    "a legal queen recapture must prevent a defended rook offer from counting as a sacrifice"
  );
  assert(
    potentialSacrificeMaterialLoss({
      fenBefore: exchangeFen,
      playedSan: "Re5",
    }) === 0,
    "declining a losing queen capture must not turn a defended rook move into a sacrifice"
  );
}

// A declined piece-for-pawn offer remains Brilliant if it is the engine's
// forced mate move and the resulting win probability is sound.
{
  const sacrificeFen =
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
  const comparison = buildTopLineVsPlayed({
    side: "white",
    topLineSan: "Bxf7",
    playedSan: "Bxf7",
    topLineCpWhite: 98000,
    playedCpWhite: 97000,
  });
  assert(comparison, "mate comparison should be available");
  const mark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 98000,
    evalAfterCp: 97000,
    playedBest: true,
    topLineVsPlayed: comparison,
    fenBefore: sacrificeFen,
    playedSan: "Bxf7",
  });
  assert(mark === "brilliant", `declined forced-mate sacrifice should be brilliant, got ${mark}`);
}

{
  const sacrificeFen =
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
  const comparison = buildTopLineVsPlayed({
    side: "white",
    topLineSan: "d3",
    playedSan: "Bxf7",
    topLineCpWhite: 150,
    playedCpWhite: 40,
  });
  assert(comparison, "comparison should be available with both evaluations");
  const mark = classifyCoachMark({
    side: "white",
    evalBeforeCp: 150,
    evalAfterCp: 40,
    playedBest: false,
    topLineVsPlayed: comparison,
    fenBefore: sacrificeFen,
    playedSan: "Bxf7",
  });
  assert(mark !== "brilliant", "a greater-than-10pp top-line gap must reject Brilliant");
}

console.log("test-coach-mark-classify: ok");
