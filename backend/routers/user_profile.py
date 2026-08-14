from fastapi import APIRouter, HTTPException, Depends
from models import UserProfile, TopLiftEntry
from auth import get_user_id
from db import db
from datetime import datetime
from typing import Optional, Union
from pydantic import BaseModel

router = APIRouter(prefix="/api/user-profile", tags=["user-profile"])


class TopLiftsRequest(BaseModel):
    bench_press: Optional[Union[float, TopLiftEntry]] = None
    squat: Optional[Union[float, TopLiftEntry]] = None
    deadlift: Optional[Union[float, TopLiftEntry]] = None
    overhead_press: Optional[Union[float, TopLiftEntry]] = None
    barbell_row: Optional[Union[float, TopLiftEntry]] = None


def _clean_top_lifts(payload: TopLiftsRequest) -> dict:
    raw_values = payload.dict(exclude_none=True)
    values = {}
    invalid = []
    for name, value in raw_values.items():
        entry = {"weight": value} if isinstance(value, (int, float)) else value
        weight = entry.get("weight")
        reps = entry.get("reps")
        if (
            not isinstance(weight, (int, float))
            or weight <= 0
            or weight > 1000
            or (reps is not None and (reps < 1 or reps > 50))
        ):
            invalid.append(name)
            continue
        values[name] = entry
    if invalid:
        raise HTTPException(
            status_code=422,
            detail=(
                "Lift context requires 1-1000 lbs and, when provided, 1-50 reps: "
                f"{', '.join(invalid)}"
            ),
        )
    return values


@router.get("/top-lifts")
async def get_top_lifts(user_id: str = Depends(get_user_id)):
    doc_ref = (
        db.collection("users")
        .document(user_id)
        .collection("user_profile")
        .document("profile")
    )
    doc = doc_ref.get()
    data = doc.to_dict() if doc.exists else {}
    return {
        "top_lifts": data.get("top_lifts", {}),
        "top_lifts_updated": data.get("top_lifts_updated"),
    }


@router.put("/top-lifts")
async def update_top_lifts(
    payload: TopLiftsRequest,
    user_id: str = Depends(get_user_id),
):
    values = _clean_top_lifts(payload)
    updated_at = datetime.now().isoformat()
    doc_ref = (
        db.collection("users")
        .document(user_id)
        .collection("user_profile")
        .document("profile")
    )
    doc_ref.set(
        {
            "top_lifts": values,
            "top_lifts_updated": updated_at,
            "updated_at": updated_at,
        },
        merge=True,
    )
    return {"top_lifts": values, "top_lifts_updated": updated_at}

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

