"""Conservative first-session weight estimates derived from a user's top lifts."""

from typing import Any, Dict, Optional
import math

from .exercise_metadata import resolve_exercise_metadata


TOP_LIFT_TO_BENCH_EQUIVALENT = {
    "bench_press": 1.0,
    "squat": 1.4,
    "deadlift": 1.8,
    "overhead_press": 0.60,
    "barbell_row": 0.82,
}


def _representative_weight(raw: Any) -> Optional[float]:
    """Normalize any representative set to roughly a five-rep working weight."""
    if isinstance(raw, (int, float)):
        return float(raw) if 0 < raw <= 1000 else None
    if not isinstance(raw, dict):
        return None
    weight = raw.get("weight")
    reps = raw.get("reps")
    if not isinstance(weight, (int, float)) or not 0 < weight <= 1000:
        return None
    if not isinstance(reps, (int, float)) or not 1 <= reps <= 50:
        return float(weight)
    # Epley-based normalization. Cap at 15 reps because higher-rep strength
    # estimates become too noisy; this remains context, never a claimed 1RM.
    normalized_reps = min(float(reps), 15.0)
    return float(weight) * (1 + normalized_reps / 30.0) / (1 + 5.0 / 30.0)


def _bench_equivalent(top_lifts: Dict[str, Any]) -> Optional[float]:
    """Average representative sets after normalizing to a bench equivalent."""
    estimates = []
    for lift, ratio in TOP_LIFT_TO_BENCH_EQUIVALENT.items():
        representative = _representative_weight(top_lifts.get(lift))
        if representative is not None:
            estimates.append(representative / ratio)
    return sum(estimates) / len(estimates) if estimates else None


def _exercise_ratio(exercise_id: str, exercise_name: str) -> Optional[float]:
    """Estimate an exercise's working load relative to a barbell bench press."""
    name = exercise_name.lower()
    metadata = resolve_exercise_metadata(exercise_id, exercise_name)

    if metadata.muscle_group == "cardio" or metadata.equipment == "Bodyweight":
        return None

    if "deadlift" in name:
        return 1.8 if metadata.equipment == "Barbell" else 0.75
    if "leg press" in name:
        return 2.0
    if "squat" in name:
        if metadata.equipment == "Barbell":
            return 1.4
        if metadata.equipment == "Dumbbell":
            return 0.32
        return 1.15
    if "hip thrust" in name or "glute bridge" in name:
        return 1.15 if metadata.equipment == "Barbell" else 0.42
    if (
        "bench" in name
        or "chest press" in name
        or (("incline" in name or "decline" in name) and "press" in name)
    ):
        if metadata.equipment == "Dumbbell":
            return 0.35
        if metadata.equipment == "Machine":
            return 0.75
        return 1.0
    if "overhead" in name or "shoulder press" in name or "military" in name:
        return 0.28 if metadata.equipment == "Dumbbell" else 0.60
    if "row" in name:
        return 0.35 if metadata.equipment == "Dumbbell" else 0.82
    if "pulldown" in name or "pull-down" in name:
        return 0.65

    group_ratios = {
        "chest": 0.18 if not metadata.compound else 0.65,
        "shoulders": 0.11 if not metadata.compound else 0.50,
        "back": 0.30 if not metadata.compound else 0.65,
        "legs": 0.35 if not metadata.compound else 1.0,
        "glutes": 0.30 if not metadata.compound else 0.85,
        "biceps": 0.18,
        "triceps": 0.27,
        "calves": 0.40,
        "core": 0.20,
    }
    return group_ratios.get(metadata.muscle_group)


def estimate_starting_weight(
    exercise_id: str,
    exercise_name: str,
    top_lifts: Optional[Dict[str, Any]],
    conservative_factor: float = 0.875,
) -> Optional[float]:
    """
    Estimate a first-session working weight and round it to a valid 5 lb step.

    Estimates are intentionally medium-confidence suggestions. They are only
    used when no exercise-specific history exists.
    """
    if not top_lifts:
        return None

    bench_equivalent = _bench_equivalent(top_lifts)
    ratio = _exercise_ratio(exercise_id, exercise_name)
    if bench_equivalent is None or ratio is None:
        return None

    estimate = bench_equivalent * ratio * conservative_factor
    if estimate <= 0:
        return None
    return max(5.0, math.floor(estimate / 5.0 + 0.5) * 5.0)
