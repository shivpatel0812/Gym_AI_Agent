"""
The meal-photo archive, surfaced.

`users/{uid}/food_photo_logs` has been storing every meal image, the model's
estimate, the correction chat and — via `record_accepted_estimate` — the macros
the user actually committed. Nothing has ever read it back to the user. It was
built as an eval set for prompt changes; it is also, incidentally, the most
complete record of what someone has actually eaten that this app holds.

**`accepted_estimate` is the only real label.** `initial_estimate` is what the
model guessed and `revised_estimate` is what it guessed after being argued
with; neither is evidence the user agreed. Every number here that claims to be
what someone ate comes from the accepted field, and rows without one are
counted separately rather than silently backfilled from a guess.

The correction statistics are the interesting part and cost nothing to
compute: comparing accepted against initial says which direction the model runs
on *this user's* food, which is a thing neither the user nor the prompt author
could otherwise see.

Images are deliberately not included in the list payload. They are base64 JPEGs
inside the documents (Firebase Storage is not provisioned), so returning fifty
of them would be a multi-megabyte response to render a grid of thumbnails.
"""

from typing import Any, Dict, List, Optional

from .weeks import bucket_by_week, week_label, week_start_of

# Below this the correction direction is noise, not a tendency.
MIN_LABELLED_FOR_BIAS = 5

# A correction this small is rounding and a re-log, not a disagreement.
MEANINGFUL_CORRECTION = 0.05


def _num(value: Any) -> Optional[float]:
    try:
        out = float(value)
        return out if out == out and out not in (float("inf"), float("-inf")) else None
    except (TypeError, ValueError):
        return None


def _day(log: Dict[str, Any]) -> str:
    return str(log.get("accepted_at") or log.get("created_at") or "")[:10]


def summarize_log(log: Dict[str, Any]) -> Dict[str, Any]:
    """One archive row, flattened for the client. Never carries the image."""
    accepted = log.get("accepted_estimate") if isinstance(log.get("accepted_estimate"), dict) else None
    initial = log.get("initial_estimate") if isinstance(log.get("initial_estimate"), dict) else None
    revised = log.get("revised_estimate") if isinstance(log.get("revised_estimate"), dict) else None

    accepted_cals = _num((accepted or {}).get("calories"))
    initial_cals = _num((initial or {}).get("calories"))
    correction = None
    if accepted_cals is not None and initial_cals:
        correction = round((accepted_cals - initial_cals) / initial_cals, 3)

    return {
        "id": log.get("id"),
        "date": _day(log),
        "title": (accepted or {}).get("name") or log.get("title") or (initial or {}).get("name"),
        "has_image": bool(log.get("has_image")),
        "source": log.get("source"),
        "model": log.get("model"),
        "chat_turns": int(log.get("chat_turn_count") or 0),
        "was_corrected": bool(revised) or int(log.get("chat_turn_count") or 0) > 0,
        # `logged` is the only figure that is what the user actually ate.
        "logged": {
            "calories": accepted_cals,
            "protein": _num((accepted or {}).get("protein")),
            "carbs": _num((accepted or {}).get("carbs")),
            "fats": _num((accepted or {}).get("fats")),
        } if accepted else None,
        "first_guess_calories": initial_cals,
        "correction_ratio": correction,
    }


def correction_bias(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Which way the model runs on this user's food.

    Only rows carrying an accepted label can contribute — an unlabelled row is
    a photo whose truth nobody ever stated, and folding it in at its estimated
    value would make the model look perfectly calibrated against itself.
    """
    labelled = [r for r in rows if r["correction_ratio"] is not None]
    if len(labelled) < MIN_LABELLED_FOR_BIAS:
        return {
            "measurable": False,
            "labelled": len(labelled),
            "needed": MIN_LABELLED_FOR_BIAS,
            "reason": (
                f"{MIN_LABELLED_FOR_BIAS - len(labelled)} more corrected photos before "
                "this can say which way the estimates lean."
            ),
        }

    ratios = sorted(r["correction_ratio"] for r in labelled)
    mid = len(ratios) // 2
    median = ratios[mid] if len(ratios) % 2 else (ratios[mid - 1] + ratios[mid]) / 2
    meaningful = [r for r in ratios if abs(r) >= MEANINGFUL_CORRECTION]

    if abs(median) < MEANINGFUL_CORRECTION:
        direction = "about right"
    elif median > 0:
        direction = "low"       # user accepted MORE than the model guessed
    else:
        direction = "high"

    return {
        "measurable": True,
        "labelled": len(labelled),
        "median_correction_pct": round(median * 100, 1),
        "direction": direction,
        "adjusted_share": round(len(meaningful) / len(ratios), 2),
        "summary": (
            "Your photo estimates land about right."
            if direction == "about right"
            else f"Photo estimates tend to read {direction} by about {abs(median) * 100:.0f}% on your meals."
        ),
    }


def build_photo_hub(
    logs: List[Dict[str, Any]],
    axis: List[str],
    limit: int = 60,
) -> Dict[str, Any]:
    """The archive grouped onto the hub's week axis, newest first."""
    rows = [summarize_log(log) for log in logs or []]
    rows = [r for r in rows if r["date"]]
    rows.sort(key=lambda r: r["date"], reverse=True)

    in_range = [r for r in rows if axis and axis[0] <= r["date"]]
    buckets = bucket_by_week(in_range, axis) if axis else {}
    by_week = [
        {
            "week_start": week,
            "label": week_label(week),
            "count": len(buckets.get(week, [])),
            "labelled": sum(1 for r in buckets.get(week, []) if r["logged"]),
        }
        for week in axis
    ]

    labelled_rows = [r for r in in_range if r["logged"]]
    return {
        "total": len(rows),
        "in_range": len(in_range),
        "labelled": len(labelled_rows),
        "unlabelled": len(in_range) - len(labelled_rows),
        "with_image": sum(1 for r in in_range if r["has_image"]),
        "corrected": sum(1 for r in in_range if r["was_corrected"]),
        "by_week": by_week,
        "photos": in_range[:limit],
        "bias": correction_bias(in_range),
    }
