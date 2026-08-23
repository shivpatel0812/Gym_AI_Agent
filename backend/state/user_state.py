"""
Layer 3 — the shared read model.

Two products, both computed in Python, neither written by a model:

    readiness    a scalar the progression engine consumes. Only ever holds or
                 lowers a recommendation, never accelerates one.
    next_levers  a ranked list every narrative surface consumes, so Home, the
                 coach and the plan all argue for the same priority instead of
                 each inventing their own.

Ranking lives here rather than in a prompt because it is the product's core
judgment and it has to be stable. An LLM asked to rank the same data twice
will order it differently, and an app that contradicts itself between Tuesday
and Thursday is worse than one that is consistently a little wrong.

The cancel rule runs all the way up: a metric whose baseline was cancelled for
thin data contributes nothing here — not a softened signal, nothing. When
every input is cancelled, readiness is exactly neutral and says so, which is
what keeps the recommendation seam inert until there is something real to say.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from metrics import registry as reg
from .daily_rollup import BASELINE_WINDOW_DAYS, DailyRollupBuilder

DOCUMENT = "current"
COLLECTION = "user_state"

# How much each signal can pull readiness down. Deliberately sums to less than
# 1.0: even a maximally bad day should leave a floor, because these are proxies
# for fatigue, not measurements of it.
READINESS_WEIGHTS = {
    "sleep_hours": 0.35,
    "fatigue": 0.30,
    "rpe_drift": 0.20,
    "stress": 0.15,
}

# A single shortfall this large or worse counts as "as bad as it gets" for that
# signal. Without a cap, one 2-hour night would swamp every other input.
SHORTFALL_CAP = 0.5

# Readiness never falls below this. The engine's job is to hold progression,
# not to talk someone out of training.
READINESS_FLOOR = 0.5

# Days of rollups considered when ranking levers.
LEVER_WINDOW_DAYS = 14

# Below this, a gap is not a lever. An inferred target is a median, so roughly
# half of all days sit slightly under it by construction — without a floor
# every metric always looks like a problem and the ranking means nothing.
MIN_LEVER_SHORTFALL = 0.05


@dataclass
class Lever:
    """One thing the user could change, and how much it looks like it matters."""

    metric: str
    label: str
    score: float
    shortfall: float
    confidence: float
    actionability: float
    days_observed: int
    value: Optional[float] = None
    target: Optional[float] = None
    unit: str = ""
    direction: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class UserState:
    readiness: float
    readiness_source: str  # "computed" | "unavailable"
    readiness_drivers: List[str] = field(default_factory=list)
    current_focus: Optional[str] = None
    next_levers: List[Dict[str, Any]] = field(default_factory=list)
    window_days: int = LEVER_WINDOW_DAYS
    days_with_data: int = 0
    computed_at: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _mean(values: List[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None


class UserStateBuilder:
    """Composes daily rollups into readiness and ranked levers."""

    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id
        self.rollups = DailyRollupBuilder(db, user_id)

    # --- helpers ---------------------------------------------------------

    @staticmethod
    def _usable(day: Dict[str, Any], metric_key: str) -> Optional[Dict[str, Any]]:
        reading = (day.get("metrics") or {}).get(metric_key)
        if not reading or reading.get("status") != "ok":
            return None
        if reading.get("deviation") is None:
            return None
        return reading

    @staticmethod
    def _recency_weights(n: int) -> List[float]:
        """
        Linear weights, newest heaviest. A protein gap from yesterday says more
        about what to do today than one from two weeks ago.
        """
        if n <= 0:
            return []
        return [(i + 1) / n for i in range(n)]

    def _rpe_drift(self, days: List[Dict[str, Any]]) -> Optional[float]:
        """
        How much harder recent sessions felt than the user's own norm.

        A first approximation: mean session RPE now versus mean session RPE
        across the window. It is *not* matched for load, so a genuinely heavier
        block reads as drift. Treated as one weighted input among several
        rather than a verdict, and worth replacing with a matched-load
        comparison once there is evidence for the thresholds.
        """
        rpes = [
            (d.get("trained") or {}).get("avg_rpe")
            for d in days
            if (d.get("trained") or {}).get("avg_rpe") is not None
        ]
        rpes = [r for r in rpes if isinstance(r, (int, float))]
        if len(rpes) < 4:
            return None  # cancelled: too few sessions to know a norm

        baseline = _mean(rpes)
        recent = _mean(rpes[-2:])
        if not baseline or recent is None:
            return None
        return max(0.0, (recent - baseline) / baseline)

    # --- readiness -------------------------------------------------------

    def _readiness(self, days: List[Dict[str, Any]]) -> tuple:
        """Returns (score, source, drivers)."""
        recent = days[-7:] if len(days) > 7 else days
        penalties: Dict[str, float] = {}

        for metric_key in ("sleep_hours", "fatigue", "stress"):
            shortfalls, confidences = [], []
            for day in recent:
                reading = self._usable(day, metric_key)
                if reading is None:
                    continue
                s = reg.shortfall(metric_key, reading["deviation"])
                if s is None:
                    continue
                shortfalls.append(min(s, SHORTFALL_CAP) / SHORTFALL_CAP)
                confidences.append(reading.get("confidence") or 0.0)
            mean_shortfall = _mean(shortfalls)
            if mean_shortfall is None or mean_shortfall <= 0:
                continue
            penalties[metric_key] = (
                mean_shortfall * READINESS_WEIGHTS[metric_key] * (_mean(confidences) or 0.0)
            )

        drift = self._rpe_drift(days)
        if drift and drift > 0:
            penalties["rpe_drift"] = (
                min(drift, SHORTFALL_CAP) / SHORTFALL_CAP * READINESS_WEIGHTS["rpe_drift"]
            )

        if not penalties:
            # Nothing usable. Neutral, and explicit about why, so the seam
            # stays inert rather than guessing.
            return 1.0, "unavailable", []

        score = max(READINESS_FLOOR, 1.0 - sum(penalties.values()))
        drivers = [
            key for key, _ in sorted(penalties.items(), key=lambda kv: kv[1], reverse=True)
            if penalties[key] >= 0.02
        ]
        return round(score, 3), "computed", drivers

    # --- levers ----------------------------------------------------------

    def _levers(self, days: List[Dict[str, Any]]) -> List[Lever]:
        levers: List[Lever] = []

        for metric in reg.lever_metrics():
            observations = []
            for index, day in enumerate(days):
                reading = self._usable(day, metric.key)
                if reading is None:
                    continue
                s = reg.shortfall(metric.key, reading["deviation"])
                if s is None:
                    continue
                observations.append((index, s, reading))

            if not observations:
                continue

            weights = self._recency_weights(len(days))
            weighted_total = sum(weights[i] * s for i, s, _ in observations)
            weight_sum = sum(weights[i] for i, _, _ in observations)
            if not weight_sum:
                continue

            shortfall = weighted_total / weight_sum
            if shortfall < MIN_LEVER_SHORTFALL:
                continue

            confidence = _mean([r.get("confidence") or 0.0 for _, _, r in observations]) or 0.0
            latest = observations[-1][2]

            levers.append(
                Lever(
                    metric=metric.key,
                    label=metric.label,
                    score=round(shortfall * confidence * metric.actionability, 4),
                    shortfall=round(shortfall, 3),
                    confidence=round(confidence, 2),
                    actionability=metric.actionability,
                    days_observed=len(observations),
                    value=latest.get("value"),
                    target=latest.get("target"),
                    unit=metric.unit,
                    direction=metric.direction,
                )
            )

        levers.sort(key=lambda l: l.score, reverse=True)
        return levers

    # --- build -----------------------------------------------------------

    def build(self, window_days: int = LEVER_WINDOW_DAYS) -> UserState:
        end = datetime.now()
        start = end - timedelta(days=window_days - 1)
        rollups = self.rollups.build_range(
            start.strftime("%Y-%m-%d"),
            end.strftime("%Y-%m-%d"),
            baseline_window_days=BASELINE_WINDOW_DAYS,
        )
        days = [rollups[key] for key in sorted(rollups)]

        readiness, source, drivers = self._readiness(days)
        levers = self._levers(days)

        return UserState(
            readiness=readiness,
            readiness_source=source,
            readiness_drivers=drivers,
            current_focus=levers[0].label if levers else None,
            next_levers=[l.to_dict() for l in levers],
            window_days=window_days,
            days_with_data=sum(1 for d in days if d.get("metrics")),
            computed_at=datetime.now().isoformat(),
        )

    # --- persistence -----------------------------------------------------

    def _doc(self):
        return (
            self.db.collection("users").document(self.user_id)
            .collection(COLLECTION).document(DOCUMENT)
        )

    def write(self, window_days: int = LEVER_WINDOW_DAYS) -> Dict[str, Any]:
        state = self.build(window_days).to_dict()
        self._doc().set(state)
        return state

    def read(self) -> Optional[Dict[str, Any]]:
        try:
            doc = self._doc().get()
            return doc.to_dict() if doc.exists else None
        except Exception as e:
            print(f"Warning: could not read user_state: {e}")
            return None
