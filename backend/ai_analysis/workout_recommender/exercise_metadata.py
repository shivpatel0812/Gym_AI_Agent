"""
Per-exercise metadata for the deterministic progression engine.
Maps exercise IDs to their properties (compound/isolation, equipment, increments).

Resolution order for unknown exercise IDs:
1. EXERCISE_METADATA lookup (seeded catalog)
2. User-provided exercise record (muscle_group, type fields from Exercise model)
3. Name-keyword inference (squat/press → compound, curl/fly → isolation, etc.)
4. DEFAULT_METADATA (conservative fallback: isolation, Machine, 5lb)
"""

from dataclasses import dataclass
from typing import Optional, Dict
import re


@dataclass(frozen=True)
class ExerciseMetadata:
    """Metadata for a single exercise."""
    compound: bool
    muscle_group: str
    equipment: str  # "Barbell", "Dumbbell", "Cable", "Machine", "Bodyweight"
    min_increment_lb: float  # Minimum weight increment (0.0 for bodyweight)
    is_unilateral: bool = False  # True for single-arm/leg exercises


# Every catalog cardio id shares this prefix.
CARDIO_ID_PREFIX = "default-cardio"

CARDIO_METADATA = ExerciseMetadata(
    compound=False,
    muscle_group="cardio",
    equipment="Treadmill",
    min_increment_lb=0.0,
    is_unilateral=False,
)

DEFAULT_METADATA = ExerciseMetadata(
    compound=False,
    muscle_group="unknown",
    equipment="Machine",
    min_increment_lb=5.0,
    is_unilateral=False,
)


# === Name-keyword inference patterns ===
# Note: patterns use \w* after the keyword to handle plurals (e.g., "squats", "curls")

# Keywords that indicate a compound movement
_COMPOUND_KEYWORDS = re.compile(
    r"\b(squats?|press(?:es)?|deadlifts?|rows?|pull[\s\-]?ups?|chin[\s\-]?ups?|dips?|"
    r"lunges?|thrusts?|cleans?|snatch(?:es)?|bench|overhead|push[\s\-]?press|"
    r"good[\s\-]?mornings?|step[\s\-]?ups?)\b",
    re.IGNORECASE,
)

# Keywords that indicate an isolation movement
_ISOLATION_KEYWORDS = re.compile(
    r"\b(curls?|fl(?:y|ye)s?|raises?|extensions?|kickbacks?|pullovers?|shrugs?|"
    r"laterals?|front[\s\-]?raises?|rear[\s\-]?delt|pushdowns?|crunches?|planks?)\b",
    re.IGNORECASE,
)

# Equipment inference from exercise name
_EQUIPMENT_PATTERNS = {
    "Dumbbell": re.compile(r"\b(dumbbells?|db)\b", re.IGNORECASE),
    "Barbell": re.compile(r"\b(barbells?|bb|ez[\s\-]?bar)\b", re.IGNORECASE),
    "Cable": re.compile(r"\b(cables?)\b", re.IGNORECASE),
    "Bodyweight": re.compile(r"\b(bodyweight|bw)\b|push[\s\-]?ups?|pull[\s\-]?ups?|chin[\s\-]?ups?|dips?\b", re.IGNORECASE),
    "Machine": re.compile(r"\b(machines?|smith|hammer[\s\-]?strength|leg[\s\-]?press|hack)\b", re.IGNORECASE),
}

# Muscle group inference from exercise name
# Order matters: more specific patterns first to avoid "press" matching shoulders
# when it should be chest (bench press)
_MUSCLE_GROUP_PATTERNS = {
    "chest": re.compile(r"\b(bench|chest|pec)\b|push[\s\-]?ups?|fl(?:y|ye)s?\b", re.IGNORECASE),
    "back": re.compile(r"\b(rows?|deadlifts?|lat|pulldowns?|back)\b|pull[\s\-]?ups?|chin[\s\-]?ups?", re.IGNORECASE),
    "legs": re.compile(r"\b(squats?|lunges?|leg|quad|hamstring|calves?|calf|step[\s\-]?ups?)\b", re.IGNORECASE),
    "glutes": re.compile(r"\b(glutes?|hip[\s\-]?thrusts?|bridges?|sumo|bulgarian)\b", re.IGNORECASE),
    "biceps": re.compile(r"\b(biceps?|curls?|hammer)\b", re.IGNORECASE),
    "triceps": re.compile(r"\b(triceps?|pushdowns?|skull|kickbacks?|extensions?)\b", re.IGNORECASE),
    "shoulders": re.compile(r"\b(shoulders?|overhead|lateral[\s\-]?raises?|rear[\s\-]?delt|arnold|face[\s\-]?pulls?|military)\b", re.IGNORECASE),
    "core": re.compile(r"\b(core|abs?|crunches?|planks?|sit[\s\-]?ups?)\b", re.IGNORECASE),
}

# Map user-facing muscle group strings to canonical names
_MUSCLE_GROUP_ALIASES = {
    "CHEST": "chest",
    "BACK": "back",
    "SHOULDERS": "shoulders",
    "LEGS": "legs",
    "BICEPS": "biceps",
    "TRICEPS": "triceps",
    "CORE / ABS": "core",
    "CORE": "core",
    "ABS": "core",
    "GLUTES": "glutes",
    "CALVES": "calves",
    "CARDIO": "cardio",
}

