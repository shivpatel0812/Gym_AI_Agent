import asyncio
from time import perf_counter
from starlette.concurrency import run_in_threadpool

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File, Form
from typing import Optional, List, Dict
from datetime import datetime, timedelta
from io import BytesIO
import tempfile
import os
from PIL import Image, ImageOps, UnidentifiedImageError
from models import (
    AcceptedEstimateRequest,
    FitPreviewRequest,
    AdjustEstimateRequest,
    FoodEstimateRequest,
    MacroEntry,
    SavedFood,
    SavedFoodUpdate,
)
from nutrition.gpt_food_lookup import estimate_food_from_query
from nutrition.adjust_estimate import adjust_macro_estimate
from nutrition.fit_score import score_day, score_food
from nutrition.logged_meals import slot_for_meal
from nutrition.meal_timing import stamp_logged_at, summarize_meal_timing
from nutrition.photo_estimate import normalize_cooking_style
from nutrition.plan_store import NutritionPlanStore
from nutrition.slot_targets import resolve_slot_targets
from nutrition.photo_log_store import (
    append_adjust_chat,
    create_photo_log,
    compress_image_for_archive,
    load_archived_image,
    record_accepted_estimate,
)
import re
from auth import get_user_id
from db import db
from user_time import now as user_now
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
        **{key: per_unit(item[key]) for key in ("sugar", "sodium") if item.get(key) is not None},
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
    if not (title or "").strip() and not (description or "").strip():
        return []
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

    return await run_in_threadpool(_normalize_food_image_bytes, payload)


def _normalize_food_image_bytes(payload: bytes) -> str:
    """Keep image decoding and JPEG compression off the async request loop."""
    temp_path = None
    try:
        with Image.open(BytesIO(payload)) as source:
            if source.width < 64 or source.height < 64:
                raise HTTPException(status_code=400, detail="Image is too small to analyze")
            if source.width * source.height > MAX_FOOD_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="Image dimensions are too large")

            source.load()
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

def _fit_context(user_id: str):
    """The active plan's goal and targets, or None when there is nothing to
    score against. One read, reused across every entry in the response."""
    try:
        plan = NutritionPlanStore(db, user_id).get_active()
    except Exception as exc:
        print(f"Warning: could not load plan for fit scoring: {exc}")
        return None
    if not plan:
        return None
    targets = plan.get("targets") or {}
    if not targets.get("calories") or not targets.get("protein"):
        return None
    return {
        "goal": plan.get("goal") or "",
        "daily_calories": targets.get("calories"),
        "daily_protein": targets.get("protein"),
        "slot_targets": resolve_slot_targets(plan),
    }


def _with_fit(entry: dict, context) -> dict:
    """Attach a per-item goal-fit score to one day's entry."""
    if not context:
        return entry
    items = entry.get("food_items") or []
    if not items:
        return entry
    scored = score_day(items, **context)
    return {
        **entry,
        "food_items": [
            {**item, "fit": fit}
            for item, fit in zip(items, scored["items"])
        ],
        "fit_score": scored["day_score"],
        "fit_band": scored["day_band"],
    }


def _stamp_food_times(macro_dict: dict, user_id: str) -> None:
    """
    Give every new row a log time on the user's clock.

    Existing stamps survive, which is what keeps a breakfast logged at 7am from
    being re-dated to 9pm when dinner is added to the same day -- an update
    rewrites the whole day's list. See nutrition/meal_timing.py.
    """
    try:
        stamped_at = user_now(db, user_id).isoformat(timespec="seconds")
    except Exception:
        stamped_at = datetime.now().astimezone().isoformat(timespec="seconds")
    macro_dict["food_items"] = stamp_logged_at(macro_dict.get("food_items") or [], stamped_at)


@router.get("")
async def get_macro_entries(user_id: str = Depends(get_user_id), date_filter: Optional[str] = Query(None)):
    macros_ref = db.collection("users").document(user_id).collection("macros")
    if date_filter:
        macros = macros_ref.where("date", "==", date_filter).stream()
    else:
        macros = list(macros_ref.order_by("date").stream())
        macros.reverse()
    context = _fit_context(user_id)
    return [
        _with_fit({"id": macro.id, **macro.to_dict()}, context)
        for macro in macros
    ]


