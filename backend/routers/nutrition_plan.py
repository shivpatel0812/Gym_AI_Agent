"""
Nutrition Plan API.

Create flow: POST /propose (draft from questionnaire) -> review -> POST /{id}/activate.
Plan page: GET /active, PATCH /{id} for simple edits.
Today: GET /today-guidance from logged intake + plan, no extra questionnaire.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List, Any
from datetime import datetime, timedelta
from pydantic import BaseModel
import os

from auth import get_user_id
from db import db
from nutrition.plan_builder import NutritionPlanBuilder, GOAL_KEYS, suggest_nutrition_goal
from nutrition.plan_store import (
    NutritionPlanStore,
    STATUS_ACTIVE,
    STATUS_PAUSED,
    STATUS_COMPLETED,
)
from nutrition.today_guidance import build_today_guidance
from nutrition.blueprint_ai import suggest_fast_food_orders, suggest_slot_fills
from nutrition.usuals import build_usuals, entry_totals, find_usual, foods_to_log
from nutrition.training_context import conversation_notes, load_training_context
from ai_analysis.profile_transformer import get_user_profile_for_ai
from ai_analysis.data_analyzer import FitnessDataAnalyzer
from ai_analysis.conversation_store import ConversationStore

router = APIRouter(prefix="/api/nutrition-plan", tags=["nutrition-plan"])


class ProposeNutritionPlanRequest(BaseModel):
    goal: Optional[str] = None
    goal_notes: Optional[str] = None
    typical_day: Optional[str] = None
    meal_anchors: Optional[List[dict]] = None
    flexible_meals: Optional[List[dict]] = None
    go_to_items: Optional[List[dict]] = None
    preferences: Optional[dict] = None
    conversation_id: Optional[str] = None
    # "gpt-4o" (default) or "gpt-5.6-sol"
    model: Optional[str] = None


class ToggleUsualRequest(BaseModel):
    date: Optional[str] = None
    hour: Optional[int] = None


class SuggestSlotRequest(BaseModel):
    slot: str
    stance: Optional[str] = None
    model: Optional[str] = None


class SuggestFastFoodRequest(BaseModel):
    place_name: str
    slot: Optional[str] = "dinner"
    remaining: Optional[dict] = None
    model: Optional[str] = None


class UpdateNutritionPlanRequest(BaseModel):
    goal: Optional[str] = None
    goal_detail: Optional[str] = None
    strategy: Optional[str] = None
    typical_day_notes: Optional[str] = None
    targets: Optional[dict] = None
    meal_anchors: Optional[List[dict]] = None
    flexible_meals: Optional[List[dict]] = None
    go_to_items: Optional[List[dict]] = None
    blueprint_extras: Optional[List[dict]] = None
    slot_profiles: Optional[List[dict]] = None
    fast_food_places: Optional[List[dict]] = None
    preferences: Optional[dict] = None
    food_priorities: Optional[List[str]] = None


def _store(user_id: str) -> NutritionPlanStore:
    return NutritionPlanStore(db, user_id)


def _builder(model: Optional[str] = None) -> NutritionPlanBuilder:
    from ai_models import resolve_model

    return NutritionPlanBuilder(
        api_key=os.getenv("OPENAI_API_KEY"),
        model=resolve_model(model),
    )


def _recent_nutrition(user_id: str) -> dict:
    try:
        summary = FitnessDataAnalyzer(db, user_id).build_rolling_summary(window_days=14)
        return summary.get("nutrition") or {}
    except Exception as e:
        print(f"Warning: nutrition history unavailable: {e}")
        return {}


def _sync_targets(user_id: str, plan: dict) -> None:
    """Keep profile nutrition_targets in sync so Today rings use the plan."""
    targets = plan.get("targets") or {}
    values = {
        k: targets[k]
        for k in ("calories", "protein", "carbs", "fats", "fiber")
        if isinstance(targets.get(k), (int, float))
    }
    if not values:
        return
    doc_ref = (
        db.collection("users")
        .document(user_id)
        .collection("user_profile")
        .document("profile")
    )
    existing = doc_ref.get()
    current = (existing.to_dict() or {}).get("nutrition_targets") or {} if existing.exists else {}
    doc_ref.set(
        {
            "nutrition_targets": {**current, **values},
            "updated_at": datetime.now().isoformat(),
        },
        merge=True,
    )


def _macros_ref(user_id: str):
    return db.collection("users").document(user_id).collection("macros")


def _macro_docs(user_id: str, date: str) -> List[Any]:
    return list(_macros_ref(user_id).where("date", "==", date).stream())


def _logged_foods(user_id: str, date: str) -> List[dict]:
    foods = []
    for doc in _macro_docs(user_id, date):
        data = doc.to_dict() or {}
        items = data.get("food_items") or []
        if items:
            foods.extend(items)
    return foods


def _recent_macro_entries(user_id: str, days: int = 21) -> List[dict]:
    """Recent days of logged food, for learning someone's repeat meals."""
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    col = _macros_ref(user_id)
    try:
        docs = list(col.where("date", ">=", cutoff).stream())
    except Exception as e:
        print(f"Warning: macro history query failed, scanning instead: {e}")
        docs = list(col.stream())

    rows = []
    for doc in docs:
        data = doc.to_dict() or {}
        date = str(data.get("date") or "")[:10]
        if date >= cutoff:
            rows.append({"date": date, "food_items": data.get("food_items") or []})
    return rows