# Map Exercise.type (WorkoutType) to equipment defaults
_TYPE_TO_EQUIPMENT = {
    "cardio": "Treadmill",
    "strength": "Machine",  # Conservative default for strength
    "custom": "Machine",
}


def _infer_compound_from_name(name: str) -> Optional[bool]:
    """Infer compound/isolation from exercise name keywords."""
    if _COMPOUND_KEYWORDS.search(name):
        return True
    if _ISOLATION_KEYWORDS.search(name):
        return False
    return None


def _infer_equipment_from_name(name: str) -> Optional[str]:
    """Infer equipment type from exercise name keywords."""
    for equipment, pattern in _EQUIPMENT_PATTERNS.items():
        if pattern.search(name):
            return equipment
    return None


def _infer_muscle_group_from_name(name: str) -> Optional[str]:
    """Infer muscle group from exercise name keywords."""
    for group, pattern in _MUSCLE_GROUP_PATTERNS.items():
        if pattern.search(name):
            return group
    return None


def _resolve_muscle_group(raw: Optional[str]) -> str:
    """Resolve a raw muscle_group string to a canonical name."""
    if not raw:
        return "unknown"
    return _MUSCLE_GROUP_ALIASES.get(raw.upper(), raw.lower())


def _increment_for_equipment(equipment: str) -> float:
    """Get default increment for an equipment type."""
    if equipment in ("Bodyweight", "Treadmill"):
        return 0.0
    return 5.0


def resolve_exercise_metadata(
    exercise_id: str,
    exercise_name: str = "",
    exercise_record: Optional[Dict] = None,
) -> ExerciseMetadata:
    """
    Resolve metadata for any exercise, custom or default.

    Resolution order:
    1. Seeded EXERCISE_METADATA catalog (by ID)
    2. User's exercise record fields (muscle_group, type)
    3. Name-keyword inference
    4. DEFAULT_METADATA

    Args:
        exercise_id: The exercise ID (may be a Firestore doc ID for custom exercises)
        exercise_name: The display name of the exercise
        exercise_record: Optional dict with the user's Exercise model fields
            (muscle_group, type, name, is_custom)

    Returns:
        ExerciseMetadata with best-effort resolution
    """
    # 1. Check seeded catalog first
    if exercise_id in EXERCISE_METADATA:
        return EXERCISE_METADATA[exercise_id]

    # 1b. The catalog namespaces cardio by id, and the eleven sport entries
    # (default-cardio-sport-*) were never seeded individually. Without this
    # they resolved to DEFAULT_METADATA — a 5 lb-increment machine exercise —
    # so a logged basketball game was routed through the lifting progression
    # and came back asking for a starting weight.
    if str(exercise_id or "").startswith(CARDIO_ID_PREFIX):
        return CARDIO_METADATA

    # 2. Try to build from exercise record + name inference
    record = exercise_record or {}
    name = exercise_name or record.get("name", "")

    # Resolve compound/isolation
    compound = _infer_compound_from_name(name)
    if compound is None:
        # Default to isolation (conservative — uses wider rep range)
        compound = False

    # Resolve muscle group
    raw_muscle_group = record.get("muscle_group")
    if raw_muscle_group:
        muscle_group = _resolve_muscle_group(raw_muscle_group)
    else:
        muscle_group = _infer_muscle_group_from_name(name) or "unknown"

    # Resolve equipment
    equipment = _infer_equipment_from_name(name)
    if not equipment:
        exercise_type = record.get("type", "strength")
        equipment = _TYPE_TO_EQUIPMENT.get(exercise_type, "Machine")

    # Resolve increment
    min_increment = _increment_for_equipment(equipment)

    # Check for cardio
    if muscle_group == "cardio" or record.get("type") == "cardio":
        return ExerciseMetadata(
            compound=False,
            muscle_group="cardio",
            equipment="Treadmill",
            min_increment_lb=0.0,
            is_unilateral=False,
        )

    return ExerciseMetadata(
        compound=compound,
        muscle_group=muscle_group,
        equipment=equipment,
        min_increment_lb=min_increment,
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
    Get metadata for an exercise by ID (catalog-only lookup).
    Returns DEFAULT_METADATA for unknown exercises.
    For custom exercises, use resolve_exercise_metadata() instead.
    """
    return EXERCISE_METADATA.get(exercise_id, DEFAULT_METADATA)


def get_increment(exercise_id: str) -> float:
    """Get the minimum weight increment for an exercise."""
    return get_exercise_metadata(exercise_id).min_increment_lb


def is_cardio(exercise_id: str, exercise_name: str = "", exercise_record: Optional[Dict] = None) -> bool:
    """Check if an exercise is a cardio exercise."""
    meta = resolve_exercise_metadata(exercise_id, exercise_name, exercise_record)
    return meta.muscle_group == "cardio"


def is_bodyweight(exercise_id: str, exercise_name: str = "", exercise_record: Optional[Dict] = None) -> bool:
    """Check if an exercise is bodyweight-only (no external load progression)."""
    meta = resolve_exercise_metadata(exercise_id, exercise_name, exercise_record)
    return meta.min_increment_lb == 0.0
