"""
CLI for recommender_v2 — uses sandbox workout fixtures (no GPT yet).

Usage (from sandbox/):
  python -m experiments.recommender_v2.run
  python -m experiments.recommender_v2.run default-legs-bb-back-squats
"""

from __future__ import annotations

import json
import sys

from data.load import exercise_history, load_workout_history

from .engine import recommend_next_session

DEFAULT_EXERCISE_ID = "default-chest-bb-bench-press"


def main() -> int:
    exercise_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_EXERCISE_ID
    history = load_workout_history()

    catalog = {ex.id: ex for ex in history.exercises}
    exercise = catalog.get(exercise_id)
    rows = exercise_history(history, exercise_id)

    if not rows:
        print(f"No history for exercise_id={exercise_id}", file=sys.stderr)
        return 1

    name = exercise.name if exercise else rows[0].get("exercise_name") or exercise_id
    payload = {
        "exercise": {
            "id": exercise_id,
            "name": name,
            "muscle_group": exercise.category.lower() if exercise else None,
        },
        "history": rows,
        "plan_context": {
            "target_sets": 3,
            "target_reps": 8,
            "notes": "Sandbox stub — replace with real plan targets later",
        },
        "profile": history.profile.model_dump(exclude_none=True),
    }

    result = recommend_next_session(payload)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
