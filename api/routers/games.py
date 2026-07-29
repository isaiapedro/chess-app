from typing import Annotated

from fastapi import APIRouter, Depends, Query

from api.schemas import GameFilters, games_query_filters
from api.services.data import games_payload, load_and_filter

router = APIRouter(tags=["games"])


@router.get("/games/{username}")
def get_games(
    username: str,
    filters: Annotated[GameFilters, Depends(games_query_filters)],
    include_pgn: bool = Query(False),
):
    loaded = load_and_filter(username, filters)
    return games_payload(loaded, include_pgn=include_pgn)
