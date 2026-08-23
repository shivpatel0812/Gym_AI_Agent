"""Shared test fixtures for the progression engine test suite."""

import sys
import os
from datetime import datetime, timedelta
from typing import List, Dict, Optional

import pytest

# Ensure backend is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
# ...and the tests directory itself, so shared helpers like `fakes` import by
# name from any test module regardless of how pytest was invoked.
sys.path.insert(0, os.path.dirname(__file__))

from ai_analysis.workout_recommender.progression_engine import ProgressionEngine
from ai_analysis.workout_recommender.goal_configs import get_goal_config


@pytest.fixture
def engine():
    """Fresh ProgressionEngine instance."""
    return ProgressionEngine()


def build_session(
    weight: float,
    reps: List[int],
    days_ago: int = 0,
    difficulty: Optional[List[str]] = None,
    completed: Optional[List[bool]] = None,
) -> Dict:
    """
    Build a synthetic session dict for testing.

    Args:
        weight: Weight used for all sets
        reps: List of reps per set (length = number of sets)
        days_ago: How many days ago this session occurred
        difficulty: Optional per-set difficulty ratings
        completed: Optional per-set completion flags
    """
    date = (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    sets = []
    for i, r in enumerate(reps):
        s = {"weight": weight, "reps": r, "set_number": i + 1}
        if difficulty and i < len(difficulty):
            s["difficulty"] = difficulty[i]
        if completed and i < len(completed):
            s["completed"] = completed[i]
        sets.append(s)
    return {"date": date, "sets": sets}


def build_sessions_sequence(
    sequence: List[tuple],
    start_days_ago: int = 21,
    gap_days: int = 3,
) -> List[Dict]:
    """
    Build a sequence of sessions going from oldest to most recent.

    Args:
        sequence: List of (weight, [reps]) tuples, oldest first
        start_days_ago: Days ago for the first session
        gap_days: Days between each session

    Returns:
        List of session dicts, most recent first (as the engine expects)
    """
    sessions = []
    for i, (weight, reps) in enumerate(sequence):
        days_ago = start_days_ago - (i * gap_days)
        if days_ago < 0:
            days_ago = 0
        sessions.append(build_session(weight, reps, days_ago=days_ago))
    # Return most recent first
    sessions.reverse()
    return sessions
