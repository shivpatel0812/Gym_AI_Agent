"""
Fitness Data Analyzer - Backend Integration
Fetches data from Firestore and builds rolling summaries for AI analysis.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from collections import defaultdict
import re
import statistics
import calendar

from field_aliases import normalize_records
from metrics import compute_baseline
from metrics.baseline import MIN_SAMPLES
from .workout_recommender.exercise_metadata import resolve_exercise_metadata

# Fallback when the user has not set a preferred workout frequency.
DEFAULT_SESSIONS_PER_WEEK = 4.5

WEEKDAY_NAMES = [
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]

# One observed Tuesday is an anecdote. Below this a weekday is not reported.
MIN_WEEKDAY_OBSERVATIONS = 3


# A logged day under this is an abandoned log, not a day of eating. Averaging
# it in drags planning targets below what the user actually eats.
PARTIAL_DAY_CALORIES = 500


def numeric_values(records: List[Dict], field: str) -> List[float]:
    """
    Collect numeric values for a field across records.

    Keeps legitimate zeros (a logged fatigue of 0 is data, not a missing value)
    and drops None, missing keys, booleans, and non-numeric entries.
    """
    values = []
    for record in records:
        value = record.get(field)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            values.append(float(value))
    return values


def parse_sessions_per_week(frequency: Optional[str]) -> Optional[float]:
    """
    Parse a preferred-frequency string into a target sessions-per-week number.

    Handles both the web format ("2-3x/week", "5+ times/week") and the mobile
    format ("2_3_days", "daily"). Ranges resolve to their midpoint.
    """
    if not frequency:
        return None

    text = str(frequency).strip().lower()
    if not text:
        return None

    if "daily" in text or "every day" in text:
        return 7.0

    numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", text)]
    numbers = [n for n in numbers if 0 < n <= 7]
    if not numbers:
        return None

    return round(statistics.mean(numbers), 1)


class FitnessDataAnalyzer:
    """Processes fitness data from Firestore and builds rolling summaries."""

    def __init__(self, db, user_id: str):
        """
        Initialize analyzer with Firestore database and user ID.

        Args:
            db: Firestore database client
            user_id: User ID to fetch data for
        """
        self.db = db
        self.user_id = user_id
        self._target_sessions_per_week: Optional[float] = None
        self._profile: Optional[Dict[str, Any]] = None

    def _get_target_sessions_per_week(self) -> Optional[float]:
        """
        Read the user's preferred training frequency from their profile.

        Cached per instance. Returns None when the profile is missing or the
        frequency is unset, so callers can distinguish "no target" from a guess.
        """
        if self._target_sessions_per_week is not None:
            return self._target_sessions_per_week

        try:
            profile_doc = (
                self.db.collection("users").document(self.user_id)
                .collection("user_profile").document("profile").get()
            )
            if profile_doc.exists:
                profile = profile_doc.to_dict() or {}
                target = parse_sessions_per_week(profile.get("preferred_workout_frequency"))
                if target:
                    self._target_sessions_per_week = target
                    return target
        except Exception as e:
            print(f"Warning: could not read preferred workout frequency: {e}")

        return None

    def _get_profile(self) -> Dict[str, Any]:
        """Read the user profile once per instance; {} when unavailable."""
        if self._profile is None:
            try:
                doc = (
                    self.db.collection("users").document(self.user_id)
                    .collection("user_profile").document("profile").get()
                )
                self._profile = (doc.to_dict() or {}) if doc.exists else {}
            except Exception as e:
                print(f"Warning: could not read user profile: {e}")
                self._profile = {}
        return self._profile

    def _get_month_date_range(self, year: int, month: int) -> tuple:
        """Get start and end dates for a given month (year, month)."""
        start_date = datetime(year, month, 1)
        last_day = calendar.monthrange(year, month)[1]
        end_date = datetime(year, month, last_day)
        return start_date.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d')

    def _get_days_in_month(self, year: int, month: int) -> int:
        """Get number of days in a given month."""
        return calendar.monthrange(year, month)[1]

    def _fetch_collection_data(self, collection_name: str, start_date: str, end_date: str) -> List[Dict]:
        """Fetch data from Firestore collection within date range."""
        collection_ref = self.db.collection("users").document(self.user_id).collection(collection_name)
        docs = collection_ref.where("date", ">=", start_date).where("date", "<=", end_date).stream()
        rows = [{"id": doc.id, **doc.to_dict()} for doc in docs]
        # Older web-written documents use different field names for the same
        # concepts; normalize here so no summary below has to know that.
        return normalize_records(collection_name, rows)

    def build_training_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build training metrics summary for a specific month."""
        start_date, end_date = self._get_month_date_range(year, month)
        label = f"{calendar.month_name[month]} {year}"
        return self._training_summary(start_date, end_date, label, self._get_days_in_month(year, month))

    def _training_summary(self, start_date: str, end_date: str, label: str, span_days: int) -> Dict[str, Any]:
        """Build training metrics for an arbitrary date range."""
        workouts = self._fetch_collection_data('workout_sessions', start_date, end_date)

        total_sessions = len(workouts)
        sessions_per_week = (total_sessions / span_days) * 7 if span_days > 0 else 0

        # Split adherence
        split_distribution = defaultdict(int)
        for workout in workouts:
            split_name = workout.get('split_name', 'Unknown')
            split_distribution[split_name] += 1

        # Volume and progression tracking
        total_sets = 0
        total_reps = 0
        compound_movements = {}

        for workout in workouts:
            exercises = workout.get('exercises', [])
            for exercise in exercises:
                sets = exercise.get('sets', [])
                total_sets += len(sets)
                total_reps += sum(s.get('reps', 0) for s in sets)

                # Track compound lifts (shares the recommender's classification
                # so custom and oddly-named exercises are caught too)
                ex_name = exercise.get('exercise_name', '')
                metadata = resolve_exercise_metadata(
                    exercise_id=exercise.get('exercise_id', ''),
                    exercise_name=ex_name,
                )
                if metadata.compound:
                    if ex_name not in compound_movements:
                        compound_movements[ex_name] = []

                    max_weight = max((s.get('weight', 0) or 0) for s in sets) if sets else 0
                    compound_movements[ex_name].append({
                        'date': workout.get('date'),
                        'max_weight': max_weight,
                        'total_reps': sum(s.get('reps', 0) for s in sets)
                    })

        # Calculate progression
        progression = "stable"
        if len(workouts) >= 4:
            mid_point = len(workouts) // 2
            early_workouts = workouts[:mid_point]
            recent_workouts = workouts[mid_point:]

            early_volume = sum(len(ex.get('sets', [])) for w in early_workouts for ex in w.get('exercises', []))
            recent_volume = sum(len(ex.get('sets', [])) for w in recent_workouts for ex in w.get('exercises', []))

            if recent_volume > early_volume * 1.1:
                progression = "increasing"
            elif recent_volume < early_volume * 0.9:
                progression = "decreasing"

        # Measure adherence against the user's own target, not a hardcoded one
        target_per_week = self._get_target_sessions_per_week()

        summary = {
            "time_window": label,
            "start_date": start_date,
            "end_date": end_date,
            "total_sessions": total_sessions,
            "sessions_per_week": round(sessions_per_week, 1),
            "split_distribution": dict(split_distribution),
            "total_sets": total_sets,
            "total_reps": total_reps,
            "avg_sets_per_session": round(total_sets / total_sessions, 1) if total_sessions > 0 else 0,
            "progression": progression,
            "compound_lifts": compound_movements
        }

        if target_per_week:
            expected_sessions = (span_days / 7) * target_per_week
            summary["target_sessions_per_week"] = target_per_week
            summary["missed_sessions"] = max(0, int(round(expected_sessions - total_sessions)))
        else:
            summary["target_sessions_per_week"] = None
            summary["missed_sessions"] = None
            summary["adherence_note"] = "No training frequency set in profile — adherence not measured"

        return summary

    def build_nutrition_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build nutrition metrics summary for a specific month."""
        start_date, end_date = self._get_month_date_range(year, month)
        return self._nutrition_summary(start_date, end_date, f"{calendar.month_name[month]} {year}")

    def _nutrition_summary(
        self,
        start_date: str,
        end_date: str,
        label: str,
        exclude_dates: Optional[set] = None,
        min_calories: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Build nutrition metrics for an arbitrary date range.

        `exclude_dates` drops specific days, and `min_calories` drops days whose
        total is too low to be a real day of eating. Both exist for planning:
        averaging in a day that is still being logged pulls the average down and
        the plan sets targets below what the user actually eats.
        """
        macros = self._fetch_collection_data('macros', start_date, end_date)

        if not macros:
            return {"error": "No nutrition data available"}

        excluded = 0
        if exclude_dates or min_calories:
            kept = []
            for row in macros:
                if exclude_dates and str(row.get('date') or '')[:10] in exclude_dates:
                    excluded += 1
                    continue
                if min_calories is not None:
                    total = row.get('total_calories')
                    if not isinstance(total, (int, float)) or total < min_calories:
                        excluded += 1
                        continue
                kept.append(row)
            macros = kept
            if not macros:
                return {"error": "No nutrition data available", "days_excluded": excluded}

        calories = numeric_values(macros, 'total_calories')
        protein = numeric_values(macros, 'total_protein')
        carbs = numeric_values(macros, 'total_carbs')
        fats = numeric_values(macros, 'total_fats')

        if not calories:
            return {"error": "No nutrition data available"}

        cal_std = statistics.stdev(calories) if len(calories) > 1 else 0
        consistency = "excellent" if cal_std < 150 else "good" if cal_std < 250 else "variable"

        avg_calories = statistics.mean(calories)
        avg_protein = statistics.mean(protein) if protein else 0

        return {
            "time_window": label,
            "days_logged": len(macros),
            "days_excluded": excluded,
            "avg_calories": round(avg_calories),
            "calories_range": [min(calories), max(calories)],
            "avg_protein": round(avg_protein),
            "avg_carbs": round(statistics.mean(carbs)) if carbs else 0,
            "avg_fats": round(statistics.mean(fats)) if fats else 0,
            "consistency": consistency,
            "protein_ratio": round((avg_protein * 4 / avg_calories) * 100, 1) if avg_calories > 0 else 0
        }

    def build_planning_nutrition(self, window_days: int = 14) -> Dict[str, Any]:
        """
        Recent intake as a basis for setting targets — completed days only.

        The day in progress is excluded: a plan generated at 10am would
        otherwise average in a single logged breakfast and set the user a lower
        calorie and protein target than they actually eat. Days under
        PARTIAL_DAY_CALORIES go too, since those are almost always a log
        someone abandoned rather than a day they ate 300 calories.
        """
        import user_time

        today = user_time.today(self.db, self.user_id)
        end = datetime.strptime(today, '%Y-%m-%d') - timedelta(days=1)
        start = end - timedelta(days=window_days - 1)
        start_str, end_str = start.strftime('%Y-%m-%d'), end.strftime('%Y-%m-%d')

        summary = self._nutrition_summary(
            start_str,
            end_str,
            f"last {window_days} completed days ({start_str} to {end_str})",
            exclude_dates={today},
            min_calories=PARTIAL_DAY_CALORIES,
        )
        summary["excludes_today"] = True
        return summary

    def build_recovery_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build recovery metrics summary for a specific month."""
        start_date, end_date = self._get_month_date_range(year, month)
        return self._recovery_summary(start_date, end_date, f"{calendar.month_name[month]} {year}")

    def _recovery_summary(self, start_date: str, end_date: str, label: str) -> Dict[str, Any]:
        """Build recovery metrics for an arbitrary date range."""
        # Fetch sleep data
        sleep_data = self._fetch_collection_data('sleep', start_date, end_date)
        # Fetch wellness survey data for additional recovery metrics
        wellness = self._fetch_collection_data('wellness_survey', start_date, end_date)

        if not sleep_data and not wellness:
            return {"error": "No recovery data available"}

        # Process sleep data
        sleep_hours = numeric_values(sleep_data, 'hours_slept')
        sleep_quality = numeric_values(sleep_data, 'quality')

        # Process wellness data
        fatigue = numeric_values(wellness, 'fatigue')
        energy = numeric_values(wellness, 'energy')
        body_aches = numeric_values(wellness, 'body_aches')

        # Calculate trends
        sleep_trend = "stable"
        fatigue_trend = "stable"

        if len(sleep_hours) >= 4:
            mid = len(sleep_hours) // 2
            early_sleep = statistics.mean(sleep_hours[:mid])
            recent_sleep = statistics.mean(sleep_hours[mid:])
            if recent_sleep < early_sleep - 0.5:
                sleep_trend = "declining"
            elif recent_sleep > early_sleep + 0.5:
                sleep_trend = "improving"

        if len(fatigue) >= 4:
            mid = len(fatigue) // 2
            early_fatigue = statistics.mean(fatigue[:mid])
            recent_fatigue = statistics.mean(fatigue[mid:])
            if recent_fatigue > early_fatigue + 1:
                fatigue_trend = "increasing"
            elif recent_fatigue < early_fatigue - 1:
                fatigue_trend = "decreasing"

        # A personal sleep target, inferred from the user's own logged nights
        # unless they declared one. Below the sample floor this comes back
        # cancelled, and the block below reports that rather than inventing a
        # target — a fabricated target yields a confident deviation, which is
        # precisely what the lever and readiness layers would then act on.
        sleep_baseline = self._sleep_baseline(sleep_hours)

        # None means "not logged" — distinct from a logged value of 0
        return {
            "time_window": label,
            "sleep_baseline": sleep_baseline.to_dict(),
            "days_sleep_logged": len(sleep_hours),
            "days_wellness_logged": len(wellness),
            "avg_sleep_hours": round(statistics.mean(sleep_hours), 1) if sleep_hours else None,
            "sleep_range": [round(min(sleep_hours), 1), round(max(sleep_hours), 1)] if sleep_hours else None,
            "avg_sleep_quality": round(statistics.mean(sleep_quality), 1) if sleep_quality else None,
            "sleep_trend": sleep_trend,
            "avg_fatigue": round(statistics.mean(fatigue), 1) if fatigue else None,
            "fatigue_trend": fatigue_trend,
            "avg_energy": round(statistics.mean(energy), 1) if energy else None,
            "avg_body_aches": round(statistics.mean(body_aches), 1) if body_aches else None
        }

    def _sleep_baseline(self, sleep_hours: List[float]):
        """The user's personal sleep target for a set of logged nights."""
        return compute_baseline(
            "sleep_hours",
            sleep_hours,
            declared_target=self._get_profile().get("sleep_goal"),
        )

    def build_sleep_baseline(self, window_days: int = 28) -> Dict[str, Any]:
        """
        The sleep target on its own, for callers that do not need a full
        recovery summary. Shares `_sleep_baseline` with the digest so the two
        can never disagree about what a user's normal night looks like.
        """
        end = datetime.now()
        start = end - timedelta(days=window_days - 1)
        sleep_data = self._fetch_collection_data(
            "sleep", start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
        )
        baseline = self._sleep_baseline(numeric_values(sleep_data, "hours_slept"))
        return {
            **baseline.to_dict(),
            "window_days": window_days,
            "min_samples": MIN_SAMPLES,
        }

    def build_lifestyle_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build lifestyle metrics summary for a specific month."""
        start_date, end_date = self._get_month_date_range(year, month)
        return self._lifestyle_summary(start_date, end_date, f"{calendar.month_name[month]} {year}")

    def _lifestyle_summary(self, start_date: str, end_date: str, label: str) -> Dict[str, Any]:
        """Build lifestyle metrics for an arbitrary date range."""
        stress = self._fetch_collection_data('stress', start_date, end_date)
        activities = self._fetch_collection_data('physical_activities', start_date, end_date)

        stress_levels = numeric_values(stress, 'level')
        steps = numeric_values(activities, 'steps')

        # None means "not logged" — never invent a stress level the user
        # did not report, or the AI will comment on data that doesn't exist
        return {
            "time_window": label,
            "days_stress_logged": len(stress_levels),
            "avg_stress": round(statistics.mean(stress_levels), 1) if stress_levels else None,
            "high_stress_days": sum(1 for s in stress_levels if s >= 7) if stress_levels else None,
            "days_steps_logged": len(steps),
            "avg_steps": round(statistics.mean(steps)) if steps else None,
            "active_days": sum(1 for s in steps if s > 5000) if steps else None
        }

    def build_weekday_adherence(
        self, metric_key: str = "protein", window_days: int = 28
    ) -> Dict[str, Any]:
        """
        Adherence to one metric split by day of week.

        This is the digest behind "you're usually behind on protein by Tuesday
        afternoon". A weekly average hides the shape that matters: someone can
        average 95% of target and still miss badly every weekday, which is a
        different problem with a different fix than missing uniformly.

        Returns weekdays only where enough days were logged to say anything —
        one observed Tuesday is an anecdote, not a pattern.
        """
        from state.daily_rollup import DailyRollupBuilder

        end = datetime.now()
        start = end - timedelta(days=window_days - 1)
        rollups = DailyRollupBuilder(self.db, self.user_id).build_range(
            start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")
        )

        # An inferred target is the median of the user's own days, so it sits
        # in the middle of their behaviour by construction and a "shortfall"
        # against it only means "below your own norm". Adherence in the sense a
        # user means it needs a target they declared, so the source travels
        # with the result and callers can decide how hard to lean on it.
        target_source = "none"

        buckets: Dict[int, List[float]] = {i: [] for i in range(7)}
        for day_key in sorted(rollups):
            reading = (rollups[day_key].get("metrics") or {}).get(metric_key)
            if not reading or reading.get("status") != "ok":
                continue
            deviation = reading.get("deviation")
            if deviation is None:
                continue
            weekday = datetime.strptime(day_key, "%Y-%m-%d").weekday()
            buckets[weekday].append(deviation)
            target_source = reading.get("target_source") or target_source

        by_weekday = {}
        for index, deviations in buckets.items():
            if len(deviations) < MIN_WEEKDAY_OBSERVATIONS:
                continue
            by_weekday[WEEKDAY_NAMES[index]] = {
                "days_observed": len(deviations),
                "avg_deviation": round(statistics.mean(deviations), 3),
                "hit_rate": round(sum(1 for d in deviations if d >= 0) / len(deviations), 2),
            }

        if not by_weekday:
            return {
                "metric": metric_key,
                "window_days": window_days,
                "status": "insufficient_data",
                "target_source": target_source,
                "by_weekday": {},
            }

        worst = min(by_weekday.items(), key=lambda kv: kv[1]["avg_deviation"])
        best = max(by_weekday.items(), key=lambda kv: kv[1]["avg_deviation"])
        weekdays = [d for name, d in by_weekday.items() if name not in ("Saturday", "Sunday")]
        weekend = [d for name, d in by_weekday.items() if name in ("Saturday", "Sunday")]

        result = {
            "metric": metric_key,
            "window_days": window_days,
            "status": "ok",
            "target_source": target_source,
            "by_weekday": by_weekday,
            "worst_day": worst[0],
            "best_day": best[0],
            "spread": round(best[1]["avg_deviation"] - worst[1]["avg_deviation"], 3),
        }

        # Only claim a weekday/weekend split when both sides were observed.
        if weekdays and weekend:
            result["weekday_avg_deviation"] = round(
                statistics.mean(d["avg_deviation"] for d in weekdays), 3
            )
            result["weekend_avg_deviation"] = round(
                statistics.mean(d["avg_deviation"] for d in weekend), 3
            )

        return result

    def build_complete_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build complete summary for AI analysis for a specific month."""
        month_name = calendar.month_name[month]
        return {
            "user_id": self.user_id,
            "analysis_period": f"{month_name} {year}",
            "training": self.build_training_summary(year, month),
            "nutrition": self.build_nutrition_summary(year, month),
            "recovery": self.build_recovery_summary(year, month),
            "lifestyle": self.build_lifestyle_summary(year, month)
        }

    def build_rolling_summary(self, window_days: int = 28, end_date: Optional[datetime] = None) -> Dict[str, Any]:
        """
        Build a summary over the last N days rather than a calendar month.

        The coach uses this so its context doesn't reset to near-empty on the
        1st of each month, and so "recently" means the last few weeks rather
        than "since the 1st".
        """
        end = end_date or datetime.now()
        start = end - timedelta(days=window_days - 1)
        start_str, end_str = start.strftime('%Y-%m-%d'), end.strftime('%Y-%m-%d')
        label = f"last {window_days} days ({start_str} to {end_str})"

        return {
            "user_id": self.user_id,
            "analysis_period": label,
            "training": self._training_summary(start_str, end_str, label, window_days),
            "nutrition": self._nutrition_summary(start_str, end_str, label),
            "recovery": self._recovery_summary(start_str, end_str, label),
            "lifestyle": self._lifestyle_summary(start_str, end_str, label)
        }
