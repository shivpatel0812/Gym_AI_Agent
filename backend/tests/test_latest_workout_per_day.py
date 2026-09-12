"""
Tests for searching the latest workout per exercise day when generating a plan.

When generating a plan (in chat, CreatePlanModal, or plan wizard), the generator
searches the user's workout sessions for the latest workout for each exercise day
(e.g., Push -> latest Push session, Pull -> latest Pull session, Legs -> latest Legs session)
and creates the day's workout from those exact exercises.
"""

import sys
import os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from ai_analysis.training_history import (
    identify_day_family,
    infer_session_day_family,
    match_session_to_day_score,
    extract_session_exercises,
    find_latest_workout_for_day,
    discover_days_from_history,
)
from routers.training_plan import _attach_referenced_workout


class TestDayFamilyIdentification:
    @pytest.mark.parametrize(
        "label, expected",
        [
            ("Push", "push"),
            ("Push Day", "push"),
            ("Push A", "push"),
            ("Chest & Triceps", "push"),
            ("Heavy Push", "push"),
            ("Pull", "pull"),
            ("Pull Day", "pull"),
            ("Pull B", "pull"),
            ("Back & Biceps", "pull"),
            ("Legs", "legs"),
            ("Leg Day", "legs"),
            ("Quads & Calves", "legs"),
            ("Upper", "upper"),
            ("Upper Body", "upper"),
            ("Lower", "legs"),
            ("Lower Body", "legs"),
            ("Full Body", "full_body"),
            ("Arms", "arms"),
            ("Shoulders", "shoulders"),
        ],
    )
    def test_identify_day_family(self, label, expected):
        assert identify_day_family(label) == expected


class TestSessionDayFamilyInference:
    def test_infers_from_split_day(self):
        assert infer_session_day_family({"split_day": "Push Day"}) == "push"
        assert infer_session_day_family({"split_day": "Pull B"}) == "pull"
        assert infer_session_day_family({"split_day": "Legs"}) == "legs"

    def test_infers_from_workout_name(self):
        assert infer_session_day_family({"workout_name": "Chest & Triceps"}) == "push"
        assert infer_session_day_family({"workout_name": "Back & Biceps"}) == "pull"

    def test_infers_from_exercises_when_unlabelled(self):
        # 3 push exercises: Bench Press (CHEST), Incline DB Press (CHEST), Lateral Raise (SHOULDERS)
        session = {
            "workout_name": "Morning Session",
            "exercises": [
                {"exercise_id": "barbell_bench_press", "exercise_name": "Barbell Bench Press"},
                {"exercise_id": "incline_dumbbell_press", "exercise_name": "Incline Dumbbell Press"},
                {"exercise_id": "lateral_raise", "exercise_name": "Dumbbell Lateral Raise"},
            ],
        }
        assert infer_session_day_family(session) == "push"

    def test_infers_pull_from_exercises_when_unlabelled(self):
        session = {
            "exercises": [
                {"exercise_id": "lat_pulldown", "exercise_name": "Lat Pulldown"},
                {"exercise_id": "barbell_row", "exercise_name": "Barbell Row"},
                {"exercise_id": "bicep_curl", "exercise_name": "Dumbbell Bicep Curl"},
            ],
        }
        assert infer_session_day_family(session) == "pull"


class TestMatchSessionToDayScore:
    def test_exact_matches_score_highest(self):
        assert match_session_to_day_score({"split_day": "Push"}, "Push") == 1.0
        assert match_session_to_day_score({"workout_name": "Push"}, "Push") >= 0.98

    def test_matching_qualifiers(self):
        assert match_session_to_day_score({"split_day": "Push A"}, "Push A") == 1.0

    def test_conflicting_qualifiers_rejected(self):
        # Push A should never match a Push B session
        assert match_session_to_day_score({"split_day": "Push B"}, "Push A") == 0.0
        assert match_session_to_day_score({"split_day": "Push A"}, "Push B") == 0.0

    def test_prefix_matches(self):
        assert match_session_to_day_score({"split_day": "Push Day"}, "Push") >= 0.9

    def test_family_matches(self):
        assert match_session_to_day_score({"split_day": "Chest & Triceps"}, "Push") >= 0.85

    def test_unrelated_days_score_zero(self):
        assert match_session_to_day_score({"split_day": "Pull"}, "Push") == 0.0
        assert match_session_to_day_score({"split_day": "Legs"}, "Push") == 0.0


