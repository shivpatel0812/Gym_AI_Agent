"""
Content moderation for anything the user types into the AI coach.

App Store Guideline 1.2 requires apps with AI-generated or user-generated
content to filter objectionable material and give users a way to report it.
This module covers the filtering half; `routers/content_reports.py` covers
reporting.

Fails open: if the moderation call itself errors we let the message through
rather than blocking a paying user on an OpenAI hiccup. The coach's own system
prompt carries the safety rails as a second layer.
"""

import os
from typing import List, Optional, Tuple

from fastapi import HTTPException
from openai import OpenAI

MODERATION_MODEL = os.getenv("OPENAI_MODERATION_MODEL", "omni-moderation-latest")

# Categories we refuse outright. Self-harm sits here deliberately: this is a
# calorie-and-training app, and a self-harm or disordered-eating message needs a
# crisis referral, not a macro target.
BLOCKED_CATEGORIES = {
    "self-harm",
    "self-harm/intent",
    "self-harm/instructions",
    "sexual/minors",
    "violence/graphic",
    "harassment/threatening",
    "hate/threatening",
    "illicit/violent",
}

SELF_HARM_CATEGORIES = {"self-harm", "self-harm/intent", "self-harm/instructions"}

SELF_HARM_MESSAGE = (
    "I'm not able to help with this here, and I don't want to give you training or "
    "nutrition targets in this moment. Please talk to someone who can help — in the US "
    "you can call or text 988 for the Suicide & Crisis Lifeline, and outside the US "
    "findahelpline.com lists local services. If you're in immediate danger, please "
    "contact emergency services."
)

GENERIC_BLOCK_MESSAGE = (
    "That message goes outside what the AI coach can help with. Try rephrasing it "
    "around your training, nutrition, or recovery."
)

_client: Optional[OpenAI] = None


def _get_client() -> Optional[OpenAI]:
    global _client
    if _client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return None
        _client = OpenAI(api_key=api_key)
    return _client


def check_text(text: str) -> Tuple[bool, List[str]]:
    """
    Returns (flagged, categories). Fails open on any error.
    """
    if not text or not text.strip():
        return False, []

    client = _get_client()
    if client is None:
        return False, []

    try:
        response = client.moderations.create(model=MODERATION_MODEL, input=text[:4000])
        result = response.results[0]
        categories = getattr(result, "categories", None)
        flagged_names = []
        if categories is not None:
            # SDK returns a pydantic model; category names use underscores and
            # slashes depending on version, so normalise both ways.
            raw = categories.model_dump() if hasattr(categories, "model_dump") else dict(categories)
            for name, is_flagged in raw.items():
                if is_flagged:
                    flagged_names.append(name.replace("_", "/"))
        return bool(getattr(result, "flagged", False)), flagged_names
    except Exception as exc:
        print(f"moderation: check failed, allowing through: {exc}")
        return False, []


def enforce_input(text: str) -> None:
    """
    Raise a 400 with a user-facing message if `text` can't be sent to the coach.

    Only the categories in BLOCKED_CATEGORIES hard-block. A message that trips
    the general `flagged` bit without hitting one of those is let through — the
    system prompt handles ordinary rudeness better than a wall does.
    """
    flagged, categories = check_text(text)
    if not flagged:
        return

    hits = set(categories) & BLOCKED_CATEGORIES
    if not hits:
        return

    message = SELF_HARM_MESSAGE if hits & SELF_HARM_CATEGORIES else GENERIC_BLOCK_MESSAGE
    raise HTTPException(
        status_code=400,
        detail={
            "error": "content_blocked",
            "message": message,
            "categories": sorted(hits),
        },
    )
