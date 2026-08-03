# Chess Wrapped Analytics

Expo mobile client (on-device ingest + metrics) and a thin FastAPI VPC for opening explorer / masters / peer baselines.

## Architecture

| Layer | Owns |
|-------|------|
| **Mobile** | Auth (Lichess OAuth PKCE or Chess.com username+email), user-game ingest from Chess.com/Lichess, Recap + Insights factors, Study Stockfish vault |
| **API (VPC)** | Opening explorer, masters PGN, peer baselines — not user games / session / recap / insights on the happy path |

Scripts and legacy routes under `/api/v1/games`, `/session`, `/stats/*` may still exist for offline tooling; the Expo app does not call them.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## FastAPI (thin VPC)

Run from the repository root (not from `mobile/`), otherwise `api` is not importable:

```bash
cd /path/to/chess
# Dev (auto-reload, single process)
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000

# Prod-ish on a small VPC (1–2 workers; no Redis)
UVICORN_WORKERS=2 ./scripts/run_api.sh
```

OpenAPI docs: http://localhost:8000/docs

### Production knobs

Copy `.env.example` → `.env`. Useful env vars (process-local only; no Redis):

| Variable | Default | Role |
|----------|---------|------|
| `LICHESS_TOKEN` | _(empty)_ | Opening explorer reliability |
| `API_SEM_STUDY` | `6` | Cap concurrent explorer / masters work |
| `API_SEM_CHEAP` | `32` | Cap cheap endpoints (health, baselines, …) |
| `GAMES_FETCH_TTL_SEC` | `86400` | Only for optional/legacy server-side game stores (min 24h) |
| `STATS_DISK_TTL_SEC` | `86400` | Only for optional/legacy server-side stats (min 24h) |

### Endpoints (mobile happy path)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/v1/baselines` | Peer baseline bands (cached permanently on device) |
| GET | `/api/v1/study/explorer` | Lichess/masters/player opening explorer |
| GET | `/api/v1/study/masters-pgn/{game_id}` | Masters game PGN by id |

Legacy (scripts / optional): `/api/v1/games/{username}`, `/api/v1/session/{username}`, `/api/v1/stats/recap`, `/api/v1/stats/insights`.

### Examples

```bash
curl "http://localhost:8000/health"
curl "http://localhost:8000/api/v1/baselines"
curl "http://localhost:8000/api/v1/study/explorer?fen=rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR%20w%20KQkq%20-%200%201&source=lichess"
```

Optional for opening explorer: set `LICHESS_TOKEN` (see `.env.example`). Without it, explorer requests may return empty move lists.

## Mobile (Expo SDK 54)

API port `8000` may be blocked on LAN by the host firewall while Metro `8081` stays reachable.
Metro proxies `/api/*` and `/health` → `http://127.0.0.1:8000`. Point the app at Metro:

```bash
# terminal 1 — API (from repo root)
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000

# terminal 2 — Expo
cd mobile
npx expo start -c
```

Leave `EXPO_PUBLIC_API_URL` unset: the app derives its base URL from Expo `hostUri` for explorer/baselines only.

### Auth

- **Chess.com:** Profile screen collects username + contact email (SecureStore). Email is used in the Chess.com `User-Agent`.
- **Lichess:** OAuth PKCE (`email:read`, `study:write`), client id `chess-wrapped-mobile`,
  redirect `com.chesswrapped.app://oauth` (reverse-domain custom scheme).
  Register that exact URI with Lichess. Expo Go may use a different linking URI — prefer a
  development build with the app scheme for OAuth.
- After login, the phone ingests games incrementally into AsyncStorage and computes Recap/Insights locally.

### App surface

- Tabs: Recap | Insights | Study (mistakes quiz + repertoire explorer) | Profile.
- Sticky filter header: period, speed (username/platform come from auth).
- Study board uses `chess.js` + custom squares.
- Peer baselines load once from the API and stay in permanent device cache.
- Pull-to-refresh verifies the active period/speed filters match loaded data; mismatched filters load the correct cached slice. Games ingest only on cold first login and warm when a filter discovers new unregistered IDs.
- Mistake quizzes and opening prep run on-device; background Stockfish waits until heuristic metrics finish (Scan more temporarily owns the engine).
