from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, List, Dict, Literal
from datetime import datetime
from pydantic import BaseModel
import os

from auth import get_user_id
from db import db
from ai_analysis.plan_generator import WorkoutPlanGenerator
from data.default_exercises import validate_exercise_id
from models import TopLifts

router = APIRouter(prefix="/api/workout-plan", tags=["workout-plan"])


class PlanGenerationRequest(BaseModel):
    primary_goal: str
    experience_level: str
    preferred_workout_frequency: str
    preferred_session_length: str
    available_equipment: List[str]
    preferred_workout_days: Optional[List[str]] = None
    secondary_goals: Optional[List[str]] = None
    coaching_style: Optional[str] = None
    mode: Literal["generate", "use_split", "adopt_split", "add_onto"] = "generate"
    split_id: Optional[str] = None
    top_lifts: Optional[TopLifts] = None
    accepted_additions: Optional[List[dict]] = None
    split_routine: Optional[List[dict]] = None


class AdditionSuggestionRequest(BaseModel):
    split_id: str
    primary_goal: str
    available_equipment: List[str]
    split_routine: Optional[List[dict]] = None


def _apply_user_routine(
    context: dict, split_routine: Optional[List[dict]]
) -> dict:
    """Overlay user-entered exercises onto split day context when provided."""
    if not split_routine:
        return context

    by_day = {
        item.get("day"): item.get("exercises", [])
        for item in split_routine
        if item.get("day")
    }
    # Clients send the split's raw day names; repeated days now carry an A/B
    # label, so fall back to the base name they were built from.
    day_labels = context.get("day_labels") or {}
    for day in context.get("days", []):
        day_name = day.get("day_name")
        provided = by_day.get(day_name) or by_day.get(day_labels.get(day_name))
        if not provided:
            continue
        exercises = []
        seen = set()
        for item in provided:
            exercise_id = item.get("exercise_id")
            if not exercise_id or exercise_id in seen:
                continue
            seen.add(exercise_id)

            set_details = item.get("set_details") or []
            cleaned_sets = []
            for idx, raw_set in enumerate(set_details):
                if not isinstance(raw_set, dict):
                    continue
                reps = int(raw_set.get("reps", 0) or 0)
                weight_raw = raw_set.get("weight")
                weight = (
                    float(weight_raw)
                    if isinstance(weight_raw, (int, float)) and weight_raw > 0
                    else None
                )
                if reps <= 0 and weight is None:
                    continue
                cleaned_sets.append(
                    {
                        "set_number": idx + 1,
                        "reps": max(1, min(30, reps if reps > 0 else 8)),
                        **({"weight": weight} if weight is not None else {}),
                    }
                )

            if cleaned_sets:
                set_count = len(cleaned_sets)
                reps_values = [s["reps"] for s in cleaned_sets]
                reps = round(sum(reps_values) / len(reps_values))
                weight_values = [
                    s["weight"] for s in cleaned_sets if s.get("weight") is not None
                ]
                working_weight = (
                    round(sum(weight_values) / len(weight_values), 1)
                    if weight_values
                    else None
                )
            else:
                set_count = max(1, min(10, int(item.get("sets", 3) or 3)))
                reps = max(1, min(30, int(item.get("reps", 8) or 8)))
                weight_raw = item.get("weight")
                working_weight = (
                    float(weight_raw)
                    if isinstance(weight_raw, (int, float)) and weight_raw > 0
                    else None
                )
                cleaned_sets = [
                    {
                        "set_number": i + 1,
                        "reps": reps,
                        **(
                            {"weight": working_weight}
                            if working_weight is not None
                            else {}
                        ),
                    }
                    for i in range(set_count)
                ]

            prescription = {
                "exercise_id": exercise_id,
                "exercise_name": item.get("exercise_name", "Exercise"),
                "sets": set_count,
                "reps": reps,
                "rest_seconds": 120,
                "notes": "From the routine you entered.",
                "order": len(exercises) + 1,
                "set_details": cleaned_sets,
            }
            if working_weight is not None:
                prescription["last_working_weight"] = working_weight
            exercises.append(prescription)
        if exercises:
            day["exercises"] = exercises
            day["estimated_duration_minutes"] = max(30, len(exercises) * 8)
    return context


