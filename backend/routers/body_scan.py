"""
AI Body Scan API.

Flow: consent → multipart front/side/back photos + goal text → vision (ephemeral)
→ structured goal → deterministic synthesis → LLM explanation → store JSON only.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

import ai_access
from auth import get_user_id
from db import db
from moderation import check_text
from body_scan import (
    CONSENT_VERSION,
    BodyScanStore,
    analyze_scan_photos,
    parse_goal_text,
    synthesize,
    explain_synthesis,
    summarize_training_history,
    diff_scans,
)
from body_scan.vision import ScanImage
from body_scan.schemas import normalize_synthesis
from ai_analysis.workout_recommender.training_focus import TrainingFocusStore
from ai_analysis.workout_recommender.goal_configs import resolve_goal_key

router = APIRouter(prefix="/api/body-scan", tags=["body-scan"])

VIEWS = ("front", "side", "back")

DIRECTION_TO_GOAL = {
    "hypertrophy": "hypertrophy",
    "strength": "strength",
    "cut": "fat_loss",
    "recomp": "hypertrophy",
    "maintain": "general",
}

EMPHASIS_TO_EXERCISE_HINTS = {
    "shoulders": ["lateral raise", "overhead press", "face pull"],
    "rear_delts": ["face pull", "rear delt"],
    "chest": ["bench", "incline", "chest"],
    "back": ["row", "pulldown", "pull-up"],
    "upper_pull": ["row", "face pull", "pulldown"],
    "upper_push": ["press", "bench"],
    "arms": ["curl", "tricep"],
    "legs": ["squat", "leg", "rdl"],
    "glutes": ["hip thrust", "glute"],
    "core": ["plank", "cable crunch"],
}


def _store(user_id: str) -> BodyScanStore:
    return BodyScanStore(db, user_id)


def _require_consent(user_id: str):
    consent = _store(user_id).get_consent()
    if not consent or consent.get("version") != CONSENT_VERSION:
        raise HTTPException(
            status_code=403,
            detail="Body scan consent required before uploading photos.",
        )


def _recent_sessions(user_id: str, limit: int = 30) -> List[dict]:
    """Most recent sessions by date — ordered by Firestore, not by arbitrary page."""
    sessions_ref = (
        db.collection("users").document(user_id).collection("workout_sessions")
    )
    try:
        docs = list(
            sessions_ref.order_by("date", direction="DESCENDING").limit(limit).stream()
        )
        return [{"id": d.id, **(d.to_dict() or {})} for d in docs]
    except Exception:
        # Sessions predating the `date` field would be dropped by the order_by
        pass
    try:
        docs = list(sessions_ref.limit(limit * 2).stream())
    except Exception:
        return []
    sessions = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
    sessions.sort(key=lambda s: s.get("date") or s.get("created_at") or "", reverse=True)
    return sessions[:limit]


async def _read_upload(upload: UploadFile, view: str) -> ScanImage:
    """Read one view into memory. Photos are never written to disk."""
    data = await upload.read()
    if not data:
        raise HTTPException(status_code=400, detail=f"Empty upload: {upload.filename}")
    if len(data) > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 12MB)")
    mime = upload.content_type or "image/jpeg"
    if not mime.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"{view} must be an image")
    return ScanImage(data=data, mime=mime)


class ConsentBody(BaseModel):
    accepted: bool = True


class ApplyBody(BaseModel):
    apply: bool = True


@router.get("/consent")
async def get_consent(user_id: str = Depends(get_user_id)):
    consent = _store(user_id).get_consent()
    return {
        "status": "success",
        "required_version": CONSENT_VERSION,
        "consent": consent,
        "accepted": bool(consent and consent.get("version") == CONSENT_VERSION),
        "copy": {
            "title": "Body scan privacy",
            "body": (
                "Photos are analyzed to create coaching notes, then deleted. "
                "We keep structured observations (not the images) so we can track "
                "trends over time. This is appearance-based fitness coaching, "
                "not a medical or body-composition assessment."
            ),
        },
    }


@router.post("/consent")
async def accept_consent(body: ConsentBody, user_id: str = Depends(get_user_id)):
    if not body.accepted:
        raise HTTPException(status_code=400, detail="Consent must be accepted")
    data = _store(user_id).set_consent(CONSENT_VERSION)
    return {"status": "success", "consent": data}


@router.get("/latest")
async def latest_scan(user_id: str = Depends(get_user_id)):
    scan = _store(user_id).latest()
    return {"status": "success", "scan": scan}


@router.get("/progress")
async def scan_progress(user_id: str = Depends(get_user_id)):
    """Region-by-region change between the two most recent scans."""
    latest, previous = _store(user_id).latest_pair()
    return {"status": "success", "progress": diff_scans(latest, previous)}


@router.get("/")
async def list_scans(user_id: str = Depends(get_user_id)):
    return {"status": "success", "scans": _store(user_id).list(limit=24)}


@router.get("/{scan_id}")
async def get_scan(scan_id: str, user_id: str = Depends(get_user_id)):
    scan = _store(user_id).get(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return {"status": "success", "scan": scan}


@router.post("/analyze")
async def analyze_body_scan(
    goal_text: str = Form(...),
    model: Optional[str] = Form(None),
    front: UploadFile = File(...),
    side: UploadFile = File(...),
    back: UploadFile = File(...),
    user_id: str = Depends(get_user_id),
):
    _require_consent(user_id)
    ai_access.consume(user_id)

    goal_text = (goal_text or "").strip()
    if len(goal_text) < 3:
        raise HTTPException(status_code=400, detail="Please describe your goal")
    if len(goal_text) > 500:
        raise HTTPException(status_code=400, detail="Goal text too long")

    # Soft-moderate free text (don't block body-image language harshly)
    try:
        flagged, cats = check_text(goal_text)
        if flagged and any(c.startswith("self-harm") or "minors" in c for c in cats):
            raise HTTPException(status_code=400, detail="Goal text was flagged. Please rephrase.")
    except HTTPException:
        raise
    except Exception:
        pass

    images = {}
    try:
        for view, upload in (("front", front), ("side", side), ("back", back)):
            images[view] = await _read_upload(upload, view)

        observations = analyze_scan_photos(images, model=model)
        goal = parse_goal_text(goal_text, model=model)
        history = summarize_training_history(_recent_sessions(user_id))
        synthesis = synthesize(observations, goal, history)
        synthesis["explanation"] = explain_synthesis(observations, goal, synthesis, model=model)

        record = {
            "consent_version": CONSENT_VERSION,
            "views_captured": list(VIEWS),
            "observations": observations,
            "goal": goal,
            "history_summary": history,
            "synthesis": synthesis,
        }
        store = _store(user_id)
        previous = store.latest()
        saved = store.save(record)
        # Computed once at write time so every later reader — coach, clients —
        # sees the same comparison instead of recomputing it differently.
        progress = diff_scans(saved, previous)
        if progress.get("status") == "ok":
            saved = store.update(saved["id"], {"progress": progress}) or saved
        return {"status": "success", "scan": saved}
    finally:
        # Drop references to the raw bytes as soon as the request is done
        images.clear()


@router.post("/{scan_id}/apply")
async def apply_scan_focus(scan_id: str, body: ApplyBody, user_id: str = Depends(get_user_id)):
    """
    Apply synthesis emphasis as temporary training focuses (6 weeks).
    Does not invent loads — only goal overrides the progression engine already understands.
    """
    store = _store(user_id)
    scan = store.get(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    synthesis = normalize_synthesis(scan.get("synthesis"))
    if not body.apply:
        return {"status": "success", "scan": scan, "focuses": []}

    # Applying twice would stack duplicate focuses on the same muscle groups
    if synthesis.get("applied"):
        return {
            "status": "success",
            "scan": scan,
            "focuses": [],
            "message": "This scan's focus is already applied.",
        }

    # Emphasis is withheld on low-confidence photos, so there is nothing here
    # worth reshaping six weeks of training around.
    confidence = str((scan.get("observations") or {}).get("confidence") or "low").lower()
    if confidence == "low":
        raise HTTPException(
            status_code=400,
            detail=(
                "This scan's photos weren't clear enough to base training focus on. "
                "Retake in even lighting with your full body in frame."
            ),
        )

    direction = (scan.get("goal") or {}).get("direction") or "hypertrophy"
    goal_key = resolve_goal_key(DIRECTION_TO_GOAL.get(direction, "hypertrophy"))

    focus_store = TrainingFocusStore(db, user_id)
    created = []
    # Sort by absolute emphasis strength, take top 3 positive bumps
    ranked = sorted(
        ((k, v) for k, v in (synthesis.get("emphasis") or {}).items() if v.startswith("+")),
        key=lambda kv: int(kv[1]),
        reverse=True,
    )[:3]

    for group, level in ranked:
        hints = EMPHASIS_TO_EXERCISE_HINTS.get(group) or [group]
        note = (
            f"From body scan {scan_id[:8]}: emphasize {group} ({level}). "
            f"{(synthesis.get('explanation') or '')[:160]}"
        )
        try:
            focus = focus_store.set_focus(
                exercise_name=hints[0],
                goal=goal_key,
                exercise_id=None,
                note=note,
                duration_weeks=6,
            )
            if focus:
                created.append(focus)
        except Exception as e:
            print(f"apply focus error: {e}")

    synthesis["applied"] = True
    updated = store.update(scan_id, {"synthesis": synthesis})
    return {"status": "success", "scan": updated, "focuses": created}
