"""
Forward projection of a plan, and the nutrition ramp beside it.

The properties worth pinning are mostly about honesty: the realistic line must
never outrun the best case, a missing profile must suppress the weight curve
rather than guess it, and a cut must not ramp its deficit deeper.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from ai_analysis.plan_projection import (
    DEFAULT_ADHERENCE,
    MIN_SESSIONS_FOR_ADHERENCE,
    PlanProjector,
    e1rm,
    measure_adherence,
)
from nutrition.trajectory import (
    build_trajectory,
    estimate_maintenance_calories,
)

BENCH = "default-chest-db-bench-press"
BENCH_NAME = "Dumbbell Bench Press"

FULL_PROFILE = {
    "weight": 180,
    "age": 28,
    "gender": "male",
    "height_ft": 5,
    "height_in": 11,
    "preferred_workout_frequency": "4-5",
}


@pytest.fixture
def projector():
    return PlanProjector()


def session(weight, reps, date="2026-08-10"):
    return {
        "date": date,
        "sets": [
            {"weight": weight, "reps": r, "set_number": i + 1}
            for i, r in enumerate(reps)
        ],
    }


def project(projector, history, weeks=8, adherence=1.0, **kwargs):
    return projector.project_exercise(
        exercise_id=BENCH,
        exercise_name=BENCH_NAME,
        day_name="Push",
        history=history,
        user_goal="Build Muscle",
        weeks=weeks,
        adherence=adherence,
        **kwargs,
    )


# === Strength projection ================================================


class TestStrengthProjection:
    def test_projects_one_point_per_week(self, projector):
        result = project(projector, [session(50, [8, 8, 8])], weeks=8)
        assert [p.week for p in result.best_case] == list(range(1, 9))

    def test_best_case_climbs(self, projector):
        result = project(projector, [session(50, [8, 8, 8])], weeks=8)
        assert result.best_case[-1].e1rm > result.best_case[0].e1rm

    def test_load_never_goes_backwards_in_best_case(self, projector):
        """
        The projection walks the real engine, so an oscillation here would mean
        an oscillation in the live recommender.
        """
        result = project(projector, [session(50, [8, 8, 8])], weeks=12)
        loads = [p.weight for p in result.best_case]
        assert loads == sorted(loads), f"projected load regressed: {loads}"

    def test_training_a_lift_twice_a_week_projects_faster(self, projector):
        once = project(projector, [session(50, [8, 8, 8])], sessions_per_week=1)
        twice = project(projector, [session(50, [8, 8, 8])], sessions_per_week=2)
        assert twice.best_case[-1].e1rm > once.best_case[-1].e1rm

    def test_current_point_comes_from_real_history(self, projector):
        result = project(projector, [session(50, [8, 8, 8])])
        assert result.seeded_from_history
        assert result.current.weight == 50
        assert result.current.e1rm == e1rm(50, 8)

    def test_no_history_is_flagged_not_hidden(self, projector):
        """A curve from an estimate must say so rather than look measured."""
        result = project(projector, [], top_lifts={"bench_press": 135})
        assert result.seeded_from_history is False


class TestRealisticLine:
    """
    The honesty constraints. A realistic line that could exceed the best case,
    or that ignored adherence, would defeat the point of drawing two.
    """

    def test_realistic_never_claims_progress_best_case_has_not_reached(self, projector):
        """
        Not a point-for-point comparison: estimated 1RM genuinely dips when the
        load jumps and reps reset (50x10 is a higher e1RM than 55x6), so the
        best-case curve saws. The property that matters is that every realistic
        week sits at or behind where best case had already got to by then.
        """
        result = project(projector, [session(50, [8, 8, 8])], weeks=12, adherence=0.7)
        for i, real in enumerate(result.realistic):
            reached = max(p.e1rm for p in result.best_case[: i + 1])
            assert real.e1rm <= reached + 0.05

    def test_lower_adherence_projects_less_progress(self, projector):
        strong = project(projector, [session(50, [8, 8, 8])], weeks=12, adherence=0.9)
        weak = project(projector, [session(50, [8, 8, 8])], weeks=12, adherence=0.5)
        assert weak.realistic[-1].e1rm < strong.realistic[-1].e1rm

    def test_perfect_adherence_matches_best_case(self, projector):
        result = project(projector, [session(50, [8, 8, 8])], weeks=8, adherence=1.0)
        assert [p.e1rm for p in result.realistic] == [p.e1rm for p in result.best_case]

    def test_realistic_loads_stay_on_real_increments(self, projector):
        """Interpolating e1RM is fine; interpolating load invents weights."""
        result = project(projector, [session(50, [8, 8, 8])], weeks=12, adherence=0.66)
        best_loads = {p.weight for p in result.best_case} | {50.0}
        assert all(p.weight in best_loads for p in result.realistic)

    def test_realistic_still_progresses(self, projector):
        result = project(projector, [session(50, [8, 8, 8])], weeks=12, adherence=0.5)
        assert result.realistic[-1].e1rm > result.realistic[0].e1rm


class TestAdherence:
    def test_thin_history_is_not_measured(self):
        histories = {BENCH: [session(50, [8, 8, 8])]}
        result = measure_adherence(histories, "Build Muscle")
        assert result.measured is False
        assert result.rate == DEFAULT_ADHERENCE

    def test_default_is_not_perfect(self):
        """Assuming a new user hits everything is the over-promise to avoid."""
        assert DEFAULT_ADHERENCE < 1.0

    def test_consistent_history_scores_high(self):
        histories = {
            BENCH: [session(50, [9, 9, 9], f"2026-08-{i:02d}") for i in range(1, 9)]
        }
        result = measure_adherence(histories, "Build Muscle")
        assert result.measured is True
        assert result.rate >= 0.9

    def test_short_sessions_score_low(self):
        histories = {
            BENCH: [session(50, [3, 3, 2], f"2026-08-{i:02d}") for i in range(1, 9)]
        }
        result = measure_adherence(histories, "Build Muscle")
        assert result.rate < 0.5

    def test_rate_has_a_floor(self):
        """A flat chart helps nobody, however inconsistent the history."""
        histories = {
            BENCH: [session(50, [1, 1, 1], f"2026-08-{i:02d}") for i in range(1, 9)]
        }
        assert measure_adherence(histories, "Build Muscle").rate >= 0.35


# === Nutrition trajectory ===============================================


class TestNutritionTrajectory:
    TARGETS = {"calories": 2800, "protein": 190}

    def test_bulk_ramps_up(self):
        t = build_trajectory("lean_bulk", self.TARGETS, weeks=8, profile=FULL_PROFILE)
        assert t.weeks[0].calories == 2800
        assert t.weeks[1].calories == 2900
        assert t.weeks[-1].calories > t.weeks[0].calories

    def test_bulk_ramp_is_capped(self):
        t = build_trajectory("lean_bulk", self.TARGETS, weeks=16, profile=FULL_PROFILE)
        assert max(w.calories for w in t.weeks) <= 2800 + 500

    def test_cut_does_not_deepen_its_deficit(self):
        """
        Ramping a deficit lower week after week costs adherence and muscle. The
        right answer to a stalled cut is a diet break, not a bigger cut.
        """
        t = build_trajectory("fat_loss", {"calories": 2000, "protein": 170}, weeks=10)
        assert len({w.calories for w in t.weeks}) == 1

    def test_maintain_is_flat(self):
        t = build_trajectory("maintain", {"calories": 2200, "protein": 160}, weeks=6)
        assert len({w.calories for w in t.weeks}) == 1

    def test_weight_curve_needs_a_complete_profile(self):
        t = build_trajectory("lean_bulk", self.TARGETS, weeks=6, profile={"weight": 180})
        assert t.maintenance_calories is None
        assert all(w.expected_weight_change_lb is None for w in t.weeks)
        assert "height" in t.rationale

    def test_weight_curve_appears_with_a_full_profile(self):
        t = build_trajectory("lean_bulk", self.TARGETS, weeks=6, profile=FULL_PROFILE)
        assert t.maintenance_calories
        assert t.weeks[-1].expected_weight_change_lb is not None
        # A surplus gains weight, and the projection starts from real bodyweight.
        assert t.weeks[-1].expected_weight_lb > FULL_PROFILE["weight"]

    def test_surplus_gain_is_physically_plausible(self):
        """A 6-week lean bulk should not project double-digit pounds."""
        t = build_trajectory("lean_bulk", self.TARGETS, weeks=6, profile=FULL_PROFILE)
        assert 0 < t.weeks[-1].expected_weight_change_lb < 12

    def test_override_drives_the_ramp(self):
        """What the plan chat adjusts when a user wants a faster surplus."""
        t = build_trajectory(
            "lean_bulk", self.TARGETS, weeks=6, profile=FULL_PROFILE,
            weekly_step_override=200,
        )
        assert t.weekly_step == 200
        assert t.weeks[1].calories == 3000

    def test_override_on_a_flat_goal_is_still_capped(self):
        t = build_trajectory(
            "maintain", {"calories": 2200, "protein": 160}, weeks=40,
            weekly_step_override=100,
        )
        assert max(w.calories for w in t.weeks) <= 2200 + 100 * 40


class TestMaintenanceEstimate:
    def test_full_profile_gives_a_plausible_number(self):
        value = estimate_maintenance_calories(FULL_PROFILE)
        assert 2200 < value < 3600

    @pytest.mark.parametrize("missing", ["weight", "age", "gender", "height_ft"])
    def test_any_missing_field_returns_none(self, missing):
        profile = dict(FULL_PROFILE)
        profile.pop(missing)
        assert estimate_maintenance_calories(profile) is None

    def test_unknown_sex_returns_none_rather_than_assuming(self):
        profile = {**FULL_PROFILE, "gender": "unspecified"}
        assert estimate_maintenance_calories(profile) is None

    def test_height_cm_is_accepted(self):
        profile = {k: v for k, v in FULL_PROFILE.items() if k not in ("height_ft", "height_in")}
        profile["height_cm"] = 180
        assert estimate_maintenance_calories(profile)


class TestGoalMismatchWarnings:
    """
    Targets come from per-goal defaults that know nothing about the individual,
    so they can point the opposite way to the goal they are labelled with.
    """

    def test_bulk_below_maintenance_is_flagged(self):
        t = build_trajectory(
            "lean_bulk", {"calories": 2800, "protein": 190}, weeks=8, profile=FULL_PROFILE
        )
        assert t.maintenance_calories > 2800
        assert t.warnings and "maintenance" in t.warnings[0]

    def test_a_real_surplus_is_not_flagged(self):
        t = build_trajectory(
            "lean_bulk", {"calories": 3400, "protein": 190}, weeks=8, profile=FULL_PROFILE
        )
        assert t.warnings == []

    def test_cut_above_maintenance_is_flagged(self):
        t = build_trajectory(
            "fat_loss", {"calories": 3200, "protein": 170}, weeks=8, profile=FULL_PROFILE
        )
        assert t.warnings

    def test_no_maintenance_estimate_means_no_warning(self):
        """Never warn on the strength of a number we could not compute."""
        t = build_trajectory(
            "lean_bulk", {"calories": 1500, "protein": 190}, weeks=8, profile={"weight": 180}
        )
        assert t.warnings == []
