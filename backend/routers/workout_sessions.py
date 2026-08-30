from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional, List, Dict
from datetime import datetime, timedelta, timezone
from time import perf_counter
from firebase_admin import firestore
from pydantic import BaseModel
import os

from models import WorkoutSession
from auth import get_user_id
from db import db
from ai_analysis.workout_recommender import WorkoutRecommender
from ai_analysis.workout_recommender.next_set_recommender import NextSetRecommender
from ai_analysis.workout_recommender.recommendation_metrics import (
    record_recommendation_metrics,
    summarize_recommendation_metrics,
)

router = APIRouter(prefix="/api/workout-sessions", tags=["workout-sessions"])


class ExerciseRecommendationRequest(BaseModel):
    exercise_name: str
    split_name: Optional[str] = None
    split_day: Optional[str] = None
    position_in_workout: Optional[int] = None
    current_workout_exercises: Optional[List[Dict]] = None  # Exercises already done in this workout
    plan_target_sets: Optional[int] = None
    plan_target_reps: Optional[int] = None
    plan_notes: Optional[str] = None
    day_intensity: Optional[str] = None  # "heavy", "light", "normal"
    exclude_session_id: Optional[str] = None


class NextSetRecommendationRequest(BaseModel):
    exercise_name: str
    completed_sets: List[Dict]
    remaining_sets: List[Dict]
    current_workout_exercises: Optional[List[Dict]] = None
    base_recommendation: Optional[Dict] = None
    request_id: Optional[str] = None
    previous_request_id: Optional[str] = None


class RecommendationFeedbackRequest(BaseModel):
    request_id: str
    accepted: bool
    reason: Optional[str] = None

# ============== AI RECOMMENDATION ENDPOINTS (Must come before parameterized routes) ==============

