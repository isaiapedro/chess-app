from fastapi import APIRouter

from api.services.async_work import run_cheap
from api.services.baselines import baselines_response

router = APIRouter(prefix="/baselines", tags=["baselines"])


@router.get("")
async def get_baselines():
    return await run_cheap(baselines_response)
