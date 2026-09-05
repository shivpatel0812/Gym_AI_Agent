"""
The four progress domains, each reported as a level and a trend.

The split is the whole design. A bad week is three different things that look
identical on a chart:

    no evidence      nothing trained, nothing logged. Nothing new is known.
    expected low     a deload or a diet break. The plan asked for this.
    real decline     trained, logged, and the numbers went down.

Only the third is information, so only the third is allowed to move a level.

    level    what the user has demonstrated they can do. Anchored on the best
             recent evidence, never the latest, so a single bad week is
             structurally incapable of lowering it. It falls only through
             detraining decay, and says so when it does.
    current  the fast signal for this week. A bad week shows up here, and in
             the trend arrow, not in the level.

Every level is expressed as an index where 100 is that user's own starting
point or their own plan's expectation — never a population norm. A cut and a
bulk must both be able to score 100, or it is a fitness score wearing a
progress score's name.
"""

from dataclasses import asdict, dataclass, field
from statistics import median
from typing import Any, Dict, List, Optional

from .weeks import bucket_by_week, parse_day, week_start_of

# --- strength ---------------------------------------------------------------

# Epley is a straight line fit and stops meaning anything past about a dozen
# reps: a 30-rep set would report double the load as a 1RM. Those sets carry no
# 1RM information, so they are skipped rather than clamped — clamping would
# quietly assert a number the set never evidenced.
MAX_E1RM_REPS = 12

# An exercise contributes nothing until its second observed week. Its first
# week is its own baseline and would enter the mean as a flat 100, diluting
# every real gain in the index every time the user tries a new lift.
MIN_EXERCISE_WEEKS = 2

# Weeks of silence before a lift's demonstrated level starts to soften, and the
# point at which it leaves the index entirely. Capability really does fade, on
# the order of weeks — but a lift tried once and abandoned should stop dragging
# the index rather than decay toward zero forever.
STALE_AFTER_WEEKS = 3
DROP_AFTER_WEEKS = 8
DECAY_PER_WEEK = 0.015

# --- consistency ------------------------------------------------------------

TRAILING_WEEKS = 4
DEFAULT_SESSIONS_PER_WEEK = 3

# --- nutrition --------------------------------------------------------------

CALORIE_TOLERANCE = 0.10   # within +/-10% of target counts as hit
PROTEIN_FLOOR = 0.90       # 90% of target counts as hit

# --- body -------------------------------------------------------------------

# Trend is a least-squares slope over the trailing window, not an EMA. An
# exponential filter needs roughly 1/alpha samples to converge, and at one
# weigh-in a week that is a month during which a real cut is systematically
# understated — which drew a fake dip and then a fake recovery at the start of
# every user's chart. A regression has no warm-up.
MIN_FIT_POINTS = 3
MIN_WEIGH_INS = 4
BODY_WINDOW_WEEKS = 4
# Expected fraction of bodyweight per week, by goal direction.
EXPECTED_WEEKLY_RATE = {"cut": 0.0075, "gain": 0.0035}
# A maintain goal is scored on drift instead of rate.
MAINTAIN_TOLERANCE = 0.004
# Full marks inside this band around the expected rate; zero at the outer edge.
RATE_FULL_BAND = 0.3
RATE_ZERO_AT = 1.2

CUT_GOALS = {"cut", "lose", "lose_weight", "fat_loss", "weight_loss"}
GAIN_GOALS = {"gain", "bulk", "lean_bulk", "gain_weight", "muscle_gain", "build_muscle"}


@dataclass
class WeekPoint:
    week_start: str
    level: Optional[float]
    current: Optional[float]
    coverage: float
    estimated: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Domain:
    key: str
    label: str
    series: List[WeekPoint] = field(default_factory=list)
    detail: Dict[str, Any] = field(default_factory=dict)
    unavailable_reason: Optional[str] = None

    def latest(self) -> Optional[WeekPoint]:
        return self.series[-1] if self.series else None

    def level(self) -> Optional[float]:
        point = self.latest()
        return point.level if point else None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "level": self.level(),
            "series": [p.to_dict() for p in self.series],
            "detail": self.detail,
            "unavailable_reason": self.unavailable_reason,
        }


