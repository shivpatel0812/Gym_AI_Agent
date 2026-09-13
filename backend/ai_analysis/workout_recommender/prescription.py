"""
How a session is judged, and which shape of prescription answers it.

The engine used to compare sessions by total volume. That is wrong the moment
a weight increase lands: sweeping 50x10,10,10 (volume 1500) and then doing the
prescribed 55x6,6,6 (volume 990) scored as a *failure*, which rolled the user
back to 50x10 and bounced them between the two loads forever. Volume is not
the goal; landing the prescribed reps at the prescribed load is.

So a session is judged against the band it was working in. That single change
fixes the oscillation, and it is also what makes the recommendation readable as
coaching rather than arithmetic: a band has a floor to clear and a ceiling that
earns weight, and the same numbers can mean "hold" one week and "move up" the
next depending on where in the band they landed.
"""

from dataclasses import dataclass
from statistics import median
from enum import Enum
from datetime import datetime
from typing import Any, Dict, List, Optional

from .exercise_metadata import ExerciseMetadata
from .goal_configs import GoalConfig, RepRangeConfig


# Past about a dozen reps Epley stops estimating and starts extrapolating — a
# 30-rep set reports double the load as a 1RM. Such sets are skipped, never
# clamped, because clamping asserts a number the set never evidenced.
# `progression_engine` and `progress/domains.py` read the same figure.
E1RM_MAX_REPS = 12


class SessionOutcome(str, Enum):
    """Where the last session landed relative to its rep band."""

    SWEPT_TOP = "swept_top"   # every set at or above the ceiling — weight has been earned
    AT_TOP = "at_top"         # brushing the ceiling; one more session usually earns it
    IN_BAND = "in_band"       # every set cleared the floor — a good session, hold the load
    PARTIAL = "partial"       # some sets cleared the floor, some did not
    BELOW = "below"           # nothing cleared the floor — the load is too heavy
    UNKNOWN = "unknown"       # no usable set data


class ProgressionStrategy(str, Enum):
    """Which shape of prescription this exercise gets."""

    BAND = "band"        # one load, a rep band to fill, weight rises on a sweep
    TOP_SET = "top_set"  # one heavy set to chase, lighter backoffs, explicit miss branch


@dataclass
class Branch:
    """
    The "if this, then that" half of a prescription.

    A point prescription gives one way to succeed and no instruction for the
    likely case where the first set says the load was wrong. The branch is what
    the user actually reads mid-set, so it carries its own rendered text rather
    than leaving the client to assemble one.
    """

    condition: str
    action: str
    kind: str  # "earn_weight" | "miss_drop" | "fill_band"

    def to_dict(self) -> Dict:
        return {"condition": self.condition, "action": self.action, "kind": self.kind}


def reps_in(sets: List[Dict]) -> List[int]:
    """Rep counts from raw session sets, ignoring unusable entries."""
    out = []
    for s in sets or []:
        reps = s.get("reps") or 0
        if reps > 0:
            out.append(int(reps))
    return out


def evaluate_session(sets: List[Dict], rep_range: RepRangeConfig) -> SessionOutcome:
    """
    Judge one session against the band it was working in.

    Deliberately not a volume comparison and deliberately not "every set must
    be perfect". A last set one rep short is the single most common way a real
    session ends; treating that as a failure is what made the engine feel like
    it was punishing people for training.
    """
    reps = reps_in(sets)
    if not reps:
        return SessionOutcome.UNKNOWN

    low, high = rep_range.low, rep_range.high
    lowest, highest = min(reps), max(reps)
    # The typical set, not the worst one. Judging a session by its weakest set
    # strands anyone who reliably drops a rep somewhere: one short set holds
    # the whole session at the floor forever, no matter how the rest went.
    typical = median(reps)

    if lowest >= high:
        return SessionOutcome.SWEPT_TOP
    # Brushing the ceiling: a set reached it, the typical set is within one,
    # and nothing fell through the floor. This is the state the old engine
    # could never leave, because it demanded a clean sweep before it would add
    # weight. The floor condition keeps it honest: two sets at the ceiling and
    # a third that collapsed is not a session that has earned more load.
    if highest >= high and typical >= high - 1 and lowest >= low:
        return SessionOutcome.AT_TOP
    if typical >= low:
        return SessionOutcome.IN_BAND
    if highest >= low:
        return SessionOutcome.PARTIAL
    return SessionOutcome.BELOW


