"""
The progress index has to survive a bad week.

Every test here is a way the feature could have quietly become something else:
an engagement metric, a ratchet that only goes up, or a number that tells
someone they are failing during a week their own plan asked them to be light.
"""

from datetime import date, datetime, timedelta

import pytest

from progress import index as index_mod
from progress.domains import (
    build_body,
    build_consistency,
    build_nutrition,
    build_strength,
    e1rm,
    goal_direction,
)
from progress.hub import ProgressHubBuilder
from progress.index import IndexPoint, classify, noise_band
from progress.weeks import week_axis, week_start


TODAY = date(2026, 9, 5)          # a Saturday
AXIS = week_axis(TODAY, 8)


def day_in(week: str, offset: int = 0) -> str:
    d = datetime.strptime(week, "%Y-%m-%d").date() + timedelta(days=offset)
    return d.strftime("%Y-%m-%d")


def session(week: str, weight: float, reps: int, exercise="bench", offset=0):
    return {
        "date": day_in(week, offset),
        "exercises": [
            {
                "exercise_id": exercise,
                "exercise_name": exercise.title(),
                "sets": [{"weight": weight, "reps": reps}],
            }
        ],
    }


def points(levels, confidence=0.9, planned_low=(), currents=None):
    return [
        IndexPoint(
            week_start=AXIS[i],
            level=level,
            confidence=confidence,
            planned_low=AXIS[i] in planned_low,
            current=(currents[i] if currents else level),
        )
        for i, level in enumerate(levels)
    ]


# ---------------------------------------------------------------------------
# e1RM
# ---------------------------------------------------------------------------

class TestE1RM:
    def test_computed_within_one_set(self):
        assert e1rm(135, 8) == pytest.approx(171, abs=1)

    def test_rejects_rep_counts_epley_cannot_carry(self):
        """A 30-rep set would report double the load as a 1RM. It carries no
        1RM information, so it is skipped rather than clamped."""
        assert e1rm(45, 30) is None

    def test_rejects_loadless_sets(self):
        assert e1rm(0, 10) is None


# ---------------------------------------------------------------------------
# The level cannot fall on a bad week
# ---------------------------------------------------------------------------

class TestStrengthLevelIsInertial:
    def test_bad_week_does_not_lower_the_level(self):
        sessions = [
            session(AXIS[0], 100, 8),
            session(AXIS[1], 110, 8),
            session(AXIS[2], 115, 8),
            session(AXIS[3], 80, 5),   # the bad week
        ]
        domain = build_strength(sessions, AXIS)
        levels = [p.level for p in domain.series[:4]]
        assert levels[3] >= levels[2], "a bad week lowered demonstrated capability"

    def test_bad_week_does_show_in_the_fast_signal(self):
        sessions = [
            session(AXIS[0], 100, 8),
            session(AXIS[1], 110, 8),
            session(AXIS[2], 115, 8),
            session(AXIS[3], 80, 5),
        ]
        domain = build_strength(sessions, AXIS)
        assert domain.series[3].current < domain.series[2].current

    def test_a_new_lift_does_not_dilute_the_index(self):
        """An exercise's first week is its own baseline and would enter the
        mean as a flat 100, dragging every real gain toward nothing."""
        sessions = [
            session(AXIS[0], 100, 8),
            session(AXIS[1], 120, 8),
            session(AXIS[2], 130, 8),
            session(AXIS[2], 50, 8, exercise="curl"),  # brand new
        ]
        domain = build_strength(sessions, AXIS)
        assert domain.series[2].level == pytest.approx(130, abs=1)

    def test_level_softens_after_a_long_silence_and_says_so(self):
        sessions = [session(AXIS[0], 100, 8), session(AXIS[1], 120, 8)]
        domain = build_strength(sessions, AXIS)
        late = domain.series[6]
        assert late.estimated is True
        assert late.level < domain.series[1].level

    def test_an_abandoned_lift_stops_dragging_the_index(self):
        """Tried twice and dropped. Past DROP_AFTER_WEEKS it leaves the index
        rather than decaying toward zero forever underneath the real lifts."""
        long_axis = week_axis(TODAY, 14)
        sessions = [
            session(long_axis[0], 100, 8),
            session(long_axis[0], 50, 8, exercise="curl"),
            session(long_axis[1], 100, 8),
            session(long_axis[1], 55, 8, exercise="curl"),
            session(long_axis[12], 130, 8),
            session(long_axis[13], 140, 8),
        ]
        domain = build_strength(sessions, long_axis)
        tracked = {p["exercise_id"] for p in domain.detail["positions"]}
        assert "curl" not in tracked
        assert "bench" in tracked


