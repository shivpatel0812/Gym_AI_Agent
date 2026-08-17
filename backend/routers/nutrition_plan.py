"""
Nutrition Plan API.

Create flow: POST /propose (draft from questionnaire) -> review -> POST /{id}/activate.
Plan page: GET /active, PATCH /{id} for simple edits.
Today: GET /today-guidance from logged intake + plan, no extra questionnaire.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List, Any
from datetime import datetime
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
    preferences: Optional[dict] = None
    conversation_id: Optional[str] = None


class UpdateNutritionPlanRequest(BaseModel):
    goal: Optional[str] = None
    goal_detail: Optional[str] = None
    strategy: Optional[str] = None
    typical_day_notes: Optional[str] = None
    targets: Optional[dict] = None
    meal_anchors: Optional[List[dict]] = None
    flexible_meals: Optional[List[dict]] = None
    preferences: Optional[dict] = None
    food_priorities: Optional[List[str]] = None


def _store(user_id: str) -> NutritionPlanStore:
    return NutritionPlanStore(db, user_id)


def _builder() -> NutritionPlanBuilder:
    return NutritionPlanBuilder(api_key=os.getenv("OPENAI_API_KEY"))


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


def _logged_foods(user_id: str, date: str) -> List[dict]:
    docs = (
        db.collection("users")
        .document(user_id)
        .collection("macros")
        .where("date", "==", date)
        .stream()
    )
    foods = []
    for doc in docs:
        data = doc.to_dict() or {}
        items = data.get("food_items") or []
        if items:
            foods.extend(items)
    return foods


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
        "preferences": request.preferences or {},
        "conversation_notes": notes,
    }
    result = _builder().build_plan(
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
            "meal_anchors", "flexible_meals", "preferences", "food_priorities",
        )
        if k in validated
    }
    updated = store.update(plan_id, to_write)
    if updated and updated.get("status") == STATUS_ACTIVE:
        _sync_targets(user_id, updated)
    return {"status": "success", "plan": updated}


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
