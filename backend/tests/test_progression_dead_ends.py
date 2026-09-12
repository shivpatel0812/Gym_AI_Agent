"""
The ways a recommendation used to stop being able to move.

1. Bodyweight history was deleted before the engine saw it, so pull-ups read as
   "no history" no matter how many had been logged.
2. The rep step clamped to the top of the band, which turns an 11-rep set into a
   prescription of 10 and calls it an increase.
3. Repeated misses against a band re-served the session that had just missed it,
   forever, with no route back into the band.
4. A plan-day calibration prescribed less load at fewer reps than the session it
   was translating, and nothing about clearing it could ever earn more.
"""

import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from ai_analysis.workout_recommender import WorkoutRecommender
from ai_analysis.workout_recommender.exercise_metadata import resolve_exercise_metadata
from ai_analysis.workout_recommender.goal_configs import RepRangeConfig
from ai_analysis.workout_recommender.plan_context import PlanContext, normalize_rep_range
from ai_analysis.workout_recommender.progression_engine import Decision, ProgressionEngine
from ai_analysis.workout_recommender.readiness_context import neutral as neutral_readiness
from ai_analysis.workout_recommender.reasoning_generator import ReasoningGenerator


@pytest.fixture
def engine():
    return ProgressionEngine()


def bodyweight_session(reps, date="2026-08-30"):
    """A pull-up session: reps, and no weight field at all."""
    return {"date": date, "sets": [{"set_number": i + 1, "reps": r} for i, r in enumerate(reps)]}


def loaded_session(weight, reps, date="2026-08-30"):
    return {
        "date": date,
        "sets": [
            {"set_number": i + 1, "reps": r, "weight": weight} for i, r in enumerate(reps)
        ],
    }


def recommender_with_sessions(sessions, plan_context=None, profile_goal="Build Muscle"):
    """A WorkoutRecommender wired to fixed history and nothing else."""
    rec = WorkoutRecommender.__new__(WorkoutRecommender)
    rec.db = MagicMock()
    rec.db.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value.exists = False
    rec.user_id = "user-1"
    rec.data_fetcher = MagicMock()
    rec.data_fetcher.get_recent_workout_sessions.return_value = sessions
    rec.data_fetcher.get_all_workout_sessions.return_value = sessions
    rec.data_fetcher.get_exercise_records.return_value = {}
    rec.data_fetcher.get_user_profile.return_value = {"primary_goal": profile_goal}
    rec.progression_engine = ProgressionEngine()
    rec.reasoning_generator = ReasoningGenerator(openai_client=None)
    rec.focus_store = MagicMock()
    rec.focus_store.get_focus_for_exercise.return_value = None
    rec.plan_resolver = MagicMock()
    rec.plan_resolver.resolve.return_value = plan_context or PlanContext(
        goal="hypertrophy", source="profile"
    )
    rec.readiness_resolver = MagicMock()
    rec.readiness_resolver.resolve.return_value = neutral_readiness()
    rec.storage = MagicMock()
    return rec


# === 1. Bodyweight history reaches the engine ===

