# Chess Wrapped decisions

## Mobile tracks the current Expo Go SDK

Chess Wrapped mobile uses Expo SDK 57 with its matching React Native 0.86 and
React 19.2 dependency set. The design archive records the same shipping stack,
while this directory remains the canonical runtime source.

## Mobile data lifecycle is cache-first

`MOBILE_DATA_LIFECYCLE_CONTRACT.md` is the canonical change-control contract
for mobile ingest, cache reuse and invalidation, compute budgets, storage
residency, cancellation, and fallback behavior. It records existing runtime
behavior; it does not alter it. Any change to its invariants requires a
corresponding decision update and cache-version/migration review.

## Background engine work waits for a usable local view

Global Stockfish prefetch is deferred until Analytics has hydrated a non-empty
local game view and the local heuristic pass has opened its prefetch gate. The
gate has a bounded wait so a failed heuristic pass cannot leave background work
stuck forever. This is scheduling-only: it neither changes metric semantics nor
the durable cache format, so no cache-version migration is required.

## Brilliant-move marks use a stored top-line comparison

A Brilliant mark requires material-sacrifice evidence and an explicit
player-POV comparison between Stockfish's top line and the played move; a drop
of up to 10 percentage points is permitted and the played position must retain
at least a 10% win probability. If the played move is PV1, it is compared with
itself at the root and has a zero gap rather than inheriting depth drift from a
separate evaluation of the resulting position. When available, a non-PV1 move
uses its same-root MultiPV score.

Sacrifice evidence is the net material loss after a legal opponent capture of
the moved piece and the mover's best legal immediate recapture. A loss of at
least two points qualifies, including a major piece for a minor piece or a
piece for a pawn. This applies whether the opponent accepts or declines the
offer and rejects attacked-but-defended pieces and equal exchanges. A best
forced-mate sacrifice may bypass the position-history safety gates, but not the
material or 10-point comparison requirements.

The cache key advances to `game-coach:v170` because older permanent coach
records do not contain a reliably root-comparable played-move evaluation. The
one-time fresh analysis prevents legacy evaluations or marks from deciding the
new result. Within v170, cached praise marks are restamped on review open:
positive marks may promote to Brilliant, existing Brilliant marks may demote,
and other critical marks remain intact.
