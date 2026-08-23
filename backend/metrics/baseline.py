"""
Personal baselines and the confidence gate that cancels a metric out.

A raw value carries no meaning on its own: 6.4 hours of sleep is a deficit for
one person and normal for another. A metric only becomes comparable to other
metrics once it is expressed as deviation from *that user's* own target.

Which means every metric needs a target, and a target has to come from
somewhere. Two sources, in order:

    1. A target the user declared (a profile goal).
    2. One inferred from their own logged history.

Inference is only honest with enough history behind it. Below MIN_SAMPLES
there is no way to tell one bad night from a pattern, so the metric is
**cancelled** — status "insufficient_data", no target, zero confidence — and
every consumer downstream is expected to drop it rather than fall back to a
population average. Guessing here is worse than staying quiet: a fabricated
target produces a confident deviation, and a confident deviation is exactly
what the recommendation and lever layers act on.

Median, not mean. One 3-hour night or one 12-hour catch-up should not move a
baseline that is meant to describe a habit.
"""

import statistics
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

# Fewer logged days than this and a baseline is noise wearing a number's
# clothes. Five is the point where a single outlier stops dominating a median.
MIN_SAMPLES = 5

# Sample count at which an inferred baseline is trusted completely. Between
# MIN_SAMPLES and here, confidence ramps linearly, so a thin baseline still
# participates but is outweighed by better-evidenced signals.
FULL_CONFIDENCE_SAMPLES = 14

STATUS_OK = "ok"
STATUS_INSUFFICIENT = "insufficient_data"
STATUS_NO_DATA = "no_data"
STATUS_NO_VALUE = "no_value"


@dataclass(frozen=True)
class Baseline:
    """What "normal" is for one user on one metric, and how much to trust it."""

    metric: str
    target: Optional[float]
    samples: int
    confidence: float
    status: str
    source: str  # "declared" | "inferred" | "none"

    @property
    def usable(self) -> bool:
        """False means: drop this metric, do not substitute a default."""
        return self.status == STATUS_OK and self.target is not None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "metric": self.metric,
            "target": self.target,
            "samples": self.samples,
            "confidence": self.confidence,
            "status": self.status,
            "source": self.source,
        }


@dataclass(frozen=True)
class MetricReading:
    """One metric on one day, in the shape every consumer reads."""

    metric: str
    value: Optional[float]
    target: Optional[float]
    deviation: Optional[float]
    confidence: float
    status: str
    # "declared" | "inferred" | "none" — carried through from the baseline so
    # consumers can tell a target the user set from one we derived.
    target_source: str = "none"

    @property
    def usable(self) -> bool:
        return self.status == STATUS_OK and self.deviation is not None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "value": self.value,
            "target": self.target,
            "deviation": self.deviation,
            "confidence": self.confidence,
            "status": self.status,
            "target_source": self.target_source,
        }


def _clean(values: Sequence[Any]) -> List[float]:
    """Numeric values only. Booleans are not measurements."""
    out = []
    for v in values:
        if isinstance(v, bool):
            continue
        if isinstance(v, (int, float)):
            out.append(float(v))
    return out


def compute_baseline(
    metric: str,
    values: Sequence[Any],
    *,
    declared_target: Optional[float] = None,
    min_samples: int = MIN_SAMPLES,
    full_confidence_samples: int = FULL_CONFIDENCE_SAMPLES,
) -> Baseline:
    """
    Establish what is normal for this user on this metric.

    `values` is the logged history within the window being summarized, in any
    order. A `declared_target` wins outright — the user telling us their goal
    beats anything inferred from behaviour, and it holds even with no history,
    because it did not need history to be true.
    """
    samples = _clean(values)
    n = len(samples)

    if declared_target is not None and declared_target > 0:
        return Baseline(
            metric=metric,
            target=float(declared_target),
            samples=n,
            confidence=1.0,
            status=STATUS_OK,
            source="declared",
        )

    if n == 0:
        return Baseline(metric, None, 0, 0.0, STATUS_NO_DATA, "none")

    if n < min_samples:
        # Cancelled: there is history, just not enough of it to mean anything.
        return Baseline(metric, None, n, 0.0, STATUS_INSUFFICIENT, "none")

    spread = max(full_confidence_samples - min_samples, 1)
    confidence = min(1.0, (n - min_samples) / spread * 0.5 + 0.5)

    return Baseline(
        metric=metric,
        target=round(statistics.median(samples), 2),
        samples=n,
        confidence=round(confidence, 2),
        status=STATUS_OK,
        source="inferred",
    )


def read_metric(
    metric: str,
    value: Optional[float],
    baseline: Baseline,
) -> MetricReading:
    """
    Express one value against its baseline as a signed, normalized deviation.

    Normalizing by the target is what makes metrics comparable: -0.19 means
    the same thing for sleep hours as it does for grams of protein, which is
    the only reason a single ranked list of levers can exist.

    A cancelled baseline propagates: no target, no deviation, no confidence.
    """
    if not baseline.usable:
        return MetricReading(
            metric=metric,
            value=value,
            target=None,
            deviation=None,
            confidence=0.0,
            status=baseline.status,
            target_source=baseline.source,
        )

    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return MetricReading(
            metric, None, baseline.target, None, 0.0, STATUS_NO_VALUE, baseline.source
        )

    target = baseline.target or 0.0
    if target == 0:
        return MetricReading(
            metric, float(value), target, None, 0.0, STATUS_NO_DATA, baseline.source
        )

    return MetricReading(
        metric=metric,
        value=float(value),
        target=target,
        deviation=round((float(value) - target) / target, 3),
        confidence=baseline.confidence,
        status=STATUS_OK,
        target_source=baseline.source,
    )
