"""
Training Focus - per-exercise goal overrides for the progression engine.

The recommender normally applies one goal (from the user's profile) uniformly
to every exercise, so a "Build Muscle" user gets hypertrophy rep ranges on
bench and on leg curls alike. A focus lets one lift train differently — a
strength emphasis on bench while the rest of the program stays hypertrophy.

Focuses expire. An emphasis set once and applied forever is a trap: months
later the program is still shaped by a decision nobody remembers making.

Document shape at users/{uid}/training_focus/{id}:
    exercise_id    str|None  matched first when present
    exercise_name  str       fallback match, case-insensitive substring
    goal           str       a key from goal_configs (e.g. "strength")
    note           str|None  why this focus exists
    created_at     str       ISO timestamp
    expires_at     str|None  ISO timestamp; None means no expiry
"""

from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

from .goal_configs import is_known_goal

COLLECTION = "training_focus"

DEFAULT_DURATION_WEEKS = 6
MAX_ACTIVE_FOCUSES = 3


class TrainingFocusStore:
    """Reads and writes per-exercise training focuses."""

    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id
        self._cache: Optional[List[Dict[str, Any]]] = None

    def _collection(self):
        return self.db.collection("users").document(self.user_id).collection(COLLECTION)

    @staticmethod
    def _is_active(focus: Dict[str, Any], now: Optional[datetime] = None) -> bool:
        expires_at = focus.get("expires_at")
        if not expires_at:
            return True
        try:
            return datetime.fromisoformat(expires_at) > (now or datetime.now())
        except (TypeError, ValueError):
            # An unparseable expiry is treated as expired rather than forever
            return False

    def list_active(self) -> List[Dict[str, Any]]:
        """Active, unexpired focuses. Cached per instance."""
        if self._cache is not None:
            return self._cache

        try:
            docs = list(self._collection().stream())
        except Exception as e:
            print(f"Warning: could not read training focus: {e}")
            self._cache = []
            return self._cache

        focuses = []
        for doc in docs:
            data = doc.to_dict() or {}
            data["id"] = doc.id
            if self._is_active(data) and is_known_goal(data.get("goal", "")):
                focuses.append(data)

        focuses.sort(key=lambda f: f.get("created_at") or "", reverse=True)
        self._cache = focuses
        return focuses

    def get_focus_for_exercise(
        self, exercise_id: str, exercise_name: str = ""
    ) -> Optional[Dict[str, Any]]:
        """
        The active focus covering this exercise, if any.

        Exercise id wins; otherwise a case-insensitive name match, so a focus
        on "bench" also covers "Barbell Bench Press". Most recent wins when
        several match.
        """
        name = (exercise_name or "").strip().lower()

        for focus in self.list_active():
            if exercise_id and focus.get("exercise_id") == exercise_id:
                return focus

        if not name:
            return None

        for focus in self.list_active():
            focus_name = (focus.get("exercise_name") or "").strip().lower()
            if focus_name and (focus_name in name or name in focus_name):
                return focus

        return None

    def set_focus(
        self,
        exercise_name: str,
        goal: str,
        exercise_id: Optional[str] = None,
        duration_weeks: int = DEFAULT_DURATION_WEEKS,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Create a focus. Raises ValueError on an unknown goal so a typo can't
        quietly reshape someone's training.
        """
        if not exercise_name or not exercise_name.strip():
            raise ValueError("exercise_name is required")
        if not is_known_goal(goal):
            raise ValueError(f"Unknown goal: {goal!r}")

        now = datetime.now()
        expires_at = (
            (now + timedelta(weeks=duration_weeks)).isoformat()
            if duration_weeks and duration_weeks > 0 else None
        )
        record = {
            "exercise_id": exercise_id,
            "exercise_name": exercise_name.strip(),
            "goal": goal,
            "note": note,
            "created_at": now.isoformat(),
            "expires_at": expires_at,
        }

        doc_ref = self._collection().document()
        doc_ref.set(record)
        record["id"] = doc_ref.id
        self._cache = None

        # Keep the list small so focuses stay meaningful
        active = self.list_active()
        for stale in active[MAX_ACTIVE_FOCUSES:]:
            self.clear_focus(stale["id"])

        self._cache = None
        return record

    def clear_focus(self, focus_id: str) -> bool:
        """Delete one focus. False if it doesn't exist."""
        doc_ref = self._collection().document(focus_id)
        if not doc_ref.get().exists:
            return False
        doc_ref.delete()
        self._cache = None
        return True

    def clear_all(self) -> int:
        """Delete every focus. Returns how many were removed."""
        removed = 0
        for doc in self._collection().stream():
            doc.reference.delete()
            removed += 1
        self._cache = None
        return removed
