"""
Summary generation for workout recommender.
Handles AI summary creation and prompt building.
"""

import json
from typing import Dict, List, Any
from openai import OpenAI
from datetime import datetime, timedelta
import statistics


class SummaryGenerator:
    """Handles workout summary generation using AI."""
    
    def __init__(self, client: OpenAI, data_processor):
        self.client = client
        self.data_processor = data_processor
    
    def generate_full_summary(self, sessions: List[Dict], profile: Dict, exercise_history: Dict, split_patterns: Dict) -> Dict:
        """
        Generate comprehensive workout summary using GPT (expensive first call).
        This creates the contextualized summary for future recommendations.
        """
        # Build exercise stats
        exercise_stats = {}
        for ex_id, history in exercise_history.items():
            if history:
                exercise_stats[ex_id] = {
                    "name": history[0].get("exercise_name", ""),
                    "stats": self.data_processor.calculate_exercise_stats(history),
                    "last_5_sessions": history[:5]  # Keep recent data for context
                }
        
        # Build prompt for GPT to create a contextualized summary
        prompt = self.build_summary_prompt(exercise_stats, split_patterns, profile, len(sessions))
        
        try:
            response = self.client.chat.completions.create(
                model="gpt-4o",  # Use full model for initial summary
                messages=[
                    {
                        "role": "system",
                        "content": """You are an expert fitness coach analyzing a user's complete workout history.
Create a comprehensive but concise summary that will be used to generate future workout recommendations.
Focus on:
1. Training patterns and preferences (what exercises they do, how often)
2. Current strength levels for each major exercise
3. Progression patterns (are they improving, plateauing?)
4. Any imbalances or areas needing attention
5. Their apparent goals based on exercise selection

Output a JSON object with these keys:
- training_style: Brief description of their training approach
- strength_levels: Object mapping exercise names to estimated 1RM or working weight ranges
- progression_status: Overall progression assessment
- focus_areas: Array of areas to prioritize
- recommendations_context: Any context that should inform future per-exercise recommendations"""
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=2000,
                response_format={"type": "json_object"}
            )
            
            ai_summary = json.loads(response.choices[0].message.content)
            tokens_used = response.usage.total_tokens
            
        except Exception as e:
            print(f"Error generating AI summary: {e}")
            ai_summary = {
                "training_style": "Unable to analyze",
                "strength_levels": {},
                "progression_status": "unknown",
                "focus_areas": [],
                "recommendations_context": ""
            }
            tokens_used = 0
        
        return {
            "ai_summary": ai_summary,
            "exercise_stats": exercise_stats,
            "split_patterns": split_patterns,
            "total_sessions_analyzed": len(sessions),
            "tokens_used_for_summary": tokens_used,
            "generated_with_model": "gpt-4o"
        }
    
    def build_summary_prompt(self, exercise_stats: Dict, split_patterns: Dict, profile: Dict, total_sessions: int) -> str:
        """Build the prompt for generating the workout summary."""
        
        # Get user goals
        primary_goal = profile.get("primary_goal", "general fitness")
        experience_level = profile.get("experience_level", "intermediate")
        
        prompt = f"""Analyze this user's workout history:

USER PROFILE:
- Primary Goal: {primary_goal}
- Experience Level: {experience_level}
- Total Workouts Logged: {total_sessions}

EXERCISE PERFORMANCE DATA:
"""
        
        # Add top exercises by frequency
        sorted_exercises = sorted(
            exercise_stats.items(), 
            key=lambda x: x[1]["stats"].get("total_sessions", 0), 
            reverse=True
        )[:20]  # Top 20 most frequent exercises
        
        for ex_id, data in sorted_exercises:
            stats = data["stats"]
            name = data["name"]
            
            if stats.get("type") == "cardio":
                prompt += f"""
{name}:
  - Sessions: {stats.get('total_sessions', 0)}
  - Avg Time: {stats.get('avg_time', 0)} min
  - Max Time: {stats.get('max_time', 0)} min
  - Speed Trend: {stats.get('trend', 'stable')}
"""
            else:
                prompt += f"""
{name}:
  - Sessions: {stats.get('total_sessions', 0)}
  - Avg Weight: {stats.get('avg_weight', 0)} lbs
  - Max Weight: {stats.get('max_weight', 0)} lbs
  - Avg Reps: {stats.get('avg_reps', 0)}
  - Weight Trend: {stats.get('weight_trend', 'stable')}
"""
        
        prompt += f"""
SPLIT PATTERNS:
{json.dumps(split_patterns, indent=2)}

Create a comprehensive training summary for this user."""
        
        return prompt

    def detect_deload_need(self, all_sessions: List[Dict], exercise_history: Dict) -> Dict[str, Any]:
        """
        Phase 8: Detect if user needs a deload week.

        Deload indicators:
        - Volume increased >25% over 3-4 weeks
        - Average RPE >= 8.5 (working too hard)
        - Completion rate declining >10%
        - 4+ weeks without deload

        Returns: {
            "needs_deload": bool,
            "urgency": "low"|"medium"|"high",
            "recommended_reduction": 0.60-0.80,
            "reasons": list of reasons
        }
        """
        if len(all_sessions) < 8:
            return {"needs_deload": False}  # Need at least 8 sessions for analysis

        # Sort sessions by date
        sorted_sessions = sorted(all_sessions, key=lambda x: x.get("date", ""), reverse=True)

        # Get sessions from last 4 weeks
        now = datetime.now()
        cutoff_4_weeks = (now - timedelta(days=28)).strftime('%Y-%m-%d')

        recent_sessions = [s for s in sorted_sessions if s.get("date", "") >= cutoff_4_weeks]

        if len(recent_sessions) < 4:
            return {"needs_deload": False}  # Not enough recent data

        # Calculate indicators
        deload_indicators = 0
        reasons = []

        # 1. Calculate weekly volumes
        weekly_volumes = self._calculate_weekly_volumes(recent_sessions)

        if len(weekly_volumes) >= 3:
            early_avg = statistics.mean(weekly_volumes[-2:]) if len(weekly_volumes) >= 2 else 0
            recent_avg = statistics.mean(weekly_volumes[:2])

            if early_avg > 0:
                volume_change = ((recent_avg - early_avg) / early_avg) * 100

                if volume_change > 25:
                    deload_indicators += 2
                    reasons.append(f"Volume increased {volume_change:.1f}% over 3-4 weeks")

        # 2. Calculate average RPE
        all_rpes = []
        for session in recent_sessions:
            for ex in session.get("exercises", []):
                sets = ex.get("sets", [])
                if isinstance(sets, list):
                    for s in sets:
                        rpe = s.get("rpe")
                        if rpe is not None:
                            all_rpes.append(rpe)

        if len(all_rpes) >= 10:  # Need sufficient RPE data
            avg_rpe = statistics.mean(all_rpes)
            if avg_rpe >= 8.5:
                deload_indicators += 2
                reasons.append(f"High average RPE: {avg_rpe:.1f}/10")

        # 3. Calculate completion rate
        total_sets = 0
        completed_sets = 0

        for session in recent_sessions:
            for ex in session.get("exercises", []):
                sets = ex.get("sets", [])
                if isinstance(sets, list):
                    for s in sets:
                        total_sets += 1
                        # If completed is not explicitly False, assume True (backward compatibility)
                        if s.get("completed", True) is True:
                            completed_sets += 1

        if total_sets >= 20:  # Need sufficient data
            completion_rate = (completed_sets / total_sets) * 100

            # Compare to earlier completion rate
            earlier_sessions = sorted_sessions[len(recent_sessions):len(recent_sessions)*2]
            earlier_total = 0
            earlier_completed = 0

            for session in earlier_sessions:
                for ex in session.get("exercises", []):
                    sets = ex.get("sets", [])
                    if isinstance(sets, list):
                        for s in sets:
                            earlier_total += 1
                            if s.get("completed", True) is True:
                                earlier_completed += 1

            if earlier_total >= 20:
                earlier_completion_rate = (earlier_completed / earlier_total) * 100
                completion_decline = earlier_completion_rate - completion_rate

                if completion_decline > 10:
                    deload_indicators += 1
                    reasons.append(f"Completion rate declined {completion_decline:.1f}%")

        # 4. Check time since last deload (simplified - look for low volume weeks)
        # This is a simple heuristic - in production, you'd track deloads explicitly
        if len(weekly_volumes) >= 4:
            recent_avg_volume = statistics.mean(weekly_volumes[:4])
            # If no week in recent 4 had < 70% of average, might need deload
            had_deload = any(vol < recent_avg_volume * 0.7 for vol in weekly_volumes[:4])

            if not had_deload:
                deload_indicators += 1
                reasons.append("No deload week in last 4 weeks")

        # Determine deload need and urgency
        if deload_indicators >= 4:
            urgency = "high"
            reduction = 0.60
        elif deload_indicators >= 3:
            urgency = "medium"
            reduction = 0.70
        elif deload_indicators >= 2:
            urgency = "low"
            reduction = 0.80
        else:
            return {"needs_deload": False}

        return {
            "needs_deload": True,
            "urgency": urgency,
            "recommended_reduction": reduction,
            "reasons": reasons,
            "deload_indicators": deload_indicators
        }

    def _calculate_weekly_volumes(self, sessions: List[Dict]) -> List[float]:
        """Calculate total volume for each week."""
        # Group sessions by week
        weekly_data = {}

        for session in sessions:
            session_date = session.get("date", "")
            try:
                date_obj = datetime.strptime(session_date, "%Y-%m-%d")
                # Get week number (ISO week)
                week_key = date_obj.strftime("%Y-W%U")

                if week_key not in weekly_data:
                    weekly_data[week_key] = 0

                # Calculate total volume for this session
                for ex in session.get("exercises", []):
                    sets = ex.get("sets", [])
                    if isinstance(sets, list):
                        for s in sets:
                            weight = s.get("weight", 0) or 0
                            reps = s.get("reps", 0) or 0
                            if weight > 0 and reps > 0:
                                weekly_data[week_key] += (weight * reps)
            except:
                continue

        # Return volumes sorted by week (most recent first)
        sorted_weeks = sorted(weekly_data.keys(), reverse=True)
        return [weekly_data[week] for week in sorted_weeks]


