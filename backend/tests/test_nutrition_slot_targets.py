"""Per-meal calorie/protein shares and the description each meal block shows."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from nutrition.plan_builder import NutritionPlanBuilder
from nutrition.slot_targets import (
    apply_slot_targets,
    derive_slot_targets,
    resolve_slot_targets,
    slot_summary,
)


def _plan(**overrides):
    plan = NutritionPlanBuilder.validate_plan({
        "goal": "muscle",
        "targets": {"calories": 2400, "protein": 180},
        "meal_anchors": [
            {
                "id": "b",
                "slot": "breakfast",
                "label": "Shake and yogurt",
                "days": ["mon", "tue", "wed", "thu", "fri"],
                "foods": [{"name": "Shake", "calories": 500, "protein": 45}],
            },
        ],
    })
    plan.update(overrides)
    return plan


def test_derived_shares_cover_the_day_without_inventing_meals():
    targets = derive_slot_targets(_plan())

    # Only the three meals everyone has; snack and pre-workout are unused here.
    assert set(targets) == {"breakfast", "lunch", "dinner"}
    # The midpoints of the three bands should account for the daily target.
    midpoints = sum(
        (t["calorie_min"] + t["calorie_max"]) / 2 for t in targets.values()
    )
    assert abs(midpoints - 2400) < 120
    assert targets["dinner"]["calorie_min"] > targets["breakfast"]["calorie_min"]


def test_a_slot_with_items_joins_the_day():
    plan = _plan()
    plan["go_to_items"] = [{"id": "g", "slot": "snack", "name": "Bar", "calories": 200}]
    assert "snack" in derive_slot_targets(plan)


def test_flexible_meal_range_beats_the_derived_share():
    plan = _plan(flexible_meals=[
        {"id": "f", "name": "Dinner", "calorie_min": 650, "calorie_max": 900}
    ])
    dinner = resolve_slot_targets(plan)["dinner"]

    assert dinner["calorie_min"] == 650
    assert dinner["calorie_max"] == 900
    assert dinner["source"] == "flexible_meal"


def test_flexible_protein_floor_never_lowers_the_slots_share():
    """
    A flexible meal's protein_min is the bottom of a range, not the slot's share
    of the day. Taking it at face value would under-allocate protein and
    guarantee the daily number is missed.
    """
    plan = _plan(flexible_meals=[
        {
            "id": "f",
            "name": "Dinner",
            "calorie_min": 650,
            "calorie_max": 900,
            "protein_min": 25,
        }
    ])
    assert resolve_slot_targets(plan)["dinner"]["protein_min"] > 25


def test_a_stored_slot_target_wins_over_everything_derived():
    plan = _plan(slot_profiles=[
        {"slot": "lunch", "stance": "anchors", "calorie_min": 400, "calorie_max": 500},
    ])
    lunch = resolve_slot_targets(plan)["lunch"]

    assert (lunch["calorie_min"], lunch["calorie_max"]) == (400, 500)
    assert lunch["source"] == "plan"


def test_an_uncertain_slot_still_gets_a_number_to_aim_for():
    """
    The plan counts an uncertain meal as zero calories, which used to mean the
    block said nothing at all. Not knowing what you will eat is not the same as
    not knowing how much you need.
    """
    plan = _plan(slot_profiles=[{"slot": "dinner", "stance": "uncertain"}])
    dinner = next(s for s in slot_summary(plan) if s["slot"] == "dinner")

    assert "uncertain" in dinner["description"]
    assert "kcal" in dinner["description"]
    assert str(dinner["calorie_min"]) in dinner["description"]


def test_each_meal_block_gets_its_own_description():
    plan = _plan(slot_profiles=[
        {"slot": "lunch", "stance": "eat_out"},
        {"slot": "dinner", "stance": "uncertain"},
    ])
    described = {s["slot"]: s["description"] for s in slot_summary(plan)}

    assert len(set(described.values())) == len(described)
    assert "eat out" in described["lunch"]
    # Breakfast has an anchor, so it reports against it rather than asking for one.
    assert "Your saved breakfast" in described["breakfast"]
    assert "Nothing saved" not in described["breakfast"]


def test_backfilled_targets_cannot_round_trip_into_storage():
    """
    The read path adds derived numbers so every block has something to show. If
    those landed on calorie_min/calorie_max, a client that read the plan and
    PATCHed it back would harden a guess into a stored target.
    """
    plan = _plan()
    read = apply_slot_targets(plan)
    breakfast = next(p for p in read["slot_profiles"] if p["slot"] == "breakfast")

    assert breakfast["target_calorie_min"]
    assert breakfast["calorie_min"] is None

    saved = NutritionPlanBuilder._normalize_slot_profiles(read["slot_profiles"])
    assert all(p["calorie_min"] is None for p in saved)


def test_plans_with_no_targets_are_left_alone():
    plan = _plan(targets={})
    assert apply_slot_targets(plan)["slot_profiles"] == plan["slot_profiles"]
