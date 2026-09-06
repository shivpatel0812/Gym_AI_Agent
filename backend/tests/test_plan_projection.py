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
    DEFAULT_EXPERIENCE_LEVEL,
    EXPERIENCE_WEEKLY_E1RM_GAIN,
    MIN_SESSIONS_FOR_ADHERENCE,
    PlanProjector,
    e1rm,
    exercise_sessions_per_week,
    measure_adherence,
    pace_to_destination,
    plausible_weekly_gain,
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
        """
        Sooner, not higher — the same claim TestPlausibilityCeiling makes.

        Compared on load, not estimated 1RM. e1RM dips on the session a weight
        jump lands, so the curve that is *further ahead* can show the lower
        e1RM purely because it just reset into a new range.

        This used to assert a higher peak load, which only passed while the
        plausibility ceiling was loose enough never to bind. It cannot be true
        in general: the ceiling is a budget over time, so training more often
        spends that budget earlier and arrives at the same place first. A
        frequency that raised the ceiling would mean pressing six days a week
        projects a bigger twelve-week gain than pressing twice, which is the
        opposite of what recovery does.
        """
        once = project(projector, [session(50, [8, 8, 8])], sessions_per_week=1)
        twice = project(projector, [session(50, [8, 8, 8])], sessions_per_week=2)

        def first_week_at(result, load):
            return next(
                (p.week for p in result.best_case if p.weight >= load), None
            )

        peak = max(p.weight for p in once.best_case)
        assert max(p.weight for p in twice.best_case) == peak
        assert first_week_at(twice, peak) < first_week_at(once, peak)

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


class TestPlausibilityCeiling:
    """
    Double progression compounds without limit; bodies do not. Without a
    ceiling the projection claimed a 95% estimated-1RM gain on a lateral raise
    in twelve weeks, because the smallest available plate is a 25% jump on a
    20 lb lift and the simulation kept taking it.
    """

    def test_light_isolation_lift_stays_plausible(self, projector):
        result = projector.project_exercise(
            exercise_id="default-shoulders-db-lateral-raise",
            exercise_name="Lateral Raise",
            day_name="Push",
            history=[session(20, [13, 12, 12])],
            user_goal="Build Muscle",
            weeks=12,
            sessions_per_week=2,
            adherence=1.0,
        )
        start = result.current.e1rm
        peak = max(p.e1rm for p in result.best_case)
        assert (peak - start) / start < 0.35, f"{start} -> {peak} is not plausible"

    def test_the_curve_still_climbs_under_the_cap(self, projector):
        """A ceiling that flattens everything to nothing is not a fix."""
        result = project(projector, [session(50, [8, 8, 8])], weeks=12)
        assert max(p.e1rm for p in result.best_case) > result.current.e1rm

    def test_string_reps_in_history_do_not_crash(self, projector):
        """Firestore logs often store reps as strings; projection must not 500."""
        history = [{
            "date": "2026-08-01",
            "sets": [{"weight": "80", "reps": "8", "set_number": 1}],
        }]
        result = projector.project_exercise(
            exercise_id="default-chest-bench",
            exercise_name="Bench Press",
            day_name="Push",
            history=history,
            user_goal="Build Muscle",
            weeks=4,
        )
        assert result.current is not None
        assert result.current.e1rm > 0

    def test_horizon_is_never_truncated_by_a_stall(self, projector):
        """Hitting the ceiling holds the last point, it does not end the chart."""
        result = projector.project_exercise(
            exercise_id="default-shoulders-db-lateral-raise",
            exercise_name="Lateral Raise",
            day_name="Push",
            history=[session(20, [13, 12, 12])],
            user_goal="Build Muscle",
            weeks=12,
            sessions_per_week=2,
            adherence=1.0,
        )
        assert [p.week for p in result.best_case] == list(range(1, 13))

    def test_early_weeks_are_not_blocked_by_the_cap(self, projector):
        """
        Load arrives in indivisible steps, so a single increment can be worth
        more than the weekly cap on a light lift. Applied from week one the
        ceiling would block the first rep increase and flatten every curve.
        """
        result = project(projector, [session(50, [8, 8, 8])], weeks=4)
        assert result.best_case[0].e1rm > result.current.e1rm

    def test_frequency_reaches_the_ceiling_sooner_not_higher(self, projector):
        """The plausible ceiling is a property of time, not of training more."""
        once = project(projector, [session(50, [8, 8, 8])], weeks=12, sessions_per_week=1)
        twice = project(projector, [session(50, [8, 8, 8])], weeks=12, sessions_per_week=2)
        peak_once = max(p.e1rm for p in once.best_case)
        peak_twice = max(p.e1rm for p in twice.best_case)
        assert abs(peak_twice - peak_once) / peak_once < 0.1


