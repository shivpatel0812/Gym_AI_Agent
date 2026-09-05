"""
Week bucketing for the progress hub.

Everything in the hub is weekly. Not a stylistic choice: a daily index is
noise-dominated (bodyweight swings pounds on water, one skipped Tuesday is not
information) and an index that ticks on every food log trains exactly the
refresh-anxiety loop this feature is trying not to be. The week is the shortest
bucket in which a training and eating pattern is legible.

Weeks start Monday and are identified by that Monday's ISO date.
"""

from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional


def parse_day(value: Any) -> Optional[date]:
    """Read a YYYY-MM-DD prefix out of whatever the row happens to carry."""
    text = str(value or "")[:10]
    if len(text) != 10:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def week_start(day: date) -> str:
    """The Monday of `day`'s week, as an ISO date string."""
    return (day - timedelta(days=day.weekday())).strftime("%Y-%m-%d")


def week_start_of(value: Any) -> Optional[str]:
    day = parse_day(value)
    return week_start(day) if day else None


def week_axis(end: date, weeks: int) -> List[str]:
    """
    `weeks` Monday keys ending with the week containing `end`, oldest first.

    The axis is built from the calendar rather than from the data so that weeks
    with nothing logged still appear. A gap the user can see is the point —
    silently dropping empty weeks would compress a month off the plan into a
    tidy unbroken line.
    """
    last = datetime.strptime(week_start(end), "%Y-%m-%d").date()
    return [
        (last - timedelta(weeks=weeks - 1 - i)).strftime("%Y-%m-%d")
        for i in range(weeks)
    ]


def bucket_by_week(rows: Iterable[Dict[str, Any]], axis: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    """Group dated rows into the weeks on `axis`. Rows outside it are dropped."""
    allowed = set(axis)
    buckets: Dict[str, List[Dict[str, Any]]] = {w: [] for w in axis}
    for row in rows or []:
        key = week_start_of(row.get("date"))
        if key and key in allowed:
            buckets[key].append(row)
    return buckets


def week_label(week: str) -> str:
    """Short axis tick — 'Sep 1'."""
    day = parse_day(week)
    # Not strftime("%-d") — that flag is platform-specific.
    return f"{day.strftime('%b')} {day.day}" if day else week
