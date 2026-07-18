"""Tests for exercise_metadata.py — lookup, defaults, increment resolution."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.workout_recommender.exercise_metadata import (
    get_exercise_metadata,
    get_increment,
    is_cardio,
    is_bodyweight,
    EXERCISE_METADATA,
    DEFAULT_METADATA,
    ExerciseMetadata,
)


class TestExerciseMetadataLookup:
    def test_known_exercise_returns_metadata(self):
        meta = get_exercise_metadata("default-chest-db-bench-press")
        assert meta.compound is True
        assert meta.muscle_group == "chest"
        assert meta.equipment == "Dumbbell"
        assert meta.min_increment_lb == 5.0

    def test_unknown_exercise_returns_default(self):
        meta = get_exercise_metadata("custom-user-exercise-xyz")
        assert meta is DEFAULT_METADATA
        assert meta.compound is False
        assert meta.muscle_group == "unknown"
        assert meta.equipment == "Machine"
        assert meta.min_increment_lb == 5.0

    def test_barbell_deadlift_has_10lb_increment(self):
        meta = get_exercise_metadata("default-back-bb-deadlifts")
        assert meta.min_increment_lb == 10.0
        assert meta.compound is True
        assert meta.muscle_group == "back"

    def test_leg_press_has_10lb_increment(self):
        meta = get_exercise_metadata("default-legs-machine-leg-press")
        assert meta.min_increment_lb == 10.0

    def test_bodyweight_exercise_has_zero_increment(self):
        meta = get_exercise_metadata("default-chest-bw-pushups")
        assert meta.min_increment_lb == 0.0
        assert meta.equipment == "Bodyweight"

    def test_cardio_exercise(self):
        meta = get_exercise_metadata("default-cardio-run")
        assert meta.muscle_group == "cardio"
        assert meta.min_increment_lb == 0.0

    def test_unilateral_exercises(self):
        meta = get_exercise_metadata("default-back-db-single-arm-rows")
        assert meta.is_unilateral is True

        meta2 = get_exercise_metadata("default-chest-db-bench-press")
        assert meta2.is_unilateral is False


class TestIncrementResolution:
    def test_get_increment_known(self):
        assert get_increment("default-chest-bb-bench-press") == 5.0
        assert get_increment("default-back-bb-deadlifts") == 10.0
        assert get_increment("default-chest-bw-pushups") == 0.0

    def test_get_increment_unknown(self):
        assert get_increment("nonexistent-exercise") == 5.0


class TestHelperFunctions:
    def test_is_cardio(self):
        assert is_cardio("default-cardio-run") is True
        assert is_cardio("default-cardio-incline-walk") is True
        assert is_cardio("default-chest-bb-bench-press") is False

    def test_is_bodyweight(self):
        assert is_bodyweight("default-chest-bw-pushups") is True
        assert is_bodyweight("default-back-bw-pullups") is True
        assert is_bodyweight("default-chest-db-bench-press") is False
        assert is_bodyweight("default-cardio-run") is True  # Cardio also has 0 increment


class TestCatalogCompleteness:
    def test_catalog_has_reasonable_size(self):
        """Should have ~100+ exercises seeded."""
        assert len(EXERCISE_METADATA) >= 100

    def test_all_muscle_groups_represented(self):
        groups = set(m.muscle_group for m in EXERCISE_METADATA.values())
        expected = {"chest", "shoulders", "biceps", "triceps", "back", "legs", "glutes", "calves", "core", "cardio"}
        assert expected.issubset(groups)

    def test_all_equipment_types_represented(self):
        equipment = set(m.equipment for m in EXERCISE_METADATA.values())
        expected = {"Barbell", "Dumbbell", "Cable", "Machine", "Bodyweight", "Treadmill"}
        assert expected.issubset(equipment)


class TestMetadataImmutability:
    def test_metadata_is_frozen(self):
        import dataclasses
        meta = get_exercise_metadata("default-chest-db-bench-press")
        try:
            meta.compound = False
            assert False, "Should have raised FrozenInstanceError"
        except (dataclasses.FrozenInstanceError, AttributeError):
            pass
