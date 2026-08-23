"""
The shared read model, exposed.

Every AI surface reads the same document rather than each deriving its own
view of the user: Home renders `next_levers`, the coach takes them as stance,
the plan builder emphasises the top one, and the recommender consumes
`readiness`. One computation, four presentations.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_user_id
from db import db
from state import DailyRollupBuilder, UserStateBuilder

router = APIRouter(prefix="/api/user-state", tags=["user-state"])


@router.get("")
async def get_user_state(
    user_id: str = Depends(get_user_id),
    refresh: bool = Query(False, description="Recompute instead of reading the cache"),
    window_days: int = Query(14, ge=7, le=90),
):
    """
    Readiness and ranked levers.

    `readiness_source` is "unavailable" when nothing usable was logged — that
    is a normal state, not an error, and callers should treat readiness as
    neutral and show no levers rather than inventing either.
    """
    builder = UserStateBuilder(db, user_id)
    if not refresh:
        cached = builder.read()
        if cached:
            return cached
    return builder.write(window_days=window_days)


@router.post("/refresh")
async def refresh_user_state(
    user_id: str = Depends(get_user_id),
    window_days: int = Query(14, ge=7, le=90),
):
    """Recompute and persist. Called after a day's logging is complete."""
    return UserStateBuilder(db, user_id).write(window_days=window_days)


@router.get("/daily/{date}")
async def get_daily_state(date: str, user_id: str = Depends(get_user_id)):
    """
    One day's rollup: every metric as {value, target, deviation, confidence}.

    Built on demand when it has not been persisted — the rollup is derived and
    disposable, so a cache miss is never an error.
    """
    if len(date) != 10 or date.count("-") != 2:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    builder = DailyRollupBuilder(db, user_id)
    return builder.read_day(date) or builder.build_day(date)


@router.post("/rollup")
async def rebuild_rollups(
    user_id: str = Depends(get_user_id),
    days: int = Query(28, ge=1, le=180),
):
    """Rebuild and persist the last N days of daily_state."""
    from datetime import datetime, timedelta

    end = datetime.now()
    start = end - timedelta(days=days - 1)
    written = DailyRollupBuilder(db, user_id).write_range(
        start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
    )
    return {"days_written": written}
