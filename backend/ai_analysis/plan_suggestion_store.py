"""
Pending coach patches to the Active Plan.

Kept in their own collection rather than written into the plan, because the
whole point is that the live plan does not change until the user says so. The
Plan Hub reads pending sets from here and renders Accept / Discard; nothing
in this module can alter a plan on its own.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from .plan_edits import (
    SET_STATUS_PENDING,
    SET_STATUS_SUPERSEDED,
    set_status_for,
)

COLLECTION = "plan_suggestions"
MAX_SETS = 25


class PlanSuggestionStore:
    """Reads and writes staged plan patches for one user."""

    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id

    def _collection(self):
        return (
            self.db.collection("users").document(self.user_id).collection(COLLECTION)
        )

    def get(self, set_id: str) -> Optional[Dict[str, Any]]:
        doc = self._collection().document(set_id).get()
        return {"id": doc.id, **(doc.to_dict() or {})} if doc.exists else None

    def list_sets(self, limit: int = MAX_SETS) -> List[Dict[str, Any]]:
        records = [
            {"id": doc.id, **(doc.to_dict() or {})}
            for doc in self._collection().stream()
        ]
        records.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        return records[:limit]

    def get_pending(self, plan_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """The one patch set awaiting review, if any."""
        for record in self.list_sets():
            if record.get("status") != SET_STATUS_PENDING:
                continue
            if plan_id and record.get("plan_id") != plan_id:
                continue
            return record
        return None

    def create(
        self,
        plan: Dict[str, Any],
        edits: List[Dict[str, Any]],
        summary: str,
        conversation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        now = datetime.now().isoformat()
        record = {
            "plan_id": plan.get("id"),
            # Lets accept detect that the plan moved on since this was proposed
            "plan_version": int(plan.get("version") or 1),
            "conversation_id": conversation_id,
            "status": SET_STATUS_PENDING,
            "summary": summary,
            "edits": edits,
            "created_at": now,
            "updated_at": now,
        }
        doc_ref = self._collection().document()
        doc_ref.set(record)
        # Two competing pending sets would let the user accept contradictory
        # targets for the same lift, so the newest wins.
        self.supersede_pending(plan.get("id"), keep_id=doc_ref.id)
        return {"id": doc_ref.id, **record}

    def supersede_pending(self, plan_id: Optional[str], keep_id: Optional[str] = None) -> None:
        now = datetime.now().isoformat()
        for record in self.list_sets():
            if record["id"] == keep_id or record.get("status") != SET_STATUS_PENDING:
                continue
            if plan_id and record.get("plan_id") != plan_id:
                continue
            self._collection().document(record["id"]).update(
                {"status": SET_STATUS_SUPERSEDED, "updated_at": now}
            )

    def mark_edits(self, set_id: str, outcomes: Dict[str, str]) -> Optional[Dict[str, Any]]:
        """Write per-edit outcomes back and re-derive the set's status."""
        record = self.get(set_id)
        if not record:
            return None
        now = datetime.now().isoformat()
        edits = [
            {
                **edit,
                "status": outcomes.get(str(edit.get("id")), edit.get("status")),
                **({"resolved_at": now} if outcomes.get(str(edit.get("id"))) else {}),
            }
            for edit in (record.get("edits") or [])
        ]
        update = {
            "edits": edits,
            "status": set_status_for(edits),
            "updated_at": now,
        }
        self._collection().document(set_id).update(update)
        return {**record, **update}

    def delete(self, set_id: str) -> bool:
        doc = self._collection().document(set_id)
        if not doc.get().exists:
            return False
        doc.delete()
        return True
