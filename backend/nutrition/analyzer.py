"""Food-photo analysis orchestration.

Vision is the primary path.  A failed vision call may fall back to a user's
written description, but never to a container label ("bowl", "cup", etc.)
treated as food.

Two passes, not one
-------------------
A cheap model handles the common case (one food, one plate, obvious portion)
perfectly well and costs a fraction of the strong one. It degrades on mixed
multi-compartment meals, where each component is shaded low independently and
the errors compound into a total that is badly under before the user has said
anything.

So the cheap model runs first and is asked to show its work — a component
ledger, a portion range, and calories that reconcile against both. When that
work is internally inconsistent or the meal is complex enough that the failure
mode applies, the photo is re-run on the strong model and the better answer is
kept. Everything else pays cheap-model prices.

The escalation is deliberately NOT driven by the confidence score. That score
measures photo legibility, which is a different thing from accuracy: a sharp,
well-lit, fully-visible tray scores "medium" and can still be 30% low, while a
blurry photo scores "low" and is the case a stronger model can help with least.
See `should_escalate`.
"""

from typing import Any, Dict, List, Optional

from ai_models import ESCALATION_MODEL, resolve_model

from .gpt_food_lookup import estimate_food_from_query
from .gpt_vision import gpt_vision_estimate
from .photo_estimate import empty_photo_analysis, should_escalate


def _to_result(vision: Dict[str, Any], cooking_style: Optional[str]) -> Dict[str, Any]:
    """Shape one vision pass into the analyze-image response."""
    item = {
        "name": vision["name"],
        "calories": vision["calories"],
        "protein": vision["protein"],
        "carbs": vision["carbs"],
        "fats": vision["fats"],
        "fiber": vision.get("fiber", 0),
        "sugar": vision.get("sugar"),
        "sodium": vision.get("sodium"),
        "amount": vision.get("amount"),
    }
    analysis = vision.get("analysis") or empty_photo_analysis(
        "The model did not return portion evidence.", cooking_style
    )
    component_names = [
        component.get("name")
        for component in (analysis.get("components") or [])
        if isinstance(component, dict) and component.get("name")
    ]
    return {
        "foods": component_names or [vision["name"]],
        "food_items": [item],
        "food": item,
        "analysis": analysis,
        "model": vision.get("model"),
        "message": "Estimated macros from photo",
    }


def analyze_food_image(
    image_path: str,
    description: Optional[str] = None,
    model: Optional[str] = None,
    *,
    title: Optional[str] = None,
    cooking_style: Optional[str] = None,
    prior_foods: Optional[List[Dict]] = None,
    allow_escalation: bool = True,
    prompt_variant: Optional[str] = None,
) -> Dict:
    """Analyze one normalized meal image and preserve confidence metadata."""
    first_model = resolve_model(model)
    vision = gpt_vision_estimate(
        image_path,
        description,
        model=first_model,
        title=title,
        cooking_style=cooking_style,
        prior_foods=prior_foods,
        prompt_variant=prompt_variant,
    )

    if vision:
        analysis = vision.get("analysis") or {}
        decision = should_escalate(analysis, vision.get("coherence"))
        escalated_from = None

        if (
            decision["escalate"]
            and allow_escalation
            and first_model != ESCALATION_MODEL
        ):
            stronger = gpt_vision_estimate(
                image_path,
                description,
                model=ESCALATION_MODEL,
                title=title,
                cooking_style=cooking_style,
                prior_foods=prior_foods,
                prompt_variant=prompt_variant,
            )
            # A failed second pass is not a failed estimate — the first pass is
            # still a usable answer, so keep it rather than dropping to the
            # description-only fallback.
            if stronger:
                escalated_from = first_model
                vision = stronger
                analysis = vision.get("analysis") or {}

        result = _to_result(vision, cooking_style)
        result["analysis"] = {
            **result["analysis"],
            "routing": {
                "first_pass_model": first_model,
                "final_model": vision.get("model"),
                "escalated": escalated_from is not None,
                "prompt_variant": vision.get("prompt_variant"),
                # Recorded even when escalation was declined or unavailable, so
                # a wrong estimate can be traced to the rule that let it pass.
                "triggers": decision["triggers"],
            },
        }
        return result

    # A written description is safer than the old COCO fallback, which could
    # turn a detected bowl/cup/bottle into an arbitrary USDA food result.
    fallback_query = (description or title or "").strip()
    if fallback_query:
        fallback = estimate_food_from_query(
            fallback_query, name=title, model=model
        )
        if fallback:
            item = {
                "name": fallback["name"],
                "calories": fallback["calories"],
                "protein": fallback["protein"],
                "carbs": fallback.get("carbs", 0),
                "fats": fallback.get("fats", 0),
                "fiber": fallback.get("fiber", 0),
                "sugar": fallback.get("sugar"),
                "sodium": fallback.get("sodium"),
                "amount": fallback.get("serving"),
            }
            # The description path now returns real evidence of its own — a
            # ledger, a portion range, a confidence built on what the sentence
            # pinned down. Discarding it for an empty shell told the user
            # nothing about an estimate they still had to accept or correct.
            analysis = fallback.get("analysis") or empty_photo_analysis(
                "The photo could not be read; this uses the written description only.",
                cooking_style,
            )
            analysis = {
                **analysis,
                "confidence": {
                    **analysis["confidence"],
                    "reasons": [
                        "The photo could not be read; this is from your description only",
                        *analysis["confidence"].get("reasons", []),
                    ][:5],
                },
            }
            return {
                "foods": [item["name"]],
                "food_items": [item],
                "food": item,
                "analysis": analysis,
                "message": "Estimated from description because the photo was unclear",
            }

    return {
        "foods": [],
        "food_items": [],
        "analysis": empty_photo_analysis(
            "No reliable food estimate could be produced from this photo.", cooking_style
        ),
        "message": "Could not estimate this photo reliably. Try a clearer photo or add a description.",
    }
