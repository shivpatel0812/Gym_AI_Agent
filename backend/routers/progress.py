"""
Progress hub API.

A read surface over data every other feature already writes. Nothing here
computes on write or mutates anything, so it is safe to call on every open of
the tab.
"""

import os
from datetime import datetime, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from auth import get_user_id
from db import db
from progress import DEFAULT_WEEKS, MAX_WEEKS, ProgressHubBuilder
from progress.goals import GoalStore, evaluate
from progress.photo_hub import build_photo_hub
from progress.projection import (
    DEFAULT_FORWARD_WEEKS,
    MAX_FORWARD_WEEKS,
    build_forward_series,
)

router = APIRouter(prefix="/api/progress", tags=["progress"])


@router.get("/hub")
async def get_progress_hub(
    user_id: str = Depends(get_user_id),
    weeks: int = Query(DEFAULT_WEEKS, ge=4, le=MAX_WEEKS),
):
    """
    The weekly index, its four domains, lift positions, and the timeline.

    A user with no history is not an error: the index comes back `null` with
    state "unknown" and a count of how many more weeks it needs. Printing a
    confident number off four data points is how this feature would lose its
    credibility on day one.
    """
    hub = ProgressHubBuilder(db, user_id).build(weeks=weeks)
    # Attached here rather than fetched separately: evaluating goals needs a
    # built hub, so a second endpoint would rebuild the whole thing — five more
    # Firestore range queries to answer a question this payload already holds.
    hub["goals"] = [evaluate(goal, hub) for goal in GoalStore(db, user_id).list()]
    return hub


@router.get("/summary")
async def get_progress_summary(
    user_id: str = Depends(get_user_id),
    weeks: int = Query(8, ge=4, le=MAX_WEEKS),
):
    """
    Just enough for the Home top bar: level, state, and a sparkline.

    Home already fans out ten parallel requests on cold start, so this trims
    the payload rather than making it fetch the full hub to render one bar.
    """
    full = ProgressHubBuilder(db, user_id).build(weeks=weeks)
    return {
        "formula_version": full["formula_version"],
        "index": full["index"],
        "spark": [
            {"week_start": p["week_start"], "level": p["level"]}
            for p in full["series"]
        ],
        "coverage": full["coverage"],
    }


@router.get("/projection")
async def get_progress_projection(
    user_id: str = Depends(get_user_id),
    weeks: int = Query(DEFAULT_FORWARD_WEEKS, ge=2, le=MAX_FORWARD_WEEKS),
):
    """
    Where the index goes next, on the hub's own week axis.

    Split from `/hub` on purpose: this runs the real ProgressionEngine forward
    once per planned lift, which is far too expensive to pay for on every open
    of the tab. The client renders the hub first and lays this over it.

    Every failure mode returns `available: False` with a reason rather than an
    error — no active plan, no lift history and no API key are all ordinary
    states for a forward projection to be unavailable in.
    """
    from ai_analysis.plan_projection import PlanProjector, measure_adherence
    from ai_analysis.plan_store import PlanStore
    from ai_analysis.workout_recommender import WorkoutRecommender

    plan = PlanStore(db, user_id).get_active()
    if not plan:
        return {"available": False, "reason": "No active workout plan to project."}

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return {"available": False, "reason": "Projection is unavailable right now."}

    hub = ProgressHubBuilder(db, user_id)
    current = hub.current_levels()
    last_week = current["last_week"]
    if not last_week:
        return {"available": False, "reason": "Not enough history to project forward yet."}

    recommender = WorkoutRecommender(db, user_id, api_key)
    profile = recommender.data_fetcher.get_user_profile() or {}
    user_goal = profile.get("primary_goal") or "Build Muscle"

    # A day scheduled twice a week is two exposures, not one — the roadmap
    # learned this the hard way and the same correction applies here.
    day_frequency: dict = {}
    for day_name in (plan.get("weekly_schedule") or {}).values():
        if day_name and str(day_name).strip().lower() != "rest":
            day_frequency[day_name] = day_frequency.get(day_name, 0) + 1

    histories: dict = {}
    for day in plan.get("days") or []:
        for exercise in day.get("exercises") or []:
            ex_id = exercise.get("exercise_id")
            if ex_id and ex_id not in histories:
                histories[ex_id] = recommender._get_exercise_history(ex_id, days=60)

    # Measured once, not per lift: it is a property of the user's recent
    # training, not of the exercise being projected.
    adherence = measure_adherence(histories, user_goal)
    projector = PlanProjector(recommender.progression_engine)
    projections = []
    for day in plan.get("days") or []:
        day_name = day.get("day_name") or "Workout"
        for exercise in day.get("exercises") or []:
            ex_id = exercise.get("exercise_id")
            if not ex_id:
                continue
            rep_range = exercise.get("target_rep_range")
            projections.append(
                projector.project_exercise(
                    exercise_id=ex_id,
                    exercise_name=exercise.get("exercise_name") or ex_id,
                    day_name=day_name,
                    history=histories.get(ex_id) or [],
                    user_goal=user_goal,
                    weeks=weeks,
                    sessions_per_week=max(1, day_frequency.get(day_name, 1)),
                    num_sets=exercise.get("sets") or 3,
                    focus_goal=exercise.get("goal") or day.get("goal"),
                    day_intensity=exercise.get("intensity") or day.get("day_type"),
                    rep_range_override=(
                        tuple(rep_range)
                        if isinstance(rep_range, (list, tuple)) and len(rep_range) == 2
                        else None
                    ),
                    adherence=adherence.rate,
                ).to_dict()
            )

    start = datetime.strptime(last_week, "%Y-%m-%d")
    forward_weeks = [
        (start + timedelta(weeks=i + 1)).strftime("%Y-%m-%d") for i in range(weeks)
    ]
    result = build_forward_series(
        projections, current["levels"], current["goal_direction"], forward_weeks
    )
    result["adherence"] = adherence.to_dict()
    return result


