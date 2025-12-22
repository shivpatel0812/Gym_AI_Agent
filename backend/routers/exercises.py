from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime
from models import Exercise
from auth import get_user_id
from db import db

router = APIRouter(prefix="/api/exercises", tags=["exercises"])

@router.get("")
async def get_exercises(user_id: str = Depends(get_user_id)):
    exercises_ref = db.collection("users").document(user_id).collection("exercises")
    exercises = exercises_ref.stream()
    return [{"id": ex.id, **ex.to_dict()} for ex in exercises]

@router.post("")
async def create_exercise(exercise: Exercise, user_id: str = Depends(get_user_id)):
    exercise_dict = exercise.dict(exclude={"id"})
    exercise_dict["created_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("exercises").document()
    doc_ref.set(exercise_dict)
    return {"id": doc_ref.id, **exercise_dict}

@router.put("/{exercise_id}")
async def update_exercise(exercise_id: str, exercise: Exercise, user_id: str = Depends(get_user_id)):
    exercise_dict = exercise.dict(exclude={"id"})
    exercise_dict["updated_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("exercises").document(exercise_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Exercise not found")
    doc_ref.update(exercise_dict)
    return {"id": exercise_id, **exercise_dict}

@router.delete("/{exercise_id}")
async def delete_exercise(exercise_id: str, user_id: str = Depends(get_user_id)):
    doc_ref = db.collection("users").document(user_id).collection("exercises").document(exercise_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Exercise not found")
    doc_ref.delete()
    return {"message": "Exercise deleted"}

@router.get("/search")
async def search_exercises(query: str = Query(...), user_id: str = Depends(get_user_id)):
    exercises_ref = db.collection("users").document(user_id).collection("exercises")
    exercises = exercises_ref.stream()
    results = []
    query_lower = query.lower()
    for ex in exercises:
        ex_data = ex.to_dict()
        if query_lower in ex_data.get("name", "").lower():
            results.append({"id": ex.id, **ex_data})
    return results

