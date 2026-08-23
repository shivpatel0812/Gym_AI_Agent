"""
What the user has actually been eating, grouped per meal slot.

The slot suggestion AI used to see only the plan: goal, targets, likes, and the
anchors already saved. That is why lunch and dinner came back with invented
meals — the model had no idea the user eats the same four dinners on rotation.
This turns raw macro entries into "you ate this N times in the last 14 days,
here is what it costs", which is the evidence a suggestion should be built on.

Nothing here calls a model. It is the same kind of deterministic groundwork
plan_review does: compute the facts first, let the model write about them.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

MACRO_KEYS = ("calories", "protein", "carbs", "fats", "fiber")

# Logged foods carry a free-text meal label; map it to a blueprint slot.
MEAL_TO_SLOT = {
    "breakfast": "breakfast",
    "lunch": "lunch",
    "dinner": "dinner",
    "snack": "snack",
    "snacks": "snack",
    "pre-workout": "pre_workout",
    "pre workout": "pre_workout",
    "preworkout": "pre_workout",
    "shake": "pre_workout",
    "other": "snack",
}


def _num(value, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _norm(value: Optional[str]) -> str:
    return str(value or "").strip().lower()


def slot_for_meal(meal: Optional[str]) -> Optional[str]:
    return MEAL_TO_SLOT.get(_norm(meal))


def _similar(a: str, b: str) -> bool:
    """Loose name match so "Chicken burrito" and "chicken burrito bowl" group."""
    if a == b:
        return True
    if len(a) <= 3 or len(b) <= 3:
        return False
    return a in b or b in a


def group_logged_by_slot(
    entries: List[Dict[str, Any]],
    slot: Optional[str] = None,
    limit_per_slot: int = 8,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Collapse macro entries into repeat meals per slot, most frequent first.

    Counts distinct days rather than rows, so a food logged twice in one sitting
    does not look like a habit. Macros are averaged across the times it was
    logged, which is closer to what the meal really costs than any single entry.
    """
    buckets: Dict[str, Dict[str, Dict[str, Any]]] = {}

    for entry in entries or []:
        date = str(entry.get("date") or "")[:10]
        for food in entry.get("food_items") or []:
            if not isinstance(food, dict):
                continue
            name = _norm(food.get("name"))
            if not name:
                continue
            food_slot = slot_for_meal(food.get("meal"))
            if not food_slot or (slot and food_slot != slot):
                continue

            bucket = buckets.setdefault(food_slot, {})
            key = next((k for k in bucket if _similar(k, name)), name)
            row = bucket.setdefault(
                key,
                {
                    "name": str(food.get("name") or "").strip(),
                    "dates": set(),
                    "samples": [],
                    "amount": None,
                },
            )
            if date:
                row["dates"].add(date)
            row["samples"].append(food)
            if not row["amount"] and food.get("amount"):
                row["amount"] = str(food.get("amount"))[:40]

    out: Dict[str, List[Dict[str, Any]]] = {}
    for food_slot, bucket in buckets.items():
        rows = []
        for row in bucket.values():
            samples = row["samples"]
            averaged = {
                key: round(sum(_num(s.get(key)) for s in samples) / len(samples), 1)
                for key in MACRO_KEYS
            }
            rows.append({
                "name": row["name"],
                "amount": row["amount"],
                "times_logged": len(row["dates"]) or len(samples),
                **averaged,
            })
        rows.sort(key=lambda r: (-r["times_logged"], -r["calories"]))
        out[food_slot] = rows[:limit_per_slot]

    return out


def fits_target(meal: Dict[str, Any], target: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    How a logged meal measures up against the slot's calorie and protein target.

    Returned rather than filtered on: a meal that runs hot is still worth
    offering as an option with the reason attached, which is more useful than
    quietly dropping the thing the user eats most.
    """
    if not target:
        return {"verdict": "unknown", "reason": None}

    low = _num(target.get("calorie_min"))
    high = _num(target.get("calorie_max"))
    protein_floor = _num(target.get("protein_min"))
    calories = _num(meal.get("calories"))
    protein = _num(meal.get("protein"))

    if high and calories > high * 1.15:
        return {
            "verdict": "over",
            "reason": f"about {int(calories - high)} kcal above this slot's range",
        }
    if low and calories and calories < low * 0.6:
        return {
            "verdict": "light",
            "reason": f"light for this slot — leaves about {int(low - calories)} kcal open",
        }
    if protein_floor and protein < protein_floor * 0.75:
        return {
            "verdict": "low_protein",
            "reason": f"only {int(protein)}g protein against a {int(protein_floor)}g floor",
        }
    return {"verdict": "fits", "reason": "sits inside this slot's calorie and protein range"}


def slot_log_facts(
    entries: List[Dict[str, Any]],
    slot: str,
    target: Optional[Dict[str, Any]] = None,
    limit: int = 8,
) -> Dict[str, Any]:
    """Repeat meals for one slot, each scored against that slot's target."""
    grouped = group_logged_by_slot(entries, slot=slot, limit_per_slot=limit)
    meals = grouped.get(slot) or []
    scored = []
    for meal in meals:
        fit = fits_target(meal, target)
        scored.append({**meal, "fit": fit["verdict"], "fit_reason": fit["reason"]})

    days = {
        str(entry.get("date") or "")[:10]
        for entry in entries or []
        if any(
            slot_for_meal((f or {}).get("meal")) == slot
            for f in entry.get("food_items") or []
            if isinstance(f, dict)
        )
    }
    days.discard("")

    return {
        "slot": slot,
        "days_with_logs": len(days),
        "repeat_meals": scored,
        "fitting_meals": [m for m in scored if m["fit"] == "fits"],
    }
