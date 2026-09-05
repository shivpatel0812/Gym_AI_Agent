"""LLM-assisted, safety-bounded recommendation for the next set in a session."""

import json
import math
from typing import Any, Dict, List, Optional

from .exercise_metadata import resolve_exercise_metadata
from .session_fatigue import calculate_session_fatigue


class NextSetRecommender:
    """React to a completed set without letting the model make unsafe load jumps."""

    def __init__(self, client, model: str = "gpt-4o-mini"):
        self.client = client
        self.model = model

    def recommend(
        self,
        exercise_id: str,
        exercise_name: str,
        completed_sets: List[Dict[str, Any]],
        remaining_sets: List[Dict[str, Any]],
        current_workout_exercises: Optional[List[Dict[str, Any]]] = None,
        base_recommendation: Optional[Dict[str, Any]] = None,
        exercise_record: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
        learned_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if not completed_sets or not remaining_sets:
            return {"status": "complete", "reasoning": "All planned sets are complete."}

        last = completed_sets[-1]
        current_weight = float(last.get("weight") or 0)
        current_reps = int(last.get("reps") or 0)
        current_rpe = last.get("rpe")
        metadata = resolve_exercise_metadata(exercise_id, exercise_name, exercise_record)
        increment = float(metadata.min_increment_lb or 0)
        session_sets = [
            *(completed_sets or []),
            *(remaining_sets or []),
            *((base_recommendation or {}).get("sets") or []),
        ]
        weighted_bodyweight = (
            metadata.equipment == "Bodyweight"
            and any(self._number(item.get("weight"), 0) > 0 for item in session_sets)
        )

        fatigue = calculate_session_fatigue(
            exercise_id, exercise_name, current_workout_exercises
        )
        prompt = {
            "exercise": exercise_name,
            "completed_sets": completed_sets,
            "remaining_sets": remaining_sets,
            "base_recommendation": base_recommendation or {},
            "session_fatigue": fatigue,
            "equipment": (
                "Bodyweight with external added load"
                if weighted_bodyweight
                else metadata.equipment
            ),
            "load_mode": "weighted_bodyweight" if weighted_bodyweight else "standard",
            "compound": metadata.compound,
            "minimum_weight_increment_lb": increment,
            "personalized_outcomes": learned_context or {},
        }
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                {
                    "role": "system",
                    "content": (
                        "You are coaching one exercise set at a time. Recommend ONLY the next set. "
                        "Use completed reps, RPE, rep range, earlier exercises, and fatigue. Favor "
                        "progressive overload, but never sacrifice form. Do not prescribe failure: "
                        "target 1-2 reps in reserve. A load increase may be at most one available "
                        "equipment increment from the just-completed set. If RPE is 9-10 or reps "
                        "fell below the range, hold or reduce load. Never move a next-set target "
                        "outside base_recommendation.rep_range; that range is the active plan's "
                        "Heavy/Volume intent. For weighted bodyweight work, "
                        "positive weight is external added load; keep it explicit and never silently "
                        "switch the set to bodyweight-only. Return JSON with next_set "
                        "{weight, rep_low, rep_high, preferred_reps}, reasoning (one sentence), "
                        "and action: repeat|increase|backoff."
                    ),
                },
                {"role": "user", "content": json.dumps(prompt, default=str)},
                ],
                temperature=0.2,
                max_tokens=180,
                response_format={"type": "json_object"},
            )
            raw = json.loads(response.choices[0].message.content)
            tokens_used = response.usage.total_tokens if response.usage else None
            source = "openai"
        except Exception:
            raw = self._fallback(current_weight, current_reps, current_rpe, last, base_recommendation, fatigue)
            tokens_used = 0
            source = "deterministic_fallback"
        next_set = raw.get("next_set") or {}
        proposed_weight = self._number(next_set.get("weight"), current_weight)

        # Hard boundary: the model may add only one real equipment increment.
        max_weight = current_weight + increment if current_weight > 0 and increment > 0 else current_weight
        if current_weight > 0:
            proposed_weight = min(proposed_weight, max_weight)
            proposed_weight = max(proposed_weight, current_weight * 0.70)
        proposed_weight = self._round_to_increment(proposed_weight, increment)

        # Exhaustion and overlapping hard work can hold or lower a suggestion,
        # never promote it. This remains true even if model prose says otherwise.
        if self._is_hard(last) or fatigue["score"] >= 0.7:
            proposed_weight = min(proposed_weight, current_weight)
        if float((learned_context or {}).get("average_rep_error") or 0) <= -1.0:
            proposed_weight = min(proposed_weight, current_weight)

        default_reps = max(1, current_reps or 1)
        prescribed_range = (base_recommendation or {}).get("rep_range")
        if (
            isinstance(prescribed_range, (list, tuple))
            and len(prescribed_range) == 2
        ):
            plan_low = self._integer(prescribed_range[0], default_reps, 1, 30)
            plan_high = self._integer(prescribed_range[1], plan_low, plan_low, 30)
            low = self._integer(next_set.get("rep_low"), plan_low, plan_low, plan_high)
            high = self._integer(next_set.get("rep_high"), plan_high, low, plan_high)
        else:
            low = self._integer(next_set.get("rep_low"), default_reps, 1, 30)
            high = self._integer(next_set.get("rep_high"), max(low, default_reps), low, 30)
        preferred = self._integer(next_set.get("preferred_reps"), low, low, high)

        return {
            "status": "success",
            "next_set": {
                "set_number": int(remaining_sets[0].get("set_number") or len(completed_sets) + 1),
                "weight": proposed_weight,
                "reps": preferred,
                "rep_low": low,
                "rep_high": high,
                "preferred_reps": preferred,
                "completed": False,
            },
            "reasoning": str(raw.get("reasoning") or "Adjusting the next set from your latest result."),
            "action": raw.get("action") if raw.get("action") in {"repeat", "increase", "backoff"} else "repeat",
            "tokens_used": tokens_used,
            "source": source,
            "request_id": request_id,
            "fatigue_context": fatigue,
            "learned_context": learned_context or {},
        }

    def _fallback(self, weight, reps, rpe, last, base, fatigue):
        rep_range = (base or {}).get("rep_range") or [max(1, reps), max(1, reps + 2)]
        low, high = int(rep_range[0]), int(rep_range[1])
        hard = self._is_hard(last) or fatigue["score"] >= 0.7
        failed = str(last.get("difficulty") or "").lower() == "failed" or reps < low
        if failed:
            next_weight = weight * 0.9
            action = "backoff"
            reason = "That set fell below the working range, so reduce the load and rebuild with clean reps."
        elif hard:
            next_weight = weight
            action = "repeat"
            reason = "That was a hard set, so hold the load and stay inside the target range."
        else:
            next_weight = weight
            action = "repeat"
            reason = "Repeat the load and add a clean rep if you can while leaving 1-2 reps in reserve."
        return {
            "next_set": {"weight": next_weight, "rep_low": low, "rep_high": high, "preferred_reps": min(high, max(low, reps + (0 if hard else 1)))},
            "reasoning": reason,
            "action": action,
        }

    @staticmethod
    def _is_hard(set_data: Dict[str, Any]) -> bool:
        difficulty = str(set_data.get("difficulty") or "").lower()
        if difficulty in {"hard", "failed"}:
            return True
        try:
            return float(set_data.get("rpe")) >= 9
        except (TypeError, ValueError):
            return False

    @staticmethod
    def _number(value: Any, fallback: float) -> float:
        try:
            number = float(value)
            return number if math.isfinite(number) and number >= 0 else fallback
        except (TypeError, ValueError):
            return fallback

    @staticmethod
    def _integer(value: Any, fallback: int, low: int, high: int) -> int:
        try:
            number = int(value)
        except (TypeError, ValueError):
            number = fallback
        return max(low, min(high, number))

    @staticmethod
    def _round_to_increment(weight: float, increment: float) -> float:
        if increment <= 0:
            return round(weight, 2)
        return round(round(weight / increment) * increment, 2)
