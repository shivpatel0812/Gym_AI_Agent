"""Coach-proposed nutrition plan edits: normalization, safety, and apply."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from nutrition.plan_builder import NutritionPlanBuilder
from nutrition.plan_edits import (
    EDIT_STATUS_APPLIED,
    EDIT_STATUS_DISMISSED,
    EDIT_STATUS_PENDING,
    EDIT_STATUS_STALE,
    MAX_EDITS,
    MIN_CALORIES,
    SET_STATUS_APPLIED,
    SET_STATUS_PARTIALLY_APPLIED,
    SET_STATUS_PENDING,
    apply_edits,
    normalize_edits,
    pending_count,
    set_status_for,
)


def build_plan():
    """A validated active plan, so every list item carries a real id."""
    plan = NutritionPlanBuilder.validate_plan({
        "goal": "muscle",
        "targets": {"calories": 2800, "protein": 180, "carbs": 300, "fats": 90, "fiber": 30},
        "strategy": "Eat to support the incline press block.",
        "meal_anchors": [
            {
                "slot": "breakfast",
                "label": "Breakfast",
                "frequency": "daily",
                "foods": [
                    {"name": "Greek yogurt", "calories": 150, "protein": 20},
                    {"name": "oatmeal", "calories": 300, "protein": 10},
                ],
            },
            {
                "slot": "shake",
                "label": "Protein shake",
                "frequency": "daily",
                "foods": [{"name": "protein shake", "calories": 200, "protein": 30}],
            },
        ],
        "flexible_meals": [
            {"name": "Family dinner", "frequency": "most_days",
             "calorie_min": 600, "calorie_max": 900},
        ],
        "go_to_items": [
            {"name": "Greek yogurt", "slot": "snack", "calories": 150, "protein": 20},
        ],
    })
    plan["id"] = "plan_1"
    plan["version"] = 3
    return plan


def anchor_id(plan, label):
    return next(a["id"] for a in plan["meal_anchors"] if a["label"] == label)


# --- normalize ------------------------------------------------------------

def test_update_targets_builds_a_reviewable_diff():
    plan = build_plan()
    edits, rejected = normalize_edits(plan, [
        {"op": "update_targets", "payload": {"calories": 2600, "protein": 190},
         "rationale": "Small cut while keeping protein up"},
    ])

    assert rejected == []
    assert len(edits) == 1
    edit = edits[0]
    assert edit["op"] == "update_targets"
    assert edit["payload"] == {"calories": 2600.0, "protein": 190.0}
    # The before snapshot is what makes a scoped diff possible on the plan page
    assert edit["before"]["calories"] == 2800
    assert edit["status"] == EDIT_STATUS_PENDING
    assert "2,600 kcal" in edit["title"]


def test_sub_floor_calorie_target_is_rejected_not_clamped():
    plan = build_plan()
    edits, rejected = normalize_edits(plan, [
        {"op": "update_targets", "payload": {"calories": 900}},
    ])

    # validate_plan would silently clamp this to 1200. A stored, one-tap edit
    # must not become a different number than the coach described.
    assert edits == []
    assert any(str(MIN_CALORIES) in r for r in rejected)


def test_update_anchor_merges_onto_the_existing_item():
    plan = build_plan()
    target = anchor_id(plan, "Breakfast")
    edits, rejected = normalize_edits(plan, [
        {"op": "update_meal_anchor", "target_id": target,
         "payload": {"foods": [{"name": "Greek yogurt", "calories": 150, "protein": 20}]},
         "rationale": "Drop the oats"},
    ])

    assert rejected == []
    assert edits[0]["payload"]["id"] == target
    assert edits[0]["payload"]["slot"] == "breakfast"  # untouched fields survive
    assert [f["name"] for f in edits[0]["payload"]["foods"]] == ["Greek yogurt"]
    assert edits[0]["title"] == "Update Breakfast"


def test_edit_targeting_an_unknown_item_is_rejected():
    plan = build_plan()
    edits, rejected = normalize_edits(plan, [
        {"op": "update_meal_anchor", "target_id": "nope", "payload": {"label": "Brunch"}},
        {"op": "remove_go_to", "target_id": "also-nope"},
    ])

    # Falling back to "add it then" would be a silent write of an item the
    # user never reviewed.
    assert edits == []
    assert len(rejected) == 2


def test_unknown_ops_are_dropped_and_the_set_is_capped():
    plan = build_plan()
    edits, rejected = normalize_edits(plan, (
        [{"op": "delete_everything"}]
        + [{"op": "add_go_to", "payload": {"name": f"Snack {i}", "slot": "snack"}}
           for i in range(MAX_EDITS + 3)]
    ))

    assert len(edits) == MAX_EDITS
    assert any("unknown op" in r for r in rejected)
    assert any("too many" in r for r in rejected)


def test_add_anchor_is_normalized_and_gets_an_id():
    plan = build_plan()
    edits, _ = normalize_edits(plan, [
        {"op": "add_meal_anchor",
         "payload": {"slot": "pre_workout", "label": "Post-workout shake",
                     "frequency": "daily",
                     "foods": [{"name": "whey + banana", "calories": 320, "protein": 35}]}},
    ])

    assert edits[0]["payload"]["id"]
    assert edits[0]["before"] is None
    assert edits[0]["title"] == "Add Post-workout shake: whey + banana"


# --- apply ----------------------------------------------------------------

def test_apply_produces_a_patch_the_normal_validator_accepts():
    plan = build_plan()
    target = anchor_id(plan, "Breakfast")
    edits, _ = normalize_edits(plan, [
        {"op": "update_targets", "payload": {"calories": 2600}},
        {"op": "remove_meal_anchor", "target_id": target},
        {"op": "add_go_to", "payload": {"name": "Cottage cheese", "slot": "snack",
                                        "calories": 180, "protein": 24}},
    ])

    patch, outcomes = apply_edits(plan, edits)
    assert set(outcomes.values()) == {EDIT_STATUS_APPLIED}

    validated = NutritionPlanBuilder.validate_plan({**plan, **patch})
    assert validated["targets"]["calories"] == 2600
    assert all(a["label"] != "Breakfast" for a in validated["meal_anchors"])
    assert any(g["name"] == "Cottage cheese" for g in validated["go_to_items"])
    # Untouched parts of the plan survive the merge
    assert any(a["label"] == "Protein shake" for a in validated["meal_anchors"])


def test_edits_to_an_item_deleted_since_proposal_go_stale():
    plan = build_plan()
    target = anchor_id(plan, "Breakfast")
    edits, _ = normalize_edits(plan, [
        {"op": "update_meal_anchor", "target_id": target, "payload": {"label": "Brunch"}},
    ])

    # The user removes that anchor by hand before accepting the suggestion
    moved_on = {**plan, "meal_anchors": [a for a in plan["meal_anchors"] if a["id"] != target]}
    patch, outcomes = apply_edits(moved_on, edits)

    assert patch == {}
    assert list(outcomes.values()) == [EDIT_STATUS_STALE]


def test_accepting_the_same_add_twice_does_not_duplicate_it():
    plan = build_plan()
    edits, _ = normalize_edits(plan, [
        {"op": "add_go_to", "payload": {"name": "Cottage cheese", "slot": "snack"}},
    ])

    patch, _ = apply_edits(plan, edits)
    after = {**plan, **patch}
    patch_again, outcomes = apply_edits(after, edits)

    assert list(outcomes.values()) == [EDIT_STATUS_STALE]
    assert patch_again == {}


def test_two_edits_on_one_list_both_land_in_a_single_patch():
    plan = build_plan()
    target = anchor_id(plan, "Protein shake")
    edits, _ = normalize_edits(plan, [
        {"op": "update_meal_anchor", "target_id": target, "payload": {"label": "PWO shake"}},
        {"op": "add_meal_anchor", "payload": {"slot": "snack", "label": "Evening yogurt",
                                              "foods": [{"name": "Greek yogurt"}]}},
    ])

    patch, outcomes = apply_edits(plan, edits)
    labels = [a["label"] for a in patch["meal_anchors"]]

    assert set(outcomes.values()) == {EDIT_STATUS_APPLIED}
    assert "PWO shake" in labels and "Evening yogurt" in labels
    assert len(patch["meal_anchors"]) == 3


def test_partial_apply_leaves_the_rest_pending():
    plan = build_plan()
    edits, _ = normalize_edits(plan, [
        {"op": "update_targets", "payload": {"calories": 2600}},
        {"op": "add_go_to", "payload": {"name": "Cottage cheese", "slot": "snack"}},
    ])

    _, outcomes = apply_edits(plan, edits[:1])
    marked = [{**e, "status": outcomes.get(e["id"], e["status"])} for e in edits]

    assert set_status_for(marked) == SET_STATUS_PARTIALLY_APPLIED
    assert pending_count({"edits": marked}) == 1


def test_set_status_tracks_its_edits():
    assert set_status_for([{"status": EDIT_STATUS_PENDING}]) == SET_STATUS_PENDING
    assert set_status_for([{"status": EDIT_STATUS_APPLIED}]) == SET_STATUS_APPLIED
    assert set_status_for(
        [{"status": EDIT_STATUS_APPLIED}, {"status": EDIT_STATUS_DISMISSED}]
    ) == SET_STATUS_APPLIED
    # Nothing accepted and nothing left to review reads as dismissed
    assert set_status_for([{"status": EDIT_STATUS_DISMISSED}]) != SET_STATUS_PENDING


def test_apply_re_checks_the_calorie_floor():
    """A stored edit must not become unsafe because the plan moved under it."""
    plan = build_plan()
    edits, _ = normalize_edits(plan, [{"op": "update_targets", "payload": {"protein": 200}}])
    # Something else dropped the plan's calories in the meantime
    lowered = {**plan, "targets": {**plan["targets"], "calories": 800}}

    patch, outcomes = apply_edits(lowered, edits)
    assert list(outcomes.values()) == [EDIT_STATUS_STALE]
    assert patch == {}
