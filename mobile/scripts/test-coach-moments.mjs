/**
 * Smoke: coach moment schedule + metric-key pool + no ply-1 opening spam.
 * Run: cd mobile && npx --yes tsx scripts/test-coach-moments.mjs
 */
import {
  buildCoachGameMetrics,
  ensureFixedOpeningMoments,
  upsertLiveMoment,
} from "../src/engine/gameCoach/coachGameMetrics.ts";
import {
  COACH_NOTE_REQUEST_CONFIG,
  buildCoachNoteRequest,
} from "../src/engine/gameCoach/coachNoteRequest.ts";
import {
  softKeysForNoteRequest,
} from "../src/engine/gameCoach/metricNoteKeys.ts";
import {
  explainAttachMetricTip,
  shouldAttachMetricTip,
  weightKeyBreakdown,
} from "../src/engine/gameCoach/metricNoteWeights.ts";
import { pickMetricTip } from "../src/engine/gameCoach/metricNotes.ts";
import {
  explainEngineLineVsPlayed,
} from "../src/engine/gameCoach/engineLineExplain.ts";
import { classifyUserError } from "../src/engine/gameCoach/noteCompose.ts";
import { buildOpeningPeerSignals } from "../src/engine/gameCoach/openingCoachInputs.ts";
import {
  composeOpeningJudgmentTipDetailed,
  mergeOpeningTipPrior,
} from "../src/engine/gameCoach/openingJudgmentTip.ts";
import {
  buildMiddlegamePeerSignals,
  softKeysFromMiddlegamePeerGaps,
} from "../src/engine/gameCoach/middlegameCoachInputs.ts";
import { composeMiddlegameJudgmentTipDetailed } from "../src/engine/gameCoach/middlegameJudgmentTip.ts";
import { middlegameAttackSnaps } from "../src/engine/middlegameAttackSnaps.ts";
import { Chess } from "chess.js";
import { keysForMetricFields } from "../src/engine/gameCoach/metricNoteKeys.ts";
import {
  classifyPawnBreakClass,
  buildMiddlegameStrategicInputs,
  softKeysFromMgStructure,
} from "../src/engine/gameCoach/middlegameStructure.ts";
import {
  composeMiddlegameStrategicTip,
} from "../src/engine/gameCoach/middlegameStrategicTip.ts";
import {
  classifyEndgameType,
  buildEndgameStrategicInputs,
} from "../src/engine/gameCoach/endgameContext.ts";
import {
  composeEndgameStrategicTip,
} from "../src/engine/gameCoach/endgameStrategicTip.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const userIsWhite = true;
const coach = buildCoachGameMetrics({
  userColor: "white",
  record: {
    evalsWhiteCp: Array.from({ length: 60 }, () => 40),
    style: {
      endgame_advantage_start_ply: 52,
      had_endgame_advantage: true,
      converted_endgame: true,
      brilliant_moves: 0,
      excellent_moves: 1,
      important_moves: 0,
      blunders: 0,
      blunder_rate_pct: 0,
      trades_near_user_king: 0,
      forward_moves: 10,
      backward_moves: 4,
      declined_recaptures: 0,
      had_sacrifice: false,
      had_early_flank: false,
      recovered_from_disadvantage: false,
    },
  },
  heuristics: {
    opening: {
      opening_eco: "B90",
      opening_name: "Sicilian Najdorf",
      opening_minors_developed_by_10: 4,
      opening_pawn_moves: 3,
      opening_castle_fullmove: 8,
      uncastled: false,
      opening_accuracy_pct: 88,
      opening_center_control_pct: 55,
      opening_tempo_waste_rate_pct: 5,
      accuracy_moves: 10,
      phase_end_fullmove: 11,
    },
    middlegame: {
      middlegame_start_ply: 20,
      middlegame_space_advantage_pct: 12,
      middlegame_king_attackers_score: 2,
      middlegame_pawn_shield_pct: 80,
      middlegame_blunders: 0,
      middlegame_mistakes: 1,
      middlegame_inaccuracies: 2,
      middlegame_accuracy_pct: 75,
      reached_middlegame: true,
    },
    endgame: {
      endgame_start_ply: 48,
      reached_endgame: true,
    },
  },
});

ensureFixedOpeningMoments(coach.momentsByPly, userIsWhite, 60, {
  eco: "B90",
  opening: "Sicilian Najdorf",
});

const byKind = {};
for (const m of Object.values(coach.momentsByPly)) {
  if (m.structuralKind) byKind[m.structuralKind] = m;
}

assert(byKind.opening_name?.ply === 9, `opening_name ply want 9 got ${byKind.opening_name?.ply}`);
assert(
  byKind.opening_aggregate?.ply === 19,
  `opening_aggregate ply want 19 got ${byKind.opening_aggregate?.ply}`
);
assert(
  byKind.middlegame_aggregate?.ply === 49,
  `middlegame_aggregate ply want 49 got ${byKind.middlegame_aggregate?.ply}`
);
assert(
  byKind.endgame_advantage?.ply === 53,
  `endgame_advantage ply want 53 got ${byKind.endgame_advantage?.ply}`
);

