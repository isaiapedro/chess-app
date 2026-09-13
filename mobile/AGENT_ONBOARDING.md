# Chess Wrapped Mobile — agent onboarding and trace map

This is the fast route to understanding the shipping mobile app at
`workspace/side_projects/chess/mobile/`. It describes the implementation that
is in the repository, not an assumed running phone session. When this document
and source disagree, source is authoritative.

Read this first, then follow the task-specific links. The behavioral contract
for game-coach work remains [AGENTS.md](AGENTS.md); it is deliberately more
detailed than this onboarding map.

## What an LLM/agent can actually access

| Surface | Immediately inspectable from the workspace | Requires an explicit runtime or user artifact | Must not be assumed |
|---|---|---|---|
| Source, configuration, dependencies, assets, fixtures, tests, Git diff | Yes | No | That the source is running or that a local change is on a device |
| UI structure and intended copy/styles | Yes, from `App.tsx`, screens, components, theme, and navigator | A device/emulator/screenshot to confirm pixel rendering, font rasterization, safe areas, and animation | The exact screen currently visible to the user |
| App state, AsyncStorage, SecureStore, Stockfish state, network responses, logs | No | An attached emulator/device, a safe diagnostic export, or an explicitly running local service | A user’s games, token, email, cached count, filter, or error |
| External chess data and API availability | Only the request code and local fixtures | A permitted, intentional network/runtime request | That a request succeeded or an endpoint has current data |
| Coach LLM output | The request/fallback code and bundled catalog | The configured API and its model service | That an LLM ran, what model it used, or that its prose was accepted |

An agent therefore starts with **static truth**: code, contracts, tests, and
version-control state. It should ask for a screenshot, reproducible steps, a
sanitized log, or a device/emulator connection before claiming to have observed
a live UI or private device data. Do not open, copy, transmit, or quote
`.env`, auth tokens, user game payloads, caches, or debug telemetry in order to
diagnose a visual issue.

## First five minutes

1. Read [AGENTS.md](AGENTS.md), then the repository [README](../README.md).
2. Preserve the existing worktree: `git -C .. status --short`. This repository
   commonly has concurrent work in progress.
3. Read the relevant section of the data lifecycle
   [contract](../MOBILE_DATA_LIFECYCLE_CONTRACT.md) before changing ingest,
   caches, filters, analysis, or background work.
4. Use the route table below to open the owning screen/context/module. Avoid
   guessing from an old design document or a similarly named API function.
5. Make the narrowest change, run the closest test or static check, and state
   exactly what was and was not observed at runtime.

Useful local inventory commands (read-only):

```bash
rg -n '^export (async )?(function|const|type|interface)|^export class' src
rg -n 'useAnalytics|useAuth|useFilters|useStockfish' src
rg -n 'readCache|writeCache|AsyncStorage|SecureStore' src
rg -n 'fetch\(|/api/v1/|https://(lichess|api\.chess)' src
```

These commands deliberately provide the current function/type inventory rather
than a hand-maintained, inevitably stale listing of every exported symbol.

### Immediate traceability versus live behavior

| A source edit is immediately visible to an agent in… | It is not automatically visible in… |
|---|---|
| The shared workspace, `git diff`, static searches, type checks, and source-level tests. | Expo Go, a simulator, a physical phone, Metro, AsyncStorage, SecureStore, or a backend process. |
| Subsequent code-path tracing from the changed function to its callers. | Pixel layout, cache contents, request timing, native module behavior, or any runtime failure. |

Metro Fast Refresh can apply a source edit to a running development app, but it
is a runtime observation only when that app is known to be attached and its
result is actually inspected. A new agent must never present a source edit as a
confirmed device result without that evidence.

## Runtime map

```text
index.ts → App.tsx
  ├─ font gate → BootSkeleton
  ├─ AuthProvider → FilterProvider → ScanLogProvider → AnalyticsProvider
  ├─ TabSwipeProvider → InsightsNavProvider → StockfishProvider
  └─ AppColdGate
       ├─ FilterHeader + DayHangSquare (global filter chrome)
       └─ TabNavigator (PagerView)
            ├─ Wrapped / RecapScreen
            ├─ Games / GamesScreen
            ├─ Study / StudyScreen
            ├─ Insights / InsightsScreen
            └─ Profile / ProfileScreen
```

`App.tsx` is the actual composition root. `AppColdGate` waits for restored auth
and a usable Recap/loading resolution; it does not prove analytics or
Stockfish are complete. The current tab order is defined in
`src/navigation/TabNavigator.tsx`, not in older design notes.

