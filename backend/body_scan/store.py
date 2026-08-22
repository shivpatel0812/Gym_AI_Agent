"""Firestore store for body scan sessions — structured JSON only, no photo blobs."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

COLLECTION = "body_scans"


class BodyScanStore:
    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id

    def _collection(self):
        return self.db.collection("users").document(self.user_id).collection(COLLECTION)

    def save(self, record: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.now().isoformat()
        next_days = int((record.get("synthesis") or {}).get("next_scan_days") or 28)
        doc = {
            **record,
            "created_at": now,
            "updated_at": now,
            "next_scan_at": (datetime.now() + timedelta(days=next_days)).isoformat(),
            # Explicit: we do not store photos
            "photos_retained": False,
        }
        ref = self._collection().document()
        ref.set(doc)
        return {"id": ref.id, **doc}

    def get(self, scan_id: str) -> Optional[Dict[str, Any]]:
        doc = self._collection().document(scan_id).get()
        if not doc.exists:
            return None
        return {"id": doc.id, **(doc.to_dict() or {})}

    def latest(self) -> Optional[Dict[str, Any]]:
        items = self.list(limit=1)
        return items[0] if items else None

    def list(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Newest first. Ordered by Firestore, not by the page we happened to get."""
        try:
            docs = list(
                self._collection()
                .order_by("created_at", direction="DESCENDING")
                .limit(limit)
                .stream()
            )
        except Exception as e:
            # An order_by needs the field on every doc; pre-`created_at` records
            # would vanish entirely, so fall back to sorting a page in memory.
            print(f"Warning: ordered body scan query failed ({e}); falling back")
            try:
                docs = list(self._collection().limit(limit * 2).stream())
            except Exception as inner:
                print(f"Warning: list body scans failed: {inner}")
                return []
            items = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
            items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
            return items[:limit]
        return [{"id": d.id, **(d.to_dict() or {})} for d in docs]

    def latest_pair(self) -> tuple:
        """
        (latest, previous) — the two most recent scans, for progress comparison.
        Either may be None.
        """
        items = self.list(limit=2)
        return (
            items[0] if items else None,
            items[1] if len(items) > 1 else None,
        )

    def update(self, scan_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        ref = self._collection().document(scan_id)
        if not ref.get().exists:
            return None
        patch = {**patch, "updated_at": datetime.now().isoformat()}
        ref.update(patch)
        return self.get(scan_id)

    def get_consent(self) -> Optional[Dict[str, Any]]:
        doc = (
            self.db.collection("users")
            .document(self.user_id)
            .collection("settings")
            .document("body_scan_consent")
            .get()
        )
        if not doc.exists:
            return None
        return doc.to_dict() or {}

    def set_consent(self, version: str) -> Dict[str, Any]:
        data = {
            "version": version,
            "accepted_at": datetime.now().isoformat(),
        }
        (
            self.db.collection("users")
            .document(self.user_id)
            .collection("settings")
            .document("body_scan_consent")
            .set(data)
        )
        return data