assert(COACH_NOTE_REQUEST_CONFIG.openingAlwaysAttach === false, "openingAlwaysAttach off");
assert(COACH_NOTE_REQUEST_CONFIG.allowPhaseStructure === false, "quiet phase_structure off");
assert(
  !buildCoachNoteRequest({
    ply: 20,
    phase: "middlegame",
    mark: null,
    moment: null,
    deltaCp: 0,
    unusedStructureThemes: ["open_file"],
  }),
  "open_file alone must not phase_structure"
);
assert(
  !buildCoachNoteRequest({
    ply: 20,
    phase: "middlegame",
    mark: null,
    moment: null,
    deltaCp: 0,
    unusedStructureThemes: ["maroczy_bind"],
  }),
  "durable maroczy must not invent coach call"
);

const quietOpen = buildCoachNoteRequest({
  ply: 1,
  phase: "opening",
  mark: null,
  moment: null,
  deltaCp: 0,
});
assert(quietOpen == null, "quiet first opening ply must not request a note");
assert(
  !shouldAttachMetricTip({
    phase: "opening",
    moment: null,
    mark: null,
    deltaCp: 0,
    phaseThemes: ["development"],
    request: quietOpen,
  }),
  "quiet opening must not attach"
);

for (const kind of [
  "opening_name",
  "opening_aggregate",
  "middlegame_aggregate",
  "endgame_advantage",
]) {
  const moment = byKind[kind];
  const phase = kind.startsWith("opening")
    ? "opening"
    : kind.startsWith("endgame")
      ? "endgame"
      : "middlegame";
  const req = buildCoachNoteRequest({
    ply: moment.ply,
    phase,
    mark: null,
    moment,
    deltaCp: 0,
  });
  assert(req?.kind === "fixed_checkpoint", `${kind} → fixed_checkpoint`);
  assert(
    shouldAttachMetricTip({
      phase,
      moment,
      mark: null,
      deltaCp: 0,
      phaseThemes: [],
      request: req,
    }),
    `${kind} must attach`
  );
  const keys = softKeysForNoteRequest({
    structuralKind: kind,
    inputs: moment.inputs,
    kind: req.kind,
    openingKeyId: "opening.sicilian",
  });
  assert(keys.length > 0, `${kind} soft key pool empty`);
  if (kind.startsWith("opening")) {
    assert(
      keys.includes("opening.sicilian"),
      `${kind} must include played opening soft key`
    );
    assert(
      !keys.includes("piece.coordination") ||
        keys.includes("piece.centralization") ||
        keys.includes("attack.king_safety"),
      `${kind} should prefer opening principles over coordination-only`
    );
  }
  if (kind === "middlegame_aggregate") {
    assert(
      !keys.some((k) => k.startsWith("opening.")),
      "middlegame_aggregate must not carry opening.* soft keys"
    );
  }
  const foreignOpenings = keys.filter(
    (k) => k.startsWith("opening.") && k !== "opening.sicilian"
  );
  assert(
    foreignOpenings.length === 0,
    `${kind} must not spray unrelated openings: ${foreignOpenings.join(",")}`
  );
}

const pawnBreak = buildCoachNoteRequest({
  ply: 30,
  phase: "middlegame",
  mark: "best",
  moment: {
    ply: 30,
    moveNumber: 15,
    severity: null,
    dropCp: 40,
    playedSan: "c5",
    bestSan: "c5",
    fen: "",
    source: "structural",
    structuralKind: "decisive_pawn_break",
    inputs: { pawn_break: true, played_best: true },
  },
  deltaCp: 0,
});
assert(pawnBreak?.kind === "structural_moment", "pawn break live structural");
assert(
  softKeysForNoteRequest({
    structuralKind: "decisive_pawn_break",
    inputs: pawnBreak.inputs,
    kind: pawnBreak.kind,
  }).includes("positional.pawn_break"),
  "pawn break → positional.pawn_break"
);

assert(
  buildCoachNoteRequest({
    ply: 31,
    phase: "middlegame",
    mark: null,
    moment: {
      ply: 31,
      moveNumber: 16,
      severity: "mistake",
      dropCp: 150,
      playedSan: "",
      bestSan: null,
      fen: "",
      source: "structural",
      structuralKind: "opponent_mistake",
      inputs: { opp_wp_gift: 0.15 },
    },
    deltaCp: 0,
  }) == null,
  "opp gift alone must not create coach note request"
);