# Top-set-plus-backoff is a free-weight idiom. It exists because a near-limit
# set under a loaded spine is genuinely costly to repeat, so you buy one hard
# set and back off. A cable stack or a selectorised machine carries none of
# that, and prescribing a 10% drop there just takes work away from a lifter
# who was about to hold the load for all three sets.
TOP_SET_EQUIPMENT = {"barbell", "dumbbell"}


def supports_top_set(metadata: ExerciseMetadata) -> bool:
    """Whether a heavy single-set-plus-backoff shape suits this lift at all."""
    if not metadata.compound:
        return False
    equipment = str(getattr(metadata, "equipment", "") or "").strip().lower()
    # Unknown equipment is not evidence for the heavier idiom.
    return equipment in TOP_SET_EQUIPMENT


def select_strategy(
    metadata: ExerciseMetadata,
    goal_config: GoalConfig,
) -> ProgressionStrategy:
    """
    Pick the prescription shape.

    A strength-goal free-weight compound is the case where chasing a single
    heavy set and backing off is how the lift is actually trained, and where
    "if you miss, drop to X" is the instruction that matters. Everything else
    fills a band.
    """
    if goal_config.name == "strength" and supports_top_set(metadata):
        return ProgressionStrategy.TOP_SET
    return ProgressionStrategy.BAND


def days_between_sessions(newer: Any, older: Any) -> Optional[int]:
    """Whole days between two session dates, or None if either is unreadable."""
    parsed = []
    for value in (newer, older):
        if value is None:
            return None
        try:
            parsed.append(datetime.fromisoformat(str(value)[:10]))
        except (ValueError, TypeError):
            return None
    return abs((parsed[0] - parsed[1]).days)


# How far back a peak still counts as "what this lifter can do". Beyond it,
# the honest reading is that conditions have changed and the recent sessions
# are the evidence. Reasoned, not calibrated — `estimate_comeback_weight`
# already handles genuine layoffs, and this only has to survive an off week.
PEAK_WINDOW_DAYS = 42
PEAK_WINDOW_SESSIONS = 6


def best_recent_session(
    recent_sessions: List[Dict],
    rep_range: Optional[RepRangeConfig] = None,
) -> Optional[Dict]:
    """
    The session to progress from: the best one recently, not the last one.

    Reading `recent_sessions[0]` treats whatever happened last as the whole
    truth. A lifter who hit 80x6 nine days ago and had a light 75x7 day since
    gets anchored to 75, and the plan then spends a month climbing back to a
    load already demonstrated -- which is exactly how a user reads it: "my
    latest workout is already week 4 or 5 of this plan".

    Peak-anchoring is the stance this codebase already takes everywhere else.
    `progress/domains.py` anchors a strength level on peak e1RM so a bad week
    cannot lower it; `plan_projection` reports gains from peak; `progress/
    goals.py` reads peak so a goal cannot un-achieve itself on one bad
    session. The progression engine was the one place still reading last-only.

    Bounded in both directions: only sessions inside the recent window, and
    only ever *forward* of the most recent one. A genuine decline still shows
    up, because `count_regressions` and the readiness ladder judge the trend
    separately -- this picks the reference to progress from, not the verdict
    on how training is going.
    """
    sessions = [s for s in (recent_sessions or []) if s.get("sets")]
    if not sessions:
        return None
    latest = sessions[0]
    # Difficulty ratings are the lifter telling you how the most recent session
    # actually felt, and they are read off whichever session becomes the
    # reference. Reaching past a session marked "failed" to a better-scoring
    # earlier one would silently discard that report and prescribe as though
    # the failure had not happened. An explicit signal about today outranks a
    # better number from last week.
    if any((s.get("difficulty") or "") for s in latest.get("sets") or []):
        return latest
    latest_load = working_load(latest.get("sets") or [], rep_range)
    candidates = [latest]
    for session in sessions[1:PEAK_WINDOW_SESSIONS]:
        gap = days_between_sessions(latest.get("date"), session.get("date"))
        # An undated session cannot be shown to be recent, so it does not vote.
        if gap is None or gap > PEAK_WINDOW_DAYS:
            continue
        # Never reach back to a *lighter* session, however well it scores.
        # Epley rates 50x10 (66.7) above 55x6 (66.0), so ranking on e1RM alone
        # would hand back 50 to a lifter who had just completed the prescribed
        # jump to 55 — the exact oscillation the volume comparison used to
        # cause, arriving by a different route. Peak-anchoring may only ever
        # look sideways or up.
        if working_load(session.get("sets") or [], rep_range) < latest_load:
            continue
        candidates.append(session)

    def peak_of(session: Dict) -> float:
        usable = [s for s in session.get("sets") or [] if set_e1rm(s) > 0]
        return max((set_e1rm(s) for s in usable), default=0.0)

    best = max(candidates, key=peak_of)
    # Ties and regressions both keep the latest session: it carries the most
    # current information about what the lifter is ready for today.
    return best if peak_of(best) > peak_of(latest) else latest


