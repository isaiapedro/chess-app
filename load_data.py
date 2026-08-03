import io
import json
import os
import re
import time
from datetime import datetime, timedelta
from pathlib import Path

import chess.pgn
import pandas as pd
import requests

from cache import CACHE_BASE, atomic_write_json, cache_file_lock, disk_cache

USER_GAMES_DIR = CACHE_BASE / "user_games"


def _env_ttl_sec(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return default


GAMES_FETCH_TTL_SEC = _env_ttl_sec("GAMES_FETCH_TTL_SEC", 86400)
CHESSCOM_UA = {
    "User-Agent": "LichessChesscomDashboard/1.0 (contact: dev@example.com)"
}


def _safe_username(username: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "_", username.strip().lower())


def _user_store_path(platform: str, username: str) -> Path:
    USER_GAMES_DIR.mkdir(parents=True, exist_ok=True)
    return USER_GAMES_DIR / f"{platform}_{_safe_username(username)}.json"


def _user_meta_path(path: Path) -> Path:
    return path.with_name(path.name + ".meta")


def _load_user_store_at(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("games"), list):
        return None
    return data


def _load_meta_at(path: Path) -> dict | None:
    meta_path = _user_meta_path(path)
    if not meta_path.exists():
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def _write_user_meta(
    path: Path,
    *,
    last_fetched_at: float | None = None,
    coverage_since: float | None = None,
) -> None:
    meta = _load_meta_at(path) or {}
    if last_fetched_at is not None:
        meta["last_fetched_at"] = float(last_fetched_at)
    if coverage_since is not None:
        meta["coverage_since"] = float(coverage_since)
    if not meta:
        return
    atomic_write_json(_user_meta_path(path), meta)


def _touch_last_fetched_at(path: Path, ts: float | None = None) -> None:
    _write_user_meta(path, last_fetched_at=float(ts if ts is not None else time.time()))


def _read_last_fetched_at(path: Path, store: dict | None) -> float:
    meta = _load_meta_at(path)
    if meta is not None:
        try:
            ts = float(meta.get("last_fetched_at") or 0)
            if ts > 0:
                return ts
        except (TypeError, ValueError):
            pass
    if store:
        try:
            return float(store.get("last_fetched_at") or 0)
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def _store_is_fresh(path: Path, store: dict) -> bool:
    if GAMES_FETCH_TTL_SEC <= 0:
        return False
    last = _read_last_fetched_at(path, store)
    if last <= 0:
        return False
    return (time.time() - last) < GAMES_FETCH_TTL_SEC


def _coverage_value(raw) -> float | None:
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _coverage_since_of(path: Path, store: dict | None) -> float:
    store_cov = None
    if store is not None and "coverage_since" in store:
        store_cov = _coverage_value(store.get("coverage_since"))
    meta = _load_meta_at(path)
    meta_cov = None
    if meta is not None and "coverage_since" in meta:
        meta_cov = _coverage_value(meta.get("coverage_since"))
    values = [v for v in (store_cov, meta_cov) if v is not None]
    if not values:
        return 0.0
    if any(v <= 0 for v in values):
        return 0.0
    return min(values)


def _coverage_covers(coverage_since: float, requested_since: float) -> bool:
    if coverage_since <= 0:
        return True
    if requested_since <= 0:
        return False
    return coverage_since <= requested_since


def _save_user_store_at(
    path: Path, platform: str, username: str, store: dict
) -> None:
    now = time.time()
    last_fetched = store.get("last_fetched_at") or now
    payload = {
        "username": username.lower(),
        "platform": platform,
        "games": store.get("games") or [],
        "watermark": store.get("watermark") or 0,
        "coverage_since": store.get("coverage_since") or 0,
        "last_fetched_at": last_fetched,
    }
    atomic_write_json(path, payload)
    _touch_last_fetched_at(path, float(last_fetched))


def _read_user_store(platform: str, username: str) -> dict | None:
    path = _user_store_path(platform, username)
    with cache_file_lock(path):
        return _load_user_store_at(path)


def games_store_watermark(platform: str, username: str) -> int:
    store = _read_user_store(platform, username)
    if not store:
        return 0
    try:
        return int(store.get("watermark") or 0)
    except (TypeError, ValueError):
        return 0


def _write_user_store(platform: str, username: str, store: dict) -> None:
    path = _user_store_path(platform, username)
    with cache_file_lock(path):
        _save_user_store_at(path, platform, username, store)


def _merge_games_by_id(existing: list, incoming: list, id_fn) -> list:
    by_id = {}
    for game in existing:
        key = id_fn(game)
        if key is not None:
            by_id[key] = game
    for game in incoming:
        key = id_fn(game)
        if key is not None:
            by_id[key] = game
    return list(by_id.values())


def _incoming_adds_games(existing: list, incoming: list, id_fn) -> bool:
    if not incoming:
        return False
    have = {id_fn(g) for g in existing}
    have.discard(None)
    for game in incoming:
        key = id_fn(game)
        if key is not None and key not in have:
            return True
    return False


def _game_id_set(games: list, id_fn) -> set:
    return {id_fn(g) for g in games if id_fn(g) is not None}


def _lichess_game_id(game: dict):
    return game.get("id")


def _lichess_game_end_ms(game: dict) -> int:
    return int(game.get("lastMoveAt") or game.get("createdAt") or 0)


def _chesscom_game_id(game: dict):
    url = game.get("url") or ""
    return url or None


def _chesscom_game_end(game: dict) -> float:
    return float(game.get("end_time") or 0)


def _lichess_api_fetch(username: str, since_ms: int) -> list | None:
    url = f"https://lichess.org/api/games/user/{username}"
    headers = {"Accept": "application/x-ndjson"}
    params = {
        "opening": "true",
        "evals": "false",
        "perfType": "bullet,blitz,rapid,classical",
    }
    if since_ms > 0:
        params["since"] = since_ms
    res = requests.get(url, headers=headers, params=params)
    if res.status_code != 200:
        return None

    games = []
    text = (res.text or "").strip()
    if not text:
        return []
    for line in text.split("\n"):
        if line:
            games.append(json.loads(line))
    return games


def _filter_lichess_since(games: list, since_ms: int) -> list:
    if since_ms <= 0:
        return games
    return [g for g in games if _lichess_game_end_ms(g) >= since_ms]


def fetch_lichess_games_raw(username: str, since_ms: int = 0) -> list:
    path = _user_store_path("lichess", username)
    with cache_file_lock(path):
        store = _load_user_store_at(path)
        if store is not None:
            covers = _coverage_covers(
                _coverage_since_of(path, store), float(since_ms)
            )
            if covers and _store_is_fresh(path, store):
                return _filter_lichess_since(store.get("games") or [], since_ms)

    if store is None:
        fetch_since = max(0, int(since_ms))
        fetched = _lichess_api_fetch(username, since_ms=fetch_since)
        if fetched is None:
            return []
        with cache_file_lock(path):
            existing = _load_user_store_at(path)
            if existing is not None:
                games = _merge_games_by_id(
                    existing.get("games") or [], fetched, _lichess_game_id
                )
                prior = _coverage_since_of(path, existing)
                if prior <= 0 or fetch_since <= 0:
                    coverage_since = 0.0
                else:
                    coverage_since = min(prior, float(fetch_since))
            else:
                games = fetched
                coverage_since = float(fetch_since)
            watermark = max((_lichess_game_end_ms(g) for g in games), default=0)
            _save_user_store_at(
                path,
                "lichess",
                username,
                {
                    "games": games,
                    "watermark": watermark,
                    "coverage_since": coverage_since,
                    "last_fetched_at": time.time(),
                },
            )
        return _filter_lichess_since(games, since_ms)

    covers = _coverage_covers(_coverage_since_of(path, store), float(since_ms))
    if not covers:
        fetch_since = max(0, int(since_ms))
        incoming = _lichess_api_fetch(username, since_ms=fetch_since)
        with cache_file_lock(path):
            existing = _load_user_store_at(path) or store
            games = existing.get("games") or []
            if incoming is None:
                return _filter_lichess_since(games, since_ms)
            prior = _coverage_since_of(path, existing)
            if prior <= 0 or fetch_since <= 0:
                coverage_since = 0.0
            else:
                coverage_since = min(prior, float(fetch_since))
            if not _incoming_adds_games(games, incoming, _lichess_game_id):
                _write_user_meta(
                    path,
                    last_fetched_at=time.time(),
                    coverage_since=coverage_since,
                )
                return _filter_lichess_since(games, since_ms)
            games = _merge_games_by_id(games, incoming, _lichess_game_id)
            watermark = max((_lichess_game_end_ms(g) for g in games), default=0)
            _save_user_store_at(
                path,
                "lichess",
                username,
                {
                    "games": games,
                    "watermark": watermark,
                    "coverage_since": coverage_since,
                    "last_fetched_at": time.time(),
                },
            )
        return _filter_lichess_since(games, since_ms)

    watermark = int(store.get("watermark") or 0)
    incoming = _lichess_api_fetch(username, since_ms=watermark)
    with cache_file_lock(path):
        existing = _load_user_store_at(path) or store
        games = existing.get("games") or []
        if incoming is None:
            return _filter_lichess_since(games, since_ms)
        if not _incoming_adds_games(games, incoming, _lichess_game_id):
            _touch_last_fetched_at(path)
            return _filter_lichess_since(games, since_ms)
        games = _merge_games_by_id(games, incoming, _lichess_game_id)
        watermark = max(
            int(existing.get("watermark") or 0),
            max((_lichess_game_end_ms(g) for g in games), default=0),
        )
        _save_user_store_at(
            path,
            "lichess",
            username,
            {
                "games": games,
                "watermark": watermark,
                "coverage_since": _coverage_since_of(path, existing),
                "last_fetched_at": time.time(),
            },
        )
    return _filter_lichess_since(games, since_ms)


def _archive_year_month(archive_url: str) -> tuple[int, int] | None:
    match = re.search(r"/(\d{4})/(\d{2})/?$", archive_url)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def _archive_sealed_at(archive_url: str) -> float | None:
    parsed = _archive_year_month(archive_url)
    if parsed is None:
        return None
    year, month = parsed
    next_month = (
        datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    )
    return next_month.timestamp()


def _archive_cache_is_stale(cached_at: float, args: tuple, kwargs: dict) -> bool:
    archive_url = args[0] if args else kwargs.get("archive_url", "")
    sealed_at = _archive_sealed_at(archive_url)
    if sealed_at is None:
        return True
    return cached_at < sealed_at


def _chesscom_archive_url(username: str, year: int, month: int) -> str:
    return (
        f"https://api.chess.com/pub/player/{username.lower()}"
        f"/games/{year}/{month:02d}"
    )


def _chesscom_list_archives(username: str) -> list[str]:
    list_url = (
        f"https://api.chess.com/pub/player/{username.lower()}/games/archives"
    )
    res = requests.get(list_url, headers=CHESSCOM_UA)
    if res.status_code != 200:
        return []
    return res.json().get("archives", []) or []


def _archives_overlapping_since(
    archives: list[str], since_timestamp: float
) -> list[str]:
    if since_timestamp <= 0:
        return list(archives)
    selected = []
    for archive_url in archives:
        sealed_at = _archive_sealed_at(archive_url)
        if sealed_at is None:
            continue
        if sealed_at > since_timestamp:
            selected.append(archive_url)
    return selected


def _fetch_chesscom_archives(archives: list[str]) -> list:
    fetched = []
    for archive_url in archives:
        fetched.extend(fetch_chesscom_archive_raw(archive_url) or [])
    return _merge_games_by_id([], fetched, _chesscom_game_id)


@disk_cache("user_games_chesscom", is_stale=_archive_cache_is_stale)
def fetch_chesscom_archive_raw(archive_url: str):
    res = requests.get(archive_url, headers=CHESSCOM_UA)
    if res.status_code == 200:
        return res.json().get("games", [])
    return []


def _chesscom_refresh_head(username: str, games: list) -> list:
    now = datetime.now()
    current_url = _chesscom_archive_url(username, now.year, now.month)
    head_games = fetch_chesscom_archive_raw(current_url) or []

    prev_year, prev_month = (
        (now.year - 1, 12) if now.month == 1 else (now.year, now.month - 1)
    )
    prev_url = _chesscom_archive_url(username, prev_year, prev_month)
    prev_games = fetch_chesscom_archive_raw(prev_url) or []

    head_months = {
        (now.year, now.month),
        (prev_year, prev_month),
    }

    retained = []
    for game in games:
        end_time = _chesscom_game_end(game)
        if end_time <= 0:
            retained.append(game)
            continue
        dt = datetime.fromtimestamp(end_time)
        if (dt.year, dt.month) not in head_months:
            retained.append(game)

    return _merge_games_by_id(
        retained,
        list(prev_games) + list(head_games),
        _chesscom_game_id,
    )


def _filter_chesscom_since(games: list, since_timestamp: float) -> list:
    if since_timestamp <= 0:
        return games
    return [g for g in games if _chesscom_game_end(g) >= since_timestamp]


def _merged_coverage_since(path: Path, store: dict | None, fetch_since: float) -> float:
    prior = _coverage_since_of(path, store)
    if prior <= 0 or fetch_since <= 0:
        return 0.0
    return min(prior, float(fetch_since))


def fetch_chesscom_games_raw(username: str, since_timestamp: float = 0) -> list:
    path = _user_store_path("chesscom", username)
    with cache_file_lock(path):
        store = _load_user_store_at(path)
        if store is not None:
            covers = _coverage_covers(
                _coverage_since_of(path, store), float(since_timestamp)
            )
            if covers and _store_is_fresh(path, store):
                return _filter_chesscom_since(
                    store.get("games") or [], since_timestamp
                )

    if store is None:
        archives = _archives_overlapping_since(
            _chesscom_list_archives(username), since_timestamp
        )
        if not archives:
            return []
        fetched = _fetch_chesscom_archives(archives)
        with cache_file_lock(path):
            existing = _load_user_store_at(path)
            if existing is not None:
                games = _merge_games_by_id(
                    existing.get("games") or [], fetched, _chesscom_game_id
                )
                coverage_since = _merged_coverage_since(
                    path, existing, float(since_timestamp)
                )
            else:
                games = fetched
                coverage_since = float(max(0.0, since_timestamp))
            watermark = max((_chesscom_game_end(g) for g in games), default=0)
            _save_user_store_at(
                path,
                "chesscom",
                username,
                {
                    "games": games,
                    "watermark": watermark,
                    "coverage_since": coverage_since,
                    "last_fetched_at": time.time(),
                },
            )
        return _filter_chesscom_since(games, since_timestamp)

    covers = _coverage_covers(
        _coverage_since_of(path, store), float(since_timestamp)
    )
    if not covers:
        archives = _archives_overlapping_since(
            _chesscom_list_archives(username), since_timestamp
        )
        fetched = _fetch_chesscom_archives(archives) if archives else []
        with cache_file_lock(path):
            existing = _load_user_store_at(path) or store
            games = existing.get("games") or []
            coverage_since = _merged_coverage_since(
                path, existing, float(since_timestamp)
            )
            if not _incoming_adds_games(games, fetched, _chesscom_game_id):
                _write_user_meta(
                    path,
                    last_fetched_at=time.time(),
                    coverage_since=coverage_since,
                )
                return _filter_chesscom_since(games, since_timestamp)
            games = _merge_games_by_id(games, fetched, _chesscom_game_id)
            watermark = max((_chesscom_game_end(g) for g in games), default=0)
            _save_user_store_at(
                path,
                "chesscom",
                username,
                {
                    "games": games,
                    "watermark": watermark,
                    "coverage_since": coverage_since,
                    "last_fetched_at": time.time(),
                },
            )
        return _filter_chesscom_since(games, since_timestamp)

    refreshed = _chesscom_refresh_head(username, store.get("games") or [])
    with cache_file_lock(path):
        existing = _load_user_store_at(path) or store
        prior_games = existing.get("games") or []
        games = _merge_games_by_id(prior_games, refreshed, _chesscom_game_id)
        if _game_id_set(games, _chesscom_game_id) == _game_id_set(
            prior_games, _chesscom_game_id
        ):
            _touch_last_fetched_at(path)
            return _filter_chesscom_since(prior_games, since_timestamp)
        watermark = max((_chesscom_game_end(g) for g in games), default=0)
        _save_user_store_at(
            path,
            "chesscom",
            username,
            {
                "games": games,
                "watermark": watermark,
                "coverage_since": _coverage_since_of(path, existing),
                "last_fetched_at": time.time(),
            },
        )
    return _filter_chesscom_since(games, since_timestamp)


def load_user_data(
    username: str, timeframe: str = "6 months", platform: str = "chesscom"
) -> pd.DataFrame:
    tf = (timeframe or "").strip().lower()
    if tf in {"all", "lifetime"}:
        since_timestamp = 0.0
        since_ms = 0
    else:
        now = datetime.now()
        if tf == "1 month":
            start_date = (now - timedelta(days=30)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
        elif tf == "6 months":
            start_date = (now - timedelta(days=180)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
        else:
            start_date = (now - timedelta(days=365)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
        since_timestamp = start_date.timestamp()
        since_ms = int(since_timestamp * 1000)

    if platform.lower() == "chesscom":
        raw_games = fetch_chesscom_games_raw(username, since_timestamp)
        return _parse_chesscom_games(raw_games, username)
    else:
        raw_games = fetch_lichess_games_raw(username, since_ms)
        return _parse_lichess_games(raw_games, username)


def _parse_lichess_games(raw_games: list, username: str) -> pd.DataFrame:
    parsed = []
    for g in raw_games:
        user_color = (
            "white"
            if g.get("players", {})
            .get("white", {})
            .get("user", {})
            .get("name", "")
            .lower()
            == username.lower()
            else "black"
        )

        winner = g.get("winner")
        if winner is None:
            result = "Draw"
        elif winner == user_color:
            result = "Win"
        else:
            result = "Loss"

        opening_info = g.get("opening", {})
        moves_str = g.get("moves", "")
        move_count = len(moves_str.split()) // 2 if moves_str else 30
        opp_color = "black" if user_color == "white" else "white"
        status = g.get("status", "normal")
        user_term = status
        opp_term = status
        if status == "timeout":
            if winner == user_color:
                user_term = "win"
                opp_term = "timeout"
            elif winner == opp_color:
                user_term = "timeout"
                opp_term = "win"

        clock = g.get("clock") or {}
        initial_ms = clock.get("initial")
        if initial_ms is not None:
            time_control = (
                f"{int(initial_ms) // 1000}+{int(clock.get('increment', 0)) // 1000}"
            )
        else:
            time_control = ""

        ended_ms = g.get("lastMoveAt") or g.get("createdAt") or 0
        parsed.append(
            {
                "id": g.get("id"),
                "created_at": datetime.fromtimestamp(ended_ms / 1000),
                "speed": g.get("speed", "blitz"),
                "user_color": user_color,
                "user_rating": g.get("players", {})
                .get(user_color, {})
                .get("rating"),
                "opp_rating": g.get("players", {})
                .get(opp_color, {})
                .get("rating"),
                "opponent_name": g.get("players", {})
                .get(opp_color, {})
                .get("user", {})
                .get("name", "Unknown"),
                "result": result,
                "opening_name": opening_info.get("name", "Unknown"),
                "opening_eco": opening_info.get("eco", "UNK"),
                "move_count": max(move_count, 1),
                "moves_str": moves_str,
                "pgn_str": "",
                "time_control": time_control,
                "termination": str(user_term).title(),
                "opp_termination": str(opp_term).title(),
            }
        )
    return pd.DataFrame(parsed)


def moves_from_pgn(pgn_str: str) -> str:
    if not pgn_str or not str(pgn_str).strip():
        return ""
    try:
        game = chess.pgn.read_game(io.StringIO(str(pgn_str)))
        if game is None:
            return ""
        board = game.board()
        sans: list[str] = []
        for move in game.mainline_moves():
            sans.append(board.san(move))
            board.push(move)
        return " ".join(sans)
    except (ValueError, AssertionError, OSError):
        return ""


def _parse_chesscom_games(raw_games: list, username: str) -> pd.DataFrame:
    parsed = []
    draw_outcomes = {
        "agreed",
        "repetition",
        "stalemate",
        "insufficient",
        "50move",
        "timevsinsufficient",
    }

    for g in raw_games:
        white_player = g.get("white", {})
        black_player = g.get("black", {})

        is_white = white_player.get("username", "").lower() == username.lower()
        user_color = "white" if is_white else "black"
        user_data = white_player if is_white else black_player
        opp_data = black_player if is_white else white_player

        user_result = user_data.get("result", "")
        if user_result == "win":
            result = "Win"
        elif user_result in draw_outcomes:
            result = "Draw"
        else:
            result = "Loss"

        pgn_str = g.get("pgn", "")
        eco_match = re.search(r'\[ECO "([^"]+)"\]', pgn_str)
        opening_eco = eco_match.group(1) if eco_match else "UNK"

        eco_url = g.get("eco", "")
        if not eco_url:
            eco_url_match = re.search(r'\[ECOUrl "([^"]+)"\]', pgn_str)
            eco_url = eco_url_match.group(1) if eco_url_match else ""
        if eco_url:
            raw_opening = eco_url.split("/")[-1].replace("-", " ")
            opening_name = re.sub(r"\d+$", "", raw_opening).strip()
        else:
            opening_name = "Unknown"

        move_matches = re.findall(r"\d+\.\s", pgn_str)
        move_count = len(move_matches) if move_matches else 35
        opp_result = opp_data.get("result", "")
        moves_str = moves_from_pgn(pgn_str)

        parsed.append(
            {
                "id": g.get("url", "").split("/")[-1],
                "created_at": datetime.fromtimestamp(g.get("end_time", 0)),
                "speed": g.get("time_class", "blitz"),
                "user_color": user_color,
                "user_rating": user_data.get("rating"),
                "opp_rating": opp_data.get("rating"),
                "opponent_name": opp_data.get("username", "Unknown"),
                "result": result,
                "opening_name": opening_name,
                "opening_eco": opening_eco,
                "move_count": max(move_count, 1),
                "moves_str": moves_str,
                "pgn_str": pgn_str,
                "time_control": g.get("time_control", ""),
                "termination": user_result.title() if user_result else "Normal",
                "opp_termination": opp_result.title() if opp_result else "Normal",
            }
        )
    return pd.DataFrame(parsed)