def _weekday(date: str) -> int:
    try:
        return datetime.strptime(date[:10], "%Y-%m-%d").weekday()
    except (TypeError, ValueError):
        return datetime.now().weekday()


def _usuals_payload(user_id: str, date: str, hour: Optional[int]) -> dict:
    plan = _store(user_id).get_active()
    active = plan if plan and plan.get("status") == STATUS_ACTIVE else None
    foods = _logged_foods(user_id, date)
    payload = build_usuals(
        active,
        foods,
        history=_recent_macro_entries(user_id),
        hour=hour if hour is not None else datetime.now().hour,
        weekday=_weekday(date),
    )
    # Home shows what a tap did to the day's budget, so it rides along here
    # rather than costing the phone a second request.
    guidance = build_today_guidance(active, foods)
    payload["remaining"] = guidance.get("remaining") if guidance.get("has_plan") else None
    return payload


def _append_food_items(user_id: str, date: str, items: List[dict]) -> None:
    now = datetime.now().isoformat()
    docs = _macro_docs(user_id, date)
    if docs:
        doc = docs[0]
        food_items = list((doc.to_dict() or {}).get("food_items") or []) + items
        doc.reference.update({
            "food_items": food_items,
            **entry_totals(food_items),
            "updated_at": now,
        })
        return
    _macros_ref(user_id).document().set({
        "date": date,
        "food_items": items,
        **entry_totals(items),
        "created_at": now,
    })


def _remove_usual_items(user_id: str, date: str, usual_id: str) -> None:
    now = datetime.now().isoformat()
    for doc in _macro_docs(user_id, date):
        items = (doc.to_dict() or {}).get("food_items") or []
        kept = [item for item in items if item.get("usual_id") != usual_id]
        if len(kept) != len(items):
            doc.reference.update({
                "food_items": kept,
                **entry_totals(kept),
                "updated_at": now,
            })


@router.get("/goals")
async def get_nutrition_goals():
    return {
        "goals": [{"id": key, "label": label} for key, label in GOAL_KEYS.items()],
        "frequencies": [
            {"id": "daily", "label": "Every day"},
            {"id": "most_days", "label": "Most days"},
            {"id": "weekdays", "label": "Weekdays"},
            {"id": "weekends", "label": "Weekends"},
            {"id": "few_times_week", "label": "A few times a week"},
            {"id": "occasionally", "label": "Occasionally"},
        ],
    }


@router.get("/suggested-goal")
async def get_suggested_goal(user_id: str = Depends(get_user_id)):
    """Nutrition goal derived from the active training plan, for the wizard."""
    training = load_training_context(db, user_id)
    return {"status": "success", "suggestion": suggest_nutrition_goal(training)}


