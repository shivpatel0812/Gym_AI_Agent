"""
Starter experiment: deterministic progression from fixture data.

Pattern to follow:
  1. Put core logic in a pure module (engine.py) — easy to promote later
  2. Put I/O / CLI in run.py — stays in sandbox
  3. When ready, copy engine.py → backend/ai_analysis/... and wrap it
"""

from __future__ import annotations

from typing import Any


def recommend_next_session(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Pure function: fixture/API-shaped dict → recommendation dict.

    Promote-friendly: no filesystem, no OpenAI, no Firestore.
    Replace this stub with real logic as you iterate.
    """
    exercise = payload.get("exercise") or {}
    history = payload.get("history") or []
    plan = payload.get("plan_context") or {}

    if not history:
        return {
            "exercise_id": exercise.get("id"),
            "exercise_name": exercise.get("name"),
            "suggested_weight": None,
            "suggested_reps": plan.get("target_reps", 8),
            "suggested_sets": plan.get("target_sets", 3),
            "reasoning": "No history — start light and find a working weight.",
            "source": "sandbox_stub",
        }

    last_session = history[-1]
    sets = last_session.get("sets") or []
    top_set = max(sets, key=lambda s: (s.get("weight") or 0, s.get("reps") or 0))
    weight = float(top_set.get("weight") or 0)
    reps = int(top_set.get("reps") or 0)
    target_reps = int(plan.get("target_reps") or 8)

    # Naive double-progression stub: hit target reps → bump weight
    if reps >= target_reps:
        next_weight = weight + 5
        next_reps = target_reps
        reasoning = (
            f"Hit {reps} reps at {weight} lbs last session; "
            f"bump to {next_weight} lbs × {next_reps}."
        )
    else:
        next_weight = weight
        next_reps = reps + 1
        reasoning = (
            f"Missed target at {weight} lbs ({reps}/{target_reps}); "
            f"keep weight, aim for {next_reps} reps."
        )

    return {
        "exercise_id": exercise.get("id"),
        "exercise_name": exercise.get("name"),
        "suggested_weight": next_weight,
        "suggested_reps": next_reps,
        "suggested_sets": int(plan.get("target_sets") or 3),
        "reasoning": reasoning,
        "source": "sandbox_stub",
    }
