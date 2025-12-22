from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime
from models import MacroEntry
from auth import get_user_id
from db import db

router = APIRouter(prefix="/api/macros", tags=["macros"])

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