class TestPacedWeightCurve:
    """
    Any pacing style that rewrites a week's calories has to rewrite the weight
    curve with it, or the two charts on the page describe different plans.
    """

    def test_diet_break_weeks_do_not_keep_losing_weight(self):
        from nutrition.pacing import build_paced_trajectory

        traj = build_paced_trajectory(
            {
                "goal": "fat_loss",
                "targets": {"calories": 2200, "protein": 180},
                "pacing": {"style": "diet_break", "break_every_n_weeks": 3},
            },
            weeks=9,
            profile=FULL_PROFILE,
        )
        rows = traj["weeks"]
        by_week = {r["week"]: r for r in rows}
        for week, row in by_week.items():
            if row.get("phase") != "diet_break":
                continue
            previous = by_week.get(week - 1)
            assert previous, "a break week should never be week 1"
            drift = row["expected_weight_lb"] - previous["expected_weight_lb"]
            assert abs(drift) < 0.5, f"week {week} ate at maintenance but moved {drift} lb"

    def test_cut_weeks_still_lose(self):
        from nutrition.pacing import build_paced_trajectory

        traj = build_paced_trajectory(
            {
                "goal": "fat_loss",
                "targets": {"calories": 2200, "protein": 180},
                "pacing": {"style": "diet_break", "break_every_n_weeks": 3},
            },
            weeks=9,
            profile=FULL_PROFILE,
        )
        first, last = traj["weeks"][0], traj["weeks"][-1]
        assert last["expected_weight_lb"] < first["expected_weight_lb"]

    def test_ordinal_reads_as_english(self):
        from nutrition.pacing import _ordinal

        assert [_ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21)] == [
            "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st",
        ]


