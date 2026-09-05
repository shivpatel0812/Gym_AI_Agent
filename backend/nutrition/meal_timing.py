"""
When the user actually eats, and which slot they file it under.

A logged food used to carry a slot and no clock. That is enough to total a day
and not enough to answer any of the questions the slot is really standing in
for: how long before training the pre-workout meal lands, whether breakfast is
a 7am habit or a 7am-to-noon lottery, how wide the eating window is.

Two fields carry it. `logged_at` is stamped by the server on write, on the
user's clock, so timing accrues for every client without one of them shipping
first. `eaten_at` is the user's own statement about when the food was eaten and
always wins -- logging Tuesday's dinner on Wednesday morning is a normal thing
to do, and the write time says nothing about the meal.

**A log time is only evidence when it lands on the day being logged.** Filling
in yesterday at 11pm would otherwise report an 11pm breakfast and drag every
average with it. `meal_time_minutes` returns None for those rows rather than
guessing, which is the same stance `estimate_maintenance_calories` takes.

Nothing here calls a model.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .logged_meals import slot_for_meal

# Slots in the order a day runs, so a summary reads top to bottom.
SLOT_ORDER = ["breakfast", "lunch", "pre_workout", "dinner", "snack"]

# How tightly clustered a slot's times have to be to call it a habit. Spread is
# the gap between the earliest and latest logged time for that slot.
CONSISTENT_SPREAD_MINUTES = 90
LOOSE_SPREAD_MINUTES = 240

# A slot needs this many timed logs before its "typical time" means anything.
MIN_LOGS_FOR_TYPICAL = 3


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO timestamp, with or without an offset. Never raises."""
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def stamp_logged_at(items: Iterable[Any], now_iso: str) -> List[Dict[str, Any]]:
    """
    Fill `logged_at` on rows that do not have one, leaving the rest untouched.

    Called on every macro write. An update rewrites the whole day's list, so
    preserving an existing stamp is what keeps a row's original log time from
    being reset every time some other food is added to the same day.
    """
    stamped = []
    for item in items or []:
        if not isinstance(item, dict):
            stamped.append(item)
            continue
        if not str(item.get("logged_at") or "").strip():
            item = {**item, "logged_at": now_iso}
        stamped.append(item)
    return stamped


def meal_time_minutes(item: Dict[str, Any], entry_date: Optional[str]) -> Optional[int]:
    """
    Minutes past local midnight this food was eaten, or None when unknown.

    `eaten_at` is taken at face value -- the user said so. `logged_at` counts
    only when it falls on the day the food is filed under; a retroactive log
    carries no information about mealtime.
    """
    eaten = _parse_iso(item.get("eaten_at"))
    if eaten:
        return eaten.hour * 60 + eaten.minute

    logged = _parse_iso(item.get("logged_at"))
    if not logged:
        return None
    date = str(entry_date or "")[:10]
    if date and logged.strftime("%Y-%m-%d") != date:
        return None
    return logged.hour * 60 + logged.minute


def format_clock(minutes: Optional[int]) -> Optional[str]:
    """712 -> "11:52 AM". None passes through."""
    if minutes is None:
        return None
    minutes = int(minutes) % (24 * 60)
    hour, minute = divmod(minutes, 60)
    suffix = "AM" if hour < 12 else "PM"
    display_hour = hour % 12 or 12
    return f"{display_hour}:{minute:02d} {suffix}"


def _median(values: List[int]) -> int:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return round((ordered[mid - 1] + ordered[mid]) / 2)


def _consistency(spread: int, logs: int) -> str:
    if logs < MIN_LOGS_FOR_TYPICAL:
        return "unknown"
    if spread <= CONSISTENT_SPREAD_MINUTES:
        return "consistent"
    if spread <= LOOSE_SPREAD_MINUTES:
        return "variable"
    return "scattered"


