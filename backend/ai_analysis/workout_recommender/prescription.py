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
from typing import Dict, List, Optional

from .exercise_metadata import ExerciseMetadata
from .goal_configs import GoalConfig, RepRangeConfig


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


def select_strategy(
    metadata: ExerciseMetadata,
    goal_config: GoalConfig,
) -> ProgressionStrategy:
    """
    Pick the prescription shape.

    A strength-goal compound is the case where chasing a single heavy set and
    backing off is how the lift is actually trained, and where "if you miss,
    drop to X" is the instruction that matters. Everything else fills a band.
    """
    if goal_config.name == "strength" and metadata.compound:
        return ProgressionStrategy.TOP_SET
    return ProgressionStrategy.BAND


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


def working_load(sets: List[Dict]) -> float:
    """The heaviest load worked in a session."""
    weights = [float(s.get("weight") or 0) for s in sets or []]
    return max(weights) if weights else 0.0


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
