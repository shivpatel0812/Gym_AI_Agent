from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Form
from typing import Optional, List, Dict
from datetime import datetime
from io import BytesIO
import tempfile
import os
from PIL import Image, ImageOps, UnidentifiedImageError
from models import MacroEntry, SavedFood, SavedFoodUpdate, FoodEstimateRequest, AdjustEstimateRequest
from nutrition.gpt_food_lookup import estimate_food_from_query
from nutrition.adjust_estimate import adjust_macro_estimate
from nutrition.photo_estimate import normalize_cooking_style
import re
from auth import get_user_id
from db import db
from nutrition import analyze_food_image

router = APIRouter(prefix="/api/macros", tags=["macros"])


def _foods_ref(user_id: str):
    return db.collection("users").document(user_id).collection("foods")


def _normalize_food_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _logged_food_quantity(item: dict) -> float:
    """Units this logged row represents; always >= 1 so it is safe to divide by."""
    try:
        quantity = float(item.get("quantity") or 1)
    except (TypeError, ValueError):
        return 1.0
    return quantity if quantity > 0 else 1.0


def _saved_food_payload(item: dict, now: str) -> Optional[dict]:
    """
    Per-SERVING library entry for a logged food, or None if it isn't storable.

    Macros on a logged row are the product (per-unit x quantity), but the library
    stores ONE serving. The quantity has to be divided back out or a "rice cake
    x3" log would redefine a rice cake as three of them -- and that inflated
    value would then be re-logged and re-remembered, compounding each time.
    """
    # The photo flow calls /foods with correction metadata immediately after
    # logging. Skipping it here prevents this generic hook from racing that
    # request and promoting an untouched AI estimate to a trusted prior.
    if str(item.get("log_source") or "").strip().lower() == "photo":
        return None

    name = str(item.get("name") or "").strip()
    if not name:
        return None
    try:
        float(item.get("calories") or 0)
        float(item.get("protein") or 0)
    except (TypeError, ValueError):
        return None

    quantity = _logged_food_quantity(item)

    def per_unit(value) -> float:
        try:
            return round(float(value or 0) / quantity, 2)
        except (TypeError, ValueError):
            return 0.0

    # `amount` on a multi-unit row reads "3 x 1 cake", which is not a serving
    # label -- fall back to unit_amount, and to a generic label if absent.
    serving = str(item.get("unit_amount") or "").strip()
    if not serving and quantity == 1:
        serving = str(item.get("amount") or "").strip()
    serving = serving or "1 serving"

    return {
        "name": name,
        "serving": serving[:80],
        "grams": 100.0,
        "calories": per_unit(item.get("calories")),
        "protein": per_unit(item.get("protein")),
        "carbs": per_unit(item.get("carbs")),
        "fats": per_unit(item.get("fats")),
        "fiber": per_unit(item.get("fiber")),
        "updated_at": now,
        "last_used_at": now,
    }


def _remember_logged_foods(user_id: str, food_items) -> None:
    """Upsert each logged food into the user's Saved Foods library."""
    items = food_items if isinstance(food_items, list) else []
    now = datetime.now().isoformat()
    for item in items:
        if not isinstance(item, dict):
            continue
        payload = _saved_food_payload(item, now)
        if payload is None:
            continue
        name_key = _normalize_food_text(payload["name"])
        existing = None
        for doc in _foods_ref(user_id).stream():
            data = doc.to_dict() or {}
            if _normalize_food_text(data.get("name") or "") == name_key:
                existing = doc
                break
        if existing:
            # Keep richer catalog serving/grams if already set; refresh macros + last used.
            prev = existing.to_dict() or {}
            merged = {
                **prev,
                **payload,
                "serving": prev.get("serving") or payload["serving"],
                "grams": float(prev.get("grams") or payload["grams"] or 100),
                "created_at": prev.get("created_at") or now,
                "aliases": list(
                    {*(prev.get("aliases") or []), payload["name"], payload["serving"]}
                ),
            }
            existing.reference.set(merged, merge=True)
        else:
            payload["created_at"] = now
            payload["aliases"] = [payload["name"]]
            _foods_ref(user_id).document().set(payload)


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


_PHOTO_PRIOR_STOPWORDS = {
    "and", "ate", "for", "from", "had", "homemade", "little", "made",
    "meal", "some", "the", "this", "with",
}


def _rank_photo_food_priors(
    foods: List[dict], title: Optional[str], description: Optional[str]
) -> List[dict]:
    """Find a few relevant foods the user previously confirmed.

    These are prompt priors, not ground truth.  Requiring token overlap avoids
    biasing an unidentified photo toward whichever foods happen to be recent.
    """
    title_key = _normalize_food_text(title or "")
    query_key = _normalize_food_text(" ".join(part for part in (title, description) if part))
    query_tokens = {
        token
        for token in query_key.split(" ")
        if len(token) > 2 and not token.isdigit() and token not in _PHOTO_PRIOR_STOPWORDS
    }
    if not title_key and not query_tokens:
        return []

    ranked = []
    for food in foods:
        if not isinstance(food, dict):
            continue
        # Do not let an untouched AI estimate become its own ground truth.
        # Photo-only foods enter the prompt after two explicit adjustments.
        if food.get("photo_only") and not food.get("photo_calibrated"):
            continue
        name_key = _normalize_food_text(food.get("name") or "")
        blob = _food_search_blob(food)
        blob_tokens = set(blob.split(" "))
        overlap = len(query_tokens & blob_tokens)
        score = overlap
        if title_key and name_key == title_key:
            score += 10
        elif title_key and title_key in blob:
            score += 5
        if score <= 0:
            continue
        ranked.append((score, str(food.get("last_used_at") or ""), food))

    ranked.sort(key=lambda row: (row[0], row[1]), reverse=True)
    return [food for _, _, food in ranked[:3]]


