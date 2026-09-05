"""Tests for the centralized plan-context resolver and plan validation."""

import sys
import os
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.workout_recommender.plan_context import (
    PlanContextResolver,
    PlanContext,
    normalize_rep_range,
)
from ai_analysis.plan_builder import PlanBuilder
from ai_analysis.plan_store import PlanStore


ACTIVE_PLAN = {
    "id": "plan1",
    "plan_name": "Incline Strength + Muscle Growth",
    "plan_type": "goal",
    "status": "active",
    "is_active": True,
    "weekly_schedule": {
        "monday": "Push A", "tuesday": "Pull", "wednesday": "Rest",
        "thursday": "Push B", "friday": "Legs", "saturday": "Rest", "sunday": "Rest",
    },
    "days": [
        {
            "day_name": "Push A",
            "day_goal": "Incline strength",
            "day_type": "heavy",
            "goal": "hypertrophy",
            "exercises": [
                {
                    "exercise_id": "incline_db_press", "exercise_name": "Incline Dumbbell Press",
                    "sets": 4, "reps": 5, "order": 1,
                    "goal": "strength", "priority": "high", "target_rep_range": [4, 6],
                },
                {
                    "exercise_id": "lateral_raise", "exercise_name": "Lateral Raise",
                    "sets": 3, "reps": 15, "order": 2,
                },
            ],
        },
        {
            "day_name": "Push B",
            "day_goal": "Incline volume",
            "day_type": "volume",
            "exercises": [
                {
                    "exercise_id": "incline_db_press", "exercise_name": "Incline Dumbbell Press",
                    "sets": 3, "reps": 10, "order": 1, "priority": "supporting",
                },
            ],
        },
    ],
}


def make_resolver(plan=ACTIVE_PLAN, focus=None):
    """Resolver over a stubbed Firestore holding a single plan."""
    doc = MagicMock()
    doc.id = (plan or {}).get("id", "plan1")
    doc.to_dict.return_value = dict(plan) if plan else {}

    db = MagicMock()
    query = MagicMock()
    query.stream.return_value = [doc] if plan else []
    db.collection.return_value.document.return_value.collection.return_value.where.return_value = query

    focus_store = MagicMock()
    focus_store.get_focus_for_exercise.return_value = focus
    return PlanContextResolver(db, "u1", focus_store=focus_store)


class TestResolutionOrder:
    """Most specific layer wins: exercise > day > focus > profile > default."""

    def test_exercise_plan_context_wins(self):
        ctx = make_resolver().resolve(
            "incline_db_press", "Incline Dumbbell Press",
            split_day="Push A", profile_goal="Build Muscle")
        assert ctx.goal == "strength"
        assert ctx.source == "plan_exercise"
        assert ctx.target_rep_range == (4, 6)
        assert ctx.priority == "high"

    def test_day_plan_context_when_exercise_has_no_goal(self):
        ctx = make_resolver().resolve(
            "lateral_raise", "Lateral Raise",
            split_day="Push A", profile_goal="Get Stronger")
        # Day says hypertrophy; the profile says strength. Day wins.
        assert ctx.goal == "hypertrophy"
        assert ctx.day_type == "heavy"
        # The row exists in the plan, so the sets and reps came from the
        # exercise layer even though the GOAL fell through to the day. `source`
        # names the most specific layer that contributed anything, not the one
        # that happened to supply the goal — the only consumer compares it
        # against "default" (see WorkoutRecommender), so it is a transparency
        # label and "plan_exercise" is the more informative one to show.
        assert ctx.source == "plan_exercise"

    def test_training_focus_when_plan_is_silent(self):
        resolver = make_resolver(
            plan=None, focus={"goal": "strength", "note": "bench emphasis"})
        ctx = resolver.resolve("bench", "Bench Press", profile_goal="Build Muscle")
        assert ctx.goal == "strength"
        assert ctx.source == "training_focus"

    def test_plan_overrides_training_focus(self):
        resolver = make_resolver(focus={"goal": "fat_loss"})
        ctx = resolver.resolve(
            "incline_db_press", "Incline Dumbbell Press",
            split_day="Push A", profile_goal="Build Muscle")
        assert ctx.goal == "strength"
        assert ctx.source == "plan_exercise"

    def test_profile_goal_when_no_plan_or_focus(self):
        ctx = make_resolver(plan=None).resolve(
            "leg_curl", "Leg Curl", profile_goal="Lose Fat")
        assert ctx.goal == "fat_loss"
        assert ctx.source == "profile"

    def test_default_fallback_when_profile_goal_unknown(self):
        ctx = make_resolver(plan=None).resolve("leg_curl", "Leg Curl", profile_goal="???")
        assert ctx.goal == "hypertrophy"
        assert ctx.source == "default"

    def test_exercise_outside_the_plan_falls_through(self):
        ctx = make_resolver().resolve("bicep_curl", "Bicep Curl", profile_goal="Build Muscle")
        assert ctx.source == "profile"
        assert ctx.target_rep_range is None


