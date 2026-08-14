"""Load and query sandbox workout fixtures."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from .models import SessionExercise, WorkoutHistory, WorkoutSession, WorkoutSet

SANDBOX_ROOT = Path(__file__).resolve().parents[1]
FIXTURES_DIR = SANDBOX_ROOT / "fixtures"
DEFAULT_HISTORY = FIXTURES_DIR / "workout_history.json"


def load_workout_history(path: Optional[Path | str] = None) -> WorkoutHistory:
    """Load and validate a WorkoutHistory fixture."""
    fixture_path = Path(path) if path else DEFAULT_HISTORY
    raw = json.loads(fixture_path.read_text())
    return WorkoutHistory.model_validate(raw)


def sessions_sorted(history: WorkoutHistory, *, reverse: bool = False) -> list[WorkoutSession]:
    return sorted(history.sessions, key=lambda s: s.date, reverse=reverse)


def exercise_history(
    history: WorkoutHistory,
    exercise_id: str,
) -> list[dict[str, Any]]:
    """
    Collapse full sessions into per-exercise history (newest last).

    Shape is handy for future GPT / recommender experiments:
      [{ date, split_day, sets: WorkoutSet[], notes? }, ...]
    """
    out: list[dict[str, Any]] = []
    for session in sessions_sorted(history):
        for ex in session.exercises:
            if ex.exercise_id != exercise_id:
                continue
            sets = _normalize_sets(ex)
            entry: dict[str, Any] = {
                "date": session.date,
                "split_day": session.split_day,
                "sets": [s.model_dump(exclude_none=True) for s in sets],
            }
            if ex.notes:
                entry["notes"] = ex.notes
            if ex.time is not None:
                entry["time"] = ex.time
            if ex.speed is not None:
                entry["speed"] = ex.speed
            out.append(entry)
    return out


def summarize(history: WorkoutHistory) -> dict[str, Any]:
    """Human-readable summary — no GPT, just structure checks."""
    exercise_counts: dict[str, int] = {}
    for session in history.sessions:
        for ex in session.exercises:
            exercise_counts[ex.exercise_name] = exercise_counts.get(ex.exercise_name, 0) + 1

    dates = [s.date for s in history.sessions]
    return {
        "goal": history.profile.primary_goal,
        "experience": history.profile.experience_level,
        "split": history.split.name if history.split else None,
        "split_days": history.split.days if history.split else [],
        "session_count": len(history.sessions),
        "date_range": {"from": min(dates), "to": max(dates)} if dates else None,
        "unique_exercises": len(exercise_counts),
        "top_exercises": sorted(exercise_counts.items(), key=lambda x: -x[1])[:8],
        "equipment": history.profile.available_equipment,
        "top_lifts": (
            history.profile.top_lifts.model_dump(exclude_none=True)
            if history.profile.top_lifts
            else None
        ),
    }


def _normalize_sets(ex: SessionExercise) -> list[WorkoutSet]:
    if isinstance(ex.sets, list):
        return ex.sets
    # Legacy scalar shape — synthesize one set if flat fields exist
    if ex.sets is not None and ex.reps is not None:
        return [
            WorkoutSet(
                set_number=1,
                reps=ex.reps,
                weight=ex.weight,
            )
        ]
    return []