| Concern | Runtime owner | Primary source |
|---|---|---|
| Authentication and account restore | `AuthProvider` | `src/context/AuthContext.tsx` |
| Period, date, speed, and platform query | `FilterProvider` | `src/context/FilterContext.tsx` |
| Game/session loading, derived views, phases | `AnalyticsProvider` | `src/context/AnalyticsContext.tsx` |
| Game ingest and normalization | platform adapter/store | `src/data/platformGames.ts` |
| Recap/Insights aggregates | local derived view | `src/engine/localRecap.ts`, `src/api/selectors.ts` |
| Phase heuristics and aggregate/remesh | local board analysis | `src/engine/heuristicMetricsPass.ts`, `src/storage/analyticsLoaders.ts` |
| Stockfish requests | hidden WebView provider | `src/engine/StockfishProvider.tsx` |
| Background engine/study queue | prefetch coordinator | `src/engine/StudyPrefetch.tsx`, `src/engine/studyPrefetch.ts` |
| Coach analysis and comments | deterministic pipeline plus optional LLM | `src/engine/gameCoach/` |
| Remote API client | base URL, request cache, explorer/baselines | `src/api/client.ts` |

## Data flow and ownership

```text
Chess.com / Lichess direct fetch
        ↓
NormalizedGame → AsyncStorage raw-game store
        ├─ buildLocalRecap / buildLocalInsights → Recap and Insights views
        ├─ heuristic rows → per-user/platform heuristic store → phase panels
        ├─ Stockfish/eval vault → style, accuracy, Study candidates, coach facts
        └─ filtered query slice → cache keys and active AnalyticsContext state

Bundled or API peer baselines ───────────────────────→ comparison captions only
Coach compact moment facts ──optional POST──→ API/model service → prose fallback
```

The app owns personal games on the device. The API owns only the user registry,
peer baselines, and read-only study/proxy functions. Do not route raw games,
PGNs, auth tokens, or aggregate personal analytics to the API. The definitive
residency and cache rules are in
[MOBILE_DATA_LIFECYCLE_CONTRACT.md](../MOBILE_DATA_LIFECYCLE_CONTRACT.md).

### Core shapes an agent should recognize

| Shape | Defined in | Meaning / change impact |
|---|---|---|
| `QueryFilters` | `src/api/client.ts` | Username, platform, timeframe, speed/color/result, date range. It determines every session/cache scope. |
| `NormalizedGame` / `StudyGame` | `src/data/platformGames.ts`, `src/engine/analyzeMistakes.ts` | User-centric normalized game plus PGN/moves and ratings. Treat it as private device data. |
| `AuthState` | `src/context/AuthContext.tsx` | Restored secure account identity and Lichess token. Never log or expose its secret fields. |
| `AnalyticsState` | `src/context/AnalyticsContext.tsx` | In-memory games, derived Recap/Insights, phase payloads, scan readiness, and refresh/remesh actions. |
| `OpeningPhasePayload`, `MiddlegamePhasePayload`, `EndgamePhasePayload` | `src/storage/analyticsLoaders.ts` | Aggregate plus `analyzedCount`/`totalGames`; these drive the Insights measured-games state. |
| `BaselineStore` | `src/data/baselines.ts` | Shared peer distributions, not personal game storage. |
| `CoachLlmPayload` | `src/engine/gameCoach/llmComment.ts` | Compact selected-moment facts eligible for an optional prose request; it is not the full game vault. |

Metric definitions, phases, and units belong in
[DATA_SPECIFICATION.md](../DATA_SPECIFICATION.md). Do not recreate their
semantics from UI labels.

### Caches and keys

Generic records use `@chess-wrapped:v1:` in AsyncStorage. Raw games use
`@chess-wrapped:user-games:v1:` and are scoped by platform plus normalized
username. Key constructors live in `src/storage/studyCacheKeys.ts`; storage
operations and in-flight deduplication live in `src/storage/cache.ts`.

Important consequence: changing a metric calculation, parser, phase boundary,
engine assumption, or serialized shape may require a cache-version bump and a
lifecycle-contract update. Permanent stores are especially vulnerable to stale
rows. Do not clear storage as a casual debugging step; it destroys local user
data and needs explicit user authorization.

## How data becomes visible in each tab

| UI route | Reads primarily | Main render/logic modules | Quick trace |
|---|---|---|---|
| Recap | `recap`, baselines, active filters | `screens/RecapScreen.tsx`, `api/selectors.ts`, `engine/localRecap.ts` | `selectRecapView` → card/chart components |
| Games | filtered device games and selected-game analysis | `screens/GamesScreen.tsx`, `engine/gameCoach/analyzeGame.ts` | list selection → cached or explicit game analysis |
| Study | mistake/opening queues plus Stockfish | `screens/StudyScreen.tsx`, `engine/studyPrefetch.ts`, `engine/analyzeMistakes.ts` | queue cache → board/puzzle refinement |
| Insights | `insights`, phase payloads, style, mix, baselines | `screens/InsightsScreen.tsx`, `context/AnalyticsContext.tsx` | filter → session → remesh/heuristics → phase panels |
| Profile | auth and storage actions | `screens/ProfileScreen.tsx`, account/storage screens | account action → secure/device stores |

For an Insights count or loading issue, trace in this order:

```text
InsightsScreen
  → useAnalytics(): metricsReady / metricsRefreshing / metricsScanned / metricsTotal
  → AnalyticsContext: refreshAnalytics() and requestVaultMetrics()
  → analyticsLoaders: ensureSession(), remeshVaultFromBucket(), ensureVaultMetrics()
  → platformGames: raw store and current filtered games
  → heuristicMetricsPass: per-game heuristic analysis
```

