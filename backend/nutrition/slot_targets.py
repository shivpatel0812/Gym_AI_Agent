"""
Per-meal calorie and protein targets, and the description each meal block shows.

The plan stores one daily calorie/protein number, which is not what someone
standing in a kitchen at 7pm needs. This turns that daily number into a share
per meal — "dinner: 700-900 kcal, 45g+ protein" — and writes the sentence that
explains it against what the user has actually set up for that slot.

The numbers are computed here, never by a model. A plan built from the coach
chat can store its own per-slot targets (the builder asks for them); when a plan
has none, or predates the field, the derived share fills in so every meal block
still has something honest to show.

An uncertain slot is the case this exists for. The plan deliberately counts an
uncertain meal as zero calories, so those blocks used to say nothing at all.
Uncertainty about *what* someone eats is not uncertainty about how much they
need, so the target still shows, phrased as a target rather than a plan.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from nutrition.meal_math import anchor_kind, anchor_macros

PRIMARY_SLOTS = ("breakfast", "lunch", "pre_workout", "dinner", "snack")

# Share of the day's calories each slot carries when nothing says otherwise.
# These sum to 1.0 across all five; unused slots are dropped and the rest are
# renormalized, so someone who never eats pre-workout does not silently lose 8%
# of their day to a meal they do not have.
DEFAULT_SHARES: Dict[str, float] = {
    "breakfast": 0.22,
    "lunch": 0.28,
    "pre_workout": 0.08,
    "dinner": 0.32,
    "snack": 0.10,
}

# Breakfast, lunch and dinner stay in the day even when empty — an empty dinner
# is a gap worth showing a target for. Pre-workout and snack only appear once
# the user actually uses them.
ALWAYS_ON = ("breakfast", "lunch", "dinner")

# How wide the band around a slot's share is. Tight enough to be a real target,
# loose enough that hitting it does not require weighing anything.
BAND = 0.14

# A main meal below this much protein is not carrying its share, regardless of
# what the proportional split works out to.
MIN_MAIN_PROTEIN = 20
MIN_SNACK_PROTEIN = 5

SLOT_LABELS = {
    "breakfast": "Breakfast",
    "lunch": "Lunch",
    "pre_workout": "Pre-workout",
    "dinner": "Dinner",
    "snack": "Snack",
}

# What each meal is for, in the user's day. Keeps the five blocks from reading
# like the same sentence with a different number in it.
SLOT_FRAMING = {
    "breakfast": "sets up the morning",
    "lunch": "carries the middle of the day",
    "pre_workout": "fuels training",
    "dinner": "is usually the biggest meal",
    "snack": "fills the gaps between meals",
}

# A flexible meal is named, not slotted, so "Dinner out" has to be matched back
# to a slot the same way the day blueprint does it.
FLEX_NAME_HINTS = (
    ("breakfast", "breakfast"),
    ("lunch", "lunch"),
    ("pre-workout", "pre_workout"),
    ("pre workout", "pre_workout"),
    ("preworkout", "pre_workout"),
    ("snack", "snack"),
    ("dinner", "dinner"),
)


def _num(value, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _round_to(value: float, step: int) -> int:
    if step <= 0:
        return int(round(value))
    return int(round(value / step) * step)


def _slot_of(item: Dict[str, Any]) -> str:
    return str(item.get("slot") or "").strip().lower()


def _profile_map(plan: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for profile in plan.get("slot_profiles") or []:
        if isinstance(profile, dict) and _slot_of(profile) in DEFAULT_SHARES:
            out[_slot_of(profile)] = profile
    return out


def flexible_slot(meal: Dict[str, Any]) -> Optional[str]:
    """Which slot a named flexible meal belongs to, or None if unguessable."""
    name = str(meal.get("name") or "").strip().lower()
    if not name:
        return None
    for hint, slot in FLEX_NAME_HINTS:
        if hint in name:
            return slot
    return None


def flexible_for_slot(plan: Dict[str, Any], slot: str) -> List[Dict[str, Any]]:
    return [
        meal
        for meal in (plan.get("flexible_meals") or [])
        if isinstance(meal, dict) and flexible_slot(meal) == slot
    ]


def _flexible_band(meals: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The combined calorie/protein band a slot's flexible meals already declare."""
    low = high = protein = 0.0
    found = False
    for meal in meals:
        cmin = _num(meal.get("calorie_min"))
        cmax = _num(meal.get("calorie_max"))
        if not cmin and not cmax:
            continue
        found = True
        low += cmin or cmax
        high += cmax or cmin
        protein += _num(meal.get("protein_min"))
    if not found:
        return None
    return {
        "calorie_min": int(round(min(low, high))),
        "calorie_max": int(round(max(low, high))),
        "protein_min": int(round(protein)) or None,
    }


