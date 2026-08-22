"""
Body scan schemas — qualitative observations only.

No body-fat percentages. Ranges and hedges only. Vision output that invents
precision erodes trust in a body-image-sensitive feature.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

REGIONS = ("chest", "back", "shoulders", "arms", "legs", "core", "glutes")
DEVELOPMENT = ("underdeveloped", "balanced", "prominent", "uncertain")
SEVERITY = ("mild", "moderate", "uncertain")
POSTURE_KEYS = (
    "forward_head",
    "rounded_shoulders",
    "anterior_pelvic_tilt",
    "posterior_pelvic_tilt",
    "uneven_shoulders",
)
POSTURE_LEVELS = ("none", "possible", "likely", "uncertain")
DIRECTIONS = ("hypertrophy", "strength", "cut", "recomp", "maintain")
EMPHASIS = ("-2", "-1", "0", "+1", "+2")
CONSENT_VERSION = "body_scan_v1"

# Muscle groups the synthesizer / plan focus can emphasize
EMPHASIS_GROUPS = (
    "chest",
    "back",
    "shoulders",
    "rear_delts",
    "arms",
    "legs",
    "glutes",
    "core",
    "upper_push",
    "upper_pull",
)


def _clamp_str(value: Any, allowed: tuple, default: str) -> str:
    s = str(value or "").strip().lower()
    return s if s in allowed else default


def empty_photo_quality() -> Dict[str, Any]:
    return {
        "full_body_visible": False,
        "lighting": "uncertain",
        "pose_usable": False,
        "clothing_obscures": True,
        "views_match_labels": False,
        "notes": None,
    }


def empty_observations() -> Dict[str, Any]:
    return {
        "regions": {
            r: {"development": "uncertain", "notes": None}
            for r in REGIONS
        },
        "asymmetries": [],
        "posture": {k: "uncertain" for k in POSTURE_KEYS},
        "photo_quality": empty_photo_quality(),
        "overall_notes": None,
        "confidence": "low",
        "limitations": "Insufficient photo quality or pose consistency for a confident read.",
    }


def normalize_observations(raw: Optional[Dict]) -> Dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    regions_in = raw.get("regions") if isinstance(raw.get("regions"), dict) else {}
    regions = {}
    for r in REGIONS:
        item = regions_in.get(r) if isinstance(regions_in.get(r), dict) else {}
        regions[r] = {
            "development": _clamp_str(item.get("development"), DEVELOPMENT, "uncertain"),
            "notes": str(item.get("notes") or "").strip()[:200] or None,
        }

    asymmetries = []
    for item in (raw.get("asymmetries") or [])[:8]:
        if not isinstance(item, dict):
            continue
        region = str(item.get("region") or "").strip().lower()
        if region not in REGIONS and region not in EMPHASIS_GROUPS:
            continue
        asymmetries.append({
            "region": region,
            "side": _clamp_str(item.get("side"), ("left", "right", "uncertain"), "uncertain"),
            "severity": _clamp_str(item.get("severity"), SEVERITY, "uncertain"),
            "notes": str(item.get("notes") or "").strip()[:200] or None,
        })

    posture_in = raw.get("posture") if isinstance(raw.get("posture"), dict) else {}
    posture = {
        k: _clamp_str(posture_in.get(k), POSTURE_LEVELS, "uncertain")
        for k in POSTURE_KEYS
    }

    quality_in = raw.get("photo_quality") if isinstance(raw.get("photo_quality"), dict) else {}
    photo_quality = {
        "full_body_visible": bool(quality_in.get("full_body_visible")),
        "lighting": _clamp_str(
            quality_in.get("lighting"), ("good", "dim", "harsh", "uncertain"), "uncertain"
        ),
        "pose_usable": bool(quality_in.get("pose_usable")),
        "clothing_obscures": bool(quality_in.get("clothing_obscures", True)),
        "views_match_labels": bool(quality_in.get("views_match_labels")),
        "notes": str(quality_in.get("notes") or "").strip()[:300] or None,
    }

    confidence = _clamp_str(raw.get("confidence"), ("low", "medium", "high"), "low")
    # The model is told to derive confidence from photo_quality, but a stated
    # rule is not a guarantee. Re-apply the ceiling here so downstream emphasis
    # can never be driven by a "high" claimed over unusable photos.
    blocking = (
        not photo_quality["full_body_visible"]
        or not photo_quality["pose_usable"]
        or not photo_quality["views_match_labels"]
    )
    if blocking:
        confidence = "low"
    elif photo_quality["clothing_obscures"] or photo_quality["lighting"] in ("dim", "harsh"):
        confidence = "medium" if confidence == "high" else confidence

    # Strip any hallucinated numeric BF% fields if the model sneaks them in
    return {
        "regions": regions,
        "asymmetries": asymmetries,
        "posture": posture,
        "photo_quality": photo_quality,
        "overall_notes": str(raw.get("overall_notes") or "").strip()[:400] or None,
        "confidence": confidence,
        "limitations": str(raw.get("limitations") or "").strip()[:400] or None,
    }


def normalize_goal(raw: Optional[Dict], raw_text: str = "") -> Dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    direction = _clamp_str(raw.get("direction"), DIRECTIONS, "recomp")
    targets = []
    for t in (raw.get("target_areas") or [])[:8]:
        key = str(t or "").strip().lower().replace(" ", "_")
        if key and key not in targets:
            targets.append(key[:40])
    protect = []
    for t in (raw.get("protect_lifts") or [])[:6]:
        name = str(t or "").strip()[:60]
        if name and name not in protect:
            protect.append(name)
    constraints = []
    for c in (raw.get("constraints") or [])[:6]:
        text = str(c or "").strip()[:120]
        if text:
            constraints.append(text)
    return {
        "raw_text": (raw_text or raw.get("raw_text") or "").strip()[:500],
        "direction": direction,
        "target_areas": targets,
        "protect_lifts": protect,
        "constraints": constraints,
        "parsed_confidence": _clamp_str(
            raw.get("parsed_confidence"), ("low", "medium", "high"), "medium"
        ),
    }


def normalize_synthesis(raw: Optional[Dict]) -> Dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    emphasis_in = raw.get("emphasis") if isinstance(raw.get("emphasis"), dict) else {}
    emphasis = {}
    for g in EMPHASIS_GROUPS:
        if g in emphasis_in:
            emphasis[g] = _clamp_str(emphasis_in.get(g), EMPHASIS, "0")
    protect = []
    for t in (raw.get("protect") or [])[:6]:
        name = str(t or "").strip()[:60]
        if name:
            protect.append(name)
    flags = []
    for f in (raw.get("flags") or [])[:10]:
        text = str(f or "").strip()[:80]
        if text:
            flags.append(text)
    try:
        next_scan = int(raw.get("next_scan_days") or 28)
    except (TypeError, ValueError):
        next_scan = 28
    next_scan = max(14, min(90, next_scan))
    return {
        "emphasis": emphasis,
        "protect": protect,
        "volume_bias": str(raw.get("volume_bias") or "").strip()[:80] or None,
        "flags": flags,
        "explanation": str(raw.get("explanation") or "").strip()[:900] or None,
        "next_scan_days": next_scan,
        "applied": bool(raw.get("applied")),
    }
