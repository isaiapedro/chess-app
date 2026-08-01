import json
import re
from datetime import datetime, timedelta
import pandas as pd
import requests
from cache import disk_cache


# --- LICHESS FETCHING ---
@disk_cache("user_games_lichess")
def fetch_lichess_games_raw(username: str, since_ms: int):
    url = f"https://lichess.org/api/games/user/{username}"
    headers = {"Accept": "application/x-ndjson"}
    params = {
        "since": since_ms,
        "opening": "true",
        "evals": "false",
        "perfType": "bullet,blitz,rapid,classical",
    }
    res = requests.get(url, headers=headers, params=params)
    if res.status_code != 200:
        return []

    games = []
    for line in res.text.strip().split("\n"):
        if line:
            games.append(json.loads(line))
    return games


# --- CHESS.COM FETCHING ---
def _archive_sealed_at(archive_url: str) -> float | None:
    match = re.search(r"/(\d{4})/(\d{2})/?$", archive_url)
    if not match:
        return None
    year, month = int(match.group(1)), int(match.group(2))
    next_month = (
        datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    )
    return next_month.timestamp()


def _archive_cache_is_stale(cached_at: float, args: tuple, kwargs: dict) -> bool:
    archive_url = args[0] if args else kwargs.get("archive_url", "")
    sealed_at = _archive_sealed_at(archive_url)
    return sealed_at is None or cached_at < sealed_at


@disk_cache("user_games_chesscom", is_stale=_archive_cache_is_stale)
def fetch_chesscom_archive_raw(archive_url: str):
    headers = {
        "User-Agent": "LichessChesscomDashboard/1.0 (contact: dev@example.com)"
    }
    res = requests.get(archive_url, headers=headers)
    if res.status_code == 200:
        return res.json().get("games", [])
    return []


def fetch_chesscom_games_raw(username: str, since_timestamp: float):
    headers = {
        "User-Agent": "LichessChesscomDashboard/1.0 (contact: dev@example.com)"
    }
    list_url = f"https://api.chess.com/pub/player/{username.lower()}/games/archives"
    res = requests.get(list_url, headers=headers)

    if res.status_code != 200:
        return []

    archives = res.json().get("archives", [])
    all_games = []

    for archive_url in archives:
        for g in fetch_chesscom_archive_raw(archive_url):
            if g.get("end_time", 0) >= since_timestamp:
                all_games.append(g)

    return all_games


# --- UNIFIED DATA LOADER ---
def load_user_data(
    username: str, timeframe: str = "6 months", platform: str = "chesscom"
) -> pd.DataFrame:
    now = datetime.now()
    if timeframe == "1 month":
        start_date = (now - timedelta(days=30)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    elif timeframe == "6 months":
        start_date = (now - timedelta(days=180)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    else:  # 1 year
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

        parsed.append(
            {
                "id": g.get("id"),
                "created_at": datetime.fromtimestamp(
                    g.get("createdAt", 0) / 1000
                ),
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
                "moves_str": "",
                "pgn_str": pgn_str,
                "time_control": g.get("time_control", ""),
                "termination": user_result.title() if user_result else "Normal",
                "opp_termination": opp_result.title() if opp_result else "Normal",
            }
        )
    return pd.DataFrame(parsed)
