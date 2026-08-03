import fcntl
import functools
import hashlib
import json
import os
import pathlib
import tempfile
import threading
import time
from contextlib import contextmanager

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
JSON_SEPARATORS = (",", ":")


@contextmanager
def cache_file_lock(path: pathlib.Path):
    lock_path = pathlib.Path(str(path) + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "a+b") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def atomic_write_json(path: pathlib.Path, data) -> None:
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, separators=JSON_SEPARATORS)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def _read_json_file(path: pathlib.Path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


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


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return max(0.0, float(raw))
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


EXPLORER_LABELS = frozenset(
    {"explorer_lichess", "explorer_masters", "explorer_player"}
)
EXPLORER_SOFT_COOLDOWN = _env_float("EXPLORER_SOFT_COOLDOWN_SEC", 8.0)
EXPLORER_SOFT_COOLDOWN_CAP = _env_float("EXPLORER_SOFT_COOLDOWN_CAP_SEC", 20.0)
MASTERS_PGN_SOFT_COOLDOWN = _env_float("MASTERS_PGN_SOFT_COOLDOWN_SEC", 5.0)
EXPLORER_CONCURRENCY = _env_int("EXPLORER_CONCURRENCY", 3)

_backoff_lock = threading.Lock()
_explorer_backoff_until: dict[str, float] = {}
_masters_pgn_backoff_until: dict[str, float] = {}
_explorer_sema = threading.Semaphore(EXPLORER_CONCURRENCY)


def _lichess_token_key() -> str:
    token = os.environ.get("LICHESS_TOKEN") or os.environ.get("LICHESS_API_TOKEN")
    if not token:
        return "anon"
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]


def _backoff_active(table: dict[str, float], key: str) -> bool:
    with _backoff_lock:
        until = table.get(key, 0.0)
        if until <= time.monotonic():
            if key in table:
                table.pop(key, None)
            return False
        return True


def _set_backoff(table: dict[str, float], key: str, seconds: float) -> None:
    with _backoff_lock:
        table[key] = time.monotonic() + max(0.0, seconds)


def _retry_after_seconds(res: requests.Response, default: float, cap: float) -> float:
    try:
        retry_after = float(res.headers.get("Retry-After") or default)
    except ValueError:
        retry_after = default
    return min(max(0.0, retry_after), cap)


def lichess_get(url: str, params: dict, label: str):
    token_key = _lichess_token_key()
    is_explorer = label in EXPLORER_LABELS
    if is_explorer and _backoff_active(_explorer_backoff_until, token_key):
        return None

    def _do_request():
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
            if is_explorer:
                _set_backoff(
                    _explorer_backoff_until,
                    token_key,
                    _retry_after_seconds(
                        res, EXPLORER_SOFT_COOLDOWN, EXPLORER_SOFT_COOLDOWN_CAP
                    ),
                )
            return None

        if res.status_code != 200:
            return None
        try:
            return res.json()
        except ValueError:
            return None

    if is_explorer:
        with _explorer_sema:
            if _backoff_active(_explorer_backoff_until, token_key):
                return None
            return _do_request()
    return _do_request()


def disk_cache(subdir: str, is_stale=None):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            cache_dir = CACHE_BASE / subdir
            cache_dir.mkdir(parents=True, exist_ok=True)

            param_str = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True)
            param_hash = hashlib.md5(param_str.encode("utf-8")).hexdigest()
            cache_file = cache_dir / f"{param_hash}.json"

            with cache_file_lock(cache_file):
                if cache_file.exists():
                    cached_at = cache_file.stat().st_mtime
                    if is_stale is None or not is_stale(cached_at, args, kwargs):
                        try:
                            return _read_json_file(cache_file)
                        except (OSError, json.JSONDecodeError, ValueError):
                            pass

            result = func(*args, **kwargs)
            if result is not None:
                with cache_file_lock(cache_file):
                    if cache_file.exists():
                        cached_at = cache_file.stat().st_mtime
                        if is_stale is None or not is_stale(cached_at, args, kwargs):
                            try:
                                return _read_json_file(cache_file)
                            except (OSError, json.JSONDecodeError, ValueError):
                                pass
                    atomic_write_json(cache_file, result)
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
    token_key = _lichess_token_key()
    if _backoff_active(_masters_pgn_backoff_until, token_key):
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
        _set_backoff(
            _masters_pgn_backoff_until,
            token_key,
            _retry_after_seconds(
                res, MASTERS_PGN_SOFT_COOLDOWN, EXPLORER_SOFT_COOLDOWN_CAP
            ),
        )
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
