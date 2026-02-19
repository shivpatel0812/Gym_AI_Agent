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
        profile_ref = self.db.collection("users").document(self.user_id).collection("profile").document("data")
        profile_doc = profile_ref.get()
        if profile_doc.exists:
            return profile_doc.to_dict()
        return {}
    
    def get_all_workout_sessions(self) -> List[Dict]:
        """Fetch all workout sessions for the user."""
        sessions_ref = self.db.collection("users").document(self.user_id).collection("workout_sessions")
        sessions = list(sessions_ref.stream())
        return [{"id": s.id, **s.to_dict()} for s in sessions]
    
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


