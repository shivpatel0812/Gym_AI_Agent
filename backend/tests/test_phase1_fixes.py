"""
Tests for Phase 1 review fixes:
1. Custom exercise metadata resolution
2. needs_starting_weight instead of 0-lb recommendation
3. Implausible-input guard
4. Documented double-increment exception with cap
5. Filler-set padding consistency
"""

import sys
import os
from unittest.mock import MagicMock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from ai_analysis.workout_recommender import WorkoutRecommender
from ai_analysis.workout_recommender.progression_engine import ProgressionEngine, Decision
from ai_analysis.workout_recommender.reasoning_generator import ReasoningGenerator
from ai_analysis.workout_recommender.exercise_metadata import (
    resolve_exercise_metadata,
    ExerciseMetadata,
    EXERCISE_METADATA,
    _infer_compound_from_name,
    _infer_equipment_from_name,
    _infer_muscle_group_from_name,
)
from tests.conftest import build_session


@pytest.fixture
def engine():
    return ProgressionEngine()


# === 1. Custom Exercise Metadata Resolution ===

class TestCustomExerciseMetadata:
    """Custom exercises should resolve metadata from record + name inference."""

    def test_custom_squat_resolved_as_compound(self):
        """A custom exercise named 'Bulgarian Split Squats' should be compound."""
        meta = resolve_exercise_metadata(
            exercise_id="firestore-random-id-abc123",
            exercise_name="Bulgarian Split Squats",
            exercise_record={"muscle_group": "LEGS", "type": "strength"},
        )
        assert meta.compound is True
        assert meta.muscle_group == "legs"

    def test_custom_curl_resolved_as_isolation(self):
        """A custom curl exercise should be isolation."""
        meta = resolve_exercise_metadata(
            exercise_id="user-custom-xyz",
            exercise_name="Spider Curls",
            exercise_record={"muscle_group": "BICEPS", "type": "strength"},
        )
        assert meta.compound is False
        assert meta.muscle_group == "biceps"

    def test_custom_exercise_with_dumbbell_in_name(self):
        """Equipment inferred from name keyword 'dumbbell'."""
        meta = resolve_exercise_metadata(
            exercise_id="custom-id",
            exercise_name="Dumbbell Zottman Curls",
        )
        assert meta.equipment == "Dumbbell"
        assert meta.min_increment_lb == 5.0

    def test_custom_exercise_with_cable_in_name(self):
        """Equipment inferred from 'cable' keyword."""
        meta = resolve_exercise_metadata(
            exercise_id="custom-id",
            exercise_name="Cable Crossovers",
        )
        assert meta.equipment == "Cable"

    def test_custom_exercise_with_record_muscle_group(self):
        """Exercise record muscle_group takes precedence over name inference."""
        meta = resolve_exercise_metadata(
            exercise_id="custom-id",
            exercise_name="My Special Move",
            exercise_record={"muscle_group": "CHEST", "type": "strength"},
        )
        assert meta.muscle_group == "chest"

    def test_custom_cardio_exercise(self):
        """Cardio type from record makes it cardio."""
        meta = resolve_exercise_metadata(
            exercise_id="custom-cardio",
            exercise_name="Assault Bike",
            exercise_record={"type": "cardio"},
        )
        assert meta.muscle_group == "cardio"
        assert meta.min_increment_lb == 0.0

    def test_default_catalog_exercise_unchanged(self):
        """Seeded catalog exercises still return their cataloged metadata."""
        meta = resolve_exercise_metadata(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
        )
        assert meta.compound is True
        assert meta.muscle_group == "chest"
        assert meta.equipment == "Dumbbell"

    def test_completely_unknown_exercise_falls_back_gracefully(self):
        """Exercise with no recognizable name or record gets machine/isolation default."""
        meta = resolve_exercise_metadata(
            exercise_id="abc123",
            exercise_name="Xyzzy",
        )
        assert meta.compound is False
        assert meta.muscle_group == "unknown"
        assert meta.equipment == "Machine"
        assert meta.min_increment_lb == 5.0

    def test_custom_squat_gets_compound_rep_range(self, engine):
        """A custom squat at 185x10x3 should get 'increase weight' not 'add reps'."""
        sessions = [build_session(185, [10, 10, 10])]
        result = engine.compute_recommendation(
            exercise_id="firestore-custom-squat-id",
            exercise_name="Barbell Back Squat",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
            exercise_record={"muscle_group": "LEGS", "type": "strength"},
        )
        # Compound + hypertrophy = rep range 6-10, at top (10) → increase weight
        assert result.decision == Decision.INCREASE_WEIGHT
        assert all(s.weight == 190 for s in result.sets)

    def test_recommender_loads_custom_record_from_user_collection(self):
        """The production path reads users/{uid}/exercises/{exercise_id}."""
        exercise_id = "firestore-custom-squat-id"
        exercise_record = {
            "name": "My Squat Variation",
            "muscle_group": "LEGS",
            "type": "strength",
            "is_custom": True,
        }

        db = MagicMock()
        exercise_doc = MagicMock()
        exercise_doc.exists = True
        exercise_doc.to_dict.return_value = exercise_record
        user_doc = db.collection.return_value.document.return_value
        user_doc.collection.return_value.document.return_value.get.return_value = exercise_doc

        recommender = WorkoutRecommender.__new__(WorkoutRecommender)
        recommender.db = db
        recommender.user_id = "user-123"
        recommender.data_fetcher = MagicMock()
        recommender.data_fetcher.get_recent_workout_sessions.return_value = [{
            "date": "2026-07-18",
            "exercises": [{
                "exercise_id": exercise_id,
                "sets": build_session(185, [10, 10, 10])["sets"],
            }],
        }]
        recommender.data_fetcher.get_user_profile.return_value = {
            "primary_goal": "Build Muscle"
        }
        recommender.progression_engine = ProgressionEngine()
        recommender.reasoning_generator = ReasoningGenerator(openai_client=None)

        response = recommender.get_exercise_recommendation(
            exercise_id=exercise_id,
            exercise_name="My Squat Variation",
            plan_target_sets=3,
        )

        db.collection.assert_called_once_with("users")
        db.collection.return_value.document.assert_called_once_with("user-123")
        user_doc.collection.assert_called_once_with("exercises")
        assert response["recommendation"]["progression_type"] == "increase_weight"
        assert all(
            item["weight"] == 190
            for item in response["recommendation"]["sets"]
        )


