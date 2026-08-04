from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.services.async_work import run_cheap
from api.services.users import list_users, upsert_user

router = APIRouter(prefix="/users", tags=["users"])

Platform = Literal["chesscom", "lichess"]


class UserRegisterRequest(BaseModel):
    platform: Platform
    username: str = Field(min_length=1, max_length=64)
    email: str = Field(min_length=3, max_length=254)


class UserRecord(BaseModel):
    platform: Platform
    username: str
    email: str
    created_at: str | None = None
    updated_at: str | None = None


@router.post("/register", response_model=UserRecord)
async def register_user(body: UserRegisterRequest):
    try:
        row = await run_cheap(
            upsert_user,
            platform=body.platform,
            username=body.username,
            email=body.email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return UserRecord(**row)


@router.get("", response_model=list[UserRecord])
async def get_users():
    rows = await run_cheap(list_users)
    return [UserRecord(**row) for row in rows]
