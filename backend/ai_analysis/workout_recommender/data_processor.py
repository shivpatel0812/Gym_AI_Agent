"""
Data processing utilities for workout recommender.
Handles exercise history building, stats calculation, and trend analysis.
"""

from typing import Dict, List, Any
import statistics
from datetime import datetime, timedelta
from math import exp


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

    def calculate_time_weighted_stats(self, exercise_history: List[Dict]) -> Dict[str, Any]:
        """
        Phase 2: Calculate time-weighted performance statistics.
        Recent performance is exponentially weighted more heavily than old performance.
        Half-life = 30 days (performance from 30 days ago weighted at 50%)

        This fixes the critical bug where old PRs are weighted equally with recent performance.
        """
        if not exercise_history:
            return {}

        now = datetime.now()
        all_weights = []
        recent_weights = []  # Last 21 days
        weighted_weights = []

        all_time_max_weight = 0
        all_time_max_date = None
        recent_max_weight = 0  # Max from last 21 days

        for session in exercise_history:
            try:
                session_date = datetime.strptime(session.get("date", ""), "%Y-%m-%d")
            except:
                continue

            days_ago = (now - session_date).days

            # Calculate time weight using exponential decay (half-life = 30 days)
            time_weight = exp(-days_ago / 30.0)

            sets = session.get("sets", [])
            if isinstance(sets, list):
                for s in sets:
                    weight = s.get("weight", 0) or 0
                    if weight > 0:
                        all_weights.append(weight)
                        weighted_weights.append((weight, time_weight, days_ago))

                        # Track all-time max
                        if weight > all_time_max_weight:
                            all_time_max_weight = weight
                            all_time_max_date = session_date

                        # Track recent max (last 21 days)
                        if days_ago <= 21 and weight > recent_max_weight:
                            recent_max_weight = weight

                        # Collect recent weights
                        if days_ago <= 21:
                            recent_weights.append(weight)

        if not all_weights:
            return {}

        # Calculate weighted average
        total_weighted = sum(w * tw for w, tw, _ in weighted_weights)
        total_weight_sum = sum(tw for _, tw, _ in weighted_weights)
        weighted_avg_weight = total_weighted / total_weight_sum if total_weight_sum > 0 else 0

        # Calculate days since all-time max
        days_since_all_time_max = (now - all_time_max_date).days if all_time_max_date else 999

        # Determine if recent max is relevant
        is_recent_max_relevant = days_since_all_time_max <= 60

        return {
            "recent_max_weight": recent_max_weight if recent_weights else 0,
            "all_time_max_weight": all_time_max_weight,
            "days_since_all_time_max": days_since_all_time_max,
            "weighted_avg_weight": round(weighted_avg_weight, 1),
            "is_recent_max_relevant": is_recent_max_relevant,
            "recent_avg_weight": round(statistics.mean(recent_weights), 1) if recent_weights else 0,
            "num_recent_sessions": len([d for _, _, d in weighted_weights if d <= 21])
        }

    def calculate_rpe_trends(self, exercise_history: List[Dict]) -> Dict[str, Any]:
        """
        Phase 5: Analyze RPE (Rate of Perceived Exertion) to determine progression readiness.

        RPE Scale:
        - 1-3: Very easy
        - 4-6: Moderate effort
        - 7-8: Hard (2-3 RIR)
        - 9: Very hard (1 RIR)
        - 10: Maximum effort (0 RIR)

        Returns: {
            "avg_rpe": average RPE from recent sessions,
            "avg_rir": average RIR (Reps In Reserve),
            "progression_readiness": "high", "medium", or "low",
            "recommendation": guidance string
        }
        """
        if not exercise_history:
            return {}

        recent_rpes = []
        recent_rirs = []

        # Analyze last 5 sessions
        for session in exercise_history[:5]:
            sets = session.get("sets", [])
            if isinstance(sets, list):
                for s in sets:
                    rpe = s.get("rpe")
                    rir = s.get("rir")

                    if rpe is not None:
                        recent_rpes.append(rpe)
                    if rir is not None:
                        recent_rirs.append(rir)

        if not recent_rpes and not recent_rirs:
            return {}  # No RPE/RIR data available

        # Calculate averages
        avg_rpe = statistics.mean(recent_rpes) if recent_rpes else None
        avg_rir = statistics.mean(recent_rirs) if recent_rirs else None

        # Determine progression readiness
        readiness = "medium"  # default
        recommendation = ""

        if avg_rpe is not None:
            if avg_rpe >= 9.0:
                readiness = "low"
                recommendation = "Maintain current weight - user is working too hard (avg RPE: {:.1f}/10)".format(avg_rpe)
            elif avg_rpe <= 7.0:
                readiness = "high"
                recommendation = "Ready for weight increase - user has room to grow (avg RPE: {:.1f}/10)".format(avg_rpe)
            else:
                readiness = "medium"
                recommendation = "Moderate progression - consider small weight increase or rep increase (avg RPE: {:.1f}/10)".format(avg_rpe)
        elif avg_rir is not None:
            if avg_rir >= 3:
                readiness = "high"
                recommendation = "Ready for weight increase - user has {:.1f} reps in reserve".format(avg_rir)
            elif avg_rir <= 1:
                readiness = "low"
                recommendation = "Maintain current weight - user near failure (avg RIR: {:.1f})".format(avg_rir)
            else:
                readiness = "medium"
                recommendation = "Moderate progression possible (avg RIR: {:.1f})".format(avg_rir)

        return {
            "avg_rpe": round(avg_rpe, 1) if avg_rpe is not None else None,
            "avg_rir": round(avg_rir, 1) if avg_rir is not None else None,
            "progression_readiness": readiness,
            "recommendation": recommendation,
            "num_sessions_with_rpe": len(recent_rpes),
            "num_sessions_with_rir": len(recent_rirs)
        }

    def detect_plateau(self, exercise_history: List[Dict], lookback_sessions: int = 6) -> Dict[str, Any]:
        """
        Phase 7: Detect plateau indicators.

        Plateau types:
        - weight_stall: Same max weight for 4+ consecutive sessions
        - volume_stall: Total volume not increasing (< 5% growth)

        Returns: {
            "is_plateaued": bool,
            "plateau_type": "weight_stall" | "volume_stall" | None,
            "plateau_duration": number of sessions,
            "recommendation": guidance string
        }
        """
        if len(exercise_history) < 4:
            return {"is_plateaued": False}  # Need at least 4 sessions to detect

        # Analyze recent sessions (up to lookback_sessions)
        recent_sessions = exercise_history[:lookback_sessions]

        # Track max weight and total volume per session
        session_max_weights = []
        session_volumes = []

        for session in recent_sessions:
            sets = session.get("sets", [])
            if not isinstance(sets, list) or len(sets) == 0:
                continue

            max_weight = 0
            total_volume = 0

            for s in sets:
                weight = s.get("weight", 0) or 0
                reps = s.get("reps", 0) or 0

                if weight > max_weight:
                    max_weight = weight

                if weight > 0 and reps > 0:
                    total_volume += (weight * reps)

            if max_weight > 0:
                session_max_weights.append(max_weight)
            if total_volume > 0:
                session_volumes.append(total_volume)

        if len(session_max_weights) < 4:
            return {"is_plateaued": False}  # Not enough data

        # Check for weight stall (same max weight for 4+ sessions)
        recent_4_weights = session_max_weights[:4]
        if len(set(recent_4_weights)) == 1:  # All same value
            stalled_weight = recent_4_weights[0]
            return {
                "is_plateaued": True,
                "plateau_type": "weight_stall",
                "plateau_duration": len([w for w in session_max_weights if w == stalled_weight]),
                "stalled_weight": stalled_weight,
                "recommendation": f"Stuck at {stalled_weight} lbs for {len(recent_4_weights)} sessions. Try: (1) Increase reps to 12-15 before adding weight, (2) Take a deload week at 70%, or (3) Try tempo/pause variations"
            }

        # Check for volume stall (volume not increasing over time)
        if len(session_volumes) >= 4:
            early_volume = statistics.mean(session_volumes[-4:-2]) if len(session_volumes) >= 4 else 0
            recent_volume = statistics.mean(session_volumes[:2])

            if early_volume > 0:
                volume_change = ((recent_volume - early_volume) / early_volume) * 100

                if volume_change < 5:  # Less than 5% growth
                    return {
                        "is_plateaued": True,
                        "plateau_type": "volume_stall",
                        "plateau_duration": lookback_sessions,
                        "volume_change_pct": round(volume_change, 1),
                        "recommendation": f"Volume stagnant ({volume_change:.1f}% change). Try: (1) Increase total sets, (2) Increase reps per set, or (3) Add drop sets"
                    }

        return {"is_plateaued": False}


