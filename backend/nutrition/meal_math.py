"""
Shared meal arithmetic: which meals apply on a given day, and what a planned
meal is actually worth in calories and protein.

Both of these used to live in more than one place — the day grid in the mobile
app knew that a "potential" meal is one pick out of several options, and that
foods sharing a group_key are alternates rather than additions, but Today's
guidance did not. That mismatch made the remaining-calorie headline count a
four-option breakfast four times. Anything that needs those rules imports them
from here so there is one answer.
"""

from typing import Any, Dict, List, Optional

DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")

ANCHOR_KINDS = ("individual", "potential", "uncertain")


def _norm(value: Optional[str]) -> str:
    return str(value or "").strip().lower()


def _num(value, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def day_keys(days: Optional[List[str]]) -> List[str]:
    """Normalize a mixed list of "Monday" / "mon" / "MON" to mon..sun keys."""
    out: List[str] = []
    for day in days or []:
        key = _norm(day)[:3]
        if key in DAY_KEYS and key not in out:
            out.append(key)
    return out


def applies_on_weekday(
    frequency: Optional[str],
    weekday: int,
    days: Optional[List[str]] = None,
) -> bool:
    """
    weekday is Monday=0, matching datetime.weekday().

    Explicit `days` (mon..sun) wins when present. Otherwise fall back to
    frequency, which only pins down weekdays and weekends.
    """
    keys = day_keys(days)
    if keys:
        return DAY_KEYS[weekday] in keys

    freq = _norm(frequency) or "daily"
    if freq == "weekdays":
        return weekday < 5
    if freq == "weekends":
        return weekday >= 5
    return True


def anchor_kind(anchor: Dict[str, Any]) -> str:
    """individual = fixed meal · potential = a pick from options · uncertain = TBD."""
    kind = _norm(anchor.get("kind"))
    if kind in ANCHOR_KINDS:
        return kind
    if anchor.get("uncertain"):
        return "uncertain"
    if anchor.get("varies"):
        return "potential"
    return "individual"


def food_groups(foods: Optional[List[Dict]]) -> List[List[Dict]]:
    """
    Collapse foods into OR-groups.

    Foods sharing a group_key are alternates for one slot in the meal (shake A
    OR shake B), so they count once. Everything else stands alone.
    """
    order: List[str] = []
    grouped: Dict[str, List[Dict]] = {}
    for index, food in enumerate(foods or []):
        if not isinstance(food, dict):
            continue
        name = str(food.get("name") or "").strip()
        if not name:
            continue
        key = str(food.get("group_key") or "").strip() or f"solo:{index}:{name.lower()}"
        if key not in grouped:
            grouped[key] = []
            order.append(key)
        grouped[key].append(food)
    return [grouped[key] for key in order]


def grouped_macros(foods: Optional[List[Dict]]) -> Dict[str, float]:
    """Macros for one serving of a meal — alternates counted once, not summed."""
    totals = {"calories": 0.0, "protein": 0.0}
    for group in food_groups(foods):
        primary = group[0]
        totals["calories"] += _num(primary.get("calories"))
        totals["protein"] += _num(primary.get("protein"))
    return totals


def anchor_macros(anchor: Dict[str, Any]) -> Dict[str, float]:
    """
    What this anchor is expected to contribute on a day it applies.

    - individual: one serving, alternates counted once
    - potential: the user picks one of the listed options, so the typical pick
      is the average across them, not the sum
    - uncertain: unknown by definition, so zero — the caller should surface the
      count separately rather than pretend the day has that room free
    """
    kind = anchor_kind(anchor)
    if kind == "uncertain":
        return {"calories": 0.0, "protein": 0.0}

    groups = food_groups(anchor.get("foods"))
    if not groups:
        return {"calories": 0.0, "protein": 0.0}

    if kind == "potential":
        totals = {"calories": 0.0, "protein": 0.0}
        for group in groups:
            primary = group[0]
            totals["calories"] += _num(primary.get("calories"))
            totals["protein"] += _num(primary.get("protein"))
        count = max(len(groups), 1)
        return {
            "calories": totals["calories"] / count,
            "protein": totals["protein"] / count,
        }

    return grouped_macros(anchor.get("foods"))


def anchor_applies_on(anchor: Dict[str, Any], weekday: Optional[int]) -> bool:
    if weekday is None:
        return True
    return applies_on_weekday(anchor.get("frequency"), weekday, anchor.get("days"))


def items_for_weekday(items: Optional[List[Dict]], weekday: Optional[int]) -> List[Dict]:
    """Filter any day-aware plan list (anchors, flexible meals, go-tos)."""
    if weekday is None:
        return list(items or [])
    return [
        item
        for item in (items or [])
        if isinstance(item, dict) and anchor_applies_on(item, weekday)
    ]