{
  // Legacy opp-gift placeholder + user missed: live missed moment, no gift structural.
  const byPly = {};
  upsertLiveMoment(byPly, {
    ply: 32,
    moveNumber: 16,
    severity: "blunder",
    dropCp: 250,
    playedSan: "",
    bestSan: null,
    fen: "",
    source: "structural",
    structuralKind: "opponent_mistake",
    inputs: { opp_wp_gift: 0.25 },
  });
  upsertLiveMoment(byPly, {
    ply: 32,
    moveNumber: 16,
    severity: "missed",
    dropCp: 150,
    playedSan: "Nf3",
    bestSan: "Nxe5",
    fen: "",
    source: "live",
    structuralKind: null,
    inputs: { critical_mark: "missed", missed_after_opp: "blunder" },
  });
  assert(byPly[32].severity === "missed", "user missed overwrites opp-gift severity");
  assert(
    byPly[32].structuralKind == null,
    "missed must not keep opponent_mistake structural"
  );
  assert(
    byPly[32].inputs?.missed_after_opp === "blunder",
    "missed may keep opp gift kind as input metadata"
  );
  assert(
    buildCoachNoteRequest({
      ply: 32,
      phase: "middlegame",
      mark: "missed",
      moment: byPly[32],
      deltaCp: 120,
    })?.kind === "bad_move",
    "missed after gift → bad_move tip via mark, not structural gift"
  );
}

{
  // Best reply after opp gift: gift placeholder must not tip.
  assert(
    buildCoachNoteRequest({
      ply: 38,
      phase: "middlegame",
      mark: null,
      moment: {
        ply: 38,
        moveNumber: 19,
        severity: null,
        dropCp: 40,
        playedSan: "Kxg7",
        bestSan: "Kxg7",
        fen: "",
        source: "structural",
        structuralKind: "opponent_mistake",
        inputs: { opp_wp_gift: 0.274, opp_severity: "blunder", opp_san: "Nxg7" },
      },
      deltaCp: 0,
    }) == null,
    "best reply gift placeholder → no tip"
  );
  assert(
    !shouldAttachMetricTip({
      phase: "middlegame",
      moment: {
        ply: 38,
        moveNumber: 19,
        severity: null,
        dropCp: 40,
        playedSan: "Kxg7",
        bestSan: "Kxg7",
        fen: "",
        source: "structural",
        structuralKind: "opponent_mistake",
        inputs: { opp_wp_gift: 0.274 },
      },
      mark: null,
      deltaCp: 0,
      phaseThemes: [],
      request: null,
    }),
    "best reply gift → no metric tip attach"
  );
}

assert(
  classifyUserError({
    fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    playedSan: "e4",
    bestSan: "d4",
    bestPvSan: ["d4"],
    deltaCp: 120,
    themes: [],
    userColor: "white",
    coachMark: "missed",
  }) === "missed_opportunity",
  "coachMark missed → missed_opportunity"
);
assert(
  classifyUserError({
    fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    playedSan: "e4",
    bestSan: "d4",
    bestPvSan: ["d4"],
    deltaCp: 120,
    themes: [],
    userColor: "white",
    coachMark: "mistake",
  }) === "mistake",
  "coachMark mistake → mistake (not missed)"
);

assert(
  buildCoachNoteRequest({
    ply: 12,
    phase: "middlegame",
    mark: "blunder",
    moment: null,
    deltaCp: 200,
  })?.kind === "bad_move",
  "blunder → bad_move"
);

{
  const start =
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
  const afterNc6 =
    "r1bqkbnr/pppppppp/2n5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2";
  const badReq = buildCoachNoteRequest({
    ply: 2,
    phase: "opening",
    mark: "mistake",
    moment: {
      ply: 2,
      moveNumber: 1,
      severity: "mistake",
      dropCp: 160,
      playedSan: "Nc6",
      bestSan: "e5",
      fen: start,
      source: "live",
    },
    deltaCp: 160,
    fenBefore: start,
    fenAfter: afterNc6,
    bestPvSan: ["e5", "Nf3", "Nc6", "d4"],
    playedLineSans: ["Nc6", "Nf3", "e5", "d4"],
    userColor: "black",
    evalBeforeCp: 30,
    evalAfterCp: -80,
  });
  assert(badReq?.kind === "bad_move", "mistake with lines → bad_move");
  assert(
    badReq?.engineLineSans?.length >= 1,
    "bad_move must attach engineLineSans"
  );
  assert(
    badReq?.playedLineSans?.length >= 1,
    "bad_move must attach playedLineSans"
  );
  assert(
    Array.isArray(badReq?.engineLineMetricDelta),
    "engineLineMetricDelta present"
  );
  assert(
    Array.isArray(badReq?.engineVsPlayedMetricDelta),
    "engineVsPlayedMetricDelta present"
  );
  const openReq = buildCoachNoteRequest({
    ply: 9,
    phase: "opening",
    mark: null,
    moment: byKind.opening_name,
    deltaCp: 0,
    fenBefore: start,
    fenAfter: afterNc6,
    bestPvSan: ["e5", "Nf3", "Nc6", "Bb5"],
    playedLineSans: ["Nc6", "Nf3", "d6", "d4"],
    userColor: "black",
  });
  assert(openReq?.kind === "fixed_checkpoint", "opening_name still fixed");
  assert(
    openReq?.engineLineSans?.length >= 1,
    "opening_name must attach engine line when PV given and move ≠ best"
  );
  const openBest = buildCoachNoteRequest({
    ply: 9,
    phase: "opening",
    mark: null,
    moment: {
      ...byKind.opening_name,
      playedSan: "e5",
      bestSan: "e5",
    },
    deltaCp: 0,
    fenBefore: start,
    fenAfter: afterNc6,
    bestPvSan: ["e5", "Nf3", "Nc6", "Bb5"],
    playedSan: "e5",
    playedLineSans: ["e5", "Nf3", "Nc6", "Bb5"],
    userColor: "white",
  });
  assert(openBest?.kind === "fixed_checkpoint", "opening_name best still fixed");
  assert(
    !(openBest?.engineLineSans?.length) &&
      !(openBest?.engineVsPlayedMetricDelta?.length),
    "best move must not invent engine-vs-played"
  );
}

