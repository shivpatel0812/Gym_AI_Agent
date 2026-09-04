"""
Mini chat for disputing a macro estimate.

The user sees the AI estimate from a photo or text query and says things like
"that's chicken thigh not breast" or "there was way more rice". We send a
short conversation to GPT and get a revised estimate back — same shape as the
original, so the client can swap it in.

Two things make a revision better than a blind nudge, and both are supplied
here when available:

* **The photo.** The temp upload is deleted right after the first estimate, so
  the archived copy is re-attached. Without it "did you count the chakori"
  can only bump a scalar by a plausible-sounding amount; with it the model can
  actually count four pieces and price them.
* **The component ledger.** Revising a line item ("chakori: 0 -> 120") keeps
  the total honest. Revising only the total lets it drift.
"""

from typing import Any, Dict, List, Optional

from ai_models import completion_kwargs, is_gpt5_family, resolve_model
from .gpt_fallback import get_openai_client
from .gpt_food_lookup import MAX_CALORIES, _parse_json, finalize_estimated_macros
from .photo_estimate import normalize_components


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

Work at the level of the component ledger, not the total:
- When the meal photo is attached, LOOK AT IT again before revising. Count what
  the user is asking about rather than assuming the previous estimate was close.
- If the user names a food that is missing from the components, add it as its
  own component priced on its own merits — do not just nudge the total up by a
  token amount.
- If the user says a component is wrong, re-price that component and leave the
  others alone.
- Always return the FULL component list, including items you did not change.
- The top-level calories and macros must equal the component sums.

Always return a fenced JSON block (```json ... ```) with this shape:
{
  "name": "food name",
  "amount": "portion description",
  "components": [
    {"item": "chapati", "amount": "1 medium", "calories": 130, "protein": 4, "carbs": 26, "fats": 1, "fiber": 1.5}
  ],
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


def _component_ledger(components: Any) -> str:
    """Render the per-item breakdown so a revision can edit one line."""
    rows = normalize_components(components)
    if not rows:
        return "  Components: (not itemized)"
    lines = ["  Components:"]
    for row in rows:
        amount = f" ({row['amount']})" if row.get("amount") else ""
        lines.append(
            f"    - {row['name']}{amount}: {row['calories']} kcal, "
            f"{row['protein']}p / {row['carbs']}c / {row['fats']}f"
        )
    return "\n".join(lines)


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
        f"Current estimate (this is the live estimate — revise from THESE numbers):\n"
        f"  Name: {name}\n"
        f"  Amount: {amount or '(estimated portion)'}\n"
        f"  Calories: {cal}  Protein: {pro}g  Carbs: {carbs}g  Fat: {fats}g  Fiber: {fiber}g\n"
        f"{_component_ledger(estimate.get('components'))}\n"
        f"  Notes: {note_str}"
    )


def _user_content(user_message: str, image_data_url: Optional[str]) -> Any:
    """Attach the archived meal photo to the current turn when we have it."""
    text = user_message.strip()
    if not image_data_url:
        return text
    return [
        {"type": "text", "text": text},
        {
            "type": "image_url",
            # Same fidelity as the original estimate — revising at a lower
            # detail than the first pass would make corrections worse, not
            # better.
            "image_url": {"url": image_data_url, "detail": "high"},
        },
    ]


def _build_messages(
    current_estimate: Dict,
    user_message: str,
    history: Optional[List[Dict]] = None,
    image_data_url: Optional[str] = None,
) -> list:
    """Build the message list for the adjustment chat."""
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "system",
            "content": _estimate_context(current_estimate),
        },
    ]
    if image_data_url:
        messages.append(
            {
                "role": "system",
                "content": (
                    "The original meal photo is attached to the user's latest "
                    "message. Re-read it before revising."
                ),
            }
        )
    for turn in (history or []):
        role = turn.get("role", "").strip().lower()
        content = str(turn.get("content", "")).strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": _user_content(user_message, image_data_url)})
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
    # Keep the previous ledger if the model dropped it, so a later turn still
    # has line items to edit.
    components = normalize_components(parsed.get("components")) or normalize_components(
        current.get("components")
    )
    return {
        "name": str(parsed.get("name") or current.get("name", "Meal")).strip()[:120],
        "amount": str(parsed.get("amount") or current.get("amount", "")).strip()[:100] or None,
        "calories": calories,
        "protein": protein,
        "carbs": carbs,
        "fats": fats,
        "fiber": fiber,
        "components": components,
        "revision_note": str(parsed.get("revision_note", "")).strip()[:200] or None,
    }


def adjust_macro_estimate(
    current_estimate: Dict,
    user_message: str,
    history: Optional[List[Dict]] = None,
    model: Optional[str] = None,
    image_data_url: Optional[str] = None,
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
    # Reasoning models spend max_completion_tokens on thinking before the reply,
    # and a truncated reply loses the JSON block — which silently returns the
    # unrevised estimate. See the same note in gpt_vision.
    budget = 4000 if is_gpt5_family(resolved) else 900
    messages = _build_messages(current_estimate, user_message, history, image_data_url)

    try:
        response = client.chat.completions.create(
            **completion_kwargs(resolved, max_tokens=budget, temperature=0.3),
            messages=messages,
        )
        reply = (response.choices[0].message.content or "").strip()
        if not reply:
            return None

        revised = _extract_revised_estimate(reply, current_estimate)

        # Build conversation history for follow-up turns. Text only — the photo
        # is re-attached to each new turn rather than duplicated into history.
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
