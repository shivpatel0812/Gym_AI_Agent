"""
Training Plan Router - goal-based Active Plans created from coach conversations.

Flow: discuss a goal with the coach -> POST /propose (draft) -> user reviews ->
POST /{id}/activate. Adjustments follow the same propose/confirm path, so
ordinary conversation never silently changes training behaviour.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel
import os

from auth import get_user_id
from db import db
from ai_analysis.plan_builder import PlanBuilder, PLAN_MODES, DEFAULT_PLAN_MODE
from ai_analysis.plan_store import PlanStore, STATUS_ACTIVE, STATUS_PAUSED, STATUS_COMPLETED
from ai_analysis.conversation_store import ConversationStore
from ai_analysis.profile_transformer import get_user_profile_for_ai
from ai_analysis.data_analyzer import FitnessDataAnalyzer
from ai_analysis.workout_recommender.plan_context import PlanContextResolver
from ai_analysis.workout_recommender import WorkoutRecommender
from ai_analysis.plan_projection import (
    DEFAULT_PROJECTION_WEEKS,
    MAX_PROJECTION_WEEKS,
    PlanProjector,
    measure_adherence,
)
from nutrition.plan_store import NutritionPlanStore
from nutrition.pacing import build_paced_trajectory

router = APIRouter(prefix="/api/training-plan", tags=["training-plan"])

HISTORY_WINDOW_DAYS = 28


class ProposePlanRequest(BaseModel):
    conversation_id: Optional[str] = None
    split_id: Optional[str] = None
    plan_mode: Optional[str] = DEFAULT_PLAN_MODE
    goal_statement: Optional[str] = None


class AdjustPlanRequest(BaseModel):
    conversation_id: Optional[str] = None
    adjustment: str
    plan_mode: Optional[str] = None


class UpdatePlanRequest(BaseModel):
    """Direct user edits to a draft or active plan."""
    plan_name: Optional[str] = None
    primary_goal: Optional[str] = None
    strategy: Optional[List[str]] = None
    guidelines: Optional[List[str]] = None
    duration_weeks: Optional[int] = None
    weekly_schedule: Optional[dict] = None
    days: Optional[List[dict]] = None


def _recommender(user_id: str) -> WorkoutRecommender:
    """The recommender, for its history reader and its progression engine."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    return WorkoutRecommender(db, user_id, api_key)


def _builder() -> PlanBuilder:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    return PlanBuilder(api_key=api_key)


def _load_current_split(user_id: str, split_id: Optional[str]) -> dict:
    """
    The user's baseline routine.

    Reuses the existing split-context loader, which reconstructs exercises
    from logged sessions for user-created splits.
    """
    from routers.workout_plan import _load_split_context

    if split_id:
        return _load_split_context(user_id, split_id)

    splits = list(db.collection("users").document(user_id).collection("splits").stream())
    if not splits:
        return {"split_id": None, "split_name": None, "days": []}

    # Newest first, but a split whose exercises we can't reconstruct is useless
    # for planning — user-created splits store only day names, so a split with
    # no matching logged sessions comes back empty. Prefer the newest split we
    # can actually read, and fall back to the newest overall.
    ordered = sorted(
        ({"id": s.id, **(s.to_dict() or {})} for s in splits),
        key=lambda s: s.get("created_at") or "",
        reverse=True,
    )

    fallback = None
    for split in ordered:
        try:
            context = _load_split_context(user_id, split["id"])
        except HTTPException:
            continue
        if fallback is None:
            fallback = context
        if any(day.get("exercises") for day in context.get("days", [])):
            return context

    return fallback or {"split_id": None, "split_name": None, "days": []}


def _history_summary(user_id: str) -> dict:
    analyzer = FitnessDataAnalyzer(db, user_id)
    summary = analyzer.build_rolling_summary(window_days=HISTORY_WINDOW_DAYS)
    return {
        "training": summary.get("training"),
        "recovery": summary.get("recovery"),
    }


def _conversation_messages(user_id: str, conversation_id: Optional[str]) -> list:
    if not conversation_id:
        return []
    # Plan interviews run longer than coach Q&A — keep enough turns that the
    # builder still sees the goal, constraints, and follow-ups.
    return ConversationStore(db, user_id).get_history_for_model(conversation_id, limit=40)


def _plan_response(plan: dict) -> dict:
    return {"plan": plan, "progress": PlanStore.progress(plan)}


@router.get("/modes")
async def get_plan_modes():
    """How closely a plan may follow the user's Current Split."""
    return {
        "modes": [
            {"id": "follow_split", "label": "Follow My Split",
             "description": "Keep my workouts and exercises. Adjust order, goals, rep ranges and intensity only."},
            {"id": "adapt_split", "label": "Adapt My Split",
             "description": "Use my split as the foundation, but add, swap or reorganise where it helps the goal."},
            {"id": "build_for_me", "label": "Build For Me",
             "description": "Design the best program for my goal, using my history, equipment and schedule."},
        ],
        "default": DEFAULT_PLAN_MODE,
    }