class TestDayResolution:
    def test_same_exercise_differs_by_day(self):
        """Incline is a strength priority on Push A, supporting volume on Push B."""
        resolver = make_resolver()
        a = resolver.resolve("incline_db_press", "Incline Dumbbell Press", split_day="Push A")
        b = resolver.resolve("incline_db_press", "Incline Dumbbell Press", split_day="Push B")

        assert a.goal == "strength" and a.priority == "high"
        assert a.day_type == "heavy"
        assert b.priority == "supporting"
        assert b.day_type == "volume"

    def test_finds_exercise_without_a_named_day(self):
        ctx = make_resolver().resolve("incline_db_press", "Incline Dumbbell Press")
        assert ctx.goal == "strength"
        assert ctx.day_name in ("Push A", "Push B")

    def test_day_type_maps_to_engine_intensity(self):
        resolver = make_resolver()
        assert resolver.resolve("lateral_raise", "Lateral Raise",
                                split_day="Push A").day_intensity == "heavy"
        # A volume day stays "volume" rather than collapsing to "normal".
        # ProgressionEngine branches on it directly (`day_intensity ==
        # "volume"` in both _select_prescription and the plan-day calibration),
        # so flattening it made a high-volume day indistinguishable from every
        # other workout and let a heavy day's load/rep target bleed into it.
        assert resolver.resolve("incline_db_press", "Incline Dumbbell Press",
                                split_day="Push B").day_intensity == "volume"


class TestPlanLifecycleAffectsResolution:
    def test_paused_plan_is_not_applied(self):
        paused = {**ACTIVE_PLAN, "status": "paused", "is_active": False}
        ctx = make_resolver(plan=paused).resolve(
            "incline_db_press", "Incline Dumbbell Press", profile_goal="Build Muscle")
        assert ctx.source == "profile"

    def test_draft_plan_is_not_applied(self):
        draft = {**ACTIVE_PLAN, "status": "draft", "is_active": False}
        ctx = make_resolver(plan=draft).resolve(
            "incline_db_press", "Incline Dumbbell Press", profile_goal="Build Muscle")
        assert ctx.source == "profile"

    def test_legacy_plan_without_status_still_applies(self):
        """Wizard plans predate the status field and must keep working."""
        legacy = {k: v for k, v in ACTIVE_PLAN.items() if k != "status"}
        ctx = make_resolver(plan=legacy).resolve(
            "incline_db_press", "Incline Dumbbell Press", split_day="Push A")
        assert ctx.source == "plan_exercise"

    def test_firestore_failure_degrades_to_profile_goal(self):
        db = MagicMock()
        db.collection.side_effect = RuntimeError("firestore down")
        focus_store = MagicMock()
        focus_store.get_focus_for_exercise.return_value = None
        resolver = PlanContextResolver(db, "u1", focus_store=focus_store)
        ctx = resolver.resolve("bench", "Bench Press", profile_goal="Build Muscle")
        assert ctx.goal == "hypertrophy"
        assert ctx.source == "profile"


class TestNormalizeRepRange:
    def test_accepts_list_tuple_and_string(self):
        assert normalize_rep_range([4, 6]) == (4, 6)
        assert normalize_rep_range((8, 12)) == (8, 12)
        assert normalize_rep_range("4-6") == (4, 6)

    def test_orders_reversed_bounds(self):
        assert normalize_rep_range([10, 5]) == (5, 10)

    def test_rejects_nonsense(self):
        for bad in (None, "", "many", [0, 5], [-1, 5], [4], [1, 99], {"low": 4}):
            assert normalize_rep_range(bad) is None


