"""
Exercise ordering utilities for workout recommender.
Handles suggested exercise order based on historical patterns.
"""

from typing import List


class ExerciseOrder:
    """Handles exercise ordering recommendations."""
    
    def __init__(self, data_fetcher, summary_manager):
        self.data_fetcher = data_fetcher
        self.summary_manager = summary_manager
    
    def get_suggested_exercise_order(self, split_name: str, split_day: str = "") -> List[str]:
        """
        Get the suggested exercise order for a split based on historical patterns.
        
        Args:
            split_name: The workout split name (e.g., "Push", "Pull", "Legs")
            split_day: The specific day within the split
            
        Returns:
            List of exercise IDs in suggested order
        """
        summary = self.summary_manager.get_or_create_summary()
        
        if summary.get("status") == "insufficient_data":
            # Even with insufficient data, try to get order from recent sessions
            recent_sessions = self.data_fetcher.get_recent_workout_sessions(30)
            for session in recent_sessions:
                if session.get("split_name") == split_name:
                    exercises = session.get("exercises", [])
                    return [ex.get("exercise_id") for ex in exercises if ex.get("exercise_id")]
            return []
        
        split_patterns = summary.get("split_patterns", {})
        
        # Try to find exact match first
        if split_name in split_patterns:
            if split_day and split_day in split_patterns[split_name]:
                return split_patterns[split_name][split_day]
            # Return first available pattern for this split
            for day, exercises in split_patterns[split_name].items():
                return exercises
        
        return []


