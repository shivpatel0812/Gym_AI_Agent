"""
Reading a finish line out of a sentence, and saying what it would take.

The goal used to live only as prose in `primary_goal`, so nothing could pace
toward it, check it, or notice the plan never trained it. These pin the two
halves: the parse must not invent numbers, and the verdict must reach for time
and food in the right order.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from ai_analysis.goal_feasibility import (
    assess_goal,
    cheapest_sufficient_balance,
    destination_for_plan,
    match_exercise,
    parse_lift_goal,
    required_weekly_gain,
    weeks_required,
)

# 22, 5'9", 160 lb, advanced, training 5-6 days. Maintenance ~2660.
PROFILE = {
    "weight": 160.0,
    "age": 22,
    "gender": "male",
    "height_in": 69,
    "experience_level": "advanced",
    "preferred_workout_frequency": "5_6_days",
}

# 80 lb dumbbells for 6.
BASELINE = 80 * (1 + 6 / 30)


class TestParsing:
    def test_the_sentence_this_was_built_for(self):
        goal = parse_lift_goal("increase incline to hit 90s for 3 in 12 weeks")
        assert (goal.weight, goal.reps, goal.weeks) == (90.0, 3, 12)
        assert "incline" in goal.exercise_hint.lower()

    def test_the_horizon_is_not_read_as_the_lift(self):
        """
        "12 weeks" and "90 for 3" are both a number beside a small number.
        Consuming the horizon first is what stops "in 12 weeks" parsing as a
        12 lb triple.
        """
        goal = parse_lift_goal("get to 225 for 5 in 10 weeks")
        assert goal.weight == 225.0
        assert goal.reps == 5
        assert goal.weeks == 10

    @pytest.mark.parametrize(
        "text,weight,reps",
        [
            ("90s for 3", 90.0, 3),
            ("90 lb x 3", 90.0, 3),
            ("225lbs for 5 reps", 225.0, 5),
            ("bench 315 x 1", 315.0, 1),
            ("hit 100s @ 8", 100.0, 8),
        ],
    )
    def test_load_and_rep_notations(self, text, weight, reps):
        goal = parse_lift_goal(text)
        assert (goal.weight, goal.reps) == (weight, reps)

    def test_a_rep_range_takes_its_floor(self):
        """A goal of "85 for 6-8" is met the first time 85 goes for 6."""
        assert parse_lift_goal("85s for 6-8 reps").reps == 6

    def test_months_become_weeks(self):
        assert parse_lift_goal("315 for 3 in 3 months").weeks == 12

    def test_a_goal_with_no_horizon_parses_without_one(self):
        goal = parse_lift_goal("I want to incline press 90s for 3")
        assert goal.weeks is None
        assert goal.weight == 90.0

    @pytest.mark.parametrize(
        "text",
        ["", None, "I want to get stronger", "lose some weight", "feel better"],
    )
    def test_a_sentence_with_no_numbers_is_none_not_a_guess(self, text):
        assert parse_lift_goal(text) is None

    def test_an_impossible_rep_count_is_rejected(self):
        assert parse_lift_goal("135 for 400") is None


class TestRates:
    def test_required_rate_arrives_exactly_on_time(self):
        rate = required_weekly_gain(96.0, 102.0, 12)
        assert 96.0 * ((1 + rate) ** 12) == pytest.approx(102.0)

    def test_a_goal_already_met_needs_nothing(self):
        assert required_weekly_gain(96.0, 90.0, 12) == 0.0

    def test_weeks_required_is_the_inverse(self):
        assert weeks_required(96.0, 102.0, required_weekly_gain(96.0, 102.0, 12)) == 12

    def test_cheapest_balance_is_tried_first(self):
        """A goal a maintenance eater reaches must not demand a bulk."""
        # An advanced lifter gets 0.16%/wk cutting, 0.28% maintaining.
        assert cheapest_sufficient_balance(0.0020, "advanced") == "maintain"
        assert cheapest_sufficient_balance(0.0010, "advanced") == "lose"

    def test_an_impossible_rate_returns_no_balance(self):
        """Food is not the lever for every goal, and saying so matters."""
        assert cheapest_sufficient_balance(0.05, "advanced") is None


class TestAssessment:
    def test_the_deficit_is_named_as_the_thing_in_the_way(self):
        """
        90x3 needs ~0.26%/wk. An advanced lifter gets 0.16% in a deficit and
        0.28% at maintenance, so the answer is food, and it is maintenance —
        not a bulk.
        """
        goal = parse_lift_goal("incline 90s for 3 in 12 weeks")
        result = assess_goal(
            goal, BASELINE, profile=PROFILE, energy_balance="lose",
            current_calories=2063,
        )
        assert result.reachable is False
        assert result.needed_balance == "maintain"
        assert result.nutrition["targets"]["calories"] > 2063
        assert result.calorie_change > 0
        assert "maintenance" in result.verdict

    def test_the_same_goal_is_reachable_once_eating_enough(self):
        goal = parse_lift_goal("incline 90s for 3 in 12 weeks")
        result = assess_goal(goal, BASELINE, profile=PROFILE, energy_balance="maintain")
        assert result.reachable is True

    def test_an_out_of_reach_goal_names_time_not_food(self):
        goal = parse_lift_goal("incline 150s for 8 in 12 weeks")
        result = assess_goal(goal, BASELINE, profile=PROFILE, energy_balance="maintain")
        assert result.reachable is False
        assert result.needed_balance is None
        assert "time" in result.verdict.lower()

    def test_an_out_of_reach_goal_still_says_how_long_it_would_take(self):
        goal = parse_lift_goal("incline 95s for 6 in 4 weeks")
        result = assess_goal(goal, BASELINE, profile=PROFILE, energy_balance="maintain")
        assert result.weeks_at_current_intake > 4

    def test_a_goal_already_achieved_says_so(self):
        goal = parse_lift_goal("incline 70s for 5 in 12 weeks")
        result = assess_goal(goal, BASELINE, profile=PROFILE, energy_balance="maintain")
        assert result.reachable is True
        assert "already" in result.verdict.lower()

    def test_no_history_reports_that_rather_than_a_verdict(self):
        """Nothing to measure against is a different answer from "no"."""
        goal = parse_lift_goal("incline 90s for 3 in 12 weeks")
        result = assess_goal(goal, None, profile=PROFILE, energy_balance="maintain")
        assert result.reachable is None
        assert "log" in result.verdict.lower()

    def test_nutrition_comes_back_even_when_the_goal_already_fits(self):
        """"Keep eating this" is an answer too."""
        goal = parse_lift_goal("incline 90s for 3 in 12 weeks")
        result = assess_goal(goal, BASELINE, profile=PROFILE, energy_balance="maintain")
        assert result.nutrition["targets"]["calories"] > 0
        assert result.nutrition["targets"]["protein"] > 0

    def test_an_incomplete_profile_reports_what_is_missing(self):
        goal = parse_lift_goal("incline 90s for 3 in 12 weeks")
        result = assess_goal(goal, BASELINE, profile={"weight": 160}, energy_balance="lose")
        assert result.nutrition["targets"] is None
        assert result.nutrition.get("missing_fields")

    def test_training_age_changes_the_verdict_on_identical_numbers(self):
        goal = parse_lift_goal("incline 90s for 3 in 12 weeks")
        advanced = assess_goal(goal, BASELINE, profile=PROFILE, energy_balance="lose")
        novice = assess_goal(
            goal, BASELINE, profile={**PROFILE, "experience_level": "novice"},
            energy_balance="lose",
        )
        assert advanced.reachable is False
        assert novice.reachable is True


class TestPlanAttachment:
    def test_destination_uses_the_fields_planexercise_already_has(self):
        goal = parse_lift_goal("incline 90s for 3 in 12 weeks")
        assert destination_for_plan(goal) == {
            "target_weight": 90.0,
            "target_reps": 3,
            "target_weeks": 12,
        }

    def test_the_goal_attaches_to_the_lift_it_names(self):
        exercises = [
            {"exercise_name": "Lat Pulldowns"},
            {"exercise_name": "Incline Dumbbell Press"},
            {"exercise_name": "Weighted Dips"},
        ]
        assert match_exercise("incline", exercises)["exercise_name"] == (
            "Incline Dumbbell Press"
        )

    def test_a_lift_the_plan_does_not_have_attaches_to_nothing(self):
        """Better unattached than stamped onto whatever sorted first."""
        exercises = [{"exercise_name": "Lat Pulldowns"}, {"exercise_name": "Squat"}]
        assert match_exercise("incline", exercises) is None

    def test_matching_prefers_the_closer_name(self):
        exercises = [
            {"exercise_name": "Incline Dumbbell Press"},
            {"exercise_name": "Dumbbell Curls"},
        ]
        assert match_exercise("incline dumbbell press", exercises)[
            "exercise_name"
        ] == "Incline Dumbbell Press"