def _load_profile(user_id: str):
    profile_ref = (
        db.collection("users")
        .document(user_id)
        .collection("user_profile")
        .document("profile")
    )
    doc = profile_ref.get()
    return profile_ref, (doc.to_dict() if doc.exists else {})


def _exercise_prescription(exercise: dict, order: int) -> dict:
    sets = exercise.get("sets", [])
    working_weight = None
    if isinstance(sets, list) and sets:
        reps_values = [int(item.get("reps", 0) or 0) for item in sets]
        positive_reps = [value for value in reps_values if value > 0]
        reps = round(sum(positive_reps) / len(positive_reps)) if positive_reps else 8
        set_count = len(sets)
        positive_weights = [
            float(item.get("weight", 0) or 0)
            for item in sets
            if float(item.get("weight", 0) or 0) > 0
        ]
        if positive_weights:
            working_weight = round(sum(positive_weights) / len(positive_weights), 1)
    else:
        set_count = int(sets or 3) if isinstance(sets, (int, float)) else 3
        reps = int(exercise.get("reps", 8) or 8)
    prescription = {
        "exercise_id": exercise.get("exercise_id", ""),
        "exercise_name": exercise.get("exercise_name", "Exercise"),
        "sets": max(1, min(10, set_count)),
        "reps": max(1, min(30, reps)),
        "rest_seconds": 120,
        "notes": exercise.get("notes") or "Use controlled form and adjust as needed.",
        "order": order,
    }
    if working_weight is not None:
        prescription["last_working_weight"] = working_weight
    return prescription


# A reconstructed day is meant to describe a workout, not everything the user
# has ever done on that weekday. Without a cap, unioning every logged session
# produced a 20-exercise "Push" day that no one has ever performed.
MAX_RECONSTRUCTED_EXERCISES = 12

# How many past sessions compose one reconstructed day. More than this and
# one-off substitutions start looking like part of the routine.
SESSIONS_PER_RECONSTRUCTED_DAY = 3


def _labelled_day_slots(day_names: List[str]) -> List[dict]:
    """
    Give repeated day names distinct identities.

    A split stored as ['Pull', 'Push', 'Legs', 'Pull', 'Push'] means the user
    trains pull twice a week with different work each time. Stored as bare
    strings, the two Pull entries are indistinguishable, reconstruct
    identically, and get deduplicated down to one — so the planner had no basis
    for what separates Pull A from Pull B and reinvented it on every build.
    """
    totals: Dict[str, int] = {}
    for name in day_names:
        totals[name] = totals.get(name, 0) + 1

    seen: Dict[str, int] = {}
    slots = []
    for name in day_names:
        occurrence = seen.get(name, 0)
        seen[name] = occurrence + 1
        label = (
            f"{name} {chr(ord('A') + occurrence)}" if totals[name] > 1 else name
        )
        slots.append({"label": label, "base": name, "occurrence": occurrence,
                      "total": totals[name]})
    return slots


def _sessions_for_slot(day_sessions: List[dict], slot: dict) -> List[dict]:
    """
    Which logged sessions describe this slot.

    For a day trained twice a week the log alternates between them, so slot A
    takes every Nth session from position 0 and slot B from position 1. That
    gives the two days genuinely different contents instead of one shared
    superset.
    """
    stride = max(1, slot["total"])
    selected = day_sessions[slot["occurrence"]::stride]
    return selected[:SESSIONS_PER_RECONSTRUCTED_DAY]


