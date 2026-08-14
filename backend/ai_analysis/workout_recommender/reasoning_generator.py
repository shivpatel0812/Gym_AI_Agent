"""
Reasoning Generator — LLM-optional explanation for pre-computed progression numbers.

The progression engine computes exact numbers deterministically.
This module only generates human-readable reasoning text.
If the LLM is unavailable, template-based reasoning is used instead.
Numbers are NEVER affected by LLM availability.
"""

from typing import Dict, Optional
from .progression_engine import Decision


class ReasoningGenerator:
    """
    Generates human-readable reasoning for progression decisions.
    LLM is optional — template fallback always works.
    """

    def __init__(self, openai_client=None, model: str = "gpt-4o-mini"):
        """
        Args:
            openai_client: Optional OpenAI client. If None, templates are always used.
            model: Model to use for reasoning generation.
        """
        self.client = openai_client
        self.model = model

    def generate_reasoning(
        self,
        decision: Decision,
        reasoning_context: Dict,
        exercise_name: str = "",
    ) -> str:
        """
        Generate reasoning text for a progression decision.

        Tries LLM first (if available), falls back to templates.
        Numbers are pre-computed — LLM only explains them.

        Args:
            decision: The progression decision enum
            reasoning_context: Context dict from ProgressionEngine
            exercise_name: Name of the exercise (for display)

        Returns:
            Human-readable reasoning string (1-2 sentences)
        """
        # This state is a UI/data-quality instruction, not coaching prose. Keep
        # it deterministic so an LLM cannot accidentally recommend "0 lbs" or
        # obscure an invalid-history warning.
        if decision == Decision.NEEDS_STARTING_WEIGHT:
            return self._template_reasoning(decision, reasoning_context, exercise_name)

        # Try LLM if available
        if self.client:
            try:
                return self._llm_reasoning(decision, reasoning_context, exercise_name)
            except Exception:
                pass

        # Fallback: deterministic template
        return self._template_reasoning(decision, reasoning_context, exercise_name)

    def _llm_reasoning(
        self,
        decision: Decision,
        reasoning_context: Dict,
        exercise_name: str,
    ) -> str:
        """Generate reasoning via LLM. Must not suggest different numbers."""
        prompt = self._build_prompt(decision, reasoning_context, exercise_name)

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a concise fitness coach. Write 1-2 sentences explaining "
                        "WHY this progression decision was made. Do NOT suggest different "
                        "numbers or contradict the decision. Be encouraging but direct."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.5,
            max_tokens=100,
        )

        reasoning = response.choices[0].message.content.strip()
        if not reasoning:
            return self._template_reasoning(decision, reasoning_context, exercise_name)
        return reasoning

    def _build_prompt(self, decision: Decision, ctx: Dict, exercise_name: str) -> str:
        """Build the prompt for LLM reasoning."""
        parts = [f"Exercise: {exercise_name}", f"Decision: {decision.value}"]

        if "prev_weight" in ctx:
            parts.append(f"Previous weight: {ctx['prev_weight']} lbs")
        if "new_weight" in ctx:
            parts.append(f"New weight: {ctx['new_weight']} lbs")
        if "prev_reps" in ctx:
            parts.append(f"Previous reps: {ctx['prev_reps']}")
        if "new_reps" in ctx:
            parts.append(f"New reps: {ctx['new_reps']}")
        if "consecutive_failures" in ctx:
            parts.append(f"Consecutive failures: {ctx['consecutive_failures']}")
        if "deload_pct" in ctx:
            parts.append(f"Deload percentage: {int(ctx['deload_pct'] * 100)}%")

        parts.append("Explain WHY in 1-2 sentences. Do NOT suggest different numbers.")
        return "\n".join(parts)

    def _template_reasoning(
        self,
        decision: Decision,
        ctx: Dict,
        exercise_name: str,
    ) -> str:
        """Deterministic template-based reasoning. Always works."""
        if decision == Decision.NEEDS_STARTING_WEIGHT:
            rep_range = ctx.get("rep_range", (6, 10))
            if ctx.get("has_implausible_data"):
                return (
                    "Your previous weight or rep entry looks invalid, so it was not used. "
                    f"Enter a starting weight you can lift for {rep_range[0]} reps with good form."
                )
            return (
                f"First time doing {exercise_name}. "
                f"Pick a starting weight you can do for {rep_range[0]} reps with good form."
            )

        if decision == Decision.FIRST_SESSION:
            if ctx.get("estimated_from_stale_history"):
                weight = ctx.get("estimated_weight", 0)
                prev = ctx.get("prev_weight")
                days = ctx.get("days_since_last")
                gap = f" after {days} days off" if days else ""
                prev_bit = f" Last time was {prev:g} lbs." if prev else ""
                return (
                    f"No session in the last 30 days{gap}. "
                    f"Starting with 3 sets at {weight:g} lbs — a conservative load you should be able to hit now."
                    f"{prev_bit}"
                )
            if ctx.get("estimated_from_top_lifts"):
                weight = ctx.get("estimated_weight", 0)
                return (
                    f"Based on the lift context you shared, {weight:g} lbs is a conservative "
                    "starting estimate. Adjust it if your first set feels too heavy or light."
                )
            return (
                f"First session for {exercise_name}. "
                f"Starting at the low end of your rep range to establish a baseline."
            )

        if decision == Decision.INCREASE_WEIGHT:
            prev = ctx.get("prev_weight", 0)
            new = ctx.get("new_weight", 0)
            return (
                f"You hit the top of your rep range at {prev} lbs. "
                f"Moving up to {new} lbs and resetting reps."
            )

        if decision == Decision.INCREASE_REPS:
            weight = ctx.get("weight", 0)
            if weight:
                return (
                    f"Matched your previous session. "
                    f"Adding a rep per set at the same weight ({weight} lbs)."
                )
            return "Matched your previous session. Adding a rep per set at the same weight."

        if decision == Decision.MAINTAIN:
            failures = ctx.get("consecutive_failures", 0)
            return (
                f"Multiple sessions below target ({failures} consecutive). "
                f"Holding steady to consolidate."
            )

        if decision == Decision.DELOAD:
            prev = ctx.get("prev_weight", 0)
            new = ctx.get("deload_weight", 0)
            return (
                f"Your estimated 1RM has stalled. "
                f"Taking a strategic deload at {new} lbs (80% of {prev} lbs)."
            )

        if decision == Decision.LIGHT_DAY:
            heavy = ctx.get("heavy_weight", 0)
            light = ctx.get("light_weight", 0)
            return (
                f"Light day: working at {light} lbs (~87% of your heavy day weight {heavy} lbs). "
                f"Focus on form and recovery."
            )

        if decision == Decision.CARDIO_PROGRESS:
            prev_time = ctx.get("prev_time")
            new_time = ctx.get("new_time")
            if prev_time and new_time:
                return (
                    f"Based on your last session ({prev_time} min), "
                    f"adding 1 minute for progressive overload."
                )
            return "Starting with a baseline cardio session."

        if decision == Decision.BODYWEIGHT_PROGRESS:
            return "Adding a rep per set for progressive bodyweight overload."

        return "Continuing with your current progression."
