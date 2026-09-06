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
Protein pull is the backbone for meals that carry the day's protein. Every goal
here — fat loss, maintenance, muscle — is a body-composition goal, and the
item's protein per calorie against the *day's required* protein per calorie is
the one ratio that means the same thing under all of them. The rest adjusts for
direction: on a deficit, calories are the scarce resource and energy density
counts against an item; on a surplus, getting the calories in is the job and
being tiny is the failure mode.

Fuel slots (pre-workout) are the exception. Those meals exist to put carbs in
before training, so protein density is not the yardstick and the reason line
never says "low protein".

Scored against the meal slot, not the running day, so an item's score never
changes because of something logged after it.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from nutrition.logged_meals import slot_for_meal
from nutrition.slot_targets import FUEL_SLOTS, is_fuel_slot

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


def _normalize_slot(slot: Optional[str], item: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Map free-text meal labels ("pre-workout", "shake") onto blueprint slots."""
    known = FUEL_SLOTS | {"breakfast", "lunch", "dinner", "snack"}
    if slot and str(slot).strip().lower() in known:
        return str(slot).strip().lower()
    meal = slot or (item or {}).get("meal")
    return slot_for_meal(meal) or (str(meal).strip().lower() if meal else None)


def _reason(
    goal: str,
    protein_ratio: Optional[float],
    calorie_share: Optional[float],
    fiber_per_100: float,
    slot: Optional[str] = None,
) -> str:
    """One short clause naming the dominant factor, always goal-relative."""
    if is_fuel_slot(slot):
        # Pre-workout is fuel. Never complain about protein here.
        if calorie_share is not None and calorie_share >= 1.2:
            return "Heavy for a pre-workout"
        if calorie_share is not None and calorie_share < 0.25:
            return "Light fuel before training"
        return "Solid training fuel"
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
    slot: Optional[str] = None,
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
    resolved_slot = _normalize_slot(slot or (slot_target or {}).get("slot"), item)
    slot_max = _num((slot_target or {}).get("calorie_max")) or None
    fuel = is_fuel_slot(resolved_slot)

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

    if fuel:
        # Protein is not this slot's job — award the protein points flat so a
        # carb snack cannot tank the badge, and lean on calorie fit instead.
        protein_points = PROTEIN_POINTS * 0.9
        fiber_points = FIBER_POINTS * 0.4
    else:
        protein_points = _protein_component(item_density, required_density)
        fiber_points = _fiber_component(fiber, calories)

    total = (
        protein_points
        + _calorie_component(calories, slot_max)
        + fiber_points
        + _direction_component(goal_key, calories, slot_max)
    )
    score = max(0, min(100, int(round(total))))

    return {
        "score": score,
        "band": _band(score),
        "reason": _reason(
            goal_key,
            None if fuel else protein_ratio,
            calorie_share,
            fiber / calories * 100,
            slot=resolved_slot,
        ),
        "goal": goal_key,
        # Kept so a surprising score can be explained rather than argued with.
        "protein_ratio": (
            None if fuel else (round(protein_ratio, 2) if protein_ratio is not None else None)
        ),
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
        slot = _normalize_slot(None, item)
        result = score_food(
            item,
            goal=goal,
            daily_calories=daily_calories,
            daily_protein=daily_protein,
            slot_target=targets.get(slot) if slot else None,
            slot=slot,
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


# ---------------------------------------------------------------------------
# Day totals vs plan — the History chart composite
# ---------------------------------------------------------------------------
#
# Food-level `score_day` asks whether each item fit its slot. The history line
# asks a different question: did the *day* land where the plan asked, across
# the macros that matter. Protein is the spine (body-composition goals live
# or die on it); calories are next; carbs/fats/fiber join when the plan has
# targets for them. Missing targets drop out of the weight sum rather than
# inventing a default — same stance as body without weigh-ins.
#
# Direction tilt on calories: a cut is dinged harder for going over; a surplus
# is dinged harder for coming in light. "Low cal high protein high carb" is
# not a universal virtue — on a lean bulk that day would score poorly.

DAY_PROTEIN_POINTS = 40
DAY_CALORIE_POINTS = 30
DAY_CARB_POINTS = 15
DAY_FAT_POINTS = 10
DAY_FIBER_POINTS = 5

DAY_HIT_BAND = 0.10
DAY_ZERO_AT = 0.45


def _tent(actual: float, target: float, *, full_band: float = DAY_HIT_BAND, zero_at: float = DAY_ZERO_AT) -> Optional[float]:
    if target <= 0:
        return None
    err = abs(actual - target) / target
    if err <= full_band:
        return 1.0
    if err >= zero_at:
        return 0.0
    return 1.0 - (err - full_band) / (zero_at - full_band)


def _protein_day(actual: float, target: float) -> Optional[float]:
    """Hitting protein is good; modest overshoot still full marks."""
    if target <= 0:
        return None
    ratio = actual / target
    if ratio >= 0.90:
        return 1.0
    return max(0.0, ratio / 0.90)


def _calorie_day(actual: float, target: float, goal: str) -> Optional[float]:
    """Tent around target, tilted by goal direction."""
    base = _tent(actual, target)
    if base is None:
        return None
    if target <= 0:
        return None
    signed = (actual - target) / target
    if goal in DEFICIT_GOALS and signed > DAY_HIT_BAND:
        # Overshoot on a cut costs more than the symmetric tent alone.
        return max(0.0, base * 0.75)
    if goal in SURPLUS_GOALS and signed < -DAY_HIT_BAND:
        return max(0.0, base * 0.75)
    return base


def _density_fallback(calories: float, protein: float, fiber: float) -> Dict[str, Any]:
    """
    No plan targets — score protein density only, never invent a calorie goal.

    ~2g protein / 100 kcal is thin; ~4g+ is strong. Fiber adds a small bonus.
    """
    if calories < TRIVIAL_CALORIES:
        return {
            "score": None,
            "band": None,
            "source": "density",
            "reason": "Too little logged to score",
            "parts": {},
        }
    density = (protein / calories) * 100.0  # g per 100 kcal
    # 2.0 → 40, 4.0 → 100, linear clamp
    raw = (density - 2.0) / 2.0 * 60.0 + 40.0
    fiber_bonus = min(10.0, (fiber / max(calories / 100.0, 1.0)) * 4.0)
    score = max(0, min(100, int(round(raw + fiber_bonus))))
    return {
        "score": score,
        "band": _band(score),
        "source": "density",
        "reason": "Protein density (no plan targets yet)",
        "parts": {
            "protein_density": round(density, 2),
            "fiber_bonus": round(fiber_bonus, 1),
        },
    }


def score_day_totals(
    totals: Dict[str, Any],
    *,
    goal: str = "",
    targets: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    One 0–100 figure for a day's macro totals against the plan.

    Renormalizes over whichever of calories/protein/carbs/fats/fiber the plan
    actually specifies. Returns a density fallback when there are no targets.
    """
    calories = _num(totals.get("calories"))
    protein = _num(totals.get("protein"))
    carbs = _num(totals.get("carbs"))
    fats = _num(totals.get("fats"))
    fiber = _num(totals.get("fiber"))
    goal_key = str(goal or "").strip().lower()
    t = targets or {}

    cal_t = _num(t.get("calories"))
    pro_t = _num(t.get("protein"))
    carb_t = _num(t.get("carbs"))
    fat_t = _num(t.get("fats"))
    fiber_t = _num(t.get("fiber"))

    if cal_t <= 0 or pro_t <= 0:
        return _density_fallback(calories, protein, fiber)

    parts: Dict[str, float] = {}
    weighted = 0.0
    weight = 0.0

    p = _protein_day(protein, pro_t)
    if p is not None:
        parts["protein"] = round(p * DAY_PROTEIN_POINTS, 1)
        weighted += p * DAY_PROTEIN_POINTS
        weight += DAY_PROTEIN_POINTS

    c = _calorie_day(calories, cal_t, goal_key)
    if c is not None:
        parts["calories"] = round(c * DAY_CALORIE_POINTS, 1)
        weighted += c * DAY_CALORIE_POINTS
        weight += DAY_CALORIE_POINTS

    if carb_t > 0:
        k = _tent(carbs, carb_t)
        if k is not None:
            parts["carbs"] = round(k * DAY_CARB_POINTS, 1)
            weighted += k * DAY_CARB_POINTS
            weight += DAY_CARB_POINTS

    if fat_t > 0:
        f = _tent(fats, fat_t)
        if f is not None:
            parts["fats"] = round(f * DAY_FAT_POINTS, 1)
            weighted += f * DAY_FAT_POINTS
            weight += DAY_FAT_POINTS

    if fiber_t > 0:
        fib = min(1.0, fiber / fiber_t)
        parts["fiber"] = round(fib * DAY_FIBER_POINTS, 1)
        weighted += fib * DAY_FIBER_POINTS
        weight += DAY_FIBER_POINTS

    if weight <= 0:
        return _density_fallback(calories, protein, fiber)

    # Scale to 0–100 even when carbs/fats/fiber targets are absent.
    score = max(0, min(100, int(round(weighted / weight * 100))))

    # Name the weakest part so the scrub card can say why the day landed here.
    weakest = min(parts.items(), key=lambda kv: kv[1] / {
        "protein": DAY_PROTEIN_POINTS,
        "calories": DAY_CALORIE_POINTS,
        "carbs": DAY_CARB_POINTS,
        "fats": DAY_FAT_POINTS,
        "fiber": DAY_FIBER_POINTS,
    }.get(kv[0], 1)) if parts else None
    reason = {
        "protein": "Protein short of target",
        "calories": "Calories off target",
        "carbs": "Carbs off target",
        "fats": "Fats off target",
        "fiber": "Fiber short of target",
    }.get(weakest[0], "On track") if weakest and weakest[1] < (
        {"protein": DAY_PROTEIN_POINTS, "calories": DAY_CALORIE_POINTS,
         "carbs": DAY_CARB_POINTS, "fats": DAY_FAT_POINTS,
         "fiber": DAY_FIBER_POINTS}.get(weakest[0], 1) * 0.85
    ) else "Solid day against the plan"

    return {
        "score": score,
        "band": _band(score),
        "source": "plan",
        "reason": reason,
        "parts": parts,
        "goal": goal_key,
    }
