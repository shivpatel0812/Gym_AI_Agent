"""
Recommendation engine for workout recommender.
Handles AI recommendation generation and post-processing.
"""

import json
from typing import Dict, List, Any, Optional
from openai import OpenAI


class RecommendationEngine:
    """Handles AI recommendation generation and processing."""
    
    def __init__(self, client: OpenAI, model: str, prompt_builder):
        self.client = client
        self.model = model
        self.prompt_builder = prompt_builder
    
    def generate_recommendation(
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
    ) -> Dict[str, Any]:
        """Generate AI recommendation for an exercise."""
        
        # Build recommendation prompt
        prompt = self.prompt_builder.build_recommendation_prompt(
            exercise_name=exercise_name,
            exercise_stats=exercise_stats,
            recent_data=recent_data,
            ai_summary=ai_summary,
            profile=profile,
            split_name=split_name,
            position_in_workout=position_in_workout,
            max_reps_per_weight=max_reps_per_weight,
            current_workout_exercises=current_workout_exercises
        )
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,  # Use mini model for cheap recommendations
                messages=[
                    {
                        "role": "system",
                        "content": """You are an expert fitness coach providing specific workout recommendations.
Based on the user's history and goals, provide a specific recommendation for their next set of this exercise.

CRITICAL RULE: Sets MUST be ordered by weight in DESCENDING order (heaviest weight first, lightest last).
NEVER recommend starting with a lighter weight and then going heavier - this is incorrect form and dangerous.

Output a JSON object with:
- sets: Array of recommended sets, each with {set_number, reps, weight} (weight in lbs)
  * Sets MUST be ordered by weight descending (heaviest first)
  * Set 1 should always be the heaviest weight
  * Each subsequent set can be the same weight or lighter, NEVER heavier
- reasoning: Brief explanation (1-2 sentences) of why this recommendation
- progression_type: One of "increase_weight", "increase_reps", "maintain", "deload"
- confidence: "high", "medium", or "low" based on available data

For cardio exercises, use:
- time: Recommended time in minutes
- speed: Recommended speed (if applicable)
- reasoning: Brief explanation"""
                    },
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                max_tokens=500,
                response_format={"type": "json_object"}
            )
            
            recommendation = json.loads(response.choices[0].message.content)
            tokens_used = response.usage.total_tokens
            
            # Post-process recommendations
            recommendation = self._post_process_recommendation(
                recommendation,
                recent_data,
                current_workout_exercises,
                exercise_name
            )
            
            return {
                "status": "success",
                "recommendation": recommendation,
                "tokens_used": tokens_used
            }
            
        except Exception as e:
            print(f"Error generating recommendation: {e}")
            return {
                "status": "error",
                "message": str(e),
                "recommendation": None
            }
    
    def _post_process_recommendation(
        self,
        recommendation: Dict,
        recent_data: List[Dict],
        current_workout_exercises: Optional[List[Dict]],
        exercise_name: str
    ) -> Dict:
        """Post-process recommendation to enforce safety rules."""
        
        if not recommendation.get("sets") or not isinstance(recommendation["sets"], list):
            return recommendation
        
        # Post-process: Reduce weights if similar exercises already done in current workout (FATIGUE)
        if current_workout_exercises:
            current_exercise_names = [ex.get("exercise_name", "").lower() for ex in current_workout_exercises if ex.get("exercise_name")]
            exercise_name_lower = exercise_name.lower()
            
            # Check for similar muscle groups (chest, shoulders, etc.)
            is_chest_exercise = any(word in exercise_name_lower for word in ["chest", "bench", "press", "fly", "pec"])
            has_chest_done = any(any(word in name for word in ["chest", "bench", "press", "fly", "pec", "incline", "decline", "flat"]) 
                                 for name in current_exercise_names)
            
            if is_chest_exercise and has_chest_done:
                # Get max weight from already-done chest exercises
                max_chest_weight = 0
                for ex in current_workout_exercises:
                    sets = ex.get("sets", [])
                    if isinstance(sets, list):
                        weights = [s.get("weight", 0) for s in sets if s.get("weight")]
                        if weights:
                            max_chest_weight = max(max_chest_weight, max(weights))
                
                if max_chest_weight > 0:
                    # Reduce recommended weights by 10-15% due to fatigue
                    reduction_factor = 0.85  # 15% reduction
                    for set_data in recommendation["sets"]:
                        recommended_weight = set_data.get("weight", 0)
                        if recommended_weight > 0:
                            # Don't let it exceed the max weight already done (with some buffer)
                            max_allowed = max_chest_weight * reduction_factor
                            if recommended_weight > max_allowed:
                                set_data["weight"] = round(max_allowed / 2.5) * 2.5  # Round to nearest 2.5
                                print(f"Reduced weight from {recommended_weight} to {set_data['weight']} lbs due to fatigue from previous chest exercises")
        
        # Post-process: Enforce conservative weight progression
        if recent_data:
            latest_session = recent_data[0] if recent_data else None
            if latest_session:
                latest_sets = latest_session.get("sets", [])
                if latest_sets and isinstance(latest_sets, list):
                    latest_weights = [s.get("weight", 0) for s in latest_sets if s.get("weight")]
                    if latest_weights:
                        max_recent_weight = max(latest_weights)
                        
                        # Cap weight increases: max 5 lbs increase from recent workout
                        for set_data in recommendation["sets"]:
                            recommended_weight = set_data.get("weight", 0)
                            if recommended_weight > max_recent_weight:
                                # Calculate safe increase (2.5 lbs for <50, 5 lbs for >=50)
                                max_increase = 2.5 if max_recent_weight < 50 else 5.0
                                max_allowed_weight = max_recent_weight + max_increase
                                
                                if recommended_weight > max_allowed_weight:
                                    # Cap it to the maximum allowed increase
                                    set_data["weight"] = max_allowed_weight
                                    print(f"Warning: Capped weight recommendation from {recommended_weight} to {max_allowed_weight} lbs (based on recent max of {max_recent_weight} lbs)")
        
        # Post-process: Ensure sets are ordered by weight descending (heaviest first)
        recommendation["sets"].sort(key=lambda s: s.get("weight", 0), reverse=True)
        # Re-number sets to be sequential starting from 1
        for idx, set_data in enumerate(recommendation["sets"], 1):
            set_data["set_number"] = idx
        
        return recommendation


