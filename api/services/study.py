import os
import threading
from typing import Any, Callable, Optional, TypeVar

import chess
from fastapi import HTTPException

from cache import (
    get_gm_games,
    get_lichess_stats,
    get_masters_pgn,
    get_player_prep,
)


START_FEN = chess.STARTING_FEN
COALESCE_WAIT_SEC = 20.0

T = TypeVar("T")

_coalesce_lock = threading.Lock()
_coalesce: dict[str, tuple[threading.Event, dict[str, Any]]] = {}


def _coalesce_call(key: str, fn: Callable[[], T]) -> T:
    with _coalesce_lock:
        entry = _coalesce.get(key)
        if entry is not None:
            event, box = entry
            owner = False
        else:
            event = threading.Event()
            box = {"value": None, "error": None}
            _coalesce[key] = (event, box)
            owner = True
    if not owner:
        finished = event.wait(timeout=COALESCE_WAIT_SEC)
        if not finished:
            return fn()
        if box["error"] is not None:
            raise box["error"]
        return box["value"]
    try:
        value = fn()
        box["value"] = value
        return value
    except Exception as exc:
        box["error"] = exc
        raise
    finally:
        event.set()
        with _coalesce_lock:
            current = _coalesce.get(key)
            if current is not None and current[1] is box:
                _coalesce.pop(key, None)


def explorer_position(
    fen: str,
    source: str = "lichess",
    username: Optional[str] = None,
    color: Optional[str] = None,
    ratings: Optional[str] = None,
) -> dict:
    key = "|".join(
        [
            "study-explorer",
            source,
            fen,
            username or "",
            color or "",
            ratings or "",
        ]
    )
    return _coalesce_call(
        key,
        lambda: _explorer_position_uncached(
            fen, source=source, username=username, color=color, ratings=ratings
        ),
    )


def _explorer_position_uncached(
    fen: str,
    source: str = "lichess",
    username: Optional[str] = None,
    color: Optional[str] = None,
    ratings: Optional[str] = None,
) -> dict:
    data = None
    if source == "masters":
        data = get_gm_games(fen)
    elif source == "player":
        if not username or not color:
            raise HTTPException(
                status_code=400,
                detail="username and color required for player explorer",
            )
        data = get_player_prep(username, color, fen)
    else:
        resolved = ratings or "1600,1800,2000"
        data = get_lichess_stats(fen, ratings=resolved)

    if data is None:
        has_token = bool(
            os.environ.get("LICHESS_TOKEN") or os.environ.get("LICHESS_API_TOKEN")
        )
        return {
            "fen": fen,
            "source": source,
            "fallback": True,
            "white": 0,
            "draws": 0,
            "black": 0,
            "moves": [],
            "topGames": [],
            "opening": None,
            "ratings": ratings,
            "note": (
                None
                if has_token
                else "Set LICHESS_TOKEN for full opening explorer stats."
            ),
        }

    moves = []
    for m in data.get("moves") or []:
        moves.append(
            {
                "uci": m.get("uci"),
                "san": m.get("san"),
                "white": m.get("white", 0),
                "draws": m.get("draws", 0),
                "black": m.get("black", 0),
                "averageRating": m.get("averageRating"),
            }
        )

    top_games = []
    for game in data.get("topGames") or []:
        top_games.append(
            {
                "id": game.get("id"),
                "uci": game.get("uci"),
                "winner": game.get("winner"),
                "year": game.get("year"),
                "white": game.get("white"),
                "black": game.get("black"),
            }
        )

    return {
        "fen": fen,
        "source": source,
        "fallback": False,
        "white": data.get("white", 0),
        "draws": data.get("draws", 0),
        "black": data.get("black", 0),
        "moves": moves[:12],
        "topGames": top_games,
        "opening": data.get("opening"),
        "ratings": ratings,
    }


def masters_game_pgn(game_id: str) -> dict:
    data = get_masters_pgn(game_id)
    if not data or not data.get("pgn"):
        raise HTTPException(status_code=404, detail="Masters game not found")
    return {"id": game_id, "pgn": data["pgn"]}
