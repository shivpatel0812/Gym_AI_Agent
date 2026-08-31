"""Tests for reasoning_generator.py — template output and LLM-fallback behavior."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from ai_analysis.workout_recommender.reasoning_generator import ReasoningGenerator
from ai_analysis.workout_recommender.progression_engine import Decision


@pytest.fixture
def generator_no_llm():
    """ReasoningGenerator with no LLM client (templates only)."""
    return ReasoningGenerator(openai_client=None)


class TestTemplateReasoning:
    def test_first_session(self, generator_no_llm):
        reasoning = generator_no_llm.generate_reasoning(
            decision=Decision.FIRST_SESSION,
            reasoning_context={"reason": "first_session", "rep_range": (6, 10)},
            exercise_name="Dumbbell Bench Press",
        )
        assert "First session" in reasoning
        assert "Dumbbell Bench Press" in reasoning
        assert "baseline" in reasoning

    def test_increase_weight(self, generator_no_llm):
        reasoning = generator_no_llm.generate_reasoning(
            decision=Decision.INCREASE_WEIGHT,
            reasoning_context={
                "reason": "increase_weight",
                "prev_weight": 75,
                "new_weight": 80,
                "increment": 5,
                "reset_reps": 6,
            },
            exercise_name="Dumbbell Bench Press",
        )
        assert "75" in reasoning
        assert "80" in reasoning
        assert "rep range" in reasoning.lower() or "moving up" in reasoning.lower()

    def test_increase_reps(self, generator_no_llm):
        reasoning = generator_no_llm.generate_reasoning(
            decision=Decision.INCREASE_REPS,
            reasoning_context={
                "reason": "increase_reps",
                "prev_reps": [8, 8, 7],
                "new_reps": [9, 9, 8],
                "weight": 75,
            },
            exercise_name="Dumbbell Bench Press",
        )
        assert "75" in reasoning
        assert "rep" in reasoning.lower()

    def test_maintain(self, generator_no_llm):
        reasoning = generator_no_llm.generate_reasoning(
            decision=Decision.MAINTAIN,
            reasoning_context={
                "reason": "maintain_after_failures",
                "consecutive_failures": 2,
                "threshold": 2,
                "weight": 75,
            },
            exercise_name="Dumbbell Bench Press",
        )
        assert "2" in reasoning
        assert "steady" in reasoning.lower() or "holding" in reasoning.lower() or "consolidate" in reasoning.lower()

    def test_deload(self, generator_no_llm):
        reasoning = generator_no_llm.generate_reasoning(
            decision=Decision.DELOAD,
            reasoning_context={
                "reason": "deload",
                "prev_weight": 75,
                "deload_weight": 60,
                "deload_reps": 8,
                "deload_pct": 0.8,
            },
            exercise_name="Dumbbell Bench Press",
        )
        assert "1RM" in reasoning or "stall" in reasoning.lower()
        assert "60" in reasoning

    def test_light_day(self, generator_no_llm):
        reasoning = generator_no_llm.generate_reasoning(
            decision=Decision.LIGHT_DAY,
            reasoning_context={
                "reason": "light_day",
                "heavy_weight": 80,
                "light_weight": 70,
                "light_pct": 0.875,
            },
            exercise_name="Dumbbell Bench Press",
        )
        assert "70" in reasoning
        assert "80" in reasoning
        assert "light" in reasoning.lower() or "recovery" in reasoning.lower()

    def test_cardio_progress(self, generator_no_llm):
        reasoning = generator_no_llm.generate_reasoning(
            decision=Decision.CARDIO_PROGRESS,
            reasoning_context={
                "reason": "cardio_progression",
                "prev_time": 20,
                "new_time": 21,
            },
            exercise_name="Run",
        )
        assert "20" in reasoning
        assert "minute" in reasoning.lower() or "min" in reasoning.lower()

    def test_bodyweight_progress(self, generator_no_llm):
        reasoning = generator_no_llm.generate_reasoning(
            decision=Decision.BODYWEIGHT_PROGRESS,
            reasoning_context={"reason": "bodyweight_rep_increase"},
            exercise_name="Push-Ups",
        )
        assert "rep" in reasoning.lower()


class TestLLMFallback:
    def test_no_client_uses_template(self):
        """Without an OpenAI client, templates are used."""
        gen = ReasoningGenerator(openai_client=None)
        reasoning = gen.generate_reasoning(
            decision=Decision.INCREASE_WEIGHT,
            reasoning_context={"prev_weight": 75, "new_weight": 80},
            exercise_name="Test",
        )
        assert reasoning  # Not empty
        assert isinstance(reasoning, str)

    def test_broken_client_falls_back_to_template(self):
        """If LLM call raises, falls back to template."""
        class BrokenClient:
            class chat:
                class completions:
                    @staticmethod
                    def create(**kwargs):
                        raise Exception("API unavailable")

        gen = ReasoningGenerator(openai_client=BrokenClient())
        reasoning = gen.generate_reasoning(
            decision=Decision.INCREASE_WEIGHT,
            reasoning_context={"prev_weight": 75, "new_weight": 80},
            exercise_name="Test",
        )
        assert reasoning  # Should still return template text
        assert "75" in reasoning
        assert "80" in reasoning

    def test_verbose_llm_falls_back_to_complete_template(self):
        """Workout-card explanations stay short without being visually cut off."""
        class VerboseClient:
            class chat:
                class completions:
                    @staticmethod
                    def create(**kwargs):
                        message = type("Message", (), {
                            "content": (
                                "This recommendation is based on your very consistent "
                                "performance during the previous workout, where every set "
                                "demonstrated that you are prepared to progress while still "
                                "remaining inside the intended training range."
                            )
                        })()
                        choice = type("Choice", (), {"message": message})()
                        return type("Response", (), {"choices": [choice]})()

        gen = ReasoningGenerator(openai_client=VerboseClient())
        reasoning = gen.generate_reasoning(
            decision=Decision.INCREASE_REPS,
            reasoning_context={
                "reason": "advance_in_band",
                "prev_reps": [7, 8, 8],
                "weight": 10,
                "aim": 9,
                "band": "6-10",
            },
            exercise_name="Bench cable row single",
        )

        assert reasoning == (
            "Last time you got 7/8/8 at 10 lbs. Same weight, aim 9 across all sets. "
            "Anything in the 6-10 range counts."
        )
        assert "..." not in reasoning


class TestReasoningNeverEmpty:
    """Reasoning should never be empty regardless of decision."""

    @pytest.mark.parametrize("decision,ctx", [
        (Decision.FIRST_SESSION, {"reason": "first_session", "rep_range": (6, 10)}),
        (Decision.INCREASE_WEIGHT, {"prev_weight": 75, "new_weight": 80}),
        (Decision.INCREASE_REPS, {"weight": 75}),
        (Decision.MAINTAIN, {"consecutive_failures": 2}),
        (Decision.DELOAD, {"prev_weight": 75, "deload_weight": 60}),
        (Decision.LIGHT_DAY, {"heavy_weight": 80, "light_weight": 70}),
        (Decision.CARDIO_PROGRESS, {"prev_time": 20, "new_time": 21}),
        (Decision.BODYWEIGHT_PROGRESS, {}),
    ])
    def test_all_decisions_produce_reasoning(self, decision, ctx):
        gen = ReasoningGenerator(openai_client=None)
        reasoning = gen.generate_reasoning(decision=decision, reasoning_context=ctx, exercise_name="Test")
        assert reasoning
        assert len(reasoning) > 10
