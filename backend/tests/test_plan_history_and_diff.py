"""
Reading the user's real training, and showing what a proposal would replace.

Both cover failures taken from live data: a Legs day that reconstructed to zero
exercises because no session was ever labelled "Legs", a Push day that
reconstructed to twenty because pull work was logged under it, and a two-day
proposal that replaced a five-day plan while the review screen showed only the
two days it contained.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.plan_diff import diff_plans
from ai_analysis.training_history import (
    build_exercise_catalog,
    build_history_context,
    coverage_gaps,
    mislabelled_exercises,
    name_to_id_map,
)


def _session(date, day, *exercises):
    return {
        "date": date,
        "split_day": day,
        "exercises": [
            {
                "exercise_id": ex_id,
                "exercise_name": name,
                "sets": [{"weight": weight, "reps": reps}],
            }
            for ex_id, name, weight, reps in exercises
        ],
    }


BENCH = ("default-chest-incline-db", "Incline Dumbbell Press", 80, 8)
PULLUP = ("default-back-pullups", "Pull-Ups", 35, 6)
CURL = ("default-biceps-db-curl", "Dumbbell Curls", 30, 10)
CUSTOM = ("custom-bayesian-1", "Bayesian cable cork", 20, 12)

SESSIONS = [
    _session("2026-08-26", "Push", BENCH, PULLUP, CURL),
    _session("2026-08-24", "Pull", PULLUP, CURL),
    _session("2026-08-20", "Push", BENCH, CUSTOM),
    _session("2026-08-14", "Push", BENCH),
]


def test_catalog_counts_every_session_regardless_of_label():
    catalog = build_exercise_catalog(SESSIONS, today=_today())

    by_name = {entry["exercise_name"]: entry for entry in catalog}
    assert by_name["Incline Dumbbell Press"]["sessions"] == 3
    # Logged under Push twice and Pull once — all three still counted
    assert by_name["Pull-Ups"]["sessions"] == 2
    assert by_name["Incline Dumbbell Press"]["last_trained"] == "2026-08-26"


def test_catalog_records_the_heaviest_set():
    catalog = build_exercise_catalog(SESSIONS, today=_today())
    bench = next(e for e in catalog if e["exercise_name"] == "Incline Dumbbell Press")
    assert bench["best_set"]["weight"] == 80
    assert bench["best_set"]["reps"] == 8


def test_untrained_muscle_groups_are_named():
    """The whole reason a Legs day could vanish without anyone being told."""
    coverage = coverage_gaps(build_exercise_catalog(SESSIONS, today=_today()))

    assert "LEGS" in coverage["untrained"]
    assert coverage["trains_lower_body"] is False
    assert coverage["lower_body_sessions"] == 0


def test_mislabelled_exercises_are_reported_not_trusted():
    confused = mislabelled_exercises(build_exercise_catalog(SESSIONS, today=_today()))

    names = {entry["exercise_name"] for entry in confused}
    assert "Pull-Ups" in names, "a lift logged under two days should be flagged"
    pullups = next(e for e in confused if e["exercise_name"] == "Pull-Ups")
    assert set(pullups["logged_under_days"]) == {"Push", "Pull"}


def test_custom_exercises_get_an_id_mapping():
    """Custom lifts are absent from the 135-entry catalog and were dropped."""
    mapping = name_to_id_map(build_exercise_catalog(SESSIONS, today=_today()))
    assert mapping["bayesian cable cork"] == "custom-bayesian-1"


def test_history_context_bundles_what_the_prompt_needs():
    context = build_history_context(SESSIONS, today=_today())
    assert context["exercises"]
    assert "LEGS" in context["coverage"]["untrained"]
    assert context["labels_to_distrust"]


def _today():
    from datetime import datetime

    return datetime(2026, 8, 30)


# --- diff -----------------------------------------------------------------


def _day(name, *exercise_names, sets=3, reps=8):
    return {
        "day_name": name,
        "exercises": [
            {"exercise_id": f"id-{n.lower()}", "exercise_name": n,
             "sets": sets, "reps": reps}
            for n in exercise_names
        ],
    }


FIVE_DAY = {
    "weekly_schedule": {
        "monday": "Pull A", "tuesday": "Push A", "wednesday": "Legs",
        "thursday": "Pull B", "friday": "Push B", "saturday": "Rest", "sunday": "Rest",
    },
    "days": [
        _day("Pull A", "Pull-Ups", "Dumbbell Rows"),
        _day("Push A", "Incline Dumbbell Press", "Dips"),
        _day("Legs", "Back Squats", "Leg Press"),
        _day("Pull B", "Lat Pulldowns"),
        _day("Push B", "Chest Press Machine"),
    ],
}

TWO_DAY = {
    "weekly_schedule": {
        "monday": "Push A", "tuesday": "Pull A", "wednesday": "Rest",
        "thursday": "Rest", "friday": "Rest", "saturday": "Rest", "sunday": "Rest",
    },
    "days": [
        _day("Push A", "Incline Dumbbell Press", "Dips"),
        _day("Pull A", "Pull-Ups", "Dumbbell Rows"),
    ],
}


def test_a_proposal_that_deletes_days_is_marked_destructive():
    diff = diff_plans(FIVE_DAY, TWO_DAY)

    assert diff["is_destructive"] is True
    assert sorted(diff["removed_days"]) == ["Legs", "Pull B", "Push B"]
    assert "Legs" in diff["summary"]


def test_an_additive_revision_is_not_destructive():
    proposed = {
        "weekly_schedule": FIVE_DAY["weekly_schedule"],
        "days": FIVE_DAY["days"] + [_day("Arms", "Rope Hammer Curls")],
    }
    diff = diff_plans(FIVE_DAY, proposed)

    assert diff["is_destructive"] is False
    assert diff["added_days"] == ["Arms"]


def test_exercise_level_changes_are_itemised():
    proposed = {
        "weekly_schedule": FIVE_DAY["weekly_schedule"],
        "days": [
            _day("Pull A", "Pull-Ups", "Cable Rows"),
            _day("Push A", "Incline Dumbbell Press", "Dips", sets=4, reps=5),
            _day("Legs", "Back Squats", "Leg Press"),
            _day("Pull B", "Lat Pulldowns"),
            _day("Push B", "Chest Press Machine"),
        ],
    }
    diff = diff_plans(FIVE_DAY, proposed)

    assert diff["is_destructive"] is False
    pull_a = next(d for d in diff["days"] if d["day_name"] == "Pull A")
    assert pull_a["added"] == ["Cable Rows"]
    assert pull_a["removed"] == ["Dumbbell Rows"]

    push_a = next(d for d in diff["days"] if d["day_name"] == "Push A")
    assert push_a["retargeted"][0]["from"] == "3 x 8"
    assert push_a["retargeted"][0]["to"] == "4 x 5"


def test_schedule_moves_are_reported():
    diff = diff_plans(FIVE_DAY, TWO_DAY)
    moved = {change["weekday"]: (change["from"], change["to"]) for change in diff["schedule_changes"]}
    assert moved["monday"] == ("Pull A", "Push A")
    assert moved["wednesday"] == ("Legs", "Rest")


def test_a_first_plan_replaces_nothing():
    diff = diff_plans(None, TWO_DAY)
    assert diff["is_first_plan"] is True
    assert diff["is_destructive"] is False
    assert diff["removed_days"] == []
