from dataclasses import dataclass, field

from ai_analysis.workout_recommender.personalization import (
    apply_position_factor,
    learn_position_factor,
)


@dataclass
class FakeSet:
    weight: float


@dataclass
class FakeResult:
    sets: list
    reasoning_context: dict = field(default_factory=dict)


def _session(incline_first: bool):
    incline = {
        "exercise_id": "default-chest-db-incline-press",
        "exercise_name": "Incline Dumbbell Press",
        "sets": [{"weight": 60 if incline_first else 45, "reps": 8}],
    }
    bench = {
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "sets": [{"weight": 60 if not incline_first else 45, "reps": 8}],
    }
    return {
        "exercises": [incline, bench] if incline_first else [bench, incline]
    }


def test_learns_later_position_capacity_from_user_history():
    context = learn_position_factor(
        [_session(True), _session(True), _session(False), _session(False)],
        "default-chest-db-incline-press",
        "Incline Dumbbell Press",
        1,
    )
    assert context["source"] == "personal_position_history"
    assert 0.75 <= context["factor"] < 1.0


def test_position_factor_never_increases_prescription():
    result = FakeResult(sets=[FakeSet(50), FakeSet(50)])
    adjusted = apply_position_factor(
        result, {"factor": 0.9, "source": "personal_position_history"}, 5
    )
    assert [item.weight for item in adjusted.sets] == [45, 45]
    assert adjusted.reasoning_context["position_adjustment"]["factor"] == 0.9