@router.post("/propose")
async def propose_nutrition_plan(
    request: ProposeNutritionPlanRequest,
    user_id: str = Depends(get_user_id),
):
    if request.goal and request.goal not in GOAL_KEYS:
        raise HTTPException(status_code=400, detail="Choose a nutrition goal.")
    if not request.goal and not request.conversation_id:
        raise HTTPException(status_code=400, detail="Choose a nutrition goal.")

    notes = None
    if request.conversation_id:
        try:
            history = ConversationStore(db, user_id).get_history_for_model(
                request.conversation_id, limit=40
            )
            notes = conversation_notes(history)
        except Exception as e:
            print(f"Warning: could not load nutrition conversation: {e}")

    answers = {
        "goal": request.goal,
        "goal_notes": request.goal_notes,
        "typical_day": request.typical_day,
        "meal_anchors": request.meal_anchors or [],
        "flexible_meals": request.flexible_meals or [],
        "go_to_items": request.go_to_items or [],
        "preferences": request.preferences or {},
        "conversation_notes": notes,
    }
    result = _builder(request.model).build_plan(
        answers=answers,
        profile=get_user_profile_for_ai(db, user_id),
        recent_nutrition=_recent_nutrition(user_id),
        training_context=load_training_context(db, user_id),
    )
    if result.get("status") != "success":
        raise HTTPException(status_code=500, detail=result.get("error") or "Could not create plan.")

    plan = result["plan"]
    plan_id = _store(user_id).save_draft(plan)
    saved = _store(user_id).get(plan_id)
    return {"status": "success", "plan": saved}


