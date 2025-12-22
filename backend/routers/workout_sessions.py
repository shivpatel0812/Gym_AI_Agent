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
    else:
        sessions = list(sessions_ref.order_by("date").stream())
        sessions.reverse()
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

