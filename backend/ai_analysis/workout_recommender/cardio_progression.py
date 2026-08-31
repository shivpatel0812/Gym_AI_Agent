"""
Cardio progression: what to do today on the treadmill, track or court.

The engine this replaces was twenty-five lines that added a minute and half a
mile per hour to every session, unconditionally. Three things were wrong with
it, and they are the three things this module exists to fix:

  1. It moved two variables at once. Nobody trains that way — you extend the
     session or you raise the pace, not both, every time. Compounded over
     twenty sessions it prescribed fifty minutes at 16 mph, a 3:45 mile held
     for the better part of an hour.
  2. It was goal-blind. Cardio for fat loss and cardio as conditioning
     alongside a strength block want opposite things: one wants volume, the
     other wants to stay out of the way of the lifting.
  3. It ignored sport entirely. Basketball has no pace to prescribe, and the
     intensity and fatigue the app already collects were read by nothing.

Two modalities are implemented because two are loggable. STEADY covers the
treadmill entries, which record time and speed. SPORT covers the eleven sport
entries, which record time, intensity and fatigue. Intervals are a real third
modality and are deliberately absent: there is no interval exercise in the
catalog and no UI to log work/rest rounds, so the progression would have no
input and no caller.

Nothing here does I/O. The engine passes in history and gets a prescription.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from .goal_configs import resolve_goal_key

# --- modality -------------------------------------------------------------


class CardioModality(str, Enum):
    STEADY = "steady"   # paced work: time + speed
    SPORT = "sport"     # play: time + how hard it felt


# Sport entries are identified by id prefix; the catalog namespaces them.
SPORT_ID_PREFIX = "default-cardio-sport"

SPORT_NAME_HINTS = (
    "basketball", "soccer", "football", "tennis", "swim", "hike",
    "pickup", "sport", "volleyball", "hockey", "climb",
)


def classify_modality(exercise_id: str, exercise_name: str = "") -> CardioModality:
    """Which kind of cardio this is. Sport is the exception, steady the default."""
    if str(exercise_id or "").startswith(SPORT_ID_PREFIX):
        return CardioModality.SPORT
    name = str(exercise_name or "").strip().lower()
    if any(hint in name for hint in SPORT_NAME_HINTS):
        return CardioModality.SPORT
    return CardioModality.STEADY


# --- how hard the last one was --------------------------------------------


class CardioOutcome(str, Enum):
    """How the previous session went, which decides whether today moves up."""

    NO_HISTORY = "no_history"
    EASY = "easy"           # comfortably done — progress
    STEADY_STATE = "steady" # done as asked — progress
    HARD = "hard"           # finished but costly — hold
    CUT_SHORT = "cut_short" # did not finish what was done last time — back off


# Self-reported fatigue at or above this means the session cost more than it
# should have. Progressing on top of it is how a plan digs a hole.
HIGH_FATIGUE = 8
LOW_FATIGUE = 3

# A session this much shorter than the one before it was abandoned, not
# programmed. 0.8 leaves room for a session that simply ran out of clock.
CUT_SHORT_RATIO = 0.8


def evaluate_cardio_session(history: List[Dict]) -> CardioOutcome:
    """
    Judge the most recent session against the one before it.

    Deliberately mirrors `evaluate_session` for lifting: the question is not
    "was this a lot of work" but "did this go well enough to ask for more".
    Self-reported fatigue outranks duration, because a session finished at a
    cost is not a session to build on.
    """
    if not history:
        return CardioOutcome.NO_HISTORY

    latest = history[0]
    fatigue = _number(latest.get("fatigue"))
    time = _number(latest.get("time"))

    previous_times = [
        value for value in (_number(h.get("time")) for h in history[1:4]) if value
    ]
    if time and previous_times:
        best_recent = max(previous_times)
        if best_recent and time < best_recent * CUT_SHORT_RATIO:
            return CardioOutcome.CUT_SHORT

    if fatigue is not None:
        if fatigue >= HIGH_FATIGUE:
            return CardioOutcome.HARD
        if fatigue <= LOW_FATIGUE:
            return CardioOutcome.EASY

    return CardioOutcome.STEADY_STATE


# --- what the goal wants from cardio --------------------------------------


@dataclass(frozen=True)
class CardioGoalConfig:
    """
    Cardio targets for one training goal.

    `target_duration_min` is where duration progression stops and pace
    progression starts. `max_duration_min` is the hard ceiling — for the
    strength goals it is deliberately low, because conditioning that grows
    without limit starts eating the training it was meant to support.
    """

    target_duration_min: int
    max_duration_min: int
    duration_step_min: int
    intent: str


CARDIO_GOAL_CONFIGS: Dict[str, CardioGoalConfig] = {
    # Volume is the point: build time on feet, keep the pace conversational.
    "fat_loss": CardioGoalConfig(45, 60, 3, "build duration for total work"),
    "general": CardioGoalConfig(35, 60, 2, "build a durable aerobic base"),
    # Conditioning alongside lifting. Kept short on purpose — the interference
    # cost of long hard cardio lands on exactly the sessions that matter here.
    "hypertrophy": CardioGoalConfig(25, 40, 2, "conditioning without interference"),
    "strength": CardioGoalConfig(20, 30, 2, "keep it out of the way of the lifting"),
}

DEFAULT_CARDIO_GOAL = "general"


def resolve_cardio_config(user_goal: str, focus_goal: Optional[str] = None) -> CardioGoalConfig:
    """Per-exercise focus wins over the profile goal, as it does for lifting."""
    for candidate in (focus_goal, user_goal):
        if not candidate:
            continue
        key = resolve_goal_key(candidate)
        if key in CARDIO_GOAL_CONFIGS:
            return CARDIO_GOAL_CONFIGS[key]
    return CARDIO_GOAL_CONFIGS[DEFAULT_CARDIO_GOAL]


# --- pace ceilings --------------------------------------------------------

# Absolute speed ceilings in mph, by movement. These are not target paces —
# they are the point past which a prescription stops being credible for a
# general trainee, and exist because the old engine had no ceiling at all and
# would happily prescribe a sub-4-minute mile.
SPEED_CEILINGS = {
    "default-cardio-normal-walk": 4.2,
    "default-cardio-incline-walk": 4.0,
    "default-cardio-run": 9.0,
}
DEFAULT_SPEED_CEILING = 8.0

# Treadmills move in 0.1 increments. Half a mile per hour, every session, was
# a ~8% pace jump on a walk — a change you feel immediately.
SPEED_STEP = {
    "default-cardio-normal-walk": 0.1,
    "default-cardio-incline-walk": 0.1,
    "default-cardio-run": 0.2,
}
DEFAULT_SPEED_STEP = 0.2

DEFAULT_FIRST_DURATION_MIN = 15
MIN_DURATION_MIN = 5

# How far a hold-back reduces the session. Enough to feel like recovery,
# not so much that the habit breaks.
BACKOFF_RATIO = 0.85


@dataclass
class CardioPrescription:
    """Today's cardio, plus why."""

    modality: CardioModality
    time: int
    speed: Optional[float] = None
    target_intensity: Optional[int] = None
    decision: str = "cardio_progress"
    confidence: str = "medium"
    # Human-readable "if this, then that", the cardio analogue of Branch.
    guidance: Optional[str] = None
    context: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "modality": self.modality.value,
            "time": self.time,
            "decision": self.decision,
        }
        if self.speed is not None:
            payload["speed"] = self.speed
        if self.target_intensity is not None:
            payload["target_intensity"] = self.target_intensity
        if self.guidance:
            payload["guidance"] = self.guidance
        return payload


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _round_speed(value: float) -> float:
    return round(value + 1e-9, 1)