assert(
  buildCoachNoteRequest({
    ply: 14,
    phase: "middlegame",
    mark: "inaccuracy",
    moment: null,
    deltaCp: 90,
  }) == null,
  "inaccuracy must not create coach note request"
);
assert(
  !shouldAttachMetricTip({
    phase: "middlegame",
    moment: null,
    mark: "inaccuracy",
    deltaCp: 90,
    phaseThemes: [],
    request: null,
  }),
  "inaccuracy must not attach metric tip"
);

console.log("ok coach moments smoke");
console.log(
  JSON.stringify(
    {
      ecoPly: byKind.opening_name.ply,
      aggPly: byKind.opening_aggregate.ply,
      mgAggPly: byKind.middlegame_aggregate.ply,
      egAdvPly: byKind.endgame_advantage.ply,
      cache: "game-coach:v127",
    },
    null,
    2
  )
);

assert(
  byKind.opening_name.inputs?.opening_name &&
    !/^[A-E]\d{2}$/i.test(String(byKind.opening_name.inputs.opening_name)),
  "opening_name moment must carry human opening name, not raw ECO"
);
assert(
  byKind.opening_name.inputs?.minors_developed === 4,
  "opening_name must carry opening metric snapshot (minors_developed)"
);
assert(
  byKind.opening_aggregate.inputs?.center_control_pct === 55,
  "opening_aggregate must carry center_control_pct"
);

const irregularKeys = softKeysForNoteRequest({
  structuralKind: "opening_name",
  inputs: {
    opening_name: "Irregular Openings",
    minors_developed: 2,
    center_control_pct: 40,
    uncastled: true,
  },
  kind: "fixed_checkpoint",
  openingKeyId: null,
});
assert(
  !irregularKeys.some((k) => k.startsWith("opening.")),
  "Irregular / unknown must not spray opening.* keys"
);
assert(
  irregularKeys.includes("piece.centralization") ||
    irregularKeys.includes("attack.king_safety"),
  "Irregular snapshot judgments should map to evidenced soft keys"
);
assert(
  !irregularKeys.includes("positional.pawn_break") &&
    !irregularKeys.includes("positional.prophylaxis") &&
    !irregularKeys.includes("methodology.candidate_moves"),
  "Irregular must not spray filler soft keys without metric evidence"
);

// Quiet opening checkpoint: woven praise + nudge from peer judgments
const irregularOpeningInputs = {
  opening_name: "Irregular Openings",
  minors_developed: 4,
  castle_fullmove: 4,
  uncastled: false,
  center_control_pct: 62.5,
  space_advantage_pct: 33.3,
  pawn_moves: 5,
  opening_accuracy_pct: 91,
  peer_delta_center_control_pct: -10.3,
  peer_delta_minors_developed: 1.5,
  peer_delta_castle_fullmove: -6.1,
};
const peerJudgments = buildOpeningPeerSignals(irregularOpeningInputs);
assert(
  peerJudgments.some(
    (s) =>
      s.metric === "castle_fullmove" &&
      s.polarity === "lower_better" &&
      s.judgment === "good"
  ),
  "castle Δ −6.1 (lower_better) must judge good"
);
assert(
  peerJudgments.some(
    (s) => s.metric === "center_control_pct" && s.judgment === "bad"
  ),
  "centre Δ −10.3 (higher_better) must judge bad"
);
assert(
  peerJudgments[0]?.metric === "center_control_pct",
  "biggest |impact| peer gap should rank first (centre)"
);