def _load_split_context(user_id: str, split_id: str) -> dict:
    split_ref = (
        db.collection("users")
        .document(user_id)
        .collection("splits")
        .document(split_id)
    )
    split_doc = split_ref.get()
    if not split_doc.exists:
        raise HTTPException(status_code=404, detail="Split not found")
    split = {"id": split_doc.id, **split_doc.to_dict()}
    day_names = [str(day) for day in split.get("days", []) if str(day).strip()]
    if not day_names:
        raise HTTPException(status_code=422, detail="Selected split has no workout days")

    # AI-created splits link back to a full plan, which is the best source.
    linked_plan_id = split.get("linked_plan_id")
    if linked_plan_id:
        plan_doc = (
            db.collection("users")
            .document(user_id)
            .collection("workout_plans")
            .document(linked_plan_id)
            .get()
        )
        if plan_doc.exists:
            plan_days = plan_doc.to_dict().get("days", [])
            return {
                "split_id": split_id,
                "split_name": split.get("name", "Existing Split"),
                "days": plan_days,
            }

    # User-created splits currently store day names only. Reconstruct their
    # routine from the most recent sessions logged against the split/day.
    sessions = []
    sessions_ref = (
        db.collection("users")
        .document(user_id)
        .collection("workout_sessions")
    )
    split_name_key = str(split.get("name") or "").strip().lower()
    for session_doc in sessions_ref.stream():
        data = session_doc.to_dict()
        session_name_key = str(data.get("split_name") or "").strip().lower()
        if (
            data.get("split_id") == split_id
            or (
                not data.get("split_id")
                and split_name_key
                and session_name_key == split_name_key
            )
        ):
            sessions.append(data)
    sessions.sort(key=lambda item: item.get("date", ""), reverse=True)

    sessions_by_day: Dict[str, List[dict]] = {}
    for session in sessions:
        sessions_by_day.setdefault(session.get("split_day"), []).append(session)

    slots = _labelled_day_slots(day_names)
    days = []
    for slot in slots:
        seen = set()
        exercises = []
        for session in _sessions_for_slot(sessions_by_day.get(slot["base"], []), slot):
            for exercise in session.get("exercises", []):
                exercise_id = exercise.get("exercise_id")
                if not exercise_id or exercise_id in seen:
                    continue
                seen.add(exercise_id)
                exercises.append(_exercise_prescription(exercise, len(exercises) + 1))
                if len(exercises) >= MAX_RECONSTRUCTED_EXERCISES:
                    break
            if len(exercises) >= MAX_RECONSTRUCTED_EXERCISES:
                break
        days.append(
            {
                "day_name": slot["label"],
                "focus": slot["base"],
                "estimated_duration_minutes": max(30, len(exercises) * 8),
                "exercises": exercises,
            }
        )
    return {
        "split_id": split_id,
        "split_name": split.get("name", "Existing Split"),
        "day_labels": {slot["label"]: slot["base"] for slot in slots},
        "days": days,
    }


def _weekly_schedule(day_names: List[str], preferred_days: Optional[List[str]]) -> dict:
    weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    schedule = {day: "Rest" for day in weekdays}
    selected = [day.lower() for day in (preferred_days or []) if day.lower() in weekdays]
    slots = (selected + [day for day in weekdays if day not in selected])[
        : len(day_names)
    ]
    for weekday, workout_day in zip(slots, day_names):
        schedule[weekday] = workout_day
    return schedule


def _build_adopted_plan(context: dict, request: PlanGenerationRequest) -> dict:
    days = context["days"]
    if not any(day.get("exercises") for day in days):
        raise HTTPException(
            status_code=422,
            detail=(
                "No exercises found for this split. Add the workouts you do on "
                "each day, or log a session with that split first."
            ),
        )
    return {
        "plan_name": context["split_name"],
        "plan_description": "Your existing routine, connected to GymAI progression.",
        "split_type": context["split_name"],
        "weekly_schedule": _weekly_schedule(
            [day["day_name"] for day in days], request.preferred_workout_days
        ),
        "days": days,
        "progression_notes": "Progress using your logged performance and GymAI recommendations.",
        "deload_schedule": "Deload when performance stalls or recovery declines.",
    }


