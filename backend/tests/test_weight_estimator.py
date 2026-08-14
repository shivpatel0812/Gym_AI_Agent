from ai_analysis.workout_recommender.progression_engine import (
    Decision,
    ProgressionEngine,
)
from ai_analysis.workout_recommender.weight_estimator import (
    estimate_starting_weight,
)


def test_estimate_starting_weight_uses_top_lift_anchor():
    weight = estimate_starting_weight(
        "default-chest-db-incline-press",
        "Incline Dumbbell Press",
        {"bench_press": 225},
    )
    assert weight == 70


def test_representative_set_can_include_reps_without_being_a_one_rep_max():
    weight = estimate_starting_weight(
        "default-chest-db-incline-press",
        "Incline Dumbbell Press",
        {"bench_press": {"weight": 225, "reps": 10}},
    )
    assert weight == 80


def test_estimate_starting_weight_returns_none_without_safe_mapping():
    assert (
        estimate_starting_weight(
            "default-cardio-run",
            "Run",
            {"bench_press": 225},
        )
        is None
    )
    assert (
        estimate_starting_weight(
            "default-chest-bb-bench-press",
            "Barbell Bench Press",
            {"bench_press": 0},
        )
        is None
    )


def test_first_session_top_lift_estimate_is_medium_confidence():
    engine = ProgressionEngine()
    result = engine.compute_recommendation(
        exercise_id="default-chest-db-incline-press",
        exercise_name="Incline Dumbbell Press",
        user_goal="Build Muscle",
        recent_sessions=[],
        num_sets=3,
        top_lifts={"bench_press": 225},
    )

    assert result.decision == Decision.FIRST_SESSION
    assert result.confidence == "medium"
    assert [item.weight for item in result.sets] == [70, 70, 70]
    assert result.reasoning_context["estimated_from_top_lifts"] is True


def test_unknown_first_session_still_requests_starting_weight():
    engine = ProgressionEngine()
    result = engine.compute_recommendation(
        exercise_id="custom-unknown",
        exercise_name="Mystery Movement",
        user_goal="Build Muscle",
        recent_sessions=[],
        top_lifts={"bench_press": 225},
    )

    assert result.decision == Decision.NEEDS_STARTING_WEIGHT
    assert result.sets == []
