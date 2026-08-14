"""
Scenario Runner — Human-readable prediction review tool.

Run this script to see what the progression engine recommends for a variety
of realistic training scenarios. Use it to gut-check predictions and find
cases where the algorithm feels off.

Usage:
    python -m tests.scenario_runner

Add your own scenarios at the bottom of SCENARIOS list.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.workout_recommender.progression_engine import ProgressionEngine, Decision
from tests.conftest import build_session


engine = ProgressionEngine()


# ─── Scenario Format ───────────────────────────────────────────────────────────
# Each scenario is a dict:
#   name:            Short description of what's being tested
#   exercise_id:     ID from catalog (or custom firestore ID)
#   exercise_name:   Human name
#   goal:            "Build Muscle", "Get Stronger", "Lose Fat", "General Fitness"
#   sessions:        List of session dicts (most recent first)
#   num_sets:        How many sets to recommend (default 3)
#   day_intensity:   "heavy", "light", or None
#   exercise_record: Optional dict for custom exercises {muscle_group, type}
# ───────────────────────────────────────────────────────────────────────────────

SCENARIOS = [
    # ── Basic Progression ──────────────────────────────────────────────────────
    {
        "name": "DB Incline Press: 70s x 7 reps — should suggest +1 rep",
        "exercise_id": "default-chest-db-incline-press",
        "exercise_name": "Dumbbell Incline Press",
        "goal": "Build Muscle",
        "sessions": [build_session(70, [7, 7, 7])],
    },
    {
        "name": "DB Incline Press: 70s x 10,10,10 (top of range) — should increase weight",
        "exercise_id": "default-chest-db-incline-press",
        "exercise_name": "Dumbbell Incline Press",
        "goal": "Build Muscle",
        "sessions": [build_session(70, [10, 10, 10])],
    },
    {
        "name": "DB Bench Press: 75s x 10,10,10 — should go to 80s x 6",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(75, [10, 10, 10])],
    },
    {
        "name": "DB Bench Press: 75s x 8,8,7 — should suggest 75s x 9,9,8",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(75, [8, 8, 7])],
    },
    {
        "name": "DB Bench Press: 75s x 6,6,5 — should suggest 75 x 7,7,6",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(75, [6, 6, 5])],
    },

    # ── Strength Goal ──────────────────────────────────────────────────────────
    {
        "name": "Barbell Squat (Strength): 225 x 5,5,5 — should suggest 225 x 6,6,6",
        "exercise_id": "default-legs-bb-squats",
        "exercise_name": "Barbell Squats",
        "goal": "Get Stronger",
        "sessions": [build_session(225, [5, 5, 5])],
    },
    {
        "name": "Barbell Squat (Strength): 225 x 6,6,6 (top) — should increase to 235",
        "exercise_id": "default-legs-bb-squats",
        "exercise_name": "Barbell Squats",
        "goal": "Get Stronger",
        "sessions": [build_session(225, [6, 6, 6])],
    },
    {
        "name": "Deadlift (Strength): 315 x 5,5,5 — should suggest 315 x 6,6,6",
        "exercise_id": "default-back-bb-deadlifts",
        "exercise_name": "Deadlifts",
        "goal": "Get Stronger",
        "sessions": [build_session(315, [5, 5, 5])],
    },
    {
        "name": "Deadlift (Strength): 315 x 6,6,6 (top) — should go to 325",
        "exercise_id": "default-back-bb-deadlifts",
        "exercise_name": "Deadlifts",
        "goal": "Get Stronger",
        "sessions": [build_session(315, [6, 6, 6])],
    },

    # ── Easy Rating / Double Increment ─────────────────────────────────────────
    {
        "name": "DB Bench (easy, top): 75 x 10,10,10 all easy — should double to 85",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(75, [10, 10, 10], difficulty=["easy", "easy", "easy"])],
    },
    {
        "name": "BB Bench (easy, top): 185 x 6,6,6 all easy (Strength) — double to 195",
        "exercise_id": "default-chest-bb-bench-press",
        "exercise_name": "Barbell Bench Press",
        "goal": "Get Stronger",
        "sessions": [build_session(185, [6, 6, 6], difficulty=["easy", "easy", "easy"])],
    },
    {
        "name": "DB Bench (easy, NOT top): 75 x 8,8,8 all easy — just +1 rep, no double",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(75, [8, 8, 8], difficulty=["easy", "easy", "easy"])],
    },

    # ── Failure / Maintain ─────────────────────────────────────────────────────
    {
        "name": "DB Bench: 2 sessions failed to match — should maintain",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [
            build_session(75, [6, 6, 5]),   # Latest: failed to match
            build_session(75, [7, 6, 6]),   # Previous: was the target
            build_session(75, [7, 6, 6]),   # Before that: same
        ],
    },
    {
        "name": "DB Bench: 1 session failed — should retry (not maintain yet)",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [
            build_session(75, [6, 5, 5]),   # Latest: failed
            build_session(75, [7, 7, 6]),   # Previous: target
        ],
    },
    {
        "name": "All sets rated 'failed' — immediate failure",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(80, [4, 3, 3], difficulty=["failed", "failed", "failed"])],
    },

    # ── Deload ─────────────────────────────────────────────────────────────────
    {
        "name": "Stalled 3 sessions (same weight, flat e1RM) — should deload",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [
            build_session(75, [7, 7, 6]),
            build_session(75, [7, 6, 6]),
            build_session(75, [7, 7, 6]),
        ],
    },

    # ── Light Day ──────────────────────────────────────────────────────────────
    {
        "name": "Light day: last heavy was 80s — should prescribe ~70 at high reps",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(80, [8, 8, 7])],
        "day_intensity": "light",
    },

    # ── Fat Loss Goal ──────────────────────────────────────────────────────────
    {
        "name": "Fat Loss: 75 x 12,12,12 (top) — increase weight, single increment only",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Lose Fat",
        "sessions": [build_session(75, [12, 12, 12])],
    },
    {
        "name": "Fat Loss: 75 x 12,12,12 all easy — still single increment (no double)",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Lose Fat",
        "sessions": [build_session(75, [12, 12, 12], difficulty=["easy", "easy", "easy"])],
    },

    # ── Isolation Exercises ────────────────────────────────────────────────────
    {
        "name": "DB Curls: 30 x 12,12,11 — should suggest 30 x 13,13,12",
        "exercise_id": "default-biceps-db-curls",
        "exercise_name": "Dumbbell Curls",
        "goal": "Build Muscle",
        "sessions": [build_session(30, [12, 12, 11])],
    },
    {
        "name": "DB Curls: 30 x 15,15,15 (top) — should go to 35 x 10",
        "exercise_id": "default-biceps-db-curls",
        "exercise_name": "Dumbbell Curls",
        "goal": "Build Muscle",
        "sessions": [build_session(30, [15, 15, 15])],
    },
    {
        "name": "Lateral Raises: 15 x 14,13,12 — should suggest 15 x 15,14,13",
        "exercise_id": "default-shoulders-db-lateral-raises",
        "exercise_name": "Dumbbell Lateral Raises",
        "goal": "Build Muscle",
        "sessions": [build_session(15, [14, 13, 12])],
    },
    {
        "name": "Lateral Raises: 15 x 15,15,15 (top) — should go to 20 x 10",
        "exercise_id": "default-shoulders-db-lateral-raises",
        "exercise_name": "Dumbbell Lateral Raises",
        "goal": "Build Muscle",
        "sessions": [build_session(15, [15, 15, 15])],
    },

    # ── Custom Exercises ───────────────────────────────────────────────────────
    {
        "name": "Custom: Bulgarian Split Squats 50s x 8,8,8 — should be compound, +1 rep",
        "exercise_id": "firestore-custom-bss-123",
        "exercise_name": "Bulgarian Split Squats",
        "goal": "Build Muscle",
        "sessions": [build_session(50, [8, 8, 8])],
        "exercise_record": {"muscle_group": "LEGS", "type": "strength"},
    },
    {
        "name": "Custom: Cable Flyes 30 x 14,13,12 — isolation, +1 rep",
        "exercise_id": "firestore-custom-flyes",
        "exercise_name": "Cable Flyes",
        "goal": "Build Muscle",
        "sessions": [build_session(30, [14, 13, 12])],
        "exercise_record": {"muscle_group": "CHEST", "type": "strength"},
    },

    # ── First Time (No History) ────────────────────────────────────────────────
    {
        "name": "First time DB Bench — should return needs_starting_weight",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [],
    },
    {
        "name": "First time Barbell Squat (Strength) — needs starting weight",
        "exercise_id": "default-legs-bb-squats",
        "exercise_name": "Barbell Squats",
        "goal": "Get Stronger",
        "sessions": [],
    },

    # ── Mixed / Uneven Sets ────────────────────────────────────────────────────
    {
        "name": "DB Bench: 75 x 10, 9, 8 (not all at top) — should +1 each",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(75, [10, 9, 8])],
    },
    {
        "name": "DB Bench: only logged 2 sets, plan wants 4 — pads from last set",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(75, [8, 7])],
        "num_sets": 4,
    },

    # ── Heavier Weights ────────────────────────────────────────────────────────
    {
        "name": "BB Bench: 225 x 8,8,7 (Hypertrophy) — should suggest 225 x 9,9,8",
        "exercise_id": "default-chest-bb-bench-press",
        "exercise_name": "Barbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(225, [8, 8, 7])],
    },
    {
        "name": "BB Bench: 225 x 10,10,10 (top, Hypertrophy) — should go to 230",
        "exercise_id": "default-chest-bb-bench-press",
        "exercise_name": "Barbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(225, [10, 10, 10])],
    },

    # ── 4-Set Programs ─────────────────────────────────────────────────────────
    {
        "name": "DB Bench 4 sets: 75 x 9,9,8,8 — should suggest 75 x 10,10,9,9",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(75, [9, 9, 8, 8])],
        "num_sets": 4,
    },
    {
        "name": "DB Bench 4 sets: 75 x 10,10,10,10 (all top) — go to 80 x 6",
        "exercise_id": "default-chest-db-bench-press",
        "exercise_name": "Dumbbell Bench Press",
        "goal": "Build Muscle",
        "sessions": [build_session(75, [10, 10, 10, 10])],
        "num_sets": 4,
    },
]


# ─── Runner ────────────────────────────────────────────────────────────────────

def format_sets(sets):
    """Format recommended sets as a readable string."""
    if not sets:
        return "(no sets — needs starting weight)"
    parts = []
    for s in sets:
        parts.append(f"{s.weight} x {s.reps}")
    return ", ".join(parts)


def run_scenarios():
    print("=" * 80)
    print("  PROGRESSION ENGINE — SCENARIO PREDICTIONS")
    print("=" * 80)
    print()

    for i, scenario in enumerate(SCENARIOS, 1):
        name = scenario["name"]
        result = engine.compute_recommendation(
            exercise_id=scenario["exercise_id"],
            exercise_name=scenario["exercise_name"],
            user_goal=scenario["goal"],
            recent_sessions=scenario["sessions"],
            num_sets=scenario.get("num_sets", 3),
            day_intensity=scenario.get("day_intensity"),
            heavy_day_weight=scenario.get("heavy_day_weight"),
            exercise_record=scenario.get("exercise_record"),
        )

        # Format input
        if scenario["sessions"]:
            latest = scenario["sessions"][0]
            input_sets = latest.get("sets", [])
            input_str = ", ".join(
                f"{s['weight']} x {s['reps']}" for s in input_sets
            )
        else:
            input_str = "(no history)"

        # Format output
        output_str = format_sets(result.sets)
        decision_str = result.decision.value.upper()
        confidence_str = result.confidence

        print(f"  [{i:02d}] {name}")
        print(f"       Goal: {scenario['goal']} | Sets requested: {scenario.get('num_sets', 3)}")
        print(f"       Input:      {input_str}")
        print(f"       Prediction: {output_str}")
        print(f"       Decision:   {decision_str} (confidence: {confidence_str})")

        # Show extra context for special decisions
        ctx = result.reasoning_context
        if result.decision == Decision.NEEDS_STARTING_WEIGHT:
            print(f"       → Pick a weight you can do for {ctx.get('suggested_reps')} reps")
            print(f"         Rep range: {ctx.get('rep_range')}")
        elif result.decision == Decision.DELOAD:
            print(f"       → Deload to {ctx.get('deload_weight')} lbs (80% of {ctx.get('prev_weight')})")
        elif result.decision == Decision.LIGHT_DAY:
            print(f"       → Light day: {ctx.get('light_weight')} lbs (87% of heavy {ctx.get('heavy_weight')})")

        print()

    print("=" * 80)
    print(f"  Total scenarios: {len(SCENARIOS)}")
    print("=" * 80)


if __name__ == "__main__":
    run_scenarios()
