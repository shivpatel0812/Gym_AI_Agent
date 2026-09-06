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
#
# The cap is on *raw* JPEG bytes, but the doc stores base64, which is 4/3 the
# size. At the old 700_000 the encoded string alone was ~933 KB against a
# 1,048,576 byte document ceiling, leaving ~115 KB for the estimate, the
# component ledger, the chat and the conversation history. A big multi-course
# estimate could push the write over, `doc_ref.set()` would raise, and the log
# — and with it the photo the Fix Results chat re-reads — was lost entirely.
ARCHIVE_MAX_EDGE = 1024
ARCHIVE_JPEG_QUALITY = 72
ARCHIVE_MAX_BYTES = 480_000
# What the encoded image is allowed to occupy, leaving the rest of the budget
# for text. Checked against the base64 length, not the raw length.
ARCHIVE_MAX_ENCODED_BYTES = 660_000

# Why a log holds no photo. Reported to the client so a correction chat can
# say it is working from numbers alone instead of implying it looked again.
PHOTO_OK = "ok"
PHOTO_NO_LOG = "no_log"
PHOTO_LOG_MISSING = "log_missing"
PHOTO_NOT_ARCHIVED = "not_archived"
PHOTO_READ_ERROR = "read_error"


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
            encoded = base64.b64encode(payload).decode("ascii")
            if len(encoded) > ARCHIVE_MAX_ENCODED_BYTES:
                # Still too big to sit in a document alongside the estimate.
                # Returning it anyway means the whole write fails and the log
                # disappears; dropping it here keeps the log and lets the
                # chat say the photo was not kept.
                print(
                    "Warning: archived food photo exceeds the document budget "
                    f"({len(encoded)} b64 bytes); storing the log without it"
                )
                return None
            return {
                "image_base64": encoded,
                "image_content_type": "image/jpeg",
                "image_bytes": len(payload),
                "image_width": image.width,
                "image_height": image.height,
            }
    except Exception as exc:
        print(f"Warning: could not archive food photo: {exc}")
        return None


def load_archived_image_result(
    db, user_id: str, log_id: Optional[str]
) -> Dict[str, Any]:
    """Return the archived meal photo as a data URL **and why, if not**.

    The temp upload is deleted right after the first estimate, so the Fix
    Results chat re-reads the photo from this archive instead of revising a
    number it cannot see. Every way that can fail used to return a bare None,
    which the chat then treated as "no photo" without telling anyone — so a
    revision made from the ledger alone was indistinguishable from one made by
    looking at the plate again. The reason travels with the answer now.

    ``model`` comes back from the same read: it is the model that actually
    produced the stored estimate (escalation makes that differ from what the
    client asked for), and the correction chat needs it. Fetching it
    separately would be a second round trip for a document already in hand.

    Returns ``{"data_url": str | None, "status": str, "model": str | None}``.
    """
    if not log_id:
        return {"data_url": None, "status": PHOTO_NO_LOG, "model": None}
    try:
        snap = _collection(db, user_id).document(log_id).get()
        if not snap.exists:
            return {"data_url": None, "status": PHOTO_LOG_MISSING, "model": None}
        data = snap.to_dict() or {}
        model = data.get("model")
        encoded = data.get("image_base64")
        if not encoded or not data.get("has_image"):
            return {"data_url": None, "status": PHOTO_NOT_ARCHIVED, "model": model}
        mime = str(data.get("image_content_type") or "image/jpeg")
        return {
            "data_url": f"data:{mime};base64,{encoded}",
            "status": PHOTO_OK,
            "model": model,
        }
    except Exception as exc:
        print(f"Warning: could not load archived food photo: {exc}")
        return {"data_url": None, "status": PHOTO_READ_ERROR, "model": None}


def load_archived_image(db, user_id: str, log_id: Optional[str]) -> Optional[str]:
    """The data URL alone, for callers that only need the image."""
    return load_archived_image_result(db, user_id, log_id).get("data_url")


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
    archive: Optional[Dict[str, Any]] = None,
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
        if archive is None and image_path:
            archive = compress_image_for_archive(image_path)
        if archive:
            payload.update(archive)
            payload["has_image"] = True
        else:
            payload["has_image"] = False

        doc_ref = _collection(db, user_id).document()
        try:
            doc_ref.set(payload)
        except Exception as exc:
            if not payload.get("has_image"):
                raise
            # Almost always the document size limit. Losing the whole log also
            # loses the chat linkage and the accepted-estimate label, which is
            # a worse outcome than losing the image: keep the log, record that
            # the photo did not survive, and let the chat say so.
            print(f"Warning: photo log write failed with image ({exc}); retrying without it")
            for key in (
                "image_base64",
                "image_content_type",
                "image_bytes",
                "image_width",
                "image_height",
            ):
                payload.pop(key, None)
            payload["has_image"] = False
            payload["archive_dropped"] = "write_failed"
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
                    "sugar": estimate.get("sugar"),
                    "sodium": estimate.get("sodium"),
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
