"""
Summary generation for workout recommender.
Handles AI summary creation and prompt building.
"""

import json
from typing import Dict, List, Any
from openai import OpenAI


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


