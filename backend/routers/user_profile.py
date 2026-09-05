from fastapi import APIRouter, HTTPException, Depends
from models import UserProfile, TopLiftEntry
from auth import get_user_id
from db import db
from user_time import get_timezone, set_timezone
from datetime import datetime
from typing import Optional, Union
from pydantic import BaseModel
import math
from nutrition.plan_store import NutritionPlanStore
from nutrition.targets import resolve_targets

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


PROFILE_KEEP_KEYS = (
    "created_at", "top_lifts", "top_lifts_updated", "nutrition_targets",
    # Reported by the device, not edited in the profile form — a full profile
    # save must not wipe it and send the server back to guessing in UTC.
    "timezone", "timezone_updated_at",
)


class TimezoneRequest(BaseModel):
    """IANA zone name from the device, e.g. "America/New_York"."""
    timezone: str


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
    plan = NutritionPlanStore(db, user_id).get_active() or {}
    return resolve_targets(data.get("nutrition_targets"), plan.get("targets"))


@router.put("/nutrition-targets")
async def update_nutrition_targets(
    payload: NutritionTargetsRequest,
    user_id: str = Depends(get_user_id),
):
    values = payload.model_dump(exclude_none=True)
    for key, value in values.items():
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > 20000:
            raise HTTPException(status_code=422, detail=f"Invalid {key} target")
    doc_ref = (
        db.collection("users")
        .document(user_id)
        .collection("user_profile")
        .document("profile")
    )
    existing_doc = doc_ref.get()
    existing = existing_doc.to_dict() if existing_doc.exists else {}
    plan = NutritionPlanStore(db, user_id).get_active()
    merged = {**resolve_targets(existing.get("nutrition_targets"), (plan or {}).get("targets")), **values}
    # Manual edits apply to both daily totals and the current plan's guidance.
    # A batch prevents a successful profile write leaving the plan out of sync.
    batch = db.batch()
    batch.set(doc_ref,
        {
            "nutrition_targets": merged,
            "updated_at": datetime.now().isoformat(),
        },
        merge=True,
    )
    if plan:
        previous_targets = plan.get("targets") or {}
        plan_targets = {**previous_targets, **{k: v for k, v in merged.items() if k != "water"}}
        if plan_targets.get("calories") != previous_targets.get("calories"):
            # A manually chosen point target replaces the old plan's range.
            plan_targets.update(calories_min=None, calories_max=None)
        if plan_targets != previous_targets:
            batch.update(
                db.collection("users").document(user_id).collection("nutrition_plans").document(plan["id"]),
                {
                    "targets": plan_targets,
                    "version": int(plan.get("version") or 1) + 1,
                    "updated_at": datetime.now().isoformat(),
                },
            )
    batch.commit()
    return merged

@router.put("/timezone")
async def update_timezone(
    request: TimezoneRequest,
    user_id: str = Depends(get_user_id),
):
    """
    Record the device's timezone so server-side date defaults use the user's
    calendar day. Sent silently by the app; never asked of the user.
    """
    stored = set_timezone(db, user_id, request.timezone)
    if not stored:
        raise HTTPException(status_code=422, detail="Unknown timezone name.")
    return {"status": "success", "timezone": stored}


@router.get("/timezone")
async def read_timezone(user_id: str = Depends(get_user_id)):
    return {"status": "success", "timezone": get_timezone(db, user_id)}


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