@router.post("/{plan_id}/activate")
async def activate_nutrition_plan(plan_id: str, user_id: str = Depends(get_user_id)):
    store = _store(user_id)
    plan = store.activate(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Nutrition plan not found")
    _sync_targets(user_id, plan)
    return {"status": "success", "plan": plan}


@router.get("/active")
async def get_active_nutrition_plan(user_id: str = Depends(get_user_id)):
    plan = _store(user_id).get_active()
    if not plan:
        return {"status": "success", "plan": None}
    return {"status": "success", "plan": plan}


@router.get("/today-guidance")
async def get_today_guidance(
    date: Optional[str] = Query(None),
    user_id: str = Depends(get_user_id),
):
    day = date or datetime.now().strftime("%Y-%m-%d")
    plan = _store(user_id).get_active()
    if not plan or plan.get("status") != STATUS_ACTIVE:
        return {"status": "success", "guidance": {"has_plan": False}}
    foods = _logged_foods(user_id, day)
    return {
        "status": "success",
        "guidance": build_today_guidance(plan, foods),
        "date": day,
    }


@router.get("/usuals")
async def get_usuals(
    date: Optional[str] = Query(None),
    hour: Optional[int] = Query(None, ge=0, le=23),
    user_id: str = Depends(get_user_id),
):
    """
    One-tap foods for Home: plan anchors plus repeats learned from the log.

    hour comes from the client so the "current" meal slot follows the user's
    clock rather than the server's timezone.
    """
    day = date or datetime.now().strftime("%Y-%m-%d")
    return {"status": "success", "date": day, "usuals": _usuals_payload(user_id, day, hour)}


@router.post("/usuals/{usual_id}/toggle")
async def toggle_usual(
    usual_id: str,
    request: ToggleUsualRequest = ToggleUsualRequest(),
    user_id: str = Depends(get_user_id),
):
    """Log a usual into today's macros, or undo a previous tap."""
    day = request.date or datetime.now().strftime("%Y-%m-%d")
    payload = _usuals_payload(user_id, day, request.hour)
    usual = find_usual(payload, usual_id)
    if not usual:
        raise HTTPException(status_code=404, detail="That usual is no longer in your plan.")

    if usual["logged"]:
        if not usual["can_undo"]:
            # Logged by hand, not by tap. Removing it would delete food this
            # feature never wrote, so leave the day alone.
            return {
                "status": "success",
                "logged": True,
                "changed": False,
                "date": day,
                "usuals": payload,
            }
        _remove_usual_items(user_id, day, usual_id)
        logged = False
    else:
        _append_food_items(user_id, day, foods_to_log(usual))
        logged = True

    return {
        "status": "success",
        "logged": logged,
        "changed": True,
        "date": day,
        "usuals": _usuals_payload(user_id, day, request.hour),
    }


@router.patch("/{plan_id}")
async def update_nutrition_plan(
    plan_id: str,
    request: UpdateNutritionPlanRequest,
    user_id: str = Depends(get_user_id),
):
    store = _store(user_id)
    existing = store.get(plan_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Nutrition plan not found")

    patch = {k: v for k, v in request.dict(exclude_unset=True).items() if v is not None}
    merged = {**existing, **patch}
    validated = NutritionPlanBuilder.validate_plan(merged)
    to_write = {
        k: validated[k]
        for k in (
            "goal", "goal_detail", "targets", "strategy", "typical_day_notes",
            "meal_anchors", "flexible_meals", "go_to_items", "blueprint_extras",
            "slot_profiles", "fast_food_places",
            "preferences", "food_priorities",
        )
        if k in validated
    }
    updated = store.update(plan_id, to_write)
    if updated and updated.get("status") == STATUS_ACTIVE:
        _sync_targets(user_id, updated)
    return {"status": "success", "plan": updated}


@router.post("/{plan_id}/suggest-slot")
async def suggest_slot(
    plan_id: str,
    request: SuggestSlotRequest,
    user_id: str = Depends(get_user_id),
):
    plan = _store(user_id).get(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Nutrition plan not found")
    slot = (request.slot or "").strip().lower()
    if slot not in ("breakfast", "lunch", "pre_workout", "dinner", "snack", "shake", "late_night", "other"):
        raise HTTPException(status_code=400, detail="Invalid slot")
    result = suggest_slot_fills(plan, slot, request.stance, request.model)
    return {"status": "success", "suggestion": result}


@router.post("/{plan_id}/suggest-fast-food")
async def suggest_fast_food(
    plan_id: str,
    request: SuggestFastFoodRequest,
    user_id: str = Depends(get_user_id),
):
    plan = _store(user_id).get(plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Nutrition plan not found")
    place = (request.place_name or "").strip()
    if not place:
        raise HTTPException(status_code=400, detail="place_name required")
    result = suggest_fast_food_orders(
        plan,
        place,
        request.slot or "dinner",
        request.remaining,
        request.model,
    )
    return {"status": "success", "suggestion": result}


@router.post("/{plan_id}/pause")
async def pause_nutrition_plan(plan_id: str, user_id: str = Depends(get_user_id)):
    plan = _store(user_id).set_status(plan_id, STATUS_PAUSED)
    if not plan:
        raise HTTPException(status_code=404, detail="Nutrition plan not found")
    return {"status": "success", "plan": plan}


@router.post("/{plan_id}/resume")
async def resume_nutrition_plan(plan_id: str, user_id: str = Depends(get_user_id)):
    plan = _store(user_id).set_status(plan_id, STATUS_ACTIVE)
    if not plan:
        raise HTTPException(status_code=404, detail="Nutrition plan not found")
    _sync_targets(user_id, plan)
    return {"status": "success", "plan": plan}


@router.post("/{plan_id}/end")
async def end_nutrition_plan(plan_id: str, user_id: str = Depends(get_user_id)):
    plan = _store(user_id).set_status(plan_id, STATUS_COMPLETED)
    if not plan:
        raise HTTPException(status_code=404, detail="Nutrition plan not found")
    return {"status": "success", "plan": plan}


@router.delete("/{plan_id}")
async def delete_nutrition_plan(plan_id: str, user_id: str = Depends(get_user_id)):
    if not _store(user_id).delete(plan_id):
        raise HTTPException(status_code=404, detail="Nutrition plan not found")
    return {"status": "success"}