@router.get("/daily")
async def get_daily_macro_history(
    days: int = Query(30, ge=1, le=180),
    user_id: str = Depends(get_user_id),
):
    """
    One row per logged day — totals only, no food items.

    Built for the Nutrition History chart. Dumping every meal for a 90-day
    scrub is a multi-megabyte response for no plot benefit.
    """
    try:
        cutoff = user_now(db, user_id) - timedelta(days=days)
    except Exception:
        cutoff = datetime.now() - timedelta(days=days)
    horizon = cutoff.strftime("%Y-%m-%d")
    macros_ref = db.collection("users").document(user_id).collection("macros")
    by_day: Dict[str, Dict[str, float]] = {}
    for doc in macros_ref.where("date", ">=", horizon).stream():
        data = doc.to_dict() or {}
        day = str(data.get("date") or "")[:10]
        if len(day) != 10:
            continue
        bucket = by_day.setdefault(
            day,
            {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fats": 0.0, "fiber": 0.0},
        )
        # Prefer stamped totals; fall back to summing the ledger so older rows
        # that never got totals still show up on the chart.
        foods = data.get("food_items") or []
        calories = data.get("total_calories")
        protein = data.get("total_protein")
        carbs = data.get("total_carbs")
        fats = data.get("total_fats")
        fiber = data.get("total_fiber")
        if calories is None and foods:
            calories = sum(float(f.get("calories") or 0) for f in foods if isinstance(f, dict))
        if protein is None and foods:
            protein = sum(float(f.get("protein") or 0) for f in foods if isinstance(f, dict))
        if carbs is None and foods:
            carbs = sum(float(f.get("carbs") or 0) for f in foods if isinstance(f, dict))
        if fats is None and foods:
            fats = sum(float(f.get("fats") or 0) for f in foods if isinstance(f, dict))
        if fiber is None and foods:
            fiber = sum(float(f.get("fiber") or 0) for f in foods if isinstance(f, dict))
        bucket["calories"] += float(calories or 0)
        bucket["protein"] += float(protein or 0)
        bucket["carbs"] += float(carbs or 0)
        bucket["fats"] += float(fats or 0)
        bucket["fiber"] += float(fiber or 0)

    series = [
        {
            "date": day,
            "calories": round(totals["calories"]),
            "protein": round(totals["protein"], 1),
            "carbs": round(totals["carbs"], 1),
            "fats": round(totals["fats"], 1),
            "fiber": round(totals["fiber"], 1),
        }
        for day, totals in sorted(by_day.items())
    ]
    return {"days": days, "series": series}


@router.get("/meal-timing")
async def get_meal_timing(
    days: int = Query(30, ge=1, le=180),
    user_id: str = Depends(get_user_id),
):
    """
    When this user actually eats: per-slot clock habits, daily eating windows,
    and the slot corrections they have made by hand.

    Declared above the write routes only for readability -- it reads the same
    `macros` collection the day view does, no extra bookkeeping collection.
    """
    try:
        cutoff = user_now(db, user_id) - timedelta(days=days)
    except Exception:
        cutoff = datetime.now() - timedelta(days=days)
    horizon = cutoff.strftime("%Y-%m-%d")
    macros_ref = db.collection("users").document(user_id).collection("macros")
    entries = [
        {"id": doc.id, **(doc.to_dict() or {})}
        for doc in macros_ref.where("date", ">=", horizon).stream()
    ]
    return summarize_meal_timing(entries)


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
    _stamp_food_times(macro_dict, user_id)
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
    _stamp_food_times(macro_dict, user_id)
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
    prompt_variant: Optional[str] = Form(None),
    user_id: str = Depends(get_user_id)
):
    """
    Analyze a meal photo with optional user description.
    GPT vision estimates the portion shown and reports uncertainty metadata.
    model: "gpt-4o" (default) or "gpt-5.6-sol"
    prompt_variant: "v1" | "v2" | "v3" (default). Unknown names fall back to
    the default, so this is safe to pass through from a client.
    """
    temp_file = None
    started = perf_counter()
    try:
        temp_file = await _save_normalized_food_image(file)
        normalized_at = perf_counter()
        try:
            priors = await run_in_threadpool(_photo_food_priors, user_id, title, description)
        except Exception:
            priors = []
        result, archive = await asyncio.gather(
            run_in_threadpool(
                analyze_food_image,
                temp_file,
                description,
                model=model,
                title=title,
                cooking_style=normalize_cooking_style(cooking_style),
                prior_foods=priors,
                prompt_variant=prompt_variant,
            ),
            run_in_threadpool(compress_image_for_archive, temp_file),
            return_exceptions=True,
        )
        # Wait for both workers before cleanup, even when either one fails.
        if isinstance(result, BaseException):
            raise result
        if isinstance(archive, BaseException):
            archive = None
        analyzed_at = perf_counter()
        # Persist every upload + estimate for testing / review. Never fail the
        # user-facing estimate if archival write has a problem.
        try:
            estimate_payload = result if isinstance(result, dict) else None
            # Prefer the food item as the stored estimate shape when present.
            if isinstance(estimate_payload, dict) and estimate_payload.get("food"):
                estimate_for_log = {
                    **estimate_payload["food"],
                    "analysis": estimate_payload.get("analysis"),
                    "message": estimate_payload.get("message"),
                }
            else:
                estimate_for_log = estimate_payload
            # Log the model that actually produced the answer, not the one that
            # was asked for — escalation makes those differ, and reviewing a
            # bad estimate against the wrong model is worse than useless.
            log_id = await run_in_threadpool(
                create_photo_log,
                db,
                user_id,
                estimate=estimate_for_log,
                archive=archive,
                title=title,
                description=description,
                cooking_style=normalize_cooking_style(cooking_style),
                model=(result.get("model") if isinstance(result, dict) else None) or model,
                source="photo",
            )
            if log_id and isinstance(result, dict):
                result = {**result, "photo_log_id": log_id}
        except Exception as exc:
            print(f"Warning: food photo log failed: {exc}")
        if isinstance(result, dict):
            result["timings_ms"] = {
                "normalize": round((normalized_at - started) * 1000),
                "estimate_and_archive": round((analyzed_at - normalized_at) * 1000),
                "total": round((perf_counter() - started) * 1000),
            }
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


