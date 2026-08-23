"""Unit tests for ProgressionEngine — every rule + edge cases."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from ai_analysis.workout_recommender.progression_engine import (
    ProgressionEngine,
    Decision,
    RecommendedSet,
)
from tests.conftest import build_session, build_sessions_sequence


@pytest.fixture
def engine():
    return ProgressionEngine()


# === First Session ===

class TestFirstSession:
    def test_no_history_returns_needs_starting_weight(self, engine):
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=[],
            num_sets=3,
        )
        assert result.decision == Decision.NEEDS_STARTING_WEIGHT
        assert result.sets == []
        # Compound + hypertrophy = 6-10, starts at 6
        # Should indicate this is a "pick your weight" prompt
        assert result.reasoning_context.get("reason") == "needs_starting_weight"
        assert result.reasoning_context.get("suggested_reps") == 6
        assert result.reasoning_context.get("suggested_sets") == 3

    def test_first_session_isolation_exercise(self, engine):
        result = engine.compute_recommendation(
            exercise_id="default-biceps-db-curls",
            exercise_name="Dumbbell Curls",
            user_goal="Build Muscle",
            recent_sessions=[],
            num_sets=3,
        )
        assert result.decision == Decision.NEEDS_STARTING_WEIGHT
        # Isolation + hypertrophy = 10-15, starts at 10
        assert result.sets == []
        assert result.reasoning_context["suggested_reps"] == 10

    def test_first_session_strength_goal(self, engine):
        result = engine.compute_recommendation(
            exercise_id="default-chest-bb-bench-press",
            exercise_name="Barbell Bench Press",
            user_goal="Get Stronger",
            recent_sessions=[],
            num_sets=3,
        )
        # Compound + strength = 3-6, starts at 3
        assert result.decision == Decision.NEEDS_STARTING_WEIGHT
        assert result.sets == []
        assert result.reasoning_context["suggested_reps"] == 3

    def test_empty_sets_in_session_treated_as_first(self, engine):
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=[{"date": "2024-01-01", "sets": []}],
            num_sets=3,
        )
        assert result.decision == Decision.NEEDS_STARTING_WEIGHT


# === Increase Reps ===

class TestIncreaseReps:
    def test_single_session_increases_reps(self, engine):
        sessions = [build_session(75, [6, 6, 5])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_REPS
        # One aim across every set, not a per-set +1 ladder.
        assert [s.reps for s in result.sets] == [7, 7, 7]
        assert all(s.weight == 75 for s in result.sets)

    def test_reps_capped_at_range_high(self, engine):
        sessions = [build_session(75, [10, 9, 9])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        # Rep 10 + 1 = 11, but cap is 10 for hypertrophy compound
        assert result.sets[0].reps == 10
        assert result.sets[1].reps == 10
        assert result.sets[2].reps == 10


# === Increase Weight ===

class TestIncreaseWeight:
    def test_all_sets_at_top_triggers_weight_increase(self, engine):
        sessions = [build_session(75, [10, 10, 10])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_WEIGHT
        assert all(s.weight == 80 for s in result.sets)
        assert all(s.reps == 6 for s in result.sets)

    def test_weight_increase_uses_correct_increment(self, engine):
        # Deadlift has 10 lb increment
        sessions = [build_session(315, [6, 6, 6])]
        result = engine.compute_recommendation(
            exercise_id="default-back-bb-deadlifts",
            exercise_name="Deadlifts",
            user_goal="Get Stronger",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_WEIGHT
        # A strength-goal compound is prescribed as a top set plus backoffs,
        # so the increment lands on the top set rather than on all three.
        assert result.strategy == "top_set"
        assert result.sets[0].weight == 325
        assert result.sets[0].role == "top"

    def test_light_lifts_take_a_whole_increment_however_large_a_jump(self, engine):
        """
        There is no percentage cap on a weight increase, and there cannot be a
        useful one: load arrives in indivisible steps, so at 20 lb the smallest
        move available is +5 lb — a 25% jump. Capping that at 10% would mean
        rounding back to 20 lb and never progressing a light lift at all.

        (This test previously asserted only that the call returned
        INCREASE_WEIGHT, under a name promising a 10% cap that no code
        implemented — the guard it referred to was never wired up.)

        What keeps this honest is elsewhere: the *projection* refuses to
        compound jumps like this indefinitely, via PLAUSIBLE_WEEKLY_E1RM_GAIN.
        """
        sessions = [build_session(20, [10, 10, 10])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_WEIGHT
        assert all(s.weight == 25 for s in result.sets)
        assert result.sets[0].weight >= 20


# === Double Increment ===

class TestDoubleIncrement:
    def test_all_easy_and_top_reps_doubles_increment(self, engine):
        sessions = [build_session(75, [10, 10, 10], difficulty=["easy", "easy", "easy"])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_WEIGHT
        # Double increment: 75 + 10 = 85
        assert all(s.weight == 85 for s in result.sets)
        assert all(s.reps == 6 for s in result.sets)

    def test_no_double_increment_for_fat_loss(self, engine):
        sessions = [build_session(75, [12, 12, 12], difficulty=["easy", "easy", "easy"])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Lose Fat",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_WEIGHT
        # Single increment for fat_loss
        assert all(s.weight == 80 for s in result.sets)

    def test_easy_but_not_at_top_does_not_double(self, engine):
        sessions = [build_session(75, [8, 8, 8], difficulty=["easy", "easy", "easy"])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        # Not at top of range (10), so normal increase_reps
        assert result.decision == Decision.INCREASE_REPS


# === Maintain (Failure Handling) ===

class TestMaintain:
    def test_two_consecutive_failures_triggers_maintain(self, engine):
        # Session 1 (oldest): 75x8x3
        # Session 2: 75x7x3 (failure to match)
        # Session 3 (latest): 75x6x3 (failure to match again)
        sessions = [
            build_session(75, [6, 6, 6], days_ago=0),
            build_session(75, [7, 7, 7], days_ago=3),
            build_session(75, [8, 8, 8], days_ago=6),
        ]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.MAINTAIN

    def test_general_goal_needs_3_failures_for_maintain(self, engine):
        # General goal has threshold of 3
        sessions = [
            build_session(75, [6, 6, 6], days_ago=0),
            build_session(75, [7, 7, 7], days_ago=3),
            build_session(75, [8, 8, 8], days_ago=6),
        ]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="General Fitness",
            recent_sessions=sessions,
            num_sets=3,
        )
        # Only 2 failures, threshold is 3 → retry
        assert result.decision == Decision.INCREASE_REPS

    def test_all_failed_difficulty_immediately_maintains(self, engine):
        sessions = [
            build_session(75, [6, 6, 5], difficulty=["failed", "failed", "failed"]),
            build_session(75, [8, 8, 8], days_ago=3),
        ]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.MAINTAIN


# === Deload ===

class TestDeload:
    def test_flat_e1rm_triggers_deload(self, engine):
        # e1RM flat/declining for 3+ sessions
        # Session 1: 75x8 → e1RM = 75*(1+8/30) = 95
        # Session 2: 75x7 → e1RM = 75*(1+7/30) = 92.5
        # Session 3: 75x7 → e1RM = 92.5
        sessions = [
            build_session(75, [7, 7, 7], days_ago=0),
            build_session(75, [7, 7, 7], days_ago=3),
            build_session(75, [8, 8, 8], days_ago=6),
        ]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.DELOAD
        # 80% of 75 = 60
        assert all(s.weight == 60 for s in result.sets)
        # Midpoint reps for compound hypertrophy: (6+10)//2 = 8
        assert all(s.reps == 8 for s in result.sets)

    def test_improving_e1rm_does_not_deload(self, engine):
        # e1RM improving
        sessions = [
            build_session(80, [8, 8, 8], days_ago=0),
            build_session(75, [8, 8, 8], days_ago=3),
            build_session(70, [8, 8, 8], days_ago=6),
        ]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision != Decision.DELOAD


# === Light Day ===

class TestLightDay:
    def test_light_day_reduces_weight(self, engine):
        sessions = [build_session(80, [8, 8, 8])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
            day_intensity="light",
            heavy_day_weight=80,
        )
        assert result.decision == Decision.LIGHT_DAY
        # 80 * 0.875 = 70, rounded to 5 = 70
        assert all(s.weight == 70 for s in result.sets)
        # Top of rep range (10 for hypertrophy compound)
        assert all(s.reps == 10 for s in result.sets)

    def test_light_day_without_explicit_heavy_weight(self, engine):
        sessions = [build_session(80, [8, 8, 8])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
            day_intensity="light",
        )
        assert result.decision == Decision.LIGHT_DAY
        # Should derive from latest sets
        assert all(s.weight == 70 for s in result.sets)


# === Cardio ===

class TestCardio:
    def test_cardio_no_history(self, engine):
        result = engine.compute_recommendation(
            exercise_id="default-cardio-run",
            exercise_name="Run",
            user_goal="Build Muscle",
            recent_sessions=[],
            num_sets=1,
        )
        assert result.decision == Decision.CARDIO_PROGRESS
        assert result.time == 10
        assert result.sets == []

    def test_cardio_with_history(self, engine):
        sessions = [{"date": "2024-01-01", "sets": [], "time": 20, "speed": 6.0}]
        result = engine.compute_recommendation(
            exercise_id="default-cardio-run",
            exercise_name="Run",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=1,
        )
        assert result.decision == Decision.CARDIO_PROGRESS
        assert result.time == 21
        assert result.speed == 6.5


# === Bodyweight ===

class TestBodyweight:
    def test_bodyweight_no_history(self, engine):
        result = engine.compute_recommendation(
            exercise_id="default-chest-bw-pushups",
            exercise_name="Push-Ups",
            user_goal="Build Muscle",
            recent_sessions=[],
            num_sets=3,
        )
        assert result.decision == Decision.FIRST_SESSION
        assert all(s.weight == 0 for s in result.sets)

    def test_bodyweight_increases_reps(self, engine):
        # Push-ups are compound + hypertrophy → rep range 6-10, cap at 10
        sessions = [build_session(0, [7, 6, 6])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-bw-pushups",
            exercise_name="Push-Ups",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.BODYWEIGHT_PROGRESS
        assert result.sets[0].reps == 8
        assert result.sets[1].reps == 7
        assert result.sets[2].reps == 7
        assert all(s.weight == 0 for s in result.sets)


# === Edge Cases ===

class TestEdgeCases:
    def test_num_sets_larger_than_history(self, engine):
        sessions = [build_session(75, [8, 8])]  # Only 2 sets in history
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=4,  # Requesting 4 sets
        )
        assert len(result.sets) == 4

    def test_unknown_exercise_uses_defaults(self, engine):
        sessions = [build_session(50, [12, 12, 12])]
        result = engine.compute_recommendation(
            exercise_id="custom-user-exercise",
            exercise_name="Custom Exercise",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        # Should still produce a valid result using DEFAULT_METADATA
        assert result.decision in list(Decision)
        assert len(result.sets) == 3

    def test_unknown_goal_uses_hypertrophy(self, engine):
        sessions = [build_session(50, [10, 10, 10])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Random Goal",
            recent_sessions=sessions,
            num_sets=3,
        )
        # Falls back to hypertrophy: compound rep range 6-10
        assert result.decision == Decision.INCREASE_WEIGHT
        assert all(s.reps == 6 for s in result.sets)


# === Determinism ===

class TestDeterminism:
    def test_same_input_same_output_100_times(self, engine):
        sessions = [build_session(75, [8, 8, 7])]
        first_result = engine.compute_recommendation(
            exercise_id="default-chest-db-bench-press",
            exercise_name="Dumbbell Bench Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        for _ in range(99):
            result = engine.compute_recommendation(
                exercise_id="default-chest-db-bench-press",
                exercise_name="Dumbbell Bench Press",
                user_goal="Build Muscle",
                recent_sessions=sessions,
                num_sets=3,
            )
            assert result.decision == first_result.decision
            assert len(result.sets) == len(first_result.sets)
            for a, b in zip(result.sets, first_result.sets):
                assert a.weight == b.weight
                assert a.reps == b.reps


class TestAlwaysProgressFromLastHit:
    def test_seven_reps_becomes_eight(self, engine):
        sessions = [build_session(75, [7, 7, 5])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-incline-press",
            exercise_name="Incline Dumbbell Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_REPS
        assert [s.reps for s in result.sets] == [8, 8, 8]
        assert all(s.weight == 75 for s in result.sets)

    def test_four_set_history_still_progresses_three_sets(self, engine):
        sessions = [build_session(75, [7, 7, 5, 7])]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-incline-press",
            exercise_name="Incline Dumbbell Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert [s.reps for s in result.sets[:3]] == [8, 8, 8]
        assert all(s.weight == 75 for s in result.sets)

    def test_shorter_follow_up_is_not_a_failure(self, engine):
        sessions = [
            build_session(75, [7, 7, 5], days_ago=0),
            build_session(75, [7, 7, 5, 7], days_ago=3),
        ]
        result = engine.compute_recommendation(
            exercise_id="default-chest-db-incline-press",
            exercise_name="Incline Dumbbell Press",
            user_goal="Build Muscle",
            recent_sessions=sessions,
            num_sets=3,
        )
        assert result.decision == Decision.INCREASE_REPS
        assert [s.reps for s in result.sets[:3]] == [8, 8, 8]

