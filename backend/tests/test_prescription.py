"""
Band-relative progression: the bugs it fixed, and the contract it introduced.

The cases at the top of this file are the two ways the old volume-comparison
engine failed real lifters. Both were found by simulating a user across weeks
rather than by checking a single call, so both are pinned here as sequences.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from ai_analysis.workout_recommender.goal_configs import RepRangeConfig
from ai_analysis.workout_recommender.prescription import (
    ProgressionStrategy,
    SessionOutcome,
    count_regressions,
    evaluate_session,
    near_top_streak,
)
from ai_analysis.workout_recommender.progression_engine import Decision, ProgressionEngine

BENCH = "default-chest-db-bench-press"
BENCH_NAME = "Dumbbell Bench Press"
HYPERTROPHY = "Build Muscle"


@pytest.fixture
def engine():
    return ProgressionEngine()


def session(weight, reps, date="2026-08-10"):
    return {
        "date": date,
        "sets": [
            {"weight": weight, "reps": r, "set_number": i + 1}
            for i, r in enumerate(reps)
        ],
    }


def recommend(engine, sessions, goal=HYPERTROPHY, num_sets=3, exercise_id=BENCH,
              exercise_name=BENCH_NAME):
    return engine.compute_recommendation(
        exercise_id=exercise_id,
        exercise_name=exercise_name,
        user_goal=goal,
        recent_sessions=sessions,
        num_sets=num_sets,
    )


# === The two bugs =======================================================


class TestWeightIncreaseIsNotAFailure:
    """
    Doing exactly what the app prescribed must never be scored as a failure.

    The old engine compared total volume against the previous session. Sweeping
    50x10,10,10 (volume 1500) and then doing the prescribed 55x6,6,6 (volume
    990) read as a regression, so it handed back 50x10 — and the user bounced
    between the two loads forever, never progressing past week 3.
    """

    def test_completing_a_prescribed_increase_advances(self, engine):
        sessions = [
            session(55, [6, 6, 6], "2026-08-10"),
            session(50, [10, 10, 10], "2026-08-07"),
        ]
        result = recommend(engine, sessions)

        assert result.decision == Decision.INCREASE_REPS
        # Stays at the load just earned rather than rolling back to 50.
        assert all(s.weight == 55 for s in result.sets)
        assert result.reasoning_context["reason"] == "advance_in_band"

    def test_no_oscillation_across_a_training_block(self, engine):
        """The load must strictly climb for a lifter who hits every target."""
        history = [session(50, [10, 10, 10], "2026-08-01")]
        loads = []

        for week in range(8):
            result = recommend(engine, list(reversed(history[-6:])))
            top = max(s.weight for s in result.sets)
            loads.append(top)
            # The user does exactly what was asked.
            history.append(
                session(
                    top,
                    [s.reps for s in result.sets],
                    f"2026-08-{2 + week:02d}",
                )
            )

        assert loads == sorted(loads), f"load went backwards: {loads}"
        assert loads[-1] > loads[0], f"never progressed: {loads}"


class TestNearMissStillProgresses:
    """
    Requiring a flawless sweep pinned real lifters at one load indefinitely.

    A user who lands 10,9,10 every session is training well. The old engine
    demanded every set reach the ceiling before adding weight, so they sat at
    the same number for months being told to "add a rep" at a cap they had
    already hit.
    """

    def test_two_near_top_sessions_earn_the_weight(self, engine):
        sessions = [
            session(50, [10, 9, 10], "2026-08-10"),
            session(50, [10, 10, 9], "2026-08-07"),
        ]
        result = recommend(engine, sessions)

        assert result.decision == Decision.INCREASE_WEIGHT
        assert result.reasoning_context["earned_by_streak"] >= 2
        assert all(s.weight == 55 for s in result.sets)

    def test_one_near_top_session_closes_out_first(self, engine):
        """A single near miss asks for the sweep before granting the weight."""
        sessions = [
            session(50, [10, 9, 10], "2026-08-10"),
            session(50, [8, 8, 8], "2026-08-07"),
        ]
        result = recommend(engine, sessions)

        assert result.decision == Decision.INCREASE_REPS
        assert result.reasoning_context["reason"] == "close_out_band"
        assert all(s.reps == 10 for s in result.sets)

    def test_a_persistent_one_rep_shortfall_still_climbs(self, engine):
        """Dropping a rep somewhere every session must not freeze the load."""
        history = [session(50, [8, 8, 8], "2026-08-01")]
        loads = []

        for week in range(10):
            result = recommend(engine, list(reversed(history[-6:])))
            top = max(s.weight for s in result.sets)
            loads.append(top)
            reps = [s.reps for s in result.sets]
            reps[week % len(reps)] -= 1  # one set always falls short
            history.append(session(top, reps, f"2026-08-{2 + week:02d}"))

        assert loads[-1] > loads[0], f"stranded at one load: {loads}"


# === Trend still matters ================================================


class TestDeclineIsStillCaught:
    """
    A band judges one session. A decline is only visible across several, and
    losing that signal to the band fix would be a worse bug than the one it
    replaced.
    """

    def test_falling_reps_at_a_fixed_load_holds(self, engine):
        sessions = [
            session(75, [6, 6, 6], "2026-08-10"),
            session(75, [7, 7, 7], "2026-08-07"),
            session(75, [8, 8, 8], "2026-08-04"),
        ]
        result = recommend(engine, sessions)
        assert result.decision == Decision.MAINTAIN

    def test_reps_falling_because_the_load_rose_is_not_a_decline(self):
        """The distinction the whole fix rests on."""
        rng = RepRangeConfig(low=6, high=10)
        earned = [
            session(55, [6, 6, 6]),
            session(50, [10, 10, 10]),
        ]
        declined = [
            session(75, [6, 6, 6]),
            session(75, [8, 8, 8]),
        ]
        assert count_regressions(earned, rng) == 0
        assert count_regressions(declined, rng) == 1


# === Session classification =============================================


class TestEvaluateSession:
    RANGE = RepRangeConfig(low=8, high=12)

    @pytest.mark.parametrize(
        "reps,expected",
        [
            ([12, 12, 12], SessionOutcome.SWEPT_TOP),
            ([12, 11, 12], SessionOutcome.AT_TOP),
            ([10, 10, 9], SessionOutcome.IN_BAND),
            ([10, 8, 7], SessionOutcome.IN_BAND),   # typical set clears the floor
            ([8, 7, 7], SessionOutcome.PARTIAL),    # typical set does not
            ([5, 5, 4], SessionOutcome.BELOW),
            ([], SessionOutcome.UNKNOWN),
        ],
    )
    def test_classification(self, reps, expected):
        assert evaluate_session(session(100, reps)["sets"], self.RANGE) == expected

    def test_judged_on_the_typical_set_not_the_worst(self):
        """
        One short set is the commonest way a real session ends. Judging on the
        minimum lets that single set hold the whole prescription at the floor
        forever, however well the rest went.
        """
        assert evaluate_session(
            session(100, [12, 12, 6])["sets"], self.RANGE
        ) == SessionOutcome.IN_BAND

    def test_streak_stops_at_the_first_ordinary_session(self):
        sessions = [
            session(100, [12, 11, 12]),
            session(100, [12, 12, 12]),
            session(100, [9, 9, 9]),
        ]
        assert near_top_streak(sessions, self.RANGE) == 2


# === Prescription shape =================================================


class TestPrescriptionShape:
    def test_band_travels_with_every_set(self, engine):
        result = recommend(engine, [session(50, [8, 8, 8])])
        for s in result.sets:
            assert (s.rep_low, s.rep_high) == (6, 10)
            assert s.role == "straight"
            # `reps` stays the single number to hit, for clients that render one.
            assert s.rep_low <= s.reps <= s.rep_high

    def test_band_prescription_says_what_earns_the_weight(self, engine):
        result = recommend(engine, [session(50, [8, 8, 8])])
        assert result.strategy == ProgressionStrategy.BAND.value
        assert result.branch.kind == "earn_weight"
        assert "55" in result.branch.action

    def test_strength_compound_gets_a_top_set_and_a_miss_branch(self, engine):
        result = recommend(
            engine,
            [session(315, [5, 5, 5])],
            goal="Get Stronger",
            exercise_id="default-back-bb-deadlifts",
            exercise_name="Deadlifts",
        )
        assert result.strategy == ProgressionStrategy.TOP_SET.value
        assert result.sets[0].role == "top"
        assert all(s.role == "backoff" for s in result.sets[1:])
        # Backoffs are genuinely lighter than the top set.
        assert all(s.weight < result.sets[0].weight for s in result.sets[1:])
        assert result.branch.kind == "miss_drop"

    def test_isolation_stays_on_the_band_under_a_strength_goal(self, engine):
        """Top sets are for compounds; a curl gets a band whatever the goal."""
        result = recommend(
            engine,
            [session(30, [8, 8, 8])],
            goal="Get Stronger",
            exercise_id="default-biceps-db-curl",
            exercise_name="Dumbbell Bicep Curl",
        )
        assert result.strategy == ProgressionStrategy.BAND.value

    def test_serialised_payload_carries_band_and_branch(self, engine):
        payload = recommend(engine, [session(50, [8, 8, 8])]).to_dict()
        assert payload["strategy"] == "band"
        assert payload["branch"]["kind"] == "earn_weight"
        first = payload["sets"][0]
        assert first["rep_low"] == 6 and first["rep_high"] == 10
        assert first["reps"] == 9  # the aim, still present for older clients
