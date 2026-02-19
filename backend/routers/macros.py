from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from typing import Optional, List, Dict
from datetime import datetime
import shutil
import tempfile
import os
from models import MacroEntry
from auth import get_user_id
from db import db
from nutrition import analyze_food_image

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

@router.post("/analyze-image")
async def analyze_food_image_endpoint(
    file: UploadFile = File(...),
    user_id: str = Depends(get_user_id)
):
    """
    Analyze food image using YOLO detection, USDA API lookup, and GPT fallback.
    Returns detected foods with their macro information.
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
        result = analyze_food_image(temp_file)
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
