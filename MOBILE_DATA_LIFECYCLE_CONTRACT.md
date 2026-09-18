# Mobile data lifecycle, performance, and reliability contract

## Purpose and status

This is the canonical operational description of the Chess Wrapped mobile
data lifecycle. It records the current implementation and the invariants that
must be preserved when changing ingest, cache keys, metrics, evaluation, or
background work.

Performance is a product requirement: a returning user should see usable local
content before network and expensive computation finish. The app must compute a
result only when a compatible local result is absent or explicitly refreshed.

This document complements, rather than replaces:

- `README.md` — product boundary and deployment topology.
- `DATA_SPECIFICATION.md` — metric definitions and calculation semantics.
- `mobile/AGENTS.md` — coach-analysis behavior.
- source code — executable authority for exact behavior.

### Documentation coverage and assessment

Before this contract, the repository documented the product/data-residency
boundary in `README.md`, precise metric semantics in `DATA_SPECIFICATION.md`,
and detailed game-coach behavior in `mobile/AGENTS.md`. It did **not** have a
single source for startup ordering, cache ownership/invalidation, background
coordination, or performance change control. This contract fills that gap.

| Dimension | Current assessment | Basis |
|---|---|---|
| Cache efficiency | Good architectural design; unbenchmarked | Local-first session reads, per-game durable stores, remeshing, incremental ingest, and in-flight coalescing avoid most repeat work. |
| Runtime performance | Unknown, not yet proven | No committed startup, memory, battery, network, or engine-duration benchmark exists. |
| Data reliability | Moderate | Compatible-cache fallback, cancellation, and scoped keys are strong; versionless durable rows, silent storage-write failure, and non-transactional merges remain risks. |
| “Fool-proof” status | No | The limitations in the reliability section can produce stale, missing, or duplicated work under particular changes/failures. |

## Data-residency boundary

| Data | Authoritative location | Permitted remote use |
|---|---|---|
| Auth token, user games, PGN, local analytics, Stockfish vault, coach cache | Device | Never persist on the Chess Wrapped API |
| Username and email | API user registry and device secure storage | Registration only |
| Peer baseline aggregates | Bundled asset and API | Read-only download |
| Opening explorer / master game data | API proxy cache | Read-only lookup using requested position data |
| Coach-comment facts | Device, with optional API/Ollama request | A compact per-moment request; not the raw game vault |

The user-game source of truth is the platform plus the device cache. The API is
not a synchronization service and must not become a user-game or analytics
store.

## Pipeline and ownership

```text
Chess.com / Lichess
        │ direct incremental fetch
        ▼
NormalizedGame → device raw-game store ─────────────┐
        │                                            │
        ├─ local Recap / Insights aggregates         │ immediate UI
        ├─ heuristic rows (opening / MG / EG)        │ batched, resumable
        └─ Stockfish eval vault                      │ deferred, expensive
                  ├─ accuracy / eval buckets / style │
                  ├─ puzzle candidates               │
                  └─ coach-game analysis             │ explicit per game

Bundled/API peer baselines ──────────────────────────┘ comparison only
```

| Layer | Owner | Rule |
|---|---|---|
| Authentication | `AuthContext` | Restore SecureStore first; registration failure cannot block device use. |
| Raw-game ingest | `platformGames.ts` | Fetch direct from the platform, normalize, de-duplicate by platform game ID, then merge into the device store. |
| Session view | `analyticsLoaders.ts`, `AnalyticsContext` | Derive recap and Insights locally from the scoped raw-game set. |
| Heuristics | `heuristicMetricsPass.ts` | Run only for game IDs missing from the per-user/platform heuristic store; aggregate/remesh from existing rows otherwise. |
| Engine vault | `globalAnalysis.ts` | Reuse a game record or compatible game-coach result before evaluating positions again. |
| Game coach | `gameCoach/analyzeGame.ts` | First use the versioned per-game coach cache; a cache miss permits a full selected-game analysis. |
| Study queues | `studyPrefetch.ts`, Study and Opening screens | Prefer cached moments; only scan/refine unfilled queues. |

## Load contract

### First load or cleared device cache

1. Restore auth. An unauthenticated user never triggers game ingest.
2. Attempt a **local-only** session hydrate. This reads the session cache and
   raw-game store; it must not wait for the network.
3. Open the application shell when auth is ready and either a recap exists or
   game loading has completed. A cold account may therefore briefly show an
   empty local state.
4. After interactions settle, perform an incremental platform pull. It merges
   only newly discovered IDs into the raw-game store and rebuilds local session
   derivatives.
5. Remesh existing phase/style/opening data immediately. Run the heuristic pass
   only for missing games. Stockfish work remains deferred.