const zeroVsPlayed = [
  { field: "mobility", before: 37, after: 37, delta: 0 },
  { field: "space_advantage_pct", before: 33.3, after: 33.3, delta: 0 },
  { field: "king_attackers_pct", before: 0, after: 0, delta: 0 },
];
const irregularSoft = softKeysForNoteRequest({
  structuralKind: "opening_name",
  inputs: irregularOpeningInputs,
  kind: "fixed_checkpoint",
  openingKeyId: null,
  engineVsPlayedMetricDelta: zeroVsPlayed,
});
assert(
  !irregularSoft.some((k) => k.startsWith("opening.")),
  "quiet Irregular softKeys must not list opening.*"
);
assert(
  !irregularSoft.includes("piece.coordination") &&
    !irregularSoft.includes("positional.pawn_break") &&
    !irregularSoft.includes("methodology.candidate_moves") &&
    !irregularSoft.includes("positional.prophylaxis"),
  "quiet Irregular must not include fluff / zero-Δ keys"
);
assert(
  irregularSoft[0] === "piece.centralization" ||
    irregularSoft[0] === "imbalance.space",
  `quiet Irregular softKeys should lead with centre gap key, got ${irregularSoft.join(",")}`
);
assert(
  irregularSoft.includes("attack.king_safety"),
  "good castle judgment still maps soft key (ranked after centre)"
);
const tipOpening = pickMetricTip({
  entries: [
    {
      keyId: "piece.coordination",
      label: "Coordination",
      notes: [
        {
          id: "bookwalk:coord#1",
          text: "White's attacking task is very simple and Black does not have a satisfactory defence in this coordination sample.",
          phase: "any",
          specificity: 3,
        },
      ],
    },
    {
      keyId: "imbalance.space",
      label: "Space",
      notes: [
        {
          id: "space-didactic-1",
          text: "Gain space with pawn advances that restrict the opponent while keeping your pieces behind the pawn shield ready to occupy the new squares.",
          phase: "any",
          specificity: 3,
        },
      ],
    },
    {
      keyId: "piece.centralization",
      label: "Centralization",
      notes: [
        {
          id: "center-didactic-1",
          text: "Centralize knights and bishops so they control more of the board and support breaks in the centre.",
          phase: "any",
          specificity: 3,
        },
      ],
    },
  ],
  metrics: {
    themesByPhase: { opening: [], middlegame: [], endgame: [] },
    globalThemes: [],
  },
  phase: "opening",
  mark: null,
  deltaCp: 0,
  moment: {
    ply: 10,
    moveNumber: 5,
    severity: null,
    dropCp: 0,
    playedSan: "d6",
    bestSan: "d5",
    fen: "",
    source: "structural",
    structuralKind: "opening_name",
    inputs: irregularOpeningInputs,
  },
  request: {
    kind: "fixed_checkpoint",
    ply: 10,
    phase: "opening",
    mark: null,
    moment: null,
    deltaCp: 0,
    playedMetricDelta: [],
    playedLineMetricDelta: [],
    playedLineSans: [],
    engineLineMetricDelta: [],
    engineLineSans: [],
    engineVsPlayedMetricDelta: zeroVsPlayed,
    structuralKind: "opening_name",
    inputs: irregularOpeningInputs,
  },
  openingKeyId: null,
  userColor: "black",
});
assert(tipOpening, "opening_name tip must exist");
assert(
  /development|king safety/i.test(tipOpening.text) &&
    /cent(?:re|er)|space|room/i.test(tipOpening.text),
  "Irregular opening tip must praise goods and nudge centre/space"
);
assert(
  /just remember/i.test(tipOpening.text),
  "opening tip should weave praise then a gentle nudge"
);
assert(
  !/\d+(\.\d+)?%/.test(tipOpening.text) &&
    !/\bΔ\b/.test(tipOpening.text) &&
    !/Minors developed|Centre control \d|Opening checkpoint|peer/i.test(
      tipOpening.text
    ),
  "opening tip must not dump raw numbers or peer Δ prose"
);
assert(
  !/White's attacking task is very simple/i.test(tipOpening.text),
  "must not use bare bookwalk coordination prose for quiet opening"
);
assert(
  !/^Use the center to increase reach\.?$/i.test(tipOpening.text.trim()),
  "must not return the dull single pack line alone"
);
assert(
  tipOpening.keyId === "piece.centralization" ||
    tipOpening.keyId === "imbalance.space",
  `quiet opening keyId must match centre gap, got ${tipOpening.keyId}`
);

const namedOpeningSoft = softKeysForNoteRequest({
  structuralKind: "opening_aggregate",
  inputs: {
    opening_name: "Sicilian Najdorf",
    minors_developed: 4,
    center_control_pct: 55,
  },
  kind: "fixed_checkpoint",
  openingKeyId: "opening.sicilian",
});
assert(
  namedOpeningSoft[0] === "opening.sicilian" ||
    namedOpeningSoft.includes("opening.sicilian"),
  "named opening must include opening.sicilian for plans/theory"
);
assert(
  namedOpeningSoft.filter((k) => k.startsWith("opening.")).length === 1,
  "named opening must not laundry-list other openings"
);

