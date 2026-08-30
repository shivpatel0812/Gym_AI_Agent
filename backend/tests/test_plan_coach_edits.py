"""
Coach chat may retune a lift. It may not restructure the program.

The split matters because the two inputs have different reliability: Plan Mode
is a guided conversation whose answers map onto plan fields, while coach chat
is freeform and happens mid-workout. Letting the second one add and remove
exercises is how a chat about one bad set quietly rewrites a program.
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


def test_the_coach_cannot_add_an_exercise():
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


def test_structural_ops_do_not_exist():
    accepted, rejected = normalize_edits(
        PLAN,
        [
            {"op": "remove_exercise", "exercise_name": "Pull-Ups", "value": True},
            {"op": "add_day", "exercise_name": "Legs", "value": "Legs"},
        ],
    )

    assert accepted == []
    assert all("not a supported edit" in r["reason"] for r in rejected)


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
        {"op": "set_sets", "exercise_name": "Pull-Ups", "value": n}
        for n in range(1, 12)
    ]
    accepted, _ = normalize_edits(PLAN, edits)
    # Same exercise + op collapses to one; the cap still holds generally
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
    # The original plan is untouched until the caller persists
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


def test_plan_mode_gets_the_write_tool_and_coach_mode_does_not():
    from ai_analysis.coach_tools import tools_for_mode

    def names(mode):
        return {t["function"]["name"] for t in tools_for_mode(mode)}

    assert "propose_plan_edits" in names("plan")
    assert "propose_plan_edits" not in names("coach")
    assert "propose_plan_edits" not in names("nutrition")
