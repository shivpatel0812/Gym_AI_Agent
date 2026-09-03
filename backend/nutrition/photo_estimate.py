"""Normalize photo-estimate metadata and calculate confidence deterministically.

The vision model reports observations.  This module decides how much the app
should trust them, so a model cannot make a result look reliable merely by
claiming high confidence.
"""

from typing import Any, Dict, Iterable, List, Optional


COOKING_STYLES = ("light", "normal", "generous")
MAX_COMPONENTS = 12
MAX_PORTION_GRAMS = 5000.0
MAX_OIL_GRAMS = 150.0


def normalize_cooking_style(value: Optional[str]) -> str:
    raw = str(value or "").strip().lower()
    return raw if raw in COOKING_STYLES else "normal"


def _number(value: Any, default: float = 0.0, maximum: Optional[float] = None) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number < 0:
        return default
    if maximum is not None:
        number = min(number, maximum)
    return number


def _choice(value: Any, choices: Iterable[str], default: str) -> str:
    raw = str(value or "").strip().lower().replace(" ", "_")
    allowed = set(choices)
    return raw if raw in allowed else default


def _short_text(value: Any, limit: int = 160) -> str:
    return " ".join(str(value or "").split()).strip()[:limit]


def _text_list(value: Any, limit: int = 6) -> List[str]:
    if not isinstance(value, list):
        return []
    result: List[str] = []
    for item in value:
        text = _short_text(item)
        if text and text not in result:
            result.append(text)
        if len(result) >= limit:
            break
    return result


