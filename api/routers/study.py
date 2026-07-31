from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from api.schemas import GameFilters, games_query_filters
from api.services.data import load_and_filter
from api.services.study import (
    START_FEN,
    eval_position,
    explorer_position,
    find_critical_mistakes,
    masters_game_pgn,
    validate_quiz_move,
)

router = APIRouter(prefix="/study", tags=["study"])


class QuizValidateBody(BaseModel):
    fen: str
    user_uci: str
    best_uci: str


@router.get("/eval")
def study_eval(
    fen: str = Query(START_FEN),
    multi_pv: int = Query(3, ge=1, le=5),
):
    return eval_position(fen, multi_pv=multi_pv)


@router.get("/explorer")
def study_explorer(
    fen: str = Query(START_FEN),
    source: Literal["lichess", "masters", "player"] = Query("lichess"),
    username: Optional[str] = Query(None),
    color: Optional[Literal["white", "black"]] = Query(None),
    ratings: Optional[str] = Query(None),
):
    return explorer_position(
        fen, source=source, username=username, color=color, ratings=ratings
    )


@router.get("/masters-pgn/{game_id}")
def study_masters_pgn(game_id: str):
    return masters_game_pgn(game_id)


@router.get("/mistakes")
def study_mistakes(
    username: str,
    filters: Annotated[GameFilters, Depends(games_query_filters)],
    limit: int = Query(5, ge=1, le=10),
    max_games: int = Query(3, ge=1, le=6),
):
    loaded = load_and_filter(username, filters)
    mistakes = find_critical_mistakes(
        loaded.filtered_df, limit=limit, max_games=max_games
    )
    return {
        "meta": {
            "username": username,
            "platform": filters.platform,
            "timeframe": filters.timeframe,
            "games_scanned": len(loaded.filtered_df),
            "count": len(mistakes),
        },
        "mistakes": mistakes,
    }


@router.post("/quiz/validate")
def study_quiz_validate(body: QuizValidateBody):
    return validate_quiz_move(body.fen, body.user_uci, body.best_uci)
