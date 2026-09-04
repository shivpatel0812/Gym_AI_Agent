"""
How well one logged food fits *this user's* goal — not how "healthy" it is.

A food is not good or bad on its own. Ghee in a kadhi is fine on a lean bulk
with 1400 kcal left and a poor use of the room on a cut with 300. Any score
that ranks foods absolutely ends up moralising single items and telling someone
their dinner is bad when their day is fine, so this scores **fit against what
the plan still needs**, and every component is relative to a target the user
actually has.

Deterministic. No model runs here — a score that a model can nudge is a score
nobody can act on, and the same food logged twice must score the same.

No targets, no score
--------------------
`score_food` returns None when the plan has no calorie or protein target, the
same way `estimate_maintenance_calories` returns None rather than guessing.
A fit score against a made-up target is worse than no score: it looks like
information and is noise.

What it measures
----------------
Protein pull is the backbone. Every goal here — fat loss, maintenance, muscle —
is a body-composition goal, and the item's protein per calorie against the
*day's required* protein per calorie is the one ratio that means the same thing
under all of them. The rest adjusts for direction: on a deficit, calories are
the scarce resource and energy density counts against an item; on a surplus,
getting the calories in is the job and being tiny is the failure mode.

Scored against the meal slot, not the running day, so an item's score never
changes because of something logged after it.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

# Goals that are trying to add calories. On these, a low-calorie item is not a
# virtue — it is a meal that failed to do its job.
SURPLUS_GOALS = ("muscle", "lean_bulk")
DEFICIT_GOALS = ("fat_loss",)

# Component ceilings. Protein dominates deliberately; the others adjust.
PROTEIN_POINTS = 45
CALORIE_FIT_POINTS = 30
FIBER_POINTS = 15
DIRECTION_POINTS = 10

# Below this many calories an item is a condiment, and scoring its macro ratios
# is noise — a 20 kcal smear of ketchup should not read as a dietary failure.
TRIVIAL_CALORIES = 40

BANDS = ((80, "excellent"), (65, "good"), (45, "fair"), (0, "poor"))


def _num(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if number >= 0 else default


def _band(score: int) -> str:
    for floor, label in BANDS:
        if score >= floor:
            return label
    return "poor"


def _protein_component(item_density: float, required_density: float) -> float:
    """Item protein-per-kcal against the day's required protein-per-kcal.

    A ratio of 1.0 means this item is pulling exactly its weight: eat only
    foods like it and the day's protein target lands exactly as the calorie
    target does. Above 1.0 buys room for something that isn't.
    """
    if required_density <= 0:
        return PROTEIN_POINTS * 0.5
    ratio = item_density / required_density
    if ratio >= 1.25:
        return PROTEIN_POINTS
    if ratio >= 1.0:
        # 1.0 already earns most of the points — hitting the requirement is the
        # bar, and overshooting protein has diminishing real-world value.
        return PROTEIN_POINTS * (0.82 + 0.18 * (ratio - 1.0) / 0.25)
    return PROTEIN_POINTS * 0.82 * (ratio ** 1.15)


def _calorie_component(calories: float, slot_max: Optional[float]) -> float:
    """How much of the slot's room this single item consumes.

    One item taking the whole meal's budget is not automatically wrong, but it
    leaves nothing for anything else, and that is worth showing.
    """
    if not slot_max or slot_max <= 0:
        return CALORIE_FIT_POINTS * 0.6
    share = calories / slot_max
    if share <= 0.5:
        return CALORIE_FIT_POINTS
    if share >= 1.5:
        return 0.0
    # Linear from full points at half the slot to zero at 1.5x it.
    return CALORIE_FIT_POINTS * (1.5 - share)


def _fiber_component(fiber: float, calories: float) -> float:
    if calories <= 0:
        return 0.0
    per_100 = fiber / calories * 100
    # ~1.4g per 100 kcal is roughly a 30g/2100 kcal day, i.e. target pace.
    return FIBER_POINTS * min(1.0, per_100 / 1.4)


def _direction_component(goal: str, calories: float, slot_max: Optional[float]) -> float:
    """Reward the thing this particular goal is short of."""
    if not slot_max or slot_max <= 0:
        return DIRECTION_POINTS * 0.5
    share = calories / slot_max
    if goal in DEFICIT_GOALS:
        # Calories are the scarce resource; a compact item preserves room.
        return DIRECTION_POINTS * max(0.0, min(1.0, (1.0 - share) / 0.7))
    if goal in SURPLUS_GOALS:
        # Getting the calories in is the job; a token item is the failure mode.
        return DIRECTION_POINTS * max(0.0, min(1.0, share / 0.6))
    return DIRECTION_POINTS * 0.6


def _reason(
    goal: str,
    protein_ratio: Optional[float],
    calorie_share: Optional[float],
    fiber_per_100: float,
) -> str:
    """One short clause naming the dominant factor, always goal-relative."""
    if protein_ratio is not None and protein_ratio >= 1.25:
        return "Strong protein for the calories"
    if calorie_share is not None and calorie_share >= 1.2:
        return "Uses more than this meal's whole budget"
    if goal in SURPLUS_GOALS and calorie_share is not None and calorie_share < 0.25:
        # On a surplus, being negligible is the more actionable complaint than
        # macro ratios — there is barely anything there to have ratios about.
        return "Too small to move your surplus"
    if protein_ratio is not None and protein_ratio < 0.5:
        if goal in SURPLUS_GOALS:
            return "Calories without much protein behind them"
        return "Low protein for what it costs you"
    if fiber_per_100 >= 1.4:
        return "Good fiber for the calories"
    if protein_ratio is not None and protein_ratio >= 1.0:
        return "Pulls its weight on protein"
    return "Fits, without doing much for you"


def score_food(
    item: Dict[str, Any],
    *,
    goal: str,
    daily_calories: Optional[float],
    daily_protein: Optional[float],
    slot_target: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Score one logged food against the plan. None when there is no target."""
    day_cal = _num(daily_calories)
    day_protein = _num(daily_protein)
    if day_cal <= 0 or day_protein <= 0:
        return None

    calories = _num(item.get("calories"))
    if calories <= 0:
        return None

    goal_key = str(goal or "").strip().lower()
    slot_max = _num((slot_target or {}).get("calorie_max")) or None

    if calories < TRIVIAL_CALORIES:
        return {
            "score": None,
            "band": "trivial",
            "reason": "Too small to score",
            "goal": goal_key,
        }

    protein = _num(item.get("protein"))
    fiber = _num(item.get("fiber"))

    required_density = day_protein / day_cal
    item_density = protein / calories
    protein_ratio = item_density / required_density if required_density > 0 else None
    calorie_share = calories / slot_max if slot_max else None

    total = (
        _protein_component(item_density, required_density)
        + _calorie_component(calories, slot_max)
        + _fiber_component(fiber, calories)
        + _direction_component(goal_key, calories, slot_max)
    )
    score = max(0, min(100, int(round(total))))

    return {
        "score": score,
        "band": _band(score),
        "reason": _reason(goal_key, protein_ratio, calorie_share, fiber / calories * 100),
        "goal": goal_key,
        # Kept so a surprising score can be explained rather than argued with.
        "protein_ratio": round(protein_ratio, 2) if protein_ratio is not None else None,
        "slot_share": round(calorie_share, 2) if calorie_share is not None else None,
    }


def score_day(
    items: list,
    *,
    goal: str,
    daily_calories: Optional[float],
    daily_protein: Optional[float],
    slot_targets: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Score every item plus a calorie-weighted day figure.

    Weighted by calories on purpose: a 600 kcal dinner and a 60 kcal apple are
    not equal votes on how the day went.
    """
    targets = slot_targets or {}
    scored = []
    weighted = 0.0
    weight = 0.0

    for item in items or []:
        slot = str(item.get("meal") or "").strip().lower()
        result = score_food(
            item,
            goal=goal,
            daily_calories=daily_calories,
            daily_protein=daily_protein,
            slot_target=targets.get(slot),
        )
        scored.append(result)
        if result and result.get("score") is not None:
            calories = _num(item.get("calories"))
            weighted += result["score"] * calories
            weight += calories

    day_score = int(round(weighted / weight)) if weight > 0 else None
    return {
        "items": scored,
        "day_score": day_score,
        "day_band": _band(day_score) if day_score is not None else None,
    }
