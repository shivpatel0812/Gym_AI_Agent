from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime
from models import StressEntry
from auth import get_user_id
from db import db

router = APIRouter(prefix="/api/stress", tags=["stress"])

@router.get("")
async def get_stress_entries(user_id: str = Depends(get_user_id), date_filter: Optional[str] = Query(None)):
    stress_ref = db.collection("users").document(user_id).collection("stress")
    if date_filter:
        stress_entries = stress_ref.where("date", "==", date_filter).stream()
    else:
        stress_entries = list(stress_ref.order_by("date").stream())
        stress_entries.reverse()
    return [{"id": entry.id, **entry.to_dict()} for entry in stress_entries]

@router.post("")
async def create_stress_entry(stress: StressEntry, user_id: str = Depends(get_user_id)):
    stress_dict = stress.dict(exclude={"id"})
    stress_dict["created_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("stress").document()
    doc_ref.set(stress_dict)
    return {"id": doc_ref.id, **stress_dict}

@router.put("/{stress_id}")
async def update_stress_entry(stress_id: str, stress: StressEntry, user_id: str = Depends(get_user_id)):
    stress_dict = stress.dict(exclude={"id"})
    stress_dict["updated_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("stress").document(stress_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Stress entry not found")
    doc_ref.update(stress_dict)
    return {"id": stress_id, **stress_dict}

@router.delete("/{stress_id}")
async def delete_stress_entry(stress_id: str, user_id: str = Depends(get_user_id)):
    doc_ref = db.collection("users").document(user_id).collection("stress").document(stress_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Stress entry not found")
    doc_ref.delete()
    return {"message": "Stress entry deleted"}