class TestNameInference:
    """Test the keyword inference patterns."""

    def test_compound_keywords(self):
        assert _infer_compound_from_name("Back Squat") is True
        assert _infer_compound_from_name("Bench Press") is True
        assert _infer_compound_from_name("Deadlift") is True
        assert _infer_compound_from_name("Barbell Row") is True
        assert _infer_compound_from_name("Pull-Up") is True
        assert _infer_compound_from_name("Dips") is True
        assert _infer_compound_from_name("Lunges") is True

    def test_isolation_keywords(self):
        assert _infer_compound_from_name("Bicep Curls") is False
        assert _infer_compound_from_name("Lateral Raises") is False
        assert _infer_compound_from_name("Tricep Extension") is False
        assert _infer_compound_from_name("Cable Flyes") is False
        assert _infer_compound_from_name("Kickbacks") is False

    def test_equipment_from_name(self):
        assert _infer_equipment_from_name("Dumbbell Press") == "Dumbbell"
        assert _infer_equipment_from_name("BB Curls") == "Barbell"
        assert _infer_equipment_from_name("Cable Crossover") == "Cable"
        assert _infer_equipment_from_name("Smith Machine Squat") == "Machine"
        assert _infer_equipment_from_name("Push-Ups") == "Bodyweight"

    def test_muscle_group_from_name(self):
        assert _infer_muscle_group_from_name("Bench Press") == "chest"
        assert _infer_muscle_group_from_name("Barbell Row") == "back"
        assert _infer_muscle_group_from_name("Bicep Curl") == "biceps"
        assert _infer_muscle_group_from_name("Leg Press") == "legs"


