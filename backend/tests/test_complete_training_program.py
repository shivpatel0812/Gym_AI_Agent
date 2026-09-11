import copy
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from ai_analysis.plan_builder import PlanBuilder
from ai_analysis.plan_completeness import (
    complete_routine,
    completeness_errors,
    enforce_locked_exercises,
)
from ai_analysis.plan_projection import PlanProjector
from ai_analysis.workout_recommender.progression_engine import ProgressionEngine
from nutrition.training_macros import build_training_macros


def day(name, *ids):
    return {"day_name": name, "exercises": [
        {"exercise_id": ex, "exercise_name": ex, "sets": 3, "reps": 8, "order": i + 1}
        for i, ex in enumerate(ids)]}


def test_first_plan_keeps_days_it_never_discussed():
    """Days are carried whole; a day the draft *did* return is left alone.

    Backfilling exercises into a returned day overrode the mode that produced
    it — `adapt_split` tells the model it may remove lifts, and this put them
    back. A gutted day is caught by `completeness_errors` and sent back for a
    repair pass instead of being silently rebuilt from old logs.
    """
    source = {"days": [day("Upper", "press", "row", "curl"), day("Lower", "squat", "hinge")]}
    original = copy.deepcopy(source)
    plan = complete_routine({"days": [day("Upper", "press")]}, source)
    assert [ex["exercise_id"] for ex in plan["days"][0]["exercises"]] == ["press"]
    assert plan["days"][1] == source["days"][1]
    assert source == original
    assert any("Lower" in issue for issue in completeness_errors(plan))
    assert any("Upper" in issue for issue in completeness_errors(plan, source))


def test_a_day_the_draft_shrank_is_an_error_not_a_silent_rebuild():
    source = {"days": [day("Push A", "press", "dips", "machine", "pushdown")]}
    gutted = {"days": [day("Push A", "press")], "weekly_schedule": {"monday": "Push A"}}
    assert any("Push A" in issue for issue in completeness_errors(gutted, source))


def test_a_declared_removal_is_a_decision_the_mode_allows():
    source = {"days": [day("Push A", "press", "dips", "machine", "pushdown")]}
    trimmed = {"days": [day("Push A", "press")],
               "weekly_schedule": {"monday": "Push A"},
               "changes": [{"action": "removed", "day_name": "Push A",
                            "exercise_name": "dips"}]}
    assert completeness_errors(trimmed, source) == []


def test_swapping_a_few_lifts_is_not_truncation():
    source = {"days": [day("Push A", "press", "dips", "machine", "pushdown")]}
    adapted = {"days": [day("Push A", "press", "incline", "machine")],
               "weekly_schedule": {"monday": "Push A"}}
    assert completeness_errors(adapted, source) == []


def test_repeated_variants_do_not_resurrect_the_source_day():
    source = {"days": [day("Upper", "press", "row", "curl")]}
    heavy = {**day("Upper strength", "press", "row"), "source_day": "Upper"}
    volume = {**day("Upper volume", "press", "curl"), "source_day": "Upper"}
    plan = complete_routine({"days": [heavy, volume]}, source)
    assert [d["day_name"] for d in plan["days"]] == ["Upper strength", "Upper volume"]


def test_a_day_split_into_variants_is_measured_as_one_day():
    """Two exposures of an Upper day each hold half the work by design.
    Judging them separately would read a deliberate split as truncation."""
    source = {"days": [day("Upper", "press", "row", "curl", "raise")]}
    plan = {"days": [{**day("Upper strength", "press", "row"), "source_day": "Upper"},
                     {**day("Upper volume", "curl", "raise"), "source_day": "Upper"}],
            "weekly_schedule": {"monday": "Upper strength", "thursday": "Upper volume"}}
    assert completeness_errors(plan, source) == []


def test_restored_day_keeps_its_original_weekday():
    source = {"days": [day("Upper", "press"), day("Lower", "squat")],
              "weekly_schedule": {"monday": "Upper", "wednesday": "Lower"}}
    plan = complete_routine({"days": [day("Upper", "press")],
                             "weekly_schedule": {"monday": "Upper", "wednesday": "Rest"}}, source)
    assert plan["weekly_schedule"]["wednesday"] == "Lower"
    assert completeness_errors(plan) == []


