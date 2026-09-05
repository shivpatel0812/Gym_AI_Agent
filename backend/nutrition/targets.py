"""Daily target precedence shared by the profile API and daily screens."""

import math

DEFAULT_TARGETS = {
    "calories": 2200, "protein": 175, "carbs": 240,
    "fats": 80, "fiber": 30, "water": 16,
}


def resolve_targets(profile_targets=None, plan_targets=None):
    """Explicit profile values win; a plan fills gaps, then defaults do."""
    result = dict(DEFAULT_TARGETS)
    for source in (plan_targets, profile_targets):
        for key, value in (source or {}).items():
            if (key in result and isinstance(value, (int, float))
                    and math.isfinite(value) and value >= 0):
                result[key] = value
    return result
