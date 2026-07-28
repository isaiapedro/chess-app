import functools
import hashlib
import json
import os
import pathlib
import time
import requests

# Ensure cache directory structure exists
CACHE_BASE = pathlib.Path(".cache")
CACHE_BASE.mkdir(exist_ok=True)


def disk_cache(subdir: str):
    """Decorator to cache API JSON responses locally in .cache/<subdir>/"""

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            cache_dir = CACHE_BASE / subdir
            cache_dir.mkdir(parents=True, exist_ok=True)

            # Generate a unique MD5 hash for the function call parameters
            param_str = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True)
            param_hash = hashlib.md5(param_str.encode("utf-8")).hexdigest()
            cache_file = cache_dir / f"{param_hash}.json"

            # Return cached version if exists
            if cache_file.exists():
                with open(cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)

            # Otherwise execute API call and cache result
            result = func(*args, **kwargs)
            if result is not None:
                with open(cache_file, "w", encoding="utf-8") as f:
                    json.dump(result, f, indent=2)
            return result

        return wrapper

    return decorator


# --- COLD LAYER API FUNCTIONS ---


@disk_cache("explorer_lichess")
def get_lichess_stats(
    fen: str,
    speeds: str = "blitz,rapid",
    ratings: str = "1600,1800,2000",
):
    """FF: Population move statistics (explorer.lichess.ovh/lichess)"""
    url = "https://explorer.lichess.ovh/lichess"
    params = {"fen": fen, "speeds": speeds, "ratings": ratings}
    res = requests.get(url, params=params)
    return res.json() if res.status_code == 200 else None


@disk_cache("explorer_masters")
def get_gm_games(fen: str):
    """WC: GM Over-the-board database (explorer.lichess.ovh/masters)"""
    url = "https://explorer.lichess.ovh/masters"
    res = requests.get(url, params={"fen": fen})
    return res.json() if res.status_code == 200 else None


@disk_cache("explorer_player")
def get_player_prep(username: str, color: str, fen: str):
    """MO: Player Opening Preparation Explorer (explorer.lichess.ovh/player)"""
    url = "https://explorer.lichess.ovh/player"
    params = {"player": username.lower(), "color": color, "fen": fen}
    res = requests.get(url, params=params)
    return res.json() if res.status_code == 200 else None


@disk_cache("cloud_eval")
def get_position_eval(fen: str, multi_pv: int = 1):
    """TL: Cloud Engine Position Insights (lichess.org/api/cloud-eval)"""
    url = "https://lichess.org/api/cloud-eval"
    res = requests.get(url, params={"fen": fen, "multiPv": multi_pv})
    return res.json() if res.status_code == 200 else None
