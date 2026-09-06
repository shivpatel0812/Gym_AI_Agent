"""
Goals, scored against the same numbers the hub shows.

A goal is a target value, a date, and — critically — **the value it started
from**, captured when the goal is made. Without the start value, progress can
only be reported as a fraction of the target, which reads as 92% done the
moment someone with a 415 lb squat sets a 450 goal. What they want to know is
how far along the part that is actually theirs to close they are.

`on_track` is allowed to be None and frequently is. Two weeks into an eight
week goal, the observed rate is one or two data points and comparing it to the
required rate produces a confident verdict out of noise — the same mistake the
index's noise band exists to prevent. Too early is a real answer.

Nothing here uses a model. A goal that means something different on Tuesday
than on Thursday is worse than one that is consistently a little wrong, which
is the same argument `state/user_state.py` makes about ranking levers.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

COLLECTION = "progress_goals"

KINDS = ("exercise_e1rm", "bodyweight", "index_level", "sessions_per_week")
STATUSES = ("proposed", "active", "achieved", "abandoned")

# Weeks of elapsed time before an observed rate says anything. Below this the
# rate is one or two points and any verdict from it is noise wearing a number.
MIN_WEEKS_FOR_VERDICT = 2

# How far under the required pace still counts as on track. A goal is a target,
# not a contract, and flagging someone at 99% of pace helps nobody.
PACE_TOLERANCE = 0.85

KIND_LABELS = {
    "exercise_e1rm": "Lift",
    "bodyweight": "Bodyweight",
    "index_level": "Progress index",
    "sessions_per_week": "Sessions per week",
}
KIND_UNITS = {
    "exercise_e1rm": "lb",
    "bodyweight": "lb",
    "index_level": "",
    "sessions_per_week": "/wk",
}


def _num(value: Any) -> Optional[float]:
    try:
        out = float(value)
        return out if out == out else None
    except (TypeError, ValueError):
        return None


def _day(value: Any) -> Optional[datetime]:
    text = str(value or "")[:10]
    try:
        return datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        return None


def current_value(goal: Dict[str, Any], hub: Dict[str, Any]) -> Optional[float]:
    """Read this goal's metric off a built hub payload."""
    kind = goal.get("kind")
    domains = {d["key"]: d for d in hub.get("domains") or []}

    if kind == "index_level":
        return _num((hub.get("index") or {}).get("level"))

    if kind == "bodyweight":
        return _num(((domains.get("body") or {}).get("detail") or {}).get("latest_weight_lb"))

    if kind == "sessions_per_week":
        return _num(((domains.get("consistency") or {}).get("detail") or {}).get("sessions_last_week"))

    if kind == "exercise_e1rm":
        positions = ((domains.get("strength") or {}).get("detail") or {}).get("positions") or []
        target_id = goal.get("exercise_id")
        for position in positions:
            if position.get("exercise_id") == target_id:
                # Peak, matching how the strength level is anchored: a goal
                # should not un-achieve itself because of one bad session.
                return _num(position.get("peak_e1rm"))
    return None


