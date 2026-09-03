"""
The data behind the Plan Hub charts.

The engine's view of history and the chart's view are different questions, and
conflating them is what made real logged work disappear from the roadmap: the
engine reads a 60-day window of weighted sets only, which silently drops every
bodyweight session and truncates a twelve-week chart to two months. What these
pin is that the display path stays wider than the engine path, and that a
session is never discarded just because the user forgot to tick a checkbox.
"""

import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.coach_tools import _exercise_history_context
from routers.training_plan import _muscle_group_history


PULLUP = "default-back-bw-pull-ups"
BENCH = "default-chest-db-bench-press"


def recent(days_ago: int) -> str:
    return (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")


def workout(date, exercise_id, name, sets):
    return {
        "date": date,
        "exercises": [
            {
                "exercise_id": exercise_id,
                "exercise_name": name,
                "sets": [
                    {"set_number": i + 1, "weight": w, "reps": r, "completed": c}
                    for i, (w, r, c) in enumerate(sets)
                ],
            }
        ],
    }


class TestExerciseHistoryContext:
    def test_keeps_unloaded_sets(self):
        """Bodyweight work is history. The engine's weight filter is not."""
        sessions = [workout(recent(3), PULLUP, "Pull-ups", [(0, 8, True), (0, 6, True)])]
        context = _exercise_history_context(sessions, PULLUP, "Pull-ups")

        assert context["lifetime_session_count"] == 1
        assert context["recent_sessions"][0]["sets"][0]["reps"] == 8
        assert context["best_bodyweight_rep_set"]["reps"] == 8

    def test_carries_set_number_so_hidden_sets_do_not_renumber(self):
        sessions = [
            workout(recent(3), BENCH, "Dumbbell Bench Press",
                    [(80, 6, True), (80, 5, False), (75, 8, True)])
        ]
        context = _exercise_history_context(sessions, BENCH, "Dumbbell Bench Press")

        numbers = [s["set_number"] for s in context["recent_sessions"][0]["sets"]]
        assert numbers == [1, 2, 3]

    def test_best_set_records_carry_no_ordinal(self):
        """A set pulled out of its session has no meaningful position in it."""
        sessions = [workout(recent(3), BENCH, "Dumbbell Bench Press", [(80, 6, True)])]
        context = _exercise_history_context(sessions, BENCH, "Dumbbell Bench Press")

        assert "set_number" not in context["best_weighted_set"]

    def test_recent_limit_widens_the_chart_without_widening_llm_context(self):
        sessions = [
            workout(recent(day), BENCH, "Dumbbell Bench Press", [(80, 6, True)])
            for day in range(1, 26)
        ]

        default = _exercise_history_context(sessions, BENCH, "Dumbbell Bench Press")
        widened = _exercise_history_context(
            sessions, BENCH, "Dumbbell Bench Press", recent_limit=30
        )

        assert len(default["recent_sessions"]) == 10
        assert len(widened["recent_sessions"]) == 25

    def test_matches_by_name_when_the_id_has_drifted(self):
        sessions = [workout(recent(3), "legacy-id", "Dumbbell Bench Press", [(80, 6, True)])]
        context = _exercise_history_context(sessions, BENCH, "Dumbbell Bench Press")

        assert context["lifetime_session_count"] == 1


class TestMuscleGroupHistory:
    def test_groups_across_exercises_not_just_the_plan_row(self):
        """Swapping incline press for flies is continuity, not a volume drop."""
        sessions = [
            workout(recent(10), BENCH, "Incline Dumbbell Press", [(80, 6, True)]),
            workout(recent(3), "custom-1", "Cable Flyes", [(40, 12, True)]),
        ]

        history = _muscle_group_history(sessions)

        assert "CHEST" in history
        assert len(history["CHEST"]) == 2
        names = [s["exercise_name"] for day in history["CHEST"] for s in day["sessions"]]
        assert names == ["Incline Dumbbell Press", "Cable Flyes"]

    def test_sums_a_days_stimulus_across_every_lift_for_that_muscle(self):
        sessions = [
            {
                "date": recent(2),
                "exercises": [
                    {
                        "exercise_id": BENCH,
                        "exercise_name": "Dumbbell Bench Press",
                        "sets": [{"set_number": 1, "weight": 80, "reps": 10}],
                    },
                    {
                        "exercise_id": "custom-1",
                        "exercise_name": "Cable Flyes",
                        "sets": [{"set_number": 1, "weight": 40, "reps": 10}],
                    },
                ],
            }
        ]

        history = _muscle_group_history(sessions)

        assert history["CHEST"][0]["stimulus"] == 800 + 400

    def test_counts_bodyweight_reps_as_stimulus(self):
        """Weight x reps scores a set of pull-ups at zero. Reps are the load."""
        sessions = [workout(recent(2), PULLUP, "Pull-ups", [(0, 10, True)])]

        history = _muscle_group_history(sessions)

        assert history["BACK"][0]["stimulus"] == 10

    def test_orders_days_chronologically(self):
        sessions = [
            workout(recent(2), BENCH, "Dumbbell Bench Press", [(80, 6, True)]),
            workout(recent(20), BENCH, "Dumbbell Bench Press", [(75, 6, True)]),
        ]

        dates = [day["date"] for day in _muscle_group_history(sessions)["CHEST"]]

        assert dates == sorted(dates)

    def test_ignores_sessions_older_than_the_window(self):
        sessions = [workout("2019-01-01", BENCH, "Dumbbell Bench Press", [(80, 6, True)])]

        assert _muscle_group_history(sessions) == {}

    def test_skips_an_exercise_with_no_resolvable_muscle_group(self):
        sessions = [workout(recent(2), "x", "Zzzz", [(10, 10, True)])]

        assert _muscle_group_history(sessions) == {}

    def test_survives_malformed_sets(self):
        sessions = [
            {
                "date": recent(2),
                "exercises": [
                    {
                        "exercise_id": BENCH,
                        "exercise_name": "Dumbbell Bench Press",
                        "sets": [None, {"weight": 80}, {"weight": 80, "reps": 5}],
                    }
                ],
            }
        ]

        history = _muscle_group_history(sessions)

        assert history["CHEST"][0]["stimulus"] == 400
