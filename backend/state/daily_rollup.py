"""
Layer 1 — the daily rollup.

One document per user per day, in which every metric wears the same shape:

    {value, target, deviation, confidence, status}

The uniformity is the whole point. Sleep hours and grams of protein are not
comparable as raw numbers, but once each is a signed deviation from that
user's own target they are, and a single ranked list of levers becomes
possible. Everything above this layer reads that shape and never needs to
know which Firestore collection a signal came from.

Derived, never authored: this document is a cache over the raw collections
and can be deleted and rebuilt at any time. That is what makes it safe to
change the scoring later.

Baselines are computed once over a trailing window and then applied to every
day in the range, rather than recomputed per day — both because it is far
cheaper and because a target that drifts day to day is not a target.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from field_aliases import normalize_records
from metrics import compute_baseline, read_metric
from metrics import registry as reg

COLLECTION = "daily_state"

# Window used to infer personal baselines. Four weeks is long enough to
# survive one bad week and short enough to follow a real change in habits.
BASELINE_WINDOW_DAYS = 28


def _date_str(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


def _day_key(row: Dict[str, Any]) -> str:
    return str(row.get("date") or "")[:10]


def _dig(data: Dict[str, Any], path: str) -> Any:
    """Read a dotted path, returning None rather than raising."""
    current: Any = data
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


class DailyRollupBuilder:
    """Builds (and optionally persists) daily_state documents."""

    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id
        self._profile: Optional[Dict[str, Any]] = None
        self._nutrition_plan: Optional[Dict[str, Any]] = None

    # --- sources ---------------------------------------------------------

    def _user_doc(self):
        return self.db.collection("users").document(self.user_id)

    def _profile_data(self) -> Dict[str, Any]:
        if self._profile is None:
            try:
                doc = self._user_doc().collection("user_profile").document("profile").get()
                self._profile = (doc.to_dict() or {}) if doc.exists else {}
            except Exception as e:
                print(f"Warning: daily rollup could not read profile: {e}")
                self._profile = {}
        return self._profile

    def _plan_data(self) -> Dict[str, Any]:
        if self._nutrition_plan is None:
            try:
                from nutrition.plan_store import NutritionPlanStore

                self._nutrition_plan = NutritionPlanStore(self.db, self.user_id).get_active() or {}
            except Exception as e:
                print(f"Warning: daily rollup could not read nutrition plan: {e}")
                self._nutrition_plan = {}
        return self._nutrition_plan

    def _fetch(self, collection: str, start: str, end: str) -> List[Dict[str, Any]]:
        try:
            docs = (
                self._user_doc().collection(collection)
                .where("date", ">=", start).where("date", "<=", end).stream()
            )
            rows = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
        except Exception as e:
            print(f"Warning: daily rollup could not read {collection}: {e}")
            return []
        return normalize_records(collection, rows)

    # --- targets ---------------------------------------------------------

    def _declared_target(self, metric: reg.Metric) -> Optional[float]:
        """The target the user declared, if this metric has one."""
        if not metric.target_path:
            return None
        if metric.target_source == reg.SOURCE_PROFILE:
            value = _dig(self._profile_data(), metric.target_path)
        elif metric.target_source == reg.SOURCE_NUTRITION_PLAN:
            value = _dig(self._plan_data(), metric.target_path)
        else:
            return None
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return float(value) if value > 0 else None

    # --- values ----------------------------------------------------------

    @staticmethod
    def _collapse(values: List[float], policy: str) -> Optional[float]:
        if not values:
            return None
        if policy == reg.AGG_MEAN:
            return round(sum(values) / len(values), 3)
        return round(sum(values), 3)

    def _values_by_day(self, metric: reg.Metric, rows: List[Dict[str, Any]]) -> Dict[str, float]:
        """One value per day for this metric, collapsed by its policy."""
        buckets: Dict[str, List[float]] = {}
        for row in rows:
            raw = row.get(metric.field)
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                continue
            buckets.setdefault(_day_key(row), []).append(float(raw))
        return {
            day: collapsed
            for day, values in buckets.items()
            if (collapsed := self._collapse(values, metric.aggregate)) is not None
        }

    # --- training --------------------------------------------------------

    @staticmethod
    def _training_by_day(sessions: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        by_day: Dict[str, Dict[str, Any]] = {}
        for session in sessions:
            day = _day_key(session)
            if not day:
                continue
            volume = 0.0
            rpes: List[float] = []
            exercises = session.get("exercises") or []
            for ex in exercises:
                if not isinstance(ex, dict):
                    continue
                for s in ex.get("sets") or []:
                    if not isinstance(s, dict):
                        continue
                    weight, repetitions = s.get("weight"), s.get("reps")
                    if isinstance(weight, (int, float)) and isinstance(repetitions, (int, float)):
                        volume += float(weight) * float(repetitions)
                    rpe = s.get("rpe")
                    if isinstance(rpe, (int, float)) and not isinstance(rpe, bool):
                        rpes.append(float(rpe))

            entry = by_day.setdefault(
                day, {"sessions": 0, "volume": 0.0, "exercises": 0, "avg_rpe": None, "_rpes": []}
            )
            entry["sessions"] += 1
            entry["volume"] += volume
            entry["exercises"] += len(exercises)
            entry["_rpes"].extend(rpes)

        for entry in by_day.values():
            rpes = entry.pop("_rpes")
            entry["avg_rpe"] = round(sum(rpes) / len(rpes), 2) if rpes else None
            entry["volume"] = round(entry["volume"], 1)
        return by_day

    # --- build -----------------------------------------------------------

    def build_range(
        self,
        start_date: str,
        end_date: str,
        baseline_window_days: int = BASELINE_WINDOW_DAYS,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Build daily_state for every day in [start_date, end_date].

        Collections are fetched once for the union of the requested range and
        the baseline window, so cost does not scale with the number of days
        produced.
        """
        baseline_start = _date_str(
            datetime.strptime(end_date, "%Y-%m-%d") - timedelta(days=baseline_window_days - 1)
        )
        fetch_start = min(start_date, baseline_start)

        collections = {m.collection for m in reg.REGISTRY.values()}
        rows_by_collection = {c: self._fetch(c, fetch_start, end_date) for c in collections}
        sessions = self._fetch("workout_sessions", fetch_start, end_date)
        training_by_day = self._training_by_day(sessions)

        # One baseline per metric, from the trailing window only.
        readings: Dict[str, Dict[str, Any]] = {}
        for key, metric in reg.REGISTRY.items():
            by_day = self._values_by_day(metric, rows_by_collection.get(metric.collection, []))
            history = [v for day, v in by_day.items() if baseline_start <= day <= end_date]
            baseline = compute_baseline(
                key, history, declared_target=self._declared_target(metric)
            )
            readings[key] = {"by_day": by_day, "baseline": baseline}

        out: Dict[str, Dict[str, Any]] = {}
        cursor = datetime.strptime(start_date, "%Y-%m-%d")
        last = datetime.strptime(end_date, "%Y-%m-%d")
        while cursor <= last:
            day = _date_str(cursor)
            metrics = {}
            for key, entry in readings.items():
                value = entry["by_day"].get(day)
                reading = read_metric(key, value, entry["baseline"])
                # A day the user simply did not log is absence, not a signal.
                if value is None and not reading.usable:
                    continue
                metrics[key] = reading.to_dict()

            out[day] = {
                "date": day,
                "user_id": self.user_id,
                "metrics": metrics,
                "trained": training_by_day.get(day),
                "computed_at": datetime.now().isoformat(),
                "baseline_window_days": baseline_window_days,
            }
            cursor += timedelta(days=1)
        return out

    def build_day(self, date: str, baseline_window_days: int = BASELINE_WINDOW_DAYS) -> Dict[str, Any]:
        """Build a single day's rollup."""
        return self.build_range(date, date, baseline_window_days)[date]

    def write_range(self, start_date: str, end_date: str) -> int:
        """Build and persist a range. Returns the number of days written."""
        days = self.build_range(start_date, end_date)
        for day, payload in days.items():
            self._user_doc().collection(COLLECTION).document(day).set(payload)
        return len(days)

    def read_day(self, date: str) -> Optional[Dict[str, Any]]:
        """Read a persisted rollup, or None when it has not been built."""
        try:
            doc = self._user_doc().collection(COLLECTION).document(date).get()
            return doc.to_dict() if doc.exists else None
        except Exception as e:
            print(f"Warning: could not read daily_state/{date}: {e}")
            return None