def _get_recommender(user_id: str) -> WorkoutRecommender:
    """Helper to create WorkoutRecommender instance."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    return WorkoutRecommender(db, user_id, api_key)


@router.get("/ai-summary")
async def get_workout_ai_summary(
    user_id: str = Depends(get_user_id),
    force_refresh: bool = Query(False, description="Force regeneration of summary")
):
    """
    Get the workout AI summary for the user.
    This summary is used to generate per-exercise recommendations.
    Auto-generates on first call or when refresh is needed (weekly).
    """
    try:
        recommender = _get_recommender(user_id)
        summary = recommender.get_or_create_summary(force_refresh=force_refresh)
        return summary
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"Error generating summary: {error_trace}")
        raise HTTPException(status_code=500, detail=f"Error generating summary: {str(e)}")


@router.post("/ai-summary/refresh")
async def refresh_workout_ai_summary(user_id: str = Depends(get_user_id)):
    """
    Force refresh the workout AI summary.
    Use this when you want to regenerate the summary before the weekly refresh.
    Note: This triggers the expensive full analysis call.
    """
    try:
        recommender = _get_recommender(user_id)
        summary = recommender.get_or_create_summary(force_refresh=True)
        return summary
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error refreshing summary: {str(e)}")


@router.post("/ai-recommendation/{exercise_id}")
async def get_exercise_ai_recommendation(
    exercise_id: str,
    request: ExerciseRecommendationRequest,
    user_id: str = Depends(get_user_id)
):
    """
    Get AI-powered recommendation for a specific exercise.
    Returns suggested sets, reps, and weight based on:
    - User's workout history for this exercise
    - User's fitness goals
    - Progressive overload principles
    - Position in workout (if provided)
    
    This endpoint is cheap to call (uses mini model) after the initial summary is created.
    """
    try:
        recommender = _get_recommender(user_id)
        recommendation = recommender.get_exercise_recommendation(
            exercise_id=exercise_id,
            exercise_name=request.exercise_name,
            split_name=request.split_name,
            split_day=request.split_day,
            position_in_workout=request.position_in_workout,
            current_workout_exercises=request.current_workout_exercises,
            plan_target_sets=request.plan_target_sets,
            plan_target_reps=request.plan_target_reps,
            plan_notes=request.plan_notes,
            day_intensity=request.day_intensity,
            exclude_session_id=request.exclude_session_id,
        )
        return recommendation
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"Error generating recommendation: {error_trace}")
        raise HTTPException(status_code=500, detail=f"Error generating recommendation: {str(e)}")


@router.post("/ai-recommendation/{exercise_id}/next-set")
async def get_next_set_ai_recommendation(
    exercise_id: str,
    request: NextSetRecommendationRequest,
    user_id: str = Depends(get_user_id),
):
    """Recommend the next unfinished set after the user completes a set."""
    try:
        recommender = _get_recommender(user_id)
        engine = NextSetRecommender(recommender.client, recommender.model)
        event_ref = None
        safe_request_id = request.request_id and len(request.request_id) <= 128 and all(
            char.isalnum() or char in "-_" for char in request.request_id
        )
        if safe_request_id:
            event_ref = (
                db.collection("users").document(user_id)
                .collection("workout_recommendation_events").document(request.request_id)
            )
            existing = event_ref.get()
            if existing.exists and existing.to_dict().get("response"):
                return existing.to_dict()["response"]
        learning_ref = (
            db.collection("users").document(user_id)
            .collection("workout_recommendation_learning").document(exercise_id)
        )
        learning_doc = learning_ref.get()
        learning = learning_doc.to_dict() if learning_doc.exists else {}

        safe_previous_id = request.previous_request_id and len(request.previous_request_id) <= 128 and all(
            char.isalnum() or char in "-_" for char in request.previous_request_id
        )
        if safe_previous_id and request.completed_sets:
            previous_ref = (
                db.collection("users").document(user_id)
                .collection("workout_recommendation_events").document(request.previous_request_id)
            )
            previous_doc = previous_ref.get()
            if previous_doc.exists:
                previous_response = previous_doc.to_dict().get("response") or {}
                previous_target = previous_response.get("next_set") or {}
                actual = request.completed_sets[-1]
                try:
                    target_weight = float(previous_target.get("weight") or 0)
                    actual_weight = float(actual.get("weight") or 0)
                    manual_change = target_weight > 0 and abs(actual_weight - target_weight) > 0.01
                    rep_error = int(actual.get("reps") or 0) - int(
                        previous_target.get("preferred_reps") or previous_target.get("reps") or 0
                    )
                    if not manual_change:
                        observations = int(learning.get("observations") or 0) + 1
                        rep_error_total = float(learning.get("rep_error_total") or 0) + rep_error
                        learning.update({
                            "observations": observations,
                            "rep_error_total": rep_error_total,
                            "average_rep_error": round(rep_error_total / observations, 3),
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        })
                        learning_ref.set({
                            "observations": firestore.Increment(1),
                            "rep_error_total": firestore.Increment(rep_error),
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        }, merge=True)
                    previous_ref.set({
                        "feedback": {
                            "accepted": not manual_change,
                            "reason": "load_changed" if manual_change else "next_set_completed",
                            "recorded_at": datetime.now(timezone.utc).isoformat(),
                        }
                    }, merge=True)
                    metric_ref = (
                        db.collection("users").document(user_id)
                        .collection("workout_recommendation_metrics")
                        .document(datetime.now(timezone.utc).strftime("%Y-%m-%d"))
                    )
                    metric_ref.set({
                        "outcomes": firestore.Increment(1),
                        "missed_targets": firestore.Increment(1 if rep_error < 0 else 0),
                        "failed_sets": firestore.Increment(
                            1 if str(actual.get("difficulty") or "").lower() == "failed" else 0
                        ),
                        "manual_changes": firestore.Increment(1 if manual_change else 0),
                    }, merge=True)
                except (TypeError, ValueError, ZeroDivisionError):
                    pass
        exercise_record = None
        try:
            doc = (
                db.collection("users").document(user_id).collection("exercises")
                .document(exercise_id).get()
            )
            if doc.exists:
                exercise_record = doc.to_dict()
        except Exception:
            pass
        started = perf_counter()
        result = engine.recommend(
            exercise_id=exercise_id,
            exercise_name=request.exercise_name,
            completed_sets=request.completed_sets,
            remaining_sets=request.remaining_sets,
            current_workout_exercises=request.current_workout_exercises,
            base_recommendation=request.base_recommendation,
            exercise_record=exercise_record,
            request_id=request.request_id,
            learned_context={
                "observations": int(learning.get("observations") or 0),
                "average_rep_error": float(learning.get("average_rep_error") or 0),
            },
        )
        latency_ms = round((perf_counter() - started) * 1000)
        record_recommendation_metrics(db, user_id, result, latency_ms)
        if event_ref is not None:
            event_ref.set({
                "exercise_id": exercise_id,
                "exercise_name": request.exercise_name,
                "completed_set": request.completed_sets[-1] if request.completed_sets else None,
                "response": result,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "expires_at": datetime.now(timezone.utc) + timedelta(days=90),
            })
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating next-set recommendation: {str(e)}")


@router.get("/ai-recommendation-metrics")
async def get_recommendation_metrics(user_id: str = Depends(get_user_id)):
    """Return the authenticated user's recent recommendation health metrics."""
    docs = (
        db.collection("users").document(user_id)
        .collection("workout_recommendation_metrics")
        .order_by("date", direction=firestore.Query.DESCENDING).limit(30).stream()
    )
    return summarize_recommendation_metrics(docs)


