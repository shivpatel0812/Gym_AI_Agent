"""
Which plan day a logged session belongs to.

A plan that trains Pull twice a week describes two different workouts: Pull A
is heavy at 5-8, Pull B is volume at 8-12. The app logs both of them as
`split_day: "Pull"`, and a generic label matches both days equally
(`match_session_to_day_score` scores 0.94 against each), so the heavy and
volume exposures read one shared history. Day-specific progression then has
nothing to separate, the volume day inherits the heavy day's load, and the
plan ends up with two heavy days one of which is labelled volume.

Resolving this at read time is not possible -- by then the evidence is gone.
It has to be stamped when the session is written, while the calendar still
says which exposure it was.

Nothing here guesses. A session that cannot be attributed keeps the label the
user gave it, because a wrong attribution is worse than a generic one: it
sends real work into the wrong day's progression.
"""

from typing import Any, Dict, List, Optional

WEEKDAYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]


def _norm(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _base_name(day_name: Any) -> str:
    """"Pull B" -> "pull". The occurrence qualifier is what we are resolving."""
    tokens = _norm(day_name).split()
    if len(tokens) > 1 and tokens[-1] in {"a", "b", "c", "d", "1", "2", "3", "4"}:
        return " ".join(tokens[:-1])
    return " ".join(tokens)


def plan_day_names(plan: Optional[Dict]) -> List[str]:
    names = []
    for day in (plan or {}).get("days") or []:
        name = day.get("day_name") or day.get("name")
        if name:
            names.append(str(name))
    return names


def weekday_of(date_value: Any) -> Optional[str]:
    """The weekday name for an ISO date string or date-like object."""
    if date_value is None:
        return None
    try:
        if hasattr(date_value, "weekday"):
            return WEEKDAYS[date_value.weekday()]
        from datetime import datetime

        text = str(date_value)[:10]
        return WEEKDAYS[datetime.strptime(text, "%Y-%m-%d").weekday()]
    except (ValueError, TypeError, IndexError):
        return None


def resolve_plan_day(
    split_day: Any,
    plan: Optional[Dict],
    date_value: Any = None,
) -> Optional[str]:
    """
    The specific plan day this session belongs to, or None to leave it alone.

    Three ways in, most trustworthy first:

    1. The label already names a plan day exactly. Nothing to do.
    2. The plan's own weekly schedule puts a day of this family on this
       weekday. The calendar is the authority on which exposure it was.
    3. The family occurs exactly once in the plan, so there is no ambiguity
       to resolve in the first place.

    Anything else -- a "Pull" logged on a day the schedule says is Legs, or a
    family with two candidates and no date -- returns None.
    """
    label = _norm(split_day)
    if not label or not plan:
        return None

    names = plan_day_names(plan)
    if not names:
        return None

    # 1. Already exact.
    for name in names:
        if _norm(name) == label:
            return None

    base = _base_name(label)
    candidates = [name for name in names if _base_name(name) == base]
    if not candidates:
        return None

    # 2. The calendar decides.
    weekday = weekday_of(date_value)
    if weekday:
        scheduled = (plan.get("weekly_schedule") or {}).get(weekday)
        if not scheduled:
            for key, value in (plan.get("weekly_schedule") or {}).items():
                if _norm(key) == weekday:
                    scheduled = value
                    break
        if scheduled:
            for name in candidates:
                if _norm(name) == _norm(scheduled):
                    return name

    # 3. Unambiguous anyway.
    if len(candidates) == 1:
        return candidates[0]

    return None
