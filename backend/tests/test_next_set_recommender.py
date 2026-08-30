import json
from types import SimpleNamespace

from ai_analysis.workout_recommender.next_set_recommender import NextSetRecommender
from ai_analysis.workout_recommender.session_fatigue import calculate_session_fatigue


class FakeCompletions:
    def __init__(self, payload):
        self.payload = payload

    def create(self, **kwargs):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(self.payload)))],
            usage=SimpleNamespace(total_tokens=123),
        )


def engine(payload):
    client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions(payload)))
    return NextSetRecommender(client)


def test_caps_upward_jump_to_one_equipment_increment():
    result = engine({
        "next_set": {"weight": 80, "rep_low": 4, "rep_high": 6, "preferred_reps": 5},
        "reasoning": "Try a controlled heavier set.",
        "action": "increase",
    }).recommend(
        exercise_id="default-chest-db-incline-press",
        exercise_name="Incline Dumbbell Press",
        completed_sets=[{"set_number": 1, "weight": 50, "reps": 8, "rpe": 7}],
        remaining_sets=[{"set_number": 2, "weight": 50, "reps": 8}],
    )

    assert result["next_set"]["weight"] == 55
    assert result["next_set"]["preferred_reps"] == 5


def test_caps_excessive_backoff_and_invalid_rep_targets():
    result = engine({
        "next_set": {"weight": 5, "rep_low": -2, "rep_high": 80, "preferred_reps": 90},
        "reasoning": "Back off after a hard set.",
        "action": "backoff",
    }).recommend(
        exercise_id="default-chest-db-incline-press",
        exercise_name="Incline Dumbbell Press",
        completed_sets=[{"set_number": 1, "weight": 50, "reps": 5, "rpe": 10}],
        remaining_sets=[{"set_number": 2, "weight": 50, "reps": 8}],
    )

    assert result["next_set"]["weight"] == 35
    assert result["next_set"]["rep_low"] == 1
    assert result["next_set"]["rep_high"] == 30
    assert result["next_set"]["preferred_reps"] == 30


def test_returns_complete_without_api_call_when_no_sets_remain():
    result = engine({}).recommend(
        exercise_id="x",
        exercise_name="Exercise",
        completed_sets=[{"weight": 50, "reps": 8}],
        remaining_sets=[],
    )
    assert result["status"] == "complete"


def test_api_failure_uses_deterministic_backoff():
    class BrokenCompletions:
        def create(self, **kwargs):
            raise RuntimeError("offline")

    client = SimpleNamespace(chat=SimpleNamespace(completions=BrokenCompletions()))
    result = NextSetRecommender(client).recommend(
        exercise_id="default-chest-db-incline-press",
        exercise_name="Incline Dumbbell Press",
        completed_sets=[{"set_number": 1, "weight": 50, "reps": 5, "difficulty": "failed"}],
        remaining_sets=[{"set_number": 2, "weight": 50, "reps": 8}],
        base_recommendation={"rep_range": [8, 10]},
    )
    assert result["source"] == "deterministic_fallback"
    assert result["action"] == "backoff"
    assert result["next_set"]["weight"] == 45


def test_fatigue_counts_only_completed_overlapping_sets():
    context = calculate_session_fatigue(
        "default-chest-db-incline-press",
        "Incline Dumbbell Press",
        [{
            "exercise_id": "default-chest-db-bench-press",
            "exercise_name": "Dumbbell Bench Press",
            "sets": [
                {"weight": 50, "reps": 10, "difficulty": "hard", "completed": True},
                {"weight": 50, "reps": 10, "difficulty": "hard", "completed": False},
            ],
        }],
    )
    assert context["weighted_hard_sets"] == 0.9
    assert context["contributors"][0]["completed_sets"] == 1


def test_unrelated_compound_does_not_create_local_fatigue():
    context = calculate_session_fatigue(
        "default-chest-db-incline-press",
        "Incline Dumbbell Press",
        [{
            "exercise_id": "default-legs-bb-squat",
            "exercise_name": "Barbell Squat",
            "sets": [{"weight": 225, "reps": 8, "difficulty": "hard", "completed": True}],
        }],
    )
    assert context["score"] == 0


def test_learned_misses_block_model_weight_increase():
    result = engine({
        "next_set": {"weight": 55, "rep_low": 8, "rep_high": 10, "preferred_reps": 9},
        "reasoning": "Increase.",
        "action": "increase",
    }).recommend(
        exercise_id="default-chest-db-incline-press",
        exercise_name="Incline Dumbbell Press",
        completed_sets=[{"set_number": 1, "weight": 50, "reps": 8, "difficulty": "good"}],
        remaining_sets=[{"set_number": 2, "weight": 50, "reps": 8}],
        learned_context={"observations": 4, "average_rep_error": -1.5},
    )
    assert result["next_set"]["weight"] == 50