# At or above this, the lifter carries one load across the whole session and a
# prescribed backoff contradicts their own log rather than describing it.
HELD_LOAD_RATIO = 0.97


def holds_load_across_sets(
    recent_sessions: List[Dict],
    rep_range: Optional[RepRangeConfig] = None,
    limit: int = 4,
) -> bool:
    """
    Does this lifter keep the same weight on the bar for every working set?

    Read from their own log rather than assumed. `_top_set_shape` used a flat
    0.9 multiplier that never saw any history at all, so a lifter logging
    175x7, 175x6, 175x5 every session was handed 175 and then 160 -- less load
    for more reps than they had just done, on the day meant to be the heavy
    one.

    Warmups sit below the working load too, but they are logged *before* it,
    so only sets from the working set onward describe the shape. A session with
    one working set says nothing either way.
    """
    ratios = []
    for session in (recent_sessions or [])[:limit]:
        sets = [
            s
            for s in (session.get("sets") or [])
            if float(s.get("weight") or 0) > 0 and int(s.get("reps") or 0) > 0
        ]
        if len(sets) < 2:
            continue
        load = working_load(sets, rep_range)
        if load <= 0:
            continue
        try:
            first = next(
                i
                for i, s in enumerate(sets)
                if abs(float(s.get("weight") or 0) - load) < 0.01
            )
        except StopIteration:
            continue
        tail = sets[first:]
        if len(tail) < 2:
            continue
        ratios.append(min(float(s.get("weight") or 0) for s in tail) / load)
    if not ratios:
        return False
    return median(ratios) >= HELD_LOAD_RATIO


def near_top_streak(
    recent_sessions: List[Dict],
    rep_range: RepRangeConfig,
    limit: int = 3,
) -> int:
    """
    How many consecutive recent sessions finished at or above the ceiling.

    Lets a lifter who keeps landing 10,9,10 in an 8-10 band earn the weight,
    instead of being pinned at the same load indefinitely waiting for a sweep
    that a normal training day rarely produces.
    """
    streak = 0
    for session in (recent_sessions or [])[:limit]:
        outcome = evaluate_session(session.get("sets") or [], rep_range)
        if outcome in (SessionOutcome.SWEPT_TOP, SessionOutcome.AT_TOP):
            streak += 1
        else:
            break
    return streak


def typical_reps(sets: List[Dict]) -> Optional[float]:
    """The representative rep count for a session, or None if unusable."""
    reps = reps_in(sets)
    return median(reps) if reps else None


