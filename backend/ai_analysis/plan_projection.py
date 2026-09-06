"""
Forward projection of an Active Plan.

What makes this honest rather than decorative: the strength trajectory is
produced by running the real `ProgressionEngine` forward, session by session,
seeded from the user's actual history. It is not a curve fitted to look
encouraging — it is literally what the app will ask of them if they hit their
targets, computed by the same code that generates their live recommendations.

Two lines come out of that, and the difference between them matters:

  best case  — every prescribed target met, every scheduled session trained.
  realistic  — the same trajectory stretched by how consistently this user has
               actually trained and hit targets recently.

Shipping only the first would be the familiar failure of these charts: it reads
well on day one and quietly tells the user they are failing by week five, when
in fact they are training normally. The realistic line is the one to lead with;
the best case is the ceiling, labelled as such.

Nutrition is projected on the same week axis, because "eat more" and "lift
more" are one plan, and a user deciding whether a surplus is working needs to
see both against the same calendar.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .workout_recommender.goal_configs import RepRangeConfig, resolve_goal_config
from .workout_recommender.prescription import SessionOutcome, evaluate_session
from .workout_recommender.exercise_metadata import is_cardio
from .workout_recommender.cardio_progression import (
    CardioModality,
    classify_modality,
    compute_cardio_progression,
)
from .workout_recommender.progression_engine import ProgressionEngine

# Beyond this the projection is fantasy — the plan will have been revised, the
# user's life will have changed, and a 30-week strength curve invites belief it
# has not earned.
MAX_PROJECTION_WEEKS = 16
DEFAULT_PROJECTION_WEEKS = 8

# Below this, recent history says too little about consistency to scale by it.
MIN_SESSIONS_FOR_ADHERENCE = 4

# A neutral assumption for users without enough history to measure. Deliberately
# not 1.0: assuming a brand-new user will hit every session is the exact
# over-promise this module exists to avoid.
DEFAULT_ADHERENCE = 0.75


def exercise_sessions_per_week(plan: Dict[str, Any]) -> Dict[str, int]:
    """
    How many times each exercise is trained in a calendar week.

    Counted from the weekly schedule and which plan days carry the lift — not
    from how often a day *name* repeats. Push A and Push B each appear once a
    week, but incline on both is two sessions; treating each day as frequency 1
    made the recommendations table collapse to a single "Workout" column.
    """
    day_frequency: Dict[str, int] = {}
    for day_name in (plan.get("weekly_schedule") or {}).values():
        if not day_name or str(day_name).strip().lower() == "rest":
            continue
        key = str(day_name)
        day_frequency[key] = day_frequency.get(key, 0) + 1

    out: Dict[str, int] = {}
    for day in plan.get("days") or []:
        if not isinstance(day, dict):
            continue
        day_name = day.get("day_name")
        freq = day_frequency.get(day_name, 1) if day_name else 1
        for exercise in day.get("exercises") or []:
            if not isinstance(exercise, dict):
                continue
            ex_id = exercise.get("exercise_id")
            if not ex_id:
                continue
            out[ex_id] = out.get(ex_id, 0) + freq
    return out

# The most estimated 1RM a projection will claim per week, compounding.
#
# A modelling assumption, not a measurement: it is set generously, at roughly
# what a genuine novice manages early on, because it exists to stop the curve
# being absurd rather than to predict anyone in particular. Over twelve weeks
# it allows about 27% — ambitious but arguable. Without it, double progression
# compounds without limit and the projection promised a 95% gain on a lateral
# raise, which costs the user's trust in every other number on the page.
PLAUSIBLE_WEEKLY_E1RM_GAIN = 0.02

# The same figure by training age. Spending the novice rate on everyone is how
# a twelve-week chart came to promise a 24% gain on a lift that had not moved
# in seven months: the newbie window is the one period where 2% a week is
# ordinary, and it closes. These are rate-of-gain conventions, not measurements
# of any individual — which is exactly why the assumption is reported back in
# the payload rather than applied silently.
EXPERIENCE_WEEKLY_E1RM_GAIN = {
    "beginner": 0.020,
    "novice": 0.020,
    "intermediate": 0.008,
    "advanced": 0.004,
    "elite": 0.003,
}
# Matches the fallback profile_transformer and the coach already assume.
DEFAULT_EXPERIENCE_LEVEL = "intermediate"

# Strength is built out of surplus energy. The same program returns less at
# maintenance and less again in a deficit, so a projection blind to the
# nutrition plan quietly promises bulk-rate strength to someone eating to hold
# their weight. Deliberately not zero for a cut: strength is largely retained
# and often still creeps up in a deficit, it just stops running.
ENERGY_BALANCE_FACTOR = {
    "gain": 1.0,
    "maintain": 0.7,
    "lose": 0.4,
}

# Progression is indivisible, and that is the whole reason a ceiling needs
# slack. The smallest real step on a dumbbell lift is the next dumbbell or one
# more rep, and the next dumbbell can be worth more than a whole block of an
# advanced lifter's budget — 80 lb to 85 lb is 6.25%, against roughly 3.4% for
# twelve weeks of advanced gain at maintenance. A ceiling rising 0.28% a week
# admits no step at all and flatlines the curve at its seed, which is as
# useless as the runaway it replaced.
#
# So the walk may run one step ahead of the smooth budget, sized at about one
# extra rep. It buys the next rep, never the next two, and never the next
# dumbbell on its own — which is the correct answer: when the plates are too
# coarse to progress, reps are what moves, and the load follows once the reps
# have paid for it. This replaces a flat four-week grace period that scaled
# with nothing and, at the novice rate, handed the walk 8% of headroom on
# week one.
ONE_STEP_SLACK = 0.03


def plausible_weekly_gain(
    experience_level: Optional[str] = None,
    energy_balance: Optional[str] = None,
) -> float:
    """
    The weekly estimated-1RM budget for this lifter, eating the way they eat.

    Unknown experience falls back to intermediate rather than novice: assuming
    the newbie window on someone who may be years past it is the optimistic
    error, and this module exists to avoid those.
    """
    level = str(experience_level or DEFAULT_EXPERIENCE_LEVEL).strip().lower()
    rate = EXPERIENCE_WEEKLY_E1RM_GAIN.get(level)
    if rate is None:
        rate = EXPERIENCE_WEEKLY_E1RM_GAIN[DEFAULT_EXPERIENCE_LEVEL]
    balance = str(energy_balance or "").strip().lower()
    # An unstated nutrition goal is not evidence of a deficit; leave the rate
    # alone rather than penalising a plan that simply has no diet attached.
    return rate * ENERGY_BALANCE_FACTOR.get(balance, 1.0)


def plausibility_ceiling(
    baseline_e1rm: float, week: int, weekly_gain: float
) -> float:
    """The most estimated 1RM this lifter can plausibly hold by a given week."""
    return baseline_e1rm * ((1 + weekly_gain) ** week) * (1 + ONE_STEP_SLACK)


def exceeds_plausible_gain(
    candidate_e1rm: float,
    baseline_e1rm: Optional[float],
    week: int,
    weekly_gain: Optional[float] = None,
) -> bool:
    """Whether a projected week has outrun what training plausibly delivers."""
    if not baseline_e1rm or baseline_e1rm <= 0:
        return False
    if weekly_gain is None:
        weekly_gain = plausible_weekly_gain()
    return candidate_e1rm > plausibility_ceiling(baseline_e1rm, week, weekly_gain)


def pace_to_destination(
    baseline_e1rm: Optional[float],
    destination_e1rm: Optional[float],
    weeks: Optional[int],
    plausible_rate: float,
) -> float:
    """
    Slow the walk to arrive when the user said, not as fast as it can.

    A goal set for week twelve is a week-twelve target. Running open-loop and
    holding on arrival answered "85s for 6-8 by December" in week two and then
    drew a flat line for ten weeks — which reads as a plan with nothing left to
    do. Pacing spreads the same gain across the horizon the user chose.

    A goal that needs more than the plausible rate is not sped up to meet it.
    That gap is the finding, and `reachable` is where it gets reported.
    """
    if not baseline_e1rm or baseline_e1rm <= 0 or not destination_e1rm or not weeks:
        return plausible_rate
    if destination_e1rm <= baseline_e1rm:
        return plausible_rate
    required = (destination_e1rm / baseline_e1rm) ** (1.0 / max(1, weeks)) - 1.0
    return min(plausible_rate, required)


# Epley, matching _compute_e1rm_history in the progression engine.
def _num(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _int_reps(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def e1rm(weight: Any, reps: Any) -> float:
    w = _num(weight)
    r = _int_reps(reps)
    if w <= 0 or r <= 0:
        return 0.0
    return round(w * (1 + r / 30), 1)


def _normalize_history_sets(history: List[Dict]) -> List[Dict]:
    """Coerce logged set values so Firestore string fields cannot 500 projection."""
    normalized: List[Dict] = []
    for session in history or []:
        sets = []
        for workout_set in session.get("sets") or []:
            sets.append({
                **workout_set,
                "weight": _num(workout_set.get("weight")),
                "reps": _int_reps(workout_set.get("reps")),
            })
        normalized.append({**session, "sets": sets})
    return normalized


@dataclass
class WeekPoint:
    week: int
    weight: float
    reps: int
    e1rm: float
    decision: Optional[str] = None
    # Which session within the week this is (1-based). A lift trained twice a
    # week gets a different prescription each time — heavy then volume — and
    # collapsing the week to one number threw the second one away.
    session: int = 1
    # Every prescribed set, not just the top one. "80x6, 80x4, 80x4" is what
    # the user is actually asked to do; the top set alone cannot render it.
    sets: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "week": self.week,
            "weight": round(self.weight, 1),
            "reps": self.reps,
            "e1rm": self.e1rm,
            "session": self.session,
        }
        if self.decision:
            payload["decision"] = self.decision
        if self.sets:
            payload["sets"] = self.sets
        return payload


@dataclass
class CardioWeekPoint:
    """
    A projected cardio session.

    Kept separate from WeekPoint rather than borrowing its fields: a cardio
    week has minutes and a pace, not a load and a rep count, and squeezing it
    into the lifting shape would render "45 lb x 6" on a treadmill card.
    """

    week: int
    minutes: int
    speed: Optional[float] = None
    decision: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"week": self.week, "minutes": self.minutes}
        if self.speed is not None:
            payload["speed"] = self.speed
        if self.decision:
            payload["decision"] = self.decision
        return payload


@dataclass
class ExerciseProjection:
    exercise_id: str
    exercise_name: str
    day_name: str
    sessions_per_week: int
    current: Optional[WeekPoint]
    best_case: List[WeekPoint] = field(default_factory=list)
    realistic: List[WeekPoint] = field(default_factory=list)
    # False when there was no history to seed from, so the curve starts from an
    # estimate and should be presented with much less confidence.
    seeded_from_history: bool = True

    # Cardio projects duration and pace instead of load. When this is set the
    # lifting curves are empty and clients should read these.
    # Session-level prescriptions: one entry per workout, so a week with two
    # sessions renders as two columns rather than one averaged number.
    schedule: List[WeekPoint] = field(default_factory=list)

    is_cardio: bool = False
    cardio_modality: Optional[str] = None
    cardio_current: Optional[CardioWeekPoint] = None
    cardio_best_case: List[CardioWeekPoint] = field(default_factory=list)
    cardio_realistic: List[CardioWeekPoint] = field(default_factory=list)

    # User-stated finish line (e.g. 85×8 in 10 weeks). None when open-ended.
    destination: Optional[Dict[str, Any]] = None
    arrived_week: Optional[int] = None
    reachable: Optional[bool] = None

    # What the curve assumed about this lifter. Reported rather than applied
    # silently: these are conventions, not measurements, and a user who trains
    # like an intermediate or starts eating in a surplus should be able to see
    # which figure produced their chart and say it is wrong.
    assumptions: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        if self.is_cardio:
            return self._cardio_dict()
        start = self.current.e1rm if self.current else 0
        # Peak rather than final: estimated 1RM dips on the session a weight
        # jump lands (50x10 estimates higher than 55x6), so reading the gain off
        # the last week would report a loss purely because the horizon happened
        # to end on a reset.
        end_best = max((p.e1rm for p in self.best_case), default=start)
        end_real = max((p.e1rm for p in self.realistic), default=start)
        # When a destination is set, progress is toward that finish line, not
        # whatever peak the open walk happened to hit.
        if self.destination:
            dest_e1rm = e1rm(
                self.destination.get("weight"), self.destination.get("reps")
            )
            if dest_e1rm > 0:
                end_best = dest_e1rm
                end_real = dest_e1rm
        payload = {
            "exercise_id": self.exercise_id,
            "exercise_name": self.exercise_name,
            "day_name": self.day_name,
            "sessions_per_week": self.sessions_per_week,
            "seeded_from_history": self.seeded_from_history,
            "current": self.current.to_dict() if self.current else None,
            "best_case": [p.to_dict() for p in self.best_case],
            "realistic": [p.to_dict() for p in self.realistic],
            "schedule": [p.to_dict() for p in self.schedule],
            "gain": {
                "best_case_e1rm": round(end_best - start, 1),
                "realistic_e1rm": round(end_real - start, 1),
                "best_case_pct": round((end_best - start) / start * 100, 1) if start else None,
                "realistic_pct": round((end_real - start) / start * 100, 1) if start else None,
            },
        }
        if self.destination:
            payload["destination"] = self.destination
            payload["arrived_week"] = self.arrived_week
            payload["reachable"] = self.reachable
        if self.assumptions:
            payload["assumptions"] = self.assumptions
        return payload

    def _cardio_dict(self) -> Dict[str, Any]:
        start = self.cardio_current.minutes if self.cardio_current else 0
        end_best = max((p.minutes for p in self.cardio_best_case), default=start)
        end_real = max((p.minutes for p in self.cardio_realistic), default=start)
        return {
            "exercise_id": self.exercise_id,
            "exercise_name": self.exercise_name,
            "day_name": self.day_name,
            "sessions_per_week": self.sessions_per_week,
            "seeded_from_history": self.seeded_from_history,
            "is_cardio": True,
            "cardio_modality": self.cardio_modality,
            "current": None,
            "best_case": [],
            "realistic": [],
            "cardio_current": self.cardio_current.to_dict() if self.cardio_current else None,
            "cardio_best_case": [p.to_dict() for p in self.cardio_best_case],
            "cardio_realistic": [p.to_dict() for p in self.cardio_realistic],
            "gain": {
                "best_case_minutes": end_best - start,
                "realistic_minutes": end_real - start,
            },
        }


@dataclass
class Adherence:
    """How reliably this user has actually been training lately."""

    rate: float
    sessions_logged: int
    target_hit_rate: Optional[float]
    measured: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rate": round(self.rate, 2),
            "sessions_logged": self.sessions_logged,
            "target_hit_rate": (
                round(self.target_hit_rate, 2) if self.target_hit_rate is not None else None
            ),
            "measured": self.measured,
        }


def measure_adherence(
    exercise_histories: Dict[str, List[Dict]],
    goal: str,
    weeks_observed: int = 4,
) -> Adherence:
    """
    Derive a single consistency factor from recent training.

    Two things drag a real trajectory below its best case: sessions that never
    happen, and sessions that happen but fall short. Both are folded in here,
    because to a projection they have the same effect — the plan advances more
    slowly than the prescription implies.
    """
    total_sessions = 0
    hits = 0
    for exercise_id, sessions in (exercise_histories or {}).items():
        for session in sessions or []:
            sets = session.get("sets") or []
            if not sets:
                continue
            total_sessions += 1
            # The band here is approximate — the plan's own range per exercise
            # would be better, but this is a consistency signal, not a
            # prescription, and the goal-level range is the right granularity.
            config = resolve_goal_config(goal, None)
            band = config.compound_rep_range
            outcome = evaluate_session(sets, RepRangeConfig(band.low, band.high))
            if outcome in (
                SessionOutcome.SWEPT_TOP,
                SessionOutcome.AT_TOP,
                SessionOutcome.IN_BAND,
            ):
                hits += 1

    if total_sessions < MIN_SESSIONS_FOR_ADHERENCE:
        return Adherence(
            rate=DEFAULT_ADHERENCE,
            sessions_logged=total_sessions,
            target_hit_rate=None,
            measured=False,
        )

    hit_rate = hits / total_sessions
    # Kept off the floor: even an inconsistent user progresses, just slowly, and
    # a near-zero rate would flatten the chart into something useless.
    rate = max(0.35, min(1.0, hit_rate))
    return Adherence(
        rate=rate,
        sessions_logged=total_sessions,
        target_hit_rate=hit_rate,
        measured=True,
    )


def _hits_destination(point: WeekPoint, dest_weight: float, dest_reps: int) -> bool:
    """A prescribed top set meets the finish line (load and reps, not e1RM alone)."""
    return point.weight >= dest_weight and point.reps >= dest_reps


def _parse_destination(
    target_weight: Any, target_reps: Any, target_weeks: Any
) -> Optional[Dict[str, Any]]:
    try:
        weight = float(target_weight) if target_weight is not None else None
    except (TypeError, ValueError):
        weight = None
    try:
        reps = int(float(target_reps)) if target_reps is not None else None
    except (TypeError, ValueError):
        reps = None
    if weight is None or weight <= 0 or reps is None or reps <= 0:
        return None
    out: Dict[str, Any] = {"weight": round(weight, 1), "reps": reps}
    try:
        weeks = int(float(target_weeks)) if target_weeks is not None else None
    except (TypeError, ValueError):
        weeks = None
    if weeks is not None:
        out["weeks"] = max(1, min(MAX_PROJECTION_WEEKS, weeks))
    return out


class PlanProjector:
    """Projects an Active Plan forward on a weekly axis."""

    def __init__(self, engine: Optional[ProgressionEngine] = None):
        self.engine = engine or ProgressionEngine()

    def project_exercise(
        self,
        exercise_id: str,
        exercise_name: str,
        day_name: str,
        history: List[Dict],
        user_goal: str,
        weeks: int,
        sessions_per_week: int = 1,
        num_sets: int = 3,
        focus_goal: Optional[str] = None,
        rep_range_override: Optional[tuple] = None,
        adherence: float = DEFAULT_ADHERENCE,
        exercise_record: Optional[Dict] = None,
        top_lifts: Optional[Dict] = None,
        target_weight: Optional[float] = None,
        target_reps: Optional[int] = None,
        target_weeks: Optional[int] = None,
        day_intensity: Optional[str] = None,
        experience_level: Optional[str] = None,
        energy_balance: Optional[str] = None,
    ) -> ExerciseProjection:
        """
        Walk the real engine forward, assuming every prescription is met.

        The simulated user hits exactly what they are told, which is what makes
        this the *ceiling* rather than a forecast. The realistic line is derived
        from it afterwards rather than simulated separately, so the two can
        never tell contradictory stories about the same plan.

        When a destination (weight × reps) is set, the horizon prefers
        target_weeks and the walk holds once the finish line is hit.
        """
        destination = _parse_destination(target_weight, target_reps, target_weeks)
        if destination and destination.get("weeks"):
            weeks = destination["weeks"]
        weeks = max(1, min(MAX_PROJECTION_WEEKS, int(weeks)))

        sessions_per_week = max(1, sessions_per_week)
        simulated = _normalize_history_sets(history)
        seeded = bool(simulated)

        # Cardio progresses minutes and pace, not load. Running it through the
        # lifting walk below produced an empty projection — `result.sets` is
        # always [] for cardio, so the loop broke on week one and the Plan Hub
        # rendered a card with no target and no chart.
        if is_cardio(exercise_id, exercise_name, exercise_record):
            return self._project_cardio(
                exercise_id=exercise_id,
                exercise_name=exercise_name,
                day_name=day_name,
                history=simulated,
                user_goal=user_goal,
                weeks=weeks,
                sessions_per_week=sessions_per_week,
                focus_goal=focus_goal,
                adherence=adherence,
                seeded=seeded,
            )

        current = None
        if simulated:
            latest = simulated[0].get("sets") or []
            if latest:
                # Judged by estimated 1RM, not weight x reps. Raw volume picks
                # the lightest set whenever it carries the most reps — for a
                # session of 80x3, 80x4, 70x6 it chose 70x6 (420) over 80x4
                # (320), understating the baseline. That both flattened the
                # projection, by making the plausibility cap bite on week one,
                # and put a phantom step at TODAY, because the history line
                # plots max e1RM per session and this did not.
                best = max(
                    latest,
                    key=lambda s: e1rm(s.get("weight"), s.get("reps")),
                )
                current = WeekPoint(
                    week=0,
                    weight=_num(best.get("weight")),
                    reps=_int_reps(best.get("reps")),
                    e1rm=e1rm(best.get("weight"), best.get("reps")),
                )

        best_case: List[WeekPoint] = []
        # Every session, not just the last of each week. The weekly curve is
        # what the chart draws; this is what the week-by-week table needs, with
        # one column per workout.
        schedule: List[WeekPoint] = []
        baseline_e1rm = current.e1rm if current else None
        plateaued_at: Optional[int] = None
        arrived_week: Optional[int] = None
        hold_after_destination = False

        # What this lifter can plausibly add per week, before the plan's own
        # finish line is allowed to slow it further.
        plausible_rate = plausible_weekly_gain(experience_level, energy_balance)
        destination_e1rm = (
            e1rm(destination.get("weight"), destination.get("reps"))
            if destination
            else None
        )
        weekly_gain = pace_to_destination(
            baseline_e1rm, destination_e1rm, weeks, plausible_rate
        )
        # A stated goal is a ceiling as well as a target. Projecting past what
        # the user asked for is how a 12-week chart ended 15 lb above the
        # heaviest dumbbell they named.
        e1rm_cap = destination_e1rm if destination_e1rm else None

        for week in range(1, weeks + 1):
            point = None
            sessions_recorded = 0

            # Once the finish line is hit, hold that prescription for the rest
            # of the horizon rather than inventing further progression.
            if hold_after_destination and best_case:
                held = best_case[-1]
                best_case.append(
                    WeekPoint(
                        week=week,
                        weight=held.weight,
                        reps=held.reps,
                        e1rm=held.e1rm,
                        decision="maintain",
                    )
                )
                for session_index in range(1, sessions_per_week + 1):
                    schedule.append(
                        WeekPoint(
                            week=week,
                            weight=held.weight,
                            reps=held.reps,
                            e1rm=held.e1rm,
                            decision="maintain",
                            session=session_index,
                            sets=list(held.sets) or [
                                {
                                    "set_number": i + 1,
                                    "weight": held.weight,
                                    "reps": held.reps,
                                }
                                for i in range(num_sets)
                            ],
                        )
                    )
                continue

            for session_index in range(1, sessions_per_week + 1):
                result = self.engine.compute_recommendation(
                    exercise_id=exercise_id,
                    exercise_name=exercise_name,
                    user_goal=user_goal,
                    focus_goal=focus_goal,
                    day_intensity=day_intensity,
                    rep_range_override=rep_range_override,
                    recent_sessions=simulated[:6],
                    num_sets=num_sets,
                    exercise_record=exercise_record,
                    top_lifts=top_lifts,
                )
                if not result.sets:
                    break
                top = max(result.sets, key=lambda s: s.weight)
                candidate = WeekPoint(
                    week=week,
                    weight=top.weight,
                    reps=top.reps,
                    e1rm=e1rm(top.weight, top.reps),
                    decision=result.decision.value,
                    session=session_index,
                    sets=[
                        {"set_number": s.set_number, "weight": s.weight, "reps": s.reps}
                        for s in result.sets
                    ],
                )
                if baseline_e1rm is None:
                    baseline_e1rm = candidate.e1rm

                over_destination = (
                    e1rm_cap is not None
                    and arrived_week is None
                    and candidate.e1rm > e1rm_cap
                    and not _hits_destination(
                        candidate, destination["weight"], destination["reps"]
                    )
                )
                if over_destination or exceeds_plausible_gain(
                    candidate.e1rm, baseline_e1rm, week, weekly_gain
                ):
                    # Past this the curve is arithmetic, not training. Double
                    # progression compounds happily forever; bodies do not, and
                    # the smallest plate on a light isolation lift is a huge
                    # relative jump — a 5 lb step on a 20 lb lateral raise is
                    # 25%, which repeated weekly "grows" the lift 95% in twelve
                    # weeks. Let the simulated lifter stall instead, which
                    # flattens the curve the way real progress flattens.
                    plateaued_at = plateaued_at or week
                    if simulated:
                        simulated.insert(0, dict(simulated[0]))
                    break

                point = candidate
                schedule.append(candidate)
                sessions_recorded += 1
                # The simulated user does exactly what was prescribed.
                simulated.insert(
                    0,
                    {
                        "date": f"week-{week}",
                        "sets": [
                            {"weight": s.weight, "reps": s.reps, "set_number": s.set_number}
                            for s in result.sets
                        ],
                    },
                )

                if (
                    destination
                    and arrived_week is None
                    and _hits_destination(
                        candidate, destination["weight"], destination["reps"]
                    )
                ):
                    arrived_week = week
                    hold_after_destination = True
                    break

            if point is None:
                # Stalled (or nothing to prescribe) — hold the last known point
                # so the horizon stays a full N weeks rather than truncating.
                held = best_case[-1] if best_case else current
                if held is None:
                    break
                best_case.append(
                    WeekPoint(week=week, weight=held.weight, reps=held.reps, e1rm=held.e1rm)
                )
                # A held week is still a week the user trains, so the table
                # needs its rows. Without this the schedule was empty whenever
                # the plausibility cap bit on week one — which is the common
                # case for a lift whose last session was a bad one.
                for session_index in range(1, sessions_per_week + 1):
                    schedule.append(
                        WeekPoint(
                            week=week,
                            weight=held.weight,
                            reps=held.reps,
                            e1rm=held.e1rm,
                            decision="maintain",
                            session=session_index,
                            sets=list(held.sets) or [
                                {"set_number": i + 1, "weight": held.weight, "reps": held.reps}
                                for i in range(num_sets)
                            ],
                        )
                    )
                continue
            best_case.append(point)
            # The cap can break the loop part-way through a week, leaving the
            # second workout unrecorded — the table then showed an empty column
            # for a session the user still trains. Hold the last prescription
            # for the rest of the week instead.
            for session_index in range(sessions_recorded + 1, sessions_per_week + 1):
                schedule.append(
                    WeekPoint(
                        week=week,
                        weight=point.weight,
                        reps=point.reps,
                        e1rm=point.e1rm,
                        decision="maintain",
                        session=session_index,
                        sets=list(point.sets),
                    )
                )

        if current is None and best_case:
            first = best_case[0]
            current = WeekPoint(week=0, weight=first.weight, reps=first.reps, e1rm=first.e1rm)

        reachable = None
        if destination:
            reachable = arrived_week is not None

        return ExerciseProjection(
            exercise_id=exercise_id,
            exercise_name=exercise_name,
            day_name=day_name,
            sessions_per_week=sessions_per_week,
            current=current,
            best_case=best_case,
            realistic=self._stretch(best_case, current, adherence),
            schedule=self._stretch_schedule(schedule, weeks, sessions_per_week, adherence),
            seeded_from_history=seeded,
            destination=destination,
            arrived_week=arrived_week,
            reachable=reachable,
            assumptions={
                "experience_level": (
                    str(experience_level).strip().lower()
                    if experience_level
                    else DEFAULT_EXPERIENCE_LEVEL
                ),
                "experience_assumed": not experience_level,
                "energy_balance": (
                    str(energy_balance).strip().lower() if energy_balance else None
                ),
                "weekly_e1rm_gain": round(plausible_rate, 5),
                # Lower than the above when the user's own finish line is
                # nearer than what they could plausibly manage.
                "paced_weekly_gain": round(weekly_gain, 5),
                "horizon_gain_pct": round(((1 + weekly_gain) ** weeks - 1) * 100, 1),
            },
        )

    def _project_cardio(
        self,
        exercise_id: str,
        exercise_name: str,
        day_name: str,
        history: List[Dict],
        user_goal: str,
        weeks: int,
        sessions_per_week: int,
        focus_goal: Optional[str],
        adherence: float,
        seeded: bool,
    ) -> "ExerciseProjection":
        """
        Walk the cardio engine forward the same way the lifting one is walked.

        The simulated trainee does what is asked and reports it went fine, so
        this is the ceiling. Because the engine builds duration to a goal
        target and then stops, the curve flattens on its own — there is no
        plausibility cap to apply here, the prescription already has one.
        """
        simulated = list(history)
        current = None
        if simulated:
            latest = simulated[0]
            minutes = latest.get("time")
            if minutes:
                current = CardioWeekPoint(
                    week=0,
                    minutes=int(minutes),
                    speed=latest.get("speed"),
                )

        best_case: List[CardioWeekPoint] = []
        for week in range(1, weeks + 1):
            point = None
            for _ in range(sessions_per_week):
                prescription = compute_cardio_progression(
                    exercise_id=exercise_id,
                    exercise_name=exercise_name,
                    history=simulated[:4],
                    user_goal=user_goal,
                    focus_goal=focus_goal,
                )
                point = CardioWeekPoint(
                    week=week,
                    minutes=prescription.time,
                    speed=prescription.speed,
                    decision=prescription.decision,
                )
                simulated.insert(0, {
                    "date": f"week-{week}",
                    "time": prescription.time,
                    "speed": prescription.speed,
                    # The simulated trainee finishes comfortably; anything else
                    # would be modelling a user who is not following the plan.
                    "fatigue": 5,
                })
            if point:
                best_case.append(point)

        if current is None and best_case:
            first = best_case[0]
            current = CardioWeekPoint(week=0, minutes=first.minutes, speed=first.speed)

        return ExerciseProjection(
            exercise_id=exercise_id,
            exercise_name=exercise_name,
            day_name=day_name,
            sessions_per_week=sessions_per_week,
            current=None,
            seeded_from_history=seeded,
            is_cardio=True,
            cardio_modality=classify_modality(exercise_id, exercise_name).value,
            cardio_current=current,
            cardio_best_case=best_case,
            cardio_realistic=self._stretch_cardio(best_case, current, adherence),
        )

    @staticmethod
    def _stretch_cardio(
        best_case: List[CardioWeekPoint],
        current: Optional[CardioWeekPoint],
        adherence: float,
    ) -> List[CardioWeekPoint]:
        """
        The same time-stretch the lifting curve gets, for the same reason.

        Someone training two sessions in three takes half again as long to
        reach the same duration. Reporting the ceiling as the forecast is the
        failure this whole module was written to avoid.
        """
        if not best_case:
            return []
        rate = max(0.1, min(1.0, adherence or DEFAULT_ADHERENCE))
        stretched = []
        for index in range(len(best_case)):
            source_index = int(index * rate)
            source = best_case[min(source_index, len(best_case) - 1)]
            stretched.append(
                CardioWeekPoint(
                    week=index + 1,
                    minutes=source.minutes,
                    speed=source.speed,
                    decision=source.decision,
                )
            )
        return stretched

    @staticmethod
    def _stretch_schedule(
        schedule: List[WeekPoint],
        weeks: int,
        sessions_per_week: int,
        adherence: float,
    ) -> List[WeekPoint]:
        """
        Time-stretch the session list the same way the weekly curve is stretched.

        Grouped by week first so a stretched week keeps all of its sessions
        together: someone training two-thirds of the time reaches week 6's
        prescriptions in week 9, and both of that week's workouts move with it.
        """
        if not schedule:
            return []
        by_week: Dict[int, List[WeekPoint]] = {}
        for point in schedule:
            by_week.setdefault(point.week, []).append(point)
        source_weeks = sorted(by_week)
        if not source_weeks:
            return []

        rate = max(0.1, min(1.0, adherence or DEFAULT_ADHERENCE))
        stretched: List[WeekPoint] = []
        for index in range(weeks):
            source = source_weeks[min(int(index * rate), len(source_weeks) - 1)]
            for point in by_week[source]:
                stretched.append(
                    WeekPoint(
                        week=index + 1,
                        weight=point.weight,
                        reps=point.reps,
                        e1rm=point.e1rm,
                        decision=point.decision,
                        session=point.session,
                        sets=list(point.sets),
                    )
                )
        return stretched

    @staticmethod
    def _stretch(
        best_case: List[WeekPoint],
        current: Optional[WeekPoint],
        adherence: float,
    ) -> List[WeekPoint]:
        """
        The realistic line: the same trajectory, taking longer.

        Progress that best-case reaches in week N is reached in week N/adherence
        instead. Deliberately a time-stretch rather than a separate simulation —
        a user at 70% consistency is not on a different program, they are on the
        same program moving at 70% of the pace, and saying it that way is both
        true and explainable ("at your recent consistency, this takes ~1.4x
        longer"). Simulating misses independently would produce a second curve
        that could disagree with the first for no defensible reason.
        """
        if not best_case:
            return []
        rate = max(0.1, min(1.0, adherence))
        if rate >= 1.0:
            return [
                WeekPoint(p.week, p.weight, p.reps, p.e1rm, p.decision) for p in best_case
            ]

        baseline = current or WeekPoint(0, best_case[0].weight, best_case[0].reps, best_case[0].e1rm)
        out: List[WeekPoint] = []
        for p in best_case:
            # Where along the best-case curve this calendar week actually lands.
            position = p.week * rate
            lower_idx = int(position) - 1
            frac = position - int(position)

            lower = best_case[lower_idx] if 0 <= lower_idx < len(best_case) else baseline
            upper_idx = lower_idx + 1
            upper = best_case[upper_idx] if 0 <= upper_idx < len(best_case) else lower

            out.append(
                WeekPoint(
                    week=p.week,
                    # Load is quantised in the real world, so never interpolate
                    # it into a number no plate stack can make.
                    weight=lower.weight if frac < 0.5 else upper.weight,
                    reps=lower.reps if frac < 0.5 else upper.reps,
                    e1rm=round(lower.e1rm + (upper.e1rm - lower.e1rm) * frac, 1),
                )
            )
        return out