class TestExtractSessionExercises:
    def test_extracts_sets_reps_weights_in_order(self):
        session = {
            "date": "2026-09-12",
            "exercises": [
                {
                    "exercise_id": "barbell_bench_press",
                    "exercise_name": "Barbell Bench Press",
                    "sets": [
                        {"reps": 8, "weight": 185},
                        {"reps": 8, "weight": 185},
                        {"reps": 7, "weight": 185},
                    ],
                },
                {
                    "exercise_id": "incline_dumbbell_press",
                    "exercise_name": "Incline Dumbbell Press",
                    "sets": [
                        {"reps": 10, "weight": 70},
                        {"reps": 10, "weight": 70},
                    ],
                },
            ],
        }
        exercises = extract_session_exercises(session)
        assert len(exercises) == 2
        assert exercises[0]["exercise_id"] == "barbell_bench_press"
        assert exercises[0]["sets"] == 3
        assert exercises[0]["reps"] == 8
        assert exercises[0]["last_working_weight"] == 185.0
        assert exercises[0]["order"] == 1
        assert exercises[0]["source_date"] == "2026-09-12"

        assert exercises[1]["exercise_id"] == "incline_dumbbell_press"
        assert exercises[1]["sets"] == 2
        assert exercises[1]["reps"] == 10
        assert exercises[1]["order"] == 2


class TestFindLatestWorkoutForDay:
    SESSIONS = [
        {
            "id": "s_push_latest",
            "date": "2026-09-12",
            "split_day": "Push",
            "exercises": [{"exercise_id": "bench", "exercise_name": "Bench Press"}],
        },
        {
            "id": "s_pull_latest",
            "date": "2026-09-10",
            "split_day": "Pull",
            "exercises": [{"exercise_id": "row", "exercise_name": "Barbell Row"}],
        },
        {
            "id": "s_legs_latest",
            "date": "2026-09-08",
            "split_day": "Legs",
            "exercises": [{"exercise_id": "squat", "exercise_name": "Squat"}],
        },
        {
            "id": "s_push_older",
            "date": "2026-09-05",
            "split_day": "Push",
            "exercises": [{"exercise_id": "ohp", "exercise_name": "Overhead Press"}],
        },
    ]

    def test_finds_latest_push_session(self):
        found = find_latest_workout_for_day(self.SESSIONS, "Push")
        assert found is not None
        assert found["id"] == "s_push_latest"
        assert found["date"] == "2026-09-12"

    def test_finds_latest_pull_session(self):
        found = find_latest_workout_for_day(self.SESSIONS, "Pull")
        assert found is not None
        assert found["id"] == "s_pull_latest"
        assert found["date"] == "2026-09-10"

    def test_finds_latest_legs_session(self):
        found = find_latest_workout_for_day(self.SESSIONS, "Legs")
        assert found is not None
        assert found["id"] == "s_legs_latest"
        assert found["date"] == "2026-09-08"

    def test_alternating_days_take_distinct_sessions(self):
        # Push A gets s_push_latest
        push_a = find_latest_workout_for_day(self.SESSIONS, "Push")
        assert push_a["id"] == "s_push_latest"

        # Push B with s_push_latest excluded gets s_push_older
        push_b = find_latest_workout_for_day(self.SESSIONS, "Push", exclude_session_ids={"s_push_latest"})
        assert push_b["id"] == "s_push_older"


class TestDiscoverDaysFromHistory:
    def test_discovers_ppl_in_order(self):
        sessions = [
            {"date": "2026-09-12", "split_day": "Push", "exercises": [{"exercise_id": "bench"}]},
            {"date": "2026-09-10", "split_day": "Pull", "exercises": [{"exercise_id": "row"}]},
            {"date": "2026-09-08", "split_day": "Legs", "exercises": [{"exercise_id": "squat"}]},
        ]
        days = discover_days_from_history(sessions)
        assert days == ["Push", "Pull", "Legs"]


