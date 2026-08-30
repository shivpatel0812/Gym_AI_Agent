"""
A plan revision must not delete the days the conversation never mentioned.

The failure this pins down is real and shipped: a user asked the coach to
import one logged Push workout and one logged Pull workout into their live
five-day plan. Because `/propose` built every plan from the conversation alone,
the result was a two-day plan — Legs, Pull B and Push B were not removed on
purpose, they were simply never in scope — and it silently replaced the plan
the user was training on.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.plan_builder import PlanBuilder


def _day(name, *exercise_names):
    return {
        "day_name": name,
        "focus": name,
        "exercises": [
            {
                # Derived from the name, as real ids are. An index-based id
                # would make every day's first exercise identical and let any
                # two days look like the same one.
                "exercise_id": f"default-{exercise_name.lower().replace(' ', '-')}",
                "exercise_name": exercise_name,
                "sets": 3,
                "reps": 8,
                "order": i + 1,
            }
            for i, exercise_name in enumerate(exercise_names)
        ],
    }


# The five-day plan that was live, and the two-day proposal that replaced it.
EXISTING = {
    "plan_name": "Incline & Pull Mastery 2.0",
    "weekly_schedule": {
        "monday": "Pull A", "tuesday": "Push A", "wednesday": "Legs",
        "thursday": "Pull B", "friday": "Push B",
        "saturday": "Rest", "sunday": "Rest",
    },
    "days": [
        _day("Pull A", "Pull-Ups", "Single-Arm Cable Rows"),
        _day("Push A", "Incline Dumbbell Press", "Cable Chest Fly (Mid)"),
        _day("Legs", "Back Squats", "Leg Press", "Leg Curls"),
        _day("Pull B", "Lat Pulldowns", "Dumbbell Rows"),
        _day("Push B", "Chest Press Machine", "Tricep Pushdowns"),
    ],
}


def _proposal():
    return {
        "plan_name": "Focused Muscle Growth",
        "weekly_schedule": {
            "monday": "Push A", "tuesday": "Pull A", "wednesday": "Rest",
            "thursday": "Rest", "friday": "Rest", "saturday": "Rest", "sunday": "Rest",
        },
        "days": [
            _day("Push A", "Incline Dumbbell Press", "Parallel Bar Dips"),
            _day("Pull A", "Lat Pulldowns", "Pull-Ups"),
        ],
        "changes": [],
    }


def test_unmentioned_days_survive_a_revision():
    plan = PlanBuilder.carry_forward_days(_proposal(), EXISTING)

    names = [day["day_name"] for day in plan["days"]]
    assert names.count("Legs") == 1, "the day the conversation never mentioned was deleted"
    assert set(names) == {"Push A", "Pull A", "Legs", "Pull B", "Push B"}


def test_carried_days_keep_their_exercises():
    plan = PlanBuilder.carry_forward_days(_proposal(), EXISTING)

    legs = next(day for day in plan["days"] if day["day_name"] == "Legs")
    assert [ex["exercise_name"] for ex in legs["exercises"]] == [
        "Back Squats", "Leg Press", "Leg Curls"
    ]


def test_carried_days_get_their_weekday_back():
    """A day nothing schedules is present but never trained, which is no fix."""
    plan = PlanBuilder.carry_forward_days(_proposal(), EXISTING)

    schedule = plan["weekly_schedule"]
    assert schedule["wednesday"] == "Legs"
    assert schedule["thursday"] == "Pull B"
    assert schedule["friday"] == "Push B"
    # Days the proposal did assign are not disturbed
    assert schedule["monday"] == "Push A"
    assert schedule["tuesday"] == "Pull A"


def test_carrying_forward_is_reported_not_silent():
    plan = PlanBuilder.carry_forward_days(_proposal(), EXISTING)

    assert sorted(plan["carried_forward_days"]) == ["Legs", "Pull B", "Push B"]
    preserved = {
        change["day_name"] for change in plan["changes"]
        if change["action"] == "preserved"
    }
    assert preserved == {"Legs", "Pull B", "Push B"}


def test_explicit_removal_still_removes():
    """Otherwise a user could never drop a day again."""
    proposal = _proposal()
    proposal["changes"] = [
        {"action": "removed", "day_name": "Legs", "exercise_name": None,
         "reason": "User asked to drop the leg day while injured."}
    ]

    plan = PlanBuilder.carry_forward_days(proposal, EXISTING)

    names = [day["day_name"] for day in plan["days"]]
    assert "Legs" not in names
    assert "Pull B" in names, "an unrelated day was removed along with it"


def test_removing_an_exercise_does_not_remove_its_day():
    """`removed` naming an exercise is a lift change, not a day deletion."""
    proposal = _proposal()
    proposal["changes"] = [
        {"action": "removed", "day_name": "Legs", "exercise_name": "Leg Curls",
         "reason": "Swapped for a different hamstring movement."}
    ]

    plan = PlanBuilder.carry_forward_days(proposal, EXISTING)

    assert "Legs" in [day["day_name"] for day in plan["days"]]


def test_a_day_the_proposal_rebuilt_is_not_duplicated():
    plan = PlanBuilder.carry_forward_days(_proposal(), EXISTING)

    names = [day["day_name"] for day in plan["days"]]
    assert names.count("Push A") == 1
    push_a = next(day for day in plan["days"] if day["day_name"] == "Push A")
    assert [ex["exercise_name"] for ex in push_a["exercises"]] == [
        "Incline Dumbbell Press", "Parallel Bar Dips"
    ], "the revision's own version of the day should win"


def test_first_plan_is_untouched():
    """With no plan yet there is nothing to carry, and nothing to report."""
    proposal = _proposal()
    plan = PlanBuilder.carry_forward_days(proposal, None)

    assert [day["day_name"] for day in plan["days"]] == ["Push A", "Pull A"]
    assert "carried_forward_days" not in plan
    assert plan["changes"] == []


def test_a_renamed_day_is_not_duplicated():
    """
    Seen live: the model returned "Pull" where the plan had "Pull A", with the
    same exercises. Name-only matching restored "Pull A" beside it, producing
    two near-identical days, one of which no weekday scheduled.
    """
    proposal = {
        "plan_name": "Revision",
        "weekly_schedule": {
            "monday": "Push A", "tuesday": "Pull", "wednesday": "Legs",
            "thursday": "Rest", "friday": "Rest", "saturday": "Rest", "sunday": "Rest",
        },
        "days": [
            _day("Push A", "Incline Dumbbell Press", "Cable Chest Fly (Mid)"),
            _day("Pull", "Pull-Ups", "Single-Arm Cable Rows"),
        ],
        "changes": [],
    }

    plan = PlanBuilder.carry_forward_days(proposal, EXISTING)

    names = [day["day_name"] for day in plan["days"]]
    assert "Pull A" not in names, "the renamed day was restored as a duplicate"
    assert names.count("Pull") == 1
    # Everything genuinely absent is still rescued
    assert {"Legs", "Pull B", "Push B"} <= set(names)


def test_one_proposed_day_cannot_absorb_two_existing_days():
    """
    Collapsing two training days into one is a real structural change.

    Both existing pull days here overlap the single proposed "Pull" enough to
    look like a rename of it. Only one may be treated that way; silently
    absorbing both would delete a day the user trains.
    """
    existing = {
        "weekly_schedule": {"monday": "Pull A", "thursday": "Pull B"},
        "days": [
            _day("Pull A", "Pull-Ups", "Dumbbell Rows"),
            _day("Pull B", "Pull-Ups", "Dumbbell Rows", "Lat Pulldowns"),
        ],
    }
    proposal = {
        "plan_name": "Revision",
        "weekly_schedule": {"monday": "Pull", "tuesday": "Rest", "wednesday": "Rest",
                            "thursday": "Rest", "friday": "Rest", "saturday": "Rest",
                            "sunday": "Rest"},
        "days": [_day("Pull", "Pull-Ups", "Dumbbell Rows")],
        "changes": [],
    }

    plan = PlanBuilder.carry_forward_days(proposal, existing)

    names = [day["day_name"] for day in plan["days"]]
    assert names.count("Pull") == 1
    # Exactly one of the two was recognised as the rename; the other survives.
    survivors = {"Pull A", "Pull B"} & set(names)
    assert len(survivors) == 1, f"expected one day carried forward, got {names}"


def test_a_renamed_day_frees_the_weekday_it_no_longer_needs():
    """A rename must not leave the old name squatting on a weekday."""
    proposal = {
        "plan_name": "Revision",
        "weekly_schedule": {
            "monday": "Push A", "tuesday": "Pull", "wednesday": "Legs",
            "thursday": "Rest", "friday": "Rest", "saturday": "Rest", "sunday": "Rest",
        },
        "days": [
            _day("Push A", "Incline Dumbbell Press", "Cable Chest Fly (Mid)"),
            _day("Pull", "Pull-Ups", "Single-Arm Cable Rows"),
        ],
        "changes": [],
    }

    plan = PlanBuilder.carry_forward_days(proposal, EXISTING)

    scheduled = set(plan["weekly_schedule"].values())
    assert "Pull A" not in scheduled
    assert "Pull" in scheduled
    # Every day in the plan is reachable from the schedule
    for day in plan["days"]:
        assert day["day_name"] in scheduled, f"{day['day_name']} is never trained"


def test_a_different_day_with_the_same_name_shape_is_not_a_rename():
    """Push must never absorb Pull just because both went missing."""
    proposal = {
        "plan_name": "Revision",
        "weekly_schedule": {"monday": "Push", "tuesday": "Rest", "wednesday": "Rest",
                            "thursday": "Rest", "friday": "Rest", "saturday": "Rest",
                            "sunday": "Rest"},
        "days": [_day("Push", "Incline Dumbbell Press", "Dips")],
        "changes": [],
    }

    plan = PlanBuilder.carry_forward_days(proposal, EXISTING)

    names = [day["day_name"] for day in plan["days"]]
    assert "Pull A" in names, "a pull day was absorbed by a push day"
