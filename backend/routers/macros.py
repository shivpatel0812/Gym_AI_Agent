from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Form
from typing import Optional, List, Dict
from datetime import datetime
import shutil
import tempfile
import os
from models import MacroEntry, SavedFood, SavedFoodUpdate, FoodEstimateRequest
from nutrition.gpt_food_lookup import estimate_food_from_query
import re
from auth import get_user_id
from db import db
from nutrition import analyze_food_image

router = APIRouter(prefix="/api/macros", tags=["macros"])


def _foods_ref(user_id: str):
    return db.collection("users").document(user_id).collection("foods")


def _normalize_food_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _food_search_blob(food: dict) -> str:
    parts = [food.get("name") or "", food.get("serving") or ""]
    parts.extend(food.get("aliases") or [])
    return " ".join(_normalize_food_text(p) for p in parts if p)


def _food_matches_query(food: dict, query: str) -> bool:
    q = _normalize_food_text(query)
    if not q:
        return False
    blob = _food_search_blob(food)
    if q in blob:
        return True
    tokens = [t for t in q.split(" ") if len(t) > 2 and not t.isdigit()]
    if not tokens:
        return False
    return all(t in blob for t in tokens)

@router.get("")
async def get_macro_entries(user_id: str = Depends(get_user_id), date_filter: Optional[str] = Query(None)):
    macros_ref = db.collection("users").document(user_id).collection("macros")
    if date_filter:
        macros = macros_ref.where("date", "==", date_filter).stream()
    else:
        macros = list(macros_ref.order_by("date").stream())
        macros.reverse()
    return [{"id": macro.id, **macro.to_dict()} for macro in macros]

