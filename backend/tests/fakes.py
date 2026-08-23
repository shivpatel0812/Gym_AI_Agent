"""
Firestore stand-in shared by the state-layer tests.

Supports the access patterns the pipeline actually uses: date-ranged queries
across several collections, a singleton profile document, and the nutrition
plan store's `.limit(n).stream()`.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional


class FakeDoc:
    def __init__(self, data, doc_id="doc"):
        self._data = data
        self.exists = data is not None
        self.id = doc_id
        self.reference = self

    def to_dict(self):
        return self._data


class FakeDb:
    """
    `collections` maps a collection name to a list of row dicts.
    `profile` is the user_profile/profile document.
    """

    def __init__(self, collections=None, profile=None):
        self.collections = collections or {}
        self.profile = profile
        self.writes: Dict[str, Dict[str, Any]] = {}
        self._current: Optional[str] = None
        self._doc_id: Optional[str] = None
        self._filters: List[tuple] = []
        self._limit: Optional[int] = None

    # --- navigation ---
    def collection(self, name):
        self._current = name
        self._doc_id = None
        return self

    def document(self, name=None):
        self._doc_id = name
        return self

    def where(self, field, op, value):
        self._filters.append((field, op, value))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    # --- reads ---
    def stream(self):
        filters, self._filters = self._filters, []
        limit, self._limit = self._limit, None
        rows = list(self.collections.get(self._current, []))
        for field, op, value in filters:
            if field == "date" and op == ">=":
                rows = [r for r in rows if str(r.get("date", ""))[:10] >= value]
            if field == "date" and op == "<=":
                rows = [r for r in rows if str(r.get("date", ""))[:10] <= value]
            if op == "==":
                rows = [r for r in rows if r.get(field) == value]
        if limit is not None:
            rows = rows[:limit]
        return [FakeDoc(r, r.get("id", f"doc{i}")) for i, r in enumerate(rows)]

    def get(self):
        if self._current == "user_profile":
            self._current = None
            return FakeDoc(self.profile)
        # A specific document inside a normal collection.
        rows = self.collections.get(self._current, [])
        for r in rows:
            if r.get("id") == self._doc_id:
                return FakeDoc(r, self._doc_id)
        key = f"{self._current}/{self._doc_id}"
        if key in self.writes:
            return FakeDoc(self.writes[key], self._doc_id)
        return FakeDoc(None)

    # --- writes ---
    def set(self, payload, merge=False):
        self.writes[f"{self._current}/{self._doc_id}"] = payload
        return payload

    def update(self, patch):
        self.writes.setdefault(f"{self._current}/{self._doc_id}", {}).update(patch)


def days_back(n: int) -> List[str]:
    """`n` date strings, most recent first."""
    today = datetime.now()
    return [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n)]


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def rows(field: str, values, start_offset: int = 0) -> List[Dict[str, Any]]:
    """Build dated rows for one field, one per day going backwards."""
    dates = days_back(len(values) + start_offset)[start_offset:]
    return [{"date": d, field: v} for d, v in zip(dates, values)]
