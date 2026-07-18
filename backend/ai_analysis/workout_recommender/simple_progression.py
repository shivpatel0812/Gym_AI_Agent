"""
Simple progression recommendation logic.
Used when there's insufficient data for full AI analysis.

DEPRECATED: This module's logic has been absorbed into progression_engine.py.
The ProgressionEngine handles all cases (first session, few sessions, many sessions)
deterministically. This file is kept for backward compatibility but is no longer
called by WorkoutRecommender.get_exercise_recommendation().
"""

from typing import Dict, List, Any


class SimpleProgression:
    """Handles simple progression recommendations for new exercises."""
    
    def get_simple_progression_recommendation(
        self,
        exercise_id: str,
        exercise_name: str,
        recent_data: List[Dict]
    ) -> Dict[str, Any]:
        """
        Generate a simple progression recommendation based on the most recent workout.
        Used when there's only 1-2 previous sessions (not enough for full AI analysis).
        
        Args:
            exercise_id: The exercise ID
            exercise_name: Name of the exercise
            recent_data: List of recent exercise performances
            
        Returns:
            Recommendation dict with suggested sets/reps/weight
        """
        if not recent_data:
            return {
                "status": "insufficient_data",
                "message": "No previous workout data found for this exercise",
                "recommendation": None
            }
        
        # Get the most recent workout
        latest = recent_data[0]
        
        # Check if it's cardio or strength
        if latest.get("time") is not None or latest.get("speed") is not None:
            # Cardio exercise
            prev_time = latest.get("time", 0)
            prev_speed = latest.get("speed")
            
            # Simple progression: add 1-2 minutes or increase speed by 0.5 mph
            recommended_time = prev_time + 1 if prev_time > 0 else 10
            recommended_speed = (prev_speed + 0.5) if prev_speed else None
            
            return {
                "status": "success",
                "recommendation": {
                    "time": recommended_time,
                    "speed": recommended_speed,
                    "reasoning": f"Based on your last workout ({prev_time} min), try adding 1 minute for progressive overload.",
                    "progression_type": "increase_time" if prev_time > 0 else "maintain",
                    "confidence": "medium"
                },
                "exercise_id": exercise_id,
                "exercise_name": exercise_name
            }
        else:
            # Strength exercise
            prev_sets = latest.get("sets", [])
            if not prev_sets:
                return {
                    "status": "insufficient_data",
                    "message": "Previous workout had no sets recorded",
                    "recommendation": None
                }
            
            # Build recommendation sets based on previous workout
            recommended_sets = []
            for prev_set in prev_sets:
                prev_reps = prev_set.get("reps", 0)
                prev_weight = prev_set.get("weight", 0)
                set_number = prev_set.get("set_number", len(recommended_sets) + 1)
                
                # Simple progression: add 1 rep if reps < 12, otherwise add 2.5-5 lbs
                if prev_reps < 12:
                    # Add 1 rep, keep same weight
                    recommended_sets.append({
                        "set_number": set_number,
                        "reps": prev_reps + 1,
                        "weight": prev_weight
                    })
                else:
                    # Add 2.5-5 lbs, reset to 8-10 reps
                    weight_increase = 5.0 if prev_weight >= 50 else 2.5
                    recommended_sets.append({
                        "set_number": set_number,
                        "reps": max(8, prev_reps - 2),  # Drop reps slightly when increasing weight
                        "weight": prev_weight + weight_increase
                    })
            
            # Determine progression type
            first_set = recommended_sets[0] if recommended_sets else {}
            prev_first = prev_sets[0] if prev_sets else {}
            
            if first_set.get("weight", 0) > prev_first.get("weight", 0):
                progression_type = "increase_weight"
                reasoning = f"Based on your last workout, increase weight by 2.5-5 lbs and adjust reps accordingly for progressive overload."
            elif first_set.get("reps", 0) > prev_first.get("reps", 0):
                progression_type = "increase_reps"
                reasoning = f"Based on your last workout ({prev_first.get('reps', 0)} reps), add 1 rep per set for progressive overload."
            else:
                progression_type = "maintain"
                reasoning = f"Based on your last workout, maintain similar intensity."
            
            return {
                "status": "success",
                "recommendation": {
                    "sets": recommended_sets,
                    "reasoning": reasoning,
                    "progression_type": progression_type,
                    "confidence": "medium"
                },
                "exercise_id": exercise_id,
                "exercise_name": exercise_name
            }


