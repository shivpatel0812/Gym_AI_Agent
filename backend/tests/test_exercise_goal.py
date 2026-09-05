"""
Plan Mode, re-entered for one exercise.

The spec asks for a guided flow whose "answers map directly to plan fields — no
inference required", so a user can flip a single lift from maintaining to
building without redoing the program. Previously the only route was a sentence
dropped into coach chat, where the change depended on the model reading the
prose correctly.

These cover the mapping and the guard rails; the endpoint itself reuses the
already-tested normalize_edits / apply_edits path.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.plan_edits import apply_edits, normalize_edits

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
                    "goal": "hypertrophy",
                },
                {
                    "exercise_id": "default-shoulders-db-lateral",
                    "exercise_name": "Dumbbell Lateral Raises",
                    "sets": 3,
                    "reps": 12,
                    "priority": "supporting",
                },
            ],
        }
    ],
}

ROLE_TO_PRIORITY = {"building": "high", "maintaining": "normal", "support": "supporting"}


def edits_for(role=None, goal=None, rep_range=None, exercise="Incline Dumbbell Press"):
    """Mirrors how the endpoint turns typed fields into edit ops."""
    out = []
    if role:
        out.append({"op": "set_priority", "day_name": "Push A", "exercise_name": exercise,
                    "value": ROLE_TO_PRIORITY[role]})
    if goal:
        out.append({"op": "set_goal", "day_name": "Push A", "exercise_name": exercise,
                    "value": goal})
    if rep_range:
        out.append({"op": "set_rep_range", "day_name": "Push A", "exercise_name": exercise,
                    "value": rep_range})
    return out


def test_building_maps_to_high_priority():
    accepted, rejected = normalize_edits(PLAN, edits_for(role="building"))
    assert not rejected
    assert accepted[0]["field"] == "priority"
    assert accepted[0]["value"] == "high"


def test_maintaining_and_support_map_to_their_own_priorities():
    maintaining, _ = normalize_edits(PLAN, edits_for(role="maintaining"))
    support, _ = normalize_edits(PLAN, edits_for(role="support"))
    assert maintaining[0]["value"] == "normal"
    assert support[0]["value"] == "supporting"


def test_a_full_revision_applies_every_field_at_once():
    accepted, rejected = normalize_edits(
        PLAN, edits_for(role="building", goal="strength", rep_range=[4, 6])
    )
    assert not rejected
    days, applied = apply_edits(PLAN, accepted)

    incline = days[0]["exercises"][0]
    assert incline["priority"] == "high"
    assert incline["goal"] == "strength"
    assert incline["target_rep_range"] == [4, 6]
    assert len(applied) == 3


def test_only_the_named_exercise_changes():
    accepted, _ = normalize_edits(PLAN, edits_for(role="building"))
    days, _ = apply_edits(PLAN, accepted)

    lateral = days[0]["exercises"][1]
    assert lateral["priority"] == "supporting", "an untouched lift was modified"
    assert PLAN["days"][0]["exercises"][0]["priority"] == "normal", "the live plan was mutated"


def test_revising_an_exercise_that_is_not_in_the_plan_is_refused():
    accepted, rejected = normalize_edits(
        PLAN, edits_for(role="building", exercise="Back Squats")
    )
    assert accepted == []
    assert "not in the active plan" in rejected[0]["reason"]


def test_a_reversed_rep_range_is_normalised_rather_than_stored_backwards():
    accepted, _ = normalize_edits(PLAN, edits_for(rep_range=[10, 6]))
    assert accepted[0]["value"] == [6, 10]


def test_structure_ops_can_fill_or_trim_a_day_when_staged():
    """
    Structure patches are allowed but still reviewable — they never write live
    until Accept. That is how "improve my plan" fills under-filled days.
    """
    accepted, rejected = normalize_edits(PLAN, [
        {"op": "remove_exercise", "day_name": "Push A",
         "exercise_name": "Incline Dumbbell Press"},
        {"op": "add_exercise", "day_name": "Push A",
         "exercise_name": "Weighted Dips",
         "value": {"sets": 3, "target_rep_range": [6, 10], "priority": "high"}},
    ])
    assert not rejected
    assert {e["op"] for e in accepted} == {"remove_exercise", "add_exercise"}
    days, applied = apply_edits(PLAN, accepted)
    push = next(d for d in days if d["day_name"] == "Push A")
    names = [ex["exercise_name"] for ex in push["exercises"]]
    assert "Incline Dumbbell Press" not in names
    assert "Weighted Dips" in names
    assert len(applied) == 2
    # Live plan untouched until Accept
    assert PLAN["days"][0]["exercises"][0]["exercise_name"] == "Incline Dumbbell Press"
