# Chess Wrapped Analytics

Streamlit desktop dashboard, FastAPI backend, and Expo mobile client.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Streamlit (desktop)

```bash
streamlit run app.py
```

## FastAPI (Phase 1 backend)

```bash
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

OpenAPI docs: http://localhost:8000/docs

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/v1/games/{username}` | Parsed games JSON |
| GET | `/api/v1/stats/recap` | Headline, badges, comparisons, rating series |
| GET | `/api/v1/stats/insights` | Style / openings / middlegames / endgames |
| GET | `/api/v1/study/eval` | Lichess cloud-eval for a FEN |
| GET | `/api/v1/study/explorer` | Lichess/masters/player explorer |
| GET | `/api/v1/study/mistakes` | Critical mistakes from recent losses |
| POST | `/api/v1/study/quiz/validate` | Validate quiz move vs engine best |

Shared query params: `platform` (`chesscom`\|`lichess`), `timeframe` (`1 month`\|`6 months`\|`1 year`), `speed`, `color`, `result`, `eco`, `date_from`, `date_to`.

Recap/insights also require `username`. Games supports `include_pgn=true`.

### Examples

```bash
curl "http://localhost:8000/health"
curl "http://localhost:8000/api/v1/games/pedroisaia?platform=chesscom&timeframe=1%20month"
curl "http://localhost:8000/api/v1/stats/recap?username=pedroisaia&platform=chesscom&timeframe=1%20month"
curl "http://localhost:8000/api/v1/stats/insights?username=pedroisaia&platform=chesscom&timeframe=1%20month"
curl "http://localhost:8000/api/v1/study/eval?fen=rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR%20w%20KQkq%20-%200%201"
```

Optional for full opening explorer DB: set `LICHESS_TOKEN` (see `.env.example`). Without it, repertoire falls back to cloud-eval lines.
## Mobile (Phase 2 Expo)

API port `8000` may be blocked on LAN by the host firewall while Metro `8081` stays reachable.
Metro proxies `/api/*` and `/health` → `http://127.0.0.1:8000`. Point the app at Metro:

```bash
# terminal 1 — API
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000

# terminal 2 — Expo (use :8081, not :8000)
cd mobile
EXPO_PUBLIC_API_URL=http://192.168.1.9:8081 npx expo start -c
```

If `EXPO_PUBLIC_API_URL` unset, app derives base from Expo `hostUri` (Metro).

Optional: open firewall instead — `sudo ufw allow 8000/tcp` — then you can hit `:8000` directly.

- Tabs: Recap | Insights (placeholder) | Study (mistakes quiz + repertoire explorer).
- Sticky filter header: username, platform, timeframe, date presets (Year/Month/Week/Day/Custom), speed, color.
- Study board uses `chess.js` + custom squares (Expo Go friendly; no Skia).
