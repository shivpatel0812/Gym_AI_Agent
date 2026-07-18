"""
Workout AI Recommender - Per-Exercise Progressive Overload Recommendations
Modular structure for analyzing workout history and generating AI-powered recommendations.

Architecture (Phase 1 - Deterministic Progression Engine):
  Router → WorkoutRecommender
    → ProgressionEngine.compute_recommendation() — pure Python, all cases
    → (optional) ReasoningGenerator — LLM writes 1-2 sentence explanation of pre-computed numbers
    → LLM fails: template-based reasoning — numbers are unaffected
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
from .progression_engine import ProgressionEngine
from .reasoning_generator import ReasoningGenerator


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

        # Phase 1: Deterministic progression engine + reasoning generator
        self.progression_engine = ProgressionEngine()
        self.reasoning_generator = ReasoningGenerator(
            openai_client=self.client, model=self.model
        )

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
        plan_notes: Optional[str] = None,
        day_intensity: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get recommendation for a specific exercise using the deterministic progression engine.

        Args:
            exercise_id: The exercise ID
            exercise_name: Name of the exercise
            split_name: Current workout split name
            split_day: Current split day
            position_in_workout: Position of this exercise in current workout (0-indexed)
            current_workout_exercises: Exercises already done in this workout
            plan_target_sets: Target sets from workout plan
            plan_target_reps: Target reps from workout plan
            plan_notes: Notes from workout plan
            day_intensity: "heavy", "light", or "normal"

        Returns:
            Recommendation dict with suggested sets/reps/weight
        """
        # Get recent performance for this exercise
        recent_sessions = self.data_fetcher.get_recent_workout_sessions(30)
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

        # Get user profile for goals
        profile = self.data_fetcher.get_user_profile()
        user_goal = profile.get("primary_goal", "Build Muscle") if profile else "Build Muscle"

        # Determine number of sets (from plan or default)
        num_sets = plan_target_sets or 3

        # Use deterministic progression engine for all cases
        progression_result = self.progression_engine.compute_recommendation(
            exercise_id=exercise_id,
            exercise_name=exercise_name,
            user_goal=user_goal,
            recent_sessions=recent_exercise_data,
            num_sets=num_sets,
            day_intensity=day_intensity,
            heavy_day_weight=None,
        )

        # Generate reasoning text (LLM-optional, template fallback)
        reasoning = self.reasoning_generator.generate_reasoning(
            decision=progression_result.decision,
            reasoning_context=progression_result.reasoning_context,
            exercise_name=exercise_name,
        )

        # Build response in the same shape as before for frontend compatibility
        # Frontend reads: response.data.recommendation.sets as [{set_number, reps, weight}]
        if progression_result.sets:
            recommendation = {
                "sets": [s.to_dict() for s in progression_result.sets],
                "reasoning": reasoning,
                "progression_type": progression_result.decision.value,
                "confidence": progression_result.confidence,
            }
        else:
            # Cardio case
            recommendation = {
                "time": progression_result.time,
                "speed": progression_result.speed,
                "reasoning": reasoning,
                "progression_type": progression_result.decision.value,
                "confidence": progression_result.confidence,
            }

        return {
            "status": "success",
            "recommendation": recommendation,
            "exercise_id": exercise_id,
            "exercise_name": exercise_name,
        }

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