def _mean(values: List[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None


def e1rm(weight: Any, reps: Any) -> Optional[float]:
    """
    Estimated 1RM from a single set.

    Within one set, deliberately. Pairing a heavy set's load with a light set's
    reps reports a number the user has never been near.
    """
    try:
        w = float(weight or 0)
        r = int(reps or 0)
    except (TypeError, ValueError):
        return None
    if w <= 0 or r <= 0 or r > MAX_E1RM_REPS:
        return None
    return w * (1 + r / 30)


# ---------------------------------------------------------------------------
# Strength — lifts as positions, e1RM as the price
# ---------------------------------------------------------------------------

def _weekly_best_e1rm(sessions: List[Dict[str, Any]], axis: List[str]) -> Dict[str, Dict[str, float]]:
    """{exercise_id: {week: best e1RM that week}} plus a name lookup."""
    allowed = set(axis)
    best: Dict[str, Dict[str, float]] = {}
    for session in sessions or []:
        week = week_start_of(session.get("date"))
        if not week or week not in allowed:
            continue
        for exercise in session.get("exercises") or []:
            if not isinstance(exercise, dict):
                continue
            key = str(exercise.get("exercise_id") or exercise.get("exercise_name") or "").strip()
            if not key:
                continue
            for s in exercise.get("sets") or []:
                if not isinstance(s, dict):
                    continue
                value = e1rm(s.get("weight"), s.get("reps"))
                if value is None:
                    continue
                slot = best.setdefault(key, {})
                if value > slot.get(week, 0):
                    slot[week] = value
    return best


def _exercise_names(sessions: List[Dict[str, Any]]) -> Dict[str, str]:
    names: Dict[str, str] = {}
    for session in sessions or []:
        for exercise in session.get("exercises") or []:
            if not isinstance(exercise, dict):
                continue
            key = str(exercise.get("exercise_id") or exercise.get("exercise_name") or "").strip()
            name = str(exercise.get("exercise_name") or "").strip()
            if key and name:
                names.setdefault(key, name)
    return names


def build_strength(sessions: List[Dict[str, Any]], axis: List[str]) -> Domain:
    weekly = _weekly_best_e1rm(sessions, axis)
    names = _exercise_names(sessions)
    if not weekly:
        return Domain(
            key="strength",
            label="Strength",
            unavailable_reason="No logged sets with a weight and reps yet.",
        )

    series: List[WeekPoint] = []
    positions: Dict[str, Dict[str, Any]] = {}

    for w_idx, week in enumerate(axis):
        upto = axis[: w_idx + 1]
        ratios: List[float] = []
        fresh: List[float] = []
        estimated_any = False

        for key, by_week in weekly.items():
            seen = [w for w in upto if w in by_week]
            if len(seen) < MIN_EXERCISE_WEEKS:
                continue
            baseline = by_week[seen[0]]
            if baseline <= 0:
                continue
            peak = max(by_week[w] for w in seen)
            stale_weeks = len(upto) - 1 - upto.index(seen[-1])
            if stale_weeks > DROP_AFTER_WEEKS:
                # Tried once, abandoned. Stop dragging the index with it.
                continue
            ratio = peak / baseline
            if stale_weeks > STALE_AFTER_WEEKS:
                ratio *= (1 - DECAY_PER_WEEK) ** (stale_weeks - STALE_AFTER_WEEKS)
                estimated_any = True
            ratios.append(ratio)
            if week in by_week:
                fresh.append(by_week[week] / baseline)

            if w_idx == len(axis) - 1:
                positions[key] = {
                    "exercise_id": key,
                    "name": names.get(key, key),
                    "baseline_e1rm": round(baseline, 1),
                    "peak_e1rm": round(peak, 1),
                    "latest_e1rm": round(by_week[seen[-1]], 1),
                    "change_pct": round((peak / baseline - 1) * 100, 1),
                    "weeks_stale": stale_weeks,
                    "estimated": stale_weeks > STALE_AFTER_WEEKS,
                }

        level = _mean(ratios)
        current = _mean(fresh)
        trained = any(week in by_week for by_week in weekly.values())
        series.append(
            WeekPoint(
                week_start=week,
                level=round(level * 100, 1) if level is not None else None,
                current=round(current * 100, 1) if current is not None else None,
                coverage=1.0 if trained else 0.0,
                estimated=estimated_any,
            )
        )

    ranked = sorted(positions.values(), key=lambda p: p["change_pct"], reverse=True)
    return Domain(
        key="strength",
        label="Strength",
        series=series,
        detail={
            "positions": ranked,
            "movers": ranked[:3],
            "laggards": [p for p in reversed(ranked) if p["change_pct"] <= 0][:3],
            "tracked": len(ranked),
        },
    )


# ---------------------------------------------------------------------------
# Consistency
# ---------------------------------------------------------------------------

def build_consistency(
    sessions: List[Dict[str, Any]],
    axis: List[str],
    expected_per_week: Optional[float],
    weeks_with_any_data: Dict[str, bool],
) -> Domain:
    """
    Sessions that happened against sessions the plan expected.

    Coverage carries the one genuine ambiguity here: a user who trains without
    logging is indistinguishable from one who does not train. So a week with no
    data of *any* kind — no sessions, no food, no weigh-in — is treated as no
    evidence rather than as zero sessions. A week with food logs but no
    workouts is real evidence of missed sessions, and counts.
    """
    buckets = bucket_by_week(sessions, axis)
    counts = {w: len({str(r.get("date"))[:10] for r in rows}) for w, rows in buckets.items()}

    expected = expected_per_week
    if not expected or expected <= 0:
        observed = [c for c in counts.values() if c > 0]
        expected = median(observed) if observed else DEFAULT_SESSIONS_PER_WEEK
    expected = max(1.0, float(expected))

    series: List[WeekPoint] = []
    rates: List[Optional[float]] = []
    for week in axis:
        has_data = weeks_with_any_data.get(week, False)
        rate = min(1.0, counts[week] / expected) if has_data else None
        rates.append(rate)
        window = [r for r in rates[-TRAILING_WEEKS:] if r is not None]
        level = _mean(window)
        series.append(
            WeekPoint(
                week_start=week,
                level=round(level * 100, 1) if level is not None else None,
                current=round(rate * 100, 1) if rate is not None else None,
                coverage=1.0 if has_data else 0.0,
            )
        )

    return Domain(
        key="consistency",
        label="Consistency",
        series=series,
        detail={
            "expected_per_week": round(expected, 1),
            "sessions_by_week": counts,
            "sessions_last_week": counts.get(axis[-1], 0) if axis else 0,
        },
    )


# ---------------------------------------------------------------------------
# Nutrition
# ---------------------------------------------------------------------------

def build_nutrition(
    macro_rows: List[Dict[str, Any]],
    axis: List[str],
    targets: Dict[str, Any],
) -> Domain:
    """
    Share of logged days that landed on the day's calorie and protein targets.

    Scored over logged days only. Days with no food logged lower coverage and
    never the level — otherwise the number measures how diligently someone
    opens the app, which is a different thing from how they ate.
    """
    calorie_target = float(targets.get("calories") or 0)
    protein_target = float(targets.get("protein") or 0)
    if calorie_target <= 0 and protein_target <= 0:
        return Domain(
            key="nutrition",
            label="Nutrition",
            unavailable_reason="No calorie or protein target set.",
        )

    buckets = bucket_by_week(macro_rows, axis)
    series: List[WeekPoint] = []
    rates: List[Optional[float]] = []
    detail_weeks: Dict[str, Any] = {}

    for week in axis:
        days = [r for r in buckets[week] if (r.get("total_calories") or r.get("total_protein"))]
        scores: List[float] = []
        for row in days:
            parts: List[float] = []
            if calorie_target > 0:
                cals = float(row.get("total_calories") or 0)
                off = abs(cals - calorie_target) / calorie_target
                parts.append(1.0 if off <= CALORIE_TOLERANCE else max(0.0, 1 - (off - CALORIE_TOLERANCE) / 0.4))
            if protein_target > 0:
                protein = float(row.get("total_protein") or 0)
                parts.append(min(1.0, protein / (protein_target * PROTEIN_FLOOR)))
            if parts:
                scores.append(sum(parts) / len(parts))
        rate = _mean(scores)
        rates.append(rate)
        window = [r for r in rates[-TRAILING_WEEKS:] if r is not None]
        level = _mean(window)
        detail_weeks[week] = {"days_logged": len(days)}
        series.append(
            WeekPoint(
                week_start=week,
                level=round(level * 100, 1) if level is not None else None,
                current=round(rate * 100, 1) if rate is not None else None,
                coverage=round(min(1.0, len(days) / 7), 2),
            )
        )

    return Domain(
        key="nutrition",
        label="Nutrition",
        series=series,
        detail={
            "calorie_target": round(calorie_target) or None,
            "protein_target": round(protein_target) or None,
            "weeks": detail_weeks,
            "days_logged_last_week": detail_weeks.get(axis[-1], {}).get("days_logged", 0) if axis else 0,
        },
    )


# ---------------------------------------------------------------------------
# Body
# ---------------------------------------------------------------------------

def goal_direction(goal: Optional[str]) -> str:
    key = str(goal or "").strip().lower().replace(" ", "_")
    if key in CUT_GOALS:
        return "cut"
    if key in GAIN_GOALS:
        return "gain"
    return "maintain"


def _rate_score(progress: float) -> float:
    """
    Tent function peaking at the expected rate.

    Faster is not better in either direction: a cut running at triple the
    planned rate is losing tissue the plan meant to keep, and reporting that as
    a higher score would recommend it.
    """
    off = abs(progress - 1.0)
    if off <= RATE_FULL_BAND:
        return 1.0
    if off >= RATE_ZERO_AT:
        return 0.0
    return 1 - (off - RATE_FULL_BAND) / (RATE_ZERO_AT - RATE_FULL_BAND)


def _fit(points: List[Dict[str, Any]]) -> Optional[Dict[str, float]]:
    """Least-squares line through (day offset, weight). None under 3 points."""
    if len(points) < MIN_FIT_POINTS:
        return None
    base = points[0]["day"]
    xs = [(p["day"] - base).days for p in points]
    ys = [p["weight"] for p in points]
    n = len(xs)
    mx = sum(xs) / n
    my = sum(ys) / n
    denom = sum((x - mx) ** 2 for x in xs)
    if denom == 0:
        return None
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denom
    intercept = my - slope * mx
    return {"slope_per_day": slope, "fitted_end": intercept + slope * xs[-1]}


def build_body(
    weigh_ins: List[Dict[str, Any]],
    axis: List[str],
    goal: Optional[str],
) -> Domain:
    """
    Bodyweight trend against the direction and rate the goal implies.

    On a fitted trend, never raw weigh-ins — day-to-day bodyweight swings on
    water and a raw line makes the hero chart look like a penny stock.
    """
    rows = [
        {"day": parse_day(r.get("date")), "weight": float(r.get("weight_lb") or 0)}
        for r in weigh_ins or []
    ]
    rows = [r for r in rows if r["day"] and r["weight"] > 0]
    rows.sort(key=lambda r: r["day"])
    if len(rows) < MIN_WEIGH_INS:
        return Domain(
            key="body",
            label="Body",
            unavailable_reason=f"Needs at least {MIN_WEIGH_INS} weigh-ins to read a trend.",
        )

    direction = goal_direction(goal)
    expected = EXPECTED_WEEKLY_RATE.get(direction, 0.0)
    counts: Dict[str, int] = {}
    for row in rows:
        week = week_start_of(row["day"].strftime("%Y-%m-%d"))
        if week:
            counts[week] = counts.get(week, 0) + 1

    series: List[WeekPoint] = []
    scores: List[Optional[float]] = []
    trend: List[Dict[str, Any]] = []
    latest_fit: Optional[Dict[str, float]] = None

    for w_idx, week in enumerate(axis):
        window_start = axis[max(0, w_idx - BODY_WINDOW_WEEKS)]
        window = [
            r
            for r in rows
            if window_start <= r["day"].strftime("%Y-%m-%d") <= _week_end(week)
        ]
        fit = _fit(window)
        score: Optional[float] = None
        if fit and fit["fitted_end"] > 0:
            latest_fit = fit
            rate = fit["slope_per_day"] * 7 / fit["fitted_end"]
            trend.append({"week_start": week, "weight_lb": round(fit["fitted_end"], 1)})
            if direction == "maintain":
                score = max(0.0, 1 - min(1.0, abs(rate) / MAINTAIN_TOLERANCE))
            elif expected:
                signed = -rate if direction == "cut" else rate
                score = _rate_score(signed / expected)

        scores.append(score)
        window_scores = [s for s in scores[-BODY_WINDOW_WEEKS:] if s is not None]
        level = _mean(window_scores)
        series.append(
            WeekPoint(
                week_start=week,
                level=round(level * 100, 1) if level is not None else None,
                current=round(score * 100, 1) if score is not None else None,
                coverage=round(min(1.0, counts.get(week, 0) / 2), 2),
                estimated=counts.get(week, 0) == 0 and score is not None,
            )
        )

    return Domain(
        key="body",
        label="Body",
        series=series,
        detail={
            "goal_direction": direction,
            "expected_weekly_pct": round(expected * 100, 2) if expected else 0.0,
            "latest_weight_lb": round(latest_fit["fitted_end"], 1) if latest_fit else None,
            "latest_weigh_in": rows[-1]["day"].strftime("%Y-%m-%d"),
            "change_lb": round(trend[-1]["weight_lb"] - trend[0]["weight_lb"], 1) if len(trend) > 1 else None,
            "weigh_in_count": len(rows),
            "trend": trend,
        },
    )


def _week_end(week: str) -> str:
    from datetime import timedelta as _td

    day = parse_day(week)
    return (day + _td(days=6)).strftime("%Y-%m-%d") if day else week
