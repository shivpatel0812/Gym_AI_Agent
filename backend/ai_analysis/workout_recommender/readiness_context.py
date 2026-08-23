"""
Readiness Context Resolver - the single place that answers "how recovered is
this user today?"

Mirrors PlanContextResolver deliberately. The Active Plan supplies training
*intent*; readiness supplies *capacity*. Both are resolved server-side, both
are expressed as a small dataclass, and neither ever produces a number the
user sees — the deterministic ProgressionEngine still computes every weight
and rep.

Resolution reads one cached document. It does not query sleep, nutrition and
wellness itself: a recommendation is requested once per exercise while the
user stands at a rack, so six exercises would mean twenty-four extra round
trips inside the one interaction that cannot afford them.

Every failure path returns neutral. An unavailable, stale or malformed state
must leave recommendations byte-identical to what they were before readiness
existed — the seam is inert until there is something real to say.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

# Neutral. Multiplied through nothing and compared against thresholds that all
# sit below it, so this value can never demote a recommendation.
NEUTRAL = 1.0

# Beyond this the cached state describes a different week. Fall back to
# neutral rather than acting on it.
MAX_AGE_DAYS = 3

# Past this the state is usable but worth flagging as second-hand.
STALE_AFTER_HOURS = 36

SOURCE_USER_STATE = "user_state"
SOURCE_STALE = "stale"
SOURCE_UNAVAILABLE = "unavailable"


@dataclass
class ReadinessContext:
    """Resolved training capacity for one user, at one moment."""

    score: float = NEUTRAL
    source: str = SOURCE_UNAVAILABLE
    drivers: List[str] = field(default_factory=list)
    computed_at: Optional[str] = None

    @property
    def usable(self) -> bool:
        """False means: change nothing."""
        return self.source in (SOURCE_USER_STATE, SOURCE_STALE) and self.score < NEUTRAL

    def to_dict(self) -> Dict[str, Any]:
        return {
            "score": self.score,
            "source": self.source,
            "drivers": list(self.drivers),
            "computed_at": self.computed_at,
        }


def neutral() -> ReadinessContext:
    return ReadinessContext()


class ReadinessResolver:
    """Reads the cached user_state document and nothing else."""

    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id

    def resolve(self) -> ReadinessContext:
        try:
            from state.user_state import COLLECTION, DOCUMENT

            doc = (
                self.db.collection("users").document(self.user_id)
                .collection(COLLECTION).document(DOCUMENT).get()
            )
            if not doc.exists:
                return neutral()
            data = doc.to_dict() or {}
        except Exception as e:
            print(f"Warning: readiness unavailable, using neutral: {e}")
            return neutral()

        score = data.get("readiness")
        if isinstance(score, bool) or not isinstance(score, (int, float)):
            return neutral()
        score = float(score)
        if not 0.0 <= score <= 1.0:
            return neutral()

        # user_state says so itself when it had nothing to work from.
        if data.get("readiness_source") != "computed":
            return neutral()

        computed_at = data.get("computed_at")
        age = self._age(computed_at)
        if age is None or age > timedelta(days=MAX_AGE_DAYS):
            return neutral()

        return ReadinessContext(
            score=score,
            source=SOURCE_STALE if age > timedelta(hours=STALE_AFTER_HOURS) else SOURCE_USER_STATE,
            drivers=[d for d in (data.get("readiness_drivers") or []) if isinstance(d, str)],
            computed_at=computed_at,
        )

    @staticmethod
    def _age(stamp: Optional[str]) -> Optional[timedelta]:
        if not stamp:
            return None
        try:
            return datetime.now() - datetime.fromisoformat(stamp)
        except (ValueError, TypeError):
            return None
