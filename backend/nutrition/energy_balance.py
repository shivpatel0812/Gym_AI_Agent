"""
Whether this user is eating in a surplus, at maintenance, or in a deficit.

The forward projection needs this because strength is built out of surplus
energy: the same program returns less at maintenance and less again in a
deficit. It used to read a three-way string off the plan document, which is a
statement of *intent* and can be years stale or simply wrong — one real plan
carried `nutrition_goal: "maintain"` beside a 2350 kcal target for a user whose
maintenance is 2660, which is a deficit by 310 kcal a day.

So this resolves the question from evidence where evidence exists, and says
which rung answered. The order is by how directly each source measures the
thing rather than by how easy it is to read:

    bodyweight_trend   what the scale did. The only real measurement here;
                       everything else is inference about what should follow.
    logged_intake      what was eaten, against estimated maintenance.
    plan_target        what the plan prescribes, against estimated maintenance.
                       Arithmetic on two numbers, no self-report involved.
    plan_label         the stated goal. What this module replaced.

A rung that cannot answer is skipped, not guessed at. When none can, the result
is None and the caller applies no adjustment — an unknown diet is not evidence
of a deficit.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

from nutrition.trajectory import estimate_maintenance_calories

BALANCE_GAIN = "gain"
BALANCE_MAINTAIN = "maintain"
BALANCE_LOSE = "lose"
VALID_BALANCES = (BALANCE_GAIN, BALANCE_MAINTAIN, BALANCE_LOSE)

# --- bodyweight trend ---------------------------------------------------

# Below this the slope is drawn through too few points to separate a trend
# from a bad weigh-in, and one 3 lb water swing sets the direction.
MIN_WEIGHINS = 4
MIN_WEIGHIN_SPAN_DAYS = 21

# Pounds per week inside which the scale is judged flat. Roughly a pound a
# month — under that, day-to-day variation in food volume, hydration and
# glycogen is larger than the signal.
FLAT_LB_PER_WEEK = 0.25

# --- logged intake ------------------------------------------------------

MIN_COMPLETE_DAYS = 10
INTAKE_WINDOW_DAYS = 28

# A day is counted only if it looks logged to the end. Well under half a
# target is far more often an abandoned log than a real fast — one archive
# holds 130 and 290 kcal days beside 2300 kcal days from the same user.
#
# This biases the mean *upward*, because the days it drops are the low ones,
# and that bias runs toward reporting a surplus. That is the optimistic
# direction and therefore the one worth naming: the count of dropped days is
# returned so a caller can show it rather than quietly average over it.
COMPLETE_DAY_MIN_FRACTION = 0.5
COMPLETE_DAY_FLOOR_KCAL = 800

# --- comparison against maintenance -------------------------------------

# Maintenance is a formula estimate carrying real error, so a narrow band
# around it reads as "at maintenance" rather than resolving every rounding
# difference into a direction.
MAINTENANCE_BAND = 0.05


@dataclass
class EnergyBalance:
    balance: Optional[str]
    source: str
    detail: Optional[str] = None
    measured: bool = False
    days_used: Optional[int] = None
    days_dropped: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "balance": self.balance,
            "source": self.source,
            "measured": self.measured,
        }
        if self.detail:
            payload["detail"] = self.detail
        if self.days_used is not None:
            payload["days_used"] = self.days_used
        if self.days_dropped:
            payload["days_dropped"] = self.days_dropped
        return payload


def _num(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out and abs(out) != float("inf") else None


def _parse_date(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(text[: len(fmt) + 6], fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", ""))
    except ValueError:
        return None


def _classify_against(observed: float, maintenance: float) -> str:
    ratio = observed / maintenance
    if ratio > 1 + MAINTENANCE_BAND:
        return BALANCE_GAIN
    if ratio < 1 - MAINTENANCE_BAND:
        return BALANCE_LOSE
    return BALANCE_MAINTAIN


def weight_trend_lb_per_week(weigh_ins: List[Dict[str, Any]]) -> Optional[float]:
    """
    Least-squares slope through logged bodyweight, in pounds per week.

    Least squares rather than first-versus-last: two endpoints hand the whole
    verdict to whichever two mornings happened to bookend the window, and
    bodyweight swings several pounds inside a day. Same reasoning as the Body
    domain in the Progress hub, which is the other place this question is asked.
    """
    points = []
    for entry in weigh_ins or []:
        if not isinstance(entry, dict):
            continue
        # `weight_lb` is what the weigh_ins collection stores; the others are
        # accepted so a caller can pass rows from elsewhere without reshaping.
        weight = _num(
            entry.get("weight_lb")
            or entry.get("weight")
            or entry.get("bodyweight")
        )
        when = _parse_date(entry.get("date") or entry.get("logged_at"))
        if weight and weight > 0 and when:
            points.append((when, weight))

    if len(points) < MIN_WEIGHINS:
        return None

    points.sort(key=lambda p: p[0])
    span_days = (points[-1][0] - points[0][0]).days
    if span_days < MIN_WEIGHIN_SPAN_DAYS:
        return None

    origin = points[0][0]
    xs = [(when - origin).days / 7.0 for when, _ in points]
    ys = [weight for _, weight in points]
    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    variance = sum((x - mean_x) ** 2 for x in xs)
    if variance <= 0:
        return None
    covariance = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    return covariance / variance


def complete_intake_days(
    macro_days: List[Dict[str, Any]],
    target_calories: Optional[float] = None,
    window: int = INTAKE_WINDOW_DAYS,
) -> Dict[str, Any]:
    """
    Mean daily calories over days that look logged to the end.

    A partly-logged day and a genuinely light day are the same document, so
    this cannot distinguish them — it can only refuse the ones far enough
    below target that an abandoned log is the likelier reading, and report how
    many it refused.
    """
    floor = COMPLETE_DAY_FLOOR_KCAL
    if target_calories and target_calories > 0:
        floor = max(floor, target_calories * COMPLETE_DAY_MIN_FRACTION)

    dated = []
    for entry in macro_days or []:
        if not isinstance(entry, dict):
            continue
        calories = _num(entry.get("calories") or entry.get("total_calories"))
        when = _parse_date(entry.get("date"))
        if calories is not None and calories > 0:
            dated.append((when, calories))

    dated.sort(key=lambda p: (p[0] is not None, p[0]), reverse=True)
    considered = dated[:window]
    kept = [calories for _, calories in considered if calories >= floor]

    return {
        "mean_calories": (sum(kept) / len(kept)) if kept else None,
        "days_used": len(kept),
        "days_dropped": len(considered) - len(kept),
        "floor": round(floor),
    }


def resolve_energy_balance(
    profile: Optional[Dict[str, Any]] = None,
    plan: Optional[Dict[str, Any]] = None,
    weigh_ins: Optional[List[Dict[str, Any]]] = None,
    macro_days: Optional[List[Dict[str, Any]]] = None,
) -> EnergyBalance:
    """Resolve energy balance from the best evidence available, and say which."""
    profile = profile or {}
    plan = plan or {}

    trend = weight_trend_lb_per_week(weigh_ins or [])
    if trend is not None:
        if trend > FLAT_LB_PER_WEEK:
            balance = BALANCE_GAIN
        elif trend < -FLAT_LB_PER_WEEK:
            balance = BALANCE_LOSE
        else:
            balance = BALANCE_MAINTAIN
        return EnergyBalance(
            balance=balance,
            source="bodyweight_trend",
            detail=f"{trend:+.2f} lb/week over your logged weigh-ins",
            measured=True,
        )

    try:
        maintenance = estimate_maintenance_calories(profile)
    except (TypeError, ValueError, OverflowError):
        maintenance = None

    companion = plan.get("nutrition_companion") or {}
    targets = companion.get("targets") or {}
    target_calories = _num(targets.get("calories")) or _num(
        (profile.get("nutrition_targets") or {}).get("calories")
    )

    if maintenance and maintenance > 0:
        intake = complete_intake_days(macro_days or [], target_calories)
        if intake["mean_calories"] and intake["days_used"] >= MIN_COMPLETE_DAYS:
            mean = intake["mean_calories"]
            return EnergyBalance(
                balance=_classify_against(mean, maintenance),
                source="logged_intake",
                detail=(
                    f"{mean:.0f} kcal/day logged against an estimated "
                    f"{maintenance} maintenance"
                ),
                measured=True,
                days_used=intake["days_used"],
                days_dropped=intake["days_dropped"],
            )

        if target_calories and target_calories > 0:
            return EnergyBalance(
                balance=_classify_against(target_calories, maintenance),
                source="plan_target",
                detail=(
                    f"plan targets {target_calories:.0f} kcal against an "
                    f"estimated {maintenance} maintenance"
                ),
                measured=False,
            )

    label = str(plan.get("nutrition_goal") or companion.get("goal") or "").strip().lower()
    # "muscle" and "build_muscle" are goal names the nutrition side uses; they
    # mean a surplus is intended.
    if label in ("muscle", "build_muscle", "bulk"):
        label = BALANCE_GAIN
    elif label in ("fat_loss", "cut", "lose_fat"):
        label = BALANCE_LOSE
    if label in VALID_BALANCES:
        return EnergyBalance(
            balance=label,
            source="plan_label",
            detail="from the plan's stated nutrition goal",
            measured=False,
        )

    return EnergyBalance(balance=None, source="unknown", measured=False)
