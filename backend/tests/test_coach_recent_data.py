from datetime import datetime
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

from ai_analysis.ai_coach import FitnessAICoach, fresh_log_tool
from ai_analysis.coach_tools import CoachToolbox
from fakes import FakeDb


def _coach():
    with patch("ai_analysis.ai_coach.OpenAI"):
        return FitnessAICoach(api_key="test", user_profile={"goal": "strength"})


def test_one_day_tool_lookbacks_use_the_users_local_day():
    db = FakeDb(collections={
        "workout_sessions": [
            {"date": "2026-09-03", "split_name": "Push", "exercises": []},
            {"date": "2026-09-04", "split_name": "Future UTC day", "exercises": []},
        ],
        "macros": [
            {"date": "2026-09-03", "total_calories": 2100, "food_items": []},
            {"date": "2026-09-04", "total_calories": 100, "food_items": []},
        ],
    })
    local_evening = datetime(2026, 9, 3, 22, 30, tzinfo=ZoneInfo("America/New_York"))

    with patch("user_time.now", return_value=local_evening):
        toolbox = CoachToolbox(db, "u1")
        workouts = toolbox.get_recent_sessions(days=1)
        nutrition = toolbox.get_nutrition_log(days=1)
        combined = toolbox.get_recent_activity(days=1)

    assert [row["date"] for row in workouts["sessions"]] == ["2026-09-03"]
    assert [row["date"] for row in nutrition["entries"]] == ["2026-09-03"]
    assert combined["as_of"] == "2026-09-03"
    assert combined["workouts"]["session_count"] == 1
    assert combined["nutrition"]["days_logged"] == 1


def test_recent_nutrition_and_workout_questions_force_the_matching_reader():
    assert fresh_log_tool("What did I eat today?") == "get_nutrition_log"
    assert fresh_log_tool("What should I eat next today?") == "get_today_remaining"
    assert fresh_log_tool("How was my last workout?") == "get_recent_sessions"
    assert fresh_log_tool("How were my workouts and nutrition this week?") == "get_recent_activity"
    assert fresh_log_tool("Explain progressive overload") is None

    coach = _coach()
    kwargs = coach._request_kwargs(
        [], Mock(), 0, 0, required_fresh_tool="get_nutrition_log"
    )
    assert kwargs["tool_choice"] == {
        "type": "function",
        "function": {"name": "get_nutrition_log"},
    }

    # Only the first round is forced. Once the fresh result is present, the
    # model must be allowed to answer instead of getting trapped in tool calls.
    follow_up = coach._request_kwargs(
        [], Mock(), 1, 1, required_fresh_tool="get_nutrition_log"
    )
    assert "tool_choice" not in follow_up


def test_prompt_and_relative_dates_share_the_toolbox_clock():
    toolbox = Mock()
    toolbox.local_now.return_value = datetime(
        2026, 9, 3, 22, 30, tzinfo=ZoneInfo("America/New_York")
    )
    toolbox.get_latest_body_scan.return_value = {"status": "no_scan"}

    messages = _coach()._build_chat_messages(
        "What did I eat today?",
        {"analysis_period": "last 28 days"},
        [],
        toolbox,
        mode="nutrition",
        nutrition_context={},
    )

    system = messages[0]["content"]
    assert "Today is Thursday, September 03, 2026" in system
    assert "Always make a fresh tool call" in system
    assert "get_nutrition_log" in system
