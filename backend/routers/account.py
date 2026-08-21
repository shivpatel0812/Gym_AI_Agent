"""
Account lifecycle endpoints.

App Store Guideline 5.1.1(v) requires any app that lets users create an account
to let them delete it from inside the app — not via a support email, and not
just a deactivation. This deletes the user's Firestore data and their Firebase
Auth record.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from firebase_admin import auth as firebase_auth
from pydantic import BaseModel, Field

import ai_access
from auth import get_user_email, get_user_id
from db import db

router = APIRouter(prefix="/api/account", tags=["account"])

# Every subcollection hanging off users/{uid}. Kept explicit rather than
# discovered so a new feature collection has to be added here deliberately —
# and so a partial delete is impossible to do silently.
USER_SUBCOLLECTIONS = [
    "exercises",
    "splits",
    "workout_sessions",
    "workout_plans",
    "workout_ai_summary",
    "nutrition_plans",
    "physical_activities",
    "macros",
    "foods",
    "hydration",
    "stress",
    "body_feelings",
    "wellness_survey",
    "sleep",
    "daily_routines",
    "ai_analyses",
    "coach_conversations",
    "user_profile",
    "body_scans",
    "training_focus",
    "settings",
]

DELETE_BATCH_SIZE = 400


class DeleteAccountBody(BaseModel):
    confirmation: str = Field(..., description='Must be the literal string "DELETE"')


def _delete_collection(collection_ref) -> int:
    """Delete every document in a collection, in batches. Returns the count."""
    deleted = 0
    while True:
        docs = list(collection_ref.limit(DELETE_BATCH_SIZE).stream())
        if not docs:
            return deleted
        batch = db.batch()
        for doc in docs:
            # Nested subcollections (e.g. conversations/{id}/messages) go first
            for sub in doc.reference.collections():
                deleted += _delete_collection(sub)
            batch.delete(doc.reference)
            deleted += 1
        batch.commit()
        if len(docs) < DELETE_BATCH_SIZE:
            return deleted


@router.get("/export")
async def export_account_data(user_id: str = Depends(get_user_id)):
    """
    Everything stored under this account, as JSON.

    Offered alongside deletion so a user isn't forced to choose between keeping
    their data and closing their account.
    """
    export = {"uid": user_id, "exported_at": datetime.now(timezone.utc).isoformat()}
    user_ref = db.collection("users").document(user_id)
    for name in USER_SUBCOLLECTIONS:
        try:
            export[name] = [
                {"id": doc.id, **(doc.to_dict() or {})}
                for doc in user_ref.collection(name).limit(2000).stream()
            ]
        except Exception as exc:
            print(f"account export: {name} failed for {user_id}: {exc}")
            export[name] = []
    export["ai_access"] = ai_access.get_status(user_id)
    return export


@router.delete("")
async def delete_account(
    body: DeleteAccountBody,
    user_id: str = Depends(get_user_id),
    email: str = Depends(get_user_email),
):
    """
    Permanently delete the signed-in user's account and all of their data.

    Order matters: Firestore data first, auth record last. If the auth delete
    fails the user can retry; if we deleted auth first, a Firestore failure
    would strand orphaned data with no way for the user to reach it.
    """
    if body.confirmation != "DELETE":
        raise HTTPException(
            status_code=400,
            detail='Type DELETE to confirm permanent account deletion.',
        )

    deleted_docs = 0
    failures = []
    user_ref = db.collection("users").document(user_id)

    for name in USER_SUBCOLLECTIONS:
        try:
            deleted_docs += _delete_collection(user_ref.collection(name))
        except Exception as exc:
            print(f"account delete: {name} failed for {user_id}: {exc}")
            failures.append(name)

    # Anything added since USER_SUBCOLLECTIONS was last updated
    try:
        for sub in user_ref.collections():
            if sub.id not in USER_SUBCOLLECTIONS:
                deleted_docs += _delete_collection(sub)
    except Exception as exc:
        print(f"account delete: sweep failed for {user_id}: {exc}")

    try:
        user_ref.delete()
    except Exception as exc:
        print(f"account delete: root doc failed for {user_id}: {exc}")

    ai_access.purge(user_id)

    if failures:
        raise HTTPException(
            status_code=500,
            detail=(
                "Some of your data could not be deleted, so your account was kept "
                "active. Please try again — nothing was partially removed from your "
                "login. If this keeps happening, contact support."
            ),
        )

    try:
        firebase_auth.delete_user(user_id)
    except firebase_auth.UserNotFoundError:
        pass  # Already gone; the data delete above is what mattered
    except Exception as exc:
        print(f"account delete: auth delete failed for {user_id}: {exc}")
        raise HTTPException(
            status_code=500,
            detail="Your data was removed but your login could not be deleted. Please try again.",
        )

    print(f"account delete: completed for {user_id} ({email}), {deleted_docs} documents")
    return {"status": "deleted", "documents_deleted": deleted_docs}
