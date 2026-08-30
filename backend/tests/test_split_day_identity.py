"""
Repeated day names in a split are different workouts, not the same one twice.

A split stored as ['Pull', 'Push', 'Legs', 'Pull', 'Push'] describes five
sessions. Read as bare strings the two Pull entries reconstructed identically
and then deduplicated to one, so the planner had nothing to tell Pull A from
Pull B and invented the distinction fresh on every build.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routers.workout_plan import (
    MAX_RECONSTRUCTED_EXERCISES,
    SESSIONS_PER_RECONSTRUCTED_DAY,
    _labelled_day_slots,
    _sessions_for_slot,
)

PPL = ["Pull", "Push", "Legs", "Pull", "Push"]


def test_repeated_days_become_a_and_b():
    labels = [slot["label"] for slot in _labelled_day_slots(PPL)]
    assert labels == ["Pull A", "Push A", "Legs", "Pull B", "Push B"]


def test_a_day_trained_once_keeps_its_plain_name():
    slots = _labelled_day_slots(PPL)
    legs = next(slot for slot in slots if slot["base"] == "Legs")
    assert legs["label"] == "Legs"


def test_labels_remember_the_name_they_came_from():
    """Clients still send raw split day names; the mapping has to survive."""
    slots = _labelled_day_slots(PPL)
    assert {slot["label"]: slot["base"] for slot in slots}["Pull B"] == "Pull"


def test_a_and_b_draw_on_different_sessions():
    """Otherwise both days reconstruct to the same superset."""
    sessions = [{"date": f"day-{n}"} for n in range(6)]  # newest first
    slots = _labelled_day_slots(PPL)
    pull_a = next(s for s in slots if s["label"] == "Pull A")
    pull_b = next(s for s in slots if s["label"] == "Pull B")

    a = _sessions_for_slot(sessions, pull_a)
    b = _sessions_for_slot(sessions, pull_b)

    assert a[0]["date"] == "day-0"
    assert b[0]["date"] == "day-1"
    assert not ({s["date"] for s in a} & {s["date"] for s in b})


def test_one_slot_reads_the_most_recent_sessions():
    sessions = [{"date": f"day-{n}"} for n in range(10)]
    legs = next(s for s in _labelled_day_slots(PPL) if s["label"] == "Legs")

    selected = _sessions_for_slot(sessions, legs)

    assert len(selected) == SESSIONS_PER_RECONSTRUCTED_DAY
    assert [s["date"] for s in selected] == ["day-0", "day-1", "day-2"]


def test_a_day_with_no_logged_sessions_stays_empty():
    legs = next(s for s in _labelled_day_slots(PPL) if s["label"] == "Legs")
    assert _sessions_for_slot([], legs) == []


def test_the_exercise_cap_is_small_enough_to_be_a_workout():
    """A 20-exercise reconstructed day is a log dump, not a session."""
    assert MAX_RECONSTRUCTED_EXERCISES <= 12
