"""
Training Plan Router - goal-based Active Plans created from coach conversations.

Flow: discuss a goal with the coach -> POST /propose (draft) -> user reviews ->
POST /{id}/activate. Adjustments follow the same propose/confirm path, so
ordinary conversation never silently changes training behaviour.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List
from datetime import datetime, timedelta
import re
from pydantic import BaseModel
import os

from auth import get_user_id
from db import db
from ai_analysis.plan_builder import PlanBuilder, PLAN_MODES, DEFAULT_PLAN_MODE
from ai_analysis.plan_diff import diff_plans
from ai_analysis.plan_scope import resolve_plan_mode
from ai_analysis.plan_edits import (
    apply_edits, normalize_edits,
    EDIT_STATUS_PENDING, EDIT_STATUS_APPLIED, EDIT_STATUS_DISMISSED,
)
from ai_analysis.plan_suggestion_store import PlanSuggestionStore
from ai_analysis.training_history import build_history_context
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
    exercise_sessions_per_week,
    measure_adherence,
)
from ai_analysis.coach_tools import _exercise_history_context
from ai_analysis.workout_recommender.exercise_metadata import resolve_exercise_metadata
from nutrition.plan_store import NutritionPlanStore
from nutrition.pacing import build_paced_trajectory

router = APIRouter(prefix="/api/training-plan", tags=["training-plan"])

HISTORY_WINDOW_DAYS = 28

# How many logged sessions the roadmap charts may draw. The engine reads a
# narrower window; this is display only, so it is bounded by what a line chart
# can legibly hold rather than by an LLM token budget.
CHART_HISTORY_SESSIONS = 30



# The engine speaks lowercase canonical muscle groups; the app's charts are
# keyed by the catalog's category labels. One map, declared once.
_MUSCLE_GROUP_TO_CATEGORY = {
    "chest": "CHEST",
    "back": "BACK",
    "shoulders": "SHOULDERS",
    "biceps": "BICEPS",
    "triceps": "TRICEPS",
    "legs": "LEGS",
    "glutes": "GLUTES",
    "calves": "CALVES",
    "core": "CORE / ABS",
}

# How far back the muscle-group stimulus trend reads.
MUSCLE_HISTORY_DAYS = 180


def _muscle_group_history(sessions: List[dict]) -> dict:
    """Logged stimulus per muscle group per day, across the whole log.

    A muscle-group trend that only counted the exercises named in the current
    plan day answered the wrong question: swapping incline press for cable
    flies, or training chest on an unscheduled day, read as a drop in chest
    volume. This walks every logged session instead, so the trend follows the
    muscle rather than the plan row.
    """
    cutoff = (datetime.now() - timedelta(days=MUSCLE_HISTORY_DAYS)).strftime("%Y-%m-%d")
    buckets: dict = {}

    for session in sessions:
        date = session.get("date")
        if not date or str(date) < cutoff:
            continue
        for exercise in session.get("exercises", []) or []:
            name = exercise.get("exercise_name") or exercise.get("name") or ""
            metadata = resolve_exercise_metadata(
                exercise.get("exercise_id") or "", name, exercise
            )
            category = _MUSCLE_GROUP_TO_CATEGORY.get(metadata.muscle_group)
            if not category:
                continue

            sets = [
                {
                    "set_number": raw.get("set_number") or i + 1,
                    "weight": raw.get("weight") or 0,
                    "reps": raw.get("reps") or 0,
                    "completed": raw.get("completed"),
                }
                for i, raw in enumerate(exercise.get("sets") or [])
                if isinstance(raw, dict) and (raw.get("reps") or 0) > 0
            ]
            if not sets:
                continue

            # Bodyweight work carries no load but is still stimulus. Counting
            # only weight x reps scored a set of pull-ups as zero.
            stimulus = sum(
                (s["weight"] or 0) * s["reps"] if (s["weight"] or 0) > 0 else s["reps"]
                for s in sets
            )
            day = buckets.setdefault(category, {}).setdefault(
                str(date), {"date": str(date), "stimulus": 0.0, "sessions": []}
            )
            day["stimulus"] += stimulus
            day["sessions"].append({
                "exercise_id": exercise.get("exercise_id") or "",
                "exercise_name": name or "Exercise",
                "session_id": session.get("id"),
                "sets": sets,
            })

    return {
        category: sorted(days.values(), key=lambda entry: entry["date"])
        for category, days in buckets.items()
    }


class ProposePlanRequest(BaseModel):
    conversation_id: Optional[str] = None
    split_id: Optional[str] = None
    # None means "the user never touched the mode selector", which is the
    # signal to honour what they told the coach instead of a UI default.
    plan_mode: Optional[str] = None
    goal_statement: Optional[str] = None


class AdjustPlanRequest(BaseModel):
    conversation_id: Optional[str] = None
    adjustment: str
    plan_mode: Optional[str] = None


class ExerciseGoalRequest(BaseModel):
    """
    A guided per-exercise revision.

    Plan Mode is the editor of record for whether a lift is building or
    maintaining, and the spec asks for it to be re-enterable per exercise so a
    user can flip one lift without redoing the program. These fields map
    straight onto plan fields — no model call, no inference.
    """
    day_name: str
    exercise_id: Optional[str] = None
    exercise_name: str
    # building -> priority high, maintaining -> normal, support -> supporting
    role: Optional[str] = None
    goal: Optional[str] = None
    target_rep_range: Optional[List[int]] = None
    sets: Optional[int] = None
    notes: Optional[str] = None
    # Destination finish line (weight × reps). Clear with clear_destination=True.
    target_weight: Optional[float] = None
    target_reps: Optional[int] = None
    target_weeks: Optional[int] = None
    clear_destination: Optional[bool] = None


class SuggestionActionRequest(BaseModel):
    """Which staged edits to act on. Empty means all of them."""
    edit_ids: Optional[List[str]] = None


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


def _history_context(user_id: str) -> dict:
    """
    Everything the user has logged, independent of how it was labelled.

    The split reconstruction answers "what is on your Pull day" and gets it
    wrong whenever `split_day` is missing or mistyped. This answers "what do
    you train" from the sessions themselves, which is the question the planner
    actually needs and the one labels cannot corrupt.
    """
    sessions = [
        doc.to_dict() or {}
        for doc in db.collection("users")
        .document(user_id)
        .collection("workout_sessions")
        .stream()
    ]
    return build_history_context(sessions)


def _conversation_messages(user_id: str, conversation_id: Optional[str]) -> list:
    if not conversation_id:
        return []
    # Plan interviews run longer than coach Q&A — keep enough turns that the
    # builder still sees the goal, constraints, and follow-ups.
    return ConversationStore(db, user_id).get_history_for_model(conversation_id, limit=40)


MONTHS = {
    name.lower(): index for index, name in enumerate(
        ("January", "February", "March", "April", "May", "June", "July",
         "August", "September", "October", "November", "December"), start=1
    )
}


def _referenced_workout_dates(conversation: list) -> list:
    """Resolve every explicitly named calendar date, preserving request order."""
    user_text = "\n".join(
        str(message.get("content") or "")
        for message in conversation
        if message.get("role") == "user"
    )
    found = []
    for match in re.finditer(r"\b(20\d{2})-(\d{2})-(\d{2})\b", user_text):
        try:
            found.append((match.start(), datetime.strptime(match.group(0), "%Y-%m-%d").strftime("%Y-%m-%d")))
        except ValueError:
            pass
    month_names = "|".join(MONTHS)
    matches = list(re.finditer(
        rf"\b({month_names})\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(20\d{{2}}))?\b",
        user_text,
        flags=re.IGNORECASE,
    ))
    for match in matches:
        month, day = MONTHS[match.group(1).lower()], int(match.group(2))
        today = datetime.now()
        year = int(match.group(3)) if match.group(3) else today.year
        try:
            candidate = datetime(year, month, day)
        except ValueError:
            continue
        if not match.group(3) and candidate.date() > today.date():
            candidate = candidate.replace(year=year - 1)
        found.append((match.start(), candidate.strftime("%Y-%m-%d")))
    ordered = []
    for _, date in sorted(found):
        if date not in ordered:
            ordered.append(date)
    return ordered


def _attach_referenced_workout(user_id: str, split_context: dict, conversation: list) -> dict:
    """Attach and merge every exact workout a Plan Mode request names."""
    dates = _referenced_workout_dates(conversation)
    if not dates:
        return split_context
    transcript = " ".join(str(m.get("content") or "") for m in conversation).lower()
    known_days = [day.get("day_name") for day in split_context.get("days", []) if day.get("day_name")]
    enriched = {**split_context, "days": [dict(day) for day in split_context.get("days", [])]}
    references = []
    imported_by_day = {}
    sessions_ref = db.collection("users").document(user_id).collection("workout_sessions")
    for date in dates:
        docs = sessions_ref.where("date", "==", date).stream()
        sessions = [{"id": doc.id, **(doc.to_dict() or {})} for doc in docs]
        if not sessions:
            references.append({"date": date, "found": False})
            continue
        source = sessions[-1]
        position = transcript.find(date.lower())
        local_request = transcript[position:position + 180] if position >= 0 else transcript
        target_day = next((name for name in known_days if name.lower() in local_request), None)
        target_day = target_day or source.get("split_day")
        exercises = [{
            "exercise_id": exercise.get("exercise_id"),
            "exercise_name": exercise.get("exercise_name") or exercise.get("name") or "Exercise",
            "sets": max(1, len(exercise.get("sets") or [])),
            "reps": max([int(workout_set.get("reps") or 0)
                         for workout_set in exercise.get("sets") or []] or [8]),
            "order": index + 1,
            "source_date": date,
        } for index, exercise in enumerate(source.get("exercises") or [])
            if exercise.get("exercise_id")]
        references.append({
            "date": date, "found": True, "target_day": target_day,
            "split": source.get("split_name"), "logged_day": source.get("split_day"),
            "exercise_count": len(exercises), "exercises": exercises,
        })
        bucket = imported_by_day.setdefault(target_day, [])
        seen = {exercise.get("exercise_id") for exercise in bucket}
        bucket.extend(exercise for exercise in exercises if exercise.get("exercise_id") not in seen)

    for day in enriched["days"]:
        imported = imported_by_day.get(day.get("day_name"))
        if not imported:
            continue
        imported_ids = {exercise.get("exercise_id") for exercise in imported}
        extras = [exercise for exercise in day.get("exercises") or []
                  if exercise.get("exercise_id") not in imported_ids]
        day["exercises"] = imported + extras
    enriched["referenced_workouts"] = references
    enriched["referenced_workout"] = references[0] if references else None
    return enriched


REVISION_FIELDS = (
    "plan_name", "primary_goal", "strategy", "guidelines",
    "weekly_schedule", "days", "duration_weeks",
)


def _revision_base(plan: Optional[dict]) -> Optional[dict]:
    """The parts of a live plan a revision must be built on top of."""
    if not plan:
        return None
    return {field: plan.get(field) for field in REVISION_FIELDS}


def _write_days(user_id: str, plan: dict, days: list) -> dict:
    """
    Persist an edited `days` list through the same validation a hand edit gets.

    Accepted coach patches are not trusted more than user edits: they go
    through validate_plan so an accepted suggestion cannot feed the recommender
    an unknown goal or a nonsense rep range.
    """
    validated = PlanBuilder.validate_plan({**plan, "days": days})
    updates = {
        "days": validated["days"],
        "weekly_schedule": validated["weekly_schedule"],
        "updated_at": datetime.now().isoformat(),
    }
    (
        db.collection("users").document(user_id)
        .collection("workout_plans").document(plan["id"]).update(updates)
    )
    return {**plan, **updates}


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
    conversation = _conversation_messages(user_id, request.conversation_id)
    if request.goal_statement:
        conversation = conversation + [{"role": "user", "content": request.goal_statement}]

    # Plan Mode asks how much the split may change and users answer plainly.
    # That answer used to be discarded in favour of the modal's default, so a
    # user who said "keep the current structure" still got an adapt-mode plan
    # that moved their exercises around.
    scope = resolve_plan_mode(
        requested=request.plan_mode,
        conversation=conversation,
        valid_modes=PLAN_MODES,
        default=DEFAULT_PLAN_MODE,
    )
    plan_mode = scope["mode"]

    if not conversation:
        raise HTTPException(
            status_code=400,
            detail="Discuss a goal with the coach first, or provide a goal_statement.",
        )

    split_context = _attach_referenced_workout(
        user_id, _load_current_split(user_id, request.split_id), conversation
    )
    # What this proposal is revising. A live plan first; failing that, the draft
    # the user is still deciding on. Consulting only the active plan meant that
    # a user with none — having just ended one — had every regeneration built
    # from the conversation alone, so "put dips on the push day" returned a plan
    # containing only push days and quietly lost pull and legs.
    store = PlanStore(db, user_id)
    active = store.get_active()
    baseline = active or store.latest_draft(conversation_id=request.conversation_id)
    result = _builder().build_plan(
        conversation=conversation,
        split_context=split_context,
        profile=get_user_profile_for_ai(db, user_id),
        history_summary=_history_summary(user_id),
        plan_mode=plan_mode,
        existing_plan=_revision_base(baseline),
        history_context=_history_context(user_id),
    )
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=f"Plan generation failed: {result['error']}")

    plan = result["plan"]
    plan["source_split_id"] = split_context.get("split_id")
    # The Active Plan references the Current Split; it never overwrites it
    plan["owns_linked_split"] = False
    # Computed from the stored plans, not narrated by the model, so the review
    # screen can show what this would replace rather than only what it is.
    plan["diff"] = diff_plans(baseline, plan)
    # Recorded so the review screen can say "following your split, as you asked"
    # rather than leaving the user to notice the mode was wrong afterwards.
    plan["plan_mode_source"] = scope["source"]
    if baseline is not None and baseline is not active:
        # Say which draft this supersedes, so the review screen can explain a
        # removed day as "this drops Legs from your last draft".
        plan["revises_draft_id"] = baseline.get("id")

    plan_id = store.save_draft(plan, source_conversation_id=request.conversation_id)
    # One reviewable draft per conversation; the rest are superseded so the next
    # regeneration cannot pick up a version the user already moved past.
    store.supersede_drafts(keep_id=plan_id, conversation_id=request.conversation_id)
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
    # Adjusting a draft is the common case during review — refusing unless a
    # plan is already live sent users back through /propose, which is where the
    # days went missing.
    active = store.get_active() or store.latest_draft(
        conversation_id=request.conversation_id
    )
    if not active:
        raise HTTPException(
            status_code=404, detail="No active or draft plan to adjust"
        )

    conversation = _conversation_messages(user_id, request.conversation_id)
    conversation = conversation + [{"role": "user", "content": request.adjustment}]
    split_context = _attach_referenced_workout(
        user_id, _load_current_split(user_id, active.get("source_split_id")), conversation
    )
    result = _builder().build_plan(
        conversation=conversation,
        split_context=split_context,
        profile=get_user_profile_for_ai(db, user_id),
        history_summary=_history_summary(user_id),
        plan_mode=request.plan_mode or active.get("plan_mode") or DEFAULT_PLAN_MODE,
        existing_plan=_revision_base(active),
        adjustment_request=request.adjustment,
        history_context=_history_context(user_id),
    )
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=f"Plan adjustment failed: {result['error']}")

    plan = result["plan"]
    plan["source_split_id"] = active.get("source_split_id")
    plan["owns_linked_split"] = False
    plan["diff"] = diff_plans(active, plan)

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
    all_workout_sessions = recommender.data_fetcher.get_all_workout_sessions()
    user_goal = profile.get("primary_goal") or "Build Muscle"

    # How often each lift is trained this week. Counted per exercise across the
    # days that carry it — Push A + Push B both once still means incline is
    # twice, which is what fills the Workout 1 / Workout 2 columns.
    exercise_frequency = exercise_sessions_per_week(plan)
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
        exercises = []
        for exercise in day.get("exercises") or []:
            ex_id = exercise.get("exercise_id")
            if not ex_id:
                continue
            per_week = max(
                1,
                exercise_frequency.get(ex_id) or day_frequency.get(day_name, 1),
            )
            rep_range = exercise.get("target_rep_range")
            history_context = _exercise_history_context(
                all_workout_sessions,
                ex_id,
                exercise.get("exercise_name") or ex_id,
                recent_limit=CHART_HISTORY_SESSIONS,
            )
            # Recent ID history is preferred. Lifetime context provides the
            # exact-name fallback for legacy/custom ids and older sessions.
            projection_history = histories.get(ex_id) or []
            if not projection_history:
                projection_history = history_context.get("recent_sessions") or []
            projection = projector.project_exercise(
                exercise_id=ex_id,
                exercise_name=exercise.get("exercise_name") or ex_id,
                day_name=day_name,
                history=projection_history,
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
                target_weight=exercise.get("target_weight"),
                target_reps=exercise.get("target_reps"),
                target_weeks=exercise.get("target_weeks"),
            )
            # The chart's backward axis and the engine's input are different
            # questions. `projection_history` is what the engine may reason from:
            # 60 days, weighted sets only. That makes it the wrong source for a
            # history line — it silently drops every bodyweight session and
            # truncates to two months against a twelve-week forward axis.
            # `history_context` matches lifetime sessions by id *or* name and
            # keeps unloaded sets, so it is what the user actually did.
            logged_sessions = (history_context.get("recent_sessions") or [])[
                :CHART_HISTORY_SESSIONS
            ]
            if not logged_sessions:
                logged_sessions = projection_history[:CHART_HISTORY_SESSIONS]
            exercises.append({
                **projection.to_dict(),
                "priority": exercise.get("priority"),
                "goal": exercise.get("goal"),
                "sets": exercise.get("sets"),
                "target_rep_range": rep_range,
                "target_weight": exercise.get("target_weight"),
                "target_reps": exercise.get("target_reps"),
                "target_weeks": exercise.get("target_weeks"),
                "notes": exercise.get("notes"),
                "recent_sessions": logged_sessions,
                "last_trained": (
                    logged_sessions[0].get("date") if logged_sessions else None
                ),
                "history_context": history_context,
            })
        days_out.append({
            "day_name": day_name,
            "focus": day.get("focus"),
            "day_goal": day.get("day_goal"),
            "day_type": day.get("day_type"),
            "goal": day.get("goal"),
            "sessions_per_week": day_frequency.get(day_name, 1),
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
            "weekly_schedule": plan.get("weekly_schedule") or {},
            "progress": progress,
            "adherence": adherence.to_dict(),
            "days": days_out,
            "muscle_group_history": _muscle_group_history(all_workout_sessions),
            "nutrition": nutrition,
        },
    }


ROLE_TO_PRIORITY = {
    "building": "high",
    "maintaining": "normal",
    "support": "supporting",
}


@router.post("/exercise-goal")
async def set_exercise_goal(
    request: ExerciseGoalRequest, user_id: str = Depends(get_user_id)
):
    """
    Revise one lift's intent directly, without regenerating the plan.

    The guided counterpart to a coach patch: because the client sends typed
    fields rather than prose, this applies immediately instead of staging a
    suggestion. It writes through the same validated path a hand edit uses, and
    it can only retarget an exercise the plan already contains.
    """
    store = PlanStore(db, user_id)
    plan = store.get_active()
    if not plan:
        raise HTTPException(status_code=404, detail="No active plan to edit")

    edits: List[dict] = []

    def add(op: str, value):
        edits.append({
            "op": op,
            "day_name": request.day_name,
            "exercise_name": request.exercise_name,
            "value": value,
            "rationale": "Set from Plan Mode.",
        })

    if request.role:
        priority = ROLE_TO_PRIORITY.get(request.role.strip().lower())
        if not priority:
            raise HTTPException(
                status_code=422,
                detail="role must be building, maintaining or support",
            )
        add("set_priority", priority)
    if request.goal:
        add("set_goal", request.goal)
    if request.target_rep_range:
        add("set_rep_range", request.target_rep_range)
    if request.sets is not None:
        add("set_sets", request.sets)
    if request.notes is not None:
        add("set_notes", request.notes)
    if request.clear_destination:
        add("clear_destination", True)
    elif request.target_weight is not None or request.target_reps is not None:
        dest: dict = {}
        if request.target_weight is not None:
            dest["weight"] = request.target_weight
        if request.target_reps is not None:
            dest["reps"] = request.target_reps
        if request.target_weeks is not None:
            dest["weeks"] = request.target_weeks
        add("set_destination", dest)

    if not edits:
        raise HTTPException(status_code=400, detail="Nothing to change")

    normalized, rejected = normalize_edits(plan, edits)
    if not normalized:
        raise HTTPException(
            status_code=422,
            detail=(rejected[0]["reason"] if rejected else "Those changes could not be applied."),
        )

    days, applied_ids = apply_edits(plan, normalized)
    if not applied_ids:
        raise HTTPException(status_code=422, detail="That exercise is no longer in your plan.")

    updated = _write_days(user_id, plan, days)
    return {
        "status": "success",
        **_plan_response(store.get(plan["id"]) or updated),
        "applied": [edit["title"] for edit in normalized],
        "rejected": rejected,
    }


@router.get("/suggestions")
async def get_plan_suggestions(user_id: str = Depends(get_user_id)):
    """
    Coach-proposed target changes waiting for review on the Plan tab.

    Only ever returns a set targeting the plan that is currently live, so a
    patch left over from a retired plan cannot be applied to a new one.
    """
    plan = PlanStore(db, user_id).get_active()
    if not plan:
        return {"status": "success", "suggestion": None}
    record = PlanSuggestionStore(db, user_id).get_pending(plan_id=plan["id"])
    if not record:
        return {"status": "success", "suggestion": None}
    pending = [
        edit for edit in (record.get("edits") or [])
        if edit.get("status") == EDIT_STATUS_PENDING
    ]
    return {
        "status": "success",
        "suggestion": record,
        "pending_count": len(pending),
        "plan_changed_since": int(plan.get("version") or 1)
        != int(record.get("plan_version") or 1),
    }


@router.post("/suggestions/{set_id}/accept")
async def accept_plan_suggestions(
    set_id: str,
    request: SuggestionActionRequest = SuggestionActionRequest(),
    user_id: str = Depends(get_user_id),
):
    """
    Accept some or all staged edits. Omit edit_ids to accept every pending one.

    This is the only path by which a chat turn can change the live plan, and it
    runs on an explicit user action, never on the model's say-so.
    """
    suggestions = PlanSuggestionStore(db, user_id)
    record = suggestions.get(set_id)
    if not record:
        raise HTTPException(status_code=404, detail="Those suggestions are no longer available.")

    store = PlanStore(db, user_id)
    plan = store.get(record.get("plan_id") or "")
    if not plan:
        raise HTTPException(status_code=404, detail="The plan these suggestions target is gone.")

    wanted = set(request.edit_ids or [])
    selected = [
        edit for edit in (record.get("edits") or [])
        if edit.get("status") == EDIT_STATUS_PENDING
        and (not wanted or str(edit.get("id")) in wanted)
    ]
    if not selected:
        raise HTTPException(status_code=400, detail="Nothing left to accept.")

    days, applied_ids = apply_edits(plan, selected)
    if applied_ids:
        _write_days(user_id, plan, days)

    # An edit whose exercise has since left the plan is marked dismissed rather
    # than applied, so it cannot resurrect a lift the user already removed.
    outcomes = {
        str(edit["id"]): (
            EDIT_STATUS_APPLIED if str(edit["id"]) in applied_ids
            else EDIT_STATUS_DISMISSED
        )
        for edit in selected
    }
    record = suggestions.mark_edits(set_id, outcomes)
    updated = store.get(plan["id"])
    return {
        "status": "success",
        **_plan_response(updated),
        "suggestion": record,
        "applied_edit_ids": applied_ids,
        "skipped_edit_ids": [
            eid for eid, outcome in outcomes.items() if outcome != EDIT_STATUS_APPLIED
        ],
    }


@router.post("/suggestions/{set_id}/dismiss")
async def dismiss_plan_suggestions(
    set_id: str,
    request: SuggestionActionRequest = SuggestionActionRequest(),
    user_id: str = Depends(get_user_id),
):
    """Discard some or all staged edits. Omit edit_ids to clear the whole set."""
    suggestions = PlanSuggestionStore(db, user_id)
    record = suggestions.get(set_id)
    if not record:
        raise HTTPException(status_code=404, detail="Those suggestions are no longer available.")

    wanted = set(request.edit_ids or [])
    outcomes = {
        str(edit.get("id")): EDIT_STATUS_DISMISSED
        for edit in (record.get("edits") or [])
        if edit.get("status") == EDIT_STATUS_PENDING
        and (not wanted or str(edit.get("id")) in wanted)
    }
    if not outcomes:
        raise HTTPException(status_code=400, detail="Nothing left to dismiss.")

    record = suggestions.mark_edits(set_id, outcomes)
    return {"status": "success", "suggestion": record}


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
