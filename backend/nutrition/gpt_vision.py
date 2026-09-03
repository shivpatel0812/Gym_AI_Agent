"""GPT vision nutrition estimate from a meal photo plus optional user context."""

import base64
import json
import mimetypes
from typing import Dict, List, Optional

from ai_models import completion_kwargs, resolve_model

from .gpt_fallback import get_openai_client
from .gpt_food_lookup import MAX_CALORIES, _parse_json, finalize_estimated_macros
from .photo_estimate import build_photo_analysis, normalize_cooking_style


def gpt_vision_estimate(
    image_path: str,
    description: Optional[str] = None,
    model: Optional[str] = None,
    *,
    title: Optional[str] = None,
    cooking_style: Optional[str] = None,
    prior_foods: Optional[List[Dict]] = None,
) -> Optional[Dict]:
    """Estimate the visible portion and return macros plus uncertainty metadata."""
    client = get_openai_client()
    if not client:
        print("Warning: OPENAI_API_KEY not set. Skipping GPT vision estimate.")
        return None

    resolved = resolve_model(model)

    try:
        with open(image_path, "rb") as image_file:
            encoded = base64.b64encode(image_file.read()).decode("utf-8")
        mime = mimetypes.guess_type(image_path)[0] or "image/jpeg"
        hint = (description or "").strip()
        log_title = (title or "").strip()
        style = normalize_cooking_style(cooking_style)

        # Previous user-confirmed foods are useful priors, but only expose the
        # nutrition fields needed for this estimate and keep the prompt small.
        safe_priors: List[Dict] = []
        for prior in (prior_foods or [])[:3]:
            if not isinstance(prior, dict):
                continue
            prior_name = str(prior.get("name") or "").strip()[:100]
            if not prior_name:
                continue
            safe_priors.append(
                {
                    "name": prior_name,
                    "serving": str(prior.get("serving") or "").strip()[:80],
                    "grams": prior.get("grams"),
                    "calories": prior.get("calories"),
                    "protein": prior.get("protein"),
                    "carbs": prior.get("carbs"),
                    "fats": prior.get("fats"),
                }
            )
        prior_context = json.dumps(safe_priors, separators=(",", ":")) if safe_priors else "[]"

        prompt = f"""Analyze this food photo for a nutrition log. Return the most likely CENTRAL estimate for the full portion shown or described. Do not intentionally bias high or low.

Food title supplied by the user: {log_title if log_title else "(none)"}
User description: {hint if hint else "(none)"}
Usual cooking-oil style: {style} (a weak prior, never proof)
Relevant foods this user previously confirmed: {prior_context}

Rules:
- Treat the title and description as strong identity and quantity hints, but flag conflicts with the image.
- Assess lighting, sharpness, whether the full meal is visible, and view angle before estimating.
- Look for portion cues already in frame. A known package is strong; a plate, bowl, utensil, or hand is only a weak-to-medium cue unless its size is known. Never assume every dinner plate is the same size.
- Estimate a best gram amount plus a realistic low/high gram range. A single image without scale should have a wider range.
- Do not infer oil merely because food is homemade. Glistening can be water, sauce, or glaze. Report visible oil evidence separately and use stated preparation, the user's cooking style, or a neutral typical-recipe assumption as the basis.
- Include hidden ingredients, sauces, drinks, and cooking fat only when stated, visible, or customary for the identified preparation. Put uncertain choices in assumptions or uncertainties.
- Break mixed meals into components. Component nutrition and the top-level macros describe the FULL quantity, not per 100g.
- Calories should be arithmetically compatible with protein, carbs, and fat, and should match the component calorie sum when components are supplied.

Return JSON only in this shape:
{{
  "name": "short food name matching the user's title when reasonable",
  "amount": "plain-language full portion, e.g. 1 medium bowl",
  "portion": {{"estimated_grams": number, "low_grams": number, "high_grams": number}},
  "image_quality": {{
    "lighting": "good|usable|poor",
    "sharpness": "sharp|usable|blurry",
    "full_meal_visible": true,
    "view_angle": "top_down|angled|side|unknown"
  }},
  "scale_references": [{{"type": "plate|bowl|utensil|hand|known_package|other", "reliability": "weak|medium|strong"}}],
  "identity_confidence": "low|medium|high",
  "cooking_fat": {{
    "estimated_grams": number,
    "basis": "description|user_preference|visible_evidence|typical_recipe|none|unknown",
    "visible_evidence": "none|possible|clear|unknown"
  }},
  "components": [
    {{"item": "food component", "amount": "amount", "estimated_grams": number, "calories": number, "protein": number, "carbs": number, "fats": number, "fiber": number}}
  ],
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "fiber": number,
  "assumptions": ["short assumption"],
  "uncertainties": ["short uncertainty"]
}}

Round calories to a whole number. Round protein, carbs, fats, and fiber to 1 decimal. If several items are on the plate, the top-level entry represents the whole plate."""

        response = client.chat.completions.create(
            **completion_kwargs(resolved, max_tokens=1000, temperature=0.1),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime};base64,{encoded}",
                                # OpenAI documents high as the standard
                                # high-fidelity mode; food photos need more than
                                # the coarse low-detail representation.
                                "detail": "high",
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

        name = str(log_title or parsed.get("name") or hint or "Meal").strip()[:120] or "Meal"
        calories, protein, carbs, fats, fiber = finalize_estimated_macros(
            parsed, query=" ".join(part for part in (log_title, hint) if part)
        )
        calories = min(calories, MAX_CALORIES)
        amount = str(parsed.get("amount") or "").strip()[:100] or None
        analysis = build_photo_analysis(
            parsed,
            has_user_hint=bool(log_title or hint),
            has_saved_prior=bool(safe_priors),
            cooking_style=style,
        )
        return {
            "name": name,
            "amount": amount,
            "calories": calories,
            "protein": protein,
            "carbs": carbs,
            "fats": fats,
            "fiber": fiber,
            "model": resolved,
            "analysis": analysis,
        }
    except Exception as exc:
        print(f"Error calling GPT vision API: {exc}")
        return None