@router.post("/ai-recommendation-feedback")
async def save_recommendation_feedback(
    request: RecommendationFeedbackRequest,
    user_id: str = Depends(get_user_id),
):
    if len(request.request_id) > 128 or not all(
        char.isalnum() or char in "-_" for char in request.request_id
    ):
        raise HTTPException(status_code=400, detail="Invalid request id")
    ref = (
        db.collection("users").document(user_id)
        .collection("workout_recommendation_events").document(request.request_id)
    )
    ref.set({
        "feedback": {
            "accepted": request.accepted,
            "reason": request.reason,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        }
    }, merge=True)
    metric_ref = (
        db.collection("users").document(user_id)
        .collection("workout_recommendation_metrics")
        .document(datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    )
    metric_ref.set({
        "feedback_events": firestore.Increment(1),
        "rejections": firestore.Increment(0 if request.accepted else 1),
    }, merge=True)
    return {"status": "success"}


@router.get("/suggested-order/{split_name}")
async def get_suggested_exercise_order(
    split_name: str,
    split_day: Optional[str] = Query(None, description="Specific day within the split"),
    user_id: str = Depends(get_user_id)
):
    """
    Get the suggested exercise order for a split based on historical patterns.
    Returns list of exercise IDs in the typical order the user performs them.
    """
    try:
        recommender = _get_recommender(user_id)
        exercise_order = recommender.get_suggested_exercise_order(
            split_name=split_name,
            split_day=split_day or ""
        )
        return {"split_name": split_name, "split_day": split_day, "exercise_order": exercise_order}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error getting exercise order: {str(e)}")


@router.get("/ai-recommendation-check")
async def check_ai_recommendation_status(user_id: str = Depends(get_user_id)):
    """
    Check the status of AI recommendations for this user.
    Returns whether the summary exists, when it was last updated, and if it needs refresh.
    Use this to determine if the first-time setup is needed.
    """
    try:
        summary_ref = db.collection("users").document(user_id).collection("workout_ai_summary").document("current")
        summary_doc = summary_ref.get()
        
        if not summary_doc.exists:
            # Check how many workout sessions exist
            sessions_ref = db.collection("users").document(user_id).collection("workout_sessions")
            sessions_count = len(list(sessions_ref.stream()))
            
            return {
                "has_summary": False,
                "needs_initial_setup": sessions_count >= 1,
                "sessions_logged": sessions_count,
                "sessions_needed": 1,
                "message": "Need at least 1 workout session before recommendations can be generated" if sessions_count < 1 else "Ready to generate recommendations"
            }
        
        summary_data = summary_doc.to_dict()
        last_updated = summary_data.get("last_updated")
        next_refresh = summary_data.get("next_refresh")
        
        from datetime import datetime
        needs_refresh = False
        if next_refresh:
            try:
                refresh_date = datetime.fromisoformat(next_refresh)
                needs_refresh = datetime.now() >= refresh_date
            except:
                needs_refresh = True
        
        return {
            "has_summary": True,
            "needs_initial_setup": False,
            "last_updated": last_updated,
            "next_refresh": next_refresh,
            "needs_refresh": needs_refresh,
            "total_sessions_analyzed": summary_data.get("total_sessions_analyzed", 0)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error checking recommendation status: {str(e)}")


# ============== STANDARD WORKOUT SESSION ENDPOINTS ==============

@router.get("")
async def get_workout_sessions(user_id: str = Depends(get_user_id), date_filter: Optional[str] = Query(None)):
    sessions_ref = db.collection("users").document(user_id).collection("workout_sessions")
    if date_filter:
        sessions = sessions_ref.where("date", "==", date_filter).stream()
        sessions_list = list(sessions)
        # Sort by created_at descending (most recent first) if available, otherwise by date
        sessions_list.sort(key=lambda s: s.to_dict().get("created_at", s.to_dict().get("date", "")), reverse=True)
        return [{"id": session.id, **session.to_dict()} for session in sessions_list]
    else:
        # Fetch all sessions and sort by date descending, then by created_at descending
        sessions = list(sessions_ref.stream())
        # Sort by date descending, then by created_at descending for same dates
        sessions.sort(key=lambda s: (
            s.to_dict().get("date", ""),
            s.to_dict().get("created_at", "")
        ), reverse=True)
    return [{"id": session.id, **session.to_dict()} for session in sessions]

@router.post("")
async def create_workout_session(session: WorkoutSession, user_id: str = Depends(get_user_id)):
    try:
        session_dict = session.model_dump(exclude={"id"}) if hasattr(session, "model_dump") else session.dict(exclude={"id"})
        session_dict["created_at"] = datetime.now().isoformat()
        doc_ref = db.collection("users").document(user_id).collection("workout_sessions").document()
        doc_ref.set(session_dict)
        return {"id": doc_ref.id, **session_dict}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving workout session: {str(e)}")

@router.put("/{session_id}")
async def update_workout_session(session_id: str, session: WorkoutSession, user_id: str = Depends(get_user_id)):
    try:
        session_dict = session.model_dump(exclude={"id"}) if hasattr(session, "model_dump") else session.dict(exclude={"id"})
        session_dict["updated_at"] = datetime.now().isoformat()
        doc_ref = db.collection("users").document(user_id).collection("workout_sessions").document(session_id)
        # merge write so a race with first-time auto-save doesn't 404
        doc_ref.set(session_dict, merge=True)
        return {"id": session_id, **session_dict}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating workout session: {str(e)}")

@router.delete("/{session_id}")
async def delete_workout_session(session_id: str, user_id: str = Depends(get_user_id)):
    doc_ref = db.collection("users").document(user_id).collection("workout_sessions").document(session_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Workout session not found")
    doc_ref.delete()
    return {"message": "Workout session deleted"}

@router.get("/last-exercise/{exercise_id}")
async def get_last_exercise_session(
    exercise_id: str,
    user_id: str = Depends(get_user_id),
    exclude_session_id: Optional[str] = Query(None),
):
    """
    Get the most recent workout session that contains a specific exercise.
    Excludes the in-progress session so "last" is not the workout being edited.
    """
    sessions_ref = db.collection("users").document(user_id).collection("workout_sessions")
    all_sessions = list(sessions_ref.stream())
    
    matching_sessions = []
    for session in all_sessions:
        if exclude_session_id and session.id == exclude_session_id:
            continue
        session_data = session.to_dict()
        exercises = session_data.get("exercises", [])
        
        for exercise in exercises:
            if exercise.get("exercise_id") == exercise_id:
                matching_sessions.append({
                    "session_id": session.id,
                    "date": session_data.get("date"),
                    "created_at": session_data.get("created_at"),
                    "exercise_data": exercise,
                })
                break
    
    if not matching_sessions:
        return None
    
    # Sort by date descending (most recent first), then by created_at
    matching_sessions.sort(
        key=lambda x: (
            x.get("date", "") or x.get("created_at", ""),
            x.get("created_at", "")
        ), 
        reverse=True
    )
    
    return matching_sessions[0]  # Return the most recent one

@router.get("/max-exercise/{exercise_id}")
async def get_max_exercise_session(
    exercise_id: str, 
    user_id: str = Depends(get_user_id)
):
    """
    Get the all-time maximum performance for a specific exercise.
    For strength: returns max weight, max reps, max volume (weight * reps).
    For cardio: returns max time, max speed.
    """
    sessions_ref = db.collection("users").document(user_id).collection("workout_sessions")
    all_sessions = list(sessions_ref.stream())
    
    # Find all sessions containing this exercise
    matching_sessions = []
    for session in all_sessions:
        session_data = session.to_dict()
        exercises = session_data.get("exercises", [])
        
        # Check if this exercise is in the session
        for exercise in exercises:
            if exercise.get("exercise_id") == exercise_id:
                matching_sessions.append({
                    "session_id": session.id,
                    "date": session_data.get("date"),
                    "created_at": session_data.get("created_at"),
                    "exercise_data": exercise,
                })
                break
    
    if not matching_sessions:
        return None
    
    # Calculate max values
    max_weight = None
    max_reps = None
    max_volume = None
    max_time = None
    max_speed = None
    max_session = None
    
    # Track max per set number: {set_number: {weight, reps, volume, session}}
    max_per_set: dict = {}
    
    for session_info in matching_sessions:
        exercise_data = session_info["exercise_data"]
        
        # Check if it's cardio
        if exercise_data.get("time") is not None or exercise_data.get("speed") is not None:
            time = exercise_data.get("time")
            speed = exercise_data.get("speed")
            
            if time is not None and (max_time is None or time > max_time):
                max_time = time
                max_session = session_info
            
            if speed is not None and (max_speed is None or speed > max_speed):
                max_speed = speed
                if max_session is None:
                    max_session = session_info
        else:
            # Strength exercise
            sets = exercise_data.get("sets", [])
            if isinstance(sets, list):
                for set_data in sets:
                    set_number = set_data.get("set_number")
                    weight = set_data.get("weight")
                    reps = set_data.get("reps", 0)
                    
                    if weight is not None:
                        if max_weight is None or weight > max_weight:
                            max_weight = weight
                            max_session = session_info
                        
                        volume = weight * reps
                        if max_volume is None or volume > max_volume:
                            max_volume = volume
                            if max_session is None:
                                max_session = session_info
                    
                    if reps > 0:
                        if max_reps is None or reps > max_reps:
                            max_reps = reps
                            if max_session is None:
                                max_session = session_info
                    
                    # Track max per set number
                    if set_number is not None:
                        if set_number not in max_per_set:
                            max_per_set[set_number] = {
                                "weight": weight,
                                "reps": reps,
                                "volume": weight * reps if weight and reps else None,
                                "session": session_info
                            }
                        else:
                            current = max_per_set[set_number]
                            # Update if this set has better volume (weight * reps)
                            current_volume = current.get("volume") or 0
                            new_volume = (weight * reps) if weight and reps else 0
                            
                            if new_volume > current_volume:
                                max_per_set[set_number] = {
                                    "weight": weight,
                                    "reps": reps,
                                    "volume": new_volume,
                                    "session": session_info
                                }
    
    # Format max_per_set for response
    max_per_set_formatted = {}
    for set_num, data in max_per_set.items():
        max_per_set_formatted[set_num] = {
            "weight": data.get("weight"),
            "reps": data.get("reps"),
            "volume": data.get("volume"),
        }
    
    return {
        "max_weight": max_weight,
        "max_reps": max_reps,
        "max_volume": max_volume,
        "max_time": max_time,
        "max_speed": max_speed,
        "best_session": max_session,  # Session where the max was achieved
        "max_per_set": max_per_set_formatted,  # Max for each set number
    }
