"""
Workout data shapes mirroring web-app/src/types/index.ts.

These are sandbox-only models for fixtures and future GPT payloads.
Do not import this package from backend/.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field


Difficulty = Literal["easy", "solid", "grind", "failed"]


class WorkoutSet(BaseModel):
    set_number: int
    reps: int
    weight: Optional[float] = None
    rpe: Optional[float] = None
    rir: Optional[float] = None
    completed: Optional[bool] = True
    form_quality: Optional[str] = None
    notes: Optional[str] = None
    difficulty: Optional[Difficulty] = None


class SessionExercise(BaseModel):
    exercise_id: str
    exercise_name: str
    sets: Optional[Union[int, list[WorkoutSet]]] = None
    # Legacy flat fields (prefer sets: WorkoutSet[])
    reps: Optional[int] = None
    weight: Optional[float] = None
    # Cardio
    time: Optional[float] = None
    speed: Optional[float] = None
    notes: Optional[str] = None
    is_custom: Optional[bool] = None


class WorkoutSession(BaseModel):
    id: Optional[str] = None
    date: str  # YYYY-MM-DD
    workout_name: Optional[str] = None
    split_id: Optional[str] = None
    split_name: Optional[str] = None
    split_day: Optional[str] = None
    exercises: list[SessionExercise] = Field(default_factory=list)
    notes: Optional[str] = None


class Split(BaseModel):
    id: Optional[str] = None
    name: str
    days: list[str] = Field(default_factory=list)


class TopLiftEntry(BaseModel):
    weight: float
    reps: Optional[int] = None


class TopLifts(BaseModel):
    bench_press: Optional[TopLiftEntry] = None
    squat: Optional[TopLiftEntry] = None
    deadlift: Optional[TopLiftEntry] = None
    overhead_press: Optional[TopLiftEntry] = None
    barbell_row: Optional[TopLiftEntry] = None


class UserProfileSnapshot(BaseModel):
    """Fitness-related profile fields used by AI / plan generation."""

    primary_goal: Optional[str] = None
    experience_level: Optional[str] = None
    preferred_workout_frequency: Optional[str] = None
    preferred_session_length: Optional[str] = None
    available_equipment: list[str] = Field(default_factory=list)
    preferred_workout_days: list[str] = Field(default_factory=list)
    top_lifts: Optional[TopLifts] = None


class CatalogExercise(BaseModel):
    id: str
    name: str
    category: str
    equipment: str


class WorkoutHistory(BaseModel):
    """
    Canonical sandbox payload: everything you'd eventually feed into GPT.
    Mirrors how the frontend stores profile + split + logged sessions.
    """

    profile: UserProfileSnapshot
    split: Optional[Split] = None
    sessions: list[WorkoutSession] = Field(default_factory=list)
    # Optional subset of the exercise catalog for reference
    exercises: list[CatalogExercise] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)