This distinguishes a stale session, missing opening mix, missing heuristic
rows, a filter mismatch, and a background scan from one another. “Games
measured” is a phase-payload progress value; it is not automatically a count of
all games visible in the Games tab.

## Network and model boundary

| Request class | Where it originates | Destination / purpose | Personal-data rule |
|---|---|---|---|
| Platform ingest | `platformGames.ts` | Chess.com or Lichess directly | Fetch only the authenticated user’s games to the device store. |
| Registration | `AuthContext.tsx` → `registerServerUser` | `POST /api/v1/users/register` | Username/email only; best-effort and must not block local use. |
| Peer baselines, explorer, masters | `api/client.ts` | Chess Wrapped API | Shared baseline/proxy data; no raw user-game persistence. |
| Coach comment generation | `gameCoach/llmComment.ts` | `POST /api/v1/coach/comments` | Sends compact selected-moment facts, not the device game vault. |
| Stockfish runtime | `StockfishProvider.tsx` | Stockfish CDN on a fresh runtime | Engine files are fetched into a hidden WebView; board data is evaluated on device. |

The app itself does not give a general-purpose LLM live control of the UI,
filesystem, device storage, or user account. Its narrow LLM integration is
coach-comment prose:

```text
device engine/heuristic facts
  → buildCoachLlmPayload
  → /api/v1/coach/comments
  → api/services/coach_comment.py
  → configured coach model service
  → concrete LLM prose, or deterministic stitch, or catalog template
```

`resolveLlmComments` validates returned prose and fails closed to a deterministic
stitch, then catalog content. The three-stage event/guard/composer contract and
the exact payload-selection rules are in [AGENTS.md](AGENTS.md). Do not call
this a retrieval of user games or a guarantee that an external model was used.

## Observability and live verification

The source contains development `agentLog`/`debugLog` posts to a host on port
`7677` and console output. These are instrumentation hooks, not a guaranteed
agent-readable log service. They may be absent, unreachable, or carry private
runtime facts; use them only in an explicitly authorized local development
session and never as a production telemetry design.

For a live defect, collect the smallest safe evidence:

1. Filter values, app build/runtime, tab, and reproduction steps.
2. A redacted screenshot or screen recording for a visual state.
3. A sanitized console/diagnostic message that names the owning module or
   cache state, without tokens, emails, opponent names, PGN, or raw game data.
4. The code path above and the nearest deterministic test/fixture.

Then distinguish these claims in a handoff:

- **Static verification:** source and types/tests support the behavior.
- **Runtime verification:** an attached device/emulator actually displayed it.
- **Inference:** a likely explanation that still needs runtime evidence.

## Source map and task routing

| Area | Start here | Follow-on authority |
|---|---|---|
| App boot, fonts, providers, global chrome | `App.tsx` | `navigation/AppColdGate.tsx`, `components/FilterHeader.tsx` |
| Navigation/tab visuals | `navigation/TabNavigator.tsx` | `theme.ts`, `icons.tsx`, target screen |
| Visual components | `components/ui.tsx` | `theme.ts`, component-specific style block |
| Authentication | `context/AuthContext.tsx` | `screens/AccountScreen.tsx`, `api/client.ts` |
| Filters / date windows | `context/FilterContext.tsx` | `storage/studyCacheKeys.ts`, `data/platformGames.ts` |
| Ingest / account isolation | `data/platformGames.ts` | `storage/cache.ts`, lifecycle contract |
| Recap content | `screens/RecapScreen.tsx` | `api/selectors.ts`, `engine/localRecap.ts` |
| Insights readiness / phase panels | `screens/InsightsScreen.tsx` | `context/AnalyticsContext.tsx`, `storage/analyticsLoaders.ts` |
| Board and game analysis | `screens/GamesScreen.tsx` | `components/ChessBoard.tsx`, `engine/gameCoach/` |
| Study and engine queues | `screens/StudyScreen.tsx` | `engine/studyPrefetch.ts`, `engine/StockfishProvider.tsx` |
| Peer comparison | `data/baselines.ts` | `assets/baselines/`, API baselines service |
| API surface | `api/main.py` | `api/routers/`, `api/services/` |
| Metric semantics | `DATA_SPECIFICATION.md` | TS engine implementation; Python baseline builders only for peer generation |

## Validation commands

Run from `mobile/` unless a command says otherwise:

```bash
npx tsc --noEmit
npx --yes tsx scripts/test-coach-moments.mjs
node scripts/test-coach-marks.mjs
npx --yes tsx scripts/test-phase-tactical-metrics.mjs
```

The repository may already contain unrelated TypeScript failures. In that case,
report the exact existing errors, run the most focused relevant check, and do
not hide them by changing unrelated code. For UI work, static checks do not
replace an authorized device/emulator inspection.

## Documentation maintenance

Update this map when an entry route, context owner, data-residency boundary,
cache ownership, model boundary, or observability path changes. Update
`MOBILE_DATA_LIFECYCLE_CONTRACT.md`, `DATA_SPECIFICATION.md`, and
`DECISIONS.md` when the change affects the invariants each one owns.