def working_load(
    sets: List[Dict], rep_range: Optional[RepRangeConfig] = None
) -> float:
    """
    The load this session actually worked at.

    Deliberately not `max(weight)`. A session that opens with a heavy single --
    85x1, then 75x7, 75x5, 70x6 -- worked at 75. The 85 is a load the lifter
    demonstrably could *not* hold for the band, and anchoring on it prescribes
    85 for six reps to someone who just did it for one. That is wrong as
    coaching on its own, and in the projection it is large enough to blow
    through the plausibility ceiling on week one, which froze an entire
    12-week walk at its starting point.

    This is the same "within one set" rule the display path already uses for
    estimated 1RM: a load only counts paired with the reps actually done at
    it, never with reps borrowed from a lighter set.

    So: the heaviest load carried for at least the band's floor. With no band
    to answer to, the load of the best-e1RM set. Only then the raw maximum.
    """
    usable = [
        s
        for s in sets or []
        if float(s.get("weight") or 0) > 0 and int(s.get("reps") or 0) > 0
    ]
    if not usable:
        weights = [float(s.get("weight") or 0) for s in sets or []]
        return max(weights) if weights else 0.0

    if rep_range is not None:
        qualifying = [
            float(s["weight"])
            for s in usable
            if int(s["reps"]) >= rep_range.low
        ]
        if qualifying:
            return max(qualifying)

    # No set reached the floor (or no band was given): fall back to the set
    # that represents the most strength, judged within itself.
    readable = [s for s in usable if set_e1rm(s) > 0]
    if readable:
        return float(max(readable, key=set_e1rm)["weight"])
    return max(float(s["weight"]) for s in usable)


def set_e1rm(workout_set: Dict) -> float:
    """
    Epley for one set, pairing a load only with its own reps.

    Returns 0 for a set Epley cannot read rather than a clamped figure: a set
    of 20 evidences endurance, not a 1RM, and clamping it to 12 would assert a
    number the set never demonstrated.
    """
    weight = float(workout_set.get("weight") or 0)
    reps = int(workout_set.get("reps") or 0)
    if weight <= 0 or reps <= 0 or reps > E1RM_MAX_REPS:
        return 0.0
    return weight * (1 + reps / 30.0)


def sets_at_working_load(
    sets: List[Dict], rep_range: Optional[RepRangeConfig] = None
) -> List[Dict]:
    """The sets performed at the session's working load, in order."""
    load = working_load(sets, rep_range)
    if load <= 0:
        return list(sets or [])
    return [s for s in sets or [] if abs(float(s.get("weight") or 0) - load) < 0.01]


def count_regressions(
    recent_sessions: List[Dict],
    rep_range: RepRangeConfig,
    limit: int = 4,
) -> int:
    """
    Consecutive recent sessions that went backwards, newest first.

    A session counts as going backwards if it fell through the band floor, or
    if reps dropped *while the load stayed the same*. The load qualifier is the
    whole point: reps falling because the weight went up is the program
    working, and counting that as a failure is what used to hand a lifter back
    the load they had just outgrown.

    A genuine decline at a fixed load — 8,8,8 then 7,7,7 then 6,6,6 — is still
    caught, because none of those sessions changed the weight.
    """
    sessions = (recent_sessions or [])[: limit + 1]
    regressions = 0
    for i, session in enumerate(sessions):
        sets = session.get("sets") or []
        if evaluate_session(sets, rep_range) == SessionOutcome.BELOW:
            regressions += 1
            continue

        if i + 1 >= len(sessions):
            break
        prev_sets = sessions[i + 1].get("sets") or []
        current_typical = typical_reps(sets)
        prev_typical = typical_reps(prev_sets)
        if current_typical is None or prev_typical is None:
            break
        # Different load — the comparison is meaningless, so stop counting.
        if abs(working_load(sets) - working_load(prev_sets)) > 0.01:
            break
        if current_typical < prev_typical:
            regressions += 1
        else:
            break
    return regressions


def same_load(sets: List[Dict], weight: float, tolerance: float = 0.01) -> bool:
    """Whether a session was worked at (about) the given load."""
    weights = [float(s.get("weight") or 0) for s in sets or [] if (s.get("weight") or 0) > 0]
    if not weights:
        return False
    return abs(max(weights) - float(weight)) <= tolerance


def describe_band(low: int, high: int) -> str:
    """Render a band the way it should read in the UI."""
    if low >= high:
        return f"{low}"
    return f"{low}-{high}"
