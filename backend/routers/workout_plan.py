from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel
import os

from models import WorkoutPlan, WorkoutSplit
from auth import get_user_id
from db import db
from ai_analysis.plan_generator import WorkoutPlanGenerator

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


@router.post("/generate")
async def generate_workout_plan(
    request: PlanGenerationRequest,
    user_id: str = Depends(get_user_id)
):
    """Generate a new AI workout plan from user preferences."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")

    try:
        # Fetch existing user profile
        profile_ref = db.collection("users").document(user_id).collection("user_profile")
        profile_docs = list(profile_ref.stream())
        profile_data = profile_docs[0].to_dict() if profile_docs else {}

        # Update profile with new equipment/days preferences
        if profile_docs:
            profile_ref.document(profile_docs[0].id).update({
                "available_equipment": request.available_equipment,
                "preferred_workout_days": request.preferred_workout_days,
                "preferred_workout_frequency": request.preferred_workout_frequency,
                "preferred_session_length": request.preferred_session_length,
                "experience_level": request.experience_level,
                "primary_goal": request.primary_goal,
                "secondary_goals": request.secondary_goals,
            })

        # Generate the plan
        generator = WorkoutPlanGenerator(api_key=api_key)
        plan_data = generator.generate_plan(request.dict(), profile_data)

        # Deactivate existing active plans
        plans_ref = db.collection("users").document(user_id).collection("workout_plans")
        existing_plans = plans_ref.where("is_active", "==", True).stream()
        for existing in existing_plans:
            plans_ref.document(existing.id).update({"is_active": False, "updated_at": datetime.now().isoformat()})

        # Store the plan
        plan_data["is_active"] = True
        plan_data["created_at"] = datetime.now().isoformat()
        plan_data["updated_at"] = datetime.now().isoformat()

        plan_ref = plans_ref.document()
        plan_ref.set(plan_data)
        plan_data["id"] = plan_ref.id

        # Create a linked split in the existing splits collection
        split_days = []
        for day in plan_data.get("days", []):
            split_days.append(day.get("day_name", ""))

        split_data = {
            "name": plan_data.get("plan_name", "AI Workout Plan"),
            "days": split_days,
            "created_at": datetime.now().isoformat(),
            "is_ai_generated": True,
            "linked_plan_id": plan_ref.id,
        }
        split_ref = db.collection("users").document(user_id).collection("splits").document()
        split_ref.set(split_data)

        # Link the split back to the plan
        plan_ref.update({"linked_split_id": split_ref.id})
        plan_data["linked_split_id"] = split_ref.id

        return plan_data

    except Exception as e:
        import traceback
        print(f"Error generating plan: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error generating workout plan: {str(e)}")


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
        if session_data.get("split_day") == today_assignment or session_data.get("split_name") == plan_data.get("plan_name"):
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
    if linked_split_id:
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

    # Get user profile to rebuild the request
    profile_ref = db.collection("users").document(user_id).collection("user_profile")
    profile_docs = list(profile_ref.stream())
    profile_data = profile_docs[0].to_dict() if profile_docs else {}

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
    )

    return await generate_workout_plan(regen_request, user_id)
