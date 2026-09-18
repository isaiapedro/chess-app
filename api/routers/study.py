from typing import Literal, Optional

from fastapi import APIRouter, Query

from api.services.async_work import run_study
from api.services.study import (
    START_FEN,
    explorer_position,
    masters_game_pgn,
)

router = APIRouter(prefix="/study", tags=["study"])


@router.get("/explorer")
async def study_explorer(
    fen: str = Query(START_FEN),
    source: Literal["lichess", "masters", "player"] = Query("lichess"),
    username: Optional[str] = Query(None),
    color: Optional[Literal["white", "black"]] = Query(None),
    ratings: Optional[str] = Query(None),
):
    return await run_study(
        explorer_position,
        fen,
        source=source,
        username=username,
        color=color,
        ratings=ratings,
    )


@router.get("/masters-pgn/{game_id}")
async def study_masters_pgn(game_id: str):
    return await run_study(masters_game_pgn, game_id)
