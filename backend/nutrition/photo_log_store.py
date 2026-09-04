"""
Persist meal-photo estimates and Fix Results chats for testing / review.

Images go into Firestore as compressed JPEG base64 (Firebase Storage is not
provisioned for this project yet). Docs live at:

    users/{uid}/food_photo_logs/{log_id}

Each doc holds the upload, the initial estimate, and every adjust-chat turn.
"""

from __future__ import annotations

import base64
import os
from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional

from PIL import Image

COLLECTION = "food_photo_logs"

# Keep well under Firestore's 1MB doc limit after JSON overhead.
ARCHIVE_MAX_EDGE = 1024
ARCHIVE_JPEG_QUALITY = 72
ARCHIVE_MAX_BYTES = 700_000


def _now() -> str:
    return datetime.now().isoformat()


def _collection(db, user_id: str):
    return db.collection("users").document(user_id).collection(COLLECTION)


def compress_image_for_archive(image_path: str) -> Optional[Dict[str, Any]]:
    """Resize + re-encode a meal photo for durable storage."""
    if not image_path or not os.path.exists(image_path):
        return None
    try:
        with Image.open(image_path) as source:
            source.load()
            image = source.convert("RGB")
            image.thumbnail(
                (ARCHIVE_MAX_EDGE, ARCHIVE_MAX_EDGE),
                Image.Resampling.LANCZOS,
            )
            quality = ARCHIVE_JPEG_QUALITY
            payload = b""
            while quality >= 45:
                buffer = BytesIO()
                image.save(buffer, format="JPEG", quality=quality, optimize=True)
                payload = buffer.getvalue()
                if len(payload) <= ARCHIVE_MAX_BYTES:
                    break
                quality -= 8
            if not payload or len(payload) > ARCHIVE_MAX_BYTES:
                # Last resort: shrink further.
                image.thumbnail((720, 720), Image.Resampling.LANCZOS)
                buffer = BytesIO()
                image.save(buffer, format="JPEG", quality=55, optimize=True)
                payload = buffer.getvalue()
            if not payload:
                return None
            return {
                "image_base64": base64.b64encode(payload).decode("ascii"),
                "image_content_type": "image/jpeg",
                "image_bytes": len(payload),
                "image_width": image.width,
                "image_height": image.height,
            }
    except Exception as exc:
        print(f"Warning: could not archive food photo: {exc}")
        return None


def load_archived_image(db, user_id: str, log_id: Optional[str]) -> Optional[str]:
    """Return the archived meal photo as a data URL, or None.

    The temp upload is deleted right after the first estimate, so the Fix
    Results chat re-reads the photo from this archive instead of revising a
    number it cannot see.
    """
    if not log_id:
        return None
    try:
        snap = _collection(db, user_id).document(log_id).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        encoded = data.get("image_base64")
        if not encoded or not data.get("has_image"):
            return None
        mime = str(data.get("image_content_type") or "image/jpeg")
        return f"data:{mime};base64,{encoded}"
    except Exception as exc:
        print(f"Warning: could not load archived food photo: {exc}")
        return None


def create_photo_log(
    db,
    user_id: str,
    *,
    estimate: Optional[Dict[str, Any]] = None,
    image_path: Optional[str] = None,
    title: Optional[str] = None,
    description: Optional[str] = None,
    cooking_style: Optional[str] = None,
    model: Optional[str] = None,
    source: str = "photo",
) -> Optional[str]:
    """Create a food photo / estimate log. Returns the new doc id."""
    try:
        now = _now()
        payload: Dict[str, Any] = {
            "created_at": now,
            "updated_at": now,
            "source": source,
            "title": (title or "").strip()[:120] or None,
            "description": (description or "").strip()[:500] or None,
            "cooking_style": cooking_style,
            "model": model,
            "initial_estimate": estimate,
            "revised_estimate": None,
            "chat": [],
            "chat_turn_count": 0,
        }
        archive = compress_image_for_archive(image_path) if image_path else None
        if archive:
            payload.update(archive)
            payload["has_image"] = True
        else:
            payload["has_image"] = False

        doc_ref = _collection(db, user_id).document()
        doc_ref.set(payload)
        return doc_ref.id
    except Exception as exc:
        print(f"Warning: could not create food photo log: {exc}")
        return None


def record_accepted_estimate(
    db,
    user_id: str,
    log_id: Optional[str],
    estimate: Optional[Dict[str, Any]],
) -> bool:
    """Record the macros the user actually logged for this photo.

    This is the ground-truth label. `initial_estimate` is what the model
    guessed and `revised_estimate` is what it guessed after being argued with —
    neither is evidence the user agreed. Only the value they committed to their
    day is, and without recording it the archive is a pile of unlabelled
    photos that cannot score a prompt change.
    """
    if not log_id or not isinstance(estimate, dict):
        return False
    try:
        _collection(db, user_id).document(log_id).set(
            {
                "accepted_estimate": {
                    "name": str(estimate.get("name") or "").strip()[:120] or None,
                    "amount": str(estimate.get("amount") or "").strip()[:100] or None,
                    "calories": estimate.get("calories"),
                    "protein": estimate.get("protein"),
                    "carbs": estimate.get("carbs"),
                    "fats": estimate.get("fats"),
                    "fiber": estimate.get("fiber"),
                },
                "accepted_at": _now(),
                "updated_at": _now(),
            },
            merge=True,
        )
        return True
    except Exception as exc:
        print(f"Warning: could not record accepted estimate: {exc}")
        return False


def append_adjust_chat(
    db,
    user_id: str,
    log_id: Optional[str],
    *,
    user_message: str,
    assistant_reply: str,
    current_estimate: Optional[Dict[str, Any]] = None,
    revised_estimate: Optional[Dict[str, Any]] = None,
    conversation_history: Optional[List[Dict[str, Any]]] = None,
) -> Optional[str]:
    """
    Append a Fix Results turn. Creates a log if `log_id` is missing
    (e.g. description-only estimate that later entered chat).
    """
    try:
        now = _now()
        col = _collection(db, user_id)

        if not log_id:
            doc_ref = col.document()
            doc_ref.set(
                {
                    "created_at": now,
                    "updated_at": now,
                    "source": "adjust_chat",
                    "has_image": False,
                    "title": (current_estimate or {}).get("name"),
                    "initial_estimate": current_estimate,
                    "revised_estimate": revised_estimate,
                    "chat": [],
                    "chat_turn_count": 0,
                }
            )
            log_id = doc_ref.id
        else:
            doc_ref = col.document(log_id)

        snap = doc_ref.get()
        data = snap.to_dict() if snap.exists else {}
        chat = list(data.get("chat") or [])
        chat.append(
            {
                "role": "user",
                "content": (user_message or "").strip()[:1000],
                "created_at": now,
            }
        )
        chat.append(
            {
                "role": "assistant",
                "content": (assistant_reply or "").strip()[:4000],
                "created_at": now,
                "revised_estimate": revised_estimate,
            }
        )
        # Cap stored turns so a runaway client can't blow the doc.
        chat = chat[-40:]

        update: Dict[str, Any] = {
            "updated_at": now,
            "chat": chat,
            "chat_turn_count": len([m for m in chat if m.get("role") == "user"]),
            "revised_estimate": revised_estimate or data.get("revised_estimate"),
            "conversation_history": (conversation_history or [])[-12:],
        }
        if current_estimate and not data.get("initial_estimate"):
            update["initial_estimate"] = current_estimate
        doc_ref.set(update, merge=True)
        return log_id
    except Exception as exc:
        print(f"Warning: could not append adjust chat: {exc}")
        return log_id
