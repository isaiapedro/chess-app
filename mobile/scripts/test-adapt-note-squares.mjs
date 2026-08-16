/**
 * Smoke checks for adaptNoteSquares (run: npx tsx scripts/test-adapt-note-squares.mjs)
 */
import { adaptNoteSquares } from "../src/engine/gameCoach/adaptNoteSquares.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

{
  const fen =
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4";
  const out = adaptNoteSquares({
    text: "Pressure the weak pawn on f7 before Black consolidates the centre.",
    fenBefore: fen,
    playedSan: "Ng5",
    bestSan: "Bxf7+",
    bestPvSan: ["Bxf7+", "Kxf7", "Ng5+"],
    userColor: "black",
  });
  assert(out.includes("f7") && !/\bf2\b/.test(out), "keep f7 when PV hits f7");
}

{
  const out = adaptNoteSquares({
    text: "Watch the soft spot on f7 after early development.",
    fenBefore: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    playedSan: "e5",
    bestSan: "Nf6",
    bestPvSan: ["Nf6", "Nc6"],
    userColor: "black",
  });
  assert(/\bf2\b/.test(out), "black default f7→f2");
}

{
  const out = adaptNoteSquares({
    text: "After Bxh7 the attack crashes through on the kingside.",
    fenBefore: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1",
    playedSan: "e5",
    userColor: "black",
  });
  assert(out.includes("Bxh2"), "SAN dest flips with rank");
}

{
  const fen =
    "rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3";
  const out = adaptNoteSquares({
    text: "Aim at f7 with the queen and bishop battery.",
    fenBefore: fen,
    playedSan: "Bc4",
    bestSan: "Nb5",
    bestPvSan: ["Nb5", "a6", "Nxc7+"],
    userColor: "white",
  });
  assert(/\bc7\b/.test(out) && !/\bf7\b/.test(out), "file flip f7→c7");
}

console.log("adaptNoteSquares smoke OK");
