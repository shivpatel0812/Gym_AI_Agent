from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime
from models import WorkoutSession
from auth import get_user_id
from db import db

router = APIRouter(prefix="/api/workout-sessions", tags=["workout-sessions"])

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
    session_dict = session.dict(exclude={"id"})
    session_dict["created_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("workout_sessions").document()
    doc_ref.set(session_dict)
    return {"id": doc_ref.id, **session_dict}

@router.put("/{session_id}")
async def update_workout_session(session_id: str, session: WorkoutSession, user_id: str = Depends(get_user_id)):
    session_dict = session.dict(exclude={"id"})
    session_dict["updated_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("workout_sessions").document(session_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Workout session not found")
    doc_ref.update(session_dict)
    return {"id": session_id, **session_dict}

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
    user_id: str = Depends(get_user_id)
):
    """
    Get the most recent workout session that contains a specific exercise.
    Returns the session date and the exercise details (sets, reps, weight).
    """
    sessions_ref = db.collection("users").document(user_id).collection("workout_sessions")
    all_sessions = list(sessions_ref.stream())
    
    # Find sessions containing this exercise, sorted by date (most recent first)
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
                    "exercise_data": exercise,  # Contains sets, reps, weight, etc.
                })
                break  # Found it in this session, move to next session
    
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
    
    return {
        "max_weight": max_weight,
        "max_reps": max_reps,
        "max_volume": max_volume,
        "max_time": max_time,
        "max_speed": max_speed,
        "best_session": max_session,  # Session where the max was achieved
    }