def compute_cardio_progression(
    exercise_id: str,
    exercise_name: str,
    history: List[Dict],
    user_goal: str,
    focus_goal: Optional[str] = None,
) -> CardioPrescription:
    """
    One variable moves per session, and only when the last one earned it.

    Duration is built first, to the goal's target; pace only starts moving once
    that target is held. That ordering is the whole design — it is how the
    prescription stays honest over a twelve-week horizon instead of compounding
    into fiction.
    """
    modality = classify_modality(exercise_id, exercise_name)
    config = resolve_cardio_config(user_goal, focus_goal)
    outcome = evaluate_cardio_session(history)

    if outcome is CardioOutcome.NO_HISTORY:
        return _first_session(modality, config)

    latest = history[0]
    prev_time = _number(latest.get("time")) or DEFAULT_FIRST_DURATION_MIN
    prev_speed = _number(latest.get("speed"))
    prev_fatigue = _number(latest.get("fatigue"))

    base_context = {
        "modality": modality.value,
        "outcome": outcome.value,
        "goal_intent": config.intent,
        "prev_time": int(prev_time),
        "prev_speed": prev_speed,
        "prev_fatigue": int(prev_fatigue) if prev_fatigue else None,
        "target_duration_min": config.target_duration_min,
    }

    # --- back off ---------------------------------------------------------
    if outcome is CardioOutcome.CUT_SHORT:
        held = max(MIN_DURATION_MIN, int(round(prev_time * BACKOFF_RATIO)))
        return CardioPrescription(
            modality=modality,
            time=held,
            speed=prev_speed,
            target_intensity=_sport_intensity(modality, easier=True),
            decision="cardio_backoff",
            confidence="medium",
            guidance=(
                f"Last one stopped short. Finish {held} minutes at the same effort "
                "before adding anything back."
            ),
            context={**base_context, "reason": "cut_short_hold"},
        )

    if outcome is CardioOutcome.HARD:
        return CardioPrescription(
            modality=modality,
            time=int(prev_time),
            speed=prev_speed,
            target_intensity=_sport_intensity(modality, easier=True),
            decision="cardio_hold",
            confidence="high",
            guidance=(
                "You rated the last one hard, so repeat it rather than adding. "
                "If it feels easier this time, the next session moves up."
            ),
            context={**base_context, "reason": "high_fatigue_hold"},
        )

    # --- sport: duration only, because there is no pace to prescribe ------
    if modality is CardioModality.SPORT:
        step = config.duration_step_min if outcome is CardioOutcome.EASY else 0
        new_time = min(config.max_duration_min, int(prev_time) + step)
        at_ceiling = new_time >= config.max_duration_min
        return CardioPrescription(
            modality=modality,
            time=new_time,
            speed=None,
            target_intensity=_sport_intensity(modality),
            decision="cardio_progress" if step else "cardio_maintain",
            confidence="medium",
            guidance=(
                f"Play about {new_time} minutes at a hard but repeatable effort"
                + (". You are at the useful ceiling for this goal — hold here."
                   if at_ceiling else ". Rate fatigue afterwards so this can adjust.")
            ),
            context={**base_context, "at_duration_ceiling": at_ceiling},
        )

    # --- steady: build duration first, then pace --------------------------
    if prev_time < config.target_duration_min:
        new_time = min(
            config.target_duration_min, int(prev_time) + config.duration_step_min
        )
        return CardioPrescription(
            modality=modality,
            time=new_time,
            speed=prev_speed,  # held on purpose — one variable at a time
            decision="cardio_progress",
            confidence="high",
            guidance=(
                f"Same pace, {new_time} minutes. Pace starts moving once you are "
                f"holding {config.target_duration_min}."
            ),
            context={**base_context, "phase": "building_duration"},
        )

    ceiling = SPEED_CEILINGS.get(exercise_id, DEFAULT_SPEED_CEILING)
    step = SPEED_STEP.get(exercise_id, DEFAULT_SPEED_STEP)
    held_time = int(min(prev_time, config.max_duration_min))

    if prev_speed is None:
        # Duration target met with no pace ever recorded — ask for one rather
        # than inventing a number the user never chose.
        return CardioPrescription(
            modality=modality,
            time=held_time,
            speed=None,
            decision="cardio_needs_pace",
            confidence="low",
            guidance=(
                f"You are holding {held_time} minutes. Log the speed you run it at "
                "and the next session can start progressing pace."
            ),
            context={**base_context, "phase": "needs_pace"},
        )

    if prev_speed >= ceiling:
        return CardioPrescription(
            modality=modality,
            time=held_time,
            speed=_round_speed(prev_speed),
            decision="cardio_maintain",
            confidence="high",
            guidance=(
                f"{prev_speed} mph is the top of what this plan will prescribe for "
                "this movement. Hold it, or ask your coach for intervals."
            ),
            context={**base_context, "phase": "at_pace_ceiling", "ceiling": ceiling},
        )

    new_speed = _round_speed(min(ceiling, prev_speed + step))
    return CardioPrescription(
        modality=modality,
        time=held_time,
        speed=new_speed,
        decision="cardio_progress",
        confidence="high",
        guidance=(
            f"Hold {held_time} minutes and take it to {new_speed} mph. "
            f"If you cannot finish, drop back to {_round_speed(prev_speed)}."
        ),
        context={**base_context, "phase": "building_pace", "ceiling": ceiling},
    )


def _first_session(
    modality: CardioModality, config: CardioGoalConfig
) -> CardioPrescription:
    """A conservative opener; there is nothing yet to progress from."""
    time = min(DEFAULT_FIRST_DURATION_MIN, config.target_duration_min)
    return CardioPrescription(
        modality=modality,
        time=time,
        speed=None,
        target_intensity=_sport_intensity(modality),
        decision="cardio_first_session",
        confidence="low",
        guidance=(
            f"Start with {time} easy minutes and log how it felt. Everything after "
            "this is paced off that first session."
        ),
        context={
            "modality": modality.value,
            "reason": "first_cardio_session",
            "goal_intent": config.intent,
            "target_duration_min": config.target_duration_min,
        },
    )


# Sport effort is prescribed as a 1-10 target rather than a pace. 7 is "hard
# but repeatable"; the easier variant is what a hold-back week asks for.
SPORT_TARGET_INTENSITY = 7
SPORT_EASY_INTENSITY = 5


def _sport_intensity(modality: CardioModality, easier: bool = False) -> Optional[int]:
    if modality is not CardioModality.SPORT:
        return None
    return SPORT_EASY_INTENSITY if easier else SPORT_TARGET_INTENSITY