The cold path deliberately favors time-to-usable-interface over
time-to-complete-analysis.

### Warm load with compatible cache

1. Read cached games, recap, and Insights first. Session caches are accepted
   only when they contain move sources and their derived counts match the games.
2. Hydrate phase, style, and opening-mix caches without blocking the shell.
3. Load peer baselines independently; their absence must not prevent personal
   analytics from rendering.
4. Schedule the same incremental platform pull after interactions. If it finds
   no new IDs, retain the current aggregates and do not run a metric pass.

### Filter, refresh, and clear semantics

- A speed-only filter change remeshes the locally stored period; it does not
  download games or redo per-game heuristics.
- A period change can temporarily reuse the in-memory period subset, then
  locally hydrate/remesh the correct slice and schedule a recent pull.
- Pull-to-refresh has a 60-second cooldown and requests recent platform data.
- Forced refresh resets the active view and cancels current work before
  rebuilding it; it does not intentionally discard the underlying device
  game store.
- The storage/account clear action removes raw games and app analytics from
  `AsyncStorage`, but deliberately retains baseline data. It must reset
  in-memory scans and caches as well.

## Cache inventory and reuse rules

All generic cache records are `{ savedAt, data }` in AsyncStorage under
`@chess-wrapped:v1:`. Raw games use a separate
`@chess-wrapped:user-games:v1:` prefix.

| Artifact | Scope | Freshness | Reuse condition | Recompute / reload trigger |
|---|---|---:|---|---|
| Raw games | platform + normalized username | Incremental watermark | Requested coverage is present | First login, a broader period, or a recent/forced pull |
| Session games, Recap, Insights | platform + user + period | 24 h | Games have moves and derived counts agree | New games, stale/missing cache, forced refresh |
| Opening mix, phase payloads, style view | full filter slice | 7 d for phase/mix; derived from durable rows when possible | Corresponding rows/cache exist | New games or view remesh |
| Heuristic store | platform + user | Permanent | Game ID has opening/MG/EG rows | Missing game, explicit force, cache-version change |
| Engine/eval vault | platform + user | Permanent | Game record exists | Missing game, incompatible cache-version change, explicit scan |
| Game coach result | platform + user + game ID | Permanent | `game-coach:v169` record has plies and a stored top-line-vs-played comparison when both evaluations exist | Cache-version change, missing result, or lazy mark/comparison repair on review open |
| Study mistakes/openings and solved state | full study filter | Permanent | Queue/session key is valid | No usable moments, user advances queue, cache-version change |
| Peer baselines | shared | Permanent | Bundled or API store available | Baseline store version change or manual clear of baseline-specific state |

`takeInflight` coalesces equal cache/ingest/session requests in process. This
is a key efficiency protection: callers must route logically identical work
through the established key rather than introducing parallel fetch/scan paths.

## Cost hierarchy

The following order is intentional and must be preserved.

1. Render cached aggregates and cached per-game results.
2. Filter/remesh stored rows.
3. Run board-only heuristics for missing games, yielding to the UI.
4. Fetch only a recent platform delta or an explicitly required source.
5. Run global Stockfish only for records absent from the vault.
6. Run selected-game coach Stockfish only after the coach cache misses.
7. Perform critical/deep engine refinement only for selected puzzle/coach
   moments.

Current engine budgets are deliberately tiered:

| Work | Budget | Intended scope |
|---|---|---|
| Global eval vault | depth 12, MultiPV 1 | Deferred scan of recent games; first pass is capped at 50 games, extension at 100. |
| Live board evaluation | depth 22, MultiPV 3 | Interactive board scrub only. |
| Selected-game coach analysis | depth 18, MultiPV 2, 1 s | Explicit user action; all plies in one game. |
| Critical coach/puzzle refinement | depth 22, MultiPV 1, 2.5 s | Candidate moments only. |

The Stockfish process itself is currently fetched from the Stockfish CDN into a
hidden WebView. Engine startup is therefore a network dependency on a fresh app
runtime, even when all chess analytics are cached.

## Coordination and cancellation contract

- Analytics tracks run IDs and cancellation signals. A stale async result must
  not overwrite the newest filter/session view.
- Heuristic work yields during game and ply batches. When a puzzle is actively
  requested, its batch size reduces to one game.
- A puzzle request increments `puzzleDemand`; global Stockfish waits for that
  demand to clear before starting another game.
- Only one global scan is active. A newer scan cancels the prior owner.
- A completed selected-game coach result is written into both the coach cache
  and shared eval/heuristic stores, preventing a later background scan from
  repeating that game unnecessarily.
- Global prefetch is scheduled only after Analytics has a non-empty hydrated
  game view, then waits for the heuristic prefetch gate. Its bounded wait
  prevents a failed heuristic run from blocking background work indefinitely.