def active_slots(plan: Dict[str, Any]) -> List[str]:
    """
    Slots that are part of this user's day.

    A slot counts once anything is attached to it — an anchor, a go-to, a place
    they eat at — or once they have given it a stance other than the default.
    """
    used = set(ALWAYS_ON)

    for anchor in plan.get("meal_anchors") or []:
        if isinstance(anchor, dict) and _slot_of(anchor) in DEFAULT_SHARES:
            used.add(_slot_of(anchor))
    for item in plan.get("go_to_items") or []:
        if isinstance(item, dict) and _slot_of(item) in DEFAULT_SHARES:
            used.add(_slot_of(item))
    for extra in plan.get("blueprint_extras") or []:
        if isinstance(extra, dict) and _slot_of(extra) in DEFAULT_SHARES:
            used.add(_slot_of(extra))
    for meal in plan.get("flexible_meals") or []:
        if isinstance(meal, dict):
            slot = flexible_slot(meal)
            if slot:
                used.add(slot)
    for slot, profile in _profile_map(plan).items():
        stance = str(profile.get("stance") or "anchors").strip().lower()
        if stance != "anchors" or profile.get("notes"):
            used.add(slot)
        if profile.get("calorie_min") or profile.get("calorie_max"):
            used.add(slot)

    return [slot for slot in PRIMARY_SLOTS if slot in used]


def planned_for_slot(plan: Dict[str, Any], slot: str) -> Dict[str, Any]:
    """What the user's saved meals already commit to this slot."""
    calories = 0.0
    protein = 0.0
    counts = {"individual": 0, "potential": 0, "uncertain": 0}

    for anchor in plan.get("meal_anchors") or []:
        if not isinstance(anchor, dict) or _slot_of(anchor) != slot:
            continue
        kind = anchor_kind(anchor)
        counts[kind] = counts.get(kind, 0) + 1
        macros = anchor_macros(anchor)
        calories += macros["calories"]
        protein += macros["protein"]

    for item in plan.get("go_to_items") or []:
        if isinstance(item, dict) and _slot_of(item) == slot:
            calories += _num(item.get("calories"))
            protein += _num(item.get("protein"))

    flex = flexible_for_slot(plan, slot)

    return {
        "calories": round(calories),
        "protein": round(protein),
        "anchors": counts["individual"] + counts["potential"] + counts["uncertain"],
        "individual": counts["individual"],
        "potential": counts["potential"],
        "uncertain": counts["uncertain"],
        "flexible": len(flex),
        # Uncertain meals contribute no macros by design, so a slot made only of
        # them reads as "nothing committed" rather than "0 kcal planned".
        "has_macros": calories > 0,
    }