def evaluate(goal: Dict[str, Any], hub: Dict[str, Any], today: Optional[str] = None) -> Dict[str, Any]:
    """One goal, scored. Never raises; unreadable inputs come back as reasons."""
    now = _day(today) or datetime.now()
    target = _num(goal.get("target_value"))
    start = _num(goal.get("start_value"))
    target_date = _day(goal.get("target_date"))
    start_date = _day(goal.get("start_date")) or _day(goal.get("created_at"))
    current = current_value(goal, hub)

    out: Dict[str, Any] = {
        **goal,
        "current_value": round(current, 1) if current is not None else None,
        "unit": KIND_UNITS.get(goal.get("kind") or "", ""),
        "kind_label": KIND_LABELS.get(goal.get("kind") or "", "Goal"),
        "on_track": None,
        "progress_pct": None,
        "days_remaining": (target_date - now).days if target_date else None,
    }

    if current is None:
        out["note"] = "Nothing logged for this goal yet."
        return out
    if target is None or start is None or target == start:
        out["note"] = "This goal has no distance to cover."
        return out

    # Direction-aware: a bodyweight goal usually runs downward.
    span = target - start
    covered = current - start
    progress = covered / span
    out["progress_pct"] = round(max(0.0, min(1.5, progress)) * 100, 1)

    reached = current >= target if span > 0 else current <= target
    if reached:
        out["status"] = "achieved"
        out["note"] = "Reached."
        out["on_track"] = True
        return out

    weeks_elapsed = ((now - start_date).days / 7) if start_date else 0
    weeks_left = ((target_date - now).days / 7) if target_date else None

    if weeks_elapsed < MIN_WEEKS_FOR_VERDICT:
        out["note"] = "Too early to call — give it a couple more weeks."
        return out
    if weeks_left is None:
        out["note"] = "No target date, so there is no pace to be behind."
        return out
    if weeks_left <= 0:
        out["note"] = "Past its target date."
        out["on_track"] = False
        return out

    observed = covered / weeks_elapsed
    required = (target - current) / weeks_left
    out["observed_rate_per_week"] = round(observed, 2)
    out["required_rate_per_week"] = round(required, 2)

    # Both rates carry the goal's own direction, so compare them in that
    # direction rather than by absolute size.
    if span > 0:
        out["on_track"] = observed >= required * PACE_TOLERANCE
    else:
        out["on_track"] = observed <= required * PACE_TOLERANCE

    out["note"] = (
        "On pace." if out["on_track"] else "Behind the pace this date needs."
    )
    return out


class GoalStore:
    """users/{uid}/progress_goals. Small, user-owned, no history kept."""

    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id

    def _collection(self):
        return self.db.collection("users").document(self.user_id).collection(COLLECTION)

    def list(self, include_done: bool = False) -> List[Dict[str, Any]]:
        try:
            docs = list(self._collection().limit(50).stream())
        except Exception as exc:
            print(f"progress goals read failed: {exc}")
            return []
        rows = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
        if not include_done:
            rows = [r for r in rows if r.get("status") in ("active", "proposed")]
        rows.sort(key=lambda r: r.get("target_date") or "9999", reverse=False)
        return rows

    def create(self, goal: Dict[str, Any], hub: Dict[str, Any]) -> Dict[str, Any]:
        """
        Stamp the start value at creation.

        Recomputing it later from history would let the goal's own baseline
        drift as the window slides, and "40% there" would change without the
        user doing anything.
        """
        kind = goal.get("kind")
        if kind not in KINDS:
            raise ValueError(f"kind must be one of {', '.join(KINDS)}")
        target = _num(goal.get("target_value"))
        if target is None:
            raise ValueError("target_value is required")

        start = current_value({**goal, "kind": kind}, hub)
        now = datetime.now()
        payload = {
            "kind": kind,
            "exercise_id": goal.get("exercise_id"),
            "label": (goal.get("label") or "").strip()[:80] or None,
            "target_value": target,
            "target_date": str(goal.get("target_date") or "")[:10] or None,
            "start_value": start,
            "start_date": now.strftime("%Y-%m-%d"),
            "status": goal.get("status") if goal.get("status") in STATUSES else "active",
            "source": goal.get("source") or "user",
            "created_at": now.isoformat(),
        }
        ref = self._collection().document()
        ref.set(payload)
        return {"id": ref.id, **payload}

    def set_status(self, goal_id: str, status: str) -> bool:
        if status not in STATUSES:
            raise ValueError(f"status must be one of {', '.join(STATUSES)}")
        try:
            self._collection().document(goal_id).set(
                {"status": status, "updated_at": datetime.now().isoformat()}, merge=True
            )
            return True
        except Exception as exc:
            print(f"progress goal status write failed: {exc}")
            return False

    def delete(self, goal_id: str) -> bool:
        try:
            self._collection().document(goal_id).delete()
            return True
        except Exception as exc:
            print(f"progress goal delete failed: {exc}")
            return False
