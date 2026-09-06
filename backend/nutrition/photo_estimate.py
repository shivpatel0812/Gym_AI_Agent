"""Normalize photo-estimate metadata and calculate confidence deterministically.

The vision model reports observations.  This module decides how much the app
should trust them, so a model cannot make a result look reliable merely by
claiming high confidence.
"""

import math
from .nutrients import optional_nutrients

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
    if not math.isfinite(number) or number < 0:
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


def normalize_components(value: Any) -> List[Dict[str, Any]]:
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
            **optional_nutrients(raw),
        }
        components.append(component)
    return components


# Words that carry no identity, so an overlap on one of them is not evidence
# that a seen item made it into the ledger. "side of yogurt" must not match
# "side of rice" on the word "side".
_STOPWORDS = {
    "a", "an", "and", "of", "the", "with", "plain", "small", "large", "medium",
    "side", "bowl", "cup", "glass", "plate", "katori", "serving", "portion",
    "some", "fresh", "cooked", "homemade", "piece", "pieces", "dish", "extra",
}
MAX_SCENE_ITEMS = 15


def _identity_words(text: str) -> set:
    """
    The words in a food name that actually identify it.

    A trailing "s" is dropped so "lentils" in the inventory matches "lentil" in
    the ledger. Crude, but the alternative is escalating a photo because the
    model pluralised one word out of two.
    """
    cleaned = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in str(text or "").lower())
    words = set()
    for word in cleaned.split():
        if len(word) <= 2 or word in _STOPWORDS:
            continue
        words.add(word[:-1] if len(word) > 3 and word.endswith("s") else word)
    return words


def _is_accounted(item: str, ledger: List[str]) -> bool:
    """Whether a seen item shares an identifying word with anything counted."""
    words = _identity_words(item)
    if not words:
        # Nothing identifiable to match on — assume it was counted rather than
        # firing an escalation on a word like "side".
        return True
    return any(words & _identity_words(entry) for entry in ledger)


