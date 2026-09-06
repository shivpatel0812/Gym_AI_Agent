"""Optional nutrition values: sugar in grams, sodium in milligrams."""
import math
from typing import Any, Dict, Optional


def nutrient_number(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool) or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def optional_nutrients(parsed: Dict) -> Dict:
    result = {}
    components = parsed.get("components")
    for key, digits in (("sugar", 1), ("sodium", 0)):
        value = nutrient_number(parsed.get(key))
        # Only use a complete ledger, never a partial sum posing as a total.
        if value is None and isinstance(components, list) and components:
            values = [nutrient_number(row.get(key)) if isinstance(row, dict) else None
                      for row in components]
            if all(v is not None for v in values):
                value = sum(values)
        result[key] = round(value, digits) if value is not None else None
    return result


NUTRIENT_RULES = """Report total sugar as sugar (grams) and sodium as sodium (milligrams) for the FULL consumed portion. Total sugar includes naturally occurring and added sugars; do not add sugar to carbohydrates or calories again. Never confuse sodium with salt or percent daily value. Prefer legible nutrition-label values and explicitly stated quantities over recipe guesses. Check whether a label is per serving, per 100g, or per package and multiply ONLY by the consumed amount. If the amount consumed is unspecified, use one labeled serving and state that assumption, not the whole package. Do not invent unreadable label digits. For meal photos, estimate from the identified recipe only when defensible and mention uncertainty about salt, sauces, or sweeteners. Use null when sugar or sodium cannot be estimated, never zero for missing information. Keep assumptions and uncertainties brief."""
