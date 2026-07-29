from typing import Annotated

from fastapi import APIRouter, Depends

from api.schemas import GameFilters, games_query_filters
from api.services.data import insights_payload, load_and_filter, recap_payload

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/recap")
def get_recap(
    username: str,
    filters: Annotated[GameFilters, Depends(games_query_filters)],
):
    loaded = load_and_filter(username, filters)
    return recap_payload(loaded)


@router.get("/insights")
def get_insights(
    username: str,
    filters: Annotated[GameFilters, Depends(games_query_filters)],
):
    loaded = load_and_filter(username, filters)
    return insights_payload(loaded)
