import functools
import hashlib
import json
import os
import pathlib
import time
import requests
from dotenv import load_dotenv

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent
load_dotenv(PROJECT_ROOT / ".env")
CACHE_BASE = PROJECT_ROOT / ".cache"
CACHE_BASE.mkdir(exist_ok=True)

EXPLORER_BASE = os.environ.get(
    "LICHESS_EXPLORER_BASE", "https://explorer.lichess.org"
)

REQUEST_TIMEOUT = 10


# region agent log
def _dbg(payload: dict) -> None:
    try:
        log_dir = PROJECT_ROOT / ".cursor"
        log_dir.mkdir(parents=True, exist_ok=True)
        with open(log_dir / "debug-6840b8.log", "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "sessionId": "6840b8",
                        "runId": "post-fix",
                        "timestamp": int(time.time() * 1000),
                        **payload,
                    }
                )
                + "\n"
            )
    except Exception:
        pass
# endregion


def _lichess_headers() -> dict:
    headers = {
        "User-Agent": "ChessWrappedDashboard/1.0 (contact: local-dev)",
        "Accept": "application/json",
    }
    token = os.environ.get("LICHESS_TOKEN") or os.environ.get("LICHESS_API_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


RATE_LIMIT_COOLDOWN = 120.0
_rate_limited_until = 0.0


def lichess_get(url: str, params: dict, label: str):
    """GET JSON from Lichess, returning None on any transport or HTTP error."""
    global _rate_limited_until

    if time.monotonic() < _rate_limited_until:
        return None

    started = time.monotonic()
    try:
        res = requests.get(
            url,
            params=params,
            headers=_lichess_headers(),
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as exc:
        # region agent log
        _dbg(
            {
                "hypothesisId": "H2",
                "location": "cache.py:lichess_get",
                "message": "lichess request raised",
                "data": {
                    "label": label,
                    "error": type(exc).__name__,
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                },
            }
        )
        # endregion
        return None

    # region agent log
    _dbg(
        {
            "hypothesisId": "H1",
            "location": "cache.py:lichess_get",
            "message": "lichess response",
            "data": {
                "label": label,
                "status": res.status_code,
                "elapsed_ms": int((time.monotonic() - started) * 1000),
                "retry_after": res.headers.get("Retry-After"),
            },
        }
    )
    # endregion

    if res.status_code == 429:
        try:
            retry_after = float(res.headers.get("Retry-After") or RATE_LIMIT_COOLDOWN)
        except ValueError:
            retry_after = RATE_LIMIT_COOLDOWN
        _rate_limited_until = time.monotonic() + min(retry_after, RATE_LIMIT_COOLDOWN)
        return None

    if res.status_code != 200:
        return None
    try:
        return res.json()
    except ValueError:
        return None


def disk_cache(subdir: str, is_stale=None):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            cache_dir = CACHE_BASE / subdir
            cache_dir.mkdir(parents=True, exist_ok=True)

            param_str = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True)
            param_hash = hashlib.md5(param_str.encode("utf-8")).hexdigest()
            cache_file = cache_dir / f"{param_hash}.json"

            if cache_file.exists():
                cached_at = cache_file.stat().st_mtime
                if is_stale is None or not is_stale(cached_at, args, kwargs):
                    with open(cache_file, "r", encoding="utf-8") as f:
                        return json.load(f)

            result = func(*args, **kwargs)
            if result is not None:
                with open(cache_file, "w", encoding="utf-8") as f:
                    json.dump(result, f, indent=2)
            return result

        return wrapper

    return decorator


@disk_cache("explorer_lichess")
def get_lichess_stats(
    fen: str,
    speeds: str = "blitz,rapid",
    ratings: str = "1600,1800,2000",
):
    url = f"{EXPLORER_BASE}/lichess"
    params = {"fen": fen, "speeds": speeds, "ratings": ratings}
    return lichess_get(url, params, "explorer_lichess")


@disk_cache("explorer_masters")
def get_gm_games(fen: str):
    url = f"{EXPLORER_BASE}/masters"
    return lichess_get(
        url,
        {"fen": fen, "topGames": 15, "moves": 12},
        "explorer_masters",
    )


@disk_cache("explorer_player")
def get_player_prep(username: str, color: str, fen: str):
    url = f"{EXPLORER_BASE}/player"
    params = {"player": username.lower(), "color": color, "fen": fen}
    return lichess_get(url, params, "explorer_player")


@disk_cache("masters_pgn")
def get_masters_pgn(game_id: str):
    url = f"{EXPLORER_BASE}/masters/pgn/{game_id}"
    global _rate_limited_until
    if time.monotonic() < _rate_limited_until:
        return None
    try:
        res = requests.get(
            url,
            headers=_lichess_headers(),
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException:
        return None
    if res.status_code == 429:
        try:
            retry_after = float(res.headers.get("Retry-After") or RATE_LIMIT_COOLDOWN)
        except ValueError:
            retry_after = RATE_LIMIT_COOLDOWN
        _rate_limited_until = time.monotonic() + min(retry_after, RATE_LIMIT_COOLDOWN)
        return None
    if res.status_code != 200:
        return None
    text = (res.text or "").strip()
    if not text:
        return None
    return {"id": game_id, "pgn": text}


def rating_buckets_for_elo(elo: int, spread: int = 300) -> str:
    buckets = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]
    lo = elo - spread
    hi = elo + spread
    selected = [b for b in buckets if b >= lo - 100 and b <= hi + 100]
    if not selected:
        selected = [1600, 1800, 2000]
    return ",".join(str(b) for b in selected)


@disk_cache("cloud_eval")
def get_position_eval(fen: str, multi_pv: int = 1):
    url = "https://lichess.org/api/cloud-eval"
    return lichess_get(url, {"fen": fen, "multiPv": multi_pv}, "cloud_eval")
