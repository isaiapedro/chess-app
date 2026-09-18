import { analyzeOpeningGame } from "../src/engine/openingPhase";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const lateCastleMoves = [
  "e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "d3", "Nf6", "Nc3", "d6",
  "Bg5", "h6", "Bh4", "a6", "a3", "Ba7", "Ba2", "Be6", "Qe2", "Qe7",
  "Rd1", "Rd8", "h3", "O-O", "Bb1", "Rfe8", "Ba2", "Bb8", "Bb1", "Ba7",
  "Ba2", "Bb8", "O-O",
].join(" ");

const row = analyzeOpeningGame({
  moves_str: lateCastleMoves,
  user_color: "white",
} as Parameters<typeof analyzeOpeningGame>[0]);

assert(row, "late-castle game is analyzed");
assert(
  row.opening_castle_fullmove === 17,
  `late castle is retained at move 17, got ${row.opening_castle_fullmove}`
);
assert(row.uncastled === false, "late castle is not marked uncastled");
assert(row.phase_end_fullmove === 17, "phase follows late castle");

console.log("test-opening-phase-metrics: ok");
