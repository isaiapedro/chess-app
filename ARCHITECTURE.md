# Chess Wrapped architecture

## Purpose and authority

Chess Wrapped is a privacy-first mobile chess analytics application. This file
is the short structural map; source code is authoritative for executable
behavior. The detailed data/cache rules live in
[MOBILE_DATA_LIFECYCLE_CONTRACT.md](MOBILE_DATA_LIFECYCLE_CONTRACT.md), and
metric meaning lives in [DATA_SPECIFICATION.md](DATA_SPECIFICATION.md).

```text
Chess.com / Lichess ──direct ingest──> Expo mobile client
                                        ├─ AsyncStorage / SecureStore
                                        ├─ local metrics and game views
                                        ├─ local Stockfish vault and study queues
                                        └─ optional compact coach-comment request

Expo client ──shared/read-only requests──> FastAPI service
                                           ├─ username/email registration
                                           ├─ peer baselines
                                           └─ opening explorer / masters proxy
```

The API is not a game-sync or personal-analytics store. Raw games, PGNs,
tokens, local evals, and bulk analytics remain on the device.

## Component map

| Component | Path | Owns | Does not own |
|---|---|---|---|
| Mobile application | `mobile/` | App UI, auth restore, platform ingest, device storage, metrics, Stockfish, study, coach client | Server-side personal game storage |
| Shared API | `api/` | Registry, baselines, opening/masters proxy, optional coach-comment endpoint | Auth-token storage, raw games, device analytics vault |
| Metric/offline tools | repository-root Python modules and `scripts/` | Baseline preparation, metric parity, local analysis utilities | Mobile runtime state |
| Fixtures/assets | `samples/`, `fixtures/`, `mobile/assets/` | Sanitized deterministic inputs and bundled shared data | Live account or secret data |

## Mobile execution map

```text
index.ts → App.tsx → providers → AppColdGate → TabNavigator
                                      ├─ Wrapped / Recap
                                      ├─ Games
                                      ├─ Study
                                      ├─ Insights
                                      └─ Profile
```

`AnalyticsContext` owns the active game slice and derived views. Platform
adapters normalize direct provider responses into device storage. Heuristic
rows, engine vault data, and Study queues are derived locally and must follow
the cache/invalidation rules in the lifecycle contract. For precise code routes
and static-versus-runtime evidence, see [mobile/AGENT_ONBOARDING.md](mobile/AGENT_ONBOARDING.md).

## Interfaces and risks

| Interface | Contract | Change-control trigger |
|---|---|---|
| Device cache | AsyncStorage/SecureStore keys and serialized data | Version/migration review for schema or semantic changes |
| Platform ingest | Chess.com/Lichess direct client requests | Preserve account scope, deduplication, and local-only game residency |
| API | `/api/v1/*` FastAPI routes | Review privacy, CORS, logging, rate limits, and compatibility |
| Peer baselines | Bundled JSON and API response | Record source/version and verify metric compatibility |
| Coach model path | Compact selected-moment request with deterministic fallback | Review payload minimization, consent, model availability, and fallback |

## Documentation map

| Need | Read |
|---|---|
| Product boundary and local setup | [README.md](README.md) |
| Mobile setup/source map | [mobile/README.md](mobile/README.md) |
| Agent runtime tracing | [mobile/AGENT_ONBOARDING.md](mobile/AGENT_ONBOARDING.md) |
| Coach rules | [mobile/AGENTS.md](mobile/AGENTS.md) |
| Data/cache invariants | [MOBILE_DATA_LIFECYCLE_CONTRACT.md](MOBILE_DATA_LIFECYCLE_CONTRACT.md) |
| Metric definitions | [DATA_SPECIFICATION.md](DATA_SPECIFICATION.md) |
| Ownership, verification, release, audit | [OWNERSHIP.md](OWNERSHIP.md), [QUALITY.md](QUALITY.md), [RELEASE.md](RELEASE.md), [AUDIT.md](AUDIT.md) |