class TestBodyweightHistorySurvives:
    def test_pull_up_sessions_are_not_filtered_out_for_having_no_load(self):
        """
        The filter required weight > 0, which is never true for a pull-up. Every
        session was dropped, the engine saw an empty history, and the answer was
        the bottom of the rep band regardless of what the user could actually do.
        """
        rec = recommender_with_sessions([
            {
                "date": "2026-08-30",
                "exercises": [{
                    "exercise_id": "pull_ups",
                    "exercise_name": "Pull-Ups",
                    "sets": [{"reps": 11}, {"reps": 10}, {"reps": 10}],
                }],
            }
        ])

        history = rec._get_exercise_history("pull_ups")

        assert len(history) == 1
        assert [s["reps"] for s in history[0]["sets"]] == [11, 10, 10]

    def test_weighted_sets_still_need_a_load(self):
        """The filter's original job — dropping loadless barbell rows — stands."""
        rec = recommender_with_sessions([
            {
                "date": "2026-08-30",
                "exercises": [{
                    "exercise_id": "barbell_bench_press",
                    "exercise_name": "Barbell Bench Press",
                    "sets": [{"reps": 8}, {"reps": 8}],
                }],
            }
        ])

        assert rec._get_exercise_history("barbell_bench_press") == []

    def test_recommendation_follows_the_real_pull_up_history(self):
        rec = recommender_with_sessions([
            {
                "date": "2026-08-30",
                "exercises": [{
                    "exercise_id": "pull_ups",
                    "exercise_name": "Pull-Ups",
                    "sets": [{"reps": 11}, {"reps": 10}, {"reps": 10}],
                }],
            }
        ])

        out = rec.get_exercise_recommendation("pull_ups", "Pull-Ups")["recommendation"]

        assert out["progression_type"] == "bodyweight_progress"
        assert [s["reps"] for s in out["sets"]] == [12, 11, 11]

    def test_weighted_dips_keep_the_logged_added_loads(self):
        """A bodyweight-capable movement is not a bodyweight-only session.

        This is the exact mixed weighted-dip shape that exposed the bug: the
        engine copied 8/6/7 to 9/7/8, but changed every positive load to zero.
        The bodyweight finisher can stay unloaded; the three weighted sets
        must remain weighted.
        """
        rec = recommender_with_sessions(
            [{
                "date": "2026-08-14",
                "exercises": [{
                    "exercise_id": "default-triceps-bw-parallel-dips",
                    "exercise_name": "Parallel Bar Dips",
                    "sets": [
                        {"set_number": 1, "reps": 8, "weight": 50},
                        {"set_number": 2, "reps": 6, "weight": 89},
                        {"set_number": 3, "reps": 7, "weight": 40},
                        {"set_number": 4, "reps": 16},
                    ],
                }],
            }],
            plan_context=PlanContext(
                goal="hypertrophy",
                source="plan_exercise",
                target_sets=5,
                target_rep_range=(8, 10),
            ),
        )

        out = rec.get_exercise_recommendation(
            "default-triceps-bw-parallel-dips", "Parallel Bar Dips"
        )["recommendation"]

        assert out["progression_type"] == "bodyweight_progress"
        assert [
            (item["reps"], item["weight"]) for item in out["sets"][:4]
        ] == [(9, 50), (7, 89), (8, 40), (17, 0)]
        assert "added load" in out["reasoning"].lower()


# === 2. The rep step never hands back fewer reps ===

class TestRepStepNeverRegresses:
    @pytest.mark.parametrize("goal", ["Build Muscle", "Get Stronger", "Lose Fat"])
    def test_bodyweight_above_the_band_still_progresses(self, engine, goal):
        """
        11/10/10 against a band topping out at 10 used to return 10/10/10 — and
        under a strength band, 6/6/6 — described as a rep increase.
        """
        result = engine.compute_recommendation(
            exercise_id="pull_ups",
            exercise_name="Pull-Ups",
            user_goal=goal,
            recent_sessions=[bodyweight_session([11, 10, 10])],
            num_sets=3,
        )

        assert [s.reps for s in result.sets] == [12, 11, 11]

    def test_band_is_carried_on_bodyweight_sets(self, engine):
        result = engine.compute_recommendation(
            exercise_id="pull_ups",
            exercise_name="Pull-Ups",
            user_goal="Build Muscle",
            recent_sessions=[bodyweight_session([11, 10, 10])],
            num_sets=3,
            rep_range_override=(8, 10),
        )

        assert all(s.rep_low == 8 and s.rep_high == 10 for s in result.sets)

    def test_working_above_the_band_asks_for_external_load(self, engine):
        """Reps stop being the useful variable eventually. Say so."""
        result = engine.compute_recommendation(
            exercise_id="pull_ups",
            exercise_name="Pull-Ups",
            user_goal="Build Muscle",
            recent_sessions=[bodyweight_session([11, 10, 10])],
            num_sets=3,
            rep_range_override=(8, 10),
        )

        assert result.reasoning_context["above_band"] is True
        assert "external load" in (result.guidance or "")

    def test_below_the_band_climbs_toward_it(self, engine):
        result = engine.compute_recommendation(
            exercise_id="pull_ups",
            exercise_name="Pull-Ups",
            user_goal="Build Muscle",
            recent_sessions=[bodyweight_session([5, 4, 4])],
            num_sets=3,
            rep_range_override=(8, 10),
        )

        assert [s.reps for s in result.sets] == [6, 5, 5]
        assert result.reasoning_context["above_band"] is False

    def test_weighted_set_above_the_band_is_held_not_rolled_back(self, engine):
        """A single set past the ceiling gets held; load is the other branch."""
        result = engine._handle_increase_reps(
            latest_sets=[
                {"reps": 16, "weight": 50},
                {"reps": 12, "weight": 50},
                {"reps": 12, "weight": 50},
            ],
            num_sets=3,
            rep_range=RepRangeConfig(low=10, high=15),
            metadata=resolve_exercise_metadata("dumbbell_curl", "Dumbbell Curl"),
        )

        assert [s.reps for s in result.sets] == [16, 13, 13]


# === 3. Repeated misses have a way out ===

