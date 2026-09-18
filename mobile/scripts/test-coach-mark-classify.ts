import {
  classifyCoachMark,
  isRoutineExcellentMove,
  isSimpleThreatEscape,
  type CoachEngineLine,
} from "../src/engine/gameCoach/coachMarkClassify";
import { shouldDropNoiseCoachMoment } from "../src/engine/gameCoach/coachMomentNoise";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
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

console.log("test-coach-mark-classify: ok");
