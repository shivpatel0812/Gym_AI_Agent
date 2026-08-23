"""
The metric registry: what each signal is called, how it is scaled, which
direction is good, and where its target comes from.

Before this existed the answer to "is fatigue 8 good or bad?" lived in a
comment inside a React component. Nothing server-side could interpret a
wellness score without hardcoding the polarity a second time, and the two
copies were free to drift.

Polarity is the load-bearing part. A raw deviation is signed relative to the
target, but whether a positive deviation is *good* depends on the metric:
sleeping 20% more than usual is fine, being 20% more fatigued than usual is
not. `shortfall()` converts a raw deviation into a single comparable "how bad
is this" number so one ranked list can hold sleep, protein and fatigue at
once.

Actionability is the other judgment encoded here, and it is deliberately not
derived from the data: it is how much a person can actually do about a metric
today. Protein at lunch is something you can act on this afternoon; sleep debt
from three nights ago is not. Ranking without it produces advice that is
technically correct and useless.
"""

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

# Polarity
HIGHER_BETTER = "higher_better"
LOWER_BETTER = "lower_better"
ON_TARGET = "on_target"  # deviation in either direction is a miss
CONTEXT = "context"      # an input to other calculations, never a lever itself

# Where a target comes from
SOURCE_PROFILE = "profile"
SOURCE_NUTRITION_PLAN = "nutrition_plan"
SOURCE_INFERRED = "inferred"

# How several documents for the same day collapse into one value.
AGG_SUM = "sum"    # additive events: steps walked, cups drunk, food logged
AGG_MEAN = "mean"  # repeated readings of one state: a 1-10 scale rated twice


@dataclass(frozen=True)
class Metric:
    """One measurable signal about a user."""

    key: str
    label: str
    collection: str
    field: str
    direction: str
    # Inclusive bounds for subjective scales; None for open-ended quantities.
    scale: Optional[Tuple[float, float]] = None
    unit: str = ""
    target_source: str = SOURCE_INFERRED
    # Dotted path used when target_source is not inferred.
    target_path: Optional[str] = None
    # 0.0–1.0: how much a person can change this today. Used to rank levers.
    actionability: float = 0.5
    # Excluded from lever ranking (still computed and still available).
    lever: bool = True
    # How multiple same-day documents collapse. Only matters when a user logs
    # a metric more than once in a day; for the common single-document day the
    # two policies agree.
    aggregate: str = AGG_SUM

    @property
    def is_subjective(self) -> bool:
        return self.scale is not None


