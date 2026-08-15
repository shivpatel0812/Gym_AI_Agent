"""
GPT vision nutrition estimate from a meal photo plus optional user description.
"""
import os
import json
import base64
import mimetypes
from typing import Dict, Optional
from openai import OpenAI


def get_openai_client() -> Optional[OpenAI]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    return OpenAI(api_key=api_key)


def _parse_json(content: str) -> Optional[Dict]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        last_brace = text.rfind("}")
        if last_brace > 0:
            try:
                return json.loads(text[: last_brace + 1])
            except json.JSONDecodeError:
                return None
        return None


def _num(value, default=0):
    try:
        n = float(value)
        if n < 0:
            return default
        return n
    except (TypeError, ValueError):
        return default


def gpt_vision_estimate(image_path: str, description: Optional[str] = None) -> Optional[Dict]:
    """
    Estimate macros for the visible portion using GPT-4o vision.

    Returns a dict with name, amount, calories, protein, carbs, fats.
    """
    client = get_openai_client()
    if not client:
        print("Warning: OPENAI_API_KEY not set. Skipping GPT vision estimate.")
        return None

    try:
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
        mime = mimetypes.guess_type(image_path)[0] or "image/jpeg"
        hint = (description or "").strip()

        prompt = f"""You are a nutrition estimator. Analyze this meal photo and estimate macros for the portion shown — not per 100g.

The user described the food as:
{hint if hint else "(no description — identify from the photo)"}

Use the user's description as the primary identity (name, ingredients, restaurant, cooking method). Use the photo to judge portion size, extras (oils, sauces, cheese, drinks), and anything they did not mention.

Return JSON only with:
{{
  "name": "short food name matching what the user said when possible",
  "amount": "portion as eaten, e.g. 1 bowl, 8 oz, 2 slices",
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "fiber": number
}}

Round calories to a whole number. Round protein, carbs, fats, and fiber to 1 decimal.
If several items are on the plate, estimate the whole plate as one entry unless the user named a single item."""

        response = client.chat.completions.create(
            model="gpt-4o",
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
            max_tokens=400,
            temperature=0.2,
        )

        content = response.choices[0].message.content or ""
        parsed = _parse_json(content)
        if not parsed or not isinstance(parsed, dict):
            return None

        name = str(parsed.get("name") or hint or "Meal").strip() or "Meal"
        fats = parsed.get("fats", parsed.get("fat"))
        return {
            "name": name[:120],
            "amount": str(parsed.get("amount") or "").strip()[:80] or None,
            "calories": int(round(_num(parsed.get("calories")))),
            "protein": round(_num(parsed.get("protein")), 1),
            "carbs": round(_num(parsed.get("carbs")), 1),
            "fats": round(_num(fats), 1),
            "fiber": round(_num(parsed.get("fiber")), 1),
        }
    except Exception as e:
        print(f"Error calling GPT vision API: {e}")
        return None
