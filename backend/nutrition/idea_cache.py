"""
Cache for AI slot ideas on the day blueprint.

The plan page preloads ideas for whichever meal tab is in focus, so switching
between Breakfast and Lunch a few times used to bill a model call every time —
and remounting the tab threw the results away. Ideas are cached against the
plan's version number and dropped automatically when it moves.

Suggestions are also built on what the user logged recently, which the version
number cannot see. MAX_AGE is what covers that: a day-old idea is still a fair
idea, and an explicit refresh always regenerates.

Never load-bearing: every failure path falls back to "no cache", which just
means the caller generates fresh ideas the way it always did.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, Optional

COLLECTION = "nutrition_cache"
DOCUMENT = "slot_ideas"

# Ideas are not wrong after a day, but they get repetitive, and a plan someone
# is actively editing deserves a fresh look now and then.
MAX_AGE = timedelta(hours=24)


def _doc(db, user_id: str):
    return (
        db.collection("users")
        .document(user_id)
        .collection(COLLECTION)
        .document(DOCUMENT)
    )


def _key(slot: str, stance: Optional[str], count: int) -> str:
    return f"{slot}:{stance or 'default'}:{count}"


def _fresh(entry: Dict[str, Any]) -> bool:
    stamp = entry.get("created_at")
    if not stamp:
        return False
    try:
        return datetime.now() - datetime.fromisoformat(stamp) < MAX_AGE
    except (TypeError, ValueError):
        return False


def get(
    db,
    user_id: str,
    plan_id: str,
    plan_version: int,
    slot: str,
    stance: Optional[str],
    count: int,
) -> Optional[Dict[str, Any]]:
    """Cached ideas for this exact plan version, or None."""
    try:
        snapshot = _doc(db, user_id).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict() or {}
    except Exception as e:
        print(f"Warning: slot idea cache read failed: {e}")
        return None

    if data.get("plan_id") != plan_id or int(data.get("plan_version") or 0) != int(plan_version):
        return None
    entry = (data.get("slots") or {}).get(_key(slot, stance, count))
    if not isinstance(entry, dict) or not _fresh(entry):
        return None
    suggestion = entry.get("suggestion")
    return suggestion if isinstance(suggestion, dict) else None


def put(
    db,
    user_id: str,
    plan_id: str,
    plan_version: int,
    slot: str,
    stance: Optional[str],
    count: int,
    suggestion: Dict[str, Any],
) -> None:
    """Store ideas for this plan version, dropping entries from older ones."""
    try:
        snapshot = _doc(db, user_id).get()
        data = (snapshot.to_dict() or {}) if snapshot.exists else {}
    except Exception as e:
        print(f"Warning: slot idea cache read failed: {e}")
        data = {}

    same_plan = data.get("plan_id") == plan_id and int(data.get("plan_version") or 0) == int(
        plan_version
    )
    slots = (data.get("slots") or {}) if same_plan else {}
    slots[_key(slot, stance, count)] = {
        "suggestion": suggestion,
        "created_at": datetime.now().isoformat(),
    }

    try:
        _doc(db, user_id).set(
            {
                "plan_id": plan_id,
                "plan_version": int(plan_version),
                "slots": slots,
                "updated_at": datetime.now().isoformat(),
            }
        )
    except Exception as e:
        print(f"Warning: slot idea cache write failed: {e}")


def clear(db, user_id: str) -> None:
    """Drop everything — used when a plan is deleted or replaced."""
    try:
        _doc(db, user_id).delete()
    except Exception as e:
        print(f"Warning: slot idea cache clear failed: {e}")
