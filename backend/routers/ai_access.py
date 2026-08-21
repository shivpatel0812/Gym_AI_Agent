"""
AI usage quota and access-request endpoints.

Users see their remaining daily AI calls and can request expanded access.
Admins (ADMIN_EMAILS env var, or an `admin: true` custom claim) review requests.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

import ai_access
from auth import get_user_email, get_user_id, require_admin

router = APIRouter(prefix="/api/ai-access", tags=["ai-access"])


class AccessRequestBody(BaseModel):
    reason: str = Field(..., description="Why the user needs more AI access")
    requested_limit: int = Field(
        ai_access.DEFAULT_GRANTED_LIMIT,
        ge=1,
        le=ai_access.MAX_REQUESTABLE_LIMIT,
    )


class ReviewBody(BaseModel):
    approve: bool
    granted_limit: Optional[int] = Field(None, ge=1, le=ai_access.MAX_REQUESTABLE_LIMIT)
    note: Optional[str] = None


@router.get("/status")
async def ai_access_status(user_id: str = Depends(get_user_id)):
    """Remaining AI calls for today plus the state of any access request."""
    return ai_access.get_status(user_id)


@router.get("/request")
async def my_access_request(user_id: str = Depends(get_user_id)):
    return ai_access.get_request(user_id) or {"status": ai_access.STATUS_NONE}


@router.post("/request")
async def submit_access_request(
    body: AccessRequestBody,
    user_id: str = Depends(get_user_id),
    email: str = Depends(get_user_email),
):
    return ai_access.create_request(user_id, email, body.reason, body.requested_limit)


@router.get("/admin/requests")
async def admin_list_requests(
    status: Optional[str] = Query(None, description="pending | approved | denied"),
    limit: int = Query(100, ge=1, le=500),
    _admin: dict = Depends(require_admin),
):
    return {"requests": ai_access.list_requests(status=status, limit=limit)}


@router.post("/admin/requests/{target_uid}")
async def admin_review_request(
    target_uid: str,
    body: ReviewBody,
    admin: dict = Depends(require_admin),
):
    return ai_access.review_request(
        target_uid,
        approve=body.approve,
        reviewer=admin.get("email") or admin.get("uid", "admin"),
        granted_limit=body.granted_limit,
        note=body.note,
    )


@router.get("/admin/users/{target_uid}")
async def admin_user_status(target_uid: str, _admin: dict = Depends(require_admin)):
    return ai_access.get_status(target_uid)


@router.put("/admin/users/{target_uid}/limit")
async def admin_set_limit(
    target_uid: str,
    daily_limit: int = Query(..., ge=0, le=ai_access.MAX_REQUESTABLE_LIMIT),
    tier: str = Query(ai_access.TIER_EXTENDED),
    _admin: dict = Depends(require_admin),
):
    return ai_access.set_limit(target_uid, daily_limit, tier=tier)
