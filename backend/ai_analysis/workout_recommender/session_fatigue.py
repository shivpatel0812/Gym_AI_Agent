"""Structured within-session fatigue estimation based on exercise metadata."""

from typing import Any, Dict, List, Optional

from .exercise_metadata import resolve_exercise_metadata


SECONDARY_OVERLAP = {
    "chest": {"shoulders", "triceps"},
    "shoulders": {"chest", "triceps"},
    "triceps": {"chest", "shoulders"},
    "back": {"biceps"},
    "biceps": {"back"},
    "legs": {"glutes", "calves"},
    "glutes": {"legs"},
    "calves": {"legs"},
}


def set_effort(set_data: Dict[str, Any]) -> float:
    """Return a 0..1 effort estimate from explicit feedback or RPE."""
    feedback = str(set_data.get("difficulty") or "").lower()
    if feedback == "failed":
        return 1.0
    if feedback == "hard":
        return 0.9
    if feedback == "good":
        return 0.72
    if feedback == "easy":
        return 0.5
    try:
        rpe = float(set_data.get("rpe"))
        return max(0.4, min(1.0, rpe / 10.0))
    except (TypeError, ValueError):
        return 0.65


def calculate_session_fatigue(
    exercise_id: str,
    exercise_name: str,
    prior_exercises: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """Estimate local fatigue; only explicitly completed sets contribute."""
    target = resolve_exercise_metadata(exercise_id, exercise_name)
    weighted_sets = 0.0
    contributors = []
    for exercise in prior_exercises or []:
        source = resolve_exercise_metadata(
            str(exercise.get("exercise_id") or ""),
            str(exercise.get("exercise_name") or ""),
            exercise,
        )
        if source.muscle_group == target.muscle_group and target.muscle_group != "unknown":
            overlap = 1.0
        elif source.muscle_group in SECONDARY_OVERLAP.get(target.muscle_group, set()):
            overlap = 0.35 if source.compound else 0.2
        else:
            overlap = 0.0
        if overlap == 0:
            continue
        completed = [s for s in exercise.get("sets") or [] if s.get("completed") is True]
        contribution = sum(set_effort(s) * overlap for s in completed)
        if contribution:
            weighted_sets += contribution
            contributors.append({
                "exercise": exercise.get("exercise_name"),
                "completed_sets": len(completed),
                "overlap": overlap,
            })

    # About four hard, directly overlapping sets produce a meaningful but not
    # catastrophic fatigue score. Personalized factors can replace this later.
    score = min(1.0, weighted_sets / 4.0)
    return {
        "score": round(score, 3),
        "level": "high" if score >= 0.7 else "moderate" if score >= 0.35 else "low",
        "weighted_hard_sets": round(weighted_sets, 2),
        "contributors": contributors,
    }