// ply-20 style: why_better = mobility; king_attackers Δ does not help engine
const mobilityVsPlayed = [
  { field: "material_balance", before: 0, after: 0, delta: 0 },
  { field: "mobility", before: 39, after: 41, delta: 2 },
  { field: "king_attackers_pct", before: 0, after: 0.9, delta: 0.9 },
  { field: "opp_king_attackers_pct", before: 0, after: 0, delta: 0 },
  { field: "space_advantage_pct", before: 50, after: 33.3, delta: -16.7 },
  { field: "hanging_material_own", before: 0, after: 0, delta: 0 },
  { field: "hanging_material_opponent", before: 0, after: 0, delta: 0 },
];
const explainedMobility = explainEngineLineVsPlayed({
  bestSan: "Qd7",
  engineVsPlayedMetricDelta: mobilityVsPlayed,
});
assert(
  explainedMobility.primaryField === "mobility",
  `primaryField want mobility got ${explainedMobility.primaryField}`
);
assert(
  /mobility|activity/i.test(explainedMobility.reasons.join(" ")),
  "why_better must cite mobility/activity"
);
assert(
  explainedMobility.primarySoftKeys.some(
    (k) => k === "piece.coordination" || k === "piece.centralization"
  ),
  "primary soft keys must be mobility/coordination-related"
);
assert(
  !explainedMobility.primarySoftKeys.includes("attack.king_safety"),
  "king_safety must not be primary when mobility wins why_better"
);
const spaceSig = explainedMobility.metricSignals.find(
  (s) => s.field === "space_advantage_pct"
);
assert(
  spaceSig?.polarity === "betterForPlayed",
  "played space +16.7 vs engine leaf ⇒ betterForPlayed"
);
const mobSig = explainedMobility.metricSignals.find(
  (s) => s.field === "mobility"
);
assert(
  mobSig?.polarity === "betterForEngine",
  "engine mobility +2 ⇒ betterForEngine"
);

const mobilityRequest = {
  kind: "bad_move",
  ply: 20,
  phase: "opening",
  mark: "mistake",
  moment: null,
  deltaCp: 150,
  playedMetricDelta: [],
  playedLineMetricDelta: [],
  playedLineSans: ["Nd7"],
  engineLineMetricDelta: [],
  engineLineSans: ["Qd7"],
  engineVsPlayedMetricDelta: mobilityVsPlayed,
  inputs: { why_better: explainedMobility.reasons.join("; ") },
};
const softMobility = softKeysForNoteRequest({
  kind: "bad_move",
  engineVsPlayedMetricDelta: mobilityVsPlayed,
});
assert(
  softMobility[0] === "piece.centralization" ||
    softMobility[0] === "piece.coordination",
  `softKeys must lead with mobility keys, got ${softMobility[0]}`
);
const coordW = weightKeyBreakdown({
  keyId: "piece.coordination",
  phase: "opening",
  themes: ["piece.coordination", "attack.king_safety"],
  mark: "mistake",
  deltaCp: 150,
  request: mobilityRequest,
});
const kingW = weightKeyBreakdown({
  keyId: "attack.king_safety",
  phase: "opening",
  themes: ["piece.coordination", "attack.king_safety"],
  mark: "mistake",
  deltaCp: 150,
  request: mobilityRequest,
});
assert(
  coordW.weight > kingW.weight,
  `coordination (${coordW.weight}) must beat king_safety (${kingW.weight}) when why_better=mobility`
);
const attachMobility = explainAttachMetricTip({
  phase: "opening",
  moment: null,
  mark: "mistake",
  deltaCp: 150,
  phaseThemes: [],
  request: mobilityRequest,
});
assert(attachMobility.attach, "bad_move request must attach");
assert(
  attachMobility.reasons.some((r) => r.includes("bad_move") || r.includes("request=")),
  "attach reasons must mention bad_move"
);

