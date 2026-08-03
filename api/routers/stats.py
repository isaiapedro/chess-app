from typing import Annotated

from fastapi import APIRouter, Depends

from api.schemas import GameFilters, games_query_filters
from api.services.async_work import run_cpu, run_load
from api.services.data import insights_payload, load_and_filter, recap_payload

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/recap")
async def get_recap(
    username: str,
    filters: Annotated[GameFilters, Depends(games_query_filters)],
):
    loaded = await run_load(load_and_filter, username, filters)
    return await run_cpu(recap_payload, loaded)


@router.get("/insights")
async def get_insights(
    username: str,
    filters: Annotated[GameFilters, Depends(games_query_filters)],
):
    loaded = await run_load(load_and_filter, username, filters)
    return await run_cpu(insights_payload, loaded)
