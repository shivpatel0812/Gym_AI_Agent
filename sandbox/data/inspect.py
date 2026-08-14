"""
Inspect sandbox workout data.

Usage (from sandbox/):
  python -m data.inspect
  python -m data.inspect --exercise default-chest-bb-bench-press
"""

from __future__ import annotations

import argparse
import json
import sys

from .load import exercise_history, load_workout_history, summarize


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect sandbox workout fixtures")
    parser.add_argument(
        "--fixture",
        help="Path to workout_history.json (default: fixtures/workout_history.json)",
    )
    parser.add_argument(
        "--exercise",
        help="Print collapsed history for one exercise_id",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print full validated payload as JSON",
    )
    args = parser.parse_args()

    try:
        history = load_workout_history(args.fixture)
    except Exception as exc:
        print(f"Failed to load fixture: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(history.model_dump(exclude_none=True), indent=2))
        return 0

    if args.exercise:
        rows = exercise_history(history, args.exercise)
        if not rows:
            print(f"No sessions found for exercise_id={args.exercise}")
            return 1
        print(json.dumps(rows, indent=2))
        return 0

    summary = summarize(history)
    print("=== Workout history summary ===")
    print(f"Goal:        {summary['goal']}")
    print(f"Experience:  {summary['experience']}")
    print(f"Split:       {summary['split']} → {summary['split_days']}")
    print(f"Sessions:    {summary['session_count']}")
    print(f"Date range:  {summary['date_range']}")
    print(f"Equipment:   {summary['equipment']}")
    print(f"Top lifts:   {summary['top_lifts']}")
    print(f"Exercises:   {summary['unique_exercises']} unique")
    print("Most logged:")
    for name, count in summary["top_exercises"]:
        print(f"  - {name}: {count} session(s)")
    print()
    print("Tip: python -m data.inspect --exercise default-chest-bb-bench-press")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