# ---------------------------------------------------------------------------
# Missing data lowers confidence, never score
# ---------------------------------------------------------------------------

class TestCoverageIsNotScore:
    def test_a_silent_week_is_no_evidence_not_zero_sessions(self):
        """Someone who trains without logging is indistinguishable from
        someone who does not train. A week with nothing logged at all is
        evidence of nothing, so consistency must not read it as a zero."""
        sessions = [session(AXIS[i], 100, 8) for i in range(3)]
        has_data = {w: i < 3 for i, w in enumerate(AXIS)}
        domain = build_consistency(sessions, AXIS, 1, has_data)
        assert domain.series[5].current is None
        assert domain.series[5].coverage == 0.0

    def test_a_week_with_food_but_no_workouts_does_count(self):
        sessions = [session(AXIS[i], 100, 8) for i in range(3)]
        has_data = {w: True for w in AXIS}   # food logged all along
        domain = build_consistency(sessions, AXIS, 1, has_data)
        assert domain.series[5].current == 0.0

    def test_unlogged_days_do_not_lower_the_nutrition_level(self):
        """One perfect day logged out of seven is a coverage problem, not a
        nutrition failure — otherwise the score measures app usage."""
        targets = {"calories": 2000, "protein": 150}
        one_day = [{"date": day_in(AXIS[7]), "total_calories": 2000, "total_protein": 150}]
        full_week = [
            {"date": day_in(AXIS[7], i), "total_calories": 2000, "total_protein": 150}
            for i in range(7)
        ]
        sparse = build_nutrition(one_day, AXIS, targets).series[7]
        dense = build_nutrition(full_week, AXIS, targets).series[7]
        assert sparse.level == dense.level
        assert sparse.coverage < dense.coverage


# ---------------------------------------------------------------------------
# The state machine
# ---------------------------------------------------------------------------

class TestStateMachine:
    def test_one_bad_week_holds_rather_than_declines(self):
        """The whole point. A single week outside the band is a week, not a
        direction, and the copy has to read as legitimate."""
        state = classify(points([100, 101, 100, 101, 100, 101, 100, 88]), band=2.0)
        assert state["state"] == "holding"
        assert "no change needed" in state["reason"].lower()

    def test_two_bad_weeks_running_do_decline(self):
        state = classify(points([100, 101, 100, 101, 100, 101, 92, 84]), band=2.0)
        assert state["state"] == "declining"

    def test_decline_requires_coverage(self):
        """Calling a decline is the most consequential thing this machine
        does, so a thinly-logged fortnight may not do it."""
        state = classify(
            points([100, 101, 100, 101, 100, 101, 92, 84], confidence=0.4), band=2.0
        )
        assert state["state"] == "holding"

    def test_three_flat_weeks_become_stalled(self):
        state = classify(points([100, 100.4, 100.2, 100.5, 100.3, 100.4, 100.5, 100.6]), band=2.0)
        assert state["state"] == "stalled"

    def test_holding_cannot_be_farmed(self):
        """Hold once and nothing is wrong; hold three times and the machine
        walks itself to stalled without any extra rule."""
        repeated = classify(points([100, 100, 100, 100, 100, 100, 100, 100]), band=2.0)
        assert repeated["state"] == "stalled"

    def test_thin_history_says_so_instead_of_guessing(self):
        state = classify(points([None, None, None, None, None, None, 100, 101]), band=2.0)
        assert state["state"] == "unknown"
        assert "more week" in state["reason"]

    def test_a_planned_light_week_is_not_a_shortfall(self):
        """Scoring someone down for complying with their own diet break would
        be the app arguing against the plan it generated."""
        with_break = classify(
            points([100, 101, 100, 101, 100, 101, 100, 70], planned_low={AXIS[7]}),
            band=2.0,
        )
        assert with_break["state"] != "declining"

    def test_a_real_climb_reads_as_building(self):
        state = classify(points([100, 101, 102, 103, 104, 105, 106, 112]), band=2.0)
        assert state["state"] == "building"


