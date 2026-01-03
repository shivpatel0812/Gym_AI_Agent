from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime
from models import SleepEntry
from auth import get_user_id
from db import db

router = APIRouter(prefix="/api/sleep", tags=["sleep"])

@router.get("")
async def get_sleep_entries(user_id: str = Depends(get_user_id), date_filter: Optional[str] = Query(None)):
    sleep_ref = db.collection("users").document(user_id).collection("sleep")
    if date_filter:
        sleep_entries = sleep_ref.where("date", "==", date_filter).stream()
    else:
        sleep_entries = list(sleep_ref.order_by("date").stream())
        sleep_entries.reverse()
    return [{"id": entry.id, **entry.to_dict()} for entry in sleep_entries]

@router.post("")
async def create_sleep_entry(sleep: SleepEntry, user_id: str = Depends(get_user_id)):
    sleep_dict = sleep.dict(exclude={"id"})
    sleep_dict["created_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("sleep").document()
    doc_ref.set(sleep_dict)
    return {"id": doc_ref.id, **sleep_dict}

@router.put("/{sleep_id}")
async def update_sleep_entry(sleep_id: str, sleep: SleepEntry, user_id: str = Depends(get_user_id)):
    sleep_dict = sleep.dict(exclude={"id"})
    sleep_dict["updated_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("sleep").document(sleep_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Sleep entry not found")
    doc_ref.update(sleep_dict)
    return {"id": sleep_id, **sleep_dict}

@router.delete("/{sleep_id}")
async def delete_sleep_entry(sleep_id: str, user_id: str = Depends(get_user_id)):
    doc_ref = db.collection("users").document(user_id).collection("sleep").document(sleep_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Sleep entry not found")
    doc_ref.delete()
    return {"message": "Sleep entry deleted"}

