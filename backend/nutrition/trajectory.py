"""
Week-by-week nutrition targets.

Nutrition plans currently carry one static calorie number for their whole
duration. That is fine for "what do I eat today" and wrong for "how do I get
where I'm going": a surplus that works in week 1 stops working once bodyweight
and maintenance have moved, and nobody gaining weight should be eating the same
number in week 8 as in week 1.

So a plan gets a ramp. The rules below are conventional coaching practice, not
findings, and they are stated as constants so they can be argued with.

Bodyweight projection is deliberately conservative and refuses to run at all
without the profile fields it needs, because a confident weight curve built on
a guessed maintenance figure is worse than no curve.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Calories per pound of bodyweight change. The familiar 3500 figure — an
# approximation that holds well enough over the weeks a plan covers, and badly
# over months. Projections stay short for that reason.
CALORIES_PER_POUND = 3500

# Weekly change to the calorie target, per goal.
#
# Gaining ramps up: maintenance rises as bodyweight does, so a fixed number
# stops being a surplus. Cutting deliberately does NOT ramp down — driving a
# deficit deeper week after week is how people lose adherence and muscle, and
# the right response to a stalled cut is a diet break, not another cut.
WEEKLY_CALORIE_STEP = {
    "lean_bulk": 100,
    "muscle": 75,
    "maintain": 0,
    "fat_loss": 0,
    "health": 0,
}

# How far the target may drift from where it started, per goal. Without a cap a
# 16-week bulk ramps into a number nobody should be eating.
MAX_CALORIE_DRIFT = {
    "lean_bulk": 500,
    "muscle": 400,
    "maintain": 0,
    "fat_loss": 0,
    "health": 0,
}

# Protein tracks bodyweight rather than calories, so it moves far less.
WEEKLY_PROTEIN_STEP = {"lean_bulk": 2, "muscle": 2}

ACTIVITY_FACTORS = {
    "1-2": 1.375,
    "2-3": 1.45,
    "3-4": 1.55,
    "4-5": 1.65,
    "5-6": 1.725,
    "6-7": 1.8,
}
DEFAULT_ACTIVITY_FACTOR = 1.55


@dataclass
class NutritionWeek:
    week: int
    calories: int
    protein: int
    # Cumulative expected bodyweight change since week 0. None whenever
    # maintenance could not be estimated.
    expected_weight_change_lb: Optional[float] = None
    expected_weight_lb: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        payload = {"week": self.week, "calories": self.calories, "protein": self.protein}
        if self.expected_weight_change_lb is not None:
            payload["expected_weight_change_lb"] = round(self.expected_weight_change_lb, 1)
        if self.expected_weight_lb is not None:
            payload["expected_weight_lb"] = round(self.expected_weight_lb, 1)
        return payload


@dataclass
class NutritionTrajectory:
    goal: str
    weeks: List[NutritionWeek] = field(default_factory=list)
    weekly_step: int = 0
    maintenance_calories: Optional[int] = None
    rationale: str = ""
    # Where the plan's own numbers contradict its stated goal.
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "goal": self.goal,
            "weekly_step": self.weekly_step,
            "maintenance_calories": self.maintenance_calories,
            "rationale": self.rationale,
            "warnings": list(self.warnings),
            "weeks": [w.to_dict() for w in self.weeks],
        }


# Goals whose calorie target should sit above maintenance, and below it.
_SURPLUS_GOALS = {"lean_bulk", "muscle"}
_DEFICIT_GOALS = {"fat_loss"}


def _target_warnings(
    goal: str, starting_calories: int, maintenance: Optional[int]
) -> List[str]:
    """
    Catch a plan whose calorie target points the opposite way to its goal.

    Nutrition targets come from per-goal defaults that know nothing about the
    individual, so a 2800 kcal "lean bulk" lands below maintenance for a larger
    or more active user — and the plan then quietly projects weight loss. Better
    to say so on the page than to draw a falling line under the word "bulk".
    """
    if not maintenance or not starting_calories:
        return []

    if goal in _SURPLUS_GOALS and starting_calories <= maintenance:
        return [
            f"This plan starts at {starting_calories} kcal, at or below your "
            f"estimated maintenance of {maintenance}. For a gaining goal it "
            "should start above it — expect little or no gain until the ramp "
            "catches up."
        ]
    if goal in _DEFICIT_GOALS and starting_calories >= maintenance:
        return [
            f"This plan starts at {starting_calories} kcal, at or above your "
            f"estimated maintenance of {maintenance}. A fat-loss goal needs to "
            "sit below it."
        ]
    return []


def estimate_maintenance_calories(profile: Dict[str, Any]) -> Optional[int]:
    """
    Mifflin-St Jeor plus an activity factor, or None.

    Returns None rather than guessing when height, weight, age or sex are
    missing. Every downstream weight projection is gated on this, so a missing
    profile field degrades to "no weight curve" instead of to a confident
    wrong one.
    """
    if not profile:
        return None

    weight_lb = profile.get("weight")
    age = profile.get("age")
    gender = (profile.get("gender") or "").strip().lower()

    height_cm = profile.get("height_cm")
    if not height_cm:
        ft, inch = profile.get("height_ft"), profile.get("height_in")
        if ft is not None:
            height_cm = (float(ft) * 12 + float(inch or 0)) * 2.54

    if not weight_lb or not age or not height_cm or gender not in ("male", "female"):
        return None

    weight_kg = float(weight_lb) * 0.4536
    bmr = 10 * weight_kg + 6.25 * float(height_cm) - 5 * float(age)
    bmr += 5 if gender == "male" else -161

    factor = ACTIVITY_FACTORS.get(
        str(profile.get("preferred_workout_frequency") or "").strip(),
        DEFAULT_ACTIVITY_FACTOR,
    )
    return int(round(bmr * factor))


def maintenance_at_weight(
    profile: Dict[str, Any], weight_lb: Optional[float]
) -> Optional[int]:
    """
    Maintenance recomputed at a different bodyweight.

    A projection that holds maintenance at its starting value drifts further
    wrong every week the user's weight moves, in the direction that flatters
    the plan: a bulk looks faster than it is, a cut looks like it keeps working
    after it has stalled.
    """
    if not weight_lb:
        return estimate_maintenance_calories(profile)
    return estimate_maintenance_calories({**(profile or {}), "weight": weight_lb})


def build_trajectory(
    goal: str,
    targets: Dict[str, Any],
    weeks: int,
    profile: Optional[Dict[str, Any]] = None,
    weekly_step_override: Optional[int] = None,
) -> NutritionTrajectory:
    """
    Expand a plan's static targets into a week-by-week ramp.

    `weekly_step_override` is what the plan chat adjusts when a user says the
    surplus is too slow or too aggressive.
    """
    goal = goal if goal in WEEKLY_CALORIE_STEP else "maintain"
    base_calories = int(targets.get("calories") or 0)
    base_protein = int(targets.get("protein") or 0)

    step = (
        int(weekly_step_override)
        if weekly_step_override is not None
        else WEEKLY_CALORIE_STEP[goal]
    )
    drift_cap = MAX_CALORIE_DRIFT.get(goal, 0)
    if weekly_step_override is not None and drift_cap == 0:
        # An explicit override on a normally-flat goal still needs a ceiling.
        drift_cap = abs(step) * weeks
    protein_step = WEEKLY_PROTEIN_STEP.get(goal, 0)

    maintenance = estimate_maintenance_calories(profile or {})
    start_weight = (profile or {}).get("weight")

    out: List[NutritionWeek] = []
    cumulative_change = 0.0
    for week in range(1, max(1, weeks) + 1):
        drift = step * (week - 1)
        if drift_cap:
            drift = max(-drift_cap, min(drift_cap, drift))
        calories = base_calories + drift
        protein = base_protein + protein_step * (week - 1)

        change = None
        projected_weight = None
        if maintenance and calories:
            # Maintenance is recomputed at the projected bodyweight rather than
            # held at its week-1 value. Holding it fixed made the model
            # contradict its own rationale — which tells the user in as many
            # words that maintenance rises as they gain — and compounded a
            # growing error across the projection, overstating a 12-week bulk
            # by a pound or two and understating how quickly a cut stalls.
            current_weight = (
                float(start_weight) + cumulative_change if start_weight else None
            )
            week_maintenance = (
                maintenance_at_weight(profile or {}, current_weight) or maintenance
            )
            # Only the surplus or deficit moves bodyweight.
            weekly_delta = (calories - week_maintenance) * 7
            cumulative_change += weekly_delta / CALORIES_PER_POUND
            change = cumulative_change
            if start_weight:
                projected_weight = float(start_weight) + cumulative_change

        out.append(
            NutritionWeek(
                week=week,
                calories=int(round(calories)),
                protein=int(round(protein)),
                expected_weight_change_lb=change,
                expected_weight_lb=projected_weight,
            )
        )

    return NutritionTrajectory(
        goal=goal,
        weeks=out,
        weekly_step=step,
        maintenance_calories=maintenance,
        rationale=_rationale(goal, step, maintenance),
        warnings=_target_warnings(goal, base_calories, maintenance),
    )


def _rationale(goal: str, step: int, maintenance: Optional[int]) -> str:
    """One line the UI can show under the nutrition ramp."""
    if step > 0:
        base = (
            f"Calories rise {step} per week. As bodyweight goes up so does "
            "maintenance, so a fixed number stops being a surplus."
        )
    elif step < 0:
        base = f"Calories come down {abs(step)} per week."
    elif goal == "fat_loss":
        base = (
            "The deficit holds steady rather than deepening. Driving it lower "
            "week after week costs adherence and muscle."
        )
    else:
        base = "Calories hold steady for the length of the plan."

    if not maintenance:
        base += " Add your height, age and sex to see the expected weight curve."
    return base