class TestMaintenanceTracksBodyweight:
    def test_maintenance_rises_with_weight(self):
        from nutrition.trajectory import maintenance_at_weight

        light = maintenance_at_weight(FULL_PROFILE, 180)
        heavy = maintenance_at_weight(FULL_PROFILE, 200)
        assert heavy > light

    def test_a_bulk_decelerates_as_maintenance_catches_up(self):
        """
        The rationale tells the user maintenance rises as they gain. Holding it
        fixed made the model contradict its own copy and overstate the gain.
        """
        t = build_trajectory(
            "lean_bulk", {"calories": 3200, "protein": 190}, weeks=12, profile=FULL_PROFILE
        )
        weekly = [
            t.weeks[i].expected_weight_change_lb - t.weeks[i - 1].expected_weight_change_lb
            for i in range(1, len(t.weeks))
        ]
        # Once calories cap out, each further week should add slightly less.
        assert weekly[-1] < weekly[len(weekly) // 2]


class TestDestinationProjection:
    def test_open_ended_without_destination(self, projector):
        result = project(projector, [session(50, [8, 8, 8])], weeks=8)
        assert result.destination is None
        assert result.reachable is None
        assert len(result.best_case) == 8

    def test_horizon_follows_target_weeks(self, projector):
        result = project(
            projector,
            [session(50, [8, 8, 8])],
            weeks=12,
            target_weight=55,
            target_reps=8,
            target_weeks=6,
        )
        assert result.destination == {"weight": 55.0, "reps": 8, "weeks": 6}
        assert [p.week for p in result.best_case] == list(range(1, 7))

    def test_holds_after_hitting_destination(self, projector):
        result = project(
            projector,
            [session(80, [8, 8, 8])],
            weeks=10,
            target_weight=80,
            target_reps=8,
            target_weeks=10,
        )
        assert result.arrived_week == 1
        assert result.reachable is True
        # Remaining weeks hold the destination load rather than climbing forever.
        assert all(p.weight >= 80 and p.reps >= 8 for p in result.best_case)

    def test_unreachable_destination_flags_false(self, projector):
        result = project(
            projector,
            [session(50, [8, 8, 8])],
            weeks=4,
            target_weight=500,
            target_reps=8,
            target_weeks=4,
        )
        assert result.destination["weight"] == 500.0
        assert result.reachable is False
        assert result.arrived_week is None


class TestExerciseSessionsPerWeek:
    """Incline on Push A + Push B is two sessions, even though each day is once."""

    def test_counts_a_lift_across_a_b_days(self):
        plan = {
            "weekly_schedule": {
                "monday": "Push A",
                "tuesday": "Pull A",
                "wednesday": "Legs",
                "thursday": "Pull B",
                "friday": "Push B",
            },
            "days": [
                {
                    "day_name": "Push A",
                    "exercises": [{"exercise_id": "incline", "exercise_name": "Incline"}],
                },
                {
                    "day_name": "Pull A",
                    "exercises": [{"exercise_id": "row", "exercise_name": "Row"}],
                },
                {
                    "day_name": "Legs",
                    "exercises": [{"exercise_id": "squat", "exercise_name": "Squat"}],
                },
                {
                    "day_name": "Pull B",
                    "exercises": [{"exercise_id": "row", "exercise_name": "Row"}],
                },
                {
                    "day_name": "Push B",
                    "exercises": [{"exercise_id": "incline", "exercise_name": "Incline"}],
                },
            ],
        }
        freq = exercise_sessions_per_week(plan)
        assert freq["incline"] == 2
        assert freq["row"] == 2
        assert freq["squat"] == 1

    def test_schedule_emits_workout_columns_when_twice_weekly(self, projector):
        result = project(
            projector,
            [session(50, [8, 8, 8])],
            weeks=2,
            sessions_per_week=2,
        )
        sessions = sorted({p.session for p in result.schedule})
        assert sessions == [1, 2]
        week_one = [p for p in result.schedule if p.week == 1]
        assert len(week_one) == 2


class TestRateOfGainAssumptions:
    """
    Spending the novice rate on everyone was the single reason a twelve-week
    chart promised a 24% estimated-1RM gain on an incline press that had not
    moved in seven months. Training age and energy balance both bound it.
    """

    def test_training_age_slows_the_ceiling(self):
        rates = [
            plausible_weekly_gain("novice"),
            plausible_weekly_gain("intermediate"),
            plausible_weekly_gain("advanced"),
        ]
        assert rates == sorted(rates, reverse=True)

    def test_unknown_experience_is_not_treated_as_a_beginner(self):
        """The optimistic error is the one this module exists to avoid."""
        assert DEFAULT_EXPERIENCE_LEVEL == "intermediate"
        assert plausible_weekly_gain(None) == plausible_weekly_gain("intermediate")
        assert plausible_weekly_gain(None) < plausible_weekly_gain("novice")

    def test_unrecognised_experience_falls_back_rather_than_crashing(self):
        assert plausible_weekly_gain("wizard") == plausible_weekly_gain(
            DEFAULT_EXPERIENCE_LEVEL
        )

    def test_eating_to_maintain_projects_less_than_bulking(self):
        """Strength is built out of surplus; the chart has to know the diet."""
        gaining = plausible_weekly_gain("intermediate", "gain")
        holding = plausible_weekly_gain("intermediate", "maintain")
        cutting = plausible_weekly_gain("intermediate", "lose")
        assert gaining > holding > cutting

    def test_a_cut_still_progresses(self):
        """Strength is retained in a deficit; it stops running, it does not stop."""
        assert plausible_weekly_gain("intermediate", "lose") > 0

    def test_no_stated_diet_is_not_read_as_a_deficit(self):
        assert plausible_weekly_gain("advanced", None) == plausible_weekly_gain(
            "advanced", "gain"
        )

    def test_an_advanced_maintainer_is_not_projected_a_beginners_bulk(self, projector):
        """
        The regression this whole class exists for. 80x6 dumbbells, advanced,
        eating at maintenance: the old flat cap allowed 105x4 in twelve weeks.
        """
        result = project(
            projector,
            [session(80, [6, 4, 6])],
            weeks=12,
            experience_level="advanced",
            energy_balance="maintain",
        )
        start = result.current.e1rm
        peak = max(p.e1rm for p in result.best_case)
        assert (peak - start) / start < 0.10, (
            f"{start} -> {peak} is a bulking novice's twelve weeks"
        )

    def test_the_curve_still_moves_for_an_advanced_maintainer(self, projector):
        """
        A ceiling that flatlines is not a fix. Load is indivisible, so reps are
        what move when the next dumbbell costs more than the whole horizon.
        """
        result = project(
            projector,
            [session(80, [6, 4, 6])],
            weeks=12,
            experience_level="advanced",
            energy_balance="maintain",
        )
        assert max(p.e1rm for p in result.best_case) > result.current.e1rm

    def test_assumptions_are_reported_not_applied_silently(self, projector):
        result = project(
            projector,
            [session(80, [6, 4, 6])],
            weeks=12,
            experience_level="advanced",
            energy_balance="maintain",
        )
        assumed = result.to_dict()["assumptions"]
        assert assumed["experience_level"] == "advanced"
        assert assumed["energy_balance"] == "maintain"
        assert assumed["experience_assumed"] is False
        assert 0 < assumed["horizon_gain_pct"] < 10

    def test_an_assumed_experience_level_says_so(self, projector):
        result = project(projector, [session(80, [6, 4, 6])], weeks=12)
        assert result.to_dict()["assumptions"]["experience_assumed"] is True


class TestDestinationPacing:
    """
    A goal set for week twelve is a week-twelve target. Sprinting to it in week
    two and holding draws a plan with nothing left to do, and overshooting it
    ends the chart above the heaviest dumbbell the user ever asked for.
    """

    def test_a_reachable_goal_is_paced_across_the_horizon(self):
        rate = pace_to_destination(
            baseline_e1rm=96.0, destination_e1rm=102.0, weeks=12, plausible_rate=0.02
        )
        assert rate < 0.02
        assert 96.0 * ((1 + rate) ** 12) == pytest.approx(102.0, rel=1e-6)

    def test_a_goal_beyond_reach_is_not_sped_up_to_meet_it(self):
        """The gap is the finding; `reachable` is where it gets reported."""
        rate = pace_to_destination(
            baseline_e1rm=96.0, destination_e1rm=200.0, weeks=12, plausible_rate=0.004
        )
        assert rate == 0.004

    def test_no_destination_leaves_the_rate_alone(self):
        assert pace_to_destination(96.0, None, 12, 0.008) == 0.008

    def test_a_goal_already_met_leaves_the_rate_alone(self):
        assert pace_to_destination(96.0, 90.0, 12, 0.008) == 0.008

    def test_projection_does_not_overshoot_the_users_own_goal(self, projector):
        """
        Without this the walk ran open-loop past the finish line and ended
        fifteen pounds above the heaviest dumbbell the user had named.
        """
        result = project(
            projector,
            [session(80, [6, 4, 6])],
            weeks=12,
            target_weight=85,
            target_reps=6,
            target_weeks=12,
            experience_level="intermediate",
            energy_balance="maintain",
        )
        assert max(p.weight for p in result.best_case) <= 85

    def test_an_out_of_reach_goal_reports_false_rather_than_drawing_a_line_to_it(
        self, projector
    ):
        result = project(
            projector,
            [session(80, [6, 4, 6])],
            weeks=12,
            target_weight=150,
            target_reps=8,
            target_weeks=12,
            experience_level="advanced",
            energy_balance="maintain",
        )
        assert result.reachable is False
        assert result.arrived_week is None
