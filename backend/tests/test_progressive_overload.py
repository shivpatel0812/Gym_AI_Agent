"""
Progressive overload has to actually move.

Every case here is a prescription or a projection that could not advance, taken
from a real logged session. They share one shape: something in the chain read a
number it was not entitled to -- a load paired with another set's reps, a
backoff's reps voting on a top set, a volume day inheriting a heavy day's
weight -- and the result was a card that looked reasonable and never changed.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.plan_projection import PlanProjector, e1rm
from ai_analysis.session_day import resolve_plan_day
from ai_analysis.workout_recommender.goal_configs import RepRangeConfig
from ai_analysis.workout_recommender.prescription import (
    ProgressionStrategy,
    holds_load_across_sets,
    select_strategy,
    sets_at_working_load,
    working_load,
)
from ai_analysis.workout_recommender.exercise_metadata import resolve_exercise_metadata
from ai_analysis.workout_recommender.goal_configs import get_goal_config
from ai_analysis.workout_recommender.progression_engine import ProgressionEngine

BAND_4_6 = RepRangeConfig(4, 6)
BAND_5_8 = RepRangeConfig(5, 8)

# 2026-09-11, incline dumbbell press. A heavy single, then working sets.
DESCENDING = [
    {"weight": 85, "reps": 1},
    {"weight": 75, "reps": 7},
    {"weight": 75, "reps": 5},
    {"weight": 70, "reps": 6},
    {"weight": 65, "reps": 8},
]


class TestWhatLoadWasActuallyWorked:
    def test_a_heavy_single_is_not_the_working_load(self):
        """
        85x1 before 75x7 means the session worked at 75. Reading the raw
        maximum prescribed 85 for six reps to someone who had just managed it
        for one -- a load taken from set one and reps taken from the band.
        """
        assert working_load(DESCENDING, BAND_4_6) == 75

    def test_a_genuine_top_set_still_counts(self):
        """The rule must not throw away real top sets to catch warmup singles."""
        assert working_load(
            [{"weight": 185, "reps": 5}, {"weight": 165, "reps": 8}], BAND_4_6
        ) == 185

    def test_a_load_no_set_could_hold_for_the_band_is_refused(self):
        assert working_load(
            [{"weight": 225, "reps": 1}, {"weight": 175, "reps": 5}], BAND_4_6
        ) == 175

    def test_sets_of_twenty_cannot_out_score_a_working_set(self):
        """Epley extrapolates past a dozen reps; such sets are skipped."""
        assert working_load(
            [{"weight": 40, "reps": 25}, {"weight": 95, "reps": 3}]
        ) == 95

    def test_only_the_working_load_sets_are_judged(self):
        judged = sets_at_working_load(DESCENDING, BAND_4_6)
        assert [s["reps"] for s in judged] == [7, 5]


class TestTheShapeFitsTheLift:
    def test_a_cable_lift_does_not_get_a_barbell_backoff(self):
        """
        Lat pulldown is compound, so the old rule handed it a top set plus a
        10% drop -- 175x7 then 160x8 -- to a lifter whose log shows 175 across
        all three sets. Backing off exists because a near-limit free-weight set
        is costly to repeat. A cable stack carries none of that.
        """
        metadata = resolve_exercise_metadata(
            "default-back-cable-lat-pulldown", "Lat Pulldowns", None
        )
        assert metadata.compound
        assert (
            select_strategy(metadata, get_goal_config("strength"))
            == ProgressionStrategy.BAND
        )

    def test_a_barbell_compound_still_gets_one(self):
        metadata = resolve_exercise_metadata(
            "default-back-bb-deadlifts", "Deadlifts", None
        )
        assert (
            select_strategy(metadata, get_goal_config("strength"))
            == ProgressionStrategy.TOP_SET
        )

    def test_holding_one_load_across_sets_is_read_from_the_log(self):
        held = [
            {
                "sets": [
                    {"weight": 175, "reps": 7},
                    {"weight": 175, "reps": 6},
                    {"weight": 175, "reps": 5},
                ]
            }
        ]
        assert holds_load_across_sets(held, BAND_5_8) is True
        assert holds_load_across_sets([{"sets": DESCENDING}], BAND_4_6) is False


class TestTheProjectionCanLeaveWhereItStarted:
    """
    The 12-week roadmap drew a flat line at the starting prescription. On
    rejection the walk re-inserted an identical copy of its own input, so the
    next week regenerated the same rejected candidate -- an absorbing stall
    rather than the temporary one the code intended.
    """

    def _project(self, weeks=12):
        return PlanProjector().project_exercise(
            exercise_id="default-chest-db-incline-press",
            exercise_name="Incline Dumbbell Press",
            day_name="Push A",
            history=[{"date": "2026-09-11", "sets": DESCENDING}],
            user_goal="hypertrophy",
            weeks=weeks,
            sessions_per_week=2,
            num_sets=4,
            day_intensity="heavy",
            rep_range_override=(4, 6),
            experience_level="intermediate",
            energy_balance="maintain",
        )

    def test_the_walk_advances_past_week_one(self):
        best = self._project().best_case
        assert best, "projection produced no weeks at all"
        start = e1rm(best[0].weight, best[0].reps)
        peak = max(e1rm(w.weight, w.reps) for w in best)
        assert peak > start, f"projection never moved: {[(w.weight, w.reps) for w in best]}"

    def test_load_actually_increases_within_the_horizon(self):
        best = self._project().best_case
        assert max(w.weight for w in best) > best[0].weight

    def test_a_held_week_says_why_it_is_held(self):
        """A flat stretch with decision=None gives the chart nothing to label."""
        best = self._project().best_case
        assert all(w.decision for w in best)
        assert {w.decision for w in best} <= {
            "increase_weight",
            "increase_reps",
            "fill_band",
            "maintain",
            "capped",
            "reduce_load",
            "deload",
        }

    def test_a_capped_week_is_not_the_end_of_progress(self):
        """
        The ceiling rises every week, so a step it cannot afford today it can
        afford later. A cap that never clears is the deadlock itself.
        """
        best = self._project().best_case
        decisions = [w.decision for w in best]
        if "capped" in decisions:
            first_cap = decisions.index("capped")
            assert any(
                d not in ("capped", "maintain") for d in decisions[first_cap:]
            ), "the walk capped and never recovered"


class TestAVolumeDayNeverOutLoadsItsHeavyDay:
    def test_the_cap_is_re_derived_not_applied_once(self):
        """
        The step-down used to run only on the first exposure. Day-specific
        progression then walked each day forward alone and the volume day
        climbed back to the heavy day's load -- at which point the plan had two
        heavy days and called one of them volume.
        """
        engine = ProgressionEngine()
        sessions = [
            {
                "date": "2026-09-07",
                "sets": [
                    {"weight": 175, "reps": 7},
                    {"weight": 175, "reps": 6},
                    {"weight": 175, "reps": 5},
                ],
            }
        ]
        result = engine.compute_recommendation(
            exercise_id="default-back-cable-lat-pulldown",
            exercise_name="Lat Pulldowns",
            user_goal="hypertrophy",
            recent_sessions=sessions,
            num_sets=3,
            day_intensity="volume",
            heavy_day_weight=175,
            rep_range_override=(8, 12),
        )
        assert max(s.weight for s in result.sets) < 175

    def test_a_volume_day_already_light_is_left_alone(self):
        """Pulling it *up* to the cap would invent load the history never had."""
        engine = ProgressionEngine()
        sessions = [{"date": "2026-09-07", "sets": [{"weight": 120, "reps": 10}] * 3}]
        result = engine.compute_recommendation(
            exercise_id="default-back-cable-lat-pulldown",
            exercise_name="Lat Pulldowns",
            user_goal="hypertrophy",
            recent_sessions=sessions,
            num_sets=3,
            day_intensity="volume",
            heavy_day_weight=175,
            rep_range_override=(8, 12),
        )
        assert max(s.weight for s in result.sets) <= 175 * 0.9 + 5


class TestWhichExposureWasThat:
    """
    Sessions logged as a bare "Pull" match Pull A and Pull B equally, so a plan
    that trains a lift heavy on one day and for volume on the other reads one
    shared history and cannot tell the two progressions apart.
    """

    PLAN = {
        "days": [
            {"day_name": "Pull A"},
            {"day_name": "Push A"},
            {"day_name": "Legs"},
            {"day_name": "Pull B"},
            {"day_name": "Push B"},
        ],
        "weekly_schedule": {
            "monday": "Pull A",
            "tuesday": "Push A",
            "wednesday": "Legs",
            "thursday": "Pull B",
            "friday": "Push B",
            "saturday": "Rest",
            "sunday": "Rest",
        },
    }

    def test_the_calendar_decides_which_pull_it_was(self):
        assert resolve_plan_day("Pull", self.PLAN, "2026-09-07") == "Pull A"  # Monday
        assert resolve_plan_day("Pull", self.PLAN, "2026-09-10") == "Pull B"  # Thursday

    def test_an_exact_label_is_left_alone(self):
        assert resolve_plan_day("Pull B", self.PLAN, "2026-09-10") is None

    def test_an_unattributable_session_keeps_the_users_label(self):
        """A wrong attribution sends real work into the wrong progression."""
        assert resolve_plan_day("Pull", self.PLAN, None) is None
        # Logged on a day the schedule says is Legs — no basis to pick.
        assert resolve_plan_day("Pull", self.PLAN, "2026-09-09") is None

    def test_no_plan_means_no_stamp(self):
        assert resolve_plan_day("Pull", None, "2026-09-07") is None


class TestWhatWouldItTake:
    """
    "Unreachable" is a verdict with no action attached to it. The useful answer
    is the rate the goal actually needs, the session-by-session path that
    delivers it, and -- when nothing can -- which date is honest instead.
    """

    def _project(self, pace="steady", energy_balance="maintain"):
        return PlanProjector().project_exercise(
            exercise_id="default-chest-db-incline-press",
            exercise_name="Incline Dumbbell Press",
            day_name="Push A",
            history=[{"date": "2026-09-11", "sets": DESCENDING}],
            user_goal="hypertrophy",
            weeks=12,
            sessions_per_week=2,
            num_sets=4,
            day_intensity="heavy",
            rep_range_override=(4, 6),
            target_weight=90,
            target_reps=3,
            target_weeks=12,
            experience_level="intermediate",
            energy_balance=energy_balance,
            pace=pace,
        )

    def test_the_steady_walk_still_reports_the_goal_as_missed(self):
        """Offering a harder path must not quietly soften the honest one."""
        assert self._project().reachable is False

    def test_the_push_walk_reaches_the_goal(self):
        push = self._project(pace="push")
        assert push.reachable is True
        assert push.arrived_week is not None

    def test_the_push_walk_says_what_to_do_each_workout(self):
        """The actionable half: a prescription per session, not just a verdict."""
        push = self._project(pace="push")
        assert push.schedule
        assert all(point.sets for point in push.schedule[:4])

    def test_the_push_walk_still_respects_the_destination_load(self):
        """Pushing harder is not licence to hand back a heavier weight than asked."""
        push = self._project(pace="push")
        assert max(w.weight for w in push.best_case) <= 90

    def test_the_demand_is_reported_on_the_steady_projection(self):
        """So a client knows whether a harder path is worth offering at all."""
        demand = self._project().demand
        assert demand is not None
        assert demand.required_weekly_gain > demand.plausible_weekly_gain
        assert demand.ratio > 1
        assert demand.within_plausible is False

    def test_it_names_the_date_that_would_work(self):
        """When effort cannot buy the date, the date is the finding."""
        demand = self._project().demand
        assert demand.weeks_at_current_pace > demand.weeks_requested
        assert demand.weeks_on_surplus is not None
        # Eating for it moves the date closer without making it plausible.
        assert demand.weeks_on_surplus < demand.weeks_at_current_pace

    def test_requirements_are_stated_plainly(self):
        lines = self._project().demand.requirements()
        assert lines
        assert any("every week" in line for line in lines)

    def test_a_goal_the_steady_plan_already_meets_asks_for_nothing(self):
        """No manufactured urgency when the normal plan gets there."""
        easy = PlanProjector().project_exercise(
            exercise_id="default-chest-db-incline-press",
            exercise_name="Incline Dumbbell Press",
            day_name="Push A",
            history=[{"date": "2026-09-11", "sets": DESCENDING}],
            user_goal="hypertrophy",
            weeks=12,
            sessions_per_week=2,
            num_sets=4,
            day_intensity="heavy",
            rep_range_override=(4, 6),
            target_weight=80,
            target_reps=4,
            target_weeks=12,
            experience_level="intermediate",
            energy_balance="maintain",
        )
        assert easy.demand.within_plausible is True
        assert easy.demand.requirements() == [
            "No change needed — the steady plan already gets there."
        ]