# === 2. Needs Starting Weight ===

class TestNeedsStartingWeight:
    """First session should return needs_starting_weight, not 0 lbs."""

    def test_no_history_returns_needs_starting_weight(self, engine):
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=[],
            num_sets=3,
        )
        assert result.decision == Decision.NEEDS_STARTING_WEIGHT
        assert result.confidence == "low"
        assert result.sets == []
        assert result.reasoning_context["reason"] == "needs_starting_weight"
        assert result.reasoning_context["suggested_reps"] == 6
        assert result.reasoning_context["suggested_sets"] == 3

    def test_bodyweight_still_returns_first_session(self, engine):
        """Bodyweight exercises don't need a starting weight (weight=0 is valid)."""
        result = engine.compute_recommendation(
            exercise_id="default-chest-bw-pushups",
            exercise_name="Push-Ups",
            user_goal="Build Muscle",
            recent_sessions=[],
            num_sets=3,
        )
        # Bodyweight: 0 weight is correct, not needs_starting_weight
        assert result.decision == Decision.FIRST_SESSION


# === 3. Implausible Input Guard ===

class TestImplausibleInputGuard:
    """Garbage data should drop confidence and flag the session."""

    def test_zero_weight_flagged(self, engine):
        """0 lb logged for a weighted exercise is implausible."""
        sessions = [build_session(0, [10, 10, 10])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        # All sets filtered out → needs starting weight
        assert result.decision == Decision.NEEDS_STARTING_WEIGHT
        assert result.sets == []
        assert result.reasoning_context["has_implausible_data"] is True

    def test_over_1000_lb_flagged(self, engine):
        """1500 lb bench is implausible."""
        sessions = [{"date": "2024-01-01", "sets": [
            {"weight": 1500, "reps": 10, "set_number": 1},
            {"weight": 75, "reps": 8, "set_number": 2},
            {"weight": 75, "reps": 8, "set_number": 3},
        ]}]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        # Should still work (valid sets remain) but with low confidence
        assert result.confidence == "low"
        assert result.reasoning_context.get("has_implausible_data") is True

    def test_over_50_reps_flagged(self, engine):
        """75 reps on bench is implausible."""
        sessions = [{"date": "2024-01-01", "sets": [
            {"weight": 75, "reps": 75, "set_number": 1},
            {"weight": 75, "reps": 8, "set_number": 2},
            {"weight": 75, "reps": 8, "set_number": 3},
        ]}]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.confidence == "low"
        assert result.reasoning_context.get("has_implausible_data") is True

    def test_all_implausible_sets_returns_needs_starting_weight(self, engine):
        """If ALL sets are implausible, treat as no history."""
        sessions = [{"date": "2024-01-01", "sets": [
            {"weight": 0, "reps": 10, "set_number": 1},
            {"weight": 0, "reps": 10, "set_number": 2},
        ]}]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.NEEDS_STARTING_WEIGHT
        assert result.sets == []
        assert result.reasoning_context["has_implausible_data"] is True

    def test_negative_weight_flagged(self, engine):
        """Negative weight is implausible."""
        sessions = [{"date": "2024-01-01", "sets": [
            {"weight": -50, "reps": 10, "set_number": 1},
            {"weight": 75, "reps": 8, "set_number": 2},
        ]}]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.confidence == "low"

    def test_typo_550_instead_of_55(self, engine):
        """550 lb (typo for 55) is implausible."""
        sessions = [{"date": "2024-01-01", "sets": [
            {"weight": 550, "reps": 10, "set_number": 1},
            {"weight": 55, "reps": 10, "set_number": 2},
            {"weight": 55, "reps": 10, "set_number": 3},
        ]}]
        result = engine.compute_recommendation(
            exercise_id="default-biceps-db-curls",
            exercise_name="Dumbbell Curls",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        # 550 lb filtered out, remaining valid sets still work
        assert result.confidence == "low"
        assert result.reasoning_context.get("has_implausible_data") is True


# === 4. Double Increment Exception ===

class TestDoubleIncrementException:
    """Double increment is a documented exception to the 10% guard."""

    def test_dumbbell_double_increment_75_to_85(self, engine):
        """75→85 (13.3%) is allowed for easy-rated dumbbell top-out."""
        sessions = [build_session(75, [10, 10, 10], difficulty=["easy", "easy", "easy"])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_WEIGHT
        assert all(s.weight == 85 for s in result.sets)

    def test_double_increment_capped_at_10_lbs(self, engine):
        """Heavy barbell exercises (10 lb base) cap double at 10 lbs total."""
        # Deadlift base increment = 10 lb, double would be 20
        # But cap at 10 means it's same as single increment
        sessions = [build_session(315, [6, 6, 6], difficulty=["easy", "easy", "easy"])]
        result = engine.compute_recommendation(
            exercise_id="default-back-bb-deadlifts",
            exercise_name="Deadlifts",
            user_goal="Get Stronger",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_WEIGHT
        # 315 + 10 (capped) = 325
        assert all(s.weight == 325 for s in result.sets)

    def test_barbell_bench_double_increment(self, engine):
        """Standard barbell (5 lb base) gets 10 lb double increment."""
        sessions = [build_session(185, [6, 6, 6], difficulty=["easy", "easy", "easy"])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-bb-bench-press",
            exercise_name="Barbell Bench Press",
            user_goal="Get Stronger",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_WEIGHT
        # 185 + 10 = 195
        assert all(s.weight == 195 for s in result.sets)

    def test_fat_loss_no_double_increment(self, engine):
        """Fat loss goal should never double increment."""
        sessions = [build_session(75, [12, 12, 12], difficulty=["easy", "easy", "easy"])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Lose Fat",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_WEIGHT
        # Single increment only: 75 + 5 = 80
        assert all(s.weight == 80 for s in result.sets)

    def test_not_at_top_of_range_no_double(self, engine):
        """Easy but not at top of range → normal increase_reps, no double."""
        sessions = [build_session(75, [8, 8, 8], difficulty=["easy", "easy", "easy"])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_REPS


# === 5. Filler Set Padding ===

class TestFillerSetPadding:
    """Extra sets should be padded consistently from last available set."""

    def test_increase_reps_pads_from_last_set(self, engine):
        """When history has 2 sets but num_sets=4, padding uses last set's data."""
        sessions = [build_session(75, [8, 7])]  # Only 2 sets in history
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=4,
        )
        assert len(result.sets) == 4
        # First two: +1 rep from 8 and 7
        assert result.sets[0].reps == 9
        assert result.sets[1].reps == 8
        # Padding from last set (7): +1 = 8
        assert result.sets[2].reps == 8
        assert result.sets[3].reps == 8
        # All at same weight
        assert all(s.weight == 75 for s in result.sets)

    def test_no_wild_rep_pattern(self, engine):
        """Padded sets shouldn't create jarring rep patterns like (9, 7, 7)."""
        sessions = [build_session(75, [8])]  # Only 1 set
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert len(result.sets) == 3
        # Set 1: 8+1=9, Set 2-3: padded from last (8)+1=9
        assert result.sets[0].reps == 9
        assert result.sets[1].reps == 9
        assert result.sets[2].reps == 9

    def test_odd_logged_weight_is_normalized_in_recommendation(self, engine):
        """Recommendations use the exercise's valid 5 lb resolution."""
        sessions = [build_session(77.3, [8, 8, 7])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_REPS
        assert all(s.weight == 75 for s in result.sets)
