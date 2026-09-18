# Chess Wrapped Analytics

[![Verify](https://github.com/isaiapedro/chess-app/actions/workflows/verify.yml/badge.svg)](https://github.com/isaiapedro/chess-app/actions/workflows/verify.yml)

Chess Wrapped is a privacy-first mobile companion for reviewing games from
Chess.com and Lichess. Recaps, study tools, and Stockfish analysis run primarily
on the device; a small FastAPI service provides only shared resources.

## What the app does

- Summarizes results, activity, ratings, and streaks.
- Explains opening, middlegame, endgame, and play-style patterns.
- Replays analyzed games with evaluations and coach notes.
- Supports mistake review and opening preparation on the device.

## Privacy and data boundary

| Location | May contain | Must not contain |
|---|---|---|
| Mobile device | Auth token, raw games, PGN, local metrics, engine vault, coach cache | Other players' private data |
| API / VPC | Registered username/email, shared peer aggregates, study-proxy cache | Tokens, raw games, PGN, eval vault, or bulk personal analytics |

The platform and the device cache remain the source of truth for a player's
games. Optional coach comments send compact, selected moment facts only; they
do not upload the raw game vault. See [GOVERNANCE.md](GOVERNANCE.md) and the
[data-lifecycle contract](MOBILE_DATA_LIFECYCLE_CONTRACT.md) for the complete
boundary and change-control rules.

## Architecture

```text
Chess.com / Lichess
        │ direct, incremental pull
        ▼
Expo mobile app ──► device cache ──► Recap / Games / Study / Insights
        │                  │
        │                  └── heuristics + selective Stockfish analysis
        │
        └──► thin API ──► peer baselines, opening explorer, account registry
```

The API does not synchronize personal games. Its browser CORS policy is
explicitly configured with `CHESS_ALLOWED_ORIGINS`; native clients do not need
CORS. API request logs are structured and body-free.

For deeper source ownership and runtime flow, read [ARCHITECTURE.md](ARCHITECTURE.md).
Metric definitions are in [DATA_SPECIFICATION.md](DATA_SPECIFICATION.md).

## Quick start

### API

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

OpenAPI is available at <http://localhost:8000/docs>.

Copy `.env.example` to `.env` to configure optional Lichess explorer access,
per-process limits, and approved web origins. Keep
`ALLOW_SERVER_USER_GAMES_CACHE` off on API hosts.

### Mobile

```bash
cd mobile
npm ci
npx expo start -c
```

The app targets Expo SDK 57. Leave `EXPO_PUBLIC_API_URL` unset for local Expo
development unless a specific API host is required; the app can derive its
development base URL from the Expo host for shared API resources.

For Lichess OAuth, register `com.chesswrapped.app://oauth` for the
`chess-wrapped-mobile` client. A development build is preferable to Expo Go
for that redirect flow.

## Verification

Run the same deterministic checks used by GitHub Actions:

```bash
cd mobile && npm ci && npm run verify
cd .. && .venv/bin/python scripts/run_python_tests.py
```

The checks cover TypeScript, deterministic mobile smoke tests, metric fixtures,
and API request-correlation behavior. They do not replace visual verification
on a real device or cache/performance testing; record that runtime evidence for
user-visible or lifecycle changes. See [QUALITY.md](QUALITY.md) and
[RELEASE.md](RELEASE.md).

## Repository guide

| Path | Purpose |
|---|---|
| `mobile/` | Expo app, local storage, analytics, Stockfish integration, and UI |
| `api/` | FastAPI service for small shared capabilities only |
| `scripts/` | Offline baseline and metric tooling |
| `fixtures/`, `samples/` | Deterministic test and analysis inputs |
| `DATA_SPECIFICATION.md` | Definitions and provenance of tracked metrics |
| `MOBILE_DATA_LIFECYCLE_CONTRACT.md` | Cache, invalidation, compute, and residency rules |
| `GOVERNANCE.md` | Repository authority, privacy, and release controls |

New contributors and coding agents should start with [AGENTS.md](AGENTS.md)
and [mobile/AGENT_ONBOARDING.md](mobile/AGENT_ONBOARDING.md). The repository
uses independent commit authority; keep unrelated product work separate from
governance, testing, and release changes.