def test_building_variants_from_active_plan_does_not_restore_old_name():
    source = {"days": [day("Upper", "press", "row", "curl")]}
    raw = {"days": [{**day("Strength", "press"), "source_day": "Upper"},
                    {**day("Volume", "press"), "source_day": "Upper"}],
           "weekly_schedule": {"monday": "Strength", "thursday": "Volume"}}
    builder, create = builder_with_responses(raw)
    result = builder.build_plan([], source, {}, {}, existing_plan=source)
    assert result["status"] == "success"
    assert create.call_count == 1
    assert [d["day_name"] for d in result["plan"]["days"]] == ["Strength", "Volume"]


def test_explicit_adaptation_survives_but_follow_mode_preserves_exercise():
    source = {"days": [day("Upper", "press", "row")]}
    proposal = {"days": [day("Upper", "press", "pullup")], "changes": [
        {"action": "swapped", "day_name": "Upper", "exercise_name": "pullup", "replaces": "row"}]}
    adapted = complete_routine(proposal, source)
    assert [ex["exercise_id"] for ex in adapted["days"][0]["exercises"]] == ["press", "pullup"]
    strict = complete_routine(proposal, source, strict=True)
    assert "row" in [ex["exercise_id"] for ex in strict["days"][0]["exercises"]]


def test_import_retains_exact_exercise_identity_and_order():
    source = {"days": [day("Workout", "custom-row", "custom-press", "custom-curl")]}
    proposal = {"days": [day("Workout", "custom-curl", "custom-row")]}
    actual = complete_routine(proposal, source, preserve_order=True,
                              backfill_exercises=True)
    restored = actual["days"][0]["exercises"]
    assert [ex["exercise_id"] for ex in restored] == [
        ex["exercise_id"] for ex in source["days"][0]["exercises"]
    ]
    assert [ex["order"] for ex in restored] == [1, 2, 3]
    for expected, ex in zip(source["days"][0]["exercises"], restored):
        assert ex["exercise_name"] == expected["exercise_name"]
        assert ex["sets"] == expected["sets"] and ex["reps"] == expected["reps"]


def test_a_restored_lift_carries_a_rep_band():
    """`complete_routine` runs after `validate_plan`, so it owes what that pass
    guarantees. A lift preserved from a reconstructed session arrived with no
    `target_rep_range` and rendered in the plan with no reps beside it."""
    source = {"days": [{"day_name": "Workout", "exercises": [
        {"exercise_id": "custom-fly", "exercise_name": "Cable Fly", "sets": 3,
         "reps": 10, "rest_seconds": 120, "source_date": "2026-08-25",
         "last_working_weight": 30.0}]}]}
    restored = complete_routine({"days": [{"day_name": "Workout", "exercises": []}]},
                                source, backfill_exercises=True)["days"][0]["exercises"][0]
    assert restored["target_rep_range"][0] <= 10 <= restored["target_rep_range"][1]
    for junk in ("rest_seconds", "source_date", "last_working_weight"):
        assert junk not in restored


def builder_with_responses(*plans):
    builder = PlanBuilder.__new__(PlanBuilder)
    builder.model = "test"
    create = Mock(side_effect=[SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(plan)))],
        usage=SimpleNamespace(total_tokens=1)) for plan in plans])
    builder.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    return builder, create


def test_generation_repairs_unscheduled_days_before_returning_draft():
    source = {"days": [day("Upper", "press"), day("Lower", "squat")]}
    incomplete = {"days": [day("Upper", "press")], "weekly_schedule": {"monday": "Upper"}}
    full = {**source, "weekly_schedule": {"monday": "Upper", "wednesday": "Lower"}}
    builder, create = builder_with_responses(incomplete, full)
    result = builder.build_plan([], source, {}, {})
    assert create.call_count == 2
    assert result["status"] == "success"
    assert result["plan"]["duration_weeks"] == 12
    assert completeness_errors(result["plan"]) == []


def test_generation_never_saves_a_still_incomplete_repair():
    source = {"days": [day("Upper", "press"), day("Lower", "squat")]}
    incomplete = {"days": [day("Upper", "press")], "weekly_schedule": {"monday": "Upper"}}
    builder, create = builder_with_responses(incomplete, incomplete)
    result = builder.build_plan([], source, {}, {})
    assert create.call_count == 2
    assert result["status"] == "error"
    assert "Lower" in result["error"]


def test_confirmed_weekdays_override_model_schedule():
    source = {"days": [day("Full body", "press")], "confirmed_schedule": {"friday": "Full body"}}
    raw = {"days": source["days"], "weekly_schedule": {"monday": "Full body"}}
    builder, _ = builder_with_responses(raw)
    result = builder.build_plan([], source, {}, {})
    assert result["plan"]["weekly_schedule"]["friday"] == "Full body"
    assert result["plan"]["weekly_schedule"]["monday"] == "Rest"