@router.post("/propose")
async def propose_plan(request: ProposePlanRequest, user_id: str = Depends(get_user_id)):
    """
    Generate a plan proposal from a coach conversation. Saved as a draft —
    it does not affect recommendations until activated.
    """
    plan_mode = request.plan_mode if request.plan_mode in PLAN_MODES else DEFAULT_PLAN_MODE

    conversation = _conversation_messages(user_id, request.conversation_id)
    if request.goal_statement:
        conversation = conversation + [{"role": "user", "content": request.goal_statement}]
    if not conversation:
        raise HTTPException(
            status_code=400,
            detail="Discuss a goal with the coach first, or provide a goal_statement.",
        )

    split_context = _load_current_split(user_id, request.split_id)
    result = _builder().build_plan(
        conversation=conversation,
        split_context=split_context,
        profile=get_user_profile_for_ai(db, user_id),
        history_summary=_history_summary(user_id),
        plan_mode=plan_mode,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=f"Plan generation failed: {result['error']}")

    plan = result["plan"]
    plan["source_split_id"] = split_context.get("split_id")
    # The Active Plan references the Current Split; it never overwrites it
    plan["owns_linked_split"] = False

    store = PlanStore(db, user_id)
    plan_id = store.save_draft(plan, source_conversation_id=request.conversation_id)
    saved = store.get(plan_id)
    return {"status": "success", **_plan_response(saved), "tokens_used": result.get("tokens_used")}


@router.post("/{plan_id}/activate")
async def activate_plan(plan_id: str, user_id: str = Depends(get_user_id)):
    """Confirm a draft. Any previously active plan is completed, not deleted."""
    plan = PlanStore(db, user_id).activate(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"status": "success", **_plan_response(plan)}


@router.post("/adjust")
async def adjust_plan(request: AdjustPlanRequest, user_id: str = Depends(get_user_id)):
    """
    Propose a revision of the active plan. Returns a new draft version —
    the active plan is untouched until the user activates the revision.
    """
    store = PlanStore(db, user_id)
    active = store.get_active()
    if not active:
        raise HTTPException(status_code=404, detail="No active plan to adjust")

    result = _builder().build_plan(
        conversation=_conversation_messages(user_id, request.conversation_id),
        split_context=_load_current_split(user_id, active.get("source_split_id")),
        profile=get_user_profile_for_ai(db, user_id),
        history_summary=_history_summary(user_id),
        plan_mode=request.plan_mode or active.get("plan_mode") or DEFAULT_PLAN_MODE,
        existing_plan={k: active.get(k) for k in
                       ("plan_name", "primary_goal", "strategy", "guidelines",
                        "weekly_schedule", "days", "duration_weeks")},
        adjustment_request=request.adjustment,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=f"Plan adjustment failed: {result['error']}")

    plan = result["plan"]
    plan["source_split_id"] = active.get("source_split_id")
    plan["owns_linked_split"] = False

    draft_id = store.replace_active(
        plan, previous_plan_id=active["id"], source_conversation_id=request.conversation_id
    )
    return {"status": "success", **_plan_response(store.get(draft_id))}


@router.get("/active")
async def get_active_plan(user_id: str = Depends(get_user_id)):
    """The plan currently driving recommendations, with week progress."""
    plan = PlanStore(db, user_id).get_active()
    if not plan:
        return {"status": "no_plan", "plan": None}
    return {"status": "success", **_plan_response(plan)}


