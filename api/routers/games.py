from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query

from api.schemas import GameFilters, games_query_filters
from api.services.async_work import run_cpu, run_load
from api.services.data import (
    DEFAULT_GAMES_PAGE_LIMIT,
    MAX_GAMES_PAGE_LIMIT,
    games_payload,
    load_and_filter,
    session_payload,
)

router = APIRouter(tags=["games"])


@router.get("/games/{username}")
async def get_games(
    username: str,
    filters: Annotated[GameFilters, Depends(games_query_filters)],
    include_pgn: bool = Query(False),
    limit: Optional[int] = Query(
        DEFAULT_GAMES_PAGE_LIMIT, ge=1, le=MAX_GAMES_PAGE_LIMIT
    ),
    offset: int = Query(0, ge=0),
):
    loaded = await run_load(load_and_filter, username, filters)
    return await run_cpu(
        games_payload, loaded, include_pgn, limit, offset
    )


@router.get("/session/{username}")
async def get_session(
    username: str,
    filters: Annotated[GameFilters, Depends(games_query_filters)],
    include_pgn: bool = Query(False),
    limit: Optional[int] = Query(
        DEFAULT_GAMES_PAGE_LIMIT, ge=1, le=MAX_GAMES_PAGE_LIMIT
    ),
    offset: int = Query(0, ge=0),
):
    loaded = await run_load(load_and_filter, username, filters)
    return await run_cpu(
        session_payload, loaded, include_pgn, limit, offset
    )
