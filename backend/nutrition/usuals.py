"""
Usuals - the foods someone eats over and over, as one-tap tiles on Home.

A usual is either a meal anchor from the active nutrition plan, or a food the
user has logged on enough separate days that the app can offer it back without
being asked. Tapping one writes its foods into today's macros tagged with
usual_id, so the same tap can undo it.

Deterministic on purpose, like today_guidance: the plan holds the strategy,
this just decides what to show now and whether it has been eaten yet.
"""

import re
from typing import Any, Dict, List, Optional, Tuple

SLOT_LABELS = {
    "breakfast": "Breakfast",
    "lunch": "Lunch",
    "pre_workout": "Pre-workout",
    "shake": "Shake",
    "snack": "Snack",
    "dinner": "Dinner",
    "late_night": "Late night",
    "other": "Other",
}

# What Home calls the group of tiles, so the row reads as a time of day
# rather than a plan field.
SLOT_TIME_LABELS = {
    "breakfast": "Breakfast time",
    "lunch": "Lunch time",
    "pre_workout": "Pre-workout",
    "shake": "Shake time",
    "snack": "Snack time",
    "dinner": "Dinner time",
    "late_night": "Night time",
    "other": "Anytime",
}

# Hour each slot's window opens. The current slot is the latest active one.
# Only slots the user actually has are considered.
SLOT_START_HOUR = {
    "other": 0,
    "breakfast": 5,
    "pre_workout": 9,
    "shake": 10,
    "lunch": 11,
    "snack": 10,
    "dinner": 17,
    "late_night": 21,
}

# Hour each slot's window closes (exclusive). Breakfast ends at 10am so a
# 10:57 open does not still show breakfast tiles — only what fits now.
SLOT_END_HOUR = {
    "other": 24,
    "breakfast": 10,
    "pre_workout": 12,
    "shake": 11,
    "lunch": 15,
    "snack": 17,
    "dinner": 21,
    "late_night": 5,
}

SLOT_ORDER = ["breakfast", "pre_workout", "shake", "lunch", "snack", "dinner", "late_night", "other"]

# Slots are plan vocabulary; meal names are what the Nutrition page groups by.
SLOT_MEAL_NAME = {
    "breakfast": "Breakfast",
    "lunch": "Lunch",
    "dinner": "Dinner",
    "snack": "Snacks",
    "pre_workout": "Snacks",
    "shake": "Snacks",
    "late_night": "Snacks",
    "other": "Snacks",
}

MEAL_TO_SLOT = {
    "breakfast": "breakfast",
    "lunch": "lunch",
    "dinner": "dinner",
    "snacks": "snack",
    "snack": "snack",
    "pre-workout": "shake",
    "pre workout": "shake",
    "other": "other",
}

# Frequencies that mean "this is part of a normal day", so a missing one is
# worth counting against the day's fraction. The rest are optional taps.
EXPECTED_FREQUENCIES = {"daily", "most_days", "weekdays", "weekends"}

MACRO_KEYS = ("calories", "protein", "carbs", "fats", "fiber")