def _append_additions(plan: dict, additions: Optional[List[dict]]) -> dict:
    additions_by_day: Dict[str, List[dict]] = {}
    for item in additions or []:
        additions_by_day.setdefault(item.get("day", ""), []).append(item)
    for day in plan.get("days", []):
        existing_ids = {ex.get("exercise_id") for ex in day.get("exercises", [])}
        for item in additions_by_day.get(day.get("day_name"), []):
            exercise_id = item.get("exercise_id")
            if (
                not exercise_id
                or exercise_id in existing_ids
                or not validate_exercise_id(exercise_id)
            ):
                continue
            existing_ids.add(exercise_id)
            day["exercises"].append(
                {
                    "exercise_id": exercise_id,
                    "exercise_name": item.get("exercise_name", "Exercise"),
                    "sets": max(1, min(5, int(item.get("sets", 3)))),
                    "reps": max(1, min(30, int(item.get("reps", 10)))),
                    "rest_seconds": 90,
                    "notes": item.get("reason", "Complements your existing routine."),
                    "order": len(day["exercises"]) + 1,
                }
            )
        day["estimated_duration_minutes"] = max(30, len(day["exercises"]) * 8)
    return plan


def _persist_plan(
    user_id: str,
    plan_data: dict,
    mode: str,
    source_split_id: Optional[str],
) -> dict:
    now = datetime.now().isoformat()
    plans_ref = db.collection("users").document(user_id).collection("workout_plans")
    for existing in plans_ref.where("is_active", "==", True).stream():
        plans_ref.document(existing.id).update(
            {"is_active": False, "updated_at": now}
        )

    plan_data.update(
        {
            "is_active": True,
            "created_at": now,
            "updated_at": now,
            "creation_mode": mode,
            "source_split_id": source_split_id,
        }
    )
    plan_ref = plans_ref.document()
    plan_ref.set(plan_data)
    plan_data["id"] = plan_ref.id

    if source_split_id:
        linked_split_id = source_split_id
        owns_linked_split = False
    else:
        split_data = {
            "name": plan_data.get("plan_name", "AI Workout Plan"),
            "days": [day.get("day_name", "") for day in plan_data.get("days", [])],
            "created_at": now,
            "is_ai_generated": True,
            "linked_plan_id": plan_ref.id,
        }
        split_ref = (
            db.collection("users")
            .document(user_id)
            .collection("splits")
            .document()
        )
        split_ref.set(split_data)
        linked_split_id = split_ref.id
        owns_linked_split = True

    plan_ref.update(
        {
            "linked_split_id": linked_split_id,
            "owns_linked_split": owns_linked_split,
        }
    )
    plan_data["linked_split_id"] = linked_split_id
    plan_data["owns_linked_split"] = owns_linked_split
    return plan_data


@router.post("/generate")
async def generate_workout_plan(
    request: PlanGenerationRequest,
    user_id: str = Depends(get_user_id)
):
    """Create a plan from scratch, a split skeleton, or an existing routine."""
    try:
        if request.mode != "generate" and not request.split_id:
            raise HTTPException(
                status_code=422,
                detail="Select an existing split for this plan mode.",
            )
        if request.top_lifts is not None:
            for value in request.top_lifts.values():
                entry = (
                    {"weight": value}
                    if isinstance(value, (int, float))
                    else value.dict()
                )
                reps = entry.get("reps")
                if (
                    entry["weight"] <= 0
                    or entry["weight"] > 1000
                    or (reps is not None and (reps < 1 or reps > 50))
                ):
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            "Lift context requires 1-1000 lbs and, when "
                            "provided, 1-50 reps."
                        ),
                    )

        profile_ref, profile_data = _load_profile(user_id)
        split_context = (
            _load_split_context(user_id, request.split_id)
            if request.split_id
            else None
        )
        if split_context:
            split_context = _apply_user_routine(
                split_context, request.split_routine
            )

        if request.mode in ("generate", "use_split"):
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise HTTPException(
                    status_code=500, detail="OpenAI API key not configured"
                )
            payload = request.dict()
            if split_context:
                payload["split_context"] = split_context
            generator = WorkoutPlanGenerator(api_key=api_key)
            plan_data = generator.generate_plan(payload, profile_data)
            if request.mode == "use_split":
                plan_data["plan_name"] = f"{split_context['split_name']} · {request.primary_goal}"
                plan_data["weekly_schedule"] = _weekly_schedule(
                    [day["day_name"] for day in plan_data.get("days", [])],
                    request.preferred_workout_days,
                )
        else:
            plan_data = _build_adopted_plan(split_context, request)
            if request.mode == "add_onto":
                plan_data = _append_additions(
                    plan_data, request.accepted_additions
                )
                plan_data["plan_description"] = (
                    "Your current routine with selected complementary exercises."
                )

        saved = _persist_plan(
            user_id=user_id,
            plan_data=plan_data,
            mode=request.mode,
            source_split_id=request.split_id,
        )

        profile_update = {
            "available_equipment": request.available_equipment,
            "preferred_workout_days": request.preferred_workout_days,
            "preferred_workout_frequency": request.preferred_workout_frequency,
            "preferred_session_length": request.preferred_session_length,
            "experience_level": request.experience_level,
            "primary_goal": request.primary_goal,
            "secondary_goals": request.secondary_goals,
            "updated_at": datetime.now().isoformat(),
        }
        if request.top_lifts is not None:
            profile_update["top_lifts"] = request.dict()["top_lifts"]
            profile_update["top_lifts_updated"] = datetime.now().isoformat()
        profile_ref.set(profile_update, merge=True)
        return saved

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Error generating plan: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error generating workout plan: {str(e)}")


