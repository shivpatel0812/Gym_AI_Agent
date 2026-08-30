"""
What a proposed plan would actually change.

A plan review that renders the proposal alone answers "is this a good plan?"
when the question the user is really being asked is "should this replace what
you have?" Those differ in exactly the case that hurt: a two-day proposal shown
on its own looks like a reasonable two-day program. Shown against the five-day
plan it would replace, it is obviously destroying three days.

The diff is computed here, server-side, from the stored plans — never narrated
by the model. The model's own `changes` list is prose about its intent, which
is worth showing but is not evidence: it has claimed to add exercises that are
absent from the plan it returned.
"""

from typing import Any, Dict, List, Optional, Tuple

# Beyond this the review turns into a changelog nobody reads; the counts in the
# summary still reflect everything.
MAX_LISTED_PER_DAY = 12


def _day_key(name: Any) -> str:
    return str(name or "").strip().lower()


def _days_by_key(plan: Optional[Dict]) -> Dict[str, Dict]:
    return {
        _day_key(day.get("day_name")): day
        for day in ((plan or {}).get("days") or [])
        if isinstance(day, dict) and day.get("day_name")
    }


def _exercise_key(exercise: Dict) -> str:
    """Prefer the id; fall back to the name so custom lifts still match."""
    return str(
        exercise.get("exercise_id") or exercise.get("exercise_name") or ""
    ).strip().lower()


def _exercises_by_key(day: Optional[Dict]) -> Dict[str, Dict]:
    return {
        _exercise_key(ex): ex
        for ex in ((day or {}).get("exercises") or [])
        if isinstance(ex, dict) and _exercise_key(ex)
    }


def _name(exercise: Dict) -> str:
    return str(exercise.get("exercise_name") or exercise.get("exercise_id") or "Exercise")


def _prescription(exercise: Dict) -> Tuple[Any, Any, Any]:
    return (
        exercise.get("sets"),
        exercise.get("reps"),
        tuple(exercise.get("target_rep_range") or ()) or None,
    )


def _describe_prescription(exercise: Dict) -> str:
    sets, reps, rep_range = _prescription(exercise)
    if rep_range and len(rep_range) == 2:
        return f"{sets or '?'} x {rep_range[0]}-{rep_range[1]}"
    return f"{sets or '?'} x {reps or '?'}"


def diff_days(previous_day: Optional[Dict], proposed_day: Optional[Dict]) -> Dict[str, Any]:
    """Exercise-level differences within a single training day."""
    before = _exercises_by_key(previous_day)
    after = _exercises_by_key(proposed_day)

    added = [_name(ex) for key, ex in after.items() if key not in before]
    removed = [_name(ex) for key, ex in before.items() if key not in after]

    retargeted = []
    for key, ex in after.items():
        old = before.get(key)
        if old is not None and _prescription(old) != _prescription(ex):
            retargeted.append(
                {
                    "exercise_name": _name(ex),
                    "from": _describe_prescription(old),
                    "to": _describe_prescription(ex),
                }
            )

    kept_order_before = [k for k in before if k in after]
    kept_order_after = [k for k in after if k in before]
    reordered = kept_order_before != kept_order_after

    return {
        "added": added[:MAX_LISTED_PER_DAY],
        "removed": removed[:MAX_LISTED_PER_DAY],
        "retargeted": retargeted[:MAX_LISTED_PER_DAY],
        "reordered": reordered,
        "added_count": len(added),
        "removed_count": len(removed),
    }


def diff_plans(previous: Optional[Dict], proposed: Optional[Dict]) -> Dict[str, Any]:
    """
    A structural comparison of two plans, safe to show a user before they commit.

    `is_destructive` is the field the UI should lead with. A revision that only
    adds is routine; one that deletes a training day the user has been doing is
    the thing they must not be able to accept by accident.
    """
    proposed = proposed or {}
    if not previous:
        return {
            "is_first_plan": True,
            "is_destructive": False,
            "removed_days": [],
            "added_days": [
                day.get("day_name")
                for day in (proposed.get("days") or [])
                if day.get("day_name")
            ],
            "days": [],
            "schedule_changes": [],
            "summary": "Your first plan — nothing is being replaced.",
        }

    before = _days_by_key(previous)
    after = _days_by_key(proposed)

    removed_days = [
        str(day.get("day_name")) for key, day in before.items() if key not in after
    ]
    added_days = [
        str(day.get("day_name")) for key, day in after.items() if key not in before
    ]

    day_diffs = []
    for key, day in after.items():
        if key not in before:
            continue
        detail = diff_days(before[key], day)
        if (
            detail["added"]
            or detail["removed"]
            or detail["retargeted"]
            or detail["reordered"]
        ):
            day_diffs.append({"day_name": str(day.get("day_name")), **detail})

    schedule_changes = []
    old_schedule = previous.get("weekly_schedule") or {}
    new_schedule = proposed.get("weekly_schedule") or {}
    for weekday in old_schedule.keys() | new_schedule.keys():
        was = str(old_schedule.get(weekday, "Rest"))
        now = str(new_schedule.get(weekday, "Rest"))
        if was != now:
            schedule_changes.append({"weekday": weekday, "from": was, "to": now})
    schedule_changes.sort(key=lambda item: item["weekday"])

    exercises_removed = sum(d["removed_count"] for d in day_diffs)
    exercises_added = sum(d["added_count"] for d in day_diffs)

    return {
        "is_first_plan": False,
        # Losing a whole training day is the failure worth blocking on. Losing
        # an exercise is normal editing.
        "is_destructive": bool(removed_days),
        "removed_days": removed_days,
        "added_days": added_days,
        "days": day_diffs,
        "schedule_changes": schedule_changes,
        "exercises_added": exercises_added,
        "exercises_removed": exercises_removed,
        "summary": _summarize(
            removed_days, added_days, exercises_added, exercises_removed, schedule_changes
        ),
    }


def _summarize(
    removed_days: List[str],
    added_days: List[str],
    exercises_added: int,
    exercises_removed: int,
    schedule_changes: List[Dict],
) -> str:
    parts = []
    if removed_days:
        parts.append(
            f"removes {len(removed_days)} training day"
            f"{'' if len(removed_days) == 1 else 's'} ({', '.join(removed_days)})"
        )
    if added_days:
        parts.append(f"adds {', '.join(added_days)}")
    if exercises_added:
        parts.append(f"adds {exercises_added} exercise{'' if exercises_added == 1 else 's'}")
    if exercises_removed:
        parts.append(
            f"drops {exercises_removed} exercise{'' if exercises_removed == 1 else 's'}"
        )
    if schedule_changes and not (removed_days or added_days):
        parts.append("changes which weekdays you train")
    if not parts:
        return "No structural changes to your plan."
    return "This " + ", ".join(parts) + "."
