"""
Plan Store - lifecycle and history for Active Plans.

Plans live in users/{uid}/workout_plans alongside the wizard-generated
structural plans, distinguished by plan_type. Activating a plan retires the
previous one rather than deleting it, so history is preserved.

is_active is kept in sync with status so existing queries (GET /today,
TodaysWorkoutCard) keep working unchanged.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

COLLECTION = "workout_plans"

STATUS_DRAFT = "draft"
STATUS_ACTIVE = "active"
STATUS_PAUSED = "paused"
STATUS_COMPLETED = "completed"

LIVE_STATUSES = {STATUS_ACTIVE}


class PlanStore:
    """Reads and writes training plans."""

    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id

    def _collection(self):
        return self.db.collection("users").document(self.user_id).collection(COLLECTION)

    # --- reads ------------------------------------------------------------

    def get(self, plan_id: str) -> Optional[Dict[str, Any]]:
        doc = self._collection().document(plan_id).get()
        if not doc.exists:
            return None
        return {"id": doc.id, **(doc.to_dict() or {})}

    def get_active(self) -> Optional[Dict[str, Any]]:
        """The live plan, preferring a goal plan over a legacy structural one."""
        candidates = [
            p for p in self.list_plans()
            if p.get("status") in LIVE_STATUSES
            or (p.get("status") is None and p.get("is_active"))
        ]
        if not candidates:
            return None
        candidates.sort(
            key=lambda p: (p.get("plan_type") == "goal", p.get("created_at") or ""),
            reverse=True,
        )
        return candidates[0]

    def list_plans(self, limit: int = 50) -> List[Dict[str, Any]]:
        """All plans, newest first. Drafts included."""
        try:
            docs = list(self._collection().limit(limit).stream())
        except Exception as e:
            print(f"Warning: could not list plans: {e}")
            return []
        plans = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
        plans.sort(key=lambda p: p.get("created_at") or "", reverse=True)
        return plans

    def history(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Plan summaries for the history list — no day/exercise payloads."""
        summary_fields = (
            "id", "plan_name", "primary_goal", "status", "plan_type", "plan_mode",
            "start_date", "duration_weeks", "created_at", "ended_at", "version",
        )
        return [
            {k: plan.get(k) for k in summary_fields}
            for plan in self.list_plans(limit=limit)
            if plan.get("status") != STATUS_DRAFT
        ]

    # --- writes -----------------------------------------------------------

    def save_draft(self, plan: Dict[str, Any], source_conversation_id: Optional[str] = None) -> str:
        """Store a proposed plan for review. Drafts never drive recommendations."""
        now = datetime.now().isoformat()
        record = {
            **plan,
            "status": STATUS_DRAFT,
            "is_active": False,
            "created_at": now,
            "updated_at": now,
            "source_conversation_id": source_conversation_id,
            "version": plan.get("version", 1),
        }
        doc_ref = self._collection().document()
        doc_ref.set(record)
        return doc_ref.id

    def activate(self, plan_id: str) -> Optional[Dict[str, Any]]:
        """
        Make a plan live, retiring whatever was live before.

        The previous plan is marked completed, not deleted, so it stays in
        history and a new plan never destroys the old one.
        """
        plan = self.get(plan_id)
        if not plan:
            return None

        now = datetime.now()
        for other in self.list_plans():
            if other["id"] == plan_id:
                continue
            is_live = other.get("status") in LIVE_STATUSES or (
                other.get("status") is None and other.get("is_active")
            )
            if is_live:
                self._collection().document(other["id"]).update({
                    "status": STATUS_COMPLETED,
                    "is_active": False,
                    "ended_at": now.isoformat(),
                    "updated_at": now.isoformat(),
                })

        start_date = plan.get("start_date") or now.strftime("%Y-%m-%d")
        update = {
            "status": STATUS_ACTIVE,
            "is_active": True,
            "start_date": start_date,
            "updated_at": now.isoformat(),
        }
        self._collection().document(plan_id).update(update)
        return {**plan, **update}

    def set_status(self, plan_id: str, status: str) -> Optional[Dict[str, Any]]:
        """Pause, resume, or complete a plan."""
        plan = self.get(plan_id)
        if not plan:
            return None

        now = datetime.now().isoformat()
        update: Dict[str, Any] = {
            "status": status,
            "is_active": status == STATUS_ACTIVE,
            "updated_at": now,
        }
        if status == STATUS_COMPLETED:
            update["ended_at"] = now
        self._collection().document(plan_id).update(update)
        return {**plan, **update}

    def replace_active(
        self, new_plan: Dict[str, Any], previous_plan_id: Optional[str] = None,
        source_conversation_id: Optional[str] = None,
    ) -> str:
        """Save an adjusted plan as a new version that supersedes the old one."""
        previous = self.get(previous_plan_id) if previous_plan_id else self.get_active()
        draft = dict(new_plan)
        if previous:
            draft["supersedes_plan_id"] = previous["id"]
            draft["version"] = int(previous.get("version", 1)) + 1
            # A revision continues the original block rather than restarting it
            draft.setdefault("start_date", previous.get("start_date"))
        return self.save_draft(draft, source_conversation_id=source_conversation_id)

    def delete(self, plan_id: str) -> bool:
        doc_ref = self._collection().document(plan_id)
        if not doc_ref.get().exists:
            return False
        doc_ref.delete()
        return True

    # --- progress ---------------------------------------------------------

    @staticmethod
    def progress(plan: Dict[str, Any]) -> Dict[str, Any]:
        """Week N of M for the Plan tab."""
        start_date = plan.get("start_date")
        duration = plan.get("duration_weeks")
        if not start_date or not duration:
            return {"current_week": None, "total_weeks": duration}
        try:
            start = datetime.fromisoformat(start_date)
        except (TypeError, ValueError):
            return {"current_week": None, "total_weeks": duration}

        elapsed_days = (datetime.now() - start).days
        current_week = max(1, min(int(duration), elapsed_days // 7 + 1))
        return {
            "current_week": current_week,
            "total_weeks": duration,
            "days_elapsed": max(0, elapsed_days),
            "ends_on": (start + timedelta(weeks=duration)).strftime("%Y-%m-%d"),
        }