@router.post("/suggest-additions")
async def suggest_plan_additions(
    request: AdditionSuggestionRequest,
    user_id: str = Depends(get_user_id),
):
    """Suggest optional catalog exercises while preserving the current routine."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    try:
        context = _load_split_context(user_id, request.split_id)
        context = _apply_user_routine(context, request.split_routine)
        if not any(day.get("exercises") for day in context.get("days", [])):
            raise HTTPException(
                status_code=422,
                detail=(
                    "Add the exercises you currently do, or log sessions for "
                    "this split before requesting additions."
                ),
            )
        _, profile = _load_profile(user_id)
        generator = WorkoutPlanGenerator(api_key=api_key)
        suggestions = generator.suggest_additions(
            split_context=context,
            primary_goal=request.primary_goal,
            available_equipment=request.available_equipment,
            user_profile=profile,
        )
        return {"split": context, "suggestions": suggestions}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Error suggesting additions: {str(exc)}",
        )


@router.get("")
async def get_active_plan(user_id: str = Depends(get_user_id)):
    """Get the user's active workout plan."""
    plans_ref = db.collection("users").document(user_id).collection("workout_plans")
    active_plans = list(plans_ref.where("is_active", "==", True).stream())

    if not active_plans:
        return None

    plan_doc = active_plans[0]
    plan_data = plan_doc.to_dict()
    plan_data["id"] = plan_doc.id
    return plan_data


