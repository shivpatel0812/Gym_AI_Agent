"""
Fitness Data Analyzer - Backend Integration
Fetches data from Firestore and builds rolling summaries for AI analysis.
"""

from datetime import datetime
from typing import Dict, List, Any
from collections import defaultdict
import statistics
import calendar


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
        return [{"id": doc.id, **doc.to_dict()} for doc in docs]

    def build_training_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build training metrics summary for a specific month."""
        start_date, end_date = self._get_month_date_range(year, month)
        days_in_month = self._get_days_in_month(year, month)
        workouts = self._fetch_collection_data('workout_sessions', start_date, end_date)

        total_sessions = len(workouts)
        sessions_per_week = (total_sessions / days_in_month) * 7 if days_in_month > 0 else 0

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

                # Track compound lifts
                ex_name = exercise.get('exercise_name', '')
                if any(compound in ex_name for compound in ['Deadlift', 'Squat', 'Bench Press']):
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

        expected_sessions = (days_in_month / 7) * 4.5
        missed_sessions = max(0, int(expected_sessions - total_sessions))

        month_name = calendar.month_name[month]
        return {
            "time_window": f"{month_name} {year}",
            "start_date": start_date,
            "end_date": end_date,
            "total_sessions": total_sessions,
            "sessions_per_week": round(sessions_per_week, 1),
            "split_distribution": dict(split_distribution),
            "total_sets": total_sets,
            "total_reps": total_reps,
            "avg_sets_per_session": round(total_sets / total_sessions, 1) if total_sessions > 0 else 0,
            "progression": progression,
            "missed_sessions": missed_sessions,
            "compound_lifts": compound_movements
        }

    def build_nutrition_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build nutrition metrics summary for a specific month."""
        start_date, end_date = self._get_month_date_range(year, month)
        month_name = calendar.month_name[month]
        macros = self._fetch_collection_data('macros', start_date, end_date)

        if not macros:
            return {"error": "No nutrition data available"}

        calories = [m.get('total_calories', 0) for m in macros if m.get('total_calories')]
        protein = [m.get('total_protein', 0) for m in macros if m.get('total_protein')]
        carbs = [m.get('total_carbs', 0) for m in macros if m.get('total_carbs')]
        fats = [m.get('total_fats', 0) for m in macros if m.get('total_fats')]

        if not calories:
            return {"error": "No nutrition data available"}

        cal_std = statistics.stdev(calories) if len(calories) > 1 else 0
        consistency = "excellent" if cal_std < 150 else "good" if cal_std < 250 else "variable"

        return {
            "time_window": f"{month_name} {year}",
            "days_logged": len(macros),
            "avg_calories": round(statistics.mean(calories)),
            "calories_range": [min(calories), max(calories)],
            "avg_protein": round(statistics.mean(protein)) if protein else 0,
            "avg_carbs": round(statistics.mean(carbs)) if carbs else 0,
            "avg_fats": round(statistics.mean(fats)) if fats else 0,
            "consistency": consistency,
            "protein_ratio": round((statistics.mean(protein) * 4 / statistics.mean(calories)) * 100, 1) if protein and calories else 0
        }

    def build_recovery_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build recovery metrics summary for a specific month."""
        start_date, end_date = self._get_month_date_range(year, month)
        month_name = calendar.month_name[month]

        # Fetch sleep data
        sleep_data = self._fetch_collection_data('sleep', start_date, end_date)
        # Fetch wellness survey data for additional recovery metrics
        wellness = self._fetch_collection_data('wellness_survey', start_date, end_date)

        if not sleep_data and not wellness:
            return {"error": "No recovery data available"}

        # Process sleep data
        sleep_hours = [s.get('hours_slept', 0) for s in sleep_data if s.get('hours_slept')]
        sleep_quality = [s.get('quality', 0) for s in sleep_data if s.get('quality')]

        # Process wellness data
        fatigue = [w.get('fatigue', 0) for w in wellness if w.get('fatigue')]
        energy = [w.get('energy', 0) for w in wellness if w.get('energy')]
        body_aches = [w.get('body_aches', 0) for w in wellness if w.get('body_aches')]

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

        return {
            "time_window": f"{month_name} {year}",
            "avg_sleep_hours": round(statistics.mean(sleep_hours), 1) if sleep_hours else 0,
            "sleep_range": [round(min(sleep_hours), 1), round(max(sleep_hours), 1)] if sleep_hours else [0, 0],
            "avg_sleep_quality": round(statistics.mean(sleep_quality), 1) if sleep_quality else 0,
            "sleep_trend": sleep_trend,
            "avg_fatigue": round(statistics.mean(fatigue), 1) if fatigue else 0,
            "fatigue_trend": fatigue_trend,
            "avg_energy": round(statistics.mean(energy), 1) if energy else 0,
            "avg_body_aches": round(statistics.mean(body_aches), 1) if body_aches else 0
        }

    def build_lifestyle_summary(self, year: int, month: int) -> Dict[str, Any]:
        """Build lifestyle metrics summary for a specific month."""
        start_date, end_date = self._get_month_date_range(year, month)
        month_name = calendar.month_name[month]

        stress = self._fetch_collection_data('stress', start_date, end_date)
        activities = self._fetch_collection_data('physical_activities', start_date, end_date)

        stress_levels = [s.get('level', 5) for s in stress] if stress else [5]
        steps = [a.get('steps', 0) for a in activities if a.get('steps')] if activities else [0]

        high_stress_days = sum(1 for s in stress_levels if s >= 7)

        return {
            "time_window": f"{month_name} {year}",
            "avg_stress": round(statistics.mean(stress_levels), 1),
            "high_stress_days": high_stress_days,
            "avg_steps": round(statistics.mean(steps)) if steps else 0,
            "active_days": sum(1 for s in steps if s > 5000)
        }

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