class TestMaintainHasAnExit:
    def test_far_under_the_band_reduces_the_load(self, engine):
        """
        9/8/8 at 13 lbs against 12-15, twice. The load is what the band cannot
        survive; re-serving 9/8/8 is a closed loop.
        """
        result = engine.compute_recommendation(
            exercise_id="straight_arm_pulldown",
            exercise_name="Straight-Arm Pulldowns",
            user_goal="Build Muscle",
            recent_sessions=[loaded_session(13, [9, 8, 8]) for _ in range(2)],
            num_sets=3,
            rep_range_override=(12, 15),
        )

        assert result.decision == Decision.REDUCE_LOAD
        assert result.sets[0].weight < 13
        assert [s.reps for s in result.sets] == [12, 12, 12]
        assert all(s.rep_low == 12 and s.rep_high == 15 for s in result.sets)

    def test_the_reduced_load_is_never_the_one_that_just_failed(self, engine):
        result = engine.compute_recommendation(
            exercise_id="straight_arm_pulldown",
            exercise_name="Straight-Arm Pulldowns",
            user_goal="Build Muscle",
            recent_sessions=[loaded_session(10, [8, 7, 7]) for _ in range(2)],
            num_sets=3,
            rep_range_override=(12, 15),
        )

        assert result.sets[0].weight < 10

    def test_just_short_of_the_band_holds_the_load_and_adds_a_rep(self, engine):
        """A rep or two short is a session to repeat better, not a load error."""
        result = engine.compute_recommendation(
            exercise_id="straight_arm_pulldown",
            exercise_name="Straight-Arm Pulldowns",
            user_goal="Build Muscle",
            recent_sessions=[loaded_session(13, [11, 11, 10]) for _ in range(2)],
            num_sets=3,
            rep_range_override=(12, 15),
        )

        assert result.decision == Decision.MAINTAIN
        assert all(s.weight == 13 for s in result.sets)
        assert [s.reps for s in result.sets] == [12, 12, 11]

    def test_maintain_no_longer_re_serves_the_failed_session(self, engine):
        result = engine.compute_recommendation(
            exercise_id="straight_arm_pulldown",
            exercise_name="Straight-Arm Pulldowns",
            user_goal="Build Muscle",
            recent_sessions=[loaded_session(13, [11, 11, 10]) for _ in range(2)],
            num_sets=3,
            rep_range_override=(12, 15),
        )

        assert [(s.reps, s.weight) for s in result.sets] != [(11, 13), (11, 13), (10, 13)]

    def test_bodyweight_misses_are_not_pushed_into_a_load_reduction(self, engine):
        """There is no load to reduce; the answer stays a rep climb."""
        result = engine.compute_recommendation(
            exercise_id="pull_ups",
            exercise_name="Pull-Ups",
            user_goal="Build Muscle",
            recent_sessions=[bodyweight_session([4, 3, 3]) for _ in range(3)],
            num_sets=3,
            rep_range_override=(12, 15),
        )

        assert result.decision == Decision.BODYWEIGHT_PROGRESS
        assert [s.reps for s in result.sets] == [5, 4, 4]


# === 4. A plan's plain rep count reaches the engine ===

class TestPlanTargetRepsIsUsed:
    def test_a_bare_count_normalizes_to_a_point_band(self):
        assert normalize_rep_range(10) == (10, 10)
        assert normalize_rep_range("10") == (10, 10)
        assert normalize_rep_range(True) is None
        assert normalize_rep_range("ten") is None

    def test_client_target_reps_reaches_the_engine_when_the_plan_has_no_range(self):
        rec = recommender_with_sessions([
            {
                "date": "2026-08-30",
                "exercises": [{
                    "exercise_id": "pull_ups",
                    "exercise_name": "Pull-Ups",
                    "sets": [{"reps": 4}, {"reps": 4}, {"reps": 4}],
                }],
            }
        ])

        out = rec.get_exercise_recommendation(
            "pull_ups", "Pull-Ups", plan_target_reps=8
        )["recommendation"]

        assert out["sets"][0]["rep_low"] == 8
        assert out["sets"][0]["rep_high"] == 8

    def test_the_plans_own_range_wins_over_the_clients_single_figure(self):
        rec = recommender_with_sessions(
            [
                {
                    "date": "2026-08-30",
                    "exercises": [{
                        "exercise_id": "pull_ups",
                        "exercise_name": "Pull-Ups",
                        "sets": [{"reps": 4}, {"reps": 4}, {"reps": 4}],
                    }],
                }
            ],
            plan_context=PlanContext(
                goal="hypertrophy", source="plan_exercise", target_rep_range=(8, 12)
            ),
        )

        out = rec.get_exercise_recommendation(
            "pull_ups", "Pull-Ups", plan_target_reps=8
        )["recommendation"]

        assert out["sets"][0]["rep_high"] == 12


# === 5. A calibration is never easier than the session it translates ===