@router.get("/today")
async def get_todays_planned_workout(user_id: str = Depends(get_user_id)):
    """
    Today's workout from the Active Plan, with intent already resolved.

    This is the single source of truth for starting a workout: exercises come
    back in plan order, each carrying the goal/priority/rep-range the
    recommender will apply. The client does not re-derive any of it.

    Falls back to the legacy structural endpoint's behaviour when there is no
    goal plan, so users without one are unaffected.
    """
    store = PlanStore(db, user_id)
    plan = store.get_active()
    if not plan:
        return {"status": "no_plan"}

    today = datetime.now()
    weekday = today.strftime("%A").lower()
    schedule = plan.get("weekly_schedule") or {}
    assignment = schedule.get(weekday)

    if not assignment or str(assignment).lower() == "rest":
        days_order = ["monday", "tuesday", "wednesday", "thursday",
                      "friday", "saturday", "sunday"]
        idx = days_order.index(weekday)
        for offset in range(1, 8):
            candidate = days_order[(idx + offset) % 7]
            value = schedule.get(candidate, "Rest")
            if value and str(value).lower() != "rest":
                return {
                    "status": "rest_day",
                    "plan_id": plan.get("id"),
                    "plan_name": plan.get("plan_name"),
                    "next_workout_day": candidate.capitalize(),
                    "next_workout_name": value,
                }
        return {"status": "rest_day", "plan_id": plan.get("id"),
                "plan_name": plan.get("plan_name")}

    day = next(
        (d for d in plan.get("days") or [] if d.get("day_name") == assignment), None
    )
    if not day:
        return {"status": "no_plan"}

    # Already logged a session against this plan day today?
    today_str = today.strftime("%Y-%m-%d")
    already_logged = any(
        (s.to_dict() or {}).get("split_day") == assignment
        for s in db.collection("users").document(user_id)
        .collection("workout_sessions").where("date", "==", today_str).stream()
    )

    profile_goal = (get_user_profile_for_ai(db, user_id) or {}).get("goal")
    resolver = PlanContextResolver(db, user_id)

    exercises = []
    for entry in sorted(
        day.get("exercises") or [], key=lambda e: e.get("order") or 0
    ):
        context = resolver.resolve(
            exercise_id=entry.get("exercise_id", ""),
            exercise_name=entry.get("exercise_name", ""),
            split_day=assignment,
            profile_goal=profile_goal,
        )
        exercises.append({
            "exercise_id": entry.get("exercise_id"),
            "exercise_name": entry.get("exercise_name"),
            "sets": entry.get("sets"),
            "reps": entry.get("reps"),
            "order": entry.get("order"),
            "notes": entry.get("notes"),
            # Resolved intent — the client displays this, never recomputes it
            "plan_context": context.to_dict(),
        })

    return {
        "status": "workout_day",
        "plan_id": plan.get("id"),
        "plan_name": plan.get("plan_name"),
        "plan_type": plan.get("plan_type"),
        "split_id": plan.get("source_split_id") or plan.get("linked_split_id"),
        "day_name": day.get("day_name"),
        "focus": day.get("focus"),
        "day_goal": day.get("day_goal"),
        "day_type": day.get("day_type"),
        "estimated_duration_minutes": day.get("estimated_duration_minutes"),
        "already_logged": already_logged,
        "exercises": exercises,
    }


@router.get("/projection")
async def get_plan_projection(
    weeks: Optional[int] = Query(None, description="Weeks to project; defaults to the plan's remaining duration"),
    user_id: str = Depends(get_user_id),
):
    """
    Where the active plan leads, week by week.

    Strength comes from running the real ProgressionEngine forward, so the
    numbers are what the app will actually prescribe rather than a fitted
    curve. Nutrition is projected onto the same week axis so a surplus and the
    lifts it is meant to feed can be read against one calendar.
    """
    store = PlanStore(db, user_id)
    plan = store.get_active()
    if not plan:
        return {"status": "no_plan", "projection": None}

    progress = PlanStore.progress(plan)
    remaining = None
    if progress.get("total_weeks") and progress.get("current_week"):
        remaining = max(1, int(progress["total_weeks"]) - int(progress["current_week"]) + 1)

    horizon = weeks or remaining or DEFAULT_PROJECTION_WEEKS
    horizon = max(1, min(MAX_PROJECTION_WEEKS, int(horizon)))

    recommender = _recommender(user_id)
    profile = recommender.data_fetcher.get_user_profile() or {}
    user_goal = profile.get("primary_goal") or "Build Muscle"

    # How often each plan day comes round, so a lift trained twice a week
    # projects twice as fast as one trained once.
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

    adherence = measure_adherence(histories, user_goal)
    projector = PlanProjector(recommender.progression_engine)

    days_out = []
    for day in plan.get("days") or []:
        day_name = day.get("day_name") or "Workout"
        per_week = day_frequency.get(day_name, 1)
        exercises = []
        for exercise in day.get("exercises") or []:
            ex_id = exercise.get("exercise_id")
            if not ex_id:
                continue
            rep_range = exercise.get("target_rep_range")
            projection = projector.project_exercise(
                exercise_id=ex_id,
                exercise_name=exercise.get("exercise_name") or ex_id,
                day_name=day_name,
                history=histories.get(ex_id) or [],
                user_goal=user_goal,
                weeks=horizon,
                sessions_per_week=per_week,
                num_sets=exercise.get("sets") or 3,
                focus_goal=exercise.get("goal"),
                rep_range_override=(
                    tuple(rep_range) if isinstance(rep_range, (list, tuple)) and len(rep_range) == 2
                    else None
                ),
                adherence=adherence.rate,
                top_lifts=profile.get("top_lifts"),
            )
            exercises.append({
                **projection.to_dict(),
                "priority": exercise.get("priority"),
                "goal": exercise.get("goal"),
                "sets": exercise.get("sets"),
                "target_rep_range": rep_range,
                "notes": exercise.get("notes"),
            })
        days_out.append({
            "day_name": day_name,
            "focus": day.get("focus"),
            "day_goal": day.get("day_goal"),
            "day_type": day.get("day_type"),
            "goal": day.get("goal"),
            "sessions_per_week": per_week,
            "exercises": exercises,
        })

    nutrition_plan = NutritionPlanStore(db, user_id).get_active()
    nutrition = None
    if nutrition_plan:
        nutrition = build_paced_trajectory(
            nutrition_plan,
            weeks=horizon,
            profile=profile,
        )
        nutrition["plan_id"] = nutrition_plan.get("id")
        nutrition["plan_name"] = (
            nutrition_plan.get("plan_name")
            or nutrition_plan.get("goal_detail")
            or nutrition_plan.get("goal")
        )

    return {
        "status": "success",
        "projection": {
            "weeks": horizon,
            "plan_id": plan.get("id"),
            "plan_name": plan.get("plan_name"),
            "primary_goal": plan.get("primary_goal"),
            "strategy": plan.get("strategy"),
            "guidelines": plan.get("guidelines"),
            "progress": progress,
            "adherence": adherence.to_dict(),
            "days": days_out,
            "nutrition": nutrition,
        },
    }


