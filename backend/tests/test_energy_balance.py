"""
Resolving whether someone is eating in a surplus, at maintenance, or short.

The property under test is precedence: a measurement must beat an inference,
and an inference must beat a label, because the label is the one that was
observed to be wrong. A real plan carried `nutrition_goal: "maintain"` beside
a 2350 kcal target for a user whose estimated maintenance is 2660.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from nutrition.energy_balance import (
    MIN_COMPLETE_DAYS,
    MIN_WEIGHINS,
    complete_intake_days,
    resolve_energy_balance,
    weight_trend_lb_per_week,
)
from nutrition.trajectory import estimate_maintenance_calories, height_cm_from_profile

# 22, 5'9", 160 lb, training 5-6 days. Estimated maintenance ~2660.
PROFILE = {
    "weight": 160.0,
    "age": 22,
    "gender": "male",
    "height_ft": None,
    "height_in": 69,
    "height_cm": None,
    "preferred_workout_frequency": "5_6_days",
}


def weigh_ins(series, start_day=1):
    return [
        {"date": f"2026-07-{start_day + i * 7:02d}", "weight_lb": w}
        for i, w in enumerate(series)
    ]


def macro_days(values):
    return [
        {"date": f"2026-08-{i + 1:02d}", "calories": v} for i, v in enumerate(values)
    ]


class TestHeightReading:
    """
    `height_in` means the leftover half of a feet-and-inches pair to the
    profile forms, and total inches to whatever wrote this user's row. Reading
    only the first shape returned None for a profile whose height was plainly
    on file, which switched off maintenance and everything gated on it.
    """

    def test_total_inches_without_feet_is_readable(self):
        assert height_cm_from_profile({"height_in": 69}) == pytest.approx(175.26)

    def test_feet_and_inches_still_read_as_a_pair(self):
        assert height_cm_from_profile({"height_ft": 5, "height_in": 9}) == pytest.approx(
            175.26
        )

    def test_the_two_shapes_agree(self):
        assert height_cm_from_profile({"height_in": 69}) == height_cm_from_profile(
            {"height_ft": 5, "height_in": 9}
        )

    def test_stated_centimetres_win(self):
        assert height_cm_from_profile(
            {"height_cm": 180, "height_ft": 5, "height_in": 9}
        ) == 180

    def test_leftover_inches_without_feet_stays_unreadable(self):
        """Nine inches is not a height; guessing 9 feet would be worse."""
        assert height_cm_from_profile({"height_in": 9}) is None

    def test_no_height_is_still_none(self):
        assert height_cm_from_profile({}) is None
        assert height_cm_from_profile({"weight": 160}) is None

    def test_maintenance_now_resolves_for_this_profile(self):
        assert estimate_maintenance_calories(PROFILE) == 2660


class TestBodyweightTrend:
    def test_a_steady_climb_reads_as_gaining(self):
        assert weight_trend_lb_per_week(weigh_ins([160, 161, 162, 163])) == pytest.approx(
            1.0, abs=0.05
        )

    def test_a_steady_drop_reads_as_losing(self):
        assert weight_trend_lb_per_week(weigh_ins([170, 169, 168, 167])) == pytest.approx(
            -1.0, abs=0.05
        )

    def test_too_few_weighins_is_none_not_zero(self):
        """No trend is not the same as a flat trend."""
        series = weigh_ins([160, 161])
        assert len(series) < MIN_WEIGHINS
        assert weight_trend_lb_per_week(series) is None

    def test_a_short_span_is_none_however_many_points(self):
        dense = [{"date": f"2026-07-0{i + 1}", "weight_lb": 160 + i} for i in range(6)]
        assert weight_trend_lb_per_week(dense) is None

    def test_one_bad_weighin_does_not_flip_the_verdict(self):
        """Least squares rather than first-versus-last, for exactly this."""
        clean = weight_trend_lb_per_week(weigh_ins([160, 160.5, 161, 161.5, 162]))
        spiked = weight_trend_lb_per_week(weigh_ins([160, 160.5, 161, 161.5, 159]))
        assert clean > 0
        assert spiked > -0.5


class TestCompleteDayFilter:
    def test_abandoned_logs_are_dropped(self):
        result = complete_intake_days(macro_days([2300, 2200, 130, 290, 2400]), 2350)
        assert result["days_used"] == 3
        assert result["days_dropped"] == 2
        assert result["mean_calories"] == pytest.approx(2300, abs=1)

    def test_the_number_of_dropped_days_is_reported(self):
        """The filter biases upward, so its size has to be visible."""
        result = complete_intake_days(macro_days([2300, 100, 100, 100]), 2350)
        assert result["days_dropped"] == 3

    def test_no_target_still_has_a_floor(self):
        result = complete_intake_days(macro_days([2000, 200]), None)
        assert result["days_used"] == 1


class TestPrecedence:
    def test_the_scale_beats_everything(self):
        result = resolve_energy_balance(
            profile=PROFILE,
            plan={"nutrition_goal": "lose"},
            weigh_ins=weigh_ins([160, 161, 162, 163, 164]),
            macro_days=macro_days([1200] * 20),
        )
        assert result.source == "bodyweight_trend"
        assert result.balance == "gain"
        assert result.measured is True

    def test_a_flat_scale_reads_as_maintenance(self):
        result = resolve_energy_balance(
            profile=PROFILE,
            weigh_ins=weigh_ins([160, 160.1, 159.9, 160.2, 160]),
        )
        assert result.balance == "maintain"

    def test_logged_intake_answers_when_there_is_no_scale(self):
        result = resolve_energy_balance(
            profile=PROFILE,
            plan={"nutrition_goal": "gain"},
            macro_days=macro_days([2100] * MIN_COMPLETE_DAYS),
        )
        assert result.source == "logged_intake"
        assert result.balance == "lose"

    def test_thin_logging_falls_through_rather_than_guessing(self):
        result = resolve_energy_balance(
            profile=PROFILE,
            plan={"nutrition_companion": {"targets": {"calories": 2350}}},
            macro_days=macro_days([2100, 2200]),
        )
        assert result.source == "plan_target"

    def test_the_plan_target_beats_the_plan_label(self):
        """
        The regression this module exists for: a plan labelled "maintain"
        whose own calorie target is 310 kcal under maintenance.
        """
        result = resolve_energy_balance(
            profile=PROFILE,
            plan={
                "nutrition_goal": "maintain",
                "nutrition_companion": {"goal": "muscle", "targets": {"calories": 2350}},
            },
        )
        assert result.source == "plan_target"
        assert result.balance == "lose"
        assert result.measured is False

    def test_a_real_surplus_target_reads_as_gaining(self):
        result = resolve_energy_balance(
            profile=PROFILE,
            plan={"nutrition_companion": {"targets": {"calories": 3000}}},
        )
        assert result.balance == "gain"

    def test_a_target_near_maintenance_reads_as_maintenance(self):
        """Maintenance is a formula estimate; it gets a band, not a knife edge."""
        result = resolve_energy_balance(
            profile=PROFILE,
            plan={"nutrition_companion": {"targets": {"calories": 2660}}},
        )
        assert result.balance == "maintain"

    def test_the_label_answers_only_when_nothing_else_can(self):
        result = resolve_energy_balance(
            profile={},
            plan={"nutrition_goal": "gain"},
        )
        assert result.source == "plan_label"
        assert result.balance == "gain"

    def test_nutrition_goal_names_map_onto_the_three_directions(self):
        assert resolve_energy_balance(plan={"nutrition_goal": "muscle"}).balance == "gain"
        assert resolve_energy_balance(plan={"nutrition_goal": "fat_loss"}).balance == "lose"

    def test_nothing_known_is_none_rather_than_a_deficit(self):
        """An unstated diet is not evidence of a deficit."""
        result = resolve_energy_balance(profile={}, plan={})
        assert result.balance is None
        assert result.source == "unknown"

    def test_every_answer_says_where_it_came_from(self):
        for kwargs in (
            {"profile": PROFILE, "weigh_ins": weigh_ins([160, 161, 162, 163, 164])},
            {"profile": PROFILE, "macro_days": macro_days([2100] * MIN_COMPLETE_DAYS)},
            {"profile": PROFILE, "plan": {"nutrition_goal": "gain"}},
            {"profile": {}, "plan": {}},
        ):
            assert resolve_energy_balance(**kwargs).to_dict()["source"]