def pull_day(weight, reps, date="2026-09-07"):
    """The reference exposure, logged on another day of the same plan."""
    session = loaded_session(weight, reps, date=date)
    session["split_day"] = "Pull"
    return session


class TestCalibrationCannotGoBackwards:
    """
    175 x 7/6/5 on Pull, then the first Heavy exposure of the same lift on
    another day: Epley says 175x7 is worth 180 at 6 reps, the 5% multi-set
    reserve takes 5% back, and 170x6 came out the other side — less weight for
    fewer reps than the session it was reading. Clearing it proves nothing and
    the next recommendation reads 170x6 as in-band, so the lift holds under its
    own demonstrated load indefinitely.
    """

    def calibrate(self, engine, reference, band, intensity="heavy"):
        return engine.compute_recommendation(
            exercise_id="default-back-cable-lat-pulldown",
            exercise_name="Lat Pulldowns",
            user_goal="Build Muscle",
            focus_goal="strength",
            recent_sessions=[],
            alternate_day_reference=reference,
            num_sets=3,
            day_intensity=intensity,
            rep_range_override=band,
        )

    def test_a_session_that_filled_the_band_earns_load_instead(self, engine):
        result = self.calibrate(engine, pull_day(175, [7, 6, 5]), (5, 7))

        # 175x7 is a 216 e1RM; at the floor of the band that is 185.
        assert [(s.weight, s.reps) for s in result.sets] == [(185.0, 5)] * 3
        assert all(s.rep_low == 5 and s.rep_high == 7 for s in result.sets)
        assert result.reasoning_context["calibration_step_up"] is True

    def test_the_step_up_says_what_to_do_when_it_does_not_go(self, engine):
        result = self.calibrate(engine, pull_day(175, [7, 6, 5]), (5, 7))

        assert result.branch is not None
        assert result.branch.kind == "miss_drop"
        assert "175" in result.branch.action

    def test_fewer_reps_never_costs_load(self, engine):
        """In-band, not at the top: hold the demonstrated load, do not shave it."""
        result = self.calibrate(engine, pull_day(175, [6, 6, 6]), (5, 7))

        assert result.sets[0].weight == 175.0
        assert result.reasoning_context["calibration_step_up"] is False

    def test_a_higher_rep_volume_day_still_steps_down(self, engine):
        result = self.calibrate(engine, pull_day(175, [7, 6, 5]), (8, 12), "volume")

        assert result.sets[0].weight < 175.0
        assert result.sets[0].reps == 10
        assert result.reasoning_context["calibration_step_up"] is False

    def test_a_light_day_is_still_light(self, engine):
        """A light day is meant to be easier than what was demonstrated."""
        result = self.calibrate(engine, pull_day(175, [7, 6, 5]), (5, 7), "light")

        assert result.sets[0].weight < 175.0
        assert result.reasoning_context["calibration_step_up"] is False

    def test_a_reference_short_of_the_band_is_still_translated_down(self, engine):
        """175x3 says nothing about 175x6 — the reserve stays where it works."""
        result = self.calibrate(engine, pull_day(175, [3, 3, 3]), (5, 7))

        assert result.sets[0].weight < 175.0
        assert result.sets[0].reps == 6

    def test_a_band_with_no_width_still_moves(self, engine):
        """5-5 translates to exactly the reference load; a tie is not a step."""
        result = self.calibrate(engine, pull_day(185, [5, 5, 5]), (5, 5))

        assert result.sets[0].weight > 185.0

    def test_a_high_rep_reference_does_not_extrapolate_a_jump(self, engine):
        """
        Epley reads 175x20 as a 292 lb max. Stepping to the floor of an 8-12
        band off that number prescribes 230 lbs to someone who has never been
        near it; the set carries no 1RM, so only the direction is known.
        """
        result = self.calibrate(engine, pull_day(175, [20, 20, 20]), (8, 12))

        assert result.sets[0].weight == 180.0

    def test_a_burnout_set_does_not_define_the_load(self, engine):
        """The readable set is 185x8, not the 135x20 that ended the session."""
        reference = pull_day(185, [8, 8])
        reference["sets"].append({"set_number": 3, "reps": 20, "weight": 135})

        result = self.calibrate(engine, reference, (5, 7))

        assert result.reasoning_context["reference_weight"] == 185.0

    def test_the_prose_does_not_call_a_load_increase_a_calibration(self, engine):
        result = self.calibrate(engine, pull_day(175, [7, 6, 5]), (5, 7))
        text = ReasoningGenerator(openai_client=None).generate_reasoning(
            decision=result.decision,
            reasoning_context=result.reasoning_context,
            exercise_name="Lat Pulldowns",
        )

        assert "calibrates to" not in text
        assert "185" in text and "175" in text