const tipMobility = pickMetricTip({
  entries: [
    {
      keyId: "attack.king_safety",
      label: "King safety",
      notes: [
        {
          id: "ks1",
          text: "Keep the king safe behind a solid pawn shield and avoid opening lines toward your monarch without compensation.",
          phase: "any",
          specificity: 3,
        },
      ],
    },
    {
      keyId: "piece.coordination",
      label: "Coordination",
      notes: [
        {
          id: "pc1",
          text: "Coordinate pieces so they control more squares together — activity and harmony beat passive placement.",
          phase: "any",
          specificity: 3,
        },
      ],
    },
    {
      keyId: "piece.centralization",
      label: "Centralization",
      notes: [
        {
          id: "pz1",
          text: "Centralize pieces to raise mobility and control; knights and bishops belong where they influence both wings.",
          phase: "any",
          specificity: 3,
        },
      ],
    },
  ],
  metrics: {
    themesByPhase: { opening: [], middlegame: [], endgame: [] },
    globalThemes: [],
  },
  phase: "opening",
  mark: "mistake",
  deltaCp: 150,
  request: mobilityRequest,
});
assert(tipMobility, "pickMetricTip must return a tip for mobility bad_move");
assert(
  tipMobility.keyId === "piece.coordination" ||
    tipMobility.keyId === "piece.centralization",
  `tip keyId must be mobility-related, got ${tipMobility.keyId}`
);
assert(
  /Why better:.*mobility|activity/i.test(tipMobility.text),
  "generated tip must lead with why_better mobility"
);
assert(
  !/^Keep the king safe/i.test(tipMobility.text.trim()),
  "tip must not be bare king_safety lesson without why_better"
);

// Same peers at ply10 vs ply20: second tip must rephrase / shift focus
{
  const samePeers = { ...irregularOpeningInputs };
  const first = composeOpeningJudgmentTipDetailed({
    inputs: samePeers,
    openingName: "Irregular Openings",
    openingKeyId: null,
    packByKey: {
      "imbalance.space":
        "Gain space with pawn advances that restrict the opponent while keeping your pieces ready.",
      "piece.centralization":
        "Centralize knights and bishops so they control more of the board and support breaks in the centre.",
    },
  });
  const prior = mergeOpeningTipPrior(null, first);
  const second = composeOpeningJudgmentTipDetailed({
    inputs: samePeers,
    openingName: "Irregular Openings",
    openingKeyId: null,
    packByKey: {
      "imbalance.space":
        "Gain space with pawn advances that restrict the opponent while keeping your pieces ready.",
      "piece.centralization":
        "Centralize knights and bishops so they control more of the board and support breaks in the centre.",
    },
    priorTopics: prior,
  });
  assert(first.text && second.text, "both opening tips must produce text");
  assert(
  first.text !== second.text,
    `second opening tip must differ when peers unchanged:\n  ply10: ${first.text}\n  ply20: ${second.text}`
  );
  assert(
    !/\d+(\.\d+)?%/.test(second.text) && !/\bΔ\b/.test(second.text),
    "rephrased tip must still avoid raw numbers"
  );
}

console.log("ok coach moments smoke (post tip-diversity)");

// Middlegame peer weave + attack snaps
{
  const mgPeerInputs = {
    middlegame_accuracy_pct: 88,
    middlegame_space_advantage_pct: 22,
    middlegame_pawn_shield_pct: 92,
    middlegame_opp_king_attackers_score: 18,
    peer_delta_middlegame_accuracy_pct: 8,
    peer_delta_middlegame_space_advantage_pct: 12,
    peer_delta_middlegame_pawn_shield_pct: -15,
    peer_delta_middlegame_opp_king_attackers_score: 10,
  };
  const mgSignals = buildMiddlegamePeerSignals(mgPeerInputs);
  assert(mgSignals.length >= 2, "MG peer signals must surface significant gaps");
  assert(
    mgSignals.some((s) => s.judgment === "good") &&
      mgSignals.some((s) => s.judgment === "bad"),
    "MG peer weave needs both praise and nudge judgments"
  );
  const mgSoft = softKeysFromMiddlegamePeerGaps(mgPeerInputs);
  assert(
    mgSoft.includes("imbalance.space") ||
      mgSoft.includes("attack.king_safety") ||
      mgSoft.includes("attack.initiative"),
    "MG peer gaps must map to MG soft keys"
  );
  const mgTip = composeMiddlegameJudgmentTipDetailed({
    inputs: mgPeerInputs,
    packByKey: {
      "imbalance.space":
        "Use your space to restrict their pieces before opening a second front.",
      "attack.king_safety":
        "Keep a solid pawn shield and meet threats around your king early.",
      "attack.initiative":
        "Bring more attackers than defenders onto the enemy king sector.",
    },
  });
  assert(mgTip.text.length > 20, "MG judgment tip must produce prose");
  assert(
    !/\b\d+\s*cp\b/i.test(mgTip.text) &&
      !/peer_delta|Critical swing|Why better:/i.test(mgTip.text),
    "MG tip must avoid raw cp / peer_delta / Why better dumps"
  );

  const attackKeys = keysForMetricFields([
    "opp_king_in_centre",
    "king_attack_ratio",
    "second_weakness",
    "queen_centralization",
    "connected_rooks",
    "side_clamp",
    "piece_support",
  ]);
  assert(
    attackKeys.includes("attack.king_safety") &&
      attackKeys.includes("positional.two_weaknesses") &&
      attackKeys.includes("piece.centralization") &&
      attackKeys.includes("piece.coordination"),
    "MG attack fields must wire soft keys incl. two_weaknesses"
  );

  // Uncastled black king on e8, white pressure — classic attack-setup FEN
  const board = new Chess(
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
  );
  const snaps = middlegameAttackSnaps(board, "w");
  assert(snaps.opp_king_uncastled === 1, "e8 king must count uncastled");
  assert(
    snaps.opp_king_in_centre === 1 || snaps.attack_setup >= 1,
    "Italian-ish FEN should show centre king and/or attack setup"
  );
  assert(
    typeof snaps.king_attack_ratio === "number" &&
      snaps.piece_support >= 0 &&
      snaps.piece_support <= 100,
    "attack snaps must emit ratio + piece_support pct"
  );
}