def _num(value, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _norm(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", _norm(value)).strip("-")


DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def applies_on_weekday(
    frequency: Optional[str],
    weekday: int,
    days: Optional[List[str]] = None,
) -> bool:
    """weekday is Monday=0, matching datetime.weekday().

    Explicit `days` (mon..sun) wins when present. Otherwise fall back to frequency.
    """
    if days:
        keys = []
        for d in days:
            key = str(d or "").strip().lower()[:3]
            if key in DAY_KEYS:
                keys.append(key)
        if keys:
            return DAY_KEYS[weekday] in keys

    freq = _norm(frequency) or "daily"
    if freq == "weekdays":
        return weekday < 5
    if freq == "weekends":
        return weekday >= 5
    return True


def is_expected(frequency: Optional[str], days: Optional[List[str]] = None) -> bool:
    if days:
        return True
    return (_norm(frequency) or "daily") in EXPECTED_FREQUENCIES


def macro_totals(foods: List[Dict]) -> Dict[str, float]:
    totals = {key: 0.0 for key in MACRO_KEYS}
    for food in foods or []:
        for key in MACRO_KEYS:
            totals[key] += _num(food.get(key))
    return {key: round(value, 1) for key, value in totals.items()}


def entry_totals(food_items: List[Dict]) -> Dict[str, float]:
    """Macro entry totals, in the shape the macros collection stores them."""
    totals = macro_totals(food_items)
    return {f"total_{key}": totals[key] for key in MACRO_KEYS}


def slot_is_active(slot: str, hour: int) -> bool:
    """Whether this meal-time window is open right now."""
    if slot == "other":
        return True
    start = SLOT_START_HOUR.get(slot, 0)
    end = SLOT_END_HOUR.get(slot, 24)
    if slot == "late_night":
        return hour >= start or hour < end
    return start <= hour < end


def current_slot(available_slots: List[str], hour: int) -> Optional[str]:
    """The primary slot open now, limited to slots the user has."""
    active = [s for s in available_slots if s in SLOT_START_HOUR and slot_is_active(s, hour)]
    if active:
        return max(
            active,
            key=lambda s: (SLOT_START_HOUR[s], -SLOT_ORDER.index(s) if s in SLOT_ORDER else -99),
        )
    # Before the first window (e.g. 4am): lead with the next meal of the day.
    upcoming = [s for s in available_slots if s in SLOT_START_HOUR and s != "other"]
    if upcoming:
        return min(upcoming, key=lambda s: SLOT_ORDER.index(s) if s in SLOT_ORDER else 99)
    return None


def _names_of(foods: List[Dict]) -> List[str]:
    return [_norm(f.get("name")) for f in foods or [] if _norm(f.get("name"))]


def _name_matches(name: str, logged_names: set) -> bool:
    if name in logged_names:
        return True
    if len(name) <= 2:
        return False
    return any(len(other) > 2 and (name in other or other in name) for other in logged_names)


def logged_state(usual_id: str, foods: List[Dict], logged_foods: List[Dict]) -> Tuple[bool, bool]:
    """
    (logged, can_undo).

    A tap-logged usual carries usual_id and can be removed again. One the user
    typed in by hand still counts as eaten - so the tile does not invite a
    double log - but tapping it must not delete food this feature never wrote.
    """
    for item in logged_foods or []:
        if item.get("usual_id") and item.get("usual_id") == usual_id:
            return True, True

    names = _names_of(foods)
    if not names:
        return False, False
    logged_names = {_norm(f.get("name")) for f in logged_foods or []}
    logged_names.discard("")
    if logged_names and all(_name_matches(name, logged_names) for name in names):
        return True, False
    return False, False


def learn_usuals(
    history: List[Dict],
    min_days: int = 3,
    limit: int = 6,
    exclude_names: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Foods logged on enough separate days to be somebody's routine.

    history is raw macro entries: [{"date": "2026-08-14", "food_items": [...]}].
    Counting distinct days, not entries, keeps a food eaten three times in one
    sitting from looking like a daily habit.
    """
    excluded = [_norm(n) for n in (exclude_names or []) if _norm(n)]
    tally: Dict[str, Dict[str, Any]] = {}

    for entry in history or []:
        date = str(entry.get("date") or "")[:10]
        if not date:
            continue
        for food in entry.get("food_items") or []:
            name = _norm(food.get("name"))
            if not name:
                continue
            row = tally.setdefault(
                name,
                {"display": str(food.get("name")).strip(), "dates": set(), "meals": {}, "samples": []},
            )
            row["dates"].add(date)
            meal = _norm(food.get("meal"))
            if meal:
                row["meals"][meal] = row["meals"].get(meal, 0) + 1
            row["samples"].append(food)

    learned = []
    for name, row in tally.items():
        if len(row["dates"]) < min_days:
            continue
        if any(len(ex) > 2 and (ex in name or name in ex) for ex in excluded):
            continue
        samples = row["samples"]
        averaged = {
            key: round(sum(_num(s.get(key)) for s in samples) / len(samples), 1)
            for key in MACRO_KEYS
        }
        meal = max(row["meals"], key=row["meals"].get) if row["meals"] else ""
        amount = next((s.get("amount") for s in samples if s.get("amount")), None)
        learned.append({
            "id": f"learned:{_slug(name)}",
            "source": "learned",
            "slot": MEAL_TO_SLOT.get(meal, "snack"),
            "label": row["display"],
            "frequency": "most_days",
            "days_logged": len(row["dates"]),
            "foods": [{
                "name": row["display"],
                "amount": amount,
                **averaged,
            }],
        })

    learned.sort(key=lambda u: (-u["days_logged"], u["label"].lower()))
    return learned[:limit]


def _plan_usuals(plan: Optional[Dict]) -> List[Dict[str, Any]]:
    usuals = []
    for anchor in (plan or {}).get("meal_anchors") or []:
        anchor_id = anchor.get("id")
        if not anchor_id:
            continue
        slot = _norm(anchor.get("slot")) or "other"
        usuals.append({
            "id": anchor_id,
            "source": "plan",
            "slot": slot if slot in SLOT_LABELS else "other",
            "label": anchor.get("label") or SLOT_LABELS.get(slot, "Meal"),
            "frequency": _norm(anchor.get("frequency")) or "daily",
            "days": list(anchor.get("days") or []),
            "notes": anchor.get("notes"),
            "foods": [dict(f) for f in anchor.get("foods") or []],
        })
    for item in (plan or {}).get("go_to_items") or []:
        item_id = item.get("id")
        if not item_id:
            continue
        slot = _norm(item.get("slot")) or "other"
        usuals.append({
            "id": item_id,
            "source": "plan",
            "slot": slot if slot in SLOT_LABELS else "other",
            "label": item.get("name") or "Food",
            "frequency": "most_days",
            "days": list(item.get("days") or []),
            "notes": item.get("notes"),
            "foods": [{
                "name": item.get("name") or "Food",
                "amount": item.get("amount"),
                "calories": item.get("calories"),
                "protein": item.get("protein"),
                "carbs": item.get("carbs"),
                "fats": item.get("fats"),
                "fiber": item.get("fiber"),
            }],
        })
    return usuals


def build_usuals(
    plan: Optional[Dict[str, Any]],
    logged_foods: List[Dict],
    history: Optional[List[Dict]] = None,
    hour: int = 12,
    weekday: int = 0,
    max_usuals: int = 8,
) -> Dict[str, Any]:
    """
    Everything Home needs to draw the one-tap food row, grouped by meal slot.
    """
    usuals = _plan_usuals(plan)
    learned = learn_usuals(
        history or [],
        limit=max_usuals,
        exclude_names=[n for u in usuals for n in _names_of(u["foods"])] + [u["label"] for u in usuals],
    )
    usuals.extend(learned)
    usuals = [
        u for u in usuals
        if applies_on_weekday(u.get("frequency"), weekday, u.get("days"))
    ]
    usuals = [u for u in usuals if slot_is_active(u["slot"], hour)][:max_usuals]

    for usual in usuals:
        totals = macro_totals(usual["foods"])
        logged, can_undo = logged_state(usual["id"], usual["foods"], logged_foods)
        usual.update({
            "slot_label": SLOT_LABELS.get(usual["slot"], "Other"),
            "time_label": SLOT_TIME_LABELS.get(usual["slot"], "Anytime"),
            "detail": ", ".join(f.get("name") for f in usual["foods"] if f.get("name"))[:80],
            "calories": round(totals["calories"]) or None,
            "protein": round(totals["protein"]) or None,
            "expected": is_expected(usual.get("frequency"), usual.get("days")),
            "logged": logged,
            "can_undo": can_undo,
        })

    slot_ids = sorted({u["slot"] for u in usuals}, key=lambda s: SLOT_ORDER.index(s) if s in SLOT_ORDER else 99)
    now_slot = current_slot(slot_ids, hour)

    slots = []
    for slot in slot_ids:
        slots.append({
            "slot": slot,
            "label": SLOT_LABELS.get(slot, "Other"),
            "time_label": SLOT_TIME_LABELS.get(slot, "Anytime"),
            "is_current": slot == now_slot,
            "usuals": [u for u in usuals if u["slot"] == slot],
        })

    # Current slot first, then the rest of the day in order, so the tile you
    # most likely want is the one under your thumb.
    slots.sort(key=lambda s: (not s["is_current"], SLOT_ORDER.index(s["slot"]) if s["slot"] in SLOT_ORDER else 99))
    ordered = [u for s in slots for u in s["usuals"]]

    expected = [u for u in usuals if u["expected"]]
    return {
        "has_usuals": bool(usuals),
        "current_slot": now_slot,
        "current_slot_label": SLOT_LABELS.get(now_slot or "", None),
        "current_time_label": SLOT_TIME_LABELS.get(now_slot or "", None),
        "expected_count": len(expected),
        "logged_count": len([u for u in expected if u["logged"]]),
        "slots": slots,
        "usuals": ordered,
    }


def find_usual(payload: Dict[str, Any], usual_id: str) -> Optional[Dict[str, Any]]:
    return next((u for u in payload.get("usuals") or [] if u["id"] == usual_id), None)


def foods_to_log(usual: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The usual's foods as macro food_items, tagged so a second tap can undo."""
    meal = SLOT_MEAL_NAME.get(usual.get("slot") or "other", "Snacks")
    items = []
    for food in usual.get("foods") or []:
        item = {
            "name": food.get("name") or usual.get("label") or "Food",
            "meal": meal,
            "usual_id": usual["id"],
        }
        if food.get("amount"):
            item["amount"] = food["amount"]
        for key in MACRO_KEYS:
            value = _num(food.get(key), None) if food.get(key) is not None else None
            if value is not None:
                item[key] = value
        item.setdefault("calories", 0.0)
        item.setdefault("protein", 0.0)
        items.append(item)
    return items