class TestNoiseBand:
    def test_a_spiky_user_needs_more_evidence_than_a_steady_one(self):
        steady = noise_band(points([100, 100.5, 101, 101.5, 102, 102.5, 103, 103.5]))
        spiky = noise_band(points([100, 112, 95, 118, 92, 120, 90, 115]))
        assert spiky > steady

    def test_band_never_collapses_to_zero(self):
        assert noise_band(points([100] * 8)) >= index_mod.MIN_BAND


# ---------------------------------------------------------------------------
# Goal-relative scoring
# ---------------------------------------------------------------------------

class TestBodyIsGoalRelative:
    @staticmethod
    def weigh_ins(weekly_lbs):
        rows = []
        for i, weight in enumerate(weekly_lbs):
            for offset in (0, 3):
                rows.append({"date": day_in(AXIS[i], offset), "weight_lb": weight})
        return rows

    def test_the_same_curve_scores_opposite_on_opposite_goals(self):
        losing = self.weigh_ins([200, 198.5, 197, 195.5, 194, 192.5, 191, 189.5])
        cut = build_body(losing, AXIS, "cut").series[-1].level
        gain = build_body(losing, AXIS, "gain").series[-1].level
        assert cut > 70 and gain < 20

    def test_losing_far_faster_than_planned_is_not_a_better_score(self):
        on_plan = self.weigh_ins([200, 198.5, 197, 195.5, 194, 192.5, 191, 189.5])
        crashing = self.weigh_ins([200, 194, 188, 182, 176, 170, 164, 158])
        assert (
            build_body(crashing, AXIS, "cut").series[-1].level
            < build_body(on_plan, AXIS, "cut").series[-1].level
        )

    def test_no_weigh_ins_returns_a_reason_not_a_guess(self):
        domain = build_body([], AXIS, "cut")
        assert domain.level() is None
        assert domain.unavailable_reason

    def test_goal_aliases_resolve(self):
        assert goal_direction("lose_weight") == "cut"
        assert goal_direction("lean bulk") == "gain"
        assert goal_direction(None) == "maintain"


class TestWeights:
    def test_a_cut_leans_on_nutrition_and_a_bulk_on_strength(self):
        cut = index_mod.weights_for("cut")
        gain = index_mod.weights_for("gain")
        assert cut["nutrition"] > cut["strength"]
        assert gain["strength"] > gain["nutrition"]

    def test_missing_domains_renormalize_rather_than_score_zero(self):
        strength = build_strength(
            [session(AXIS[i], 100 + i * 5, 8) for i in range(8)], AXIS
        )
        body = build_body([], AXIS, "cut")   # unavailable
        series = index_mod.build_series([strength, body], AXIS, "cut")
        assert series[-1].level == pytest.approx(strength.series[-1].level, abs=0.1)


# ---------------------------------------------------------------------------
# The hub end to end
# ---------------------------------------------------------------------------

class FakeHubDb:
    """Minimal Firestore stand-in for the collections the hub reads."""

    def __init__(self, collections):
        self.collections = collections
        self._name = None

    def collection(self, name):
        self._name = name
        return self

    def document(self, _name=None):
        return self

    def where(self, *_args):
        return self

    def limit(self, _n):
        return self

    def order_by(self, *_a, **_k):
        return self

    def stream(self):
        rows = self.collections.get(self._name, [])
        return [type("D", (), {"id": f"d{i}", "to_dict": lambda s, r=r: r})() for i, r in enumerate(rows)]

    def get(self):
        return type("D", (), {"exists": False, "to_dict": lambda s: {}})()


class TestHub:
    def test_a_brand_new_user_gets_a_shape_not_an_error(self):
        hub = ProgressHubBuilder(FakeHubDb({}), "u1").build(weeks=8, today="2026-09-05")
        assert hub["index"]["level"] is None
        assert hub["index"]["state"] == "unknown"
        assert hub["formula_version"]
        assert len(hub["series"]) == 8

    def test_coverage_is_reported_separately_from_the_index(self):
        sessions = [session(AXIS[i], 100 + i * 5, 8) for i in range(8)]
        hub = ProgressHubBuilder(
            FakeHubDb({"workout_sessions": sessions}), "u1"
        ).build(weeks=8, today="2026-09-05")
        assert hub["coverage"]["sessions_logged"] == 8
        assert "coverage" not in hub["index"] or hub["index"]["confidence"] is not None

    def test_silent_weeks_are_surfaced_as_events(self):
        sessions = [session(AXIS[i], 100, 8) for i in range(2)]
        hub = ProgressHubBuilder(
            FakeHubDb({"workout_sessions": sessions}), "u1"
        ).build(weeks=8, today="2026-09-05")
        kinds = {e["kind"] for e in hub["events"]}
        assert "no_evidence" in kinds