@router.get("/today")
async def get_todays_workout(user_id: str = Depends(get_user_id)):
    """Get today's workout from the active plan."""
    # Get active plan
    plans_ref = db.collection("users").document(user_id).collection("workout_plans")
    active_plans = list(plans_ref.where("is_active", "==", True).stream())

    if not active_plans:
        return {"status": "no_plan"}

    plan_doc = active_plans[0]
    plan_data = plan_doc.to_dict()
    plan_data["id"] = plan_doc.id

    # Get today's day of week
    today = datetime.now()
    day_of_week = today.strftime("%A").lower()  # e.g., "monday"

    schedule = plan_data.get("weekly_schedule", {})
    today_assignment = schedule.get(day_of_week)

    if not today_assignment or today_assignment.lower() == "rest":
        # Find next workout day
        days_order = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        current_idx = days_order.index(day_of_week)
        next_workout_day = None
        next_workout_name = None

        for i in range(1, 8):
            check_day = days_order[(current_idx + i) % 7]
            check_assignment = schedule.get(check_day, "Rest")
            if check_assignment and check_assignment.lower() != "rest":
                next_workout_day = check_day.capitalize()
                next_workout_name = check_assignment
                break

        return {
            "status": "rest_day",
            "rest_day_message": "Today is a rest day. Focus on recovery, stretching, and nutrition.",
            "next_workout_day": next_workout_day,
            "next_workout_name": next_workout_name,
            "plan_id": plan_data["id"],
        }

    # Find the matching day in the plan
    matching_day = None
    for day in plan_data.get("days", []):
        if day.get("day_name") == today_assignment:
            matching_day = day
            break

    if not matching_day:
        return {"status": "no_plan"}

    # Check if a session was already logged today
    today_str = today.strftime("%Y-%m-%d")
    sessions_ref = db.collection("users").document(user_id).collection("workout_sessions")
    today_sessions = list(sessions_ref.where("date", "==", today_str).stream())

    already_logged = False
    existing_session_id = None
    for session in today_sessions:
        session_data = session.to_dict()
        if (
            session_data.get("split_id") == plan_data.get("linked_split_id")
            and session_data.get("split_day") == today_assignment
        ) or (
            not session_data.get("split_id")
            and (
                session_data.get("split_day") == today_assignment
                or session_data.get("split_name") == plan_data.get("plan_name")
            )
        ):
            already_logged = True
            existing_session_id = session.id
            break

    return {
        "status": "workout_day",
        "day_name": matching_day.get("day_name"),
        "focus": matching_day.get("focus"),
        "exercises": matching_day.get("exercises", []),
        "estimated_duration_minutes": matching_day.get("estimated_duration_minutes"),
        "plan_id": plan_data["id"],
        "plan_name": plan_data.get("plan_name"),
        "split_id": plan_data.get("linked_split_id"),
        "already_logged": already_logged,
        "existing_session_id": existing_session_id,
    }


@router.delete("/{plan_id}")
async def delete_workout_plan(plan_id: str, user_id: str = Depends(get_user_id)):
    """Delete a workout plan and its linked split."""
    plan_ref = db.collection("users").document(user_id).collection("workout_plans").document(plan_id)
    plan_doc = plan_ref.get()

    if not plan_doc.exists:
        raise HTTPException(status_code=404, detail="Workout plan not found")

    plan_data = plan_doc.to_dict()

    # Delete the linked split if it exists
    linked_split_id = plan_data.get("linked_split_id")
    if linked_split_id and plan_data.get("owns_linked_split", False):
        split_ref = db.collection("users").document(user_id).collection("splits").document(linked_split_id)
        if split_ref.get().exists:
            split_ref.delete()

    plan_ref.delete()
    return {"message": "Workout plan deleted"}


@router.post("/{plan_id}/regenerate")
async def regenerate_workout_plan(
    plan_id: str,
    user_id: str = Depends(get_user_id)
):
    """Regenerate a plan using the same preferences from the original."""
    plan_ref = db.collection("users").document(user_id).collection("workout_plans").document(plan_id)
    plan_doc = plan_ref.get()

    if not plan_doc.exists:
        raise HTTPException(status_code=404, detail="Workout plan not found")

    _, profile_data = _load_profile(user_id)
    plan_data = plan_doc.to_dict()
    creation_mode = plan_data.get("creation_mode", "generate")
    if creation_mode in ("adopt_split", "add_onto"):
        raise HTTPException(
            status_code=422,
            detail="Create a new plan to refresh an adopted routine.",
        )

    # Build a request from profile data
    regen_request = PlanGenerationRequest(
        primary_goal=profile_data.get("primary_goal", "General Fitness"),
        experience_level=profile_data.get("experience_level", "Intermediate"),
        preferred_workout_frequency=profile_data.get("preferred_workout_frequency", "3-4x/week"),
        preferred_session_length=profile_data.get("preferred_session_length", "45-60 min"),
        available_equipment=profile_data.get("available_equipment", ["Full Gym"]),
        preferred_workout_days=profile_data.get("preferred_workout_days"),
        secondary_goals=profile_data.get("secondary_goals"),
        coaching_style=profile_data.get("coaching_style_preference"),
        mode=creation_mode,
        split_id=plan_data.get("source_split_id"),
        top_lifts=profile_data.get("top_lifts"),
    )

    return await generate_workout_plan(regen_request, user_id)
