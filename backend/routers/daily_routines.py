from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime
from models import DailyRoutine
from auth import get_user_id
from db import db

router = APIRouter(prefix="/api/daily-routines", tags=["daily-routines"])


def _col(user_id: str):
    return db.collection("users").document(user_id).collection("daily_routines")


@router.get("")
async def list_routines(user_id: str = Depends(get_user_id)):
    docs = list(_col(user_id).stream())
    rows = [{"id": doc.id, **doc.to_dict()} for doc in docs]
    rows.sort(key=lambda r: (r.get("sort_order") or 0, r.get("name") or ""))
    return rows


@router.post("")
async def create_routine(routine: DailyRoutine, user_id: str = Depends(get_user_id)):
    payload = routine.dict(exclude={"id"})
    payload["completed_dates"] = payload.get("completed_dates") or []
    payload["created_at"] = datetime.now().isoformat()
    doc_ref = _col(user_id).document()
    doc_ref.set(payload)
    return {"id": doc_ref.id, **payload}


@router.put("/{routine_id}")
async def update_routine(routine_id: str, routine: DailyRoutine, user_id: str = Depends(get_user_id)):
    payload = routine.dict(exclude={"id"})
    payload["updated_at"] = datetime.now().isoformat()
    if payload.get("completed_dates") is None:
        payload.pop("completed_dates", None)
    doc_ref = _col(user_id).document(routine_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Routine not found")
    doc_ref.update(payload)
    return {"id": routine_id, **(doc_ref.get().to_dict() or {}), **payload}


@router.post("/{routine_id}/toggle")
async def toggle_routine(routine_id: str, body: dict, user_id: str = Depends(get_user_id)):
    date = (body or {}).get("date")
    if not date:
        raise HTTPException(status_code=400, detail="date is required")
    doc_ref = _col(user_id).document(routine_id)
    snap = doc_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Routine not found")
    data = snap.to_dict() or {}
    dates = list(data.get("completed_dates") or [])
    if date in dates:
        dates = [d for d in dates if d != date]
    else:
        dates.append(date)
    doc_ref.update({"completed_dates": dates, "updated_at": datetime.now().isoformat()})
    return {"id": routine_id, **data, "completed_dates": dates}


@router.delete("/{routine_id}")
async def delete_routine(routine_id: str, user_id: str = Depends(get_user_id)):
    doc_ref = _col(user_id).document(routine_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Routine not found")
    doc_ref.delete()
    return {"message": "Routine deleted"}
