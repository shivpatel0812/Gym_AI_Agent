from fastapi import APIRouter, HTTPException, Depends
from models import UserProfile
from auth import get_user_id
from db import db
from datetime import datetime

router = APIRouter(prefix="/api/user-profile", tags=["user-profile"])

@router.get("")
async def get_user_profile(user_id: str = Depends(get_user_id)):
    doc_ref = db.collection("users").document(user_id).collection("user_profile").document("profile")
    doc = doc_ref.get()
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}

@router.post("")
async def create_user_profile(profile: UserProfile, user_id: str = Depends(get_user_id)):
    profile_dict = profile.dict(exclude={"id"})
    profile_dict["created_at"] = datetime.now().isoformat()
    profile_dict["updated_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("user_profile").document("profile")
    doc_ref.set(profile_dict)
    return {"id": doc_ref.id, **profile_dict}

@router.put("")
async def update_user_profile(profile: UserProfile, user_id: str = Depends(get_user_id)):
    profile_dict = profile.dict(exclude={"id"})
    profile_dict["updated_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("user_profile").document("profile")
    existing_doc = doc_ref.get()
    if existing_doc.exists:
        existing_data = existing_doc.to_dict()
        if "created_at" in existing_data:
            profile_dict["created_at"] = existing_data["created_at"]
    else:
        profile_dict["created_at"] = datetime.now().isoformat()
    doc_ref.set(profile_dict)
    return {"id": doc_ref.id, **profile_dict}