PROFILE = {"weight": 180, "height_cm": 180, "age": 30, "gender": "male", "preferred_workout_frequency": "4-5"}


def test_macros_are_personal_estimates_with_consistent_energy():
    result = build_training_macros(PROFILE)
    macros = result["targets"]
    assert result["goal"] == "maintain"
    assert macros["calories"] == result["maintenance_calories"]
    assert abs(macros["calories"] - (4 * macros["protein"] + 4 * macros["carbs"] + 9 * macros["fats"])) <= 2
    assert build_training_macros(PROFILE, "gain")["targets"]["calories"] > macros["calories"]
    assert build_training_macros(PROFILE, "lose")["targets"]["calories"] < macros["calories"]


@pytest.mark.parametrize("profile", [{}, {**PROFILE, "weight": "nan"}, {**PROFILE, "age": 15}, {**PROFILE, "height_cm": "invalid"}])
def test_missing_or_invalid_profile_never_gets_invented_macros(profile):
    assert build_training_macros(profile)["targets"] is None


def test_existing_nutrition_targets_win_even_without_profile():
    existing = {"id": "nutrition-1", "goal": "lean_bulk", "targets": {"calories": 2500, "protein": 150, "carbs": 300, "fats": 70}}
    result = build_training_macros({}, existing=existing)
    assert result["targets"] == existing["targets"]
    assert result["source"] == "nutrition_plan"


def test_all_twelve_weeks_have_sets_for_each_distinct_exposure():
    projector = PlanProjector(ProgressionEngine())
    history = [{"date": "2026-09-01", "sets": [
        {"weight": 50, "reps": 8, "completed": True, "set_number": i + 1} for i in range(3)]}]
    outputs = []
    for intensity, band in (("heavy", (4, 6)), ("volume", (10, 12))):
        result = projector.project_exercise(
            exercise_id="default-chest-db-bench-press", exercise_name="Dumbbell Bench Press",
            day_name=intensity, history=history, user_goal="Build Muscle", weeks=12,
            sessions_per_week=1, num_sets=3, rep_range_override=band, day_intensity=intensity)
        assert len(result.schedule) == 12
        assert all(point.sets for point in result.schedule)
        assert {point.week for point in result.schedule} == set(range(1, 13))
        outputs.append(result.schedule)
    assert outputs[0] != outputs[1]


def test_schedule_request_requires_a_complete_calendar():
    from pydantic import ValidationError
    from routers.training_plan import ProposePlanRequest
    with pytest.raises(ValidationError):
        ProposePlanRequest(weekly_schedule={"monday": "Workout"})
    schedule = dict.fromkeys(("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"), "rest")
    with pytest.raises(ValidationError):
        ProposePlanRequest(weekly_schedule=schedule)
    schedule["friday"] = "Workout"
    result = ProposePlanRequest(weekly_schedule=schedule, duration_weeks=12, nutrition_goal="gain")
    assert result.weekly_schedule["monday"] == "Rest"


def test_projection_route_keeps_each_exposure_and_includes_macros(monkeypatch):
    import asyncio
    from routers import training_plan as router
    source = {"id": "test-plan", "duration_weeks": 12, "days": [
        {**day("Session A", "press"), "day_type": "heavy"},
        {**day("Session B", "press"), "day_type": "volume"}],
        "weekly_schedule": {"tuesday": "Session A", "friday": "Session B"}}
    monkeypatch.setattr(router, "PlanStore", lambda *_: SimpleNamespace(get_active=lambda: source))
    router.PlanStore.progress = lambda _: {"current_week": 1, "total_weeks": 12}
    reader = SimpleNamespace(get_user_profile=lambda: PROFILE, get_all_workout_sessions=lambda: [])
    recommender = SimpleNamespace(data_fetcher=reader, progression_engine=ProgressionEngine(),
                                  _get_exercise_history=lambda *_, **__: [])
    monkeypatch.setattr(router, "_recommender", lambda _: recommender)
    monkeypatch.setattr(router, "NutritionPlanStore", lambda *_: SimpleNamespace(get_active=lambda: None))
    captured = []

    def project(**kwargs):
        captured.append(kwargs)
        return SimpleNamespace(to_dict=lambda: {})

    monkeypatch.setattr(router, "PlanProjector", lambda _: SimpleNamespace(project_exercise=project))
    result = asyncio.run(router.get_plan_projection(weeks=12, user_id="test"))["projection"]
    assert [call["sessions_per_week"] for call in captured] == [1, 1]
    assert [call["day_intensity"] for call in captured] == ["heavy", "volume"]
    assert result["nutrition_companion"]["targets"]["protein"] > 0
    assert len(result["days"]) == 2
    assert result["weeks"] == 12


