from fastapi import APIRouter

from api.services.baselines import baselines_response

router = APIRouter(prefix="/baselines", tags=["baselines"])


@router.get("")
def get_baselines():
    return baselines_response()
