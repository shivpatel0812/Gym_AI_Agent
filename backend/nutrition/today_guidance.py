"""
Today guidance from a Nutrition Plan + logged foods.

Deterministic on purpose: the Plan stores strategy, Today just does the math
around what has already been eaten and which meals are still flexible.
"""

from typing import Any, Dict, List, Optional, Tuple

from nutrition.meal_math import (
    DAY_KEYS,
    anchor_kind,
    anchor_macros,
    day_keys,
    grouped_macros,
    items_for_weekday,
)

SLOT_TO_MEALS = {
    "breakfast": {"breakfast"},
    "lunch": {"lunch"},
    "dinner": {"dinner"},
    "snack": {"snacks", "snack", "other"},
    "shake": {"snacks", "snack", "other", "pre-workout", "pre workout"},
    "late_night": {"snacks", "snack", "dinner", "other"},
    "other": {"other", "snacks", "snack"},
}


def _num(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _logged_totals(foods: List[Dict]) -> Dict[str, float]:
    totals = {"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fats": 0.0, "fiber": 0.0}
    for food in foods or []:
        totals["calories"] += _num(food.get("calories"))
        totals["protein"] += _num(food.get("protein"))
        totals["carbs"] += _num(food.get("carbs"))
        totals["fats"] += _num(food.get("fats"))
        totals["fiber"] += _num(food.get("fiber"))
    return {k: round(v, 1) for k, v in totals.items()}


def _logged_meal_names(foods: List[Dict]) -> set:
    names = set()
    for food in foods or []:
        meal = str(food.get("meal") or "").strip().lower()
        if meal:
            names.add(meal)
        name = str(food.get("name") or "").strip().lower()
        if name:
            names.add(name)
    return names


def _meal_logged(meal_name: str, logged_names: set, foods: List[Dict]) -> bool:
    key = (meal_name or "").strip().lower()
    if not key:
        return False
    if key in logged_names:
        return True
    aliases = SLOT_TO_MEALS.get(key, {key})
    if logged_names & aliases:
        return True
    # "Dinner" flexible meal matches foods tagged Dinner
    for food in foods or []:
        if str(food.get("meal") or "").strip().lower() in aliases | {key}:
            return True
    return False


def _anchor_logged(anchor: Dict, logged_names: set, foods: List[Dict]) -> bool:
    slot = str(anchor.get("slot") or "").strip().lower()
    if _meal_logged(slot, logged_names, foods) or _meal_logged(anchor.get("label") or "", logged_names, foods):
        return True
    for item in anchor.get("foods") or []:
        name = str(item.get("name") or "").strip().lower()
        if name and any(name in n or n in name for n in logged_names if len(n) > 2):
            return True
    return False


def _range_text(low: Optional[float], high: Optional[float], unit: str) -> Optional[str]:
    if low is None and high is None:
        return None
    if low is not None and high is not None:
        a, b = int(round(low)), int(round(high))
        if a == b:
            return f"{a}{unit}"
        return f"{min(a, b)}–{max(a, b)}{unit}"
    value = low if low is not None else high
    return f"~{int(round(value))}{unit}"


def _macro_totals(foods: List[Dict]) -> Dict[str, float]:
    """Calories/protein one serving of a set of planned foods contributes."""
    return grouped_macros(foods)


def _anchor_totals(anchors: List[Dict]) -> Dict[str, float]:
    """
    What the given anchors are expected to cost.

    Option meals count as one typical pick and alternates count once, so a
    breakfast listing four choices no longer reserves four breakfasts worth of
    calories. Uncertain meals contribute nothing and are counted separately.
    """
    totals = {"calories": 0.0, "protein": 0.0, "uncertain": 0}
    for anchor in anchors or []:
        if anchor_kind(anchor) == "uncertain":
            totals["uncertain"] += 1
            continue
        part = anchor_macros(anchor)
        totals["calories"] += part["calories"]
        totals["protein"] += part["protein"]
    return totals


def _extra_macros(extra: Dict) -> Dict[str, float]:
    """A blueprint extra's cost: explicit macros, a range midpoint, or its foods."""
    calories = _num(extra.get("calories"))
    protein = _num(extra.get("protein"))
    if not calories:
        low, high = _num(extra.get("calorie_min")), _num(extra.get("calorie_max"))
        calories = (low + high) / 2 if (low and high) else (low or high)
    if not protein:
        low, high = _num(extra.get("protein_min")), _num(extra.get("protein_max"))
        protein = (low + high) / 2 if (low and high) else (low or high)
    if not calories and not protein:
        return grouped_macros(extra.get("foods"))
    return {"calories": calories, "protein": protein}


def _anchor_food_names(plan: Dict) -> List[str]:
    names = []
    for anchor in plan.get("meal_anchors") or []:
        for food in anchor.get("foods") or []:
            name = str(food.get("name") or "").strip().lower()
            if name:
                names.append(name)
    return names


def _scheduled_go_tos(plan: Dict, weekday: Optional[int]) -> List[Dict]:
    """
    Go-to items the user actually mapped onto this day.

    A go-to with no days set is an option to reach for, not a commitment, so it
    is deliberately not charged against the budget — only ones pinned to
    weekdays count. Anything that is already a food inside an anchor is skipped
    so the same yogurt is not paid for twice.
    """
    anchor_names = _anchor_food_names(plan)
    scheduled = []
    for item in plan.get("go_to_items") or []:
        if not isinstance(item, dict):
            continue
        keys = day_keys(item.get("days"))
        if not keys:
            continue
        if weekday is None:
            if len(keys) < 7:
                continue
        elif DAY_KEYS[weekday] not in keys:
            continue
        name = str(item.get("name") or "").strip().lower()
        if name and any(name in other or other in name for other in anchor_names if len(other) > 2):
            continue
        scheduled.append(item)
    return scheduled


def _join_names(names: List[str]) -> str:
    names = [n for n in names if n]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + f" and {names[-1]}"


def _protein_suggestions(plan: Dict, logged_names: set) -> List[str]:
    """Protein options the user has not already eaten today, deduped by name."""
    names: List[str] = []
    seen = set()

    def add(name: Optional[str]) -> None:
        clean = str(name or "").strip()
        if not clean:
            return
        key = clean.lower()
        # Skip anything already logged today, and anything that overlaps a name
        # already suggested — "chicken" and "Chicken breast" are one option, not
        # two, whether the clash comes from the log or from the list itself.
        for other in list(logged_names) + list(seen):
            if len(other) > 2 and (other in key or key in other):
                return
        seen.add(key)
        names.append(clean)

    for anchor in plan.get("meal_anchors") or []:
        for food in anchor.get("foods") or []:
            if _num(food.get("protein")) >= 15:
                add(food.get("name"))
    for like in (plan.get("preferences") or {}).get("likes") or []:
        add(like)
    for extra in ("Greek yogurt", "cottage cheese", "a protein shake"):
        add(extra)
    return names[:3]


def plan_coverage(plan: Dict[str, Any], weekday: Optional[int] = None) -> Dict[str, Any]:
    """
    Whether the plan's own structure can reach its own calorie/protein targets.

    Anchors carry fixed macros; flexible meals carry ranges. If the total falls
    well short of the target, the plan has an unallocated hole the user would
    otherwise have to discover by never hitting their numbers.
    """
    targets = plan.get("targets") or {}
    cal_target = _num(targets.get("calories"))
    protein_target = _num(targets.get("protein"))

    anchors = _anchor_totals(items_for_weekday(plan.get("meal_anchors"), weekday))

    # Blueprint extras are part of the planned day, and so are go-tos the user
    # pinned to weekdays. Leaving them out made the plan look like it had a
    # hole where the user had already filled one.
    for extra in plan.get("blueprint_extras") or []:
        part = _extra_macros(extra)
        anchors["calories"] += part["calories"]
        anchors["protein"] += part["protein"]
    for item in _scheduled_go_tos(plan, weekday):
        anchors["calories"] += _num(item.get("calories"))
        anchors["protein"] += _num(item.get("protein"))

    flex_cal_min = flex_cal_max = 0.0
    flex_protein_min = flex_protein_max = 0.0
    for meal in plan.get("flexible_meals") or []:
        cmin, cmax = _num(meal.get("calorie_min")), _num(meal.get("calorie_max"))
        flex_cal_min += cmin
        flex_cal_max += cmax or cmin
        pmin, pmax = _num(meal.get("protein_min")), _num(meal.get("protein_max"))
        flex_protein_min += pmin
        flex_protein_max += pmax or pmin

    planned_cal_max = anchors["calories"] + flex_cal_max
    planned_protein_max = anchors["protein"] + flex_protein_max

    # Only meaningful once anchors actually carry macros.
    known = anchors["calories"] > 0 or flex_cal_max > 0
    cal_gap = round(cal_target - planned_cal_max) if (known and cal_target) else None
    protein_gap = (
        round(protein_target - planned_protein_max)
        if (known and protein_target)
        else None
    )
    return {
        "planned_calories_min": round(anchors["calories"] + flex_cal_min) or None,
        "planned_calories_max": round(planned_cal_max) or None,
        "planned_protein_max": round(planned_protein_max) or None,
        "calorie_gap": cal_gap,
        "protein_gap": protein_gap,
    }


def build_today_guidance(
    plan: Optional[Dict[str, Any]],
    logged_foods: List[Dict],
    weekday: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Remaining budget for today, accounting for flexible meals that have not
    been logged yet. Returns a payload the Today page can render as-is.

    `weekday` is Monday=0. Pass it and only the meals mapped to that day count
    against the budget — a Saturday-only anchor stops eating into a Tuesday.
    Omit it and every meal counts, which is the old behaviour.
    """
    if not plan or plan.get("status") == "completed":
        return {"has_plan": False}

    targets = plan.get("targets") or {}
    logged = _logged_totals(logged_foods)
    logged_names = _logged_meal_names(logged_foods)

    cal_target = _num(targets.get("calories"), 0)
    protein_target = _num(targets.get("protein"), 0)

    remaining_cal = cal_target - logged["calories"] if cal_target else None
    remaining_protein = protein_target - logged["protein"] if protein_target else None

    todays_flex = items_for_weekday(plan.get("flexible_meals"), weekday)
    todays_anchors = items_for_weekday(plan.get("meal_anchors"), weekday)

    remaining_flex = []
    for meal in todays_flex:
        if _meal_logged(meal.get("name") or "", logged_names, logged_foods):
            continue
        remaining_flex.append(meal)

    remaining_anchors = []
    for anchor in todays_anchors:
        if _anchor_logged(anchor, logged_names, logged_foods):
            continue
        remaining_anchors.append(anchor)

    messages: List[str] = []
    headline = None

    # Calories/protein the still-unlogged regular meals are already spoken for.
    # Without this the headline claims the whole leftover is free for dinner.
    pending_anchors = _anchor_totals(remaining_anchors)
    pending_labels = [a.get("label") for a in remaining_anchors]

    for extra in plan.get("blueprint_extras") or []:
        if _meal_logged(extra.get("label") or "", logged_names, logged_foods):
            continue
        part = _extra_macros(extra)
        pending_anchors["calories"] += part["calories"]
        pending_anchors["protein"] += part["protein"]
        pending_labels.append(extra.get("label"))

    for item in _scheduled_go_tos(plan, weekday):
        if _meal_logged(item.get("name") or "", logged_names, logged_foods):
            continue
        pending_anchors["calories"] += _num(item.get("calories"))
        pending_anchors["protein"] += _num(item.get("protein"))
        pending_labels.append(item.get("name"))

    anchor_names = _join_names(pending_labels)
    nothing_logged = logged["calories"] == 0 and logged["protein"] == 0

    if remaining_cal is not None:
        # What is genuinely uncommitted once planned regular meals are set aside.
        available = remaining_cal - pending_anchors["calories"]
        flex_names = _join_names(
            [m.get("name") or "a flexible meal" for m in remaining_flex]
        )
        flex_min = sum(_num(m.get("calorie_min")) for m in remaining_flex)
        flex_max = sum(_num(m.get("calorie_max")) for m in remaining_flex)

        if remaining_flex:
            after = f" after {anchor_names}" if anchor_names else ""
            if available <= 0:
                headline = (
                    f"Your remaining calories are already committed to {anchor_names or 'your regular meals'}, "
                    f"so {flex_names} would put you over target."
                )
            else:
                headline = f"About {int(round(available))} calories left for {flex_names}{after}."
            messages.append(headline)
            # Reconcile against what that meal usually costs, instead of
            # silently presenting the stored range as the available budget.
            if available > 0 and (flex_min or flex_max):
                span = _range_text(flex_min or None, flex_max or None, "")
                if flex_max and available > flex_max + 100:
                    messages.append(
                        f"{flex_names} usually runs {span} kcal, so there's room for another "
                        f"snack or a bigger portion earlier in the day."
                    )
                elif flex_min and available < flex_min:
                    messages.append(
                        f"That's tighter than the usual {span} kcal for {flex_names} — "
                        f"keep the rest of the day light."
                    )
        else:
            leftover = int(round(available))
            if anchor_names and leftover > 0:
                headline = f"{leftover} calories left after {anchor_names}."
            elif leftover > 0:
                headline = f"{leftover} calories left today."
            elif leftover < -50:
                headline = f"{abs(leftover)} calories over target."
            else:
                headline = "You're around your calorie target."
            messages.append(headline)

    if remaining_protein is not None:
        # Only nag about protein the planned meals won't already cover.
        protein_gap = remaining_protein - pending_anchors["protein"]
        flex_protein = sum(
            _num(m.get("protein_max")) or _num(m.get("protein_min"))
            for m in remaining_flex
        )
        protein_gap -= flex_protein
        if protein_gap >= 20:
            suggestions = _protein_suggestions(plan, logged_names)
            option = (
                ", ".join(suggestions[:-1]) + f", or {suggestions[-1]}"
                if len(suggestions) > 1
                else (suggestions[0] if suggestions else "a protein-rich option")
            )
            lead = (
                f"Even after your planned meals you'd land about {int(round(protein_gap))}g "
                f"short on protein"
                if nothing_logged
                else f"You're about {int(round(protein_gap))}g short on protein for the day"
            )
            messages.append(f"{lead}. {option} would close the gap.")

    style = (plan.get("preferences") or {}).get("guidance_style")
    coverage = plan_coverage(plan, weekday)
    # A plan whose own meals cannot reach its own target is a planning problem,
    # not a today problem — say so rather than letting the user just miss daily.
    cal_gap = coverage.get("calorie_gap")
    if cal_gap is not None and cal_gap > 300:
        messages.append(
            f"Your regular meals and {'flexible meals' if plan.get('flexible_meals') else 'anchors'} "
            f"only account for about {coverage['planned_calories_max']} of your "
            f"{int(round(cal_target))} kcal target — roughly {int(cal_gap)} kcal a day is unplanned. "
            f"Consider adding a snack or shake to your plan."
        )

    if pending_anchors.get("uncertain"):
        count = pending_anchors["uncertain"]
        labels = _join_names(
            [a.get("label") for a in remaining_anchors if anchor_kind(a) == "uncertain"]
        )
        messages.append(
            f"{count} meal{'s' if count > 1 else ''} still undecided"
            f"{f' ({labels})' if labels else ''} — those calories are not counted above."
        )

    priorities = plan.get("food_priorities") or []
    if priorities and remaining_cal is not None and remaining_cal > 150:
        messages.append(priorities[0])

    return {
        "has_plan": True,
        "coverage": coverage,
        "status": plan.get("status"),
        "goal": plan.get("goal"),
        "strategy": plan.get("strategy"),
        "headline": headline,
        "messages": messages,
        "logged": logged,
        "targets": {
            "calories": cal_target or None,
            "protein": protein_target or None,
            "carbs": _num(targets.get("carbs")) or None,
            "fats": _num(targets.get("fats")) or None,
            "fiber": _num(targets.get("fiber")) or None,
        },
        "remaining": {
            "calories": round(remaining_cal, 0) if remaining_cal is not None else None,
            "protein": round(remaining_protein, 1) if remaining_protein is not None else None,
        },
        "remaining_flexible_meals": [
            {
                "name": m.get("name"),
                "calorie_min": m.get("calorie_min"),
                "calorie_max": m.get("calorie_max"),
                "protein_min": m.get("protein_min"),
                "protein_max": m.get("protein_max"),
            }
            for m in remaining_flex
        ],
        "remaining_anchors": [
            {
                "label": a.get("label"),
                "slot": a.get("slot"),
                "calories": round(_macro_totals(a.get("foods"))["calories"]) or None,
                "protein": round(_macro_totals(a.get("foods"))["protein"]) or None,
            }
            for a in remaining_anchors
        ],
        "available_for_flexible": (
            round(remaining_cal - pending_anchors["calories"])
            if remaining_cal is not None
            else None
        ),
        "guidance_style": style,
    }
