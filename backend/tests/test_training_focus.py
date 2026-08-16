"""Tests for per-exercise training focus — config override, engine wiring, store."""

import sys
import os
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.workout_recommender.goal_configs import (
    resolve_goal_config,
    is_known_goal,
    get_goal_config,
)
from ai_analysis.workout_recommender.progression_engine import Decision
from ai_analysis.workout_recommender.training_focus import TrainingFocusStore

from tests.conftest import build_session


class TestIsKnownGoal:
    def test_accepts_canonical_and_alias_forms(self):
        assert is_known_goal("strength")
        assert is_known_goal("Build Muscle")
        assert is_known_goal("get stronger")
        assert is_known_goal("  strength  ")

    def test_rejects_unknown_and_empty(self):
        assert not is_known_goal("bench press")
        assert not is_known_goal("")
        assert not is_known_goal(None)


class TestResolveGoalConfig:
    def test_no_focus_uses_profile_goal(self):
        assert resolve_goal_config("Build Muscle", None).name == "hypertrophy"
        assert resolve_goal_config("Get Stronger", None).name == "strength"

    def test_focus_overrides_profile_goal(self):
        assert resolve_goal_config("Build Muscle", "strength").name == "strength"
        assert resolve_goal_config("Get Stronger", "hypertrophy").name == "hypertrophy"

    def test_unknown_focus_is_ignored_not_defaulted(self):
        """A typo must not silently drop the user onto the default goal."""
        assert resolve_goal_config("Lose Fat", "mega-strength").name == "fat_loss"
        assert resolve_goal_config("Lose Fat", "").name == "fat_loss"
        assert resolve_goal_config("Get Stronger", "nonsense").name == "strength"


class TestEngineFocusBehaviour:
    """Identical history; only the focus differs."""

    HISTORY = [build_session(185, [8, 8, 8], days_ago=2),
               build_session(185, [7, 7, 6], days_ago=9)]

    def _run(self, engine, user_goal, focus_goal=None):
        return engine.compute_recommendation(
            exercise_id="bench_press",
            exercise_name="Barbell Bench Press",
            user_goal=user_goal,
            recent_sessions=self.HISTORY,
            num_sets=3,
            focus_goal=focus_goal,
        )

    def test_strength_focus_changes_the_recommendation(self, engine):
        plain = self._run(engine, "Build Muscle")
        focused = self._run(engine, "Build Muscle", "strength")

        # Hypertrophy adds reps inside 6-10; strength moves to 3-6 and loads
        assert plain.decision == Decision.INCREASE_REPS
        assert focused.decision == Decision.INCREASE_WEIGHT
        assert focused.sets[0].weight > plain.sets[0].weight
        assert focused.sets[0].reps < plain.sets[0].reps

    def test_focus_matches_a_native_user_of_that_goal(self, engine):
        """A focused hypertrophy user should train that lift like a strength user."""
        focused = self._run(engine, "Build Muscle", "strength")
        native = self._run(engine, "Get Stronger")

        assert focused.decision == native.decision
        assert [s.weight for s in focused.sets] == [s.weight for s in native.sets]
        assert [s.reps for s in focused.sets] == [s.reps for s in native.sets]

    def test_unknown_focus_leaves_recommendation_unchanged(self, engine):
        plain = self._run(engine, "Lose Fat")
        bogus = self._run(engine, "Lose Fat", "not-a-real-goal")

        assert [s.reps for s in bogus.sets] == [s.reps for s in plain.sets]
        assert [s.weight for s in bogus.sets] == [s.weight for s in plain.sets]

    def test_context_records_focus_only_when_it_changes_config(self, engine):
        changed = self._run(engine, "Build Muscle", "strength")
        assert changed.reasoning_context.get("focus_goal") == "strength"
        assert changed.reasoning_context.get("base_goal") == "hypertrophy"

        # Focus equal to the profile goal is not a change worth reporting
        same = self._run(engine, "Build Muscle", "hypertrophy")
        assert same.reasoning_context.get("focus_goal") is None

        none = self._run(engine, "Build Muscle")
        assert none.reasoning_context.get("focus_goal") is None


class TestFocusMatching:
    def _store(self, focuses):
        store = TrainingFocusStore(MagicMock(), "u1")
        store._cache = focuses
        return store

    def test_matches_by_exercise_id_first(self):
        store = self._store([
            {"exercise_id": "bench_id", "exercise_name": "bench", "goal": "strength"},
            {"exercise_id": None, "exercise_name": "squat", "goal": "hypertrophy"},
        ])
        assert store.get_focus_for_exercise("bench_id", "Anything")["goal"] == "strength"

    def test_matches_by_name_substring_either_direction(self):
        store = self._store([{"exercise_id": None, "exercise_name": "bench", "goal": "strength"}])
        assert store.get_focus_for_exercise("x", "Barbell Bench Press")["goal"] == "strength"
        assert store.get_focus_for_exercise("x", "Incline Bench Press")["goal"] == "strength"

    def test_does_not_match_unrelated_exercise(self):
        store = self._store([{"exercise_id": None, "exercise_name": "bench", "goal": "strength"}])
        assert store.get_focus_for_exercise("x", "Leg Curl") is None

    def test_no_focuses_matches_nothing(self):
        assert self._store([]).get_focus_for_exercise("x", "Bench Press") is None


class TestFocusExpiry:
    def test_future_expiry_is_active(self):
        future = (datetime.now() + timedelta(days=1)).isoformat()
        assert TrainingFocusStore._is_active({"expires_at": future})

    def test_past_expiry_is_inactive(self):
        past = (datetime.now() - timedelta(days=1)).isoformat()
        assert not TrainingFocusStore._is_active({"expires_at": past})

    def test_missing_expiry_never_expires(self):
        assert TrainingFocusStore._is_active({})
        assert TrainingFocusStore._is_active({"expires_at": None})

    def test_unparseable_expiry_treated_as_expired(self):
        """Fail closed: a corrupt date shouldn't mean 'applies forever'."""
        assert not TrainingFocusStore._is_active({"expires_at": "not-a-date"})


class TestFocusValidation:
    def test_rejects_unknown_goal(self):
        store = TrainingFocusStore(MagicMock(), "u1")
        with pytest.raises(ValueError, match="Unknown goal"):
            store.set_focus(exercise_name="bench", goal="mega-strength")

    def test_rejects_blank_exercise_name(self):
        store = TrainingFocusStore(MagicMock(), "u1")
        with pytest.raises(ValueError, match="exercise_name"):
            store.set_focus(exercise_name="   ", goal="strength")

    def test_read_failure_degrades_to_no_focus(self):
        """Firestore being unavailable must not break recommendations."""
        db = MagicMock()
        db.collection.side_effect = RuntimeError("firestore down")
        store = TrainingFocusStore(db, "u1")
        assert store.list_active() == []
        assert store.get_focus_for_exercise("bench_id", "Bench Press") is None