# ---------------------------------------------------------------------------
# Regressions found by running the thing against realistic data
# ---------------------------------------------------------------------------

class TestSteadyProgressIsNotAStall:
    def test_small_consistent_gains_read_as_building(self):
        """Real progress accrues at well under a point a week. Judging a
        single week's delta against the noise band called a user who had put
        22% on their lifts "stalled — worth changing something"."""
        state = classify(points([100, 100.6, 101.2, 101.7, 102.4, 103, 103.6, 104.2]), band=0.8)
        assert state["state"] == "building"

    def test_the_band_measures_spread_around_the_trend_not_zero(self):
        """A user climbing a steady half point a week is not bouncing around.
        Measured against zero, their steadiness would inflate the band by
        exactly the trend being looked for."""
        climber = noise_band(points([100, 100.5, 101, 101.5, 102, 102.5, 103, 103.5]))
        assert climber == index_mod.MIN_BAND


class TestABadWeekReachesTheClassifier:
    def test_a_hard_week_holds_even_though_the_level_cannot_fall(self):
        """The level is peak-anchored, so a bad week cannot push it down —
        which means without the fast signal a hard week is invisible here and
        reads as an absence of progress, i.e. a stall."""
        state = classify(
            points(
                [100, 101, 102, 103, 104, 105, 106, 106],
                currents=[100, 101, 102, 103, 104, 105, 106, 88],
            ),
            band=0.8,
        )
        assert state["state"] == "holding"
        assert "gone away" in state["reason"]

    def test_a_three_week_block_under_peak_is_not_a_decline(self):
        """Accumulation blocks train under peak on purpose. Calling that a
        decline would have the hub arguing against normal periodisation."""
        state = classify(
            points(
                [100, 101, 102, 103, 104, 105, 105, 105],
                currents=[100, 101, 102, 103, 104, 98, 98, 98],
            ),
            band=0.8,
        )
        assert state["state"] != "declining"

    def test_settling_under_peak_for_long_enough_does_decline(self):
        state = classify(
            points(
                [100, 101, 102, 103, 105, 105, 105, 105],
                currents=[100, 101, 102, 103, 98, 98, 98, 98],
            ),
            band=0.8,
        )
        assert state["state"] == "declining"


class TestBodyHasNoWarmUpLag:
    def test_a_cut_on_plan_scores_early_not_just_eventually(self):
        """An exponential filter needs ~1/alpha samples to converge, so at one
        weigh-in a week the first month understated a real cut — drawing a
        fake dip and then a fake recovery on every user's chart."""
        weigh = []
        for i, week in enumerate(AXIS):
            for offset in (0, 3):
                weigh.append(
                    {"date": day_in(week, offset), "weight_lb": 200 - i * 1.5 - offset * 0.2}
                )
        domain = build_body(weigh, AXIS, "cut")
        early = domain.series[2].level
        late = domain.series[-1].level
        assert early is not None and early > 70
        assert abs(late - early) < 25, "early weeks must not be a filter artefact"


class TestDeltaDecomposition:
    def test_a_domain_that_starts_late_still_appears_as_a_driver(self):
        """Strength needs two weeks per lift before it scores. Anchoring the
        decomposition on the index's first week dropped it — naming every
        domain except the one that actually moved the number."""
        strength = build_strength(
            [session(AXIS[i], 100 + i * 6, 8) for i in range(8)], AXIS
        )
        consistency = build_consistency(
            [session(AXIS[i], 100, 8) for i in range(8)], AXIS, 1, {w: True for w in AXIS}
        )
        pts = index_mod.build_series([strength, consistency], AXIS, "gain")
        delta = index_mod.range_delta(pts, [strength, consistency])
        keys = [d["key"] for d in delta["drivers"]]
        assert "strength" in keys
        assert delta["drivers"][0]["key"] == "strength"
