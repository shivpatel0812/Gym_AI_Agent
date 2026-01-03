from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime
from models import HydrationEntry
from auth import get_user_id
from db import db

router = APIRouter(prefix="/api/hydration", tags=["hydration"])

@router.get("")
async def get_hydration_entries(user_id: str = Depends(get_user_id), date_filter: Optional[str] = Query(None)):
    hydration_ref = db.collection("users").document(user_id).collection("hydration")
    if date_filter:
        hydration_entries = hydration_ref.where("date", "==", date_filter).stream()
    else:
        hydration_entries = list(hydration_ref.order_by("date").stream())
        hydration_entries.reverse()
    return [{"id": entry.id, **entry.to_dict()} for entry in hydration_entries]

@router.post("")
async def create_hydration_entry(hydration: HydrationEntry, user_id: str = Depends(get_user_id)):
    hydration_dict = hydration.dict(exclude={"id"})
    hydration_dict["created_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("hydration").document()
    doc_ref.set(hydration_dict)
    return {"id": doc_ref.id, **hydration_dict}

@router.put("/{hydration_id}")
async def update_hydration_entry(hydration_id: str, hydration: HydrationEntry, user_id: str = Depends(get_user_id)):
    hydration_dict = hydration.dict(exclude={"id"})
    hydration_dict["updated_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("hydration").document(hydration_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Hydration entry not found")
    doc_ref.update(hydration_dict)
    return {"id": hydration_id, **hydration_dict}

@router.delete("/{hydration_id}")
async def delete_hydration_entry(hydration_id: str, user_id: str = Depends(get_user_id)):
    doc_ref = db.collection("users").document(user_id).collection("hydration").document(hydration_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Hydration entry not found")
    doc_ref.delete()
    return {"message": "Hydration entry deleted"}

