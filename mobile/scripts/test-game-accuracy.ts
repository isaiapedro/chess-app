import {
  accuracyDropPp,
  gameAccuracyForSide,
  lichessMoveAccuracyPct,
  lichessWinPercent,
  overlayMoveAccuracyPct,
} from "../src/engine/gameAccuracy";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

{
  const eq = lichessWinPercent(0);
  assert(Math.abs(eq - 50) < 0.01, `0cp → 50%, got ${eq}`);
  assert(lichessWinPercent(1000) > lichessWinPercent(200), "ceiling still > +2");
  assert(lichessWinPercent(90000) === lichessWinPercent(1000), "mate ceils to +10");
}

{
  assert(lichessMoveAccuracyPct(50, 50) === 100, "no drop = 100");
  assert(lichessMoveAccuracyPct(50, 60) === 100, "gain = 100");
  const drop5 = lichessMoveAccuracyPct(50, 45);
  assert(drop5 < 90, `5pp WP drop < 90, got ${drop5}`);
  assert(drop5 > 70, `5pp WP still Lichess-shaped, got ${drop5}`);
  const drop20 = lichessMoveAccuracyPct(50, 30);
  assert(drop20 > 35 && drop20 < 50, `20pp drop ~41, got ${drop20}`);
  const blunder = lichessMoveAccuracyPct(50, 0);
  assert(blunder < drop20, "bigger drop → lower accuracy");
}

{
  const overlay5 = overlayMoveAccuracyPct(50, 45);
  assert(overlay5 < 70, `overlay 5pp clearly below 90, got ${overlay5}`);
  assert(overlay5 < lichessMoveAccuracyPct(50, 45), "bad-move scale < raw Lichess");
  const winningDrip = accuracyDropPp(
    lichessWinPercent(1000),
    lichessWinPercent(850),
    150
  );
  assert(winningDrip >= 5, `150cp winning drip floors to ≥5pp, got ${winningDrip}`);
  const winningAcc = overlayMoveAccuracyPct(
    lichessWinPercent(1000),
    lichessWinPercent(850),
    150
  );
  assert(winningAcc < 70, `150cp winning drip move acc < 70, got ${winningAcc}`);
}

function ply(
  side: "white" | "black",
  before: number,
  after: number
): { side: "white" | "black"; evalBeforeCp: number; evalAfterCp: number } {
  return { side, evalBeforeCp: before, evalAfterCp: after };
}

{
  const plies = [];
  let cp = 15;
  for (let i = 0; i < 24; i += 1) {
    const next = 15;
    plies.push(ply(i % 2 === 0 ? "white" : "black", cp, next));
    cp = next;
  }
  const w = gameAccuracyForSide(plies, "white");
  const b = gameAccuracyForSide(plies, "black");
  assert(w != null && w >= 99, `quiet white ~100, got ${w}`);
  assert(b != null && b >= 99, `quiet black ~100, got ${b}`);
}

{
  const plies = [];
  let cp = 0;
  for (let i = 0; i < 20; i += 1) {
    let next = 0;
    if (i === 10) next = -500;
    if (i === 11) next = -500;
    plies.push(ply(i % 2 === 0 ? "white" : "black", cp, next));
    cp = next;
  }
  const white = gameAccuracyForSide(plies, "white");
  assert(white != null && white < 95, `white blunder pulls game accuracy, got ${white}`);
  const arith = (() => {
    const acc = [];
    for (let i = 0; i < plies.length; i += 2) {
      const before = plies[i].evalBeforeCp;
      const after = plies[i].evalAfterCp;
      acc.push(
        overlayMoveAccuracyPct(
          lichessWinPercent(before),
          lichessWinPercent(after),
          before - after
        )
      );
    }
    return acc.reduce((s, x) => s + x, 0) / acc.length;
  })();
  assert(white! < arith, `harmonic+vol < arithmetic (${white} vs ${arith})`);
}

function winningInaccuracyGame(userInaccuracies: number, userMoves: number) {
  const plies = [];
  let cp = 1000;
  let remaining = userInaccuracies;
  for (let i = 0; i < userMoves * 2; i += 1) {
    const whiteToMove = i % 2 === 0;
    let next = cp;
    if (whiteToMove && remaining > 0) {
      next = 850;
      remaining -= 1;
    } else if (!whiteToMove && cp === 850) {
      next = 1000;
    }
    plies.push(ply(whiteToMove ? "white" : "black", cp, next));
    cp = next;
  }
  return plies;
}

{
  const several = gameAccuracyForSide(winningInaccuracyGame(6, 24), "white");
  assert(
    several != null && several < 90,
    `several winning 150cp drips < 90, got ${several}`
  );
  const ten = gameAccuracyForSide(winningInaccuracyGame(10, 40), "white");
  assert(
    ten != null && ten < 90,
    `10 winning 150cp inaccuracies < 90, got ${ten}`
  );
  console.log(`10 inaccuracies in 40 user moves: ${ten}%`);
  console.log(`6 inaccuracies in 24 user moves: ${several}%`);
}

console.log("test-game-accuracy: ok");
