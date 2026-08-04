# Chess Wrapped Analytics

Expo mobile client (on-device ingest + metrics) and a thin FastAPI VPC for
peer baselines, opening explorer/masters proxy, and a username/email registry.

## Data residency

| Location | Allowed data |
|----------|----------------|
| **Server / VPC** | Usernames + emails (`.cache/users/`), peer baseline metrics (`.cache/baselines/`) |
| **Mobile device** | Auth tokens, user games, Stockfish vault, Recap/Insights/Study caches |

User games and other bulk personal analytics must not persist on the server.
Server-side `user_games*` / `session_stats` disk caches stay off unless
`ALLOW_SERVER_USER_GAMES_CACHE=1` (scripts only; never for the API happy path).

## Architecture

| Layer | Owns |
|-------|------|
| **Mobile** | Auth (Lichess OAuth PKCE or Chess.com username+email), user-game ingest from Chess.com/Lichess, Recap + Insights, Study Stockfish vault |
| **API (VPC)** | `POST /users/register`, peer baselines, opening explorer, masters PGN |

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
| `API_SEM_CHEAP` | `32` | Cap cheap endpoints (health, baselines, users) |
| `ALLOW_SERVER_USER_GAMES_CACHE` | off | Must stay off on API hosts |

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/v1/users/register` | Upsert username + email (no tokens, no games) |
| GET | `/api/v1/users` | List registered usernames/emails |
| GET | `/api/v1/baselines` | Peer baseline means (also bundled on device) |
| GET | `/api/v1/study/explorer` | Lichess/masters/player opening explorer |
| GET | `/api/v1/study/masters-pgn/{game_id}` | Masters game PGN by id |

Legacy `/api/v1/games`, `/session`, `/stats/*` are removed from the API surface.

### Examples

```bash
curl "http://localhost:8000/health"
curl -X POST "http://localhost:8000/api/v1/users/register" \
  -H 'content-type: application/json' \
  -d '{"platform":"chesscom","username":"alice","email":"alice@example.com"}'
curl "http://localhost:8000/api/v1/baselines"
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
