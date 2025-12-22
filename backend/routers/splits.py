from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime
from models import WorkoutSplit
from auth import get_user_id
from db import db

router = APIRouter(prefix="/api/splits", tags=["splits"])

@router.get("")
async def get_splits(user_id: str = Depends(get_user_id)):
    splits_ref = db.collection("users").document(user_id).collection("splits")
    splits = splits_ref.stream()
    return [{"id": split.id, **split.to_dict()} for split in splits]

@router.post("")
async def create_split(split: WorkoutSplit, user_id: str = Depends(get_user_id)):
    split_dict = split.dict(exclude={"id"})
    split_dict["created_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("splits").document()
    doc_ref.set(split_dict)
    return {"id": doc_ref.id, **split_dict}

@router.put("/{split_id}")
async def update_split(split_id: str, split: WorkoutSplit, user_id: str = Depends(get_user_id)):
    split_dict = split.dict(exclude={"id"})
    split_dict["updated_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("splits").document(split_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Split not found")
    doc_ref.update(split_dict)
    return {"id": split_id, **split_dict}

@router.delete("/{split_id}")
async def delete_split(split_id: str, user_id: str = Depends(get_user_id)):
    doc_ref = db.collection("users").document(user_id).collection("splits").document(split_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Split not found")
    doc_ref.delete()
    return {"message": "Split deleted"}

