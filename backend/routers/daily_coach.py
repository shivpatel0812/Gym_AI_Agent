from fastapi import APIRouter, Depends
from auth import get_user_id
from db import db
from daily_coach import get_brief
import user_time

router = APIRouter(prefix="/api/daily-coach", tags=["daily-coach"])


@router.get("")
def daily_brief(refresh: bool = False, user_id: str = Depends(get_user_id)):
    # Sync database/model clients run in FastAPI's pool, never its event loop.
    return get_brief(db, user_id, user_time.now(db, user_id), refresh)
