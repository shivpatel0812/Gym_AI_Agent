from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime
from models import BodyFeeling
from auth import get_user_id
from db import db

router = APIRouter(prefix="/api/body-feelings", tags=["body-feelings"])

@router.get("")
async def get_body_feelings(user_id: str = Depends(get_user_id), date_filter: Optional[str] = Query(None)):
    feelings_ref = db.collection("users").document(user_id).collection("body_feelings")
    if date_filter:
        feelings = feelings_ref.where("date", "==", date_filter).stream()
    else:
        feelings = list(feelings_ref.order_by("date").stream())
        feelings.reverse()
    return [{"id": feeling.id, **feeling.to_dict()} for feeling in feelings]

@router.post("")
async def create_body_feeling(feeling: BodyFeeling, user_id: str = Depends(get_user_id)):
    feeling_dict = feeling.dict(exclude={"id"})
    feeling_dict["created_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("body_feelings").document()
    doc_ref.set(feeling_dict)
    return {"id": doc_ref.id, **feeling_dict}

@router.put("/{feeling_id}")
async def update_body_feeling(feeling_id: str, feeling: BodyFeeling, user_id: str = Depends(get_user_id)):
    feeling_dict = feeling.dict(exclude={"id"})
    feeling_dict["updated_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("body_feelings").document(feeling_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Body feeling not found")
    doc_ref.update(feeling_dict)
    return {"id": feeling_id, **feeling_dict}

@router.delete("/{feeling_id}")
async def delete_body_feeling(feeling_id: str, user_id: str = Depends(get_user_id)):
    doc_ref = db.collection("users").document(user_id).collection("body_feelings").document(feeling_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Body feeling not found")
    doc_ref.delete()
    return {"message": "Body feeling deleted"}

