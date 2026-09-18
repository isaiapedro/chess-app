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

A Brilliant mark requires the established material-sacrifice predicate and the
existing position-safety gates. Its explicit decision record compares the
player-POV win probability of Stockfish's top line with the played move; a
drop of up to 10 percentage points is permitted. An opponent's immediate
capture of the offered piece is concrete sacrifice evidence, including a major
piece for a minor piece or a piece for a pawn; it overrides only the static
attack-count uncertainty, not the probability gates. Existing `game-coach:v169`
reviews are migrated lazily: their stored evaluations and next ply rebuild this
comparison/evidence, and positive marks may promote to Brilliant while critical
marks remain intact. No cache-key bump is required because the migration has
all required inputs and persists its repaired result on the next review open.
