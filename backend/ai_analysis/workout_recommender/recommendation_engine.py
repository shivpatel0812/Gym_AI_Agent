"""
Recommendation engine for workout recommender.
Handles AI recommendation generation and post-processing.
"""

import json
from typing import Dict, List, Any, Optional, Tuple
from openai import OpenAI
from datetime import datetime
import statistics


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
        current_workout_exercises: Optional[List[Dict]] = None,
        failed_attempts: Optional[List[Dict]] = None
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
            current_workout_exercises=current_workout_exercises,
            failed_attempts=failed_attempts
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
            
            # Calculate confidence for post-processing
            stats = exercise_stats.get("stats", {})
            time_weighted_stats = exercise_stats.get("time_weighted_stats", {})
            confidence_level, confidence_score, confidence_reasons = self._calculate_recommendation_confidence(
                stats=stats,
                recent_data=recent_data,
                failed_attempts=failed_attempts,
                time_weighted_stats=time_weighted_stats
            )

            # Get deload analysis from exercise_stats (passed from WorkoutRecommender)
            deload_analysis = exercise_stats.get("deload_analysis")

            # Post-process recommendations with all safety checks
            recommendation = self._post_process_recommendation(
                recommendation,
                recent_data,
                current_workout_exercises,
                exercise_name,
                failed_attempts,
                time_weighted_stats,
                deload_analysis,
                confidence_level
            )

            # Add confidence to recommendation metadata
            recommendation["confidence"] = confidence_level
            recommendation["confidence_score"] = confidence_score
            recommendation["confidence_reasons"] = confidence_reasons
            
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
        exercise_name: str,
        failed_attempts: Optional[List[Dict]] = None,
        time_weighted_stats: Optional[Dict] = None,
        deload_analysis: Optional[Dict] = None,
        confidence_level: Optional[str] = None
    ) -> Dict:
        """
        Post-process recommendation with cascading safety checks.

        6 Safety Layers (applied in order):
        1. Failed Attempt Filter
        2. Time-Weighted Max Cap
        3. Fatigue Adjustment
        4. Confidence Adjustment
        5. Deload Override
        6. Absolute Safety Cap
        """

        if not recommendation.get("sets") or not isinstance(recommendation["sets"], list):
            return recommendation

        print("\n=== CASCADING SAFETY CHECKS ===")

        # Get recent max weight for reference
        max_recent_weight = 0
        if recent_data:
            latest_session = recent_data[0] if recent_data else None
            if latest_session:
                latest_sets = latest_session.get("sets", [])
                if latest_sets and isinstance(latest_sets, list):
                    latest_weights = [s.get("weight", 0) for s in latest_sets if s.get("weight")]
                    if latest_weights:
                        max_recent_weight = max(latest_weights)

        # LAYER 1: Failed Attempt Filter
        if failed_attempts:
            print("Layer 1: Checking failed attempts...")
            for set_data in recommendation["sets"]:
                recommended_weight = set_data.get("weight", 0)
                if recommended_weight > 0:
                    for failure in failed_attempts:
                        failed_weight = failure.get("weight", 0)
                        days_ago = failure.get("days_ago", 999)

                        if abs(recommended_weight - failed_weight) < 2.5 and days_ago <= 30:
                            original_weight = recommended_weight
                            reduced_weight = recommended_weight * 0.90
                            set_data["weight"] = round(reduced_weight / 2.5) * 2.5
                            print(f"  ✗ Failed attempt filter: {original_weight} → {set_data['weight']} lbs (failed {days_ago} days ago)")

        # LAYER 2: Time-Weighted Max Cap
        if time_weighted_stats:
            print("Layer 2: Checking time-weighted max...")
            recent_max = time_weighted_stats.get("recent_max_weight", 0)
            is_relevant = time_weighted_stats.get("is_recent_max_relevant", True)

            if recent_max > 0 and not is_relevant:
                # All-time max is outdated, cap at recent max + 5 lbs
                for set_data in recommendation["sets"]:
                    recommended_weight = set_data.get("weight", 0)
                    if recommended_weight > recent_max + 5:
                        original_weight = recommended_weight
                        set_data["weight"] = recent_max + 5
                        set_data["weight"] = round(set_data["weight"] / 2.5) * 2.5
                        print(f"  ✗ Time-weighted cap: {original_weight} → {set_data['weight']} lbs (recent max: {recent_max} lbs)")

        # LAYER 3: Fatigue Adjustment
        if current_workout_exercises:
            print("Layer 3: Applying fatigue adjustment...")
            fatigue_multiplier = self._calculate_fatigue_factor(current_workout_exercises, exercise_name)

            if fatigue_multiplier < 1.0:
                for set_data in recommendation["sets"]:
                    recommended_weight = set_data.get("weight", 0)
                    if recommended_weight > 0:
                        original_weight = recommended_weight
                        adjusted_weight = recommended_weight * fatigue_multiplier
                        set_data["weight"] = round(adjusted_weight / 2.5) * 2.5
                        print(f"  ✗ Fatigue reduction: {original_weight} → {set_data['weight']} lbs (multiplier: {fatigue_multiplier:.2f})")

        # LAYER 4: Confidence Adjustment
        if confidence_level == "low":
            print("Layer 4: Applying low confidence adjustment...")
            for set_data in recommendation["sets"]:
                recommended_weight = set_data.get("weight", 0)
                if recommended_weight > max_recent_weight:
                    # Low confidence: don't increase weight at all
                    original_weight = recommended_weight
                    set_data["weight"] = max_recent_weight
                    print(f"  ✗ Low confidence cap: {original_weight} → {set_data['weight']} lbs (maintaining current)")
        elif confidence_level == "medium":
            print("Layer 4: Applying medium confidence adjustment...")
            for set_data in recommendation["sets"]:
                recommended_weight = set_data.get("weight", 0)
                if recommended_weight > max_recent_weight + 2.5:
                    # Medium confidence: max 2.5 lbs increase
                    original_weight = recommended_weight
                    set_data["weight"] = max_recent_weight + 2.5
                    print(f"  ✗ Medium confidence cap: {original_weight} → {set_data['weight']} lbs (max +2.5 lbs)")

        # LAYER 5: Deload Override
        if deload_analysis and deload_analysis.get("needs_deload"):
            print("Layer 5: Applying deload override...")
            reduction = deload_analysis.get("recommended_reduction", 0.70)

            for set_data in recommendation["sets"]:
                recommended_weight = set_data.get("weight", 0)
                if recommended_weight > 0:
                    original_weight = recommended_weight
                    deload_weight = max_recent_weight * reduction if max_recent_weight > 0 else recommended_weight * reduction
                    set_data["weight"] = round(deload_weight / 2.5) * 2.5
                    print(f"  ✗ DELOAD WEEK: {original_weight} → {set_data['weight']} lbs ({int(reduction*100)}% reduction)")

        # LAYER 6: Absolute Safety Cap (final guardrail)
        if max_recent_weight > 0:
            print("Layer 6: Applying absolute safety cap...")
            for set_data in recommendation["sets"]:
                recommended_weight = set_data.get("weight", 0)

                # Never allow >10% increase from last session
                max_allowed = max_recent_weight * 1.10

                # Also enforce standard increments
                max_increase = 2.5 if max_recent_weight < 50 else 5.0
                max_allowed_by_increment = max_recent_weight + max_increase

                # Take the more conservative limit
                absolute_max = min(max_allowed, max_allowed_by_increment)

                if recommended_weight > absolute_max:
                    original_weight = recommended_weight
                    set_data["weight"] = round(absolute_max / 2.5) * 2.5
                    print(f"  ✗ Absolute safety cap: {original_weight} → {set_data['weight']} lbs (max safe: {absolute_max:.1f} lbs)")

        print("=== END SAFETY CHECKS ===\n")

        # Post-process: Ensure sets are ordered by weight descending (heaviest first)
        recommendation["sets"].sort(key=lambda s: s.get("weight", 0), reverse=True)
        # Re-number sets to be sequential starting from 1
        for idx, set_data in enumerate(recommendation["sets"], 1):
            set_data["set_number"] = idx

        return recommendation

    def _calculate_recommendation_confidence(
        self,
        stats: Dict,
        recent_data: List[Dict],
        failed_attempts: Optional[List[Dict]] = None,
        time_weighted_stats: Optional[Dict] = None
    ) -> Tuple[str, int, List[str]]:
        """
        Phase 4: Calculate confidence score for recommendation.

        Returns: (confidence_level, score, reasons)
        - confidence_level: "high", "medium", or "low"
        - score: numerical score (0-100)
        - reasons: list of reasons affecting confidence
        """
        confidence_score = 100
        reasons = []

        # Factor 1: Data quantity
        total_sessions = stats.get("total_sessions", 0)
        if total_sessions < 3:
            confidence_score -= 30
            reasons.append(f"Limited history ({total_sessions} sessions)")
        elif total_sessions < 5:
            confidence_score -= 15
            reasons.append(f"Moderate history ({total_sessions} sessions)")

        # Factor 2: Recency
        if recent_data:
            try:
                last_session_date = recent_data[0].get("date", "")
                last_date = datetime.strptime(last_session_date, "%Y-%m-%d")
                days_since_last = (datetime.now() - last_date).days

                if days_since_last > 21:
                    confidence_score -= 25
                    reasons.append(f"Last session {days_since_last} days ago")
                elif days_since_last > 14:
                    confidence_score -= 15
                    reasons.append(f"Last session {days_since_last} days ago")
            except:
                pass

        # Factor 3: Failed attempts
        if failed_attempts and len(failed_attempts) > 0:
            recent_failures = [f for f in failed_attempts if f.get("days_ago", 999) <= 21]
            if len(recent_failures) > 2:
                confidence_score -= 20
                reasons.append(f"{len(recent_failures)} recent failed attempts")
            elif len(recent_failures) > 0:
                confidence_score -= 10
                reasons.append(f"{len(recent_failures)} recent failed attempt(s)")

        # Factor 4: Performance consistency (coefficient of variation)
        if stats.get("type") != "cardio":
            # Get recent weights to calculate consistency
            recent_weights = []
            for session in recent_data[:5]:  # Last 5 sessions
                sets = session.get("sets", [])
                if isinstance(sets, list):
                    for s in sets:
                        weight = s.get("weight", 0)
                        if weight > 0:
                            recent_weights.append(weight)

            if len(recent_weights) >= 3:
                try:
                    mean_weight = statistics.mean(recent_weights)
                    if mean_weight > 0:
                        stdev_weight = statistics.stdev(recent_weights)
                        coefficient_variation = (stdev_weight / mean_weight) * 100

                        if coefficient_variation > 20:
                            confidence_score -= 15
                            reasons.append(f"Inconsistent performance (CV: {coefficient_variation:.1f}%)")
                except:
                    pass

        # Factor 5: Time-weighted relevance
        if time_weighted_stats and not time_weighted_stats.get("is_recent_max_relevant", True):
            confidence_score -= 10
            reasons.append("All-time max is outdated")

        # Determine confidence level
        if confidence_score >= 75:
            confidence_level = "high"
        elif confidence_score >= 50:
            confidence_level = "medium"
        else:
            confidence_level = "low"

        return confidence_level, confidence_score, reasons

    def _calculate_fatigue_factor(self, current_workout_exercises: List[Dict], exercise_name: str) -> float:
        """
        Phase 6: Calculate fatigue multiplier based on volume of prior exercises.

        Factors:
        - Total volume of similar muscle group exercises (sets × reps × weight)
        - Recency (more recent exercises = more fatigue)
        - Number of similar exercises

        Returns: fatigue_multiplier (0.60-1.0)
        """
        exercise_name_lower = exercise_name.lower()

        # Define muscle group keywords
        muscle_groups = {
            "chest": ["chest", "bench", "press", "fly", "pec", "incline", "decline"],
            "back": ["back", "row", "pull", "lat", "deadlift"],
            "shoulders": ["shoulder", "overhead", "military", "lateral", "delt"],
            "legs": ["squat", "leg", "lunge", "quad", "hamstring", "calf"],
            "arms": ["curl", "tricep", "bicep", "arm"]
        }

        # Identify target muscle group
        target_muscle = None
        for muscle, keywords in muscle_groups.items():
            if any(kw in exercise_name_lower for kw in keywords):
                target_muscle = muscle
                break

        if not target_muscle:
            return 1.0  # No fatigue if can't identify muscle group

        # Calculate total volume from prior exercises in same muscle group
        total_volume = 0
        num_similar_exercises = 0

        for idx, ex in enumerate(current_workout_exercises):
            ex_name = ex.get("exercise_name", "").lower()

            # Check if this exercise targets the same muscle group
            is_similar = any(kw in ex_name for kw in muscle_groups[target_muscle])

            if is_similar:
                num_similar_exercises += 1

                # Calculate volume for this exercise
                sets = ex.get("sets", [])
                if isinstance(sets, list):
                    for s in sets:
                        weight = s.get("weight", 0) or 0
                        reps = s.get("reps", 0) or 0
                        if weight > 0 and reps > 0:
                            # Apply recency weight (more recent = more fatigue)
                            # Position 0 (first exercise) gets weight 1.0, position 1 gets 0.9, etc.
                            recency_weight = 1.0 - (idx * 0.1)
                            recency_weight = max(recency_weight, 0.5)  # Floor at 0.5

                            total_volume += (weight * reps * recency_weight)

        # Calculate fatigue percentage
        # Each 1000 lbs of volume = 5% fatigue, cap at 30%
        fatigue_pct = min(total_volume / 1000 * 0.05, 0.30)

        # Extra penalty for 3+ similar exercises (accumulated fatigue)
        if num_similar_exercises >= 3:
            fatigue_pct += 0.05

        # Calculate multiplier (1.0 = no fatigue, 0.60 = max fatigue)
        fatigue_multiplier = 1.0 - fatigue_pct
        fatigue_multiplier = max(fatigue_multiplier, 0.60)  # Floor at 60%

        if num_similar_exercises > 0:
            print(f"Fatigue calculation for {exercise_name}: {num_similar_exercises} prior similar exercises, {total_volume:.0f} lbs volume, {fatigue_pct:.1%} fatigue, multiplier: {fatigue_multiplier:.2f}")

        return fatigue_multiplier


