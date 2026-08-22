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
    assert "NUTRITION PLAN MODE" not in system
    assert "personal fitness coach" in system.lower()


def test_nutrition_mode_prompt_aligns_with_training():
    coach = _coach()
    messages = coach._build_chat_messages(
        "I want food to support my incline bench",
        SUMMARY,
        [],
        None,
        mode="nutrition",
        nutrition_context={
            "training": {
                "has_plan": True,
                "primary_goal": "Hit 85s on incline press",
                "days": [{"name": "Push", "exercises": ["Incline Dumbbell Press"]}],
            },
            "nutrition_plan": None,
        },
    )
    system = messages[0]["content"]
    assert "NUTRITION PLAN MODE" in system
    assert "incline press" in system.lower() or "Incline" in system
    assert "Generate Nutrition Plan" in system
    assert "You are in PLAN MODE" not in system
    assert messages[-1]["content"] == "I want food to support my incline bench"


def test_only_nutrition_mode_can_propose_plan_edits():
    """Ordinary coach chat must not be able to stage writes to the plan."""
    from ai_analysis.coach_tools import tools_for_mode

    names = lambda mode: {t["function"]["name"] for t in tools_for_mode(mode)}

    assert "propose_nutrition_edits" in names("nutrition")
    assert "propose_nutrition_edits" not in names("coach")
    assert "propose_nutrition_edits" not in names("plan")
    # Read tools stay available everywhere
    assert "get_nutrition_plan" in names("coach")


def test_dispatch_refuses_a_write_tool_outside_nutrition_mode():
    """A replayed tool call must not slip past the mode gate."""
    from ai_analysis.coach_tools import CoachToolbox

    toolbox = CoachToolbox(db=None, user_id="u1", mode="coach")
    result = toolbox.dispatch("propose_nutrition_edits", {"summary": "x", "edits": []})

    assert "error" in result
    assert toolbox.artifacts == []