def normalize_scene(parsed: Dict[str, Any], components: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    What the model says it saw, against what it actually costed.

    Only the v3 prompt asks for this block; for v1 and v2 every field comes
    back empty and `uncounted` is empty too, which is what keeps the variants
    comparable and the new escalation trigger inert for them.

    Matching is by identifying word rather than by count: a model that folds
    rice and dal into one "khichdi" component has accounted for both, while a
    yogurt that shares no word with anything in the ledger has not. Counting
    rows would call the first case a miss and the second case fine.
    """
    raw = parsed.get("scene") if isinstance(parsed.get("scene"), dict) else {}

    items_seen: List[str] = []
    for value in (raw.get("items_seen") if isinstance(raw.get("items_seen"), list) else [])[:MAX_SCENE_ITEMS]:
        text = _short_text(value, 80)
        if text and text not in items_seen:
            items_seen.append(text)

    excluded: List[Dict[str, str]] = []
    for value in (raw.get("excluded") if isinstance(raw.get("excluded"), list) else [])[:MAX_SCENE_ITEMS]:
        if isinstance(value, dict):
            name = _short_text(value.get("item") or value.get("name"), 80)
            reason = _short_text(value.get("reason"), 120)
        else:
            name, reason = _short_text(value, 80), ""
        if name:
            excluded.append({"item": name, "reason": reason or "no reason given"})

    ledger = [str(component.get("name") or "") for component in components]
    ledger += [entry["item"] for entry in excluded]
    uncounted = [item for item in items_seen if not _is_accounted(item, ledger)]

    return {
        "items_seen": items_seen,
        "excluded": excluded,
        # Food the model listed and then neither costed nor explained. The
        # omission this whole block exists to catch.
        "uncounted": uncounted,
    }


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
    components = normalize_components(parsed.get("components"))
    scene = normalize_scene(parsed, components)

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

    # A short ledger used to earn points here, which meant MISSING a component
    # raised confidence — the same inversion `should_escalate` had. Simplicity
    # is only reassuring once the frame is known to be simple, so the credit
    # now requires the inventory to agree with the ledger.
    if len(components) > 3:
        reasons.append("Several overlapping foods increase uncertainty")
    elif 1 <= len(components) <= 3 and not scene["uncounted"]:
        score += 5

    if scene["uncounted"]:
        reasons.append(
            "Not counted: " + ", ".join(scene["uncounted"][:3])
        )

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
        "scene": scene,
        "assumptions": _text_list(parsed.get("assumptions")),
        "uncertainties": _text_list(parsed.get("uncertainties")),
        "matched_saved_food": bool(has_saved_prior),
    }


# Escalation thresholds. These target *the model being wrong*, not *the photo
# being bad* — a sharp, well-lit, fully-visible tray scores 72/"medium" on the
# confidence scale and can still be 30% low because the first pass shaded five
# compartments down at once. Legibility is not accuracy, and no amount of
# reasoning un-blurs a photo, so routing on image quality escalates exactly the
# wrong set.
# Complexity cuts both ways. A long ledger is where the cheap model shades each
# component low; an inventory longer than the ledger is where it dropped one
# outright. Only the first was routed on until Sep 2026.
#
# Three, not four. Measured against the archived photos in Sep 2026 -- the
# first time the replay harness was run on real logs. Every Indian meal plate
# in the archive came back from gpt-4o with exactly THREE components, one under
# the old threshold, and every one of them was 22-61% low on protein against
# gpt-5.6-sol on the same image:
#
#     Indian breakfast platter   -15% kcal   -22% protein   (3 components)
#     Sabudana khichdi + yogurt  -36% kcal   -61% protein   (3 components)
#     Sabudana khichdi + upma    -26% kcal   -52% protein   (3 components)
#
# The threshold was set one notch above where the degradation actually starts,
# so the plates that needed the second pass were precisely the ones that never
# got it. Note the protein gap runs about TWICE the calorie gap: the cheap
# model shrinks the side dishes, and the side dish is usually where the protein
# is. Two prompt variants failed to move this; the model is stable and
# confidently wrong (50g for a katori of dahi, 3 runs out of 3), so routing is
# the lever, not wording.
COMPLEX_MEAL_COMPONENTS = 3
INCOHERENCE_GAP_RATIO = 0.08
WIDE_SPREAD_RATIO = 0.9
# A protein disagreement has to be worth a paid second vision call. 8% of a
# 20g estimate is 1.6g, which a model reaches by rounding its own line items;
# nothing about a user's day changes at that size.
MIN_PROTEIN_GAP_GRAMS = 5.0


def should_escalate(
    analysis: Dict[str, Any],
    coherence: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Decide whether a cheap first pass earned a stronger second pass.

    Returns the decision plus its triggers, so an escalation that fires (or
    fails to) is explainable after the fact rather than a silent cost.
    """
    triggers: List[str] = []

    components = analysis.get("components") or []
    if len(components) >= COMPLEX_MEAL_COMPONENTS:
        # Multi-compartment mixed meals are where the cheap model degrades:
        # each component is shaded low independently and the errors compound.
        triggers.append(f"{len(components)} components on one plate")

    if coherence and coherence.get("repaired"):
        gap = float(coherence.get("gap_ratio") or 0.0)
        if gap >= INCOHERENCE_GAP_RATIO:
            triggers.append(
                f"stated calories missed its own parts by {round(gap * 100)}%"
            )
        # A plate can be right on calories and badly wrong on protein — one
        # forgotten side of yogurt or dal moves protein far more than kcal, and
        # a calories-only gap never sees it.
        protein_gap = float(coherence.get("protein_gap_ratio") or 0.0)
        protein_grams = abs(
            float(coherence.get("protein") or 0.0)
            - float(coherence.get("reported_protein") or 0.0)
        )
        if protein_gap >= INCOHERENCE_GAP_RATIO and protein_grams >= MIN_PROTEIN_GAP_GRAMS:
            triggers.append(
                f"stated protein missed its own parts by {round(protein_gap * 100)}%"
            )

    # The other direction, and the one component COUNT alone can never see: the
    # model listed food it then neither costed nor explained. An omission makes
    # a plate look simpler, so without this the miss reads as an easy photo.
    uncounted = (analysis.get("scene") or {}).get("uncounted") or []
    if uncounted:
        triggers.append(
            f"{', '.join(uncounted[:3])} seen in the frame but not counted"
        )

    confidence = analysis.get("confidence") or {}
    if confidence.get("level") == "low":
        triggers.append("low confidence in the first pass")

    portion = analysis.get("portion") or {}
    estimated = float(portion.get("estimated_grams") or 0)
    if estimated > 0:
        spread = (
            float(portion.get("high_grams") or 0) - float(portion.get("low_grams") or 0)
        ) / estimated
        if spread >= WIDE_SPREAD_RATIO:
            triggers.append("the portion range is too wide to log")

    return {"escalate": bool(triggers), "triggers": triggers[:4]}


def empty_photo_analysis(reason: str, cooking_style: Optional[str] = None) -> Dict[str, Any]:
    analysis = build_photo_analysis({}, cooking_style=cooking_style)
    analysis["confidence"]["reasons"] = [_short_text(reason) or "Photo estimate unavailable"]
    analysis["confidence"]["should_nudge"] = True
    return analysis
