"""
AI usage quota and access requests.

Every user starts on a free tier with a small number of AI calls per day. When
they run out they can file an access request; an admin (or the Firebase console)
raises their limit.

Firestore layout — both top-level so an admin can query across users:
  ai_access/{uid}           current tier, limit, and today's counter
  ai_access_requests/{uid}  the user's latest request and its review state
"""

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from firebase_admin import firestore

from db import db

# Free-tier calls per day. Overridable so you can loosen it without a redeploy.
DEFAULT_DAILY_LIMIT = int(os.getenv("AI_FREE_DAILY_LIMIT", "5"))

# What an approved request grants when the admin doesn't name a number.
DEFAULT_GRANTED_LIMIT = int(os.getenv("AI_GRANTED_DAILY_LIMIT", "50"))

# Ceiling on what a user may ask for, so the request form can't be used to
# self-grant something absurd.
MAX_REQUESTABLE_LIMIT = 200

TIER_FREE = "free"
TIER_EXTENDED = "extended"
TIER_UNLIMITED = "unlimited"

STATUS_NONE = "none"
STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_DENIED = "denied"

ACCESS_COLLECTION = "ai_access"
REQUEST_COLLECTION = "ai_access_requests"


def _today() -> str:
    """Usage day key. UTC so the reset point doesn't move with the user."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _access_ref(user_id: str):
    return db.collection(ACCESS_COLLECTION).document(user_id)


def _request_ref(user_id: str):
    return db.collection(REQUEST_COLLECTION).document(user_id)


def _normalize(data: Optional[dict]) -> dict:
    """Fill in defaults for a missing or partial access doc."""
    data = data or {}
    tier = data.get("tier") or TIER_FREE
    limit = data.get("daily_limit")
    if not isinstance(limit, int) or limit < 0:
        limit = DEFAULT_DAILY_LIMIT
    used = data.get("used_today")
    if not isinstance(used, int) or used < 0:
        used = 0
    # A counter from an earlier day is already spent — treat it as zero.
    if data.get("usage_date") != _today():
        used = 0
    return {
        "tier": tier,
        "daily_limit": limit,
        "used_today": used,
        "usage_date": _today(),
        "lifetime_used": data.get("lifetime_used") or 0,
    }


def get_status(user_id: str) -> dict:
    """Current quota state plus the state of any access request."""
    snapshot = _access_ref(user_id).get()
    state = _normalize(snapshot.to_dict() if snapshot.exists else None)

    request_snapshot = _request_ref(user_id).get()
    request = request_snapshot.to_dict() if request_snapshot.exists else None

    unlimited = state["tier"] == TIER_UNLIMITED
    remaining = None if unlimited else max(0, state["daily_limit"] - state["used_today"])

    return {
        "tier": state["tier"],
        "unlimited": unlimited,
        "daily_limit": state["daily_limit"],
        "used_today": state["used_today"],
        "remaining": remaining,
        "lifetime_used": state["lifetime_used"],
        "resets_at": f"{_today()}T24:00:00Z",
        "request_status": (request or {}).get("status", STATUS_NONE),
        "request_reviewed_note": (request or {}).get("review_note"),
        "can_request": (request or {}).get("status") not in (STATUS_PENDING, STATUS_APPROVED),
    }


def quota_error_detail(status: dict) -> dict:
    """Body for the 429 so the client can render the request-access prompt."""
    return {
        "error": "ai_quota_exceeded",
        "message": (
            f"You've used all {status['daily_limit']} of today's AI requests. "
            "Your limit resets tomorrow, or you can request expanded access."
        ),
        "daily_limit": status["daily_limit"],
        "used_today": status["used_today"],
        "request_status": status["request_status"],
        "can_request": status["can_request"],
    }


def consume(user_id: str, cost: int = 1) -> dict:
    """
    Reserve `cost` AI calls, atomically.

    Raises 429 if that would exceed the user's daily limit. Reserving up front
    (rather than counting afterwards) means two concurrent requests can't both
    slip through on the last remaining call. Call `refund` if the AI request
    then fails, so a server error doesn't burn the user's quota.
    """
    transaction = db.transaction()
    ref = _access_ref(user_id)

    @firestore.transactional
    def _apply(txn) -> dict:
        snapshot = ref.get(transaction=txn)
        state = _normalize(snapshot.to_dict() if snapshot.exists else None)

        if state["tier"] != TIER_UNLIMITED:
            if state["used_today"] + cost > state["daily_limit"]:
                return {"allowed": False, **state}

        txn.set(
            ref,
            {
                "tier": state["tier"],
                "daily_limit": state["daily_limit"],
                "used_today": state["used_today"] + cost,
                "usage_date": state["usage_date"],
                "lifetime_used": state["lifetime_used"] + cost,
                "updated_at": _now(),
            },
            merge=True,
        )
        return {"allowed": True, **state, "used_today": state["used_today"] + cost}

    result = _apply(transaction)
    if not result["allowed"]:
        raise HTTPException(status_code=429, detail=quota_error_detail(get_status(user_id)))
    return result


def refund(user_id: str, cost: int = 1) -> None:
    """Give back a reserved call after a failed AI request. Never raises."""
    try:
        transaction = db.transaction()
        ref = _access_ref(user_id)

        @firestore.transactional
        def _apply(txn) -> None:
            snapshot = ref.get(transaction=txn)
            if not snapshot.exists:
                return
            state = _normalize(snapshot.to_dict())
            txn.set(
                ref,
                {
                    "used_today": max(0, state["used_today"] - cost),
                    "lifetime_used": max(0, state["lifetime_used"] - cost),
                    "usage_date": state["usage_date"],
                    "updated_at": _now(),
                },
                merge=True,
            )

        _apply(transaction)
    except Exception as exc:  # pragma: no cover - refunds are best-effort
        print(f"ai_access: refund failed for {user_id}: {exc}")


def create_request(user_id: str, email: Optional[str], reason: str, requested_limit: int) -> dict:
    """File (or re-file) an access request. One live request per user."""
    reason = (reason or "").strip()
    if len(reason) < 10:
        raise HTTPException(
            status_code=422,
            detail="Tell us a little about how you plan to use the AI coach (at least 10 characters).",
        )
    if len(reason) > 1000:
        raise HTTPException(status_code=422, detail="Please keep your reason under 1000 characters.")
    if not isinstance(requested_limit, int) or not 1 <= requested_limit <= MAX_REQUESTABLE_LIMIT:
        raise HTTPException(
            status_code=422,
            detail=f"Requested daily limit must be between 1 and {MAX_REQUESTABLE_LIMIT}.",
        )

    ref = _request_ref(user_id)
    existing = ref.get()
    if existing.exists and (existing.to_dict() or {}).get("status") == STATUS_PENDING:
        raise HTTPException(status_code=409, detail="You already have a request awaiting review.")

    payload = {
        "uid": user_id,
        "email": email,
        "reason": reason,
        "requested_limit": requested_limit,
        "status": STATUS_PENDING,
        "created_at": _now(),
        "reviewed_at": None,
        "reviewed_by": None,
        "review_note": None,
    }
    ref.set(payload)
    return payload


def get_request(user_id: str) -> Optional[dict]:
    snapshot = _request_ref(user_id).get()
    return snapshot.to_dict() if snapshot.exists else None


def list_requests(status: Optional[str] = None, limit: int = 100) -> list:
    query = db.collection(REQUEST_COLLECTION)
    if status:
        query = query.where("status", "==", status)
    return [doc.to_dict() for doc in query.limit(limit).stream()]


def review_request(
    target_uid: str,
    approve: bool,
    reviewer: str,
    granted_limit: Optional[int] = None,
    note: Optional[str] = None,
) -> dict:
    """Approve or deny a request. Approving raises the user's daily limit."""
    ref = _request_ref(target_uid)
    snapshot = ref.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="No access request for that user.")

    status = STATUS_APPROVED if approve else STATUS_DENIED
    ref.set(
        {
            "status": status,
            "reviewed_at": _now(),
            "reviewed_by": reviewer,
            "review_note": note,
            "granted_limit": granted_limit if approve else None,
        },
        merge=True,
    )

    if approve:
        requested = (snapshot.to_dict() or {}).get("requested_limit") or DEFAULT_GRANTED_LIMIT
        new_limit = granted_limit or requested
        new_limit = max(1, min(int(new_limit), MAX_REQUESTABLE_LIMIT))
        set_limit(target_uid, new_limit, tier=TIER_EXTENDED)

    return {"uid": target_uid, "status": status}


def set_limit(user_id: str, daily_limit: int, tier: str = TIER_EXTENDED) -> dict:
    """Directly set a user's tier and daily limit (admin / console escape hatch)."""
    _access_ref(user_id).set(
        {
            "tier": tier,
            "daily_limit": int(daily_limit),
            "updated_at": _now(),
        },
        merge=True,
    )
    return get_status(user_id)


def purge(user_id: str) -> None:
    """Remove a user's quota and request docs. Used by account deletion."""
    for ref in (_access_ref(user_id), _request_ref(user_id)):
        try:
            ref.delete()
        except Exception as exc:  # pragma: no cover
            print(f"ai_access: purge failed for {user_id}: {exc}")
