"""
The composite index, its noise band, and the state machine on top of it.

A stock price is externally validated, so when it drops nobody asks whether the
formula is wrong. This index is an opinion, which means the moment it falls in
a week the user trained normally, they either stop trusting it or start
training for it. Everything here exists to keep that from happening without
turning the number into a ratchet that only ever goes up.

Three rules do the work:

    A week only counts as a signal if it falls outside that user's own
    week-to-week variance. Reacting to noise in a stable process makes the
    process worse, and a hub that nags after every below-average week is doing
    exactly that. Someone whose training is naturally spiky needs more evidence
    before it is called a decline; someone who has been a metronome for four
    months needs less, and their band says so.

    Flat is a named state, not an absence. "Holding" has to read as legitimate
    rather than as a warning — but it is self-limiting, because three holds in
    a row walk the machine to "stalled" on their own, so there is no way to
    farm it.

    The drop condition is written down. Sustained, outside the band, with
    coverage good enough to mean something. Nothing here may suppress that, or
    the index lies at exactly the moment the user most needs the truth.

`FORMULA_VERSION` is stamped on every stored point. Recomputing history under
new weights would silently rewrite a user's past and read to them as an
overnight drop, so a change to the weights below is a new version, not an edit.
"""

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

FORMULA_VERSION = "v2"

# Which domains matter depends on what the user is training for. A cut lives or
# dies on nutrition; a bulk is judged mostly on whether the lifts moved.
#
# Sleep / hydration / stress / activity are optional: they only enter the
# weighted mean when that domain has a level that week. Missing ones are left
# out of total_weight, never scored as zero — same stance as body without
# weigh-ins. Absolute weights need not sum to 1; build_series renormalizes.
GOAL_WEIGHTS = {
    "cut": {
        "strength": 0.25,
        "consistency": 0.25,
        "nutrition": 0.30,
        "body": 0.20,
        "sleep": 0.10,
        "hydration": 0.05,
        "stress": 0.05,
        "activity": 0.05,
    },
    "gain": {
        "strength": 0.35,
        "consistency": 0.25,
        "nutrition": 0.25,
        "body": 0.15,
        "sleep": 0.10,
        "hydration": 0.05,
        "stress": 0.05,
        "activity": 0.05,
    },
    "maintain": {
        "strength": 0.30,
        "consistency": 0.30,
        "nutrition": 0.25,
        "body": 0.15,
        "sleep": 0.10,
        "hydration": 0.05,
        "stress": 0.05,
        "activity": 0.05,
    },
}

# The band never collapses below this. A user with three tidy weeks has almost
# no measured variance, and without a floor every rounding wobble would read as
# a direction change. Kept well under a point because that is the scale this
# index actually moves at — a strongly progressing user gains half a point a
# week, so a floor of 1.5 would swallow real progress whole and report it as
# a stall.
MIN_BAND = 0.8

# Weeks of index history before the machine will name a state at all.
MIN_WEEKS_FOR_STATE = 3

# Below this confidence nothing is claimed. Thin data is a normal state, not an
# error, and printing a number that has not been earned is how the whole
# feature loses its credibility.
MIN_CONFIDENCE = 0.35
# Calling a decline is the most consequential thing this machine does, so it
# demands more evidence than anything else.
MIN_CONFIDENCE_FOR_DECLINE = 0.50
SUSTAINED_WEEKS = 2
FLAT_STREAK_WEEKS = 3

# Building and stalling are judged over a window, not on the last week alone.
# Real progress accrues at well under a point a week, so comparing one week's
# delta against the noise band labels a steadily improving user "stalled" —
# which is precisely the "you are failing while training normally" failure this
# whole design exists to avoid. Averaging k weeks shrinks the noise by sqrt(k),
# so that is what the mean delta is measured against.
TREND_WINDOW_WEEKS = 3

# How far below the demonstrated level this week's actual work has to sit,
# sustained across the whole trend window, to count as regression rather than
# a rough patch. Without this the level's own inertia hides a real slide: a
# lifter who peaked in July and has trained 15% under it every week since
# would read as "stalled" forever, because a peak-anchored level cannot fall
# and the machine would have nothing else to look at.
REGRESSION_MARGIN = 1.5
# Deliberately longer than the trend window. Training under your peak for two
# or three weeks is an accumulation block doing what it is supposed to do;
# calling that a decline would have the hub arguing against normal
# periodisation. Four straight weeks is past what a block explains.
REGRESSION_WINDOW_WEEKS = 4

STATE_LABELS = {
    "building": "Building",
    "holding": "Holding",
    "stalled": "Stalled",
    "declining": "Declining",
    "unknown": "Building baseline",
}


