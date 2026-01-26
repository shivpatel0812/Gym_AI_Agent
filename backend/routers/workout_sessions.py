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