@router.get("/history")
async def get_plan_history(
    limit: int = Query(50, ge=1, le=100), user_id: str = Depends(get_user_id)
):
    """Past and present plans. Creating a new plan never deletes an old one."""
    plans = PlanStore(db, user_id).history(limit=limit)
    return {"status": "success", "count": len(plans), "plans": plans}


@router.get("/{plan_id}")
async def get_plan(plan_id: str, user_id: str = Depends(get_user_id)):
    plan = PlanStore(db, user_id).get(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"status": "success", **_plan_response(plan)}


@router.patch("/{plan_id}")
async def update_plan(
    plan_id: str, request: UpdatePlanRequest, user_id: str = Depends(get_user_id)
):
    """Apply the user's own edits to a plan."""
    store = PlanStore(db, user_id)
    plan = store.get(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    updates = {k: v for k, v in request.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Re-validate structural edits so a hand-edited plan can't feed the
    # recommender an unknown goal or a nonsense rep range
    if "days" in updates or "weekly_schedule" in updates:
        merged = {**plan, **updates}
        validated = PlanBuilder.validate_plan(merged)
        updates["days"] = validated["days"]
        updates["weekly_schedule"] = validated["weekly_schedule"]

    updates["updated_at"] = datetime.now().isoformat()
    db.collection("users").document(user_id).collection("workout_plans").document(plan_id).update(updates)
    return {"status": "success", **_plan_response({**plan, **updates})}


@router.post("/{plan_id}/pause")
async def pause_plan(plan_id: str, user_id: str = Depends(get_user_id)):
    """Pause a plan. Recommendations fall back to the profile goal."""
    plan = PlanStore(db, user_id).set_status(plan_id, STATUS_PAUSED)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"status": "success", **_plan_response(plan)}


@router.post("/{plan_id}/resume")
async def resume_plan(plan_id: str, user_id: str = Depends(get_user_id)):
    plan = PlanStore(db, user_id).activate(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"status": "success", **_plan_response(plan)}


@router.post("/{plan_id}/end")
async def end_plan(plan_id: str, user_id: str = Depends(get_user_id)):
    """End a plan. It stays in history."""
    plan = PlanStore(db, user_id).set_status(plan_id, STATUS_COMPLETED)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"status": "success", **_plan_response(plan)}


@router.delete("/{plan_id}")
async def delete_plan(plan_id: str, user_id: str = Depends(get_user_id)):
    """Delete a plan outright. Prefer /end, which preserves history."""
    if not PlanStore(db, user_id).delete(plan_id):
        raise HTTPException(status_code=404, detail="Plan not found")
    return {"status": "success"}


@router.get("/context/{exercise_id}")
async def get_exercise_plan_context(
    exercise_id: str,
    exercise_name: str = Query("", description="Helps match custom exercises"),
    split_day: Optional[str] = Query(None),
    user_id: str = Depends(get_user_id),
):
    """
    What intent the recommender will apply to this exercise, and why.

    Exposes the resolver directly so the UI can explain a recommendation
    without re-deriving the rules.
    """
    profile = get_user_profile_for_ai(db, user_id)
    resolver = PlanContextResolver(db, user_id)
    context = resolver.resolve(
        exercise_id=exercise_id,
        exercise_name=exercise_name,
        split_day=split_day,
        profile_goal=(profile or {}).get("goal"),
    )
    return {"status": "success", "context": context.to_dict()}
