"""
Backend copy of the default exercise catalog.
Mirrors web-app/src/data/defaultExercises.ts so the AI plan generator
can reference real exercise IDs.
"""

DEFAULT_EXERCISES = [
    # CHEST
    {"id": "default-chest-db-bench-press", "name": "Dumbbell Bench Press", "category": "CHEST", "equipment": "Dumbbell"},
    {"id": "default-chest-db-incline-press", "name": "Incline Dumbbell Press", "category": "CHEST", "equipment": "Dumbbell"},
    {"id": "default-chest-db-decline-press", "name": "Decline Dumbbell Press", "category": "CHEST", "equipment": "Dumbbell"},
    {"id": "default-chest-db-flyes", "name": "Dumbbell Flyes", "category": "CHEST", "equipment": "Dumbbell"},
    {"id": "default-chest-db-incline-flyes", "name": "Incline Dumbbell Flyes", "category": "CHEST", "equipment": "Dumbbell"},
    {"id": "default-chest-db-pullover", "name": "Dumbbell Pullover", "category": "CHEST", "equipment": "Dumbbell"},
    {"id": "default-chest-bb-bench-press", "name": "Barbell Bench Press", "category": "CHEST", "equipment": "Barbell"},
    {"id": "default-chest-bb-incline-bench", "name": "Incline Barbell Bench", "category": "CHEST", "equipment": "Barbell"},
    {"id": "default-chest-bb-decline-bench", "name": "Decline Barbell Bench", "category": "CHEST", "equipment": "Barbell"},
    {"id": "default-chest-bb-close-grip", "name": "Close-Grip Bench Press", "category": "CHEST", "equipment": "Barbell"},
    {"id": "default-chest-cable-fly-mid", "name": "Cable Chest Fly (Mid)", "category": "CHEST", "equipment": "Cable"},
    {"id": "default-chest-cable-fly-high-low", "name": "Cable Chest Fly (High to Low)", "category": "CHEST", "equipment": "Cable"},
    {"id": "default-chest-cable-fly-low-high", "name": "Cable Chest Fly (Low to High)", "category": "CHEST", "equipment": "Cable"},
    {"id": "default-chest-cable-single-arm", "name": "Single-Arm Cable Press", "category": "CHEST", "equipment": "Cable"},
    {"id": "default-chest-machine-press", "name": "Chest Press Machine", "category": "CHEST", "equipment": "Machine"},
    {"id": "default-chest-machine-pec-deck", "name": "Pec Deck", "category": "CHEST", "equipment": "Machine"},
    {"id": "default-chest-machine-hammer", "name": "Hammer Strength Chest Press", "category": "CHEST", "equipment": "Machine"},
    {"id": "default-chest-bw-pushups", "name": "Push-Ups", "category": "CHEST", "equipment": "Bodyweight"},
    {"id": "default-chest-bw-decline-pushups", "name": "Decline Push-Ups", "category": "CHEST", "equipment": "Bodyweight"},
    {"id": "default-chest-bw-dips", "name": "Chest Dips", "category": "CHEST", "equipment": "Bodyweight"},

    # SHOULDERS
    {"id": "default-shoulders-db-press", "name": "Dumbbell Shoulder Press", "category": "SHOULDERS", "equipment": "Dumbbell"},
    {"id": "default-shoulders-db-arnold", "name": "Arnold Press", "category": "SHOULDERS", "equipment": "Dumbbell"},
    {"id": "default-shoulders-db-lateral", "name": "Dumbbell Lateral Raises", "category": "SHOULDERS", "equipment": "Dumbbell"},
    {"id": "default-shoulders-db-front", "name": "Dumbbell Front Raises", "category": "SHOULDERS", "equipment": "Dumbbell"},
    {"id": "default-shoulders-db-rear-delt", "name": "Dumbbell Rear Delt Flyes", "category": "SHOULDERS", "equipment": "Dumbbell"},
    {"id": "default-shoulders-db-upright-row", "name": "Dumbbell Upright Row", "category": "SHOULDERS", "equipment": "Dumbbell"},
    {"id": "default-shoulders-bb-press", "name": "Barbell Overhead Press", "category": "SHOULDERS", "equipment": "Barbell"},
    {"id": "default-shoulders-bb-push-press", "name": "Push Press", "category": "SHOULDERS", "equipment": "Barbell"},
    {"id": "default-shoulders-bb-upright-row", "name": "Barbell Upright Row", "category": "SHOULDERS", "equipment": "Barbell"},
    {"id": "default-shoulders-cable-lateral", "name": "Cable Lateral Raises", "category": "SHOULDERS", "equipment": "Cable"},
    {"id": "default-shoulders-cable-front", "name": "Cable Front Raises", "category": "SHOULDERS", "equipment": "Cable"},
    {"id": "default-shoulders-cable-rear-delt", "name": "Cable Rear Delt Flyes", "category": "SHOULDERS", "equipment": "Cable"},
    {"id": "default-shoulders-cable-face-pulls", "name": "Face Pulls", "category": "SHOULDERS", "equipment": "Cable"},
    {"id": "default-shoulders-machine-press", "name": "Shoulder Press Machine", "category": "SHOULDERS", "equipment": "Machine"},
    {"id": "default-shoulders-machine-lateral", "name": "Lateral Raise Machine", "category": "SHOULDERS", "equipment": "Machine"},
    {"id": "default-shoulders-machine-reverse-pec", "name": "Reverse Pec Deck", "category": "SHOULDERS", "equipment": "Machine"},

    # BICEPS
    {"id": "default-biceps-db-curls", "name": "Dumbbell Curls", "category": "BICEPS", "equipment": "Dumbbell"},
    {"id": "default-biceps-db-alternating", "name": "Alternating Dumbbell Curls", "category": "BICEPS", "equipment": "Dumbbell"},
    {"id": "default-biceps-db-hammer", "name": "Hammer Curls", "category": "BICEPS", "equipment": "Dumbbell"},
    {"id": "default-biceps-db-incline", "name": "Incline Dumbbell Curls", "category": "BICEPS", "equipment": "Dumbbell"},
    {"id": "default-biceps-db-concentration", "name": "Concentration Curls", "category": "BICEPS", "equipment": "Dumbbell"},
    {"id": "default-biceps-bb-curls", "name": "Barbell Curls", "category": "BICEPS", "equipment": "Barbell"},
    {"id": "default-biceps-bb-ez-bar", "name": "EZ-Bar Curls", "category": "BICEPS", "equipment": "Barbell"},
    {"id": "default-biceps-bb-preacher", "name": "Preacher Curls (EZ or Barbell)", "category": "BICEPS", "equipment": "Barbell"},
    {"id": "default-biceps-cable-curls", "name": "Cable Curls", "category": "BICEPS", "equipment": "Cable"},
    {"id": "default-biceps-cable-rope-hammer", "name": "Rope Hammer Curls", "category": "BICEPS", "equipment": "Cable"},
    {"id": "default-biceps-cable-single-arm", "name": "Single-Arm Cable Curls", "category": "BICEPS", "equipment": "Cable"},
    {"id": "default-biceps-machine-curls", "name": "Bicep Curl Machine", "category": "BICEPS", "equipment": "Machine"},

    # TRICEPS
    {"id": "default-triceps-db-overhead", "name": "Overhead Dumbbell Extensions", "category": "TRICEPS", "equipment": "Dumbbell"},
    {"id": "default-triceps-db-skull", "name": "Dumbbell Skull Crushers", "category": "TRICEPS", "equipment": "Dumbbell"},
    {"id": "default-triceps-db-kickbacks", "name": "Dumbbell Kickbacks", "category": "TRICEPS", "equipment": "Dumbbell"},
    {"id": "default-triceps-bb-skull", "name": "Barbell Skull Crushers", "category": "TRICEPS", "equipment": "Barbell"},
    {"id": "default-triceps-bb-close-grip", "name": "Close-Grip Bench Press", "category": "TRICEPS", "equipment": "Barbell"},
    {"id": "default-triceps-cable-pushdowns", "name": "Tricep Pushdowns", "category": "TRICEPS", "equipment": "Cable"},
    {"id": "default-triceps-cable-rope", "name": "Rope Pushdowns", "category": "TRICEPS", "equipment": "Cable"},
    {"id": "default-triceps-cable-overhead", "name": "Overhead Cable Extensions", "category": "TRICEPS", "equipment": "Cable"},
    {"id": "default-triceps-cable-single-arm", "name": "Single-Arm Cable Pushdowns", "category": "TRICEPS", "equipment": "Cable"},
    {"id": "default-triceps-machine-extension", "name": "Tricep Extension Machine", "category": "TRICEPS", "equipment": "Machine"},
    {"id": "default-triceps-machine-assisted-dip", "name": "Assisted Dip Machine", "category": "TRICEPS", "equipment": "Machine"},
    {"id": "default-triceps-bw-bench-dips", "name": "Bench Dips", "category": "TRICEPS", "equipment": "Bodyweight"},
    {"id": "default-triceps-bw-parallel-dips", "name": "Parallel Bar Dips", "category": "TRICEPS", "equipment": "Bodyweight"},

    # BACK
    {"id": "default-back-db-rows", "name": "Dumbbell Rows", "category": "BACK", "equipment": "Dumbbell"},
    {"id": "default-back-db-single-arm-rows", "name": "Single-Arm Dumbbell Rows", "category": "BACK", "equipment": "Dumbbell"},
    {"id": "default-back-db-deadlifts", "name": "Dumbbell Deadlifts", "category": "BACK", "equipment": "Dumbbell"},
    {"id": "default-back-db-shrugs", "name": "Dumbbell Shrugs", "category": "BACK", "equipment": "Dumbbell"},
    {"id": "default-back-bb-deadlifts", "name": "Deadlifts", "category": "BACK", "equipment": "Barbell"},
    {"id": "default-back-bb-bent-over-rows", "name": "Bent-Over Barbell Rows", "category": "BACK", "equipment": "Barbell"},
    {"id": "default-back-bb-pendlay-rows", "name": "Pendlay Rows", "category": "BACK", "equipment": "Barbell"},
    {"id": "default-back-bb-shrugs", "name": "Barbell Shrugs", "category": "BACK", "equipment": "Barbell"},
    {"id": "default-back-cable-lat-pulldown", "name": "Lat Pulldowns", "category": "BACK", "equipment": "Cable"},
    {"id": "default-back-cable-seated-rows", "name": "Seated Cable Rows", "category": "BACK", "equipment": "Cable"},
    {"id": "default-back-cable-straight-arm", "name": "Straight-Arm Pulldowns", "category": "BACK", "equipment": "Cable"},
    {"id": "default-back-cable-single-arm-rows", "name": "Single-Arm Cable Rows", "category": "BACK", "equipment": "Cable"},
    {"id": "default-back-machine-assisted-pullup", "name": "Assisted Pull-Up Machine", "category": "BACK", "equipment": "Machine"},
    {"id": "default-back-machine-row", "name": "Row Machine", "category": "BACK", "equipment": "Machine"},
    {"id": "default-back-machine-hammer-row", "name": "Hammer Strength Row", "category": "BACK", "equipment": "Machine"},
    {"id": "default-back-bw-pullups", "name": "Pull-Ups", "category": "BACK", "equipment": "Bodyweight"},
    {"id": "default-back-bw-chinups", "name": "Chin-Ups", "category": "BACK", "equipment": "Bodyweight"},
    {"id": "default-back-bw-inverted-rows", "name": "Inverted Rows", "category": "BACK", "equipment": "Bodyweight"},

    # LEGS
    {"id": "default-legs-db-goblet-squats", "name": "Goblet Squats", "category": "LEGS", "equipment": "Dumbbell"},
    {"id": "default-legs-db-lunges", "name": "Dumbbell Lunges", "category": "LEGS", "equipment": "Dumbbell"},
    {"id": "default-legs-db-step-ups", "name": "Dumbbell Step-Ups", "category": "LEGS", "equipment": "Dumbbell"},
    {"id": "default-legs-db-romanian-deadlift", "name": "Dumbbell Romanian Deadlifts", "category": "LEGS", "equipment": "Dumbbell"},
    {"id": "default-legs-bb-back-squats", "name": "Back Squats", "category": "LEGS", "equipment": "Barbell"},
    {"id": "default-legs-bb-front-squats", "name": "Front Squats", "category": "LEGS", "equipment": "Barbell"},
    {"id": "default-legs-bb-romanian-deadlift", "name": "Romanian Deadlifts", "category": "LEGS", "equipment": "Barbell"},
    {"id": "default-legs-bb-conventional-deadlift", "name": "Conventional Deadlifts", "category": "LEGS", "equipment": "Barbell"},
    {"id": "default-legs-bb-good-mornings", "name": "Good Mornings", "category": "LEGS", "equipment": "Barbell"},
    {"id": "default-legs-cable-squats", "name": "Cable Squats", "category": "LEGS", "equipment": "Cable"},
    {"id": "default-legs-cable-pull-throughs", "name": "Cable Pull-Throughs", "category": "LEGS", "equipment": "Cable"},
    {"id": "default-legs-cable-lunges", "name": "Cable Lunges", "category": "LEGS", "equipment": "Cable"},
    {"id": "default-legs-machine-leg-press", "name": "Leg Press", "category": "LEGS", "equipment": "Machine"},
    {"id": "default-legs-machine-hack-squat", "name": "Hack Squat", "category": "LEGS", "equipment": "Machine"},
    {"id": "default-legs-machine-leg-extension", "name": "Leg Extension", "category": "LEGS", "equipment": "Machine"},
    {"id": "default-legs-machine-seated-leg-curl", "name": "Seated Leg Curl", "category": "LEGS", "equipment": "Machine"},
    {"id": "default-legs-machine-lying-leg-curl", "name": "Lying Leg Curl", "category": "LEGS", "equipment": "Machine"},

    # GLUTES
    {"id": "default-glutes-db-hip-thrusts", "name": "Dumbbell Hip Thrusts", "category": "GLUTES", "equipment": "Dumbbell"},
    {"id": "default-glutes-db-bulgarian-squats", "name": "Dumbbell Bulgarian Split Squats", "category": "GLUTES", "equipment": "Dumbbell"},
    {"id": "default-glutes-bb-hip-thrusts", "name": "Barbell Hip Thrusts", "category": "GLUTES", "equipment": "Barbell"},
    {"id": "default-glutes-bb-glute-bridges", "name": "Barbell Glute Bridges", "category": "GLUTES", "equipment": "Barbell"},
    {"id": "default-glutes-bb-sumo-deadlifts", "name": "Sumo Deadlifts", "category": "GLUTES", "equipment": "Barbell"},
    {"id": "default-glutes-cable-kickbacks", "name": "Cable Kickbacks", "category": "GLUTES", "equipment": "Cable"},
    {"id": "default-glutes-cable-pull-throughs", "name": "Cable Pull-Throughs", "category": "GLUTES", "equipment": "Cable"},
    {"id": "default-glutes-machine-hip-abduction", "name": "Hip Abduction Machine", "category": "GLUTES", "equipment": "Machine"},
    {"id": "default-glutes-machine-kickback", "name": "Glute Kickback Machine", "category": "GLUTES", "equipment": "Machine"},

    # CALVES
    {"id": "default-calves-db-standing", "name": "Dumbbell Standing Calf Raises", "category": "CALVES", "equipment": "Dumbbell"},
    {"id": "default-calves-db-seated", "name": "Dumbbell Seated Calf Raises", "category": "CALVES", "equipment": "Dumbbell"},
    {"id": "default-calves-bb-standing", "name": "Barbell Standing Calf Raises", "category": "CALVES", "equipment": "Barbell"},
    {"id": "default-calves-machine-seated", "name": "Seated Calf Raise Machine", "category": "CALVES", "equipment": "Machine"},
    {"id": "default-calves-machine-standing", "name": "Standing Calf Raise Machine", "category": "CALVES", "equipment": "Machine"},
    {"id": "default-calves-machine-leg-press", "name": "Leg Press Calf Raises", "category": "CALVES", "equipment": "Machine"},

    # CORE / ABS
    {"id": "default-core-bw-planks", "name": "Planks", "category": "CORE / ABS", "equipment": "Bodyweight"},
    {"id": "default-core-bw-side-planks", "name": "Side Planks", "category": "CORE / ABS", "equipment": "Bodyweight"},
    {"id": "default-core-bw-crunches", "name": "Crunches", "category": "CORE / ABS", "equipment": "Bodyweight"},
    {"id": "default-core-bw-leg-raises", "name": "Leg Raises", "category": "CORE / ABS", "equipment": "Bodyweight"},
    {"id": "default-core-bw-hanging-knee", "name": "Hanging Knee Raises", "category": "CORE / ABS", "equipment": "Bodyweight"},
    {"id": "default-core-cable-crunches", "name": "Cable Crunches", "category": "CORE / ABS", "equipment": "Cable"},
    {"id": "default-core-cable-woodchoppers", "name": "Woodchoppers", "category": "CORE / ABS", "equipment": "Cable"},
    {"id": "default-core-cable-pallof", "name": "Pallof Press", "category": "CORE / ABS", "equipment": "Cable"},
    {"id": "default-core-weighted-sit-ups", "name": "Weighted Sit-Ups", "category": "CORE / ABS", "equipment": "Weighted"},
    {"id": "default-core-weighted-ab-rollouts", "name": "Ab Rollouts", "category": "CORE / ABS", "equipment": "Weighted"},

    # CARDIO
    {"id": "default-cardio-incline-walk", "name": "Incline Walk", "category": "CARDIO", "equipment": "Treadmill"},
    {"id": "default-cardio-run", "name": "Run", "category": "CARDIO", "equipment": "Treadmill"},
    {"id": "default-cardio-normal-walk", "name": "Normal Walk", "category": "CARDIO", "equipment": "Treadmill"},
]

