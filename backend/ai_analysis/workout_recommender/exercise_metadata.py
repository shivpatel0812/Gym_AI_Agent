"""
Per-exercise metadata for the deterministic progression engine.
Maps exercise IDs to their properties (compound/isolation, equipment, increments).
Unknown exercises fall back to DEFAULT_METADATA.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class ExerciseMetadata:
    """Metadata for a single exercise."""
    compound: bool
    muscle_group: str
    equipment: str  # "Barbell", "Dumbbell", "Cable", "Machine", "Bodyweight"
    min_increment_lb: float  # Minimum weight increment (0.0 for bodyweight)
    is_unilateral: bool = False  # True for single-arm/leg exercises


DEFAULT_METADATA = ExerciseMetadata(
    compound=False,
    muscle_group="unknown",
    equipment="Machine",
    min_increment_lb=5.0,
    is_unilateral=False,
)


# === Exercise Catalog ===
# Seeded from backend/data/default_exercises.py

EXERCISE_METADATA: dict[str, ExerciseMetadata] = {
    # CHEST - Dumbbell
    "default-chest-db-bench-press": ExerciseMetadata(compound=True, muscle_group="chest", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-db-incline-press": ExerciseMetadata(compound=True, muscle_group="chest", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-db-decline-press": ExerciseMetadata(compound=True, muscle_group="chest", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-db-flyes": ExerciseMetadata(compound=False, muscle_group="chest", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-db-incline-flyes": ExerciseMetadata(compound=False, muscle_group="chest", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-db-pullover": ExerciseMetadata(compound=False, muscle_group="chest", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    # CHEST - Barbell
    "default-chest-bb-bench-press": ExerciseMetadata(compound=True, muscle_group="chest", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-bb-incline-bench": ExerciseMetadata(compound=True, muscle_group="chest", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-bb-decline-bench": ExerciseMetadata(compound=True, muscle_group="chest", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-bb-close-grip": ExerciseMetadata(compound=True, muscle_group="chest", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    # CHEST - Cable
    "default-chest-cable-fly-mid": ExerciseMetadata(compound=False, muscle_group="chest", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-cable-fly-high-low": ExerciseMetadata(compound=False, muscle_group="chest", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-cable-fly-low-high": ExerciseMetadata(compound=False, muscle_group="chest", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-cable-single-arm": ExerciseMetadata(compound=False, muscle_group="chest", equipment="Cable", min_increment_lb=5.0, is_unilateral=True),
    # CHEST - Machine
    "default-chest-machine-press": ExerciseMetadata(compound=True, muscle_group="chest", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-machine-pec-deck": ExerciseMetadata(compound=False, muscle_group="chest", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    "default-chest-machine-hammer": ExerciseMetadata(compound=True, muscle_group="chest", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    # CHEST - Bodyweight
    "default-chest-bw-pushups": ExerciseMetadata(compound=True, muscle_group="chest", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),
    "default-chest-bw-decline-pushups": ExerciseMetadata(compound=True, muscle_group="chest", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),
    "default-chest-bw-dips": ExerciseMetadata(compound=True, muscle_group="chest", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),

    # SHOULDERS - Dumbbell
    "default-shoulders-db-press": ExerciseMetadata(compound=True, muscle_group="shoulders", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-shoulders-db-arnold": ExerciseMetadata(compound=True, muscle_group="shoulders", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-shoulders-db-lateral": ExerciseMetadata(compound=False, muscle_group="shoulders", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-shoulders-db-front": ExerciseMetadata(compound=False, muscle_group="shoulders", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-shoulders-db-rear-delt": ExerciseMetadata(compound=False, muscle_group="shoulders", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-shoulders-db-upright-row": ExerciseMetadata(compound=True, muscle_group="shoulders", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    # SHOULDERS - Barbell
    "default-shoulders-bb-press": ExerciseMetadata(compound=True, muscle_group="shoulders", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-shoulders-bb-push-press": ExerciseMetadata(compound=True, muscle_group="shoulders", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-shoulders-bb-upright-row": ExerciseMetadata(compound=True, muscle_group="shoulders", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    # SHOULDERS - Cable
    "default-shoulders-cable-lateral": ExerciseMetadata(compound=False, muscle_group="shoulders", equipment="Cable", min_increment_lb=5.0, is_unilateral=True),
    "default-shoulders-cable-front": ExerciseMetadata(compound=False, muscle_group="shoulders", equipment="Cable", min_increment_lb=5.0, is_unilateral=True),
    "default-shoulders-cable-rear-delt": ExerciseMetadata(compound=False, muscle_group="shoulders", equipment="Cable", min_increment_lb=5.0, is_unilateral=True),
    "default-shoulders-cable-face-pulls": ExerciseMetadata(compound=False, muscle_group="shoulders", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    # SHOULDERS - Machine
    "default-shoulders-machine-press": ExerciseMetadata(compound=True, muscle_group="shoulders", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    "default-shoulders-machine-lateral": ExerciseMetadata(compound=False, muscle_group="shoulders", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    "default-shoulders-machine-reverse-pec": ExerciseMetadata(compound=False, muscle_group="shoulders", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),

    # BICEPS - Dumbbell
    "default-biceps-db-curls": ExerciseMetadata(compound=False, muscle_group="biceps", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-biceps-db-alternating": ExerciseMetadata(compound=False, muscle_group="biceps", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=True),
    "default-biceps-db-hammer": ExerciseMetadata(compound=False, muscle_group="biceps", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-biceps-db-incline": ExerciseMetadata(compound=False, muscle_group="biceps", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-biceps-db-concentration": ExerciseMetadata(compound=False, muscle_group="biceps", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=True),
    # BICEPS - Barbell
    "default-biceps-bb-curls": ExerciseMetadata(compound=False, muscle_group="biceps", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-biceps-bb-ez-bar": ExerciseMetadata(compound=False, muscle_group="biceps", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-biceps-bb-preacher": ExerciseMetadata(compound=False, muscle_group="biceps", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    # BICEPS - Cable
    "default-biceps-cable-curls": ExerciseMetadata(compound=False, muscle_group="biceps", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-biceps-cable-rope-hammer": ExerciseMetadata(compound=False, muscle_group="biceps", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-biceps-cable-single-arm": ExerciseMetadata(compound=False, muscle_group="biceps", equipment="Cable", min_increment_lb=5.0, is_unilateral=True),
    # BICEPS - Machine
    "default-biceps-machine-curls": ExerciseMetadata(compound=False, muscle_group="biceps", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),

    # TRICEPS - Dumbbell
    "default-triceps-db-overhead": ExerciseMetadata(compound=False, muscle_group="triceps", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-triceps-db-skull": ExerciseMetadata(compound=False, muscle_group="triceps", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-triceps-db-kickbacks": ExerciseMetadata(compound=False, muscle_group="triceps", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=True),
    # TRICEPS - Barbell
    "default-triceps-bb-skull": ExerciseMetadata(compound=False, muscle_group="triceps", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-triceps-bb-close-grip": ExerciseMetadata(compound=True, muscle_group="triceps", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    # TRICEPS - Cable
    "default-triceps-cable-pushdowns": ExerciseMetadata(compound=False, muscle_group="triceps", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-triceps-cable-rope": ExerciseMetadata(compound=False, muscle_group="triceps", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-triceps-cable-overhead": ExerciseMetadata(compound=False, muscle_group="triceps", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-triceps-cable-single-arm": ExerciseMetadata(compound=False, muscle_group="triceps", equipment="Cable", min_increment_lb=5.0, is_unilateral=True),
    # TRICEPS - Machine
    "default-triceps-machine-extension": ExerciseMetadata(compound=False, muscle_group="triceps", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    "default-triceps-machine-assisted-dip": ExerciseMetadata(compound=True, muscle_group="triceps", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    # TRICEPS - Bodyweight
    "default-triceps-bw-bench-dips": ExerciseMetadata(compound=True, muscle_group="triceps", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),
    "default-triceps-bw-parallel-dips": ExerciseMetadata(compound=True, muscle_group="triceps", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),

    # BACK - Dumbbell
    "default-back-db-rows": ExerciseMetadata(compound=True, muscle_group="back", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-back-db-single-arm-rows": ExerciseMetadata(compound=True, muscle_group="back", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=True),
    "default-back-db-deadlifts": ExerciseMetadata(compound=True, muscle_group="back", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-back-db-shrugs": ExerciseMetadata(compound=False, muscle_group="back", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    # BACK - Barbell
    "default-back-bb-deadlifts": ExerciseMetadata(compound=True, muscle_group="back", equipment="Barbell", min_increment_lb=10.0, is_unilateral=False),
    "default-back-bb-bent-over-rows": ExerciseMetadata(compound=True, muscle_group="back", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-back-bb-pendlay-rows": ExerciseMetadata(compound=True, muscle_group="back", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-back-bb-shrugs": ExerciseMetadata(compound=False, muscle_group="back", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    # BACK - Cable
    "default-back-cable-lat-pulldown": ExerciseMetadata(compound=True, muscle_group="back", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-back-cable-seated-rows": ExerciseMetadata(compound=True, muscle_group="back", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-back-cable-straight-arm": ExerciseMetadata(compound=False, muscle_group="back", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-back-cable-single-arm-rows": ExerciseMetadata(compound=True, muscle_group="back", equipment="Cable", min_increment_lb=5.0, is_unilateral=True),
    # BACK - Machine
    "default-back-machine-assisted-pullup": ExerciseMetadata(compound=True, muscle_group="back", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    "default-back-machine-row": ExerciseMetadata(compound=True, muscle_group="back", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    "default-back-machine-hammer-row": ExerciseMetadata(compound=True, muscle_group="back", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    # BACK - Bodyweight
    "default-back-bw-pullups": ExerciseMetadata(compound=True, muscle_group="back", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),
    "default-back-bw-chinups": ExerciseMetadata(compound=True, muscle_group="back", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),
    "default-back-bw-inverted-rows": ExerciseMetadata(compound=True, muscle_group="back", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),

    # LEGS - Dumbbell
    "default-legs-db-goblet-squats": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-legs-db-lunges": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=True),
    "default-legs-db-step-ups": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=True),
    "default-legs-db-romanian-deadlift": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    # LEGS - Barbell
    "default-legs-bb-back-squats": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-legs-bb-front-squats": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-legs-bb-romanian-deadlift": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    "default-legs-bb-conventional-deadlift": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Barbell", min_increment_lb=10.0, is_unilateral=False),
    "default-legs-bb-good-mornings": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    # LEGS - Cable
    "default-legs-cable-squats": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-legs-cable-pull-throughs": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-legs-cable-lunges": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Cable", min_increment_lb=5.0, is_unilateral=True),
    # LEGS - Machine
    "default-legs-machine-leg-press": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Machine", min_increment_lb=10.0, is_unilateral=False),
    "default-legs-machine-hack-squat": ExerciseMetadata(compound=True, muscle_group="legs", equipment="Machine", min_increment_lb=10.0, is_unilateral=False),
    "default-legs-machine-leg-extension": ExerciseMetadata(compound=False, muscle_group="legs", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    "default-legs-machine-seated-leg-curl": ExerciseMetadata(compound=False, muscle_group="legs", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    "default-legs-machine-lying-leg-curl": ExerciseMetadata(compound=False, muscle_group="legs", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),

    # GLUTES - Dumbbell
    "default-glutes-db-hip-thrusts": ExerciseMetadata(compound=True, muscle_group="glutes", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-glutes-db-bulgarian-squats": ExerciseMetadata(compound=True, muscle_group="glutes", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=True),
    # GLUTES - Barbell
    "default-glutes-bb-hip-thrusts": ExerciseMetadata(compound=True, muscle_group="glutes", equipment="Barbell", min_increment_lb=10.0, is_unilateral=False),
    "default-glutes-bb-glute-bridges": ExerciseMetadata(compound=True, muscle_group="glutes", equipment="Barbell", min_increment_lb=10.0, is_unilateral=False),
    "default-glutes-bb-sumo-deadlifts": ExerciseMetadata(compound=True, muscle_group="glutes", equipment="Barbell", min_increment_lb=10.0, is_unilateral=False),
    # GLUTES - Cable
    "default-glutes-cable-kickbacks": ExerciseMetadata(compound=False, muscle_group="glutes", equipment="Cable", min_increment_lb=5.0, is_unilateral=True),
    "default-glutes-cable-pull-throughs": ExerciseMetadata(compound=True, muscle_group="glutes", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    # GLUTES - Machine
    "default-glutes-machine-hip-abduction": ExerciseMetadata(compound=False, muscle_group="glutes", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    "default-glutes-machine-kickback": ExerciseMetadata(compound=False, muscle_group="glutes", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),

    # CALVES - Dumbbell
    "default-calves-db-standing": ExerciseMetadata(compound=False, muscle_group="calves", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-calves-db-seated": ExerciseMetadata(compound=False, muscle_group="calves", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    # CALVES - Barbell
    "default-calves-bb-standing": ExerciseMetadata(compound=False, muscle_group="calves", equipment="Barbell", min_increment_lb=5.0, is_unilateral=False),
    # CALVES - Machine
    "default-calves-machine-seated": ExerciseMetadata(compound=False, muscle_group="calves", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    "default-calves-machine-standing": ExerciseMetadata(compound=False, muscle_group="calves", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),
    "default-calves-machine-leg-press": ExerciseMetadata(compound=False, muscle_group="calves", equipment="Machine", min_increment_lb=5.0, is_unilateral=False),

    # CORE / ABS - Bodyweight
    "default-core-bw-planks": ExerciseMetadata(compound=True, muscle_group="core", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),
    "default-core-bw-side-planks": ExerciseMetadata(compound=False, muscle_group="core", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=True),
    "default-core-bw-crunches": ExerciseMetadata(compound=False, muscle_group="core", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),
    "default-core-bw-leg-raises": ExerciseMetadata(compound=False, muscle_group="core", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),
    "default-core-bw-hanging-knee": ExerciseMetadata(compound=False, muscle_group="core", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),
    # CORE - Cable
    "default-core-cable-crunches": ExerciseMetadata(compound=False, muscle_group="core", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    "default-core-cable-woodchoppers": ExerciseMetadata(compound=True, muscle_group="core", equipment="Cable", min_increment_lb=5.0, is_unilateral=True),
    "default-core-cable-pallof": ExerciseMetadata(compound=False, muscle_group="core", equipment="Cable", min_increment_lb=5.0, is_unilateral=False),
    # CORE - Weighted
    "default-core-weighted-sit-ups": ExerciseMetadata(compound=False, muscle_group="core", equipment="Dumbbell", min_increment_lb=5.0, is_unilateral=False),
    "default-core-weighted-ab-rollouts": ExerciseMetadata(compound=True, muscle_group="core", equipment="Bodyweight", min_increment_lb=0.0, is_unilateral=False),

    # CARDIO
    "default-cardio-incline-walk": ExerciseMetadata(compound=False, muscle_group="cardio", equipment="Treadmill", min_increment_lb=0.0, is_unilateral=False),
    "default-cardio-run": ExerciseMetadata(compound=False, muscle_group="cardio", equipment="Treadmill", min_increment_lb=0.0, is_unilateral=False),
    "default-cardio-normal-walk": ExerciseMetadata(compound=False, muscle_group="cardio", equipment="Treadmill", min_increment_lb=0.0, is_unilateral=False),
}


def get_exercise_metadata(exercise_id: str) -> ExerciseMetadata:
    """
    Get metadata for an exercise by ID.
    Returns DEFAULT_METADATA for unknown exercises.
    """
    return EXERCISE_METADATA.get(exercise_id, DEFAULT_METADATA)


def get_increment(exercise_id: str) -> float:
    """Get the minimum weight increment for an exercise."""
    return get_exercise_metadata(exercise_id).min_increment_lb


def is_cardio(exercise_id: str) -> bool:
    """Check if an exercise is a cardio exercise."""
    return get_exercise_metadata(exercise_id).muscle_group == "cardio"


def is_bodyweight(exercise_id: str) -> bool:
    """Check if an exercise is bodyweight-only (no external load progression)."""
    return get_exercise_metadata(exercise_id).min_increment_lb == 0.0
