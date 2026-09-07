"""A reviewable macro starting point attached to a training plan.

Protein scales with the goal — 1.8 g/kg maintaining or gaining, 2.2 in a
deficit, where lean mass is what a shortfall costs. All within ISSN's
exercising-adult range: https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/
Fat allocation and calorie offsets are coaching defaults, not measurements.
"""
import math

from nutrition.trajectory import estimate_maintenance_calories, height_cm_from_profile


def positive(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else None
    except (TypeError, ValueError):
        return None


def build_training_macros(profile, goal="maintain", existing=None):
    profile = profile or {}
    goal = goal if goal in ("maintain", "gain", "lose") else "maintain"
    existing_targets = (existing or {}).get("targets") or {}
    saved = {k: positive(existing_targets.get(k)) for k in ("calories", "protein", "carbs", "fats")}
    if all(v is not None for v in saved.values()):
        return {"status": "ready", "source": "nutrition_plan", "goal": (existing or {}).get("goal"),
                "targets": saved, "plan_id": existing.get("id"),
                "guidelines": ["Keep following your active nutrition plan alongside this program."]}

    missing = []
    for name in ("weight", "age"):
        if not positive(profile.get(name)):
            missing.append(name)
    # Reads whichever height fields the profile carries, including a bare
    # total-inches value with no feet — see height_cm_from_profile.
    if height_cm_from_profile(profile) is None:
        missing.append("height")
    if str(profile.get("gender") or "").lower() not in ("male", "female"):
        missing.append("sex for the calorie estimate")
    if missing:
        return {"status": "needs_profile", "source": "estimate", "goal": goal,
                "targets": None, "missing_fields": missing,
                "guidelines": ["Complete your profile to calculate a starting macro estimate."]}
    if float(profile["age"]) < 18:
        return {"status": "needs_profile", "source": "estimate", "goal": goal,
                "targets": None, "missing_fields": [],
                "guidelines": ["Use individually agreed nutrition targets; this estimate is for adults."]}
    try:
        maintenance = estimate_maintenance_calories(profile)
    except (TypeError, ValueError, OverflowError):
        maintenance = None
    if not maintenance or maintenance <= 0:
        return {"status": "needs_profile", "source": "estimate", "goal": goal,
                "targets": None, "missing_fields": ["valid physical measurements"],
                "guidelines": ["Check your profile measurements before estimating macros."]}

    # Do not infer a bulk from a performance goal. Maintenance is the default.
    calories = round(maintenance * {"maintain": 1, "gain": 1.05, "lose": 0.9}[goal])
    # Protein moves with the goal rather than sitting at a flat 1.6 g/kg.
    #
    # A deficit is where protein matters most and where a fixed figure served
    # a trained lifter worst: the same 1.6 that is adequate at maintenance is
    # what gets eaten into when energy is short, and lean mass goes with it.
    # A surplus needs a little more than maintenance but not much — past about
    # 1.8 the extra is energy, not substrate. All three sit inside the 1.6-2.2
    # g/kg band conventionally given for resistance-trained adults.
    protein_per_kg = {"maintain": 1.8, "gain": 1.8, "lose": 2.2}[goal]
    protein = round(float(profile["weight"]) * 0.45359237 * protein_per_kg)
    fats = round(calories * 0.25 / 9)
    carbs = round((calories - 4 * protein - 9 * fats) / 4)
    if carbs < 0:
        return {"status": "needs_profile", "source": "estimate", "goal": goal,
                "targets": None, "missing_fields": ["valid physical measurements"],
                "guidelines": ["Review your profile measurements to estimate balanced macros."]}
    return {
        "status": "ready", "source": "estimate", "goal": goal,
        "maintenance_calories": maintenance,
        "targets": {"calories": calories, "protein": protein, "carbs": carbs, "fats": fats},
        "assumptions": ["Estimated maintenance from your profile and activity level.",
                        f"Protein at {protein_per_kg} g/kg; fat at about 25% of calories; remaining energy from carbs."],
        "guidelines": ["Starting estimates, not fixed requirements for the whole block.",
                       "Review average bodyweight, hunger, recovery and workout performance after two weeks.",
                       "Spread protein across meals and include carbohydrate around training as convenient."],
    }
