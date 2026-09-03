"""Food-photo analysis orchestration.

Vision is the primary path.  A failed vision call may fall back to a user's
written description, but never to a container label ("bowl", "cup", etc.)
treated as food.
"""

from typing import Dict, List, Optional

from .gpt_food_lookup import estimate_food_from_query
from .gpt_vision import gpt_vision_estimate
from .photo_estimate import empty_photo_analysis


def analyze_food_image(
    image_path: str,
    description: Optional[str] = None,
    model: Optional[str] = None,
    *,
    title: Optional[str] = None,
    cooking_style: Optional[str] = None,
    prior_foods: Optional[List[Dict]] = None,
) -> Dict:
    """Analyze one normalized meal image and preserve confidence metadata."""
    vision = gpt_vision_estimate(
        image_path,
        description,
        model=model,
        title=title,
        cooking_style=cooking_style,
        prior_foods=prior_foods,
    )
    if vision:
        item = {
            "name": vision["name"],
            "calories": vision["calories"],
            "protein": vision["protein"],
            "carbs": vision["carbs"],
            "fats": vision["fats"],
            "fiber": vision.get("fiber", 0),
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

    # A written description is safer than the old COCO fallback, which could
    # turn a detected bowl/cup/bottle into an arbitrary USDA food result.
    fallback_query = (description or title or "").strip()
    if fallback_query:
        fallback = estimate_food_from_query(fallback_query, name=title)
        if fallback:
            item = {
                "name": fallback["name"],
                "calories": fallback["calories"],
                "protein": fallback["protein"],
                "carbs": fallback.get("carbs", 0),
                "fats": fallback.get("fats", 0),
                "fiber": fallback.get("fiber", 0),
                "amount": fallback.get("serving"),
            }
            analysis = empty_photo_analysis(
                "The photo could not be read; this uses the written description only.",
                cooking_style,
            )
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
