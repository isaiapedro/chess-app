from datetime import date
from typing import Literal, Optional

from fastapi import Query
from pydantic import BaseModel, Field


Platform = Literal["chesscom", "lichess"]
Timeframe = Literal["1 month", "6 months", "1 year"]
ColorFilter = Literal["white", "black"]
ResultFilter = Literal["Win", "Loss", "Draw"]


class GameFilters(BaseModel):
    platform: Platform = "chesscom"
    timeframe: Timeframe = "1 month"
    speed: Optional[str] = None
    color: Optional[ColorFilter] = None
    result: Optional[ResultFilter] = None
    eco: Optional[list[str]] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None


def parse_eco_param(eco: Optional[list[str]]) -> Optional[list[str]]:
    if not eco:
        return None
    codes: list[str] = []
    for item in eco:
        for part in item.split(","):
            code = part.strip().upper()
            if code:
                codes.append(code)
    return codes or None


def games_query_filters(
    platform: Platform = Query("chesscom"),
    timeframe: Timeframe = Query("1 month"),
    speed: Optional[str] = Query(None),
    color: Optional[ColorFilter] = Query(None),
    result: Optional[ResultFilter] = Query(None),
    eco: Optional[list[str]] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
) -> GameFilters:
    return GameFilters(
        platform=platform,
        timeframe=timeframe,
        speed=speed,
        color=color,
        result=result,
        eco=parse_eco_param(eco),
        date_from=date_from,
        date_to=date_to,
    )


class HealthResponse(BaseModel):
    status: str = "ok"


class GamesResponse(BaseModel):
    username: str
    platform: str
    timeframe: str
    count: int
    games: list[dict] = Field(default_factory=list)
