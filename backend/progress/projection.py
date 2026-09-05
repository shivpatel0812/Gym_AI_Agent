"""
Where the index goes next, on the same axis it came from.

The strength half is real: `plan_projection` runs the live `ProgressionEngine`
forward session by session, seeded from actual history, so the curve is what
the app will actually prescribe rather than something fitted to look
encouraging. This module only re-expresses that walk in index units.

**Two lines, never one.** `best_case` assumes every target is met; `realistic`
is the same walk after `measure_adherence`. A single confident forward line is
the failure this avoids — it reads well on day one and tells the user they are
failing by week five while they are training normally.

**Only strength is projected.** Consistency, nutrition and body are carried
forward flat at today's level and labelled as held, because the plan projects
lifts — it does not project whether someone will log their food. Ramping them
would be inventing the most flattering part of the picture. The consequence is
an honest, modest forward slope, and the caption has to say why.
"""

from typing import Any, Dict, List, Optional

from .index import IndexPoint, weights_for
from .weeks import week_label

# Past this the projection is fantasy: the plan will have been revised and the
# user's life will have changed. Mirrors MAX_PROJECTION_WEEKS upstream.
MAX_FORWARD_WEEKS = 16
DEFAULT_FORWARD_WEEKS = 8

HELD_DOMAINS = ("consistency", "nutrition", "body")


def _running_ratio(points: List[Dict[str, Any]], base: float, weeks: int) -> List[float]:
    """
    Peak-to-date e1RM over `base`, one value per projected week.

    Peak rather than the week's own figure, for the same reason the live index
    is peak-anchored: e1RM dips on the session a weight jump lands, so reading
    each week directly would draw a saw-toothed forward line that implies
    losses the plan never prescribes.
    """
    best_by_week: Dict[int, float] = {}
    for point in points or []:
        week = int(point.get("week") or 0)
        value = float(point.get("e1rm") or 0)
        if week > 0 and value > best_by_week.get(week, 0):
            best_by_week[week] = value

    ratios: List[float] = []
    peak = base
    for week in range(1, weeks + 1):
        peak = max(peak, best_by_week.get(week, 0))
        ratios.append(peak / base if base > 0 else 1.0)
    return ratios


def build_forward_series(
    exercise_projections: List[Dict[str, Any]],
    current_levels: Dict[str, Optional[float]],
    goal_direction: str,
    forward_weeks: List[str],
) -> Dict[str, Any]:
    """
    Forward index points for both cases, plus what is being assumed.

    Returns an `available: False` shape rather than a flat line when strength
    has no level to scale — a forward projection of an index that does not
    exist yet would be pure decoration.
    """
    weeks = len(forward_weeks)
    strength_now = current_levels.get("strength")
    usable = [
        p for p in exercise_projections or []
        if (p.get("current") or {}).get("e1rm") and not p.get("is_cardio")
    ]
    if strength_now is None or not usable or weeks == 0:
        return {
            "available": False,
            "reason": (
                "Not enough lift history to project forward yet."
                if strength_now is None
                else "The active plan has no projectable lifts."
            ),
        }

    best_ratios: List[List[float]] = []
    real_ratios: List[List[float]] = []
    for projection in usable:
        base = float((projection.get("current") or {}).get("e1rm") or 0)
        if base <= 0:
            continue
        best_ratios.append(_running_ratio(projection.get("best_case"), base, weeks))
        real_ratios.append(_running_ratio(projection.get("realistic"), base, weeks))

    if not best_ratios:
        return {"available": False, "reason": "The active plan has no projectable lifts."}

    weights = weights_for(goal_direction)

    def series(ratio_sets: List[List[float]]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for w_idx, week_start in enumerate(forward_weeks):
            multiplier = sum(r[w_idx] for r in ratio_sets) / len(ratio_sets)
            projected = {"strength": strength_now * multiplier}
            for key in HELD_DOMAINS:
                if current_levels.get(key) is not None:
                    projected[key] = current_levels[key]

            total = sum(weights[k] for k in projected if k in weights)
            if total <= 0:
                continue
            level = sum(projected[k] * weights[k] for k in projected if k in weights) / total
            out.append(
                {
                    "week_start": week_start,
                    "label": week_label(week_start),
                    "level": round(level, 1),
                    "strength": round(projected["strength"], 1),
                }
            )
        return out

    return {
        "available": True,
        "weeks": weeks,
        "best_case": series(best_ratios),
        "realistic": series(real_ratios),
        "projected_domains": ["strength"],
        "held_domains": [k for k in HELD_DOMAINS if current_levels.get(k) is not None],
        "assumption": (
            "Only lifts are projected — the plan can say what it will prescribe, "
            "not whether you'll log your food. Everything else is held at today's level."
        ),
        "lifts": len(best_ratios),
    }
