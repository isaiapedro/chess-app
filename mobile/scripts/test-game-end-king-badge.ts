import { gameEndKingVisual } from "../src/engine/gameEndKingBadge";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

{
  const v = gameEndKingVisual("Win", "white");
  assert(v?.kind === "win", "Win → win");
  assert(v?.icon === "crown", "Win → crown");
  assert(v?.kings === "user", "Win → user king");
  assert(v?.sides.join() === "w", "white Win → w");
}

{
  const v = gameEndKingVisual("Loss", "black");
  assert(v?.kind === "loss", "Loss → loss");
  assert(v?.icon === "skull", "Loss → skull");
  assert(v?.sides.join() === "b", "black Loss → b");
}

{
  const v = gameEndKingVisual("1-0", "white");
  assert(v?.kind === "win", "1-0 white → win");
  assert(v?.sides.join() === "w", "1-0 white → w king");
}

{
  const v = gameEndKingVisual("1-0", "black");
  assert(v?.kind === "loss", "1-0 black → loss");
  assert(v?.icon === "skull", "1-0 black → skull");
  assert(v?.sides.join() === "b", "1-0 black still user king");
}

{
  const v = gameEndKingVisual("0-1", "black");
  assert(v?.kind === "win", "0-1 black → win");
  assert(v?.icon === "crown", "0-1 black → crown");
}

{
  const v = gameEndKingVisual("1/2-1/2", "white");
  assert(v?.kind === "draw", "1/2-1/2 → draw");
  assert(v?.icon === "handshake", "draw → handshake");
  assert(v?.kings === "both", "draw → both kings");
  assert(v?.sides.join() === "w,b", "draw sides w,b");
}

{
  const v = gameEndKingVisual("Draw", "black");
  assert(v?.kind === "draw", "Draw string → draw");
  assert(v?.sides.join() === "w,b", "Draw still both");
}

{
  const v = gameEndKingVisual("1 / 2 - 1 / 2", "white");
  assert(v?.kind === "draw", "spaced 1/2 → draw");
}

{
  const v = gameEndKingVisual("", "white");
  assert(v == null, "empty → null");
}

{
  const v = gameEndKingVisual(undefined, "white");
  assert(v == null, "missing → null");
}

console.log("test-game-end-king-badge: ok");