def derive_slot_targets(plan: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """
    Split the daily target across the slots this user actually eats.

    Only used where the plan does not carry its own numbers. Shares shift toward
    dinner when the user said they prefer a bigger evening meal.
    """
    targets = plan.get("targets") or {}
    cal_target = _num(targets.get("calories"))
    protein_target = _num(targets.get("protein"))

    slots = active_slots(plan)
    if not slots or not cal_target:
        return {}

    shares = {slot: DEFAULT_SHARES[slot] for slot in slots}

    prefs = plan.get("preferences") or {}
    if prefs.get("larger_dinner") and "dinner" in shares:
        # Take the weight off breakfast and snacks rather than lunch, which is
        # the meal people have least control over.
        for donor, amount in (("breakfast", 0.04), ("snack", 0.02)):
            if donor in shares:
                moved = min(amount, shares[donor] * 0.4)
                shares[donor] -= moved
                shares["dinner"] += moved

    total = sum(shares.values()) or 1.0
    out: Dict[str, Dict[str, Any]] = {}

    for slot, share in shares.items():
        weight = share / total
        centre = cal_target * weight
        low = _round_to(centre * (1 - BAND), 25)
        high = _round_to(centre * (1 + BAND), 25)
        floor = MIN_SNACK_PROTEIN if slot in ("snack", "pre_workout") else MIN_MAIN_PROTEIN
        protein_min = (
            max(_round_to(protein_target * weight, 5), floor) if protein_target else None
        )
        out[slot] = {
            "slot": slot,
            "calorie_min": max(low, 50),
            "calorie_max": max(high, low + 50),
            "protein_min": protein_min,
            "source": "derived",
        }

    return out


def resolve_slot_targets(plan: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """
    The target every meal block should show, stored values winning over derived.

    A plan written by the coach chat carries its own per-slot numbers; anything
    it left blank falls back to the share split so no block is ever empty.
    """
    derived = derive_slot_targets(plan)
    profiles = _profile_map(plan)
    out: Dict[str, Dict[str, Any]] = {}

    for slot in active_slots(plan):
        base = dict(derived.get(slot) or {"slot": slot, "source": "derived"})
        profile = profiles.get(slot) or {}

        # A flexible meal the user already gave a range to is a target they set
        # themselves. Deriving a different band for that slot would put the meal
        # block and the meal it describes at odds on the same screen.
        flex = _flexible_band(flexible_for_slot(plan, slot))
        if flex:
            base["calorie_min"] = flex["calorie_min"]
            base["calorie_max"] = flex["calorie_max"]
            # The flexible meal's protein_min is the bottom of a range, not this
            # slot's share of the day. Taking the lower of the two would quietly
            # under-allocate protein and guarantee the daily number is missed, so
            # the higher figure wins.
            if flex.get("protein_min"):
                base["protein_min"] = max(
                    int(flex["protein_min"]), int(base.get("protein_min") or 0)
                )
            base["source"] = "flexible_meal"

        stored_min = _num(profile.get("calorie_min"), 0) or None
        stored_max = _num(profile.get("calorie_max"), 0) or None
        stored_protein = _num(profile.get("protein_min"), 0) or None

        if stored_min or stored_max:
            low = stored_min or stored_max
            high = stored_max or stored_min
            base["calorie_min"] = int(round(min(low, high)))
            base["calorie_max"] = int(round(max(low, high)))
            base["source"] = "plan"
        if stored_protein:
            base["protein_min"] = int(round(stored_protein))

        base["slot"] = slot
        base["stance"] = str(profile.get("stance") or "anchors").strip().lower()
        if base.get("calorie_min") or base.get("calorie_max"):
            out[slot] = base

    return out


def _band_text(target: Dict[str, Any]) -> str:
    low = target.get("calorie_min")
    high = target.get("calorie_max")
    if low and high and low != high:
        return f"{int(low)}–{int(high)} kcal"
    value = high or low
    return f"~{int(value)} kcal" if value else "no calorie target set"


def target_headline(target: Dict[str, Any]) -> str:
    """The short target line, e.g. "700–900 kcal · 45g+ protein"."""
    parts = [_band_text(target)]
    protein = target.get("protein_min")
    if protein:
        parts.append(f"{int(protein)}g+ protein")
    return " · ".join(parts)


def slot_description(plan: Dict[str, Any], slot: str, target: Dict[str, Any]) -> str:
    """
    The sentence under a meal block, specific to that meal and its current state.

    Reads differently per slot and per situation on purpose: an uncertain dinner
    and a fully-anchored breakfast should not get the same words.
    """
    label = SLOT_LABELS.get(slot, slot.replace("_", " ").title())
    framing = SLOT_FRAMING.get(slot, "is part of your day")
    band = _band_text(target)
    protein = target.get("protein_min")
    protein_bit = f" and {int(protein)}g protein" if protein else ""
    stance = str(target.get("stance") or "anchors").lower()
    planned = planned_for_slot(plan, slot)

    if stance == "uncertain" or (planned["uncertain"] and not planned["has_macros"]):
        return (
            f"You have {label.lower()} marked uncertain — that is fine, it happens. "
            f"Whatever you end up eating, aim for {band}{protein_bit} so the rest of the day still adds up."
        )

    if stance == "eat_out":
        return (
            f"You usually eat out for {label.lower()}. Order toward {band}{protein_bit} — "
            "lead with the protein and treat the sides as the flexible part."
        )

    if planned["flexible"] and not planned["has_macros"]:
        protein_ask = f" and get {int(protein)}g protein out of it" if protein else ""
        return (
            f"{label} is set up as a flexible meal at {band}. You pick the food — "
            f"just keep it inside that range{protein_ask}."
        )

    if not planned["anchors"]:
        return (
            f"Nothing saved for {label.lower()} yet, and it {framing}. "
            f"Aim for {band}{protein_bit} — anything you already eat regularly is the easiest place to start."
        )

    if not planned["has_macros"]:
        return (
            f"Your {label.lower()} meals have no macros attached yet, so they count as zero against your day. "
            f"This slot should land around {band}{protein_bit}."
        )

    low = target.get("calorie_min") or 0
    high = target.get("calorie_max") or 0
    have = planned["calories"]
    have_protein = planned["protein"]

    if have < low:
        gap = int(low - have)
        return (
            f"Your saved {label.lower()} comes to about {have} kcal, roughly {gap} kcal short of the "
            f"{band}{protein_bit} this slot should carry. A go-to item or one more option would close it."
        )

    if high and have > high:
        over = int(have - high)
        return (
            f"Your saved {label.lower()} runs about {over} kcal above this slot's {band} share. "
            "That is fine if you are pulling it back elsewhere — otherwise trim the biggest item."
        )

    protein_note = ""
    if protein and have_protein < protein:
        protein_note = f" Protein is a little light at {int(have_protein)}g against {int(protein)}g."
    return (
        f"{label} is covered — about {have} kcal and {int(have_protein)}g protein, "
        f"inside the {band} this slot should carry.{protein_note}"
    )


def slot_summary(plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Everything a meal block needs to render: target, description, what is planned.

    Returned in day order so the client can show it without re-deriving any of
    the arithmetic.
    """
    targets = resolve_slot_targets(plan)
    out: List[Dict[str, Any]] = []
    for slot in PRIMARY_SLOTS:
        target = targets.get(slot)
        if not target:
            continue
        out.append({
            **target,
            "label": SLOT_LABELS.get(slot, slot),
            "headline": target_headline(target),
            "description": slot_description(plan, slot, target),
            "planned": planned_for_slot(plan, slot),
        })
    return out


def apply_slot_targets(plan: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Add resolved targets and descriptions to a plan's slot_profiles for reading.

    The resolved numbers go on separate `target_*` keys rather than into
    calorie_min / calorie_max, which stay reserved for what the coach or the user
    actually set. A client that reads this plan and PATCHes it back therefore
    cannot turn a derived guess into a stored target behind the user's back — the
    normalizer drops these keys on the way in.
    """
    if not isinstance(plan, dict):
        return plan

    targets = resolve_slot_targets(plan)
    if not targets:
        return plan

    profiles = {
        _slot_of(p): dict(p)
        for p in (plan.get("slot_profiles") or [])
        if isinstance(p, dict)
    }
    merged: List[Dict[str, Any]] = []
    for slot in PRIMARY_SLOTS:
        profile = profiles.get(slot) or {"slot": slot, "stance": "anchors", "notes": None}
        target = targets.get(slot)
        if target:
            profile = {
                **profile,
                "target_calorie_min": target.get("calorie_min"),
                "target_calorie_max": target.get("calorie_max"),
                "target_protein_min": target.get("protein_min"),
                "target_source": target.get("source"),
                "target_headline": target_headline(target),
                "description": slot_description(plan, slot, target),
            }
        merged.append(profile)

    return {**plan, "slot_profiles": merged}