# ---------------------------------------------------------------------------
# Meal photo archive
# ---------------------------------------------------------------------------

@router.get("/photos")
async def get_photo_hub(
    user_id: str = Depends(get_user_id),
    weeks: int = Query(DEFAULT_WEEKS, ge=4, le=MAX_WEEKS),
    limit: int = Query(60, ge=1, le=200),
):
    """
    Every meal photo the app has kept, with what was actually logged for it.

    Images are **not** in this payload. They are base64 JPEGs inside the
    documents, so returning sixty of them would be a multi-megabyte response to
    draw a grid of thumbnails; the client asks for each one it displays.
    """
    from progress.weeks import week_axis
    from datetime import datetime as _dt

    axis = week_axis(_dt.now().date(), max(4, min(MAX_WEEKS, weeks)))
    try:
        docs = (
            db.collection("users").document(user_id)
            .collection("food_photo_logs").limit(300).stream()
        )
        logs = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
    except Exception as exc:
        print(f"photo hub read failed: {exc}")
        logs = []
    return build_photo_hub(logs, axis, limit=limit)


@router.get("/photos/{log_id}/image")
async def get_photo_image(log_id: str, user_id: str = Depends(get_user_id)):
    """One archived meal photo as a data URL. 404 when the log kept no image."""
    from nutrition.photo_log_store import load_archived_image

    data_url = load_archived_image(db, user_id, log_id)
    if not data_url:
        raise HTTPException(status_code=404, detail="No archived image for this log")
    return {"id": log_id, "data_url": data_url}


# ---------------------------------------------------------------------------
# Goals
# ---------------------------------------------------------------------------

@router.get("/goals")
async def list_goals(
    user_id: str = Depends(get_user_id),
    include_done: bool = Query(False),
):
    """Goals scored against the same numbers the hub renders."""
    hub = ProgressHubBuilder(db, user_id).build()
    goals = GoalStore(db, user_id).list(include_done=include_done)
    return {"goals": [evaluate(goal, hub) for goal in goals]}


@router.post("/goals")
async def create_goal(
    payload: dict = Body(...),
    user_id: str = Depends(get_user_id),
):
    """
    Create a goal, stamping the value it starts from.

    The start value is captured now and never recomputed — deriving it later
    from a sliding history window would let "40% there" change without the
    user doing anything.
    """
    hub = ProgressHubBuilder(db, user_id).build()
    try:
        goal = GoalStore(db, user_id).create(payload or {}, hub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return evaluate(goal, hub)


@router.patch("/goals/{goal_id}")
async def update_goal_status(
    goal_id: str,
    payload: dict = Body(...),
    user_id: str = Depends(get_user_id),
):
    """Accept a coach-proposed goal, or mark one abandoned/achieved."""
    try:
        ok = GoalStore(db, user_id).set_status(goal_id, str((payload or {}).get("status")))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not ok:
        raise HTTPException(status_code=404, detail="Goal not found")
    return {"status": "success"}


@router.delete("/goals/{goal_id}")
async def delete_goal(goal_id: str, user_id: str = Depends(get_user_id)):
    if not GoalStore(db, user_id).delete(goal_id):
        raise HTTPException(status_code=404, detail="Goal not found")
    return {"status": "success"}