## Reliability assessment

### What is robust today

- Local-first reads and cached-response fallback make network failure
  non-fatal when a prior cache exists.
- Platform ingest merges IDs rather than replacing whole histories.
- Coverage and watermark metadata prevents a narrow initial fetch from being
  mistaken for a full-history cache.
- Session cache validity checks reject derived data that does not correspond to
  the cached game set.
- In-flight coalescing, run IDs, and cancellation reduce duplicate work and
  stale UI writes.
- Expensive records are scoped by username and platform, which prevents normal
  cross-account cache reuse.
- The device cache clear is broad enough to remove raw games and analytics
  together, avoiding partial-account leftovers.

### It is not fool-proof

The current system is efficient, but it has material reliability limitations:

| Risk | Consequence | Required preservation / remediation rule |
|---|---|---|
| Most durable cache keys do not encode a metric algorithm, engine, or source-schema revision. | A formula or serialized-row change can silently reuse stale permanent results. | Bump the owning cache-key version and document the migration/clear behavior whenever semantics or shape changes. |
| AsyncStorage writes intentionally swallow storage failures. | A full/unavailable store can appear to work while losing a cache write. | Surface storage-health telemetry/UI or retain a retry strategy before treating a result as durable. |
| Raw-store read/merge/write is not a transactional database operation. | New parallel writers can theoretically race and lose a merge. | Preserve the single-flight route; add per-store serialization if introducing another writer. |
| Engine download is runtime-CDN dependent. | A fresh device can lack Stockfish despite valid game data. | Keep all non-engine views usable; consider a bundled/version-pinned engine for production hardening. |
| A future scheduling change can bypass the hydrated-view or heuristic gate. | It can compete with startup work or finish before local games are available. | Preserve the hydrated non-empty view check and prefetch gate before global engine work. |
| Debug instrumentation posts to development-host endpoints. | Username and position/timing data can leave the device in Expo/LAN development. | Remove it or compile-gate it before a privacy-sensitive release. |
| There is no automated performance or cache-lifecycle test suite. | Regressions can pass coach tests while making warm loads or invalidation unsafe. | Add deterministic cache, migration, and timing tests before changing this lifecycle. |

No measured latency or resource benchmark is currently stored in the repository.
Claims about startup speed must therefore be treated as architectural intent,
not verified performance evidence.

## Change-control invariants

Before changing a relevant component, identify the affected artifact in the
cache inventory and preserve these invariants:

1. A valid warm cache must render before a network call or engine scan blocks
   the UI.
2. No raw user game, PGN, eval vault, or bulk personal analytics may be added
   to the API persistence path.
3. A logically identical request must reuse an in-flight operation and a valid
   stored result rather than recomputing it.
4. A metric, engine, parser, phase-boundary, or serialized-cache change must
   bump the relevant versioned key or provide an explicit migration. Permanent
   rows are especially sensitive.
5. New async work must be cancellable and must prove that stale results cannot
   overwrite a newer filter/account view.
6. User-initiated puzzle/analysis work takes precedence over opportunistic
   background work.
7. Network failure must degrade to the newest compatible local data whenever it
   exists; it must not clear a usable view.
8. A cache-clear operation must reset associated in-memory state and scan
   ownership, not only persisted keys.
9. Any new persistent artifact needs an owner, scope, key/version, TTL,
   invalidation path, clear behavior, and residency classification in this
   document and `DATA_SPECIFICATION.md` where metric data is involved.

## Required validation for lifecycle changes

At minimum, manually verify these scenarios until automated coverage exists:

1. First authenticated load with no local storage: shell opens, incremental
   ingest completes, and no duplicate engine scan begins.
2. Warm offline load: cached Recap/Games/Insights remain usable with no API
   response.
3. Warm online load with no new games: no heuristic or global engine rescan.
4. One new game: only that game receives missing heuristic/eval work.
5. Speed-only and period filter changes: no raw-game redownload and no stale
   cross-filter display.
6. Start a puzzle while global scan is active: puzzle owns the next engine
   capacity and the scan resumes safely afterward.
7. Analyze a game twice: second invocation is satisfied from the coach cache.
8. Change a cache version: old values are not read as current values.
9. Clear storage and sign in as another user: no prior raw games, derived rows,
   or coach result is visible.

## Documentation maintenance

Update this document and `DATA_SPECIFICATION.md` in the same change whenever
the lifecycle, a cache format/version, compute budget, storage residency, or
fallback behavior changes. Update `DECISIONS.md` when an invariant or policy
in this contract changes. Routine code refactors that preserve all stated
behavior need only keep source links accurate.
