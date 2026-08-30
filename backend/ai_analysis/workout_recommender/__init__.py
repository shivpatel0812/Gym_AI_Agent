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
from .training_focus import TrainingFocusStore
from .plan_context import PlanContextResolver, PlanContext
from .readiness_context import ReadinessResolver, ReadinessContext
from .weight_estimator import days_since_session, infer_top_lifts_from_related_history
from .exercise_metadata import resolve_exercise_metadata
from .personalization import learn_position_factor, apply_position_factor


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
        # Per-exercise goal overrides (e.g. strength emphasis on bench)
        self.focus_store = TrainingFocusStore(db, user_id)
        # Single place that resolves Active Plan intent for an exercise
        self.plan_resolver = PlanContextResolver(db, user_id, self.focus_store)
        # Single place that resolves how recovered the user is. Reads one
        # cached document; neutral whenever that document is missing or stale.
        self.readiness_resolver = ReadinessResolver(db, user_id)

    def _normalize_exercise_sets(self, ex: Dict) -> List[Dict]:
        sets = ex.get("sets")
        if isinstance(sets, list) and sets:
            normalized = []
            for i, raw in enumerate(sets):
                if not isinstance(raw, dict):
                    continue
                normalized.append({
                    "set_number": raw.get("set_number") or i + 1,
                    "reps": raw.get("reps") or 0,
                    "weight": raw.get("weight"),
                    "rpe": raw.get("rpe"),
                    "completed": raw.get("completed"),
                    "difficulty": raw.get("difficulty"),
                })
            return normalized
        if ex.get("reps") or ex.get("weight"):
            return [{
                "set_number": 1,
                "reps": ex.get("reps") or 0,
                "weight": ex.get("weight"),
            }]
        return []

    def _get_exercise_history(
        self,
        exercise_id: str,
        days: Optional[int] = 30,
        exclude_session_id: Optional[str] = None,
    ) -> List[Dict]:
        """Extract per-exercise session data, newest first. Skip empty drafts."""
        if days is None:
            sessions = self.data_fetcher.get_all_workout_sessions()
        else:
            sessions = self.data_fetcher.get_recent_workout_sessions(days)
        result = []
        for session in sessions:
            if exclude_session_id and session.get("id") == exclude_session_id:
                continue
            for ex in session.get("exercises", []):
                if ex.get("exercise_id") != exercise_id:
                    continue
                sets = [
                    s
                    for s in self._normalize_exercise_sets(ex)
                    if (s.get("reps") or 0) > 0 and (s.get("weight") or 0) > 0
                ]
                if not sets and not ex.get("time") and not ex.get("speed"):
                    continue
                result.append({
                    "date": session.get("date"),
                    "sets": sets or self._normalize_exercise_sets(ex),
                    "time": ex.get("time"),
                    "speed": ex.get("speed"),
                })
        result.sort(key=lambda item: item.get("date") or "", reverse=True)
        return result

    @staticmethod
    def _last_session_summary(session: Optional[Dict]) -> Optional[Dict]:
        """
        The session this recommendation is a response to, trimmed for display.

        Returns None rather than an empty shell when there is nothing to show,
        so the client can simply test for the key.
        """
        if not session:
            return None

        sets = [
            {
                "set_number": s.get("set_number") or i + 1,
                "reps": s.get("reps"),
                "weight": s.get("weight"),
            }
            for i, s in enumerate(session.get("sets") or [])
            if (s.get("reps") or 0) > 0
        ]
        if not sets and session.get("time") is None:
            return None

        summary = {"date": session.get("date"), "sets": sets}
        if session.get("time") is not None:
            summary["time"] = session.get("time")
        if session.get("speed") is not None:
            summary["speed"] = session.get("speed")

        days = days_since_session(session.get("date"))
        if days is not None:
            summary["days_ago"] = days
        return summary

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
        day_intensity: Optional[str] = None,
        exclude_session_id: Optional[str] = None,
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
        # Progress only from the last 30 days. Older sessions are a comeback estimate.
        recent_exercise_data = self._get_exercise_history(
            exercise_id, days=30, exclude_session_id=exclude_session_id
        )
        stale_last_session = None
        if not recent_exercise_data:
            all_history = self._get_exercise_history(
                exercise_id, days=None, exclude_session_id=exclude_session_id
            )
            stale_last_session = all_history[0] if all_history else None

        # Get user profile for goals
        profile = self.data_fetcher.get_user_profile()
        user_goal = profile.get("primary_goal", "Build Muscle") if profile else "Build Muscle"

        # Determine number of sets (from plan or default)
        num_sets = plan_target_sets or 3

        # Custom exercises are stored below the authenticated user's document.
        # Seeded default exercises are not Firestore documents and safely fall
        # through to the deterministic catalog/name resolver.
        exercise_record = None
        try:
            ex_doc = (
                self.db.collection("users")
                .document(self.user_id)
                .collection("exercises")
                .document(exercise_id)
                .get()
            )
            if ex_doc.exists:
                exercise_record = ex_doc.to_dict()
        except Exception:
            pass  # Not critical — will fall back to name inference

        # Resolve Active Plan intent server-side, so recommendations follow the
        # plan whether or not the client passed any plan context.
        plan_context = self.plan_resolver.resolve(
            exercise_id=exercise_id,
            exercise_name=exercise_name,
            split_day=split_day,
            profile_goal=user_goal,
        )

        # An explicit request value always wins over the resolved plan; the
        # plan fills in whatever the caller left unspecified.
        if plan_target_sets is None and plan_context.target_sets:
            num_sets = plan_context.target_sets
        if day_intensity is None:
            day_intensity = plan_context.day_intensity

        readiness = self.readiness_resolver.resolve()

        top_lifts = profile.get("top_lifts") if profile else None
        all_sessions = self.data_fetcher.get_all_workout_sessions()
        try:
            exercise_records = self.data_fetcher.get_exercise_records()
        except Exception:
            exercise_records = {}
        related_lift_context = None
        if not recent_exercise_data and not stale_last_session:
            related_lift_context = infer_top_lifts_from_related_history(
                exercise_id,
                exercise_name,
                all_sessions,
                exercise_records=exercise_records,
            )
            if related_lift_context:
                top_lifts = related_lift_context

        # Use deterministic progression engine for all cases
        progression_result = self.progression_engine.compute_recommendation(
            exercise_id=exercise_id,
            exercise_name=exercise_name,
            user_goal=user_goal,
            focus_goal=plan_context.goal,
            rep_range_override=plan_context.target_rep_range,
            recent_sessions=recent_exercise_data,
            num_sets=num_sets,
            day_intensity=day_intensity,
            heavy_day_weight=None,
            exercise_record=exercise_record,
            top_lifts=top_lifts,
            stale_last_session=stale_last_session,
            readiness=readiness,
        )
        position_context = learn_position_factor(
            all_sessions,
            exercise_id,
            exercise_name,
            position_in_workout,
            exercise_records,
        )
        metadata = resolve_exercise_metadata(exercise_id, exercise_name, exercise_record)
        progression_result = apply_position_factor(
            progression_result, position_context, metadata.min_increment_lb
        )
        if related_lift_context and progression_result.reasoning_context.get("estimated_from_top_lifts"):
            progression_result.reasoning_context.update({
                "estimated_from_related_exercises": True,
                "related_sample_count": related_lift_context.get("sample_count", 0),
            })
            if progression_result.sets:
                progression_result.sets[0].reps = 6
                progression_result.sets[0].rep_low = 6
                progression_result.sets[0].rep_high = 6
                progression_result.sets[0].role = "calibration"

        # Generate reasoning text (LLM-optional, template fallback)
        reasoning = self.reasoning_generator.generate_reasoning(
            decision=progression_result.decision,
            reasoning_context=progression_result.reasoning_context,
            exercise_name=exercise_name,
        )
        if position_context.get("source") == "personal_position_history":
            reduction = round((1.0 - position_context["factor"]) * 100)
            reasoning = (
                f"{reasoning} Your history shows about {reduction}% less capacity at this "
                "workout position, so the load is adjusted for fatigue."
            )

        # Build response in the same shape as before for frontend compatibility
        # Frontend reads: response.data.recommendation.sets as [{set_number, reps, weight}]
        from .progression_engine import Decision

        if progression_result.decision == Decision.NEEDS_STARTING_WEIGHT:
            # Special status: frontend should render an input prompt, not "0 lbs"
            recommendation = {
                "sets": [s.to_dict() for s in progression_result.sets],
                "reasoning": reasoning,
                "progression_type": progression_result.decision.value,
                "confidence": progression_result.confidence,
                "needs_starting_weight": True,
                "suggested_reps": progression_result.reasoning_context.get("suggested_reps"),
                "suggested_sets": progression_result.reasoning_context.get("suggested_sets"),
                "rep_range": progression_result.reasoning_context.get("rep_range"),
            }
        elif progression_result.sets:
            recommendation = {
                "sets": [s.to_dict() for s in progression_result.sets],
                "reasoning": reasoning,
                "progression_type": progression_result.decision.value,
                "confidence": progression_result.confidence,
            }
            if progression_result.strategy:
                recommendation["strategy"] = progression_result.strategy
            if progression_result.branch:
                recommendation["branch"] = progression_result.branch.to_dict()
            rep_range = progression_result.reasoning_context.get("rep_range")
            if rep_range:
                recommendation["rep_range"] = list(rep_range)
            if progression_result.reasoning_context.get("estimated_from_top_lifts"):
                recommendation["estimated_from_top_lifts"] = True
            if progression_result.reasoning_context.get("estimated_from_related_exercises"):
                recommendation["estimated_from_related_exercises"] = True
                recommendation["calibration_required"] = True
            if progression_result.reasoning_context.get("estimated_from_stale_history"):
                recommendation["estimated_from_stale_history"] = True
        else:
            # Cardio case
            recommendation = {
                "time": progression_result.time,
                "speed": progression_result.speed,
                "reasoning": reasoning,
                "progression_type": progression_result.decision.value,
                "confidence": progression_result.confidence,
            }

        # Flag implausible data in response
        if progression_result.reasoning_context.get("has_implausible_data"):
            recommendation["has_implausible_data"] = True

        # What the recommendation is measured against. A prescription shown on
        # its own is a number with no reference point; the session it is a
        # response to belongs next to it.
        last_session = self._last_session_summary(
            recent_exercise_data[0] if recent_exercise_data else stale_last_session
        )
        if last_session:
            recommendation["last_session"] = last_session

        # Surface the resolved intent so the UI can explain why the target
        # rep range or intensity looks the way it does
        if plan_context.source != "default":
            recommendation["plan_context"] = plan_context.to_dict()

        # Same for capacity, but only when it actually had something to say.
        if readiness.usable:
            recommendation["readiness_context"] = readiness.to_dict()
        if position_context.get("source") == "personal_position_history":
            recommendation["position_context"] = position_context

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
