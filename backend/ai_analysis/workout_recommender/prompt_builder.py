"""
Prompt building utilities for workout recommender.
Handles construction of AI prompts for recommendations.
"""

from typing import Dict, List, Any, Optional


class PromptBuilder:
    """Handles building prompts for AI recommendations."""
    
    def build_recommendation_prompt(
        self,
        exercise_name: str,
        exercise_stats: Dict,
        recent_data: List[Dict],
        ai_summary: Dict,
        profile: Dict,
        split_name: Optional[str],
        position_in_workout: Optional[int],
        max_reps_per_weight: Optional[Dict[float, int]] = None,
        current_workout_exercises: Optional[List[Dict]] = None
    ) -> str:
        """Build prompt for per-exercise recommendation."""
        
        primary_goal = profile.get("primary_goal", "general fitness")
        experience = profile.get("experience_level", "intermediate")
        
        prompt = f"""Generate a workout recommendation for: {exercise_name}

USER CONTEXT:
- Goal: {primary_goal}
- Experience: {experience}
- Training Style: {ai_summary.get('training_style', 'unknown')}
- Overall Progression: {ai_summary.get('progression_status', 'unknown')}
"""
        
        if split_name:
            prompt += f"- Current Workout: {split_name}"
            if position_in_workout is not None:
                prompt += f" (Exercise #{position_in_workout + 1} in session)"
            prompt += "\n"
        
        stats = exercise_stats.get("stats", {})
        if stats:
            if stats.get("type") == "cardio":
                prompt += f"""
EXERCISE HISTORY (Cardio):
- Total Sessions: {stats.get('total_sessions', 0)}
- Average Time: {stats.get('avg_time', 0)} min
- Best Time: {stats.get('max_time', 0)} min
- Average Speed: {stats.get('avg_speed', 0)} mph
- Trend: {stats.get('trend', 'stable')}
"""
            else:
                prompt += f"""
EXERCISE HISTORY:
- Total Sessions: {stats.get('total_sessions', 0)}
- Average Weight: {stats.get('avg_weight', 0)} lbs
- Max Weight: {stats.get('max_weight', 0)} lbs
- Average Reps: {stats.get('avg_reps', 0)}
- Weight Trend: {stats.get('weight_trend', 'stable')}
"""
        
        if recent_data:
            prompt += "\nRECENT PERFORMANCE (last 2 weeks):\n"
            for data in recent_data[:3]:  # Last 3 sessions
                prompt += f"- {data.get('date')}: "
                if data.get("time") is not None:
                    prompt += f"{data.get('time')} min"
                    if data.get("speed"):
                        prompt += f" @ {data.get('speed')} mph"
                else:
                    sets = data.get("sets", [])
                    if sets:
                        # Format sets more clearly to avoid AI misinterpretation
                        set_strs = []
                        for idx, s in enumerate(sets[:4], 1):
                            reps = s.get('reps', 0)
                            weight = s.get('weight', 0)
                            set_strs.append(f"Set {idx}: {reps} reps @ {weight} lbs")
                        prompt += f"{len(sets)} sets - " + ", ".join(set_strs)
                prompt += "\n"
        
        # Add max reps per weight data for conservative recommendations
        if max_reps_per_weight and stats.get("type") != "cardio":
            prompt += "\nALL-TIME MAX REPS AT EACH WEIGHT (CRITICAL - DO NOT EXCEED BY MORE THAN 1-2 REPS):\n"
            # Sort by weight descending for clarity
            sorted_weights = sorted(max_reps_per_weight.keys(), reverse=True)
            for weight in sorted_weights[:10]:  # Show top 10 most relevant weights
                max_reps = max_reps_per_weight[weight]
                prompt += f"- {weight} lbs: Max {max_reps} reps\n"
            prompt += "\nIMPORTANT: If recommending a weight where the user's all-time max reps is X, do NOT recommend more than X+1 or X+2 reps. Be conservative with progression.\n"
        
        # Add current workout exercises context (fatigue consideration)
        if current_workout_exercises and len(current_workout_exercises) > 0:
            prompt += "\nCURRENT WORKOUT - EXERCISES ALREADY DONE (CRITICAL - USER IS FATIGUED):\n"
            for ex in current_workout_exercises:
                ex_name = ex.get("exercise_name", ex.get("exercise_id", "Unknown"))
                sets = ex.get("sets", [])
                if sets and isinstance(sets, list):
                    # Get heaviest weight from this exercise
                    weights = [s.get("weight", 0) for s in sets if s.get("weight")]
                    if weights:
                        max_weight = max(weights)
                        prompt += f"- {ex_name}: {max_weight} lbs (heaviest set)\n"
                else:
                    prompt += f"- {ex_name}: (already completed)\n"
            prompt += "\nIMPORTANT: The user has already done these exercises in this workout session. "
            prompt += "They are fatigued and CANNOT lift the same weight they could if this was their first exercise. "
            prompt += "For similar muscle groups (e.g., chest exercises), reduce recommended weight by 10-20% from what you would normally recommend. "
            prompt += "If they did Incline Dumbbell Press at 80 lbs, they CANNOT do Flat Dumbbell Press at 80 lbs - reduce to 70-75 lbs maximum.\n"
        
        prompt += """
Provide a specific recommendation for their next workout. Consider:
1. Progressive overload principles (SMALL increments)
2. Their current fitness level and recent performance
3. Position in workout (earlier = heavier, later = lighter/higher rep)
4. Their stated goals
5. ALL-TIME MAX REPS at each weight - DO NOT recommend more than 1-2 reps above their historical max at that specific weight

CRITICAL WEIGHT PROGRESSION RULES:
- Base recommendations on RECENT performance, NOT all-time max weight
- Maximum weight increase: 2.5-5 lbs from the last workout's heaviest weight
- If last workout was 70 lbs, do NOT jump to 80 lbs - recommend 72.5-75 lbs maximum
- Only increase weight if the user has successfully completed the previous weight for multiple sessions
- Weight increases should be gradual: 2.5 lbs for lighter weights (<50 lbs), 5 lbs for heavier weights (≥50 lbs)
- If increasing weight, reduce reps by 1-2 to maintain form and safety

CRITICAL: Sets MUST be ordered by weight in DESCENDING order:
- Set 1: Heaviest weight (your main working weight)
- Set 2+: Same weight or lighter (for higher reps or volume)
- NEVER start with a lighter weight and go heavier - this is incorrect and dangerous

Be specific with numbers (exact weight, reps, sets). Be conservative - it's better to slightly under-recommend than to over-recommend."""
        
        return prompt


