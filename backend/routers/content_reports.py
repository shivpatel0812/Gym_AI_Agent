"""
Reporting objectionable AI output.

App Store Guideline 1.2 requires a mechanism for users to flag content they
find offensive, and for the developer to act on reports. Reports land in a
top-level `ai_content_reports` collection so they can be reviewed across users.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from auth import get_user_email, get_user_id, require_admin
from db import db

router = APIRouter(prefix="/api/content-reports", tags=["content-reports"])

REPORT_COLLECTION = "ai_content_reports"

REPORT_REASONS = [
    "harmful_advice",
    "offensive",
    "sexual",
    "hateful",
    "dangerous_weight_advice",
    "factually_wrong",
    "other",
]


class ReportBody(BaseModel):
    content: str = Field(..., max_length=8000, description="The AI message being reported")
    reason: str = Field("other", description=f"One of: {', '.join(REPORT_REASONS)}")
    details: Optional[str] = Field(None, max_length=2000)
    conversation_id: Optional[str] = None


@router.post("")
async def report_content(
    body: ReportBody,
    user_id: str = Depends(get_user_id),
    email: str = Depends(get_user_email),
):
    reason = body.reason if body.reason in REPORT_REASONS else "other"
    payload = {
        "uid": user_id,
        "email": email,
        "content": body.content[:8000],
        "reason": reason,
        "details": body.details,
        "conversation_id": body.conversation_id,
        "status": "open",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    ref = db.collection(REPORT_COLLECTION).document()
    ref.set(payload)
    print(f"content report {ref.id} filed by {user_id}: {reason}")
    return {
        "status": "received",
        "report_id": ref.id,
        "message": "Thanks — this response has been flagged for review.",
    }


@router.get("/reasons")
async def report_reasons():
    return {"reasons": REPORT_REASONS}


@router.get("/admin")
async def admin_list_reports(
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    _admin: dict = Depends(require_admin),
):
    query = db.collection(REPORT_COLLECTION)
    if status:
        query = query.where("status", "==", status)
    return {
        "reports": [{"id": doc.id, **(doc.to_dict() or {})} for doc in query.limit(limit).stream()]
    }


@router.patch("/admin/{report_id}")
async def admin_resolve_report(
    report_id: str,
    status: str = Query(..., description="open | reviewed | actioned | dismissed"),
    admin: dict = Depends(require_admin),
):
    db.collection(REPORT_COLLECTION).document(report_id).set(
        {
            "status": status,
            "reviewed_by": admin.get("email") or admin.get("uid"),
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        },
        merge=True,
    )
    return {"status": status, "report_id": report_id}