class TestAttachReferencedWorkoutAlwaysSearchesLatest:
    @patch("routers.training_plan.db")
    def test_always_attaches_latest_workout_per_exercise_day(self, mock_db):
        """When generating a plan, every day automatically gets its latest workout."""
        mock_sessions = [
            MagicMock(
                id="s_push",
                to_dict=lambda: {
                    "id": "s_push",
                    "date": "2026-09-12",
                    "split_day": "Push",
                    "exercises": [
                        {"exercise_id": "bench_press", "exercise_name": "Bench Press", "sets": [{"reps": 8, "weight": 185}]},
                        {"exercise_id": "incline_db", "exercise_name": "Incline Dumbbell Press", "sets": [{"reps": 10, "weight": 70}]},
                    ],
                },
            ),
            MagicMock(
                id="s_pull",
                to_dict=lambda: {
                    "id": "s_pull",
                    "date": "2026-09-10",
                    "split_day": "Pull",
                    "exercises": [
                        {"exercise_id": "lat_pulldown", "exercise_name": "Lat Pulldown", "sets": [{"reps": 10, "weight": 140}]},
                        {"exercise_id": "cable_row", "exercise_name": "Cable Row", "sets": [{"reps": 12, "weight": 130}]},
                    ],
                },
            ),
            MagicMock(
                id="s_legs",
                to_dict=lambda: {
                    "id": "s_legs",
                    "date": "2026-09-08",
                    "split_day": "Legs",
                    "exercises": [
                        {"exercise_id": "squat", "exercise_name": "Barbell Squat", "sets": [{"reps": 6, "weight": 225}]},
                        {"exercise_id": "leg_press", "exercise_name": "Leg Press", "sets": [{"reps": 10, "weight": 400}]},
                    ],
                },
            ),
        ]

        mock_db.collection().document().collection().stream.return_value = mock_sessions

        split_context = {
            "split_id": "split_ppl",
            "split_name": "PPL",
            "days": [
                {"day_name": "Push", "focus": "Push", "exercises": []},
                {"day_name": "Pull", "focus": "Pull", "exercises": []},
                {"day_name": "Legs", "focus": "Legs", "exercises": []},
            ],
        }

        # User simply says "create the plan" with no explicit dates
        conversation = [{"role": "user", "content": "Create the plan for me"}]

        enriched = _attach_referenced_workout("user_123", split_context, conversation)

        # Every day should now have referenced workouts attached from the latest sessions!
        assert len(enriched["referenced_workouts"]) == 3
        dates_by_day = {r["target_day"]: r["date"] for r in enriched["referenced_workouts"]}
        assert dates_by_day["Push"] == "2026-09-12"
        assert dates_by_day["Pull"] == "2026-09-10"
        assert dates_by_day["Legs"] == "2026-09-08"

        # The exercises in enriched['days'] are populated from the latest sessions
        push_day = next(d for d in enriched["days"] if d["day_name"] == "Push")
        assert len(push_day["exercises"]) == 2
        assert push_day["exercises"][0]["exercise_id"] == "bench_press"
        assert push_day["exercises"][1]["exercise_id"] == "incline_db"

    @patch("routers.training_plan.db")
    def test_explicit_rejection_prevents_auto_attachment(self, mock_db):
        """If user asks to build from scratch / not use previous, history is not auto-attached."""
        mock_sessions = [
            MagicMock(
                id="s_push",
                to_dict=lambda: {
                    "id": "s_push",
                    "date": "2026-09-12",
                    "split_day": "Push",
                    "exercises": [{"exercise_id": "bench_press", "exercise_name": "Bench Press"}],
                },
            ),
        ]
        mock_db.collection().document().collection().stream.return_value = mock_sessions

        split_context = {
            "split_id": "split_ppl",
            "split_name": "PPL",
            "days": [{"day_name": "Push", "focus": "Push", "exercises": []}],
        }

        conversation = [{"role": "user", "content": "Start over from scratch, do not use my old workouts"}]

        enriched = _attach_referenced_workout("user_123", split_context, conversation)
        assert enriched.get("referenced_workouts") is None or len(enriched.get("referenced_workouts", [])) == 0
