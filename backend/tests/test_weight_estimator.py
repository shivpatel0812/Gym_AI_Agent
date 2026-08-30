from ai_analysis.workout_recommender.progression_engine import (
    Decision,
    ProgressionEngine,
)
from ai_analysis.workout_recommender.weight_estimator import (
    estimate_comeback_weight,
    estimate_starting_weight,
    infer_top_lifts_from_related_history,
)


def test_estimate_starting_weight_uses_top_lift_anchor():
    weight = estimate_starting_weight(
        "default-chest-db-incline-press",
        "Incline Dumbbell Press",
        {"bench_press": 225},
    )
    assert weight == 70


def test_related_chest_history_produces_calibration_anchor():
    inferred = infer_top_lifts_from_related_history(
        "default-chest-db-fly",
        "Dumbbell Chest Fly",
        [{
            "exercises": [{
                "exercise_id": "default-chest-db-incline-press",
                "exercise_name": "Incline Dumbbell Press",
                "sets": [{"weight": 80, "reps": 8}],
            }]
        }],
    )
    assert inferred is not None
    assert inferred["source"] == "related_exercise_history"
    assert inferred["sample_count"] == 1


def test_related_history_prefers_recent_sessions_before_sample_cap():
    sessions = []
    for day, weight in [
        ("2026-08-28", 80), ("2026-08-27", 80), ("2026-08-26", 80),
        ("2026-08-25", 80), ("2026-08-24", 80), ("2026-08-23", 80),
        ("2024-01-01", 300),
    ]:
        sessions.append({
            "date": day,
            "exercises": [{
                "exercise_id": "default-chest-db-incline-press",
                "exercise_name": "Incline Dumbbell Press",
                "sets": [{"weight": weight, "reps": 8}],
            }],
        })
    inferred = infer_top_lifts_from_related_history(
        "default-chest-db-fly", "Dumbbell Chest Fly", list(reversed(sessions))
    )
    assert inferred is not None
    assert inferred["sample_count"] == 6
    assert inferred["bench_press"]["weight"] < 300


def test_custom_target_metadata_controls_starting_ratio():
    weight = estimate_starting_weight(
        "custom-fly",
        "Custom Movement",
        {"bench_press": 200},
        exercise_record={"muscle_group": "chest", "type": "strength"},
    )
    assert weight is not None


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


def test_estimate_comeback_weight_discounts_stale_session():
    assert estimate_comeback_weight(75, 191) == 55


def test_stale_history_fills_three_current_working_sets():
    engine = ProgressionEngine()
    result = engine.compute_recommendation(
        exercise_id="default-chest-db-incline-press",
        exercise_name="Incline Dumbbell Press",
        user_goal="Build Muscle",
        recent_sessions=[],
        num_sets=3,
        stale_last_session={
            "date": "2020-01-01",
            "sets": [
                {"set_number": 1, "reps": 6, "weight": 75},
                {"set_number": 2, "reps": 6, "weight": 75},
                {"set_number": 3, "reps": 6, "weight": 75},
            ],
        },
    )

    assert result.decision == Decision.FIRST_SESSION
    assert [item.weight for item in result.sets] == [55, 55, 55]
    assert [item.reps for item in result.sets] == [6, 6, 6]
    assert result.reasoning_context["estimated_from_stale_history"] is True
