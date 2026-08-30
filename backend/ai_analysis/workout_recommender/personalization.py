"""Learn conservative user-specific adjustments from completed workout data."""

from statistics import median
from typing import Any, Dict, List, Optional

from .exercise_metadata import resolve_exercise_metadata


def _best_e1rm(exercise: Dict[str, Any]) -> Optional[float]:
    values = []
    for item in exercise.get("sets") or []:
        try:
            weight, reps = float(item.get("weight") or 0), int(item.get("reps") or 0)
        except (TypeError, ValueError):
            continue
        if weight > 0 and 0 < reps <= 30:
            values.append(weight * (1 + reps / 30.0))
    return max(values) if values else None


def learn_position_factor(
    sessions: List[Dict[str, Any]],
    target_exercise_id: str,
    target_exercise_name: str,
    position_in_workout: Optional[int],
    exercise_records: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Estimate how this user performs later in a workout versus fresh."""
    if not position_in_workout or position_in_workout <= 0:
        return {"factor": 1.0, "source": "fresh_position", "samples": 0}

    target = resolve_exercise_metadata(
        target_exercise_id,
        target_exercise_name,
        (exercise_records or {}).get(target_exercise_id),
    )
    by_exercise: Dict[str, List[tuple]] = {}
    for session in sessions or []:
        for position, exercise in enumerate(session.get("exercises") or []):
            ex_id = str(exercise.get("exercise_id") or "")
            ex_name = str(exercise.get("exercise_name") or "")
            metadata = resolve_exercise_metadata(
                ex_id, ex_name, (exercise_records or {}).get(ex_id) or exercise
            )
            if metadata.muscle_group != target.muscle_group:
                continue
            performance = _best_e1rm(exercise)
            if performance:
                by_exercise.setdefault(ex_id or ex_name.lower(), []).append((position, performance))

    fresh, later = [], []
    for observations in by_exercise.values():
        baseline = median(value for _, value in observations)
        if baseline <= 0:
            continue
        for position, value in observations:
            (fresh if position == 0 else later).append(value / baseline)

    if len(fresh) < 2 or len(later) < 2:
        return {"factor": 1.0, "source": "insufficient_position_history", "samples": len(fresh) + len(later)}
    factor = max(0.75, min(1.0, median(later) / median(fresh)))
    return {
        "factor": round(factor, 3),
        "source": "personal_position_history",
        "samples": len(fresh) + len(later),
    }


def apply_position_factor(result, context: Dict[str, Any], increment: float):
    """Lower a later-position prescription using observed capacity; never raise it."""
    factor = float(context.get("factor") or 1.0)
    if factor >= 0.999 or not result.sets:
        return result
    step = increment if increment > 0 else 2.5
    for item in result.sets:
        if item.weight > 0:
            item.weight = max(step, round((item.weight * factor) / step) * step)
    context_values = dict(result.reasoning_context or {})
    for key in ("weight", "new_weight", "estimated_weight"):
        value = context_values.get(key)
        if isinstance(value, (int, float)) and value > 0:
            context_values[key] = max(step, round((value * factor) / step) * step)
    result.reasoning_context = {
        **context_values,
        "position_adjustment": context,
    }
    return result
