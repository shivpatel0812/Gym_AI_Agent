from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime
from models import PhysicalActivity
from auth import get_user_id
from db import db

router = APIRouter(prefix="/api/physical-activities", tags=["physical-activities"])

@router.get("")
async def get_physical_activities(user_id: str = Depends(get_user_id), date_filter: Optional[str] = Query(None)):
    activities_ref = db.collection("users").document(user_id).collection("physical_activities")
    if date_filter:
        activities = activities_ref.where("date", "==", date_filter).stream()
    else:
        activities = list(activities_ref.order_by("date").stream())
        activities.reverse()
    return [{"id": activity.id, **activity.to_dict()} for activity in activities]

@router.post("")
async def create_physical_activity(activity: PhysicalActivity, user_id: str = Depends(get_user_id)):
    activity_dict = activity.dict(exclude={"id"})
    activity_dict["created_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("physical_activities").document()
    doc_ref.set(activity_dict)
    return {"id": doc_ref.id, **activity_dict}

@router.put("/{activity_id}")
async def update_physical_activity(activity_id: str, activity: PhysicalActivity, user_id: str = Depends(get_user_id)):
    activity_dict = activity.dict(exclude={"id"})
    activity_dict["updated_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("physical_activities").document(activity_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Physical activity not found")
    doc_ref.update(activity_dict)
    return {"id": activity_id, **activity_dict}

@router.delete("/{activity_id}")
async def delete_physical_activity(activity_id: str, user_id: str = Depends(get_user_id)):
    doc_ref = db.collection("users").document(user_id).collection("physical_activities").document(activity_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Physical activity not found")
    doc_ref.delete()
    return {"message": "Physical activity deleted"}