@router.get("/photo-logs")
async def list_photo_logs(
    limit: int = Query(20, ge=1, le=100),
    user_id: str = Depends(get_user_id),
):
    """List recent meal-photo / Fix Results logs (for testing). Omits image bytes."""
    try:
        docs = list(
            db.collection("users")
            .document(user_id)
            .collection("food_photo_logs")
            .order_by("created_at", direction="DESCENDING")
            .limit(limit)
            .stream()
        )
    except Exception:
        docs = list(
            db.collection("users")
            .document(user_id)
            .collection("food_photo_logs")
            .limit(limit)
            .stream()
        )
        docs.sort(
            key=lambda d: (d.to_dict() or {}).get("created_at") or "",
            reverse=True,
        )

    out = []
    for doc in docs:
        data = doc.to_dict() or {}
        out.append(
            {
                "id": doc.id,
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
                "source": data.get("source"),
                "title": data.get("title"),
                "description": data.get("description"),
                "has_image": bool(data.get("has_image")),
                "image_bytes": data.get("image_bytes"),
                "chat_turn_count": data.get("chat_turn_count") or 0,
                "initial_estimate": data.get("initial_estimate"),
                "revised_estimate": data.get("revised_estimate"),
                "model": data.get("model"),
            }
        )
    return out


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


@router.post("/fit-preview")
async def preview_fit(payload: FitPreviewRequest, user_id: str = Depends(get_user_id)):
    """Goal fit for a food the user has not committed yet.

    The scan screen needs this to react as the serving count changes, and the
    scoring must not be reimplemented client-side — two implementations of a
    score drift, and then the badge on the scan screen disagrees with the badge
    on the same food in the day's log.
    """
    context = _fit_context(user_id)
    if not context:
        return {"fit": None}
    item = payload.dict()
    raw_meal = str(item.get("meal") or "").strip().lower()
    slot = slot_for_meal(raw_meal) or raw_meal
    return {
        "fit": score_food(
            item,
            goal=context["goal"],
            daily_calories=context["daily_calories"],
            daily_protein=context["daily_protein"],
            slot_target=context["slot_targets"].get(slot),
            slot=slot or None,
        )
    }


@router.post("/photo-logs/{log_id}/accepted")
async def record_accepted_photo_estimate(
    log_id: str,
    payload: AcceptedEstimateRequest,
    user_id: str = Depends(get_user_id),
):
    """Label a photo log with the macros the user actually committed.

    Without this the archive holds only what the model guessed, which cannot
    score a prompt or model change. See `scripts/replay_photo_estimates.py`.
    """
    saved = record_accepted_estimate(db, user_id, log_id, payload.dict())
    return {"recorded": saved}


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

    # The upload itself is deleted after the first estimate, so re-read the
    # archived copy. Without it the revision can only nudge a number it has
    # never seen.
    try:
        image_data_url = load_archived_image(db, user_id, payload.photo_log_id)
    except Exception as exc:
        print(f"Warning: could not reload photo for adjustment: {exc}")
        image_data_url = None

    result = adjust_macro_estimate(
        current_estimate=payload.current_estimate,
        user_message=message,
        history=history,
        model=payload.model,
        image_data_url=image_data_url,
    )
    if not result:
        raise HTTPException(
            status_code=502,
            detail="Could not process the adjustment. Try rephrasing.",
        )

    # Store the Fix Results turn (and create a log if this was text-only).
    try:
        log_id = append_adjust_chat(
            db,
            user_id,
            payload.photo_log_id,
            user_message=message,
            assistant_reply=result.get("reply") or "",
            current_estimate=payload.current_estimate,
            revised_estimate=result.get("revised_estimate"),
            conversation_history=result.get("conversation_history"),
        )
        if log_id:
            result["photo_log_id"] = log_id
    except Exception as exc:
        print(f"Warning: adjust chat log failed: {exc}")

    return result