console.log("ok coach moments smoke (mg peer + attack snaps)");

// Phase strategic vectors (MG + EG)
{
  const pbKeys = softKeysForNoteRequest({
    structuralKind: "decisive_pawn_break",
    phase: "middlegame",
    openingKeyId: "opening.sicilian",
    planKeys: ["opening.sicilian", "imbalance.space"],
    inputs: {
      pawn_break_class: "wrong_center_break",
      mg_structure_type: "benoni_asymmetric",
      active_wing_user: "queenside",
      strategic_summary: "Played e5 instead of b5.",
    },
  });
  assert(
    !pbKeys.some((k) => k.startsWith("opening.")),
    "decisive_pawn_break soft keys must drop opening.*"
  );
  assert(
    pbKeys.includes("positional.pawn_break") ||
      pbKeys.includes("imbalance.space"),
    "pawn break pool keeps structure keys"
  );

  assert(
    classifyPawnBreakClass({
      toFile: 4,
      activeWingUser: "queenside",
      isLever: true,
    }) === "wrong_center_break",
    "e-file lever vs QS plan = wrong_center_break"
  );
  assert(
    classifyPawnBreakClass({
      toFile: 1,
      activeWingUser: "queenside",
      isLever: true,
    }) === "correct_wing_break",
    "b-file lever vs QS plan = correct_wing_break"
  );

  const mgBoard = new Chess(
    "rnbqkb1r/pp3ppp/3p1n2/2pP4/2P5/2N5/PP2PPPP/R1BQKBNR b KQkq - 0 5"
  );
  const mgStrat = buildMiddlegameStrategicInputs({
    board: mgBoard,
    color: "b",
    playedSan: "e5",
    bestSan: "b5",
    isLever: true,
    toFile: 4,
  });
  assert(
    mgStrat.pawn_break_class === "wrong_center_break" ||
      mgStrat.active_wing_user === "queenside" ||
      mgStrat.mg_structure_type === "benoni_asymmetric",
    "Benoni-ish FEN should stamp structure/wing/break"
  );
  const mgTip = composeMiddlegameStrategicTip({ inputs: mgStrat });
  assert(mgTip.length > 20, "MG strategic tip prose");
  assert(
    !/\b\d+\s*cp\b/i.test(mgTip) && !/Why better:/i.test(mgTip),
    "MG strategic tip clean"
  );
  assert(
    softKeysFromMgStructure(mgStrat).length >= 1,
    "MG structure maps soft keys"
  );

  const kp = new Chess("8/8/4k3/4P3/8/8/4K3/8 w - - 0 1");
  assert(
    classifyEndgameType(kp) === "king_and_pawn",
    "K+P FEN → king_and_pawn"
  );
  const egStrat = buildEndgameStrategicInputs({
    board: kp,
    color: "w",
    eg: {
      reached_endgame: true,
      endgame_start_ply: 40,
      blunders: 0,
      king_centralization: 1,
      king_distance: 3,
      pawn_diff: 1,
      piece_trades: 0,
      beneficial_trades: 0,
      winning_trades: 0,
      simplification_trades: 0,
      mate_episodes: 0,
      mate_converted: 0,
      accidental_stalemate: false,
      mate_move_times: [],
      theoretical: {},
      theoretical_saved: false,
      endgame_opposition: 0,
      result: "*",
    },
    wpUser: 0.85,
    playedSan: "e6",
    bestSan: "Ke3",
  });
  assert(egStrat.endgame_type === "king_and_pawn", "EG type stamp");
  assert(
    egStrat.conversion_state === "winning_conversion",
    "high WP → winning_conversion"
  );
  assert(
    egStrat.played_move_error === "pawn_move_before_king_activation",
    "pawn vs king best → pawn_move_before_king_activation"
  );
  assert(
    typeof egStrat.technical_rule === "string" &&
      /king/i.test(String(egStrat.technical_rule)),
    "technical_rule present"
  );
  const egTip = composeEndgameStrategicTip({ inputs: egStrat });
  assert(
    /king/i.test(egTip) && !/\b\d+\s*cp\b/i.test(egTip),
    "EG tip leads with technique, no cp dump"
  );
}

console.log("ok coach moments smoke (strategic vectors MG+EG)");
