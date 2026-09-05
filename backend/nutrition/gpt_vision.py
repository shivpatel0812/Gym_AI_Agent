"""GPT vision nutrition estimate from a meal photo plus optional user context."""

import base64
import json
import mimetypes
from typing import Dict, List, Optional

from ai_models import completion_kwargs, is_gpt5_family, resolve_model

from .gpt_fallback import get_openai_client
from .gpt_food_lookup import (
    MAX_CALORIES,
    _parse_json,
    assess_macro_coherence,
    finalize_estimated_macros,
)
from .photo_estimate import build_photo_analysis, normalize_cooking_style
from .vision_prompt import resolve_variant, rules_for, schema_extra_for


def gpt_vision_estimate(
    image_path: str,
    description: Optional[str] = None,
    model: Optional[str] = None,
    *,
    title: Optional[str] = None,
    cooking_style: Optional[str] = None,
    prior_foods: Optional[List[Dict]] = None,
    prompt_variant: Optional[str] = None,
) -> Optional[Dict]:
    """Estimate the visible portion and return macros plus uncertainty metadata."""
    client = get_openai_client()
    if not client:
        print("Warning: OPENAI_API_KEY not set. Skipping GPT vision estimate.")
        return None

    resolved = resolve_model(model)
    # Reasoning tokens are billed against max_completion_tokens. A reasoning
    # model thinking about a busy plate can spend the whole 1000-token budget
    # before emitting a single character of JSON, and a truncated response
    # parses as None — which silently demotes the estimate to the
    # description-only fallback. Give the thinking pass its own headroom.
    budget = 4000 if is_gpt5_family(resolved) else 1000
    variant = resolve_variant(prompt_variant)

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

        rules = rules_for(variant)
        # v3 asks for an inventory block; v1 and v2 get "" so that asking them
        # for one cannot quietly turn them into v3.
        schema_extra = schema_extra_for(variant)
        prompt = f"""Analyze this food photo for a nutrition log. Return the most likely CENTRAL estimate for the full portion shown or described. Do not intentionally bias high or low.

Food title supplied by the user: {log_title if log_title else "(none)"}
User description: {hint if hint else "(none)"}
Usual cooking-oil style: {style} (a weak prior, never proof)
Relevant foods this user previously confirmed: {prior_context}

Rules:
{rules}

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
{schema_extra}
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
            **completion_kwargs(resolved, max_tokens=budget, temperature=0.1),
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
        coherence = assess_macro_coherence(parsed)
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
            "prompt_variant": variant,
            "analysis": analysis,
            # Whether this pass had to be arithmetically repaired is an
            # escalation signal, not a detail — see `should_escalate`.
            "coherence": coherence,
        }
    except Exception as exc:
        print(f"Error calling GPT vision API: {exc}")
        return None
