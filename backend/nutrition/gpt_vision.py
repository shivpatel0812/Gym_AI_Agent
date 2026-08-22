"""
GPT vision nutrition estimate from a meal photo plus optional user description.
"""
import base64
import mimetypes
from typing import Dict, Optional
from .gpt_fallback import get_openai_client
from .gpt_food_lookup import ESTIMATE_RULES, _parse_json, finalize_estimated_macros
from ai_models import resolve_model, completion_kwargs


def gpt_vision_estimate(
    image_path: str,
    description: Optional[str] = None,
    model: Optional[str] = None,
) -> Optional[Dict]:
    """
    Estimate macros for the visible portion using GPT vision.

    Returns a dict with name, amount, calories, protein, carbs, fats.
    """
    client = get_openai_client()
    if not client:
        print("Warning: OPENAI_API_KEY not set. Skipping GPT vision estimate.")
        return None

    resolved = resolve_model(model)

    try:
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
        mime = mimetypes.guess_type(image_path)[0] or "image/jpeg"
        hint = (description or "").strip()

        prompt = f"""You are a nutrition estimator. Analyze this meal photo and estimate macros for the FULL portion eaten — not per 100g, not one unit if they said they had several.

The user described the food as:
{hint if hint else "(no description — identify from the photo)"}

Use the user's description as the primary identity (name, ingredients, restaurant, cooking method, quantity). Use the photo to judge extras (oils, sauces, cheese, drinks) and anything they did not mention.

{ESTIMATE_RULES}
{{
  "name": "short food name matching what the user said when possible",
  "amount": "full portion as eaten, e.g. 3 frankie wraps",
  "components": [
    {{"item": "flour tortilla", "qty": 3, "calories": 450}},
    {{"item": "chickpea and pea filling with oil", "qty": 3, "calories": 360}}
  ],
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "fiber": number
}}

Round calories to a whole number. Round protein, carbs, fats, and fiber to 1 decimal.
If several items are on the plate, estimate the whole plate as one entry unless the user named a single item."""

        response = client.chat.completions.create(
            **completion_kwargs(resolved, max_tokens=700, temperature=0.1),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime};base64,{b64}",
                                "detail": "low",
                            },
                        },
                    ],
                }
            ],
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content or ""
        parsed = _parse_json(content)
        if not parsed or not isinstance(parsed, dict):
            return None

        name = str(parsed.get("name") or hint or "Meal").strip() or "Meal"
        calories, protein, carbs, fats, fiber = finalize_estimated_macros(parsed)
        amount = str(parsed.get("amount") or "").strip() or None
        return {
            "name": name,
            "amount": amount,
            "calories": calories,
            "protein": protein,
            "carbs": carbs,
            "fats": fats,
            "fiber": fiber,
            "model": resolved,
        }
    except Exception as e:
        print(f"Error calling GPT vision API: {e}")
        return None
