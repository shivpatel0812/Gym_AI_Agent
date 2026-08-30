"""
Data fetching utilities for workout recommender.
Handles all Firestore queries and data retrieval.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional


class DataFetcher:
    """Handles all data fetching operations from Firestore."""
    
    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id
    
    def get_user_profile(self) -> Dict[str, Any]:
        """Fetch user profile from Firestore."""
        profile_ref = (
            self.db.collection("users")
            .document(self.user_id)
            .collection("user_profile")
            .document("profile")
        )
        profile_doc = profile_ref.get()
        if profile_doc.exists:
            return profile_doc.to_dict()
        return {}
    
    def get_all_workout_sessions(self) -> List[Dict]:
        """Fetch all workout sessions for the user."""
        sessions_ref = self.db.collection("users").document(self.user_id).collection("workout_sessions")
        sessions = list(sessions_ref.stream())
        return [{"id": s.id, **s.to_dict()} for s in sessions]

    def get_exercise_records(self) -> Dict[str, Dict[str, Any]]:
        """Fetch custom exercise metadata keyed by exercise id."""
        ref = self.db.collection("users").document(self.user_id).collection("exercises")
        return {doc.id: {"id": doc.id, **doc.to_dict()} for doc in ref.stream()}
    
    def get_recent_workout_sessions(self, days: int = 14) -> List[Dict]:
        """Fetch workout sessions from the last N days."""
        cutoff_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        sessions_ref = self.db.collection("users").document(self.user_id).collection("workout_sessions")
        sessions = list(sessions_ref.where("date", ">=", cutoff_date).stream())
        return [{"id": s.id, **s.to_dict()} for s in sessions]
    
    def get_stored_summary(self) -> Optional[Dict]:
        """Get the stored workout AI summary from Firestore."""
        summary_ref = self.db.collection("users").document(self.user_id).collection("workout_ai_summary").document("current")
        summary_doc = summary_ref.get()
        if summary_doc.exists:
            return summary_doc.to_dict()
        return None
    
    def calculate_max_reps_per_weight(self, exercise_id: str) -> Dict[float, int]:
        """
        Calculate the maximum reps ever achieved at each weight for an exercise.
        Returns a dict mapping weight -> max reps at that weight.
        """
        all_sessions = self.get_all_workout_sessions()
        max_reps_at_weight = {}

        for session in all_sessions:
            for ex in session.get("exercises", []):
                if ex.get("exercise_id") == exercise_id:
                    sets = ex.get("sets", [])
                    if isinstance(sets, list):
                        for s in sets:
                            weight = s.get("weight")
                            reps = s.get("reps", 0)
                            if weight is not None and reps > 0:
                                if weight not in max_reps_at_weight or reps > max_reps_at_weight[weight]:
                                    max_reps_at_weight[weight] = reps

        return max_reps_at_weight

    def get_failed_attempts(self, exercise_id: str, lookback_days: int = 60) -> List[Dict[str, Any]]:
        """
        Phase 3: Find sets where completed=False (failed attempts).
        This prevents recommending weights the user recently failed at.

        Returns: List of failed attempts with weight, reps, date, and days_ago
        """
        cutoff_date = (datetime.now() - timedelta(days=lookback_days)).strftime('%Y-%m-%d')
        all_sessions = self.get_all_workout_sessions()
        failed_attempts = []

        for session in all_sessions:
            session_date = session.get("date", "")
            if session_date < cutoff_date:
                continue

            try:
                session_date_obj = datetime.strptime(session_date, "%Y-%m-%d")
                days_ago = (datetime.now() - session_date_obj).days
            except:
                continue

            for ex in session.get("exercises", []):
                if ex.get("exercise_id") == exercise_id:
                    sets = ex.get("sets", [])
                    if isinstance(sets, list):
                        for s in sets:
                            # Check if set was marked as not completed
                            if s.get("completed") is False:
                                weight = s.get("weight")
                                reps = s.get("reps", 0)
                                if weight is not None:
                                    failed_attempts.append({
                                        "weight": weight,
                                        "reps_attempted": reps,
                                        "date": session_date,
                                        "days_ago": days_ago
                                    })

        # Sort by most recent first
        failed_attempts.sort(key=lambda x: x["days_ago"])
        return failed_attempts

