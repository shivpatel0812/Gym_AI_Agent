"""
Report sessions whose `split_day` label disagrees with what they contain.

Read-only. Nothing here writes, because the fix is a judgement call: a pull
movement logged on a push day might be a mislabelled session, or might be
someone who genuinely supersets. The planner now treats these labels as
suspect rather than authoritative, so this script exists to show you which
ones, not to silently rewrite your history.

    python scripts/diagnose_session_labels.py <user_email>
"""

import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from db import db  # noqa: E402
from firebase_admin import auth  # noqa: E402

from ai_analysis.training_history import (  # noqa: E402
    _category_for,
    build_exercise_catalog,
    coverage_gaps,
    mislabelled_exercises,
)

# Which muscle groups each day label is expected to contain. Only labels we can
# reason about are checked; anything else is skipped rather than guessed at.
DAY_EXPECTATIONS = {
    "push": {"CHEST", "SHOULDERS", "TRICEPS"},
    "pull": {"BACK", "BICEPS"},
    "legs": {"LEGS", "GLUTES", "CALVES"},
    "upper": {"CHEST", "BACK", "SHOULDERS", "BICEPS", "TRICEPS"},
    "lower": {"LEGS", "GLUTES", "CALVES"},
}


def expectation_for(day_label: str):
    key = str(day_label or "").strip().lower()
    for name, groups in DAY_EXPECTATIONS.items():
        if key.startswith(name):
            return name, groups
    return None, None


def main(email: str) -> None:
    uid = auth.get_user_by_email(email).uid
    sessions = [
        doc.to_dict() or {}
        for doc in db.collection("users").document(uid)
        .collection("workout_sessions").stream()
    ]
    sessions.sort(key=lambda s: s.get("date") or "", reverse=True)
    print(f"{len(sessions)} sessions for {email}\n")

    offenders = Counter()
    flagged = 0
    for session in sessions:
        label = session.get("split_day")
        name, expected = expectation_for(label)
        if not expected:
            continue
        wrong = []
        for exercise in session.get("exercises") or []:
            category = _category_for(
                str(exercise.get("exercise_id") or ""),
                str(exercise.get("exercise_name") or ""),
            )
            if category and category not in expected:
                wrong.append((exercise.get("exercise_name"), category))
        if wrong:
            flagged += 1
            print(f"{session.get('date')}  labelled {label!r}")
            for exercise_name, category in wrong:
                print(f"    {exercise_name}  [{category}]")
                offenders[exercise_name] += 1
            print()

    print(f"--- {flagged} session(s) contain work that does not match their label ---\n")
    if offenders:
        print("Most frequently misplaced:")
        for exercise_name, count in offenders.most_common(10):
            print(f"  {count:3d}x  {exercise_name}")
        print()

    catalog = build_exercise_catalog(sessions)
    coverage = coverage_gaps(catalog)
    print("Coverage:")
    print(f"  trained:   {', '.join(coverage['trained']) or '(none)'}")
    print(f"  untrained: {', '.join(coverage['untrained']) or '(none)'}")
    print(f"  lower-body sessions: {coverage['lower_body_sessions']}\n")

    confused = mislabelled_exercises(catalog)
    if confused:
        print("Exercises logged under more than one day name:")
        for entry in confused[:10]:
            labels = ", ".join(f"{k}x{v}" for k, v in entry["logged_under_days"].items())
            print(f"  {entry['exercise_name']}: {labels}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])