def _photo_food_priors(user_id: str, title: Optional[str], description: Optional[str]) -> List[dict]:
    foods = [(doc.to_dict() or {}) for doc in _foods_ref(user_id).stream()]
    return _rank_photo_food_priors(foods, title, description)


MAX_FOOD_IMAGE_BYTES = 12 * 1024 * 1024
MAX_FOOD_IMAGE_PIXELS = 40_000_000
MAX_FOOD_IMAGE_EDGE = 1536


async def _save_normalized_food_image(upload: UploadFile) -> str:
    """Validate, orient, resize, and encode an upload as a real JPEG."""
    if upload.content_type and not upload.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

    payload = await upload.read(MAX_FOOD_IMAGE_BYTES + 1)
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded image is empty")
    if len(payload) > MAX_FOOD_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large (max 12MB)")

    temp_path = None
    try:
        with Image.open(BytesIO(payload)) as source:
            source.load()
            if source.width < 64 or source.height < 64:
                raise HTTPException(status_code=400, detail="Image is too small to analyze")
            if source.width * source.height > MAX_FOOD_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="Image dimensions are too large")

            image = ImageOps.exif_transpose(source)
            if image.mode in ("RGBA", "LA") or "transparency" in image.info:
                rgba = image.convert("RGBA")
                background = Image.new("RGB", rgba.size, "white")
                background.paste(rgba, mask=rgba.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")
            image.thumbnail(
                (MAX_FOOD_IMAGE_EDGE, MAX_FOOD_IMAGE_EDGE),
                Image.Resampling.LANCZOS,
            )

            with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                temp_path = tmp.name
                image.save(tmp, format="JPEG", quality=90, optimize=True)
        return temp_path
    except HTTPException:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)
        raise HTTPException(status_code=400, detail="Unsupported or invalid image") from exc

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
    try:
        _remember_logged_foods(user_id, macro_dict.get("food_items"))
    except Exception:
        pass
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
    prev_snap = doc_ref.get()
    if not prev_snap.exists:
        raise HTTPException(status_code=404, detail="Macro entry not found")
    prev = prev_snap.to_dict() or {}
    prev_names = {
        _normalize_food_text(item.get("name") or "")
        for item in (prev.get("food_items") or [])
        if isinstance(item, dict) and item.get("name")
    }
    # Only index newly added foods — re-scanning the whole library on every
    # toggle made Home go-to clicks multi-second.
    new_items = [
        item
        for item in (macro_dict.get("food_items") or [])
        if isinstance(item, dict)
        and item.get("name")
        and _normalize_food_text(item.get("name") or "") not in prev_names
    ]
    doc_ref.update(macro_dict)
    try:
        if new_items:
            _remember_logged_foods(user_id, new_items)
    except Exception:
        pass
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
    title: Optional[str] = Form(None),
    cooking_style: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    user_id: str = Depends(get_user_id)
):
    """
    Analyze a meal photo with optional user description.
    GPT vision estimates the portion shown and reports uncertainty metadata.
    model: "gpt-4o" (default) or "gpt-5.6-sol"
    """
    temp_file = None
    try:
        temp_file = await _save_normalized_food_image(file)
        try:
            priors = _photo_food_priors(user_id, title, description)
        except Exception:
            priors = []
        result = analyze_food_image(
            temp_file,
            description,
            model=model,
            title=title,
            cooking_style=normalize_cooking_style(cooking_style),
            prior_foods=priors,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error analyzing image: {str(e)}"
        )
    
    finally:
        if temp_file and os.path.exists(temp_file):
            try:
                os.unlink(temp_file)
            except OSError:
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
    log_source = str(payload.pop("log_source", "") or "").strip().lower()
    was_adjusted = bool(payload.pop("was_adjusted", False))
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
        previous = existing.to_dict() or {}
        merged_aliases = list({*(previous.get("aliases") or []), *payload["aliases"]})
        payload["aliases"] = merged_aliases
        if log_source == "photo":
            observations = int(previous.get("photo_observation_count") or 0) + 1
            corrections = int(previous.get("photo_correction_count") or 0) + int(was_adjusted)
            payload.update(
                {
                    "photo_only": bool(previous.get("photo_only", False)),
                    "photo_observation_count": observations,
                    "photo_correction_count": corrections,
                    "photo_calibrated": corrections >= 2,
                }
            )
        if not previous.get("created_at"):
            payload["created_at"] = datetime.now().isoformat()
        existing.reference.set(payload, merge=True)
        return {"id": existing.id, **{**previous, **payload}}

    payload["created_at"] = datetime.now().isoformat()
    if log_source == "photo":
        corrections = int(was_adjusted)
        payload.update(
            {
                "photo_only": True,
                "photo_observation_count": 1,
                "photo_correction_count": corrections,
                "photo_calibrated": corrections >= 2,
            }
        )
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


@router.post("/adjust-estimate")
async def adjust_estimate_endpoint(
    payload: AdjustEstimateRequest,
    user_id: str = Depends(get_user_id),
):
    """Let the user dispute an AI macro estimate via a mini chat."""
    message = (payload.message or "").strip()
    if len(message) < 2:
        raise HTTPException(status_code=422, detail="Say what looks wrong.")
    if not payload.current_estimate:
        raise HTTPException(status_code=422, detail="No estimate to adjust.")

    # Cap conversation to 6 turns (3 user + 3 assistant) to keep tokens sane.
    history = (payload.conversation_history or [])[-6:]

    result = adjust_macro_estimate(
        current_estimate=payload.current_estimate,
        user_message=message,
        history=history,
    )
    if not result:
        raise HTTPException(
            status_code=502,
            detail="Could not process the adjustment. Try rephrasing.",
        )
    return result