@dataclass
class IndexPoint:
    week_start: str
    level: Optional[float]
    confidence: float
    current: Optional[float] = None
    planned_low: bool = False
    estimated: bool = False
    contributions: Dict[str, Optional[float]] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def weights_for(goal_direction: str) -> Dict[str, float]:
    return GOAL_WEIGHTS.get(goal_direction, GOAL_WEIGHTS["maintain"])


def build_series(
    domains: List[Any],
    axis: List[str],
    goal_direction: str,
    planned_low_weeks: Optional[set] = None,
) -> List[IndexPoint]:
    """Fold the domain levels into one weekly index, renormalizing over what exists."""
    planned_low = planned_low_weeks or set()
    weights = weights_for(goal_direction)
    by_key = {d.key: d for d in domains}

    points: List[IndexPoint] = []
    for w_idx, week in enumerate(axis):
        total_weight = 0.0
        weighted_level = 0.0
        weighted_conf = 0.0
        current_weight = 0.0
        weighted_current = 0.0
        contributions: Dict[str, Optional[float]] = {}
        estimated = False

        for key, weight in weights.items():
            domain = by_key.get(key)
            point = domain.series[w_idx] if domain and w_idx < len(domain.series) else None
            contributions[key] = point.level if point else None
            if not point or point.level is None:
                continue
            total_weight += weight
            weighted_level += point.level * weight
            weighted_conf += point.coverage * weight
            estimated = estimated or point.estimated
            if point.current is not None:
                current_weight += weight
                weighted_current += point.current * weight

        level = round(weighted_level / total_weight, 1) if total_weight > 0 else None
        confidence = round(weighted_conf / total_weight, 2) if total_weight > 0 else 0.0
        current = round(weighted_current / current_weight, 1) if current_weight > 0 else None
        points.append(
            IndexPoint(
                week_start=week,
                level=level,
                confidence=confidence,
                current=current,
                planned_low=week in planned_low,
                estimated=estimated,
                contributions=contributions,
            )
        )
    return points


def noise_band(points: List[IndexPoint]) -> float:
    """
    This user's own week-to-week variance, as a symmetric band around zero.

    Mean absolute deviation rather than a standard deviation: with six or eight
    weeks of history a single outlier dominates a variance, and the outlier is
    usually the very week the band is supposed to absorb.

    Measured around the *mean* delta, not around zero. Someone climbing a
    steady half point a week is not bouncing around — but scored against zero
    their steadiness would inflate the band by exactly the trend being looked
    for, and the band would grow itself out of ever detecting it.
    """
    levels = [p.level for p in points if p.level is not None and not p.planned_low]
    deltas = [b - a for a, b in zip(levels, levels[1:])]
    if not deltas:
        return MIN_BAND
    mean = sum(deltas) / len(deltas)
    spread = sum(abs(d - mean) for d in deltas) / len(deltas)
    return round(max(MIN_BAND, spread), 2)


def _scored(points: List[IndexPoint]) -> List[IndexPoint]:
    """Weeks that carry a level and were not a week the plan asked to be light."""
    return [p for p in points if p.level is not None and not p.planned_low]


