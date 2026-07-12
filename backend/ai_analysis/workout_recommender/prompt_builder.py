"""
Prompt building utilities for workout recommender.
Handles construction of AI prompts for recommendations.
"""

from typing import Dict, List, Any, Optional, Tuple


class PromptBuilder:
    """Handles building prompts for AI recommendations."""

    def __init__(self, recommendation_engine=None, summary_generator=None):
        """Initialize with optional recommendation engine and summary generator."""
        self.recommendation_engine = recommendation_engine
        self.summary_generator = summary_generator

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
        current_workout_exercises: Optional[List[Dict]] = None,
        failed_attempts: Optional[List[Dict]] = None,
        deload_analysis: Optional[Dict] = None
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
        time_weighted = exercise_stats.get("time_weighted_stats", {})

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

                # Phase 2: Add time-weighted context
                if time_weighted:
                    recent_max = time_weighted.get('recent_max_weight', 0)
                    all_time_max = time_weighted.get('all_time_max_weight', 0)
                    days_since_max = time_weighted.get('days_since_all_time_max', 999)
                    is_relevant = time_weighted.get('is_recent_max_relevant', False)

                    prompt += f"""
TIME-WEIGHTED PERFORMANCE ANALYSIS (CRITICAL):
- Recent Max (last 3 weeks): {recent_max} lbs
- All-Time Max: {all_time_max} lbs (achieved {days_since_max} days ago)
- Weighted Average (30-day decay): {time_weighted.get('weighted_avg_weight', 0)} lbs
- Recent Performance Trend: {time_weighted.get('recent_avg_weight', 0)} lbs avg

SAFETY RULE: """
                    if not is_relevant:
                        prompt += f"All-time max is {days_since_max} days old (>60 days). BASE RECOMMENDATIONS ON RECENT MAX ({recent_max} lbs), NOT ALL-TIME MAX."
                    else:
                        prompt += f"All-time max is recent ({days_since_max} days). Can consider for progressive overload."
                    prompt += "\n"
        
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

        # Phase 3: Add failed attempts context
        if failed_attempts and len(failed_attempts) > 0:
            prompt += "\nFAILED ATTEMPTS (CRITICAL - AVOID THESE WEIGHTS):\n"
            for failure in failed_attempts[:5]:  # Show most recent 5 failures
                weight = failure.get("weight", 0)
                reps = failure.get("reps_attempted", 0)
                days_ago = failure.get("days_ago", 0)
                date = failure.get("date", "")
                prompt += f"- {weight} lbs x {reps} reps (failed {days_ago} days ago on {date})\n"
            prompt += "\nCRITICAL: User recently failed at these weights. DO NOT recommend these weights or higher. Recommend 5-10% less to ensure success.\n"

        # Phase 4: Add confidence-based guidance
        if self.recommendation_engine and stats.get("type") != "cardio":
            confidence_level, confidence_score, reasons = self.recommendation_engine._calculate_recommendation_confidence(
                stats=stats,
                recent_data=recent_data,
                failed_attempts=failed_attempts,
                time_weighted_stats=time_weighted
            )

            prompt += f"""
RECOMMENDATION CONFIDENCE: {confidence_level.upper()} (Score: {confidence_score}/100)
Reasons: {', '.join(reasons) if reasons else 'Strong data quality'}

GUIDANCE BASED ON CONFIDENCE:
"""
            if confidence_level == "low":
                prompt += """- VERY CONSERVATIVE: Maintain current weight OR add only 1 rep
- DO NOT increase weight
- Focus on consistency and building confidence
- User needs more data before aggressive progression
"""
            elif confidence_level == "medium":
                prompt += """- CONSERVATIVE: Small weight increases (2.5 lbs max) OR add 1-2 reps
- Prefer rep increases over weight increases
- Avoid large jumps in volume or intensity
"""
            else:
                prompt += """- MODERATE: Can progress with standard increments (2.5-5 lbs)
- Consider rep increases for variety
- User has strong, consistent performance data
"""

        # Phase 5: Add RPE-based progression guidance
        rpe_analysis = exercise_stats.get("rpe_analysis", {})
        if rpe_analysis and stats.get("type") != "cardio":
            avg_rpe = rpe_analysis.get("avg_rpe")
            avg_rir = rpe_analysis.get("avg_rir")
            readiness = rpe_analysis.get("progression_readiness", "medium")
            rpe_rec = rpe_analysis.get("recommendation", "")

            prompt += f"""
RPE/DIFFICULTY ANALYSIS:
- Average RPE (last 5 sessions): {avg_rpe if avg_rpe else 'N/A'}
- Average RIR (Reps In Reserve): {avg_rir if avg_rir else 'N/A'}
- Progression Readiness: {readiness.upper()}
- Analysis: {rpe_rec}

CRITICAL GUIDANCE:
"""
            if readiness == "low":
                prompt += """- User is working TOO HARD - maintain or REDUCE weight
- DO NOT recommend weight increases
- Focus on rep quality and recovery
"""
            elif readiness == "high":
                prompt += """- User has plenty of room - ready for weight increase
- Sets feel too easy - increase weight by 5-10%
- Can handle more challenging loads
"""
            else:
                prompt += """- User is in optimal training zone
- Small progressive increases appropriate
- Balance weight and rep progression
"""

        # Phase 7: Add plateau detection
        plateau_analysis = exercise_stats.get("plateau_analysis", {})
        if plateau_analysis.get("is_plateaued") and stats.get("type") != "cardio":
            plateau_type = plateau_analysis.get("plateau_type")
            duration = plateau_analysis.get("plateau_duration", 0)
            plateau_rec = plateau_analysis.get("recommendation", "")

            prompt += f"""
!!! PLATEAU DETECTED !!!
Type: {plateau_type.replace('_', ' ').title()} ({duration} sessions)
Analysis: {plateau_rec}

CRITICAL INSTRUCTIONS:
"""
            if plateau_type == "weight_stall":
                stalled_weight = plateau_analysis.get("stalled_weight", 0)
                prompt += f"""- DO NOT recommend {stalled_weight} lbs for the same reps again
- MUST break plateau: recommend HIGHER REPS (12-15) at same weight
- OR recommend a DELOAD week (60-70% of {stalled_weight} lbs)
- User needs a different stimulus to progress
"""
            else:
                prompt += """- Volume is not increasing - user needs more total work
- Recommend additional sets OR higher reps
- Consider drop sets or intensity techniques
"""

        # Phase 8: Add deload override if needed (retrieve from exercise_stats if not passed)
        if not deload_analysis:
            deload_analysis = exercise_stats.get("deload_analysis")

        if deload_analysis and deload_analysis.get("needs_deload"):
            urgency = deload_analysis.get("urgency", "medium")
            reduction = deload_analysis.get("recommended_reduction", 0.70)
            reasons = deload_analysis.get("reasons", [])

            prompt += f"""
!!! DELOAD WEEK RECOMMENDED !!!
Urgency: {urgency.upper()}
Reasons:
"""
            for reason in reasons:
                prompt += f"  - {reason}\n"

            prompt += f"""
CRITICAL OVERRIDE - DELOAD PROTOCOL:
- User needs recovery to prevent overtraining
- Recommend {int(reduction * 100)}% of normal working weight
- DO NOT recommend progressive overload this week
- Focus on movement quality and recovery
- Example: If normal is 100 lbs, recommend {int(reduction * 100)} lbs
- Maintain or slightly reduce reps
- This is NOT a sign of weakness - it's strategic recovery

"""

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


