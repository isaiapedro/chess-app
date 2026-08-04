type Waiter = () => void;

let heuristicsDone = false;
let puzzleDemand = 0;
const waiters: Waiter[] = [];

function notify(): void {
  const pending = waiters.splice(0, waiters.length);
  for (const resume of pending) resume();
}

function waitUntil(pred: () => boolean): Promise<void> {
  if (pred()) return Promise.resolve();
  return new Promise((resolve) => {
    const tick = () => {
      if (pred()) {
        resolve();
        return;
      }
      waiters.push(tick);
    };
    waiters.push(tick);
  });
}

export function resetBackgroundWork(): void {
  heuristicsDone = false;
  puzzleDemand = 0;
  notify();
}

export function markHeuristicsComplete(): void {
  if (heuristicsDone) return;
  heuristicsDone = true;
  notify();
}

export function isHeuristicsComplete(): boolean {
  return heuristicsDone;
}

export function beginPuzzleBatch(): void {
  puzzleDemand += 1;
  notify();
}

export function endPuzzleBatch(): void {
  puzzleDemand = Math.max(0, puzzleDemand - 1);
  notify();
}

export function hasPuzzleDemand(): boolean {
  return puzzleDemand > 0;
}

export async function waitForPrefetchGate(timeoutMs = 20000): Promise<void> {
  if (heuristicsDone) return;
  await Promise.race([
    waitUntil(() => heuristicsDone),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export async function waitForPuzzleIdle(): Promise<void> {
  if (puzzleDemand <= 0) return;
  await waitUntil(() => puzzleDemand <= 0);
}

export async function yieldForUi(options?: { heavy?: boolean }): Promise<void> {
  if (puzzleDemand > 0) {
    await waitForPuzzleIdle();
  }
  const heavy = options?.heavy ?? false;
  const delayMs = heavy ? 4 : 0;
  if (typeof requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        if (delayMs > 0) setTimeout(resolve, delayMs);
        else resolve();
      });
    });
    return;
  }
  if (delayMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
}
