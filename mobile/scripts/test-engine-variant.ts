import { Chess } from "chess.js";
import {
  buildEngineVariant,
  engineLineArrowUci,
  type EngineVariantPly,
} from "../src/engine/gameCoach/engineVariant";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const QH5_BEFORE =
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2";

function ply(over: Partial<EngineVariantPly>): EngineVariantPly {
  return {
    mark: "blunder",
    san: "Qh5",
    uci: "d1h5",
    fenBefore: QH5_BEFORE,
    fullmove: 2,
    side: "white",
    bestSan: "Nf3",
    bestPvSan: ["Nf3", "Nc6", "Bc4", "Nf6"],
    lines: [],
    ...over,
  };
}

{
  const v = buildEngineVariant(ply({}), 4);
  assert(v, "blunder gets variant");
  assert(v.plyIndex === 4, "keeps ply index");
  assert(v.moves[0]?.san === "Nf3", `first SAN Nf3, got ${v.moves[0]?.san}`);
  assert(v.moves[0]?.uci === "g1f3", `first UCI g1f3, got ${v.moves[0]?.uci}`);
  assert(
    v.moves.map((m) => m.san).join(" ") === "Nf3 Nc6 Bc4 Nf6",
    `PV paste, got ${v.moves.map((m) => m.san).join(" ")}`
  );
  assert(v.moves[0].fenBefore === QH5_BEFORE, "fork from position before played");
  const after = new Chess(v.moves[0].fenAfter);
  assert(after.get("f3")?.type === "n", "best move lands on board");
}

{
  const v = buildEngineVariant(ply({ mark: "mistake" }), 0);
  assert(v, "mistake gets variant");
}

{
  const v = buildEngineVariant(ply({ mark: "missed" }), 0);
  assert(v, "miss gets variant");
}

{
  const v = buildEngineVariant(ply({ mark: "inaccuracy" }), 0);
  assert(v == null, "inaccuracy skips variant");
}

{
  const v = buildEngineVariant(ply({ mark: "best" }), 0);
  assert(v == null, "best skips variant");
}

{
  const v = buildEngineVariant(
    ply({
      san: "Nf3",
      uci: "g1f3",
      bestSan: "Nf3",
      bestPvSan: ["Nf3", "Nc6"],
    }),
    0
  );
  assert(v == null, "played-best skips variant");
}

{
  const v = buildEngineVariant(
    ply({ bestSan: null, bestPvSan: [], lines: [] }),
    0
  );
  assert(v == null, "no PV skips variant");
}

{
  const v = buildEngineVariant(
    ply({ bestPvSan: ["Nf3"], bestSan: "Nf3" }),
    0
  );
  assert(v, "single-move PV still pastes");
  assert(v.moves.length === 1, "one ply");
  assert(v.moves[0].san === "Nf3", "best only");
}

{
  const v = buildEngineVariant(
    ply({
      bestSan: "Nf3",
      bestPvSan: ["Nc6", "Bc4", "Nf6"],
    }),
    0
  );
  assert(v, "PV without duplicated best still plays");
  assert(
    v.moves.map((m) => m.san).join(" ") === "Nf3 Nc6 Bc4 Nf6",
    `prepend best, got ${v.moves.map((m) => m.san).join(" ")}`
  );
}

{
  const v = buildEngineVariant(
    ply({
      bestPvSan: ["Nf3", "junk", "Nc6", "Bc4"],
    }),
    0
  );
  assert(v, "skips one junk token");
  assert(
    v.moves.map((m) => m.san).join(" ") === "Nf3 Nc6 Bc4",
    `greedy skip, got ${v.moves.map((m) => m.san).join(" ")}`
  );
}

{
  const v = buildEngineVariant(
    ply({
      bestSan: null,
      bestPvSan: [],
      lines: [{ san: "Nf3", pvSan: ["Nf3", "Nc6", "d4"] }],
    }),
    0
  );
  assert(v, "falls back to engine line");
  assert(v.moves[0].san === "Nf3", "line SAN");
  assert(v.moves[1].san === "Nc6", "line PV");
}

{
  const v = buildEngineVariant(ply({ mark: "inaccuracy" }), 3);
  assert(v == null, "inaccuracy keeps mainline-only — no variant to hide");
}

{
  const fork = buildEngineVariant(ply({}), 2);
  assert(fork, "arrow fixture");
  const variants = [null, null, fork];
  const emptyNav = {
    plyIndex: 2,
    engineCursor: null as { plyIndex: number; depth: number } | null,
    explore: null as { depth: number; moves: Array<{ uci: string }> } | null,
  };
  assert(
    engineLineArrowUci(emptyNav, variants) === fork.moves[0].uci,
    "parent ply shows first engine move without note"
  );
  assert(
    engineLineArrowUci({ ...emptyNav, plyIndex: 1 }, variants) == null,
    "other ply hides arrow"
  );
  assert(
    engineLineArrowUci({ ...emptyNav, plyIndex: -1 }, variants) == null,
    "start hides arrow"
  );
  assert(
    engineLineArrowUci(
      { ...emptyNav, engineCursor: { plyIndex: 2, depth: 0 } },
      variants
    ) === fork.moves[1].uci,
    "inside line shows next engine move"
  );
  assert(
    engineLineArrowUci(
      {
        ...emptyNav,
        engineCursor: { plyIndex: 2, depth: fork.moves.length - 1 },
      },
      variants
    ) == null,
    "end of engine line hides arrow"
  );
  assert(
    engineLineArrowUci(
      {
        plyIndex: 0,
        engineCursor: null,
        explore: {
          depth: 0,
          moves: [{ uci: "e2e4" }, { uci: "e7e5" }],
        },
      },
      variants
    ) === "e7e5",
    "explore shows next user-line move"
  );
}

console.log("test-engine-variant: ok");