def _timed_rows(entries: Iterable[Dict[str, Any]]) -> List[Tuple[str, str, int, Dict[str, Any]]]:
    """(date, slot, minutes, item) for every food with a usable time."""
    rows = []
    for entry in entries or []:
        date = str(entry.get("date") or "")[:10]
        for food in entry.get("food_items") or []:
            if not isinstance(food, dict):
                continue
            slot = slot_for_meal(food.get("meal"))
            if not slot:
                continue
            minutes = meal_time_minutes(food, date)
            if minutes is None:
                continue
            rows.append((date, slot, minutes, food))
    return rows


def slot_timing(entries: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Per-slot clock habits: when this meal usually happens and how reliably.

    Times are collapsed per day first. Four rows logged across one dinner is
    one dinner, not four data points, and counting the rows would let a single
    heavily itemised meal define the "typical" time for the whole slot.
    """
    per_day: Dict[Tuple[str, str], List[int]] = {}
    for date, slot, minutes, _food in _timed_rows(entries):
        per_day.setdefault((slot, date), []).append(minutes)

    by_slot: Dict[str, List[int]] = {}
    for (slot, _date), minutes in per_day.items():
        # The first thing eaten is when the meal started.
        by_slot.setdefault(slot, []).append(min(minutes))

    out = []
    for slot in SLOT_ORDER + sorted(set(by_slot) - set(SLOT_ORDER)):
        times = by_slot.get(slot)
        if not times:
            continue
        spread = max(times) - min(times)
        typical = _median(times)
        out.append({
            "slot": slot,
            "days_logged": len(times),
            "typical_minutes": typical if len(times) >= MIN_LOGS_FOR_TYPICAL else None,
            "typical_time": format_clock(typical) if len(times) >= MIN_LOGS_FOR_TYPICAL else None,
            "earliest_time": format_clock(min(times)),
            "latest_time": format_clock(max(times)),
            "spread_minutes": spread,
            "consistency": _consistency(spread, len(times)),
        })
    return out


def day_windows(entries: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """First bite, last bite, and the eating window, per day. Newest first."""
    per_day: Dict[str, List[int]] = {}
    for date, _slot, minutes, _food in _timed_rows(entries):
        per_day.setdefault(date, []).append(minutes)

    days = []
    for date, minutes in per_day.items():
        first, last = min(minutes), max(minutes)
        days.append({
            "date": date,
            "first_meal": format_clock(first),
            "last_meal": format_clock(last),
            "window_minutes": last - first,
            "meals_timed": len(minutes),
        })
    days.sort(key=lambda d: d["date"], reverse=True)
    return days


def slot_corrections(entries: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Moves the user made by hand, most frequent first.

    A row carries `moved_from` only while it sits somewhere other than where
    the app first put it, so this counts standing corrections rather than every
    drag ever performed -- moving a food out and back leaves nothing behind.
    A repeated one is the app filing that food wrong, not the user fidgeting.
    """
    counts: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for entry in entries or []:
        for food in entry.get("food_items") or []:
            if not isinstance(food, dict):
                continue
            source = slot_for_meal(food.get("moved_from"))
            target = slot_for_meal(food.get("meal"))
            if not source or not target or source == target:
                continue
            row = counts.setdefault(
                (source, target),
                {"from_slot": source, "to_slot": target, "count": 0, "foods": []},
            )
            row["count"] += 1
            name = str(food.get("name") or "").strip()
            if name and name not in row["foods"]:
                row["foods"] = (row["foods"] + [name])[:5]

    out = sorted(counts.values(), key=lambda r: -r["count"])
    return out


def summarize_meal_timing(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Everything the app knows about when this user eats.

    `days_with_timing` is reported alongside the numbers so a caller can tell
    "eats breakfast at 7:40" from "logged breakfast once, at 7:40".
    """
    slots = slot_timing(entries)
    days = day_windows(entries)
    windows = [d["window_minutes"] for d in days if d["meals_timed"] > 1]

    return {
        "days_with_timing": len(days),
        "slots": slots,
        "days": days[:14],
        "average_window_minutes": _median(windows) if windows else None,
        "corrections": slot_corrections(entries),
    }
