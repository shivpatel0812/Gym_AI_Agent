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


class NutritionTargetsRequest(BaseModel):
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fats: Optional[float] = None
    fiber: Optional[float] = None
    water: Optional[float] = None


PROFILE_KEEP_KEYS = ("created_at", "top_lifts", "top_lifts_updated", "nutrition_targets")


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


@router.get("/nutrition-targets")
async def get_nutrition_targets(user_id: str = Depends(get_user_id)):
    doc_ref = (
        db.collection("users")
        .document(user_id)
        .collection("user_profile")
        .document("profile")
    )
    doc = doc_ref.get()
    data = doc.to_dict() if doc.exists else {}
    return data.get("nutrition_targets") or {}


@router.put("/nutrition-targets")
async def update_nutrition_targets(
    payload: NutritionTargetsRequest,
    user_id: str = Depends(get_user_id),
):
    values = {k: v for k, v in payload.dict().items() if v is not None}
    for key, value in values.items():
        if not isinstance(value, (int, float)) or value < 0 or value > 20000:
            raise HTTPException(status_code=422, detail=f"Invalid {key} target")
    doc_ref = (
        db.collection("users")
        .document(user_id)
        .collection("user_profile")
        .document("profile")
    )
    existing_doc = doc_ref.get()
    existing = existing_doc.to_dict() if existing_doc.exists else {}
    merged = {**(existing.get("nutrition_targets") or {}), **values}
    doc_ref.set(
        {
            "nutrition_targets": merged,
            "updated_at": datetime.now().isoformat(),
        },
        merge=True,
    )
    return merged

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
        existing_data = existing_doc.to_dict() or {}
        for keep in PROFILE_KEEP_KEYS:
            if keep in existing_data and profile_dict.get(keep) is None:
                profile_dict[keep] = existing_data[keep]
        if "created_at" in existing_data:
            profile_dict["created_at"] = existing_data["created_at"]
    else:
        profile_dict["created_at"] = datetime.now().isoformat()
    doc_ref.set(profile_dict)
    return {"id": doc_ref.id, **profile_dict}