# Build a lookup dict for fast ID validation
EXERCISE_BY_ID = {ex["id"]: ex for ex in DEFAULT_EXERCISES}

EQUIPMENT_MAP = {
    "Full Gym": ["Dumbbell", "Barbell", "Cable", "Machine", "Bodyweight", "Treadmill", "Weighted"],
    "Dumbbells Only": ["Dumbbell", "Bodyweight"],
    "Barbell + Rack": ["Barbell", "Bodyweight"],
    "Cable Machine": ["Cable", "Bodyweight"],
    "Bodyweight Only": ["Bodyweight"],
    "Home Gym (Dumbbells + Bench)": ["Dumbbell", "Bodyweight"],
}


def filter_exercises_by_equipment(available_equipment: list[str]) -> list[dict]:
    """Filter the exercise catalog to only exercises the user can do with their equipment."""
    allowed = set()
    for eq in available_equipment:
        allowed.update(EQUIPMENT_MAP.get(eq, []))
    if not allowed:
        # Default to full gym if nothing specified
        allowed = {"Dumbbell", "Barbell", "Cable", "Machine", "Bodyweight", "Treadmill", "Weighted"}
    return [ex for ex in DEFAULT_EXERCISES if ex["equipment"] in allowed]


def validate_exercise_id(exercise_id: str) -> bool:
    """Check if an exercise ID exists in the default catalog."""
    return exercise_id in EXERCISE_BY_ID