def _normalize_components(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    components: List[Dict[str, Any]] = []
    for raw in value[:MAX_COMPONENTS]:
        if not isinstance(raw, dict):
            continue
        name = _short_text(raw.get("item") or raw.get("name"), 100)
        if not name:
            continue
        component = {
            "name": name,
            "amount": _short_text(raw.get("amount"), 80) or None,
            "estimated_grams": round(
                _number(raw.get("estimated_grams", raw.get("grams")), maximum=MAX_PORTION_GRAMS),
                1,
            ),
            "calories": int(round(_number(raw.get("calories"), maximum=5000))),
            "protein": round(_number(raw.get("protein"), maximum=1000), 1),
            "carbs": round(_number(raw.get("carbs"), maximum=2000), 1),
            "fats": round(_number(raw.get("fats", raw.get("fat")), maximum=1000), 1),
            "fiber": round(_number(raw.get("fiber"), maximum=500), 1),
        }
        components.append(component)
    return components


def _normalize_portion(parsed: Dict[str, Any]) -> Dict[str, float]:
    raw = parsed.get("portion") if isinstance(parsed.get("portion"), dict) else {}
    estimated = _number(
        raw.get("estimated_grams", parsed.get("grams")),
        maximum=MAX_PORTION_GRAMS,
    )
    if estimated <= 0:
        return {"estimated_grams": 0.0, "low_grams": 0.0, "high_grams": 0.0}

    low = _number(raw.get("low_grams"), estimated * 0.75, MAX_PORTION_GRAMS)
    high = _number(raw.get("high_grams"), estimated * 1.3, MAX_PORTION_GRAMS)
    low = min(low or estimated * 0.75, estimated)
    high = max(high or estimated * 1.3, estimated)
    return {
        "estimated_grams": round(estimated, 1),
        "low_grams": round(low, 1),
        "high_grams": round(high, 1),
    }


def _normalize_references(value: Any) -> List[Dict[str, str]]:
    if not isinstance(value, list):
        return []
    references: List[Dict[str, str]] = []
    for raw in value[:5]:
        if isinstance(raw, str):
            ref_type = _short_text(raw, 60).lower().replace(" ", "_")
            reliability = "weak"
        elif isinstance(raw, dict):
            ref_type = _choice(
                raw.get("type"),
                ("plate", "bowl", "utensil", "hand", "known_package", "other"),
                "other",
            )
            reliability = _choice(raw.get("reliability"), ("weak", "medium", "strong"), "weak")
        else:
            continue
        if ref_type and ref_type != "none":
            references.append({"type": ref_type, "reliability": reliability})
    return references


def build_photo_analysis(
    parsed: Dict[str, Any],
    *,
    has_user_hint: bool = False,
    has_saved_prior: bool = False,
    cooking_style: Optional[str] = None,
) -> Dict[str, Any]:
    """Return sanitized observations plus a server-calculated confidence score."""
    quality_raw = parsed.get("image_quality") if isinstance(parsed.get("image_quality"), dict) else {}
    image_quality = {
        "lighting": _choice(quality_raw.get("lighting"), ("good", "usable", "poor"), "unknown"),
        "sharpness": _choice(quality_raw.get("sharpness"), ("sharp", "usable", "blurry"), "unknown"),
        "full_meal_visible": quality_raw.get("full_meal_visible") is True,
        "view_angle": _choice(
            quality_raw.get("view_angle"),
            ("top_down", "angled", "side", "unknown"),
            "unknown",
        ),
    }
    identity_confidence = _choice(
        parsed.get("identity_confidence"), ("low", "medium", "high"), "low"
    )
    portion = _normalize_portion(parsed)
    references = _normalize_references(parsed.get("scale_references"))
    components = _normalize_components(parsed.get("components"))

    fat_raw = parsed.get("cooking_fat") if isinstance(parsed.get("cooking_fat"), dict) else {}
    normalized_style = normalize_cooking_style(cooking_style)
    cooking = {
        "style": normalized_style,
        "oil_grams": round(_number(fat_raw.get("estimated_grams"), maximum=MAX_OIL_GRAMS), 1),
        "basis": _choice(
            fat_raw.get("basis"),
            ("description", "user_preference", "visible_evidence", "typical_recipe", "none", "unknown"),
            "unknown",
        ),
        "visible_evidence": _choice(
            fat_raw.get("visible_evidence"), ("none", "possible", "clear", "unknown"), "unknown"
        ),
    }

    score = 0
    reasons: List[str] = []

    if image_quality["lighting"] == "good":
        score += 10
    elif image_quality["lighting"] == "usable":
        score += 5
    else:
        reasons.append("Lighting makes the food harder to read")

    if image_quality["sharpness"] == "sharp":
        score += 10
    elif image_quality["sharpness"] == "usable":
        score += 5
    else:
        reasons.append("The photo may be blurry")

    if image_quality["full_meal_visible"]:
        score += 10
    else:
        reasons.append("The full portion is not clearly visible")

    reliability_points = {"weak": 4, "medium": 12, "strong": 20}
    strongest_reference = max(
        (reliability_points.get(ref["reliability"], 0) for ref in references),
        default=0,
    )
    score += strongest_reference
    if strongest_reference < 12:
        reasons.append("No reliable size reference was found")

    if identity_confidence == "high":
        score += 15
    elif identity_confidence == "medium":
        score += 8
    else:
        reasons.append("The exact food is uncertain")

    estimated = portion["estimated_grams"]
    if estimated > 0:
        spread = (portion["high_grams"] - portion["low_grams"]) / estimated
        if spread <= 0.35:
            score += 20
        elif spread <= 0.75:
            score += 10
            reasons.append("The portion has a moderate size range")
        else:
            reasons.append("The portion size has a wide range")
    else:
        spread = 999.0
        reasons.append("The portion size could not be estimated")

    if 1 <= len(components) <= 3:
        score += 5
    elif len(components) > 3:
        reasons.append("Several overlapping foods increase uncertainty")

    if has_user_hint:
        score += 5
    if has_saved_prior:
        score += 10

    if cooking["basis"] in ("description", "user_preference", "none"):
        score += 5
    elif cooking["basis"] in ("typical_recipe", "unknown") and cooking["oil_grams"] > 0:
        reasons.append("Cooking oil is based on an assumption")

    # A narrow range claimed without scale/history is not enough for a
    # high-confidence portion. Missing portion/full-plate evidence forces low.
    if strongest_reference < 12 and not has_saved_prior:
        score = min(score, 74)
    if estimated <= 0 or not image_quality["full_meal_visible"] or identity_confidence == "low":
        score = min(score, 49)

    score = max(0, min(int(round(score)), 100))
    level = "high" if score >= 75 else "medium" if score >= 50 else "low"
    should_nudge = level == "low" or spread > 0.75
    if not reasons:
        reasons.append("Clear photo with useful portion cues")

    return {
        "confidence": {
            "score": score,
            "level": level,
            "reasons": reasons[:5],
            "should_nudge": should_nudge,
        },
        "image_quality": image_quality,
        "identity_confidence": identity_confidence,
        "portion": portion,
        "scale_references": references,
        "cooking": cooking,
        "components": components,
        "assumptions": _text_list(parsed.get("assumptions")),
        "uncertainties": _text_list(parsed.get("uncertainties")),
        "matched_saved_food": bool(has_saved_prior),
    }


def empty_photo_analysis(reason: str, cooking_style: Optional[str] = None) -> Dict[str, Any]:
    analysis = build_photo_analysis({}, cooking_style=cooking_style)
    analysis["confidence"]["reasons"] = [_short_text(reason) or "Photo estimate unavailable"]
    analysis["confidence"]["should_nudge"] = True
    return analysis
