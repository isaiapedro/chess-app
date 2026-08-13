from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from api.services.async_work import run_study
from api.services.coach_rag import retrieve_coach_nuggets

router = APIRouter(prefix="/coach", tags=["coach"])


class CoachRetrieveRequest(BaseModel):
    fen: str
    themes: list[str] = Field(default_factory=list)
    phase: Optional[Literal["opening", "middlegame", "endgame"]] = None
    san: Optional[str] = None
    bestSan: Optional[str] = None
    eco: Optional[str] = None
    opening: Optional[str] = None
    wantCount: int = 2


class CoachNugget(BaseModel):
    cardId: str
    label: str
    text: str
    book: Optional[str] = None
    game: Optional[str] = None
    source: Optional[str] = None
    quality: Optional[str] = None
    score: Optional[float] = None


class CoachRetrieveResponse(BaseModel):
    nuggets: list[CoachNugget] = Field(default_factory=list)


@router.post("/retrieve", response_model=CoachRetrieveResponse)
async def coach_retrieve(body: CoachRetrieveRequest):
    raw = await run_study(
        retrieve_coach_nuggets,
        fen=body.fen,
        themes=body.themes,
        phase=body.phase,
        san=body.san,
        best_san=body.bestSan,
        eco=body.eco,
        opening=body.opening,
        want_count=body.wantCount,
    )
    nuggets = [CoachNugget(**item) for item in raw]
    return CoachRetrieveResponse(nuggets=nuggets)
