"""
Mini chat for disputing a macro estimate.

The user sees the AI estimate from a photo or text query and says things like
"that's chicken thigh not breast" or "there was way more rice". We send a
short conversation to GPT and get a revised estimate back — same shape as the
original, so the client can swap it in.
"""

import json
from typing import Dict, List, Optional

from ai_models import completion_kwargs, resolve_model
from .gpt_fallback import get_openai_client
from .gpt_food_lookup import MAX_CALORIES, _parse_json, finalize_estimated_macros


SYSTEM_PROMPT = """You are a nutrition estimate assistant inside a meal-logging app.

The user photographed or described a meal and received an AI macro estimate.
They disagree with something — maybe the food identity, portion size, cooking
method, or individual macros. Your job:

1. Acknowledge the correction briefly (one short sentence).
2. Explain what you changed and why (one to two sentences).
3. Return the REVISED estimate as a JSON block.

Be conversational but concise — this is a lock-screen-style chat, not a
consultation. If the user's correction is vague ("that's too high"), ask ONE
clarifying question and still return your best revised estimate.

Always return a fenced JSON block (```json ... ```) with this shape:
{
  "name": "food name",
  "amount": "portion description",
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "fiber": number,
  "revision_note": "what changed"
}

Round calories to whole numbers. Round macros to 1 decimal.
Calories must be consistent with 4*protein + 4*carbs + 9*fats (within 20 kcal).
"""


def _estimate_context(estimate: Dict) -> str:
    """Format the current estimate as context for the system prompt."""
    name = estimate.get("name", "Unknown food")
    amount = estimate.get("amount", "")
    cal = estimate.get("calories", 0)
    pro = estimate.get("protein", 0)
    carbs = estimate.get("carbs", 0)
    fats = estimate.get("fats", 0)
    fiber = estimate.get("fiber", 0)
    assumptions = estimate.get("assumptions", [])
    uncertainties = estimate.get("uncertainties", [])
    notes = []
    if assumptions:
        notes.append(f"Assumptions: {', '.join(str(a) for a in assumptions[:3])}")
    if uncertainties:
        notes.append(f"Uncertainties: {', '.join(str(u) for u in uncertainties[:3])}")
    note_str = " | ".join(notes) if notes else "none"
    return (
        f"Current estimate:\n"
        f"  Name: {name}\n"
        f"  Amount: {amount or '(estimated portion)'}\n"
        f"  Calories: {cal}  Protein: {pro}g  Carbs: {carbs}g  Fat: {fats}g  Fiber: {fiber}g\n"
        f"  Notes: {note_str}"
    )


def _build_messages(
    current_estimate: Dict,
    user_message: str,
    history: Optional[List[Dict]] = None,
) -> list:
    """Build the message list for the adjustment chat."""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "system",
            "content": _estimate_context(current_estimate),
        },
    ]
    for turn in (history or []):
        role = turn.get("role", "").strip().lower()
        content = str(turn.get("content", "")).strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message.strip()})
    return messages


def _extract_revised_estimate(text: str, current: Dict) -> Dict:
    """Pull the JSON block from the assistant reply and merge with current."""
    # Try fenced block first
    if "```" in text:
        parts = text.split("```")
        for part in parts[1::2]:
            clean = part.strip()
            if clean.startswith("json"):
                clean = clean[4:].strip()
            parsed = _parse_json(clean)
            if parsed and "calories" in parsed:
                return _finalize(parsed, current)

    # Try bare JSON
    parsed = _parse_json(text)
    if parsed and "calories" in parsed:
        return _finalize(parsed, current)

    return current


def _finalize(parsed: Dict, current: Dict) -> Dict:
    """Validate and finalize the revised estimate."""
    calories, protein, carbs, fats, fiber = finalize_estimated_macros(parsed)
    calories = min(calories, MAX_CALORIES)
    return {
        "name": str(parsed.get("name") or current.get("name", "Meal")).strip()[:120],
        "amount": str(parsed.get("amount") or current.get("amount", "")).strip()[:100] or None,
        "calories": calories,
        "protein": protein,
        "carbs": carbs,
        "fats": fats,
        "fiber": fiber,
        "revision_note": str(parsed.get("revision_note", "")).strip()[:200] or None,
    }


def adjust_macro_estimate(
    current_estimate: Dict,
    user_message: str,
    history: Optional[List[Dict]] = None,
    model: Optional[str] = None,
) -> Optional[Dict]:
    """
    Run a short adjustment chat and return the revised estimate + reply text.

    Returns:
        {"reply": str, "revised_estimate": dict, "conversation_history": list}
    """
    client = get_openai_client()
    if not client:
        return None

    resolved = resolve_model(model, default="gpt-4o")
    messages = _build_messages(current_estimate, user_message, history)

    try:
        response = client.chat.completions.create(
            **completion_kwargs(resolved, max_tokens=600, temperature=0.3),
            messages=messages,
        )
        reply = (response.choices[0].message.content or "").strip()
        if not reply:
            return None

        revised = _extract_revised_estimate(reply, current_estimate)

        # Build conversation history for follow-up turns
        out_history = list(history or [])
        out_history.append({"role": "user", "content": user_message.strip()})
        out_history.append({"role": "assistant", "content": reply})

        return {
            "reply": reply,
            "revised_estimate": revised,
            "conversation_history": out_history,
        }
    except Exception as exc:
        print(f"Error adjusting estimate: {exc}")
        return None
