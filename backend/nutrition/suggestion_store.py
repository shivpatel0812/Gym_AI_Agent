"""
Pending AI suggestions against the live nutrition plan.

Suggestion sets live in users/{uid}/nutrition_plan_suggestions/{id}. They are
proposals, not plans: the coach writes them from chat, the Plan page reviews
them, and only accepting one PATCHes the real plan. One pending set per plan
at a time — a newer proposal supersedes the older one so the user never has to
reconcile two conflicting stacks of advice.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from nutrition.plan_edits import (
    SET_STATUS_PENDING,
    SET_STATUS_SUPERSEDED,
    set_status_for,
)

COLLECTION = "nutrition_plan_suggestions"

# Enough to survive a browse-later, short enough that stale advice expires
MAX_SETS = 20


class SuggestionStore:
    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id

    def _collection(self):
        return self.db.collection("users").document(self.user_id).collection(COLLECTION)

    def get(self, set_id: str) -> Optional[Dict[str, Any]]:
        doc = self._collection().document(set_id).get()
        if not doc.exists:
            return None
        return {"id": doc.id, **(doc.to_dict() or {})}

    def list_sets(self, limit: int = MAX_SETS) -> List[Dict[str, Any]]:
        try:
            docs = list(self._collection().limit(limit).stream())
        except Exception as e:
            print(f"Warning: could not list nutrition suggestions: {e}")
            return []
        sets = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
        sets.sort(key=lambda s: s.get("created_at") or "", reverse=True)
        return sets

    def get_pending(self, plan_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """The one set awaiting review, newest first."""
        for record in self.list_sets():
            if record.get("status") != SET_STATUS_PENDING:
                continue
            if plan_id and record.get("plan_id") != plan_id:
                continue
            return record
        return None

    def supersede_pending(self, plan_id: str, keep_id: Optional[str] = None) -> None:
        """Retire older pending sets so only one proposal is live at a time."""
        now = datetime.now().isoformat()
        for record in self.list_sets():
            if record["id"] == keep_id:
                continue
            if record.get("plan_id") != plan_id:
                continue
            if record.get("status") != SET_STATUS_PENDING:
                continue
            self._collection().document(record["id"]).update({
                "status": SET_STATUS_SUPERSEDED,
                "updated_at": now,
            })

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
            # Lets apply detect that the plan moved on since the proposal
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
        self.supersede_pending(plan.get("id"), keep_id=doc_ref.id)
        return {"id": doc_ref.id, **record}

    def mark_edits(
        self, set_id: str, outcomes: Dict[str, str]
    ) -> Optional[Dict[str, Any]]:
        """Write per-edit outcomes back and re-derive the set's status."""
        record = self.get(set_id)
        if not record:
            return None
        edits = [
            {**edit, "status": outcomes.get(str(edit.get("id")), edit.get("status")),
             **({"resolved_at": datetime.now().isoformat()}
                if outcomes.get(str(edit.get("id"))) else {})}
            for edit in (record.get("edits") or [])
        ]
        update = {
            "edits": edits,
            "status": set_status_for(edits),
            "updated_at": datetime.now().isoformat(),
        }
        self._collection().document(set_id).update(update)
        return {**record, **update}

    def delete(self, set_id: str) -> bool:
        doc = self._collection().document(set_id)
        if not doc.get().exists:
            return False
        doc.delete()
        return True
