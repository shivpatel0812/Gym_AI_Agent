"""
Workout AI Recommender - Per-Exercise Progressive Overload Recommendations
Modular structure for analyzing workout history and generating AI-powered recommendations.
"""

from typing import Dict, List, Any, Optional
from openai import OpenAI

from .data_fetcher import DataFetcher
from .data_processor import DataProcessor
from .storage import StorageManager
from .summary_generator import SummaryGenerator
from .prompt_builder import PromptBuilder
from .recommendation_engine import RecommendationEngine
from .simple_progression import SimpleProgression
from .exercise_order import ExerciseOrder


class WorkoutRecommender:
    """AI-powered workout recommender for progressive overload suggestions."""
    
    def __init__(self, db, user_id: str, api_key: str, model: str = "gpt-4o-mini"):
        """
        Initialize the workout recommender.
        
        Args:
            db: Firestore database client
            user_id: User ID to analyze
            api_key: OpenAI API key
            model: OpenAI model (gpt-4o-mini for cost efficiency on subsequent calls)
        """
        self.db = db
        self.user_id = user_id
        self.client = OpenAI(api_key=api_key)
        self.model = model
        self.SUMMARY_REFRESH_DAYS = 7  # Refresh summary weekly
        
        # Initialize modules
        self.data_fetcher = DataFetcher(db, user_id)
        self.data_processor = DataProcessor()
        self.storage = StorageManager(db, user_id, self.SUMMARY_REFRESH_DAYS)
        self.summary_generator = SummaryGenerator(self.client, self.data_processor)
        # Initialize recommendation engine first, then prompt builder with engine reference
        self.recommendation_engine = RecommendationEngine(self.client, self.model, None)
        self.prompt_builder = PromptBuilder(recommendation_engine=self.recommendation_engine, summary_generator=self.summary_generator)
        self.recommendation_engine.prompt_builder = self.prompt_builder
        self.simple_progression = SimpleProgression()
        self.exercise_order = ExerciseOrder(self.data_fetcher, self)
    
    def get_or_create_summary(self, force_refresh: bool = False) -> Dict:
        """
        Get the existing summary or create a new one if needed.
        
        Args:
            force_refresh: Force regeneration of summary even if not expired
            
        Returns:
            The workout summary dict
        """
        stored_summary = self.data_fetcher.get_stored_summary()
        
        # Check if we have any data
        all_sessions = self.data_fetcher.get_all_workout_sessions()
        
        if len(all_sessions) < 1:
            return {
                "status": "insufficient_data",
                "message": "Need at least 1 workout session for recommendations",
                "sessions_logged": 0,
                "sessions_needed": 1
            }
        
        # Check if refresh is needed
        if not force_refresh and stored_summary and not self.storage.needs_summary_refresh(stored_summary):
            # Update with recent sessions for context
            recent_sessions = self.data_fetcher.get_recent_workout_sessions(14)
            stored_summary["recent_sessions"] = recent_sessions
            return stored_summary
        
        # Generate new summary
        profile = self.data_fetcher.get_user_profile()
        exercise_history = self.data_processor.build_exercise_history(all_sessions)
        split_patterns = self.data_processor.build_split_patterns(all_sessions)
        
        summary = self.summary_generator.generate_full_summary(
            all_sessions, 
            profile, 
            exercise_history, 
            split_patterns
        )
        summary["status"] = "success"
        
        # Store the summary
        self.storage.store_summary(summary)
        
        return summary
    
    def get_exercise_recommendation(
        self,
        exercise_id: str,
        exercise_name: str,
        split_name: Optional[str] = None,
        split_day: Optional[str] = None,
        position_in_workout: Optional[int] = None,
        current_workout_exercises: Optional[List[Dict]] = None,
        plan_target_sets: Optional[int] = None,
        plan_target_reps: Optional[int] = None,
        plan_notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get AI recommendation for a specific exercise.
        
        Args:
            exercise_id: The exercise ID
            exercise_name: Name of the exercise
            split_name: Current workout split name
            split_day: Current split day
            position_in_workout: Position of this exercise in current workout (0-indexed)
            current_workout_exercises: Exercises already done in this workout
            
        Returns:
            Recommendation dict with suggested sets/reps/weight
        """
        # Get recent performance for this exercise
        recent_sessions = self.data_fetcher.get_recent_workout_sessions(30)  # Look back 30 days
        recent_exercise_data = []
        
        for session in recent_sessions:
            for ex in session.get("exercises", []):
                if ex.get("exercise_id") == exercise_id:
                    recent_exercise_data.append({
                        "date": session.get("date"),
                        "sets": ex.get("sets", []),
                        "time": ex.get("time"),
                        "speed": ex.get("speed")
                    })
        
        # If we have at least 1 previous session, use simple progression
        if len(recent_exercise_data) >= 1:
            # Use simple progression for 1-2 sessions, AI for 3+
            if len(recent_exercise_data) < 3:
                return self.simple_progression.get_simple_progression_recommendation(
                    exercise_id=exercise_id,
                    exercise_name=exercise_name,
                    recent_data=recent_exercise_data
                )
        
        # For 3+ sessions, use full AI summary approach
        summary = self.get_or_create_summary()
        
        if summary.get("status") == "insufficient_data":
            # Fallback to simple progression even if summary fails
            if recent_exercise_data:
                return self.simple_progression.get_simple_progression_recommendation(
                    exercise_id=exercise_id,
                    exercise_name=exercise_name,
                    recent_data=recent_exercise_data
                )
            return {
                "status": "insufficient_data",
                "message": summary.get("message"),
                "recommendation": None
            }
        
        # Get exercise-specific history from summary
        exercise_stats = summary.get("exercise_stats", {}).get(exercise_id, {})
        ai_summary = summary.get("ai_summary", {})

        # Get full exercise history for advanced analysis
        all_sessions = self.data_fetcher.get_all_workout_sessions()
        exercise_history = self.data_processor.build_exercise_history(all_sessions)
        exercise_specific_history = exercise_history.get(exercise_id, [])

        # Phase 2: Calculate time-weighted stats
        time_weighted_stats = self.data_processor.calculate_time_weighted_stats(exercise_specific_history)

        # Phase 3: Get failed attempts
        failed_attempts = self.data_fetcher.get_failed_attempts(exercise_id, lookback_days=60)

        # Phase 5: Calculate RPE trends
        rpe_analysis = self.data_processor.calculate_rpe_trends(exercise_specific_history)

        # Phase 7: Detect plateau
        plateau_analysis = self.data_processor.detect_plateau(exercise_specific_history, lookback_sessions=6)

        # Phase 8: Detect deload need (for entire user, not just this exercise)
        deload_analysis = self.summary_generator.detect_deload_need(all_sessions, exercise_history)

        # Add enhanced analysis to exercise_stats
        exercise_stats["time_weighted_stats"] = time_weighted_stats
        exercise_stats["rpe_analysis"] = rpe_analysis
        exercise_stats["plateau_analysis"] = plateau_analysis
        exercise_stats["deload_analysis"] = deload_analysis

        # Calculate max reps at each weight (all-time historical data)
        max_reps_per_weight = self.data_fetcher.calculate_max_reps_per_weight(exercise_id)

        # Get user profile for goals
        profile = self.data_fetcher.get_user_profile()

        # Generate recommendation with all enhanced context
        result = self.recommendation_engine.generate_recommendation(
            exercise_name=exercise_name,
            exercise_stats=exercise_stats,
            recent_data=recent_exercise_data,
            ai_summary=ai_summary,
            profile=profile,
            split_name=split_name,
            position_in_workout=position_in_workout,
            max_reps_per_weight=max_reps_per_weight,
            current_workout_exercises=current_workout_exercises,
            failed_attempts=failed_attempts,
            plan_target_sets=plan_target_sets,
            plan_target_reps=plan_target_reps,
            plan_notes=plan_notes
        )
        
        if result["status"] == "error":
            # Fallback to simple progression if AI fails
            if recent_exercise_data:
                return self.simple_progression.get_simple_progression_recommendation(
                    exercise_id=exercise_id,
                    exercise_name=exercise_name,
                    recent_data=recent_exercise_data
                )
        
        # Add exercise metadata
        result["exercise_id"] = exercise_id
        result["exercise_name"] = exercise_name
        
        return result
    
    def get_suggested_exercise_order(self, split_name: str, split_day: str = "") -> List[str]:
        """
        Get the suggested exercise order for a split based on historical patterns.
        
        Args:
            split_name: The workout split name (e.g., "Push", "Pull", "Legs")
            split_day: The specific day within the split
            
        Returns:
            List of exercise IDs in suggested order
        """
        return self.exercise_order.get_suggested_exercise_order(split_name, split_day)


