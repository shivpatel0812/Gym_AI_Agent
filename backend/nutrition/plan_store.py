"""
Nutrition Plan Store - one live strategy per user.

Plans live in users/{uid}/nutrition_plans/{id}. Activating a plan retires
the previous live one so history is preserved. Users with no plan keep
using profile nutrition_targets as they do today.
"""

from datetime import datetime
from typing import Dict, List, Any, Optional

COLLECTION = "nutrition_plans"

STATUS_DRAFT = "draft"
STATUS_ACTIVE = "active"
STATUS_PAUSED = "paused"
STATUS_COMPLETED = "completed"

LIVE_STATUSES = {STATUS_ACTIVE, STATUS_PAUSED}


class NutritionPlanStore:
    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id

    def _collection(self):
        return self.db.collection("users").document(self.user_id).collection(COLLECTION)

    def get(self, plan_id: str) -> Optional[Dict[str, Any]]:
        doc = self._collection().document(plan_id).get()
        if not doc.exists:
            return None
        return {"id": doc.id, **(doc.to_dict() or {})}

    def get_active(self) -> Optional[Dict[str, Any]]:
        """The live plan. Paused still counts as current so the Plan page can show it."""
        candidates = [
            p for p in self.list_plans()
            if p.get("status") in LIVE_STATUSES
        ]
        if not candidates:
            return None
        candidates.sort(key=lambda p: p.get("updated_at") or p.get("created_at") or "", reverse=True)
        return candidates[0]

    def list_plans(self, limit: int = 30) -> List[Dict[str, Any]]:
        try:
            docs = list(self._collection().limit(limit).stream())
        except Exception as e:
            print(f"Warning: could not list nutrition plans: {e}")
            return []
        plans = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
        plans.sort(key=lambda p: p.get("created_at") or "", reverse=True)
        return plans

    def save_draft(self, plan: Dict[str, Any]) -> str:
        now = datetime.now().isoformat()
        record = {
            **plan,
            "status": STATUS_DRAFT,
            "created_at": now,
            "updated_at": now,
            "version": plan.get("version", 1),
        }
        doc_ref = self._collection().document()
        doc_ref.set(record)
        return doc_ref.id

    def activate(self, plan_id: str) -> Optional[Dict[str, Any]]:
        plan = self.get(plan_id)
        if not plan:
            return None

        now = datetime.now().isoformat()
        for other in self.list_plans():
            if other["id"] == plan_id:
                continue
            if other.get("status") in LIVE_STATUSES:
                self._collection().document(other["id"]).update({
                    "status": STATUS_COMPLETED,
                    "ended_at": now,
                    "updated_at": now,
                })

        self._collection().document(plan_id).update({
            "status": STATUS_ACTIVE,
            "updated_at": now,
            "ended_at": None,
        })
        return self.get(plan_id)

    def update(self, plan_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        plan = self.get(plan_id)
        if not plan:
            return None
        patch = {k: v for k, v in patch.items() if v is not None or k in (
            "strategy", "goal_detail", "typical_day_notes", "carryover_note",
            "food_priorities",
            "meal_anchors", "flexible_meals", "go_to_items", "blueprint_extras",
            "slot_profiles", "fast_food_places",
            "preferences", "targets",
        )}
        patch["updated_at"] = datetime.now().isoformat()
        patch["version"] = int(plan.get("version") or 1) + 1
        self._collection().document(plan_id).update(patch)
        return self.get(plan_id)

    def set_status(self, plan_id: str, status: str) -> Optional[Dict[str, Any]]:
        plan = self.get(plan_id)
        if not plan:
            return None
        now = datetime.now().isoformat()
        update = {"status": status, "updated_at": now}
        if status == STATUS_COMPLETED:
            update["ended_at"] = now
        self._collection().document(plan_id).update(update)
        return self.get(plan_id)

    def delete(self, plan_id: str) -> bool:
        doc = self._collection().document(plan_id)
        if not doc.get().exists:
            return False
        doc.delete()
        return True
