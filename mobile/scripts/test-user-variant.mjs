import assert from "node:assert/strict";
import { Chess } from "chess.js";
import {
  applyBoardMove,
  GAME_LINE_COLOR,
  leaveSidelineToGame,
  lineSwitchAnims,
  matchesUci,
  nextUserVariantColor,
  sidelinesVisibleAt,
  stepUserExplore,
  truncateUserVariant,
  USER_VARIANT_COLORS,
} from "../src/engine/gameCoach/userVariant.ts";

const start = new Chess();
const e4 = start.move("e4");
assert.ok(e4);
const afterE4 = start.fen();
const d4 = new Chess().move("d4");
assert.ok(d4);

const plies = [{ uci: `${e4.from}${e4.to}` }];
const emptyNav = {
  plyIndex: -1,
  engineCursor: null,
  explore: null,
  userVariants: [],
};

const main = applyBoardMove(
  emptyNav,
  plies,
  [],
  new Chess().fen(),
  `${e4.from}${e4.to}`,
  e4.san,
  afterE4
);
assert.equal(main?.plyIndex, 0);
assert.equal(main?.explore, null);

const fork = applyBoardMove(
  emptyNav,
  plies,
  [],
  new Chess().fen(),
  `${d4.from}${d4.to}`,
  d4.san,
  d4.after
);
assert.ok(fork?.explore);
assert.equal(fork.explore.color, GAME_LINE_COLOR);
assert.equal(fork.userVariants.length, 1);
assert.equal(fork.explore.moves[0].san, "d4");

const sibling = applyBoardMove(
  { ...fork, explore: null, plyIndex: -1 },
  plies,
  [],
  new Chess().fen(),
  "c2c4",
  "c4",
  new Chess().move("c4").after
);
assert.ok(sibling?.explore);
assert.equal(sibling.explore.color, GAME_LINE_COLOR);
assert.equal(sibling.userVariants.length, 2);

assert.equal(nextUserVariantColor([{ color: USER_VARIANT_COLORS[0] }]), GAME_LINE_COLOR);
assert.ok(matchesUci("e2e4", "e2e4q") === true);

const afterE5 = new Chess(afterE4).move("e5");
assert.ok(afterE5);
const nf3 = new Chess(afterE5.after).move("Nf3");
assert.ok(nf3);
const nc3 = new Chess(afterE5.after).move("Nc3");
assert.ok(nc3);
const engineVariants = [
  {
    plyIndex: 0,
    moves: [
      {
        san: afterE5.san,
        uci: `${afterE5.from}${afterE5.to}`,
        fenBefore: afterE4,
        fenAfter: afterE5.after,
        fullmove: 1,
        side: "black",
      },
      {
        san: nf3.san,
        uci: `${nf3.from}${nf3.to}`,
        fenBefore: afterE5.after,
        fenAfter: nf3.after,
        fullmove: 2,
        side: "white",
      },
    ],
  },
];
const onEngine = {
  plyIndex: 0,
  engineCursor: { plyIndex: 0, depth: 0 },
  explore: null,
  userVariants: [],
};
const fromEngine = applyBoardMove(
  onEngine,
  plies,
  engineVariants,
  afterE5.after,
  `${nc3.from}${nc3.to}`,
  nc3.san,
  nc3.after
);
assert.ok(fromEngine?.explore);
assert.deepEqual(fromEngine.explore.stem, { ply: 0, through: 0 });
assert.equal(fromEngine.explore.moves[0].san, "Nc3");
assert.equal(fromEngine.engineCursor, null);

const a6 = new Chess(nc3.after).move("a6");
assert.ok(a6);
const extended = applyBoardMove(
  fromEngine,
  plies,
  engineVariants,
  nc3.after,
  `${a6.from}${a6.to}`,
  a6.san,
  a6.after
);
assert.ok(extended?.explore);
assert.equal(extended.explore.moves.length, 2);

const trimmed = truncateUserVariant(extended, extended.explore.id, 1);
assert.equal(trimmed.explore?.moves.length, 1);
assert.equal(trimmed.explore?.depth, 0);
assert.equal(trimmed.explore?.moves[0].san, "Nc3");

const dropped = truncateUserVariant(trimmed, trimmed.explore.id, 0);
assert.equal(dropped.explore, null);
assert.equal(dropped.userVariants.length, 0);
assert.deepEqual(dropped.engineCursor, { plyIndex: 0, depth: 0 });

const startFen = new Chess().fen();
const e4Ply = {
  uci: `${e4.from}${e4.to}`,
  fenBefore: startFen,
  fenAfter: afterE4,
};
const d4PlyMove = {
  san: d4.san,
  uci: `${d4.from}${d4.to}`,
  fenBefore: startFen,
  fenAfter: d4.after,
  fullmove: 1,
  side: "white",
};
const rewind = lineSwitchAnims(
  { plyIndex: 0, engineCursor: null, explore: null },
  { plyIndex: 0, engineCursor: { plyIndex: 0, depth: 0 }, explore: null },
  [e4Ply],
  [{ plyIndex: 0, moves: [d4PlyMove] }],
  startFen
);
assert.equal(rewind.length, 2);
assert.equal(rewind[0].reverse, true);
assert.ok(matchesUci(rewind[0].uci, e4Ply.uci));
assert.equal(rewind[0].fen, startFen);
assert.equal(Boolean(rewind[1].reverse), false);
assert.ok(matchesUci(rewind[1].uci, d4PlyMove.uci));
assert.equal(rewind[1].fen, d4.after);

const later = lineSwitchAnims(
  { plyIndex: 1, engineCursor: null, explore: null },
  { plyIndex: 0, engineCursor: { plyIndex: 0, depth: 0 }, explore: null },
  [
    e4Ply,
    {
      uci: `${afterE5.from}${afterE5.to}`,
      fenBefore: afterE4,
      fenAfter: afterE5.after,
    },
  ],
  [{ plyIndex: 0, moves: [d4PlyMove] }],
  startFen
);
assert.equal(later.length, 3);
assert.equal(later[0].reverse, true);
assert.ok(matchesUci(later[0].uci, `${afterE5.from}${afterE5.to}`));
assert.equal(later[1].reverse, true);
assert.ok(matchesUci(later[1].uci, e4Ply.uci));
assert.equal(Boolean(later[2].reverse), false);
assert.ok(matchesUci(later[2].uci, d4PlyMove.uci));

const fromUser = {
  id: "uv-test",
  color: USER_VARIANT_COLORS[0],
  baseIdx: 0,
  baseFen: afterE5.after,
  stem: { ply: 0, through: 0 },
  moves: fromEngine.explore.moves,
  depth: 0,
};
const back = stepUserExplore(fromUser, -1);
assert.equal(back.explore, null);
assert.equal(back.engineCursor, null);
assert.equal(back.plyIndex, 0);

assert.deepEqual(
  leaveSidelineToGame({
    plyIndex: 0,
    engineCursor: { plyIndex: 0, depth: 0 },
    explore: null,
  }),
  { plyIndex: 0, engineCursor: null, explore: null }
);

assert.equal(
  sidelinesVisibleAt(0, { plyIndex: 0, engineCursor: null, explore: null }),
  true
);
assert.equal(
  sidelinesVisibleAt(0, { plyIndex: 1, engineCursor: null, explore: null }),
  false
);
assert.equal(
  sidelinesVisibleAt(0, {
    plyIndex: 0,
    engineCursor: { plyIndex: 0, depth: 0 },
    explore: null,
  }),
  true
);

console.log("userVariant ok");