class TestPlanValidation:
    def _plan(self, **overrides):
        base = {
            "plan_name": "Test", "duration_weeks": 6,
            "weekly_schedule": {"monday": "Push A", "tuesday": "Rest"},
            "days": [{
                "day_name": "Push A", "focus": "Push",
                "goal": "hypertrophy", "day_type": "heavy",
                "exercises": [{
                    "exercise_id": "custom-1", "exercise_name": "Incline DB Press",
                    "sets": 4, "reps": 5, "goal": "strength",
                    "priority": "high", "target_rep_range": [4, 6],
                }],
            }],
        }
        base.update(overrides)
        return base

    def test_keeps_valid_intent_fields(self):
        plan = PlanBuilder.validate_plan(self._plan())
        ex = plan["days"][0]["exercises"][0]
        assert ex["goal"] == "strength"
        assert ex["priority"] == "high"
        assert ex["target_rep_range"] == [4, 6]
        assert plan["days"][0]["day_type"] == "heavy"

    def test_drops_invalid_enums_rather_than_guessing(self):
        bad = self._plan()
        bad["days"][0]["exercises"][0]["goal"] = "mega-strength"
        bad["days"][0]["exercises"][0]["priority"] = "urgent"
        bad["days"][0]["day_type"] = "brutal"

        plan = PlanBuilder.validate_plan(bad)
        ex = plan["days"][0]["exercises"][0]
        assert "goal" not in ex
        assert "priority" not in ex
        assert "day_type" not in plan["days"][0]

    def test_clamps_sets_and_reps(self):
        bad = self._plan()
        bad["days"][0]["exercises"][0]["sets"] = 99
        bad["days"][0]["exercises"][0]["reps"] = 0
        plan = PlanBuilder.validate_plan(bad)
        ex = plan["days"][0]["exercises"][0]
        assert ex["sets"] == 10
        assert ex["reps"] == 1

    def test_schedule_cannot_reference_a_missing_day(self):
        bad = self._plan(weekly_schedule={"monday": "Push A", "friday": "Ghost Day"})
        plan = PlanBuilder.validate_plan(bad)
        assert plan["weekly_schedule"]["monday"] == "Push A"
        assert plan["weekly_schedule"]["friday"] == "Rest"
        # every weekday present
        assert len(plan["weekly_schedule"]) == 7

    def test_follow_split_mode_rejects_exercises_outside_the_split(self):
        plan_data = self._plan()
        plan_data["days"][0]["exercises"].append({
            "exercise_id": "smuggled-in", "exercise_name": "Sneaky Curl",
            "sets": 3, "reps": 10,
        })
        plan = PlanBuilder.validate_plan(plan_data, allowed_ids={"custom-1"})
        names = [e["exercise_name"] for e in plan["days"][0]["exercises"]]
        assert names == ["Incline DB Press"]

    def test_duration_is_bounded(self):
        assert PlanBuilder.validate_plan(self._plan(duration_weeks=999))["duration_weeks"] == 24
        assert PlanBuilder.validate_plan(self._plan(duration_weeks="junk"))["duration_weeks"] == 12

    def test_survives_a_completely_empty_payload(self):
        plan = PlanBuilder.validate_plan({})
        assert plan["days"] == []
        assert all(v == "Rest" for v in plan["weekly_schedule"].values())


class TestPlanProgress:
    def test_reports_week_of_total(self):
        from datetime import datetime, timedelta
        start = (datetime.now() - timedelta(days=10)).isoformat()
        progress = PlanStore.progress({"start_date": start, "duration_weeks": 6})
        assert progress["current_week"] == 2
        assert progress["total_weeks"] == 6

    def test_handles_missing_or_bad_dates(self):
        assert PlanStore.progress({})["current_week"] is None
        assert PlanStore.progress(
            {"start_date": "nope", "duration_weeks": 6})["current_week"] is None

    def test_week_never_exceeds_duration(self):
        from datetime import datetime, timedelta
        start = (datetime.now() - timedelta(days=400)).isoformat()
        progress = PlanStore.progress({"start_date": start, "duration_weeks": 6})
        assert progress["current_week"] == 6


class TestFollowSplitFidelity:
    """follow_split must not change which days the user trains."""

    SPLIT_DAYS = {"Push", "Pull", "Legs"}

    def _plan_with_days(self, names):
        return {
            "plan_name": "P", "weekly_schedule": {n.lower(): n for n in names},
            "days": [{"day_name": n, "focus": n, "exercises": [
                {"exercise_id": "e1", "exercise_name": "Ex", "sets": 3, "reps": 8}]}
                for n in names],
        }

    def test_drops_invented_days(self):
        plan = PlanBuilder.validate_plan(
            self._plan_with_days(["Push A", "Push B", "Pull", "Legs"]),
            allowed_day_names=self.SPLIT_DAYS)
        assert {d["day_name"] for d in plan["days"]} == {"Pull", "Legs"}

    def test_keeps_matching_days(self):
        plan = PlanBuilder.validate_plan(
            self._plan_with_days(["Push", "Pull", "Legs"]),
            allowed_day_names=self.SPLIT_DAYS)
        assert {d["day_name"] for d in plan["days"]} == self.SPLIT_DAYS

    def test_day_matching_is_case_insensitive(self):
        plan = PlanBuilder.validate_plan(
            self._plan_with_days(["push", "PULL"]), allowed_day_names=self.SPLIT_DAYS)
        assert len(plan["days"]) == 2

    def test_no_constraint_allows_any_day(self):
        plan = PlanBuilder.validate_plan(self._plan_with_days(["Push A", "Push B"]))
        assert len(plan["days"]) == 2


