"""Plan Mode uses a distinct interview prompt and does not leak into coach chat."""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.ai_coach import FitnessAICoach

SUMMARY = {
    "analysis_period": "last 28 days",
    "training": {},
    "nutrition": {},
    "recovery": {},
    "lifestyle": {},
}

SPLIT = {
    "split_name": "Push Pull Legs",
    "days": [{"day_name": "Push", "exercises": [{"exercise_name": "Incline Dumbbell Press"}]}],
}


def _coach():
    with patch("ai_analysis.ai_coach.OpenAI"):
        return FitnessAICoach(api_key="test", user_profile={"goal": "get strong"})


def test_plan_mode_prompt_interviews_against_split():
    coach = _coach()
    messages = coach._build_chat_messages(
        "I want to hit 85s on incline press",
        SUMMARY,
        [],
        None,
        mode="plan",
        split_context=SPLIT,
    )
    system = messages[0]["content"]
    assert "PLAN MODE" in system
    assert "Push Pull Legs" in system
    assert "Incline Dumbbell Press" in system
    assert "Generate Plan" in system
    assert messages[-1]["content"] == "I want to hit 85s on incline press"


def test_coach_mode_does_not_use_plan_interview():
    coach = _coach()
    messages = coach._build_chat_messages(
        "How did I sleep?",
        SUMMARY,
        [],
        None,
        mode="coach",
    )
    system = messages[0]["content"]
    assert "PLAN MODE" not in system
    assert "personal fitness coach" in system.lower()