@router.post("")
async def create_macro_entry(macro_entry: MacroEntry, user_id: str = Depends(get_user_id)):
    macro_dict = macro_entry.dict(exclude={"id"})
    if not macro_dict.get("total_calories") and macro_dict.get("food_items"):
        macro_dict["total_calories"] = sum(item.get("calories", 0) for item in macro_dict["food_items"])
    if not macro_dict.get("total_protein") and macro_dict.get("food_items"):
        macro_dict["total_protein"] = sum(item.get("protein", 0) for item in macro_dict["food_items"])
    if not macro_dict.get("total_carbs") and macro_dict.get("food_items"):
        macro_dict["total_carbs"] = sum(item.get("carbs", 0) or 0 for item in macro_dict["food_items"])
    if not macro_dict.get("total_fats") and macro_dict.get("food_items"):
        macro_dict["total_fats"] = sum(item.get("fats", 0) or 0 for item in macro_dict["food_items"])
    if not macro_dict.get("food_items"):
        macro_dict["food_items"] = []
    macro_dict["created_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("macros").document()
    doc_ref.set(macro_dict)
    return {"id": doc_ref.id, **macro_dict}

@router.put("/{macro_id}")
async def update_macro_entry(macro_id: str, macro_entry: MacroEntry, user_id: str = Depends(get_user_id)):
    macro_dict = macro_entry.dict(exclude={"id"})
    if not macro_dict.get("total_calories") and macro_dict.get("food_items"):
        macro_dict["total_calories"] = sum(item.get("calories", 0) for item in macro_dict["food_items"])
    if not macro_dict.get("total_protein") and macro_dict.get("food_items"):
        macro_dict["total_protein"] = sum(item.get("protein", 0) for item in macro_dict["food_items"])
    if not macro_dict.get("total_carbs") and macro_dict.get("food_items"):
        macro_dict["total_carbs"] = sum(item.get("carbs", 0) or 0 for item in macro_dict["food_items"])
    if not macro_dict.get("total_fats") and macro_dict.get("food_items"):
        macro_dict["total_fats"] = sum(item.get("fats", 0) or 0 for item in macro_dict["food_items"])
    if not macro_dict.get("food_items"):
        macro_dict["food_items"] = []
    macro_dict["updated_at"] = datetime.now().isoformat()
    doc_ref = db.collection("users").document(user_id).collection("macros").document(macro_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Macro entry not found")
    doc_ref.update(macro_dict)
    return {"id": macro_id, **macro_dict}

@router.delete("/{macro_id}")
async def delete_macro_entry(macro_id: str, user_id: str = Depends(get_user_id)):
    doc_ref = db.collection("users").document(user_id).collection("macros").document(macro_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Macro entry not found")
    doc_ref.delete()
    return {"message": "Macro entry deleted"}

@router.post("/analyze-image")
async def analyze_food_image_endpoint(
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    user_id: str = Depends(get_user_id)
):
    """
    Analyze a meal photo with optional user description.
    GPT vision estimates the portion shown; YOLO/USDA is the fallback.
    """
    # Save uploaded file temporarily
    temp_file = None
    try:
        # Create temporary file
        suffix = os.path.splitext(file.filename)[1] if file.filename else ".jpg"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_file = tmp.name
            shutil.copyfileobj(file.file, tmp)
        
        # Use the nutrition analyzer module
        result = analyze_food_image(temp_file, description)
        return result
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error analyzing image: {str(e)}"
        )
    
    finally:
        # Clean up temporary file
        if temp_file and os.path.exists(temp_file):
            try:
                os.unlink(temp_file)
            except:
                pass


def _serialize_food(doc) -> dict:
    return {"id": doc.id, **doc.to_dict()}


@router.get("/foods")
async def list_saved_foods(user_id: str = Depends(get_user_id)):
    docs = list(_foods_ref(user_id).stream())
    foods = [_serialize_food(doc) for doc in docs]
    foods.sort(key=lambda f: f.get("last_used_at") or f.get("created_at") or "", reverse=True)
    return foods[:200]


@router.post("/foods")
async def save_food(food: SavedFood, user_id: str = Depends(get_user_id)):
    payload = food.dict(exclude={"id"})
    payload["aliases"] = payload.get("aliases") or []
    payload["updated_at"] = datetime.now().isoformat()
    payload["last_used_at"] = datetime.now().isoformat()
    name_key = _normalize_food_text(payload.get("name") or "")

    existing = None
    for doc in _foods_ref(user_id).stream():
        data = doc.to_dict() or {}
        if _normalize_food_text(data.get("name") or "") == name_key:
            existing = doc
            break

    if existing:
        merged_aliases = list({*(existing.to_dict().get("aliases") or []), *payload["aliases"]})
        payload["aliases"] = merged_aliases
        if not existing.to_dict().get("created_at"):
            payload["created_at"] = datetime.now().isoformat()
        existing.reference.set(payload, merge=True)
        return {"id": existing.id, **{**(existing.to_dict() or {}), **payload}}

    payload["created_at"] = datetime.now().isoformat()
    doc_ref = _foods_ref(user_id).document()
    doc_ref.set(payload)
    return {"id": doc_ref.id, **payload}


@router.patch("/foods/{food_id}")
async def update_saved_food(food_id: str, patch: SavedFoodUpdate, user_id: str = Depends(get_user_id)):
    doc_ref = _foods_ref(user_id).document(food_id)
    snap = doc_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Saved food not found")
    updates = {k: v for k, v in patch.dict(exclude_unset=True).items() if v is not None}
    if "name" in updates and not str(updates["name"]).strip():
        raise HTTPException(status_code=422, detail="Name is required")
    if "name" in updates:
        updates["name"] = str(updates["name"]).strip()
    updates["updated_at"] = datetime.now().isoformat()
    doc_ref.set(updates, merge=True)
    return {"id": food_id, **{**(snap.to_dict() or {}), **updates}}


@router.delete("/foods/{food_id}")
async def delete_saved_food(food_id: str, user_id: str = Depends(get_user_id)):
    doc_ref = _foods_ref(user_id).document(food_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Saved food not found")
    doc_ref.delete()
    return {"message": "Saved food deleted"}


@router.post("/estimate-food")
async def estimate_food(payload: FoodEstimateRequest, user_id: str = Depends(get_user_id)):
    query = (payload.query or "").strip()
    if len(query) < 2:
        raise HTTPException(status_code=422, detail="Enter a food to estimate")

    saved = [_serialize_food(doc) for doc in _foods_ref(user_id).stream()]
    matches = [f for f in saved if _food_matches_query(f, query)]
    if matches:
        matches.sort(key=lambda f: f.get("last_used_at") or "", reverse=True)
        best = matches[0]
        best["from_cache"] = True
        return best

    estimated = estimate_food_from_query(query, name=payload.name)
    if not estimated:
        raise HTTPException(
            status_code=502,
            detail="Could not estimate that food. Try a clearer name or log it as custom.",
        )

    estimated["created_at"] = datetime.now().isoformat()
    estimated["updated_at"] = estimated["created_at"]
    estimated["last_used_at"] = estimated["created_at"]
    doc_ref = _foods_ref(user_id).document()
    doc_ref.set(estimated)
    return {"id": doc_ref.id, **estimated, "from_cache": False}