class TestEmptyConstraintHandling:
    """
    An empty constraint set means "we couldn't read the split", not "reject
    everything". This asymmetry silently produced exercise-less plans.
    """

    PLAN = {
        "plan_name": "P",
        "weekly_schedule": {"monday": "Push"},
        "days": [{
            "day_name": "Push", "focus": "Push",
            "exercises": [
                {"exercise_id": "custom-1", "exercise_name": "Incline DB Press",
                 "sets": 4, "reps": 6},
            ],
        }],
    }

    def test_empty_allowed_ids_does_not_strip_every_exercise(self):
        plan = PlanBuilder.validate_plan(self.PLAN, allowed_ids=set())
        assert len(plan["days"]) == 1
        assert len(plan["days"][0]["exercises"]) == 1

    def test_empty_allowed_day_names_does_not_strip_every_day(self):
        plan = PlanBuilder.validate_plan(self.PLAN, allowed_day_names=set())
        assert len(plan["days"]) == 1

    def test_populated_allowed_ids_still_filters(self):
        plan = PlanBuilder.validate_plan(self.PLAN, allowed_ids={"something-else"})
        assert plan["days"] == []


class TestDegenerateDays:
    def test_day_without_exercises_is_dropped(self):
        plan = PlanBuilder.validate_plan({
            "plan_name": "P",
            "weekly_schedule": {"monday": "Push", "tuesday": "Pull"},
            "days": [
                {"day_name": "Push", "focus": "Push", "exercises": []},
                {"day_name": "Pull", "focus": "Pull", "exercises": [
                    {"exercise_id": "e1", "exercise_name": "Row", "sets": 3, "reps": 10}]},
            ],
        })
        assert [d["day_name"] for d in plan["days"]] == ["Pull"]
        # the schedule must not point at a day that no longer exists
        assert plan["weekly_schedule"]["monday"] == "Rest"
        assert plan["weekly_schedule"]["tuesday"] == "Pull"

    def test_duplicate_day_names_are_collapsed(self):
        """Splits can legitimately list the same day twice."""
        day = {"day_name": "Push", "focus": "Push", "exercises": [
            {"exercise_id": "e1", "exercise_name": "Press", "sets": 3, "reps": 8}]}
        plan = PlanBuilder.validate_plan({
            "plan_name": "P", "weekly_schedule": {"monday": "Push"},
            "days": [dict(day), dict(day)],
        })
        assert len(plan["days"]) == 1


class TestExerciseIdRepair:
    """
    Models frequently put the display name in exercise_id. Left alone, the plan
    only links to logged workouts through fuzzy name matching.
    """

    def _plan(self, exercise):
        return {
            "plan_name": "P", "weekly_schedule": {"monday": "Push"},
            "days": [{"day_name": "Push", "focus": "Push", "exercises": [exercise]}],
        }

    def _first(self, plan):
        return plan["days"][0]["exercises"][0]

    def test_name_used_as_id_is_repaired_to_catalog_id(self):
        out = PlanBuilder.validate_plan(self._plan({
            "exercise_id": "Incline Dumbbell Press",
            "exercise_name": "Incline Dumbbell Press", "sets": 4, "reps": 5}))
        assert self._first(out)["exercise_id"] == "default-chest-db-incline-press"

    def test_missing_id_is_filled_from_the_name(self):
        out = PlanBuilder.validate_plan(self._plan({
            "exercise_id": "", "exercise_name": "Parallel Bar Dips",
            "sets": 3, "reps": 8}))
        assert self._first(out)["exercise_id"] == "default-triceps-bw-parallel-dips"

    def test_valid_catalog_id_is_left_alone(self):
        out = PlanBuilder.validate_plan(self._plan({
            "exercise_id": "default-chest-db-incline-press",
            "exercise_name": "Renamed By User", "sets": 4, "reps": 5}))
        assert self._first(out)["exercise_id"] == "default-chest-db-incline-press"

    def test_split_ids_win_over_the_catalog(self):
        """A custom exercise the user actually logs against must be preferred."""
        mapping = PlanBuilder._name_to_id({"days": [{"exercises": [
            {"exercise_id": "user-custom-123", "exercise_name": "Incline Dumbbell Press"}]}]})
        out = PlanBuilder.validate_plan(
            self._plan({"exercise_id": "Incline Dumbbell Press",
                        "exercise_name": "Incline Dumbbell Press", "sets": 4, "reps": 5}),
            name_to_id=mapping)
        assert self._first(out)["exercise_id"] == "user-custom-123"

    def test_unknown_exercise_keeps_its_id_rather_than_vanishing(self):
        out = PlanBuilder.validate_plan(self._plan({
            "exercise_id": "totally-made-up", "exercise_name": "Nonexistent Move",
            "sets": 3, "reps": 8}))
        assert self._first(out)["exercise_id"] == "totally-made-up"