REGISTRY: Dict[str, Metric] = {
    m.key: m
    for m in [
        # --- nutrition: the most actionable domain, targets are explicit ---
        Metric(
            key="protein", label="Protein", collection="macros", field="total_protein",
            direction=HIGHER_BETTER, unit="g",
            target_source=SOURCE_NUTRITION_PLAN, target_path="targets.protein",
            actionability=0.9,
        ),
        Metric(
            key="calories", label="Calories", collection="macros", field="total_calories",
            direction=ON_TARGET, unit="cal",
            target_source=SOURCE_NUTRITION_PLAN, target_path="targets.calories",
            actionability=0.8,
        ),
        Metric(
            key="carbs", label="Carbs", collection="macros", field="total_carbs",
            direction=ON_TARGET, unit="g",
            target_source=SOURCE_NUTRITION_PLAN, target_path="targets.carbs",
            actionability=0.6, lever=False,
        ),
        Metric(
            key="fats", label="Fats", collection="macros", field="total_fats",
            direction=ON_TARGET, unit="g",
            target_source=SOURCE_NUTRITION_PLAN, target_path="targets.fats",
            actionability=0.6, lever=False,
        ),
        Metric(
            key="fiber", label="Fiber", collection="macros", field="total_fiber",
            direction=HIGHER_BETTER, unit="g",
            target_source=SOURCE_NUTRITION_PLAN, target_path="targets.fiber",
            actionability=0.7, lever=False,
        ),

        # --- recovery ---
        Metric(
            key="sleep_hours", label="Sleep", collection="sleep", field="hours_slept",
            direction=HIGHER_BETTER, unit="h",
            target_source=SOURCE_PROFILE, target_path="sleep_goal",
            # You cannot prescribe sleep the way you prescribe a meal. Real,
            # but slow to move, so it should rarely outrank a nutrition gap.
            actionability=0.35,
        ),
        Metric(
            key="sleep_quality", label="Sleep quality", collection="sleep", field="quality",
            direction=HIGHER_BETTER, scale=(1, 10),
            actionability=0.2, lever=False,
            aggregate=AGG_MEAN,
        ),
        Metric(
            key="fatigue", label="Fatigue", collection="wellness_survey", field="fatigue",
            direction=LOWER_BETTER, scale=(1, 10),
            # Fatigue is a symptom to read, not a lever to pull — the fix is
            # always some other metric.
            actionability=0.1, lever=False,
            aggregate=AGG_MEAN,
        ),
        Metric(
            key="body_aches", label="Soreness", collection="wellness_survey", field="body_aches",
            direction=LOWER_BETTER, scale=(1, 10),
            actionability=0.1, lever=False,
            aggregate=AGG_MEAN,
        ),
        Metric(
            key="energy", label="Energy", collection="wellness_survey", field="energy",
            direction=HIGHER_BETTER, scale=(1, 10),
            actionability=0.1, lever=False,
            aggregate=AGG_MEAN,
        ),
        Metric(
            key="mood", label="Mood", collection="wellness_survey", field="mood",
            direction=HIGHER_BETTER, scale=(1, 10),
            actionability=0.1, lever=False,
            aggregate=AGG_MEAN,
        ),

        # --- lifestyle ---
        Metric(
            key="stress", label="Stress", collection="stress", field="level",
            direction=LOWER_BETTER, scale=(1, 10),
            target_source=SOURCE_PROFILE, target_path="typical_stress_level",
            actionability=0.2, lever=False,
            aggregate=AGG_MEAN,
        ),
        Metric(
            key="steps", label="Steps", collection="physical_activities", field="steps",
            direction=HIGHER_BETTER, unit="steps",
            actionability=0.7,
        ),
        Metric(
            key="hydration", label="Hydration", collection="hydration", field="amount_cups",
            direction=HIGHER_BETTER, unit="cups",
            actionability=0.8,
        ),
    ]
}


def get(key: str) -> Optional[Metric]:
    return REGISTRY.get(key)


def for_collection(collection: str):
    """Every metric sourced from one Firestore collection."""
    return [m for m in REGISTRY.values() if m.collection == collection]


def lever_metrics():
    """Metrics eligible to be ranked as levers."""
    return [m for m in REGISTRY.values() if m.lever]


def shortfall(metric_key: str, deviation: Optional[float]) -> Optional[float]:
    """
    Convert a signed deviation into "how bad is this", where positive means
    worse and 0 means on target.

    This is what makes a single ranked list possible: after this call, sleep
    and protein and stress are all just numbers where bigger is more wrong.
    """
    if deviation is None:
        return None
    metric = REGISTRY.get(metric_key)
    if metric is None:
        return None

    if metric.direction == HIGHER_BETTER:
        # Below target is the problem; being above it is not a lever.
        return max(0.0, -deviation)
    if metric.direction == LOWER_BETTER:
        return max(0.0, deviation)
    if metric.direction == ON_TARGET:
        return abs(deviation)
    return None  # CONTEXT metrics are never a shortfall


def describe(metric_key: str) -> Dict[str, Any]:
    """Registry entry as a plain dict, for prompts and API responses."""
    metric = REGISTRY.get(metric_key)
    if metric is None:
        return {}
    return {
        "key": metric.key,
        "label": metric.label,
        "direction": metric.direction,
        "unit": metric.unit,
        "scale": list(metric.scale) if metric.scale else None,
        "actionability": metric.actionability,
        "lever": metric.lever,
    }
