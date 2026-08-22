"""
The user's clock, not the server's.

"What day is it" only has an answer relative to a timezone. The server runs in
UTC, so its own idea of today is wrong for the last several hours of a US
evening — food logged at 9pm Thursday in New York would be filed on Friday.

Clients send an explicit local date wherever they can. This module covers the
rest: anything the server decides on its own (a default date, the current meal
slot, a lookback window) resolves through the timezone the device reported, and
only falls back to UTC when we have never heard from that device.
"""

from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "UTC"


def _profile_ref(db, user_id: str):
    return (
        db.collection("users")
        .document(user_id)
        .collection("user_profile")
        .document("profile")
    )


def normalize_timezone(value: Optional[str]) -> Optional[str]:
    """Return a valid IANA zone name, or None. Never raises."""
    name = str(value or "").strip()
    if not name or len(name) > 64:
        return None
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return None
    return name


def get_timezone(db, user_id: str) -> str:
    """The user's IANA timezone, or UTC if their device never reported one."""
    try:
        doc = _profile_ref(db, user_id).get()
        if doc.exists:
            stored = normalize_timezone((doc.to_dict() or {}).get("timezone"))
            if stored:
                return stored
    except Exception as e:
        print(f"Warning: could not read user timezone: {e}")
    return DEFAULT_TIMEZONE


def set_timezone(db, user_id: str, value: str) -> Optional[str]:
    """Store a device-reported timezone. Returns the stored name, or None."""
    name = normalize_timezone(value)
    if not name:
        return None
    _profile_ref(db, user_id).set(
        {"timezone": name, "timezone_updated_at": datetime.now().isoformat()},
        merge=True,
    )
    return name


def now(db, user_id: str) -> datetime:
    """Current time on the user's clock."""
    return datetime.now(ZoneInfo(get_timezone(db, user_id)))


def today(db, user_id: str) -> str:
    """Today's date (YYYY-MM-DD) on the user's clock."""
    return now(db, user_id).strftime("%Y-%m-%d")
