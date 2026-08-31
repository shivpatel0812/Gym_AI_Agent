"""
Reasoning Generator — LLM-optional explanation for pre-computed progression numbers.

The progression engine computes exact numbers deterministically.
This module only generates human-readable reasoning text.
If the LLM is unavailable, template-based reasoning is used instead.
Numbers are NEVER affected by LLM availability.
"""

from typing import Dict, Optional
from .progression_engine import Decision


# Workout cards need a quick explanation, not a chat response. If optional LLM
# prose exceeds either limit, use the deterministic template instead of cutting
# a sentence off in the UI.
MAX_LLM_REASONING_WORDS = 22
MAX_LLM_REASONING_CHARS = 150


# Every cardio outcome routes to the engine's own guidance string.
CARDIO_DECISIONS = {
    Decision.CARDIO_PROGRESS,
    Decision.CARDIO_HOLD,
    Decision.CARDIO_BACKOFF,
    Decision.CARDIO_MAINTAIN,
    Decision.CARDIO_NEEDS_PACE,
    Decision.CARDIO_FIRST_SESSION,
}


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
                        "You are a concise fitness coach. Write exactly one plain sentence "
                        "of at most 18 words explaining why this progression decision was "
                        "made. Do not suggest different numbers or contradict the decision."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.5,
            max_tokens=40,
        )

        reasoning = " ".join(response.choices[0].message.content.split())
        if (
            not reasoning
            or len(reasoning) > MAX_LLM_REASONING_CHARS
            or len(reasoning.split()) > MAX_LLM_REASONING_WORDS
        ):
            return self._template_reasoning(decision, reasoning_context, exercise_name)
        return reasoning

    def _build_prompt(self, decision: Decision, ctx: Dict, exercise_name: str) -> str:
        """Build the prompt for LLM reasoning."""
        parts = [f"Exercise: {exercise_name}", f"Decision: {decision.value}"]

        if "prev_weight" in ctx:
            parts.append(f"Previous weight: {ctx['prev_weight']} lbs")
        if "new_weight" in ctx:
            parts.append(f"New weight: {ctx['new_weight']} lbs")
        if "weight" in ctx:
            parts.append(f"Working weight: {ctx['weight']} lbs")
        if "prev_reps" in ctx:
            parts.append(f"Reps achieved last session: {ctx['prev_reps']}")
        if "new_reps" in ctx:
            parts.append(f"New reps: {ctx['new_reps']}")
        # The band and the aim are what make this readable as coaching rather
        # than arithmetic, so the model needs both to explain the decision.
        if "aim" in ctx:
            parts.append(f"Reps to aim for on every set this session: {ctx['aim']}")
        if "rep_range" in ctx:
            low, high = ctx["rep_range"]
            parts.append(f"Working rep band: {low}-{high} (a sweep of {high} earns more weight)")
        if "outcome" in ctx:
            parts.append(f"How last session landed against that band: {ctx['outcome']}")
        if "earned_by_streak" in ctx:
            parts.append(
                f"Sessions in a row finishing at the top of the band: {ctx['earned_by_streak']}"
            )
        if "consecutive_failures" in ctx:
            parts.append(f"Consecutive sessions going backwards: {ctx['consecutive_failures']}")
        if "deload_pct" in ctx:
            parts.append(f"Deload percentage: {int(ctx['deload_pct'] * 100)}%")
        if "position_adjustment" in ctx:
            adjustment = ctx["position_adjustment"]
            parts.append(
                f"Personal workout-position capacity factor: {adjustment.get('factor')} "
                f"from {adjustment.get('samples')} historical observations"
            )

        parts.append(
            "Explain why in one complete sentence of at most 18 words, referring to "
            "what they did last session. Do not suggest different numbers."
        )
        return "\n".join(parts)

    @staticmethod
    def _describe_reps(reps) -> str:
        """Render last session's reps the way a person would say them."""
        values = [int(r) for r in (reps or []) if r]
        if not values:
            return ""
        if len(set(values)) == 1:
            return f"{values[0]} on every set"
        return "/".join(str(v) for v in values)

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
                if ctx.get("estimated_from_related_exercises"):
                    return (
                        f"Your related {exercise_name} training suggests {weight:g} lbs as a "
                        "conservative calibration set. Do 6 controlled reps and use the difficulty "
                        "rating to adjust the remaining sets."
                    )
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
            low = (ctx.get("rep_range") or (None, None))[0]
            streak = ctx.get("earned_by_streak")
            opening = (
                f"Two sessions running at the top of your range at {prev:g} lbs — that's earned."
                if streak
                else f"You swept the top of your rep range at {prev:g} lbs."
            )
            tail = f" Back down to {low} reps to start the new range." if low else " Resetting reps."
            return f"{opening} Moving up to {new:g} lbs.{tail}"

        if decision == Decision.INCREASE_REPS:
            weight = ctx.get("weight", 0)
            aim = ctx.get("aim")
            band = ctx.get("band")
            prev_reps = ctx.get("prev_reps") or []
            reason = ctx.get("reason")

            if reason == "close_out_band" and aim:
                return (
                    f"You were a rep short of a clean sweep at {weight:g} lbs. "
                    f"Get {aim} on every set today and the weight goes up."
                )
            if reason == "advance_in_band" and aim:
                did = self._describe_reps(prev_reps)
                did_bit = f"Last time you got {did} at {weight:g} lbs. " if did else ""
                band_bit = f" Anything in the {band} range counts." if band else ""
                return f"{did_bit}Same weight, aim {aim} across all sets.{band_bit}"
            if reason == "retry_after_failure" and aim:
                return (
                    f"Reps slipped last session. Staying at {weight:g} lbs "
                    f"and going for {aim} again before changing anything."
                )
            if weight:
                return (
                    f"Holding {weight:g} lbs and working further into your rep range."
                )
            return "Holding the same weight and working further into your rep range."

        if decision == Decision.FILL_BAND:
            weight = ctx.get("weight", 0)
            low = (ctx.get("rep_range") or (None, None))[0]
            if low:
                return (
                    f"Some sets fell under {low} reps last time. "
                    f"Stay at {weight:g} lbs and get every set over {low} before adding weight."
                )
            return f"Stay at {weight:g} lbs and even out your sets before adding weight."

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

        if decision in CARDIO_DECISIONS:
            # The cardio engine already writes the "why" — it knows which
            # variable moved and why the other one didn't, which this cannot
            # reconstruct from the decision alone.
            guidance = ctx.get("guidance")
            if guidance:
                return guidance
            prev_time = ctx.get("prev_time")
            if prev_time:
                return f"Building on your last session ({prev_time} min)."
            return "Starting with a baseline cardio session."

        if decision == Decision.BODYWEIGHT_PROGRESS:
            return "Adding a rep per set for progressive bodyweight overload."

        return "Continuing with your current progression."
