from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from api.services.async_work import run_study
from api.services.coach_comment import generate_game_comments
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
    narrative: Optional[str] = None
    tacticalKind: Optional[str] = None
    tacticalHead: Optional[str] = None


class CoachNugget(BaseModel):
    cardId: str
    label: str
    text: str
    book: Optional[str] = None
    game: Optional[str] = None
    source: Optional[str] = None
    quality: Optional[str] = None
    score: Optional[float] = None


class CoachCommentMoment(BaseModel):
    ply: Optional[int] = None
    playedMove: Optional[str] = None
    bestMove: Optional[str] = None
    mark: Optional[str] = None
    dropCp: int = 0
    tacticalHead: Optional[str] = None
    tacticalKind: Optional[str] = None
    selfInflicted: Optional[bool] = None
    whyBetter: Optional[str] = None
    playedLine: Optional[str] = None
    engineLine: Optional[str] = None
    playedImpact: Optional[str] = None
    technicalRule: Optional[str] = None
    structuralKind: Optional[str] = None
    praiseMark: Optional[str] = None
    piece: Optional[str] = None
    square: Optional[str] = None
    keyId: Optional[str] = None


class CoachCommentsRequest(BaseModel):
    moments: list[CoachCommentMoment] = Field(default_factory=list)


class CoachCommentItem(BaseModel):
    ply: Optional[int] = None
    text: str


class CoachCommentsResponse(BaseModel):
    comments: list[CoachCommentItem] = Field(default_factory=list)


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
        narrative=body.narrative,
        tactical_kind=body.tacticalKind,
        tactical_head=body.tacticalHead,
    )
    nuggets = [CoachNugget(**item) for item in raw]
    return CoachRetrieveResponse(nuggets=nuggets)


@router.post("/comments", response_model=CoachCommentsResponse)
async def coach_comments(body: CoachCommentsRequest):
    raw = await run_study(
        generate_game_comments,
        moments=[m.model_dump() for m in body.moments],
    )
    comments = [CoachCommentItem(**item) for item in raw]
    return CoachCommentsResponse(comments=comments)
