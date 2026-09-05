"""
Coach chat may stage plan edits for review — field retargets and structure.

Edits never write the live plan; Accept on Plan Hub does. Under-filled plans
are fixed with replace_day_exercises / add_exercise, not by inventing a
one-lift program in free text.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.plan_edits import (
    EDIT_STATUS_APPLIED,
    EDIT_STATUS_DISMISSED,
    EDIT_STATUS_PENDING,
    MAX_EDITS,
    SET_STATUS_APPLIED,
    SET_STATUS_PENDING,
    apply_edits,
    normalize_edits,
    set_status_for,
)

PLAN = {
    "id": "plan-1",
    "version": 1,
    "days": [
        {
            "day_name": "Push A",
            "exercises": [
                {
                    "exercise_id": "default-chest-incline-db",
                    "exercise_name": "Incline Dumbbell Press",
                    "sets": 3,
                    "reps": 8,
                    "priority": "normal",
                },
                {
                    "exercise_id": "default-shoulders-db-lateral",
                    "exercise_name": "Dumbbell Lateral Raises",
                    "sets": 3,
                    "reps": 12,
                },
            ],
        },
        {
            "day_name": "Pull A",
            "exercises": [
                {
                    "exercise_id": "default-back-pullups",
                    "exercise_name": "Pull-Ups",
                    "sets": 4,
                    "reps": 6,
                }
            ],
        },
    ],
}


def test_a_rep_range_patch_is_accepted():
    accepted, rejected = normalize_edits(
        PLAN,
        [{
            "op": "set_rep_range",
            "day_name": "Push A",
            "exercise_name": "Incline Dumbbell Press",
            "value": [4, 6],
            "rationale": "Swept the top of the band twice.",
        }],
    )

    assert not rejected
    assert accepted[0]["field"] == "target_rep_range"
    assert accepted[0]["value"] == [4, 6]
    assert accepted[0]["status"] == EDIT_STATUS_PENDING
    assert "4-6 reps" in accepted[0]["title"]


def test_field_patch_on_missing_lift_is_rejected_with_add_hint():
    accepted, rejected = normalize_edits(
        PLAN,
        [{
            "op": "set_rep_range",
            "day_name": "Push A",
            "exercise_name": "Cable Rear Delt Flyes",
            "value": [10, 15],
        }],
    )

    assert accepted == []
    assert "not in the active plan" in rejected[0]["reason"]
    assert "add_exercise" in rejected[0]["reason"]


def test_add_exercise_fills_a_day():
    accepted, rejected = normalize_edits(
        PLAN,
        [{
            "op": "add_exercise",
            "day_name": "Push A",
            "exercise_name": "Cable Rear Delt Flyes",
            "value": {"sets": 3, "target_rep_range": [12, 15], "priority": "supporting"},
            "rationale": "Logged on last Push session.",
        }],
    )
    assert not rejected
    assert accepted[0]["op"] == "add_exercise"
    days, applied = apply_edits(PLAN, accepted)
    push = next(d for d in days if d["day_name"] == "Push A")
    names = [ex["exercise_name"] for ex in push["exercises"]]
    assert "Cable Rear Delt Flyes" in names
    assert len(applied) == 1
    assert PLAN["days"][0]["exercises"][0]["exercise_name"] == "Incline Dumbbell Press"


def test_replace_day_exercises_from_logged_session_shape():
    accepted, rejected = normalize_edits(
        PLAN,
        [{
            "op": "replace_day_exercises",
            "day_name": "Pull A",
            "value": [
                {"exercise_name": "Pull-Ups", "sets": 4, "target_rep_range": [5, 8], "priority": "high"},
                {"exercise_name": "Barbell Row", "sets": 3, "reps": 8},
                {"exercise_name": "Face Pulls", "sets": 3, "target_rep_range": [12, 15], "priority": "supporting"},
            ],
            "rationale": "Filled from Aug 12 Pull session.",
        }],
    )
    assert not rejected
    days, applied = apply_edits(PLAN, accepted)
    pull = next(d for d in days if d["day_name"] == "Pull A")
    assert len(pull["exercises"]) == 3
    assert pull["exercises"][1]["exercise_name"] == "Barbell Row"
    assert applied


def test_remove_exercise_and_add_day():
    accepted, rejected = normalize_edits(
        PLAN,
        [
            {"op": "remove_exercise", "day_name": "Push A", "exercise_name": "Dumbbell Lateral Raises"},
            {"op": "add_day", "value": "Legs A"},
        ],
    )
    assert not rejected
    days, applied = apply_edits(PLAN, accepted)
    push = next(d for d in days if d["day_name"] == "Push A")
    assert all(ex["exercise_name"] != "Dumbbell Lateral Raises" for ex in push["exercises"])
    assert any(d["day_name"] == "Legs A" for d in days)
    assert len(applied) == 2


def test_unknown_ops_are_rejected():
    accepted, rejected = normalize_edits(
        PLAN,
        [{"op": "rename_plan", "exercise_name": "x", "value": True}],
    )
    assert accepted == []
    assert "not a supported edit" in rejected[0]["reason"]


def test_out_of_range_values_are_rejected_not_clamped_into_nonsense():
    accepted, rejected = normalize_edits(
        PLAN,
        [{
            "op": "set_goal",
            "exercise_name": "Pull-Ups",
            "value": "powerbuilding",
        }],
    )
    assert accepted == []
    assert "not a valid value" in rejected[0]["reason"]


def test_numeric_values_are_clamped_to_sane_bounds():
    accepted, _ = normalize_edits(
        PLAN, [{"op": "set_sets", "exercise_name": "Pull-Ups", "value": 99}]
    )
    assert accepted[0]["value"] == 10


def test_a_patch_set_is_capped():
    edits = [
        {
            "op": "add_exercise",
            "day_name": "Pull A",
            "exercise_name": f"Accessory {n}",
            "value": {"sets": 3},
        }
        for n in range(1, 25)
    ]
    accepted, _ = normalize_edits(PLAN, edits)
    assert len(accepted) <= MAX_EDITS


def test_applying_an_edit_changes_only_its_field():
    accepted, _ = normalize_edits(
        PLAN,
        [{
            "op": "set_priority",
            "day_name": "Push A",
            "exercise_name": "Incline Dumbbell Press",
            "value": "high",
        }],
    )
    days, applied = apply_edits(PLAN, accepted)

    push = next(d for d in days if d["day_name"] == "Push A")
    incline = push["exercises"][0]
    assert incline["priority"] == "high"
    assert incline["sets"] == 3 and incline["reps"] == 8
    assert len(applied) == 1
    assert PLAN["days"][0]["exercises"][0]["priority"] == "normal"


def test_a_stale_edit_does_not_resurrect_a_removed_lift():
    accepted, _ = normalize_edits(
        PLAN,
        [{"op": "set_sets", "day_name": "Pull A",
          "exercise_name": "Pull-Ups", "value": 5}],
    )
    moved_on = {
        "id": "plan-1",
        "days": [{"day_name": "Pull A", "exercises": []}],
    }

    days, applied = apply_edits(moved_on, accepted)

    assert applied == []
    assert days[0]["exercises"] == []


def test_no_active_plan_is_reported_not_crashed():
    accepted, rejected = normalize_edits(None, [{"op": "set_sets", "value": 3}])
    assert accepted == []
    assert "no active training plan" in rejected[0]["reason"].lower()


def test_set_status_follows_its_edits():
    assert set_status_for([{"status": EDIT_STATUS_PENDING}]) == SET_STATUS_PENDING
    assert set_status_for([{"status": EDIT_STATUS_APPLIED}]) == SET_STATUS_APPLIED
    mixed = [{"status": EDIT_STATUS_APPLIED}, {"status": EDIT_STATUS_DISMISSED}]
    assert set_status_for(mixed) == "partially_applied"


def test_coach_and_plan_mode_both_get_the_write_tool():
    from ai_analysis.coach_tools import tools_for_mode

    def names(mode):
        return {t["function"]["name"] for t in tools_for_mode(mode)}

    assert "propose_plan_edits" in names("plan")
    assert "propose_plan_edits" in names("coach")
    assert "propose_plan_edits" not in names("nutrition")
    assert "propose_nutrition_edits" in names("nutrition")


def test_set_destination_and_clear():
    accepted, rejected = normalize_edits(
        PLAN,
        [{
            "op": "set_destination",
            "day_name": "Push A",
            "exercise_name": "Incline Dumbbell Press",
            "value": {"weight": 85, "reps": 8, "weeks": 10},
        }],
    )
    assert not rejected
    days, applied = apply_edits(PLAN, accepted)
    push = next(d for d in days if d["day_name"] == "Push A")
    incline = push["exercises"][0]
    assert incline["target_weight"] == 85.0
    assert incline["target_reps"] == 8
    assert incline["target_weeks"] == 10

    cleared, _ = normalize_edits(
        {"id": "plan-1", "days": days},
        [{
            "op": "clear_destination",
            "day_name": "Push A",
            "exercise_name": "Incline Dumbbell Press",
        }],
    )
    days2, _ = apply_edits({"id": "plan-1", "days": days}, cleared)
    incline2 = days2[0]["exercises"][0]
    assert "target_weight" not in incline2
    assert "target_reps" not in incline2


def test_required_tool_forces_sessions_on_plan_mode_open():
    from ai_analysis.ai_coach import required_tool_for_turn

    assert required_tool_for_turn("I want a stronger incline", "plan", []) == (
        "get_recent_sessions"
    )
    assert required_tool_for_turn(
        "improve my plan", "coach", [{"role": "user", "content": "hi"}]
    ) == "get_training_plan"