class TestEveryExerciseCarriesAPrescription:
    """
    Sets and reps were always filled in by the validator's clamps, but the rep
    band was written only when the model happened to supply one — so the one
    part of a prescription that could silently go missing was the part the
    engine judges sessions against, the projection paces to, and the card
    shows.
    """

    def test_a_band_is_derived_when_the_model_omits_one(self):
        from ai_analysis.plan_builder import PlanBuilder

        assert PlanBuilder._default_rep_range(5) == [5, 6]
        assert PlanBuilder._default_rep_range(8) == [8, 10]
        assert PlanBuilder._default_rep_range(12) == [12, 15]

    def test_the_stated_figure_becomes_the_floor_not_the_middle(self):
        """
        A band is a target to climb to, never a ceiling to be pushed back
        under — the same inversion the rep step was fixed for. Centring a band
        on 8 would prescribe 6, fewer reps than the model asked for.
        """
        from ai_analysis.plan_builder import PlanBuilder

        for reps in (3, 5, 8, 10, 12, 15):
            low, high = PlanBuilder._default_rep_range(reps)
            assert low == reps
            assert high > low

    def test_a_heavy_triple_gets_less_room_than_a_set_of_fifteen(self):
        """Two reps of slack is most of a triple and noise on a fifteen."""
        from ai_analysis.plan_builder import PlanBuilder

        triple = PlanBuilder._default_rep_range(3)
        fifteen = PlanBuilder._default_rep_range(15)
        assert (triple[1] - triple[0]) < (fifteen[1] - fifteen[0])


def test_unlocked_plan_is_left_alone():
    proposal = {"days": [day("Push A", "press", "curl")]}
    locked = {"days": [day("Push A", "press")]}
    assert enforce_locked_exercises(proposal, locked) is proposal


def test_locked_list_keeps_user_lifts_and_takes_model_sets():
    locked = {
        "exercise_list_locked": True,
        "days": [day("Push A", "press", "fly")],
    }
    proposal = {
        "days": [{
            "day_name": "Push A",
            "exercises": [
                {"exercise_id": "press", "exercise_name": "press", "sets": 5, "reps": 5},
                {"exercise_id": "fly", "exercise_name": "fly", "sets": 3, "reps": 12},
                {"exercise_id": "curl", "exercise_name": "curl", "sets": 3, "reps": 10},
            ],
        }],
        "changes": [],
    }
    plan = enforce_locked_exercises(proposal, locked)
    ids = [ex["exercise_id"] for ex in plan["days"][0]["exercises"]]
    assert ids == ["press", "fly"]
    assert plan["days"][0]["exercises"][0]["sets"] == 5
    assert any(c.get("exercise_name") == "curl" for c in plan["changes"])


def test_locked_list_restores_a_lift_the_model_dropped():
    locked = {
        "exercise_list_locked": True,
        "days": [day("Push A", "press", "fly")],
    }
    proposal = {"days": [day("Push A", "press")], "changes": []}
    plan = enforce_locked_exercises(proposal, locked)
    ids = [ex["exercise_id"] for ex in plan["days"][0]["exercises"]]
    assert ids == ["press", "fly"]


def test_locked_list_is_in_the_revision_prompt():
    builder = PlanBuilder.__new__(PlanBuilder)
    text = builder._build_prompt(
        [], {}, {}, {}, "adapt_split",
        existing_plan={
            "exercise_list_locked": True,
            "days": [day("Push A", "press")],
        },
    )
    assert "USER-LOCKED EXERCISE LIST" in text
    assert "press" in text


def test_generation_honours_a_locked_exercise_list():
    locked = {
        "exercise_list_locked": True,
        "days": [day("Push A", "press", "fly")],
        "weekly_schedule": {"monday": "Push A"},
    }
    raw = {
        "days": [day("Push A", "press", "fly", "curl")],
        "weekly_schedule": {"monday": "Push A"},
    }
    builder, _ = builder_with_responses(raw)
    result = builder.build_plan([], {}, {}, {}, existing_plan=locked)
    assert result["status"] == "success"
    ids = [ex["exercise_id"] for ex in result["plan"]["days"][0]["exercises"]]
    assert ids == ["press", "fly"]
    assert result["plan"]["exercise_list_locked"] is True
