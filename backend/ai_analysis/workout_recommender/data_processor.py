"""
Data processing utilities for workout recommender.
Handles exercise history building, stats calculation, and trend analysis.
"""

from typing import Dict, List, Any
import statistics


class DataProcessor:
    """Handles data processing and analysis operations."""
    
    def build_exercise_history(self, sessions: List[Dict]) -> Dict[str, List[Dict]]:
        """
        Build a history of each exercise with all instances.
        Returns: {exercise_id: [{date, sets, session_info}, ...]}
        """
        exercise_history = {}
        
        for session in sessions:
            session_date = session.get("date", "")
            split_name = session.get("split_name", "")
            split_day = session.get("split_day", "")
            
            for exercise in session.get("exercises", []):
                ex_id = exercise.get("exercise_id")
                if not ex_id:
                    continue
                
                if ex_id not in exercise_history:
                    exercise_history[ex_id] = []
                
                exercise_history[ex_id].append({
                    "date": session_date,
                    "split_name": split_name,
                    "split_day": split_day,
                    "exercise_name": exercise.get("exercise_name", ""),
                    "sets": exercise.get("sets", []),
                    "time": exercise.get("time"),
                    "speed": exercise.get("speed"),
                    "session_id": session.get("id")
                })
        
        # Sort each exercise's history by date (newest first)
        for ex_id in exercise_history:
            exercise_history[ex_id].sort(key=lambda x: x.get("date", ""), reverse=True)
        
        return exercise_history
    
    def build_split_patterns(self, sessions: List[Dict]) -> Dict[str, Dict]:
        """
        Build patterns for each split/day showing typical exercise order.
        Returns: {split_name: {split_day: [exercise_ids in order], ...}}
        """
        split_patterns = {}
        split_exercises = {}  # {(split_name, split_day): {exercise_id: [positions]}}
        
        for session in sessions:
            split_name = session.get("split_name", "General")
            split_day = session.get("split_day", "")
            key = (split_name, split_day)
            
            if key not in split_exercises:
                split_exercises[key] = {}
            
            exercises = session.get("exercises", [])
            for idx, exercise in enumerate(exercises):
                ex_id = exercise.get("exercise_id")
                if not ex_id:
                    continue
                
                if ex_id not in split_exercises[key]:
                    split_exercises[key][ex_id] = []
                split_exercises[key][ex_id].append(idx)
        
        # Calculate average position for each exercise in each split
        for (split_name, split_day), exercises in split_exercises.items():
            if split_name not in split_patterns:
                split_patterns[split_name] = {}
            
            # Sort exercises by their average position
            exercise_avg_pos = []
            for ex_id, positions in exercises.items():
                avg_pos = statistics.mean(positions)
                exercise_avg_pos.append((ex_id, avg_pos))
            
            exercise_avg_pos.sort(key=lambda x: x[1])
            split_patterns[split_name][split_day] = [ex_id for ex_id, _ in exercise_avg_pos]
        
        return split_patterns
    
    def calculate_exercise_stats(self, exercise_history: List[Dict]) -> Dict[str, Any]:
        """Calculate statistics for an exercise's performance history."""
        if not exercise_history:
            return {}
        
        # Check if it's cardio
        if exercise_history[0].get("time") is not None:
            times = [h.get("time") for h in exercise_history if h.get("time")]
            speeds = [h.get("speed") for h in exercise_history if h.get("speed")]
            
            return {
                "type": "cardio",
                "total_sessions": len(exercise_history),
                "avg_time": round(statistics.mean(times), 1) if times else 0,
                "max_time": max(times) if times else 0,
                "avg_speed": round(statistics.mean(speeds), 1) if speeds else 0,
                "max_speed": max(speeds) if speeds else 0,
                "trend": self.calculate_trend([t for t in times]) if len(times) >= 3 else "stable"
            }
        
        # Strength exercise
        all_weights = []
        all_reps = []
        all_volumes = []
        set_counts = []
        
        for session in exercise_history:
            sets = session.get("sets", [])
            if isinstance(sets, list):
                set_counts.append(len(sets))
                for s in sets:
                    weight = s.get("weight", 0) or 0
                    reps = s.get("reps", 0) or 0
                    if weight > 0:
                        all_weights.append(weight)
                    if reps > 0:
                        all_reps.append(reps)
                    if weight > 0 and reps > 0:
                        all_volumes.append(weight * reps)
        
        return {
            "type": "strength",
            "total_sessions": len(exercise_history),
            "avg_sets": round(statistics.mean(set_counts), 1) if set_counts else 0,
            "avg_weight": round(statistics.mean(all_weights), 1) if all_weights else 0,
            "max_weight": max(all_weights) if all_weights else 0,
            "avg_reps": round(statistics.mean(all_reps), 1) if all_reps else 0,
            "max_reps": max(all_reps) if all_reps else 0,
            "avg_volume": round(statistics.mean(all_volumes), 1) if all_volumes else 0,
            "weight_trend": self.calculate_trend(all_weights) if len(all_weights) >= 3 else "stable"
        }
    
    def calculate_trend(self, values: List[float]) -> str:
        """Calculate trend from a list of values (oldest to newest)."""
        if len(values) < 3:
            return "stable"
        
        # Compare first third to last third
        third = len(values) // 3
        early = statistics.mean(values[:third]) if values[:third] else 0
        recent = statistics.mean(values[-third:]) if values[-third:] else 0
        
        if early == 0:
            return "stable"
        
        change_pct = ((recent - early) / early) * 100
        
        if change_pct > 5:
            return "increasing"
        elif change_pct < -5:
            return "decreasing"
        return "stable"


