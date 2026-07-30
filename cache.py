import functools
import hashlib
import json
import os
import pathlib
import requests

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent
CACHE_BASE = PROJECT_ROOT / ".cache"
CACHE_BASE.mkdir(exist_ok=True)

EXPLORER_BASE = os.environ.get(
    "LICHESS_EXPLORER_BASE", "https://explorer.lichess.org"
)


def _lichess_headers() -> dict:
    headers = {
        "User-Agent": "ChessWrappedDashboard/1.0 (contact: local-dev)",
        "Accept": "application/json",
    }
    token = os.environ.get("LICHESS_TOKEN") or os.environ.get("LICHESS_API_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def disk_cache(subdir: str):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            cache_dir = CACHE_BASE / subdir
            cache_dir.mkdir(parents=True, exist_ok=True)

            param_str = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True)
            param_hash = hashlib.md5(param_str.encode("utf-8")).hexdigest()
            cache_file = cache_dir / f"{param_hash}.json"

            if cache_file.exists():
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
    res = requests.get(url, params=params, headers=_lichess_headers(), timeout=20)
    return res.json() if res.status_code == 200 else None


@disk_cache("explorer_masters")
def get_gm_games(fen: str):
    url = f"{EXPLORER_BASE}/masters"
    res = requests.get(
        url, params={"fen": fen}, headers=_lichess_headers(), timeout=20
    )
    return res.json() if res.status_code == 200 else None


@disk_cache("explorer_player")
def get_player_prep(username: str, color: str, fen: str):
    url = f"{EXPLORER_BASE}/player"
    params = {"player": username.lower(), "color": color, "fen": fen}
    res = requests.get(url, params=params, headers=_lichess_headers(), timeout=20)
    return res.json() if res.status_code == 200 else None


@disk_cache("cloud_eval")
def get_position_eval(fen: str, multi_pv: int = 1):
    url = "https://lichess.org/api/cloud-eval"
    res = requests.get(
        url,
        params={"fen": fen, "multiPv": multi_pv},
        headers=_lichess_headers(),
        timeout=20,
    )
    return res.json() if res.status_code == 200 else None