def classify(points: List[IndexPoint], band: float) -> Dict[str, Any]:
    """
    Name what the index is doing, and say why in one sentence.

    The return is the whole narrative contract: a state, the delta that
    produced it, and a reason string that has to survive being read by someone
    who just had a bad week.
    """
    scored = _scored(points)
    latest = scored[-1] if scored else None

    if len(scored) < MIN_WEEKS_FOR_STATE or not latest or latest.confidence < MIN_CONFIDENCE:
        need = max(0, MIN_WEEKS_FOR_STATE - len(scored))
        return {
            "state": "unknown",
            "label": STATE_LABELS["unknown"],
            "delta": None,
            "band": band,
            "reason": (
                f"{need} more week{'s' if need != 1 else ''} of logging before this can say anything."
                if need
                else "Not enough logged this week to read a direction."
            ),
        }

    deltas = [round(b.level - a.level, 1) for a, b in zip(scored, scored[1:])]
    delta = deltas[-1]

    if delta < -band:
        # The guard rail. A drop is only a direction when it is sustained,
        # outside the band, and backed by coverage. One bad week is a week.
        sustained = len(deltas) >= SUSTAINED_WEEKS and all(
            d < -band for d in deltas[-SUSTAINED_WEEKS:]
        )
        covered = latest.confidence >= MIN_CONFIDENCE_FOR_DECLINE
        if sustained and covered:
            return {
                "state": "declining",
                "label": STATE_LABELS["declining"],
                "delta": delta,
                "band": band,
                "reason": f"Down {SUSTAINED_WEEKS} weeks running, both past your usual swing of {band:.1f}.",
            }
        return {
            "state": "holding",
            "label": STATE_LABELS["holding"],
            "delta": delta,
            "band": band,
            "reason": "One light week. Nothing you've demonstrated has gone away — no change needed.",
        }

    # A bad week cannot push the level down — the level is what the user has
    # demonstrated, and one bad session does not un-demonstrate it. So the bad
    # week reaches this machine only through the fast signal, and without
    # checking it a hard week reads as an absence of progress and gets called a
    # stall. This is the "one light week" branch; it is unreachable from the
    # level alone.
    recent_current = [p.current for p in scored[-(TREND_WINDOW_WEEKS + 1):-1] if p.current is not None]
    if (
        latest.current is not None
        and len(recent_current) >= 2
        and latest.current < sum(recent_current) / len(recent_current) - band
    ):
        return {
            "state": "holding",
            "label": STATE_LABELS["holding"],
            "delta": delta,
            "band": band,
            "reason": "A hard week — but nothing you had already demonstrated has gone away.",
        }

    # Working consistently below what you have already demonstrated, week after
    # week. Not a dip — a level the user has settled at.
    span = [p for p in scored[-REGRESSION_WINDOW_WEEKS:] if p.current is not None and p.level is not None]
    if (
        len(span) >= REGRESSION_WINDOW_WEEKS
        and all(p.current < p.level - REGRESSION_MARGIN for p in span)
        and latest.confidence >= MIN_CONFIDENCE_FOR_DECLINE
    ):
        gap = round(latest.level - latest.current, 1)
        return {
            "state": "declining",
            "label": STATE_LABELS["declining"],
            "delta": delta,
            "band": band,
            "reason": f"{REGRESSION_WINDOW_WEEKS} weeks running under what you've already shown you can do.",
        }

    # No single week stands out. Ask the window instead: a run of small moves
    # all pointing the same way is a trend even when no one week is.
    window = deltas[-TREND_WINDOW_WEEKS:]
    trend = sum(window) / len(window)
    threshold = band / (len(window) ** 0.5)

    if trend > threshold:
        total = round(sum(window), 1)
        return {
            "state": "building",
            "label": STATE_LABELS["building"],
            "delta": delta,
            "band": band,
            "reason": f"Up {abs(total):.1f} over {len(window)} weeks — small steps, but all the same way.",
        }

    if trend < -threshold and latest.confidence >= MIN_CONFIDENCE_FOR_DECLINE:
        total = round(sum(window), 1)
        return {
            "state": "declining",
            "label": STATE_LABELS["declining"],
            "delta": delta,
            "band": band,
            "reason": f"Down {abs(total):.1f} over {len(window)} weeks with good logging.",
        }

    # Every week inside the band is not enough to call a stall: three weeks of
    # small honest gains are each inside the band, and calling that "flat for
    # three weeks, worth changing something" is the accusation this design
    # exists to avoid. The window has to have gone nowhere in total as well.
    flat = (
        len(deltas) >= FLAT_STREAK_WEEKS
        and all(abs(d) <= band for d in deltas[-FLAT_STREAK_WEEKS:])
        and abs(sum(deltas[-FLAT_STREAK_WEEKS:])) <= band
    )
    if flat and latest.confidence >= MIN_CONFIDENCE_FOR_DECLINE:
        return {
            "state": "stalled",
            "label": STATE_LABELS["stalled"],
            "delta": delta,
            "band": band,
            "reason": f"Flat for {FLAT_STREAK_WEEKS} weeks with good logging. Worth changing something.",
        }

    return {
        "state": "holding",
        "label": STATE_LABELS["holding"],
        "delta": delta,
        "band": band,
        "reason": "Inside your normal week-to-week range. Steady.",
    }


def range_delta(points: List[IndexPoint], domains: List[Any]) -> Dict[str, Any]:
    """
    Change across the whole visible range, decomposed by domain.

    The decomposition is not decoration. An index that moves without saying
    which part moved is the failure mode this feature was built to avoid.
    """
    scored = _scored(points)
    if len(scored) < 2:
        return {"value": None, "drivers": []}

    last = scored[-1]
    drivers = []
    for domain in domains:
        # Each domain's own first reading, not the index's. Strength needs two
        # weeks per lift before it scores, so anchoring on the index's first
        # week dropped it from the list — leaving the drivers naming every
        # domain except the one that actually moved the number.
        start = next(
            (p.contributions.get(domain.key) for p in scored
             if p.contributions.get(domain.key) is not None),
            None,
        )
        end = last.contributions.get(domain.key)
        if start is None or end is None:
            continue
        drivers.append(
            {
                "key": domain.key,
                "label": domain.label,
                "change": round(end - start, 1),
            }
        )
    drivers.sort(key=lambda d: abs(d["change"]), reverse=True)
    return {
        "value": round(last.level - scored[0].level, 1),
        "from_week": scored[0].week_start,
        "to_week": last.week_start,
        "drivers": drivers,
    }
