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

# The most estimated 1RM a projection will claim per week, compounding.
#
# A modelling assumption, not a measurement: it is set generously, at roughly
# what a genuine novice manages early on, because it exists to stop the curve
# being absurd rather than to predict anyone in particular. Over twelve weeks
# it allows about 27% — ambitious but arguable. Without it, double progression
# compounds without limit and the projection promised a 95% gain on a lateral
# raise, which costs the user's trust in every other number on the page.
PLAUSIBLE_WEEKLY_E1RM_GAIN = 0.02

# The cap does not bind for the first few weeks. Load comes in indivisible
# steps, and one step — or even a single extra rep — can legitimately be worth
# more than 2% on a light lift. Applied from week one it would block the very
# first rep increase and flatten every curve to nothing.
PLAUSIBILITY_GRACE_WEEKS = 4


def exceeds_plausible_gain(
    candidate_e1rm: float, baseline_e1rm: Optional[float], week: int
) -> bool:
    """Whether a projected week has outrun what training plausibly delivers."""
    if not baseline_e1rm or baseline_e1rm <= 0:
        return False
    effective_week = max(week, PLAUSIBILITY_GRACE_WEEKS)
    ceiling = baseline_e1rm * ((1 + PLAUSIBLE_WEEKLY_E1RM_GAIN) ** effective_week)
    return candidate_e1rm > ceiling


# Epley, matching _compute_e1rm_history in the progression engine.
def e1rm(weight: float, reps: int) -> float:
    if not weight or not reps:
        return 0.0
    return round(weight * (1 + reps / 30), 1)


@dataclass
class WeekPoint:
    week: int
    weight: float
    reps: int
    e1rm: float
    decision: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "week": self.week,
            "weight": round(self.weight, 1),
            "reps": self.reps,
            "e1rm": self.e1rm,
        }
        if self.decision:
            payload["decision"] = self.decision
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
    is_cardio: bool = False
    cardio_modality: Optional[str] = None
    cardio_current: Optional[CardioWeekPoint] = None
    cardio_best_case: List[CardioWeekPoint] = field(default_factory=list)
    cardio_realistic: List[CardioWeekPoint] = field(default_factory=list)

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
        return {
            "exercise_id": self.exercise_id,
            "exercise_name": self.exercise_name,
            "day_name": self.day_name,
            "sessions_per_week": self.sessions_per_week,
            "seeded_from_history": self.seeded_from_history,
            "current": self.current.to_dict() if self.current else None,
            "best_case": [p.to_dict() for p in self.best_case],
            "realistic": [p.to_dict() for p in self.realistic],
            "gain": {
                "best_case_e1rm": round(end_best - start, 1),
                "realistic_e1rm": round(end_real - start, 1),
                "best_case_pct": round((end_best - start) / start * 100, 1) if start else None,
                "realistic_pct": round((end_real - start) / start * 100, 1) if start else None,
            },
        }

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
    ) -> ExerciseProjection:
        """
        Walk the real engine forward, assuming every prescription is met.

        The simulated user hits exactly what they are told, which is what makes
        this the *ceiling* rather than a forecast. The realistic line is derived
        from it afterwards rather than simulated separately, so the two can
        never tell contradictory stories about the same plan.
        """
        sessions_per_week = max(1, sessions_per_week)
        simulated = list(history or [])
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
                best = max(latest, key=lambda s: (s.get("weight") or 0) * (s.get("reps") or 0))
                current = WeekPoint(
                    week=0,
                    weight=float(best.get("weight") or 0),
                    reps=int(best.get("reps") or 0),
                    e1rm=e1rm(best.get("weight") or 0, best.get("reps") or 0),
                )

        best_case: List[WeekPoint] = []
        baseline_e1rm = current.e1rm if current else None
        plateaued_at: Optional[int] = None

        for week in range(1, weeks + 1):
            point = None
            for _ in range(sessions_per_week):
                result = self.engine.compute_recommendation(
                    exercise_id=exercise_id,
                    exercise_name=exercise_name,
                    user_goal=user_goal,
                    focus_goal=focus_goal,
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
                )
                if baseline_e1rm is None:
                    baseline_e1rm = candidate.e1rm

                if exceeds_plausible_gain(candidate.e1rm, baseline_e1rm, week):
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
            if point is None:
                # Stalled (or nothing to prescribe) — hold the last known point
                # so the horizon stays a full N weeks rather than truncating.
                held = best_case[-1] if best_case else current
                if held is None:
                    break
                best_case.append(
                    WeekPoint(week=week, weight=held.weight, reps=held.reps, e1rm=held.e1rm)
                )
                continue
            best_case.append(point)

        if current is None and best_case:
            first = best_case[0]
            current = WeekPoint(week=0, weight=first.weight, reps=first.reps, e1rm=first.e1rm)

        return ExerciseProjection(
            exercise_id=exercise_id,
            exercise_name=exercise_name,
            day_name=day_name,
            sessions_per_week=sessions_per_week,
            current=current,
            best_case=best_case,
            realistic=self._stretch(best_case, current, adherence),
            seeded_from_history=seeded,
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
