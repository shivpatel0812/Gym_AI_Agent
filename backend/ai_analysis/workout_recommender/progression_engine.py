"""
Deterministic Workout Progression Engine.

Pure-Python double progression logic. No LLM calls.
Given exercise history + user goal, computes exact weight/reps for next session.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Optional, Any
import math

from .goal_configs import get_goal_config, GoalConfig, RepRangeConfig
from .exercise_metadata import (
    get_exercise_metadata,
    resolve_exercise_metadata,
    ExerciseMetadata,
    is_cardio,
    is_bodyweight,
)
from .weight_estimator import (
    days_since_session,
    estimate_comeback_weight,
    estimate_starting_weight,
    last_working_reps,
    last_working_weight,
)


class Decision(str, Enum):
    FIRST_SESSION = "first_session"
    NEEDS_STARTING_WEIGHT = "needs_starting_weight"
    INCREASE_WEIGHT = "increase_weight"
    INCREASE_REPS = "increase_reps"
    MAINTAIN = "maintain"
    DELOAD = "deload"
    LIGHT_DAY = "light_day"
    CARDIO_PROGRESS = "cardio_progress"
    BODYWEIGHT_PROGRESS = "bodyweight_progress"


@dataclass
class RecommendedSet:
    set_number: int
    reps: int
    weight: float

    def to_dict(self) -> Dict:
        return {"set_number": self.set_number, "reps": self.reps, "weight": self.weight}


@dataclass
class ProgressionResult:
    sets: List[RecommendedSet]
    decision: Decision
    confidence: str  # "high", "medium", "low"
    reasoning_context: Dict = field(default_factory=dict)

    # Cardio fields (optional)
    time: Optional[int] = None
    speed: Optional[float] = None

    def to_dict(self) -> Dict:
        result = {
            "sets": [s.to_dict() for s in self.sets],
            "decision": self.decision.value,
            "confidence": self.confidence,
        }
        if self.time is not None:
            result["time"] = self.time
        if self.speed is not None:
            result["speed"] = self.speed
        return result


class ProgressionEngine:
    """
    Deterministic progression engine implementing double progression.

    Given an exercise's recent sessions and the user's goal, computes exact
    weight/reps recommendations without any LLM involvement.
    """

    def compute_recommendation(
        self,
        exercise_id: str,
        exercise_name: str,
        user_goal: str,
        recent_sessions: List[Dict],
        num_sets: int = 3,
        day_intensity: Optional[str] = None,
        heavy_day_weight: Optional[float] = None,
        exercise_record: Optional[Dict] = None,
        top_lifts: Optional[Dict[str, Any]] = None,
        stale_last_session: Optional[Dict] = None,
    ) -> ProgressionResult:
        """
        Compute a deterministic recommendation for the next workout.

        Args:
            exercise_id: The exercise ID
            exercise_name: Name of the exercise
            user_goal: User's goal string (e.g., "Build Muscle")
            recent_sessions: List of session dicts, most recent first.
                Each: {date, sets: [{weight, reps, difficulty?, completed?}]}
            num_sets: Number of sets to recommend (from plan_target_sets)
            day_intensity: "heavy" | "light" | "normal" | None
            heavy_day_weight: For light days, the weight used on heavy day
            exercise_record: Optional dict with exercise model fields
                (muscle_group, type, name) for custom exercise resolution
            top_lifts: Optional working weights for major compound lifts

        Returns:
            ProgressionResult with sets, decision, confidence, and reasoning_context
        """
        # Resolve metadata: catalog → exercise record → name inference → default
        metadata = resolve_exercise_metadata(exercise_id, exercise_name, exercise_record)
        goal_config = get_goal_config(user_goal)
        rep_range = self._get_rep_range(metadata, goal_config)
        increment = metadata.min_increment_lb

        # 1. Cardio?
        if metadata.muscle_group == "cardio":
            return self._handle_cardio(recent_sessions, num_sets)

        # 2. Bodyweight (0 increment)?
        if metadata.min_increment_lb == 0.0:
            return self._handle_bodyweight(recent_sessions, num_sets, rep_range, metadata)

        # 3. No history in the last 30 days → estimate 3 sets they can hit now
        if not recent_sessions:
            return self._estimate_current_working_sets(
                exercise_id=exercise_id,
                exercise_name=exercise_name,
                num_sets=num_sets,
                rep_range=rep_range,
                increment=increment,
                top_lifts=top_lifts,
                stale_last_session=stale_last_session,
            )

        # Get the latest session data
        latest = recent_sessions[0]
        latest_sets = latest.get("sets", [])
        if not latest_sets:
            estimated = estimate_starting_weight(exercise_id, exercise_name, top_lifts)
            if estimated:
                return self._handle_first_session_with_estimate(
                    num_sets, rep_range, estimated
                )
            return self._handle_needs_starting_weight(num_sets, rep_range)

        # 3b. Filter implausible data from latest sets
        latest_sets, has_implausible = self._filter_implausible_sets(latest_sets, metadata)
        if not latest_sets:
            result = self._handle_needs_starting_weight(num_sets, rep_range)
            if has_implausible:
                result.reasoning_context["has_implausible_data"] = True
                result.reasoning_context["reason"] = "invalid_history_needs_starting_weight"
            return result

        # 4. Compute e1RM history and check for plateau/deload
        if len(recent_sessions) >= 3:
            e1rm_values = self._compute_e1rm_history(recent_sessions)
            if self._should_deload(e1rm_values, recent_sessions):
                result = self._handle_deload(latest_sets, num_sets, rep_range, increment, metadata)
                if has_implausible:
                    result.confidence = "low"
                    result.reasoning_context["has_implausible_data"] = True
                return result

        # 5. Light day?
        if day_intensity == "light":
            return self._handle_light_day(
                latest_sets, num_sets, rep_range, increment, heavy_day_weight, metadata
            )

        # 6. Check difficulty ratings
        difficulties = [s.get("difficulty") for s in latest_sets if s.get("difficulty")]
        if difficulties:
            if all(d == "failed" for d in difficulties):
                # Count as failure immediately
                result = self._handle_failure(
                    recent_sessions, num_sets, rep_range, increment, goal_config, metadata,
                    force_failure=True
                )
                if has_implausible:
                    result.confidence = "low"
                    result.reasoning_context["has_implausible_data"] = True
                return result
            if (
                all(d == "easy" for d in difficulties)
                and goal_config.double_increment_on_easy
                and self._all_sets_at_top(latest_sets, rep_range)
            ):
                # DOCUMENTED EXCEPTION TO 10% JUMP GUARD:
                # When ALL sets are rated "easy" AND at the top of the rep range,
                # a double increment (2× base increment) is applied. This is an
                # intentional coaching decision — if an all-easy top-out occurs,
                # the weight was clearly too light and a single increment would
                # under-challenge the user. Capped at exactly 2× base increment.
                #
                # For dumbbells (5 lb increments): max jump = 10 lbs (e.g., 75→85 = 13.3%)
                # For barbells (5 lb base): max jump = 10 lbs
                # For heavy barbells (10 lb increment): max jump = 20 lbs
                #   → To prevent excessive absolute jumps on heavy barbell lifts,
                #     cap the double increment at 10 lbs total regardless of base.
                double_increment = min(increment * 2, 10.0)
                result = self._handle_increase_weight(
                    latest_sets, num_sets, rep_range, double_increment, metadata
                )
                if has_implausible:
                    result.confidence = "low"
                    result.reasoning_context["has_implausible_data"] = True
                return result

        # 7. ALL sets hit rep_range.high? → INCREASE_WEIGHT
        if self._all_sets_at_top(latest_sets, rep_range):
            result = self._handle_increase_weight(
                latest_sets, num_sets, rep_range, increment, metadata
            )
            if has_implausible:
                result.confidence = "low"
                result.reasoning_context["has_implausible_data"] = True
            return result

        # 8. Matched or beat previous session? → INCREASE_REPS
        if len(recent_sessions) >= 2:
            prev_sets = recent_sessions[1].get("sets", [])
            if self._matched_or_beat(latest_sets, prev_sets):
                result = self._handle_increase_reps(
                    latest_sets, num_sets, rep_range, metadata
                )
            else:
                # Failed to match — check consecutive failures
                result = self._handle_failure(
                    recent_sessions, num_sets, rep_range, increment, goal_config, metadata
                )
        else:
            # Only one session — try to increase reps
            result = self._handle_increase_reps(
                latest_sets, num_sets, rep_range, metadata
            )

        if has_implausible:
            result.confidence = "low"
            result.reasoning_context["has_implausible_data"] = True

        skip_bump = result.decision in (
            Decision.DELOAD,
            Decision.LIGHT_DAY,
            Decision.MAINTAIN,
            Decision.NEEDS_STARTING_WEIGHT,
            Decision.FIRST_SESSION,
        )
        if not skip_bump:
            result = self._ensure_progressed(
                result, latest_sets, num_sets, rep_range, increment, metadata
            )
        return result

    # === Private Methods ===

    def _get_rep_range(self, metadata: ExerciseMetadata, goal_config: GoalConfig) -> RepRangeConfig:
        """Get the appropriate rep range based on compound/isolation classification."""
        if metadata.compound:
            return goal_config.compound_rep_range
        return goal_config.isolation_rep_range

    def _handle_needs_starting_weight(self, num_sets: int, rep_range: RepRangeConfig) -> ProgressionResult:
        """
        No history — return a NEEDS_STARTING_WEIGHT status.
        The frontend should render this as a "pick your starting weight" prompt
        rather than displaying "0 lbs × 6" which looks broken.
        """
        return ProgressionResult(
            # An empty list is intentional: zero is a valid bodyweight value but
            # not a valid prescription for a weighted exercise. The API exposes
            # suggested_reps separately so the UI can ask for a starting load.
            sets=[],
            decision=Decision.NEEDS_STARTING_WEIGHT,
            confidence="low",
            reasoning_context={
                "reason": "needs_starting_weight",
                "rep_range": (rep_range.low, rep_range.high),
                "suggested_reps": rep_range.low,
                "suggested_sets": num_sets,
            },
        )

    def _handle_first_session(self, num_sets: int, rep_range: RepRangeConfig) -> ProgressionResult:
        """Backward-compat alias for bodyweight first sessions (weight=0 is valid)."""
        sets = [
            RecommendedSet(set_number=i + 1, reps=rep_range.low, weight=0)
            for i in range(num_sets)
        ]
        return ProgressionResult(
            sets=sets,
            decision=Decision.FIRST_SESSION,
            confidence="low",
            reasoning_context={
                "reason": "first_session",
                "rep_range": (rep_range.low, rep_range.high),
            },
        )

    def _estimate_current_working_sets(
        self,
        exercise_id: str,
        exercise_name: str,
        num_sets: int,
        rep_range: RepRangeConfig,
        increment: float,
        top_lifts: Optional[Dict[str, Any]],
        stale_last_session: Optional[Dict],
    ) -> ProgressionResult:
        """Fill 3 current working sets when there is no recent session."""
        if stale_last_session:
            stale_sets = stale_last_session.get("sets") or []
            days_ago = days_since_session(stale_last_session.get("date"))
            comeback = estimate_comeback_weight(
                last_working_weight(stale_sets),
                days_ago,
                increment=increment or 5.0,
            )
            if comeback:
                reps = last_working_reps(stale_sets) or rep_range.low
                return self._handle_first_session_with_estimate(
                    num_sets,
                    rep_range,
                    comeback,
                    suggested_reps=reps,
                    extra_context={
                        "reason": "estimated_comeback",
                        "estimated_from_stale_history": True,
                        "days_since_last": days_ago,
                        "prev_weight": last_working_weight(stale_sets),
                    },
                )

        estimated = estimate_starting_weight(exercise_id, exercise_name, top_lifts)
        if estimated:
            return self._handle_first_session_with_estimate(
                num_sets, rep_range, estimated
            )
        return self._handle_needs_starting_weight(num_sets, rep_range)

    def _handle_first_session_with_estimate(
        self,
        num_sets: int,
        rep_range: RepRangeConfig,
        estimated_weight: float,
        suggested_reps: Optional[int] = None,
        extra_context: Optional[Dict] = None,
    ) -> ProgressionResult:
        """Seed a first weighted session from last-known load or top-lift ratios."""
        reps = suggested_reps or rep_range.low
        sets = [
            RecommendedSet(
                set_number=i + 1,
                reps=reps,
                weight=estimated_weight,
            )
            for i in range(num_sets)
        ]
        context = {
            "reason": "estimated_from_top_lifts",
            "estimated_weight": estimated_weight,
            "estimated_from_top_lifts": True,
            "rep_range": (rep_range.low, rep_range.high),
        }
        if extra_context:
            context.update(extra_context)
            if extra_context.get("estimated_from_stale_history"):
                context["estimated_from_top_lifts"] = False
        return ProgressionResult(
            sets=sets,
            decision=Decision.FIRST_SESSION,
            confidence="medium",
            reasoning_context=context,
        )

    def _filter_implausible_sets(self, sets: List[Dict], metadata=None) -> tuple:
        """
        Filter out implausible set data and flag the session.

        Thresholds:
        - Universal: weight ≤ 0 or > 1000 lb, reps > 50 or ≤ 0
        - Outlier: weight > 5x median of other sets in the session

        Returns (filtered_sets, has_implausible_flag).
        """
        filtered = []
        has_implausible = False
        for s in sets:
            weight = s.get("weight", 0)
            reps = s.get("reps", 0)
            if weight <= 0 or weight > 1000 or reps > 50 or reps <= 0:
                has_implausible = True
                continue
            filtered.append(s)

        # Outlier check: if a set's weight is >5x the median of remaining sets, flag it
        if len(filtered) >= 2:
            weights = sorted(s.get("weight", 0) for s in filtered)
            median_weight = weights[len(weights) // 2]
            if median_weight > 0:
                outlier_filtered = []
                for s in filtered:
                    if s.get("weight", 0) > median_weight * 5:
                        has_implausible = True
                    else:
                        outlier_filtered.append(s)
                filtered = outlier_filtered

        return filtered, has_implausible

    def _handle_cardio(self, recent_sessions: List[Dict], num_sets: int) -> ProgressionResult:
        """Cardio progression: increase time by 1 min or speed by 0.5."""
        if not recent_sessions:
            return ProgressionResult(
                sets=[],
                decision=Decision.CARDIO_PROGRESS,
                confidence="low",
                reasoning_context={"reason": "first_cardio_session"},
                time=10,
                speed=None,
            )

        latest = recent_sessions[0]
        prev_time = latest.get("time", 10)
        prev_speed = latest.get("speed")

        new_time = prev_time + 1
        new_speed = (prev_speed + 0.5) if prev_speed else None

        return ProgressionResult(
            sets=[],
            decision=Decision.CARDIO_PROGRESS,
            confidence="medium",
            reasoning_context={
                "reason": "cardio_progression",
                "prev_time": prev_time,
                "new_time": new_time,
                "prev_speed": prev_speed,
                "new_speed": new_speed,
            },
            time=new_time,
            speed=new_speed,
        )

    def _handle_bodyweight(
        self,
        recent_sessions: List[Dict],
        num_sets: int,
        rep_range: RepRangeConfig,
        metadata: ExerciseMetadata,
    ) -> ProgressionResult:
        """Bodyweight progression: pure rep increases."""
        if not recent_sessions:
            sets = [
                RecommendedSet(set_number=i + 1, reps=rep_range.low, weight=0)
                for i in range(num_sets)
            ]
            return ProgressionResult(
                sets=sets,
                decision=Decision.FIRST_SESSION,
                confidence="low",
                reasoning_context={"reason": "first_bodyweight_session"},
            )

        latest_sets = recent_sessions[0].get("sets", [])
        if not latest_sets:
            sets = [
                RecommendedSet(set_number=i + 1, reps=rep_range.low, weight=0)
                for i in range(num_sets)
            ]
            return ProgressionResult(
                sets=sets,
                decision=Decision.FIRST_SESSION,
                confidence="low",
                reasoning_context={"reason": "no_set_data"},
            )

        # Add 1 rep per set, capped at rep_range.high
        new_sets = []
        for i in range(num_sets):
            if i < len(latest_sets):
                prev_reps = latest_sets[i].get("reps", rep_range.low)
            else:
                prev_reps = rep_range.low
            new_reps = min(prev_reps + 1, rep_range.high)
            new_sets.append(RecommendedSet(set_number=i + 1, reps=new_reps, weight=0))

        return ProgressionResult(
            sets=new_sets,
            decision=Decision.BODYWEIGHT_PROGRESS,
            confidence="high",
            reasoning_context={
                "reason": "bodyweight_rep_increase",
                "prev_reps": [s.get("reps", 0) for s in latest_sets[:num_sets]],
                "new_reps": [s.reps for s in new_sets],
            },
        )

    def _compute_e1rm_history(self, recent_sessions: List[Dict]) -> List[float]:
        """
        Compute estimated 1RM for each session (best set per session).
        Uses Epley formula: weight × (1 + reps/30)
        Returns list from oldest to newest.
        """
        e1rm_values = []
        for session in reversed(recent_sessions):
            best_e1rm = 0
            for s in session.get("sets", []):
                weight = s.get("weight", 0)
                reps = s.get("reps", 0)
                if weight > 0 and reps > 0:
                    e1rm = weight * (1 + reps / 30)
                    best_e1rm = max(best_e1rm, e1rm)
            if best_e1rm > 0:
                e1rm_values.append(best_e1rm)
        return e1rm_values

    def _should_deload(self, e1rm_values: List[float], recent_sessions: List[Dict]) -> bool:
        """
        Check if e1RM has been flat (stagnant) for 3+ sessions.
        Triggers only when the user has been stuck at roughly the same level
        without improvement — not when there's a simple decline from failures
        or right after a weight increase.

        Conditions:
        1. At least 3 sessions with e1RM data
        2. All values within 3% band (stagnant)
        3. Latest is not the best (no upward trend)
        4. Weight hasn't changed recently (not right after increase_weight)
        """
        if len(e1rm_values) < 3:
            return False

        # Check that weight hasn't changed in the last 3 sessions
        # If weight changed, it's a recent progression attempt, not a plateau
        if len(recent_sessions) >= 3:
            weights = []
            for session in recent_sessions[:3]:
                session_weights = [s.get("weight", 0) for s in session.get("sets", []) if s.get("weight", 0) > 0]
                if session_weights:
                    weights.append(max(session_weights))
            if len(weights) >= 2 and len(set(weights)) > 1:
                # Weight varied in the window — not a true plateau
                return False

        # Look at last 3 values
        recent = e1rm_values[-3:]
        max_e1rm = max(recent)
        min_e1rm = min(recent)

        if max_e1rm <= 0:
            return False

        # Check flatness: all values within 3% band (stagnant)
        spread = (max_e1rm - min_e1rm) / max_e1rm
        if spread > 0.03:
            return False

        # Flat AND not improving (latest is not the best)
        if recent[-1] >= max_e1rm:
            return False

        return True

    def _handle_deload(
        self,
        latest_sets: List[Dict],
        num_sets: int,
        rep_range: RepRangeConfig,
        increment: float,
        metadata: ExerciseMetadata,
    ) -> ProgressionResult:
        """Deload at ~80% of last working weight, midrange reps."""
        max_weight = max((s.get("weight", 0) for s in latest_sets), default=0)
        resolution = self._weight_resolution(metadata)
        deload_weight = self._round_to_increment(max_weight * 0.8, resolution)
        deload_reps = rep_range.midpoint

        sets = [
            RecommendedSet(set_number=i + 1, reps=deload_reps, weight=deload_weight)
            for i in range(num_sets)
        ]
        return ProgressionResult(
            sets=sets,
            decision=Decision.DELOAD,
            confidence="high",
            reasoning_context={
                "reason": "deload",
                "prev_weight": max_weight,
                "deload_weight": deload_weight,
                "deload_reps": deload_reps,
                "deload_pct": 0.8,
            },
        )

    def _handle_light_day(
        self,
        latest_sets: List[Dict],
        num_sets: int,
        rep_range: RepRangeConfig,
        increment: float,
        heavy_day_weight: Optional[float],
        metadata: ExerciseMetadata,
    ) -> ProgressionResult:
        """Light day: 85-90% of heavy weight at top of rep range. Never advances state."""
        # Use heavy_day_weight if provided, else derive from latest sets
        if heavy_day_weight:
            reference_weight = heavy_day_weight
        else:
            reference_weight = max((s.get("weight", 0) for s in latest_sets), default=0)

        # 85-90% — use 87.5% as midpoint
        resolution = self._weight_resolution(metadata)
        light_weight = self._round_to_increment(reference_weight * 0.875, resolution)
        light_reps = rep_range.high

        sets = [
            RecommendedSet(set_number=i + 1, reps=light_reps, weight=light_weight)
            for i in range(num_sets)
        ]
        return ProgressionResult(
            sets=sets,
            decision=Decision.LIGHT_DAY,
            confidence="high",
            reasoning_context={
                "reason": "light_day",
                "heavy_weight": reference_weight,
                "light_weight": light_weight,
                "light_pct": 0.875,
            },
        )

    def _handle_increase_weight(
        self,
        latest_sets: List[Dict],
        num_sets: int,
        rep_range: RepRangeConfig,
        increment: float,
        metadata: ExerciseMetadata,
    ) -> ProgressionResult:
        """All sets at top of rep range → increase weight, reset to low reps."""
        max_weight = max((s.get("weight", 0) for s in latest_sets), default=0)
        # Round to weight resolution (5 lbs for all standard equipment)
        resolution = self._weight_resolution(metadata)
        new_weight = self._round_to_increment(max_weight + increment, resolution)

        sets = [
            RecommendedSet(set_number=i + 1, reps=rep_range.low, weight=new_weight)
            for i in range(num_sets)
        ]
        return ProgressionResult(
            sets=sets,
            decision=Decision.INCREASE_WEIGHT,
            confidence="high",
            reasoning_context={
                "reason": "increase_weight",
                "prev_weight": max_weight,
                "new_weight": new_weight,
                "increment": increment,
                "reset_reps": rep_range.low,
            },
        )

    def _handle_increase_reps(
        self,
        latest_sets: List[Dict],
        num_sets: int,
        rep_range: RepRangeConfig,
        metadata: ExerciseMetadata,
    ) -> ProgressionResult:
        """Matched previous — increase reps by 1 per set, capped at rep_range.high."""
        max_weight = max((s.get("weight", 0) for s in latest_sets), default=0)
        # For padding: use the last available set's data for consistency
        last_available = latest_sets[-1] if latest_sets else {}
        last_reps = last_available.get("reps", rep_range.low)
        resolution = self._weight_resolution(metadata)
        last_weight = self._round_to_increment(
            last_available.get("weight", max_weight), resolution
        )

        new_sets = []
        for i in range(num_sets):
            if i < len(latest_sets):
                prev_reps = latest_sets[i].get("reps", rep_range.low)
                prev_weight = self._round_to_increment(
                    latest_sets[i].get("weight", max_weight), resolution
                )
            else:
                # Pad with last set's data for consistency (not rep_range.low)
                prev_reps = last_reps
                prev_weight = last_weight
            new_reps = min(prev_reps + 1, rep_range.high)
            new_sets.append(RecommendedSet(set_number=i + 1, reps=new_reps, weight=prev_weight))

        return ProgressionResult(
            sets=new_sets,
            decision=Decision.INCREASE_REPS,
            confidence="high",
            reasoning_context={
                "reason": "increase_reps",
                "prev_reps": [s.get("reps", 0) for s in latest_sets[:num_sets]],
                "new_reps": [s.reps for s in new_sets],
                "weight": max_weight,
            },
        )

    def _handle_failure(
        self,
        recent_sessions: List[Dict],
        num_sets: int,
        rep_range: RepRangeConfig,
        increment: float,
        goal_config: GoalConfig,
        metadata: ExerciseMetadata,
        force_failure: bool = False,
    ) -> ProgressionResult:
        """
        Handle failure to match previous session.
        Count consecutive failures — if >= threshold, hold (MAINTAIN).
        Below threshold, retry same target.
        """
        threshold = goal_config.consecutive_failures_to_hold

        if force_failure:
            consecutive_failures = threshold  # Treat as immediate hold
        else:
            consecutive_failures = self._count_consecutive_failures(recent_sessions)

        latest_sets = recent_sessions[0].get("sets", [])
        max_weight = max((s.get("weight", 0) for s in latest_sets), default=0)

        if consecutive_failures >= threshold:
            # MAINTAIN: hold weight + reps from the best recent session
            best_session = self._find_best_recent_session(recent_sessions[:5])
            best_sets = best_session.get("sets", []) if best_session else latest_sets
            # Pad with last available set for consistency
            last_best = best_sets[-1] if best_sets else {}

            resolution = self._weight_resolution(metadata)
            sets = []
            for i in range(num_sets):
                if i < len(best_sets):
                    weight = best_sets[i].get("weight", max_weight)
                    reps = best_sets[i].get("reps", rep_range.low)
                else:
                    weight = last_best.get("weight", max_weight)
                    reps = last_best.get("reps", rep_range.low)
                weight = self._round_to_increment(weight, resolution)
                sets.append(RecommendedSet(set_number=i + 1, reps=reps, weight=weight))

            return ProgressionResult(
                sets=sets,
                decision=Decision.MAINTAIN,
                confidence="medium",
                reasoning_context={
                    "reason": "maintain_after_failures",
                    "consecutive_failures": consecutive_failures,
                    "threshold": threshold,
                    "weight": max_weight,
                },
            )
        else:
            # Retry: use previous target (try to match what we attempted)
            if len(recent_sessions) >= 2:
                prev_sets = recent_sessions[1].get("sets", [])
            else:
                prev_sets = latest_sets
            # Pad with last available set for consistency
            last_prev = prev_sets[-1] if prev_sets else {}

            resolution = self._weight_resolution(metadata)
            sets = []
            for i in range(num_sets):
                if i < len(prev_sets):
                    weight = prev_sets[i].get("weight", max_weight)
                    reps = prev_sets[i].get("reps", rep_range.low)
                else:
                    weight = last_prev.get("weight", max_weight)
                    reps = last_prev.get("reps", rep_range.low)
                weight = self._round_to_increment(weight, resolution)
                sets.append(RecommendedSet(set_number=i + 1, reps=reps, weight=weight))

            return ProgressionResult(
                sets=sets,
                decision=Decision.INCREASE_REPS,
                confidence="medium",
                reasoning_context={
                    "reason": "retry_after_failure",
                    "consecutive_failures": consecutive_failures,
                    "threshold": threshold,
                },
            )

    def _count_consecutive_failures(self, recent_sessions: List[Dict]) -> int:
        """
        Count how many consecutive sessions failed to improve over the one before.
        Starts from most recent, going backwards.
        """
        failures = 0
        for i in range(len(recent_sessions) - 1):
            current = recent_sessions[i].get("sets", [])
            previous = recent_sessions[i + 1].get("sets", [])
            if not self._matched_or_beat(current, previous):
                failures += 1
            else:
                break
        return failures

    def _find_best_recent_session(self, sessions: List[Dict]) -> Optional[Dict]:
        """Find the session with the highest total volume (weight × reps)."""
        best = None
        best_volume = 0
        for session in sessions:
            volume = sum(
                s.get("weight", 0) * s.get("reps", 0)
                for s in session.get("sets", [])
            )
            if volume >= best_volume:
                best_volume = volume
                best = session
        return best

    def _all_sets_at_top(self, sets: List[Dict], rep_range: RepRangeConfig) -> bool:
        """Check if ALL sets hit the top of the rep range."""
        if not sets:
            return False
        return all(s.get("reps", 0) >= rep_range.high for s in sets)

    def _ensure_progressed(
        self,
        result: ProgressionResult,
        latest_sets: List[Dict],
        num_sets: int,
        rep_range: RepRangeConfig,
        increment: float,
        metadata: ExerciseMetadata,
    ) -> ProgressionResult:
        """Never recommend the exact same weight/reps as the last completed session."""
        if not result.sets or not latest_sets:
            return result
        n = min(len(result.sets), len(latest_sets))
        identical = all(
            result.sets[i].reps == (latest_sets[i].get("reps") or 0)
            and float(result.sets[i].weight or 0)
            == float(latest_sets[i].get("weight") or 0)
            for i in range(n)
        )
        if not identical:
            return result
        if self._all_sets_at_top(latest_sets[:n], rep_range):
            return self._handle_increase_weight(
                latest_sets, num_sets, rep_range, increment, metadata
            )
        bumped = self._handle_increase_reps(
            latest_sets, num_sets, rep_range, metadata
        )
        bumped.reasoning_context["forced_progression"] = True
        return bumped

    def _matched_or_beat(self, current_sets: List[Dict], previous_sets: List[Dict]) -> bool:
        """
        Check if current session matched or beat previous.
        Compare overlapping sets so a 3-set session is not a 'fail' vs a 4-set one.
        """
        if not current_sets or not previous_sets:
            return True  # Give benefit of the doubt

        n = min(len(current_sets), len(previous_sets))
        current_volume = sum(
            (s.get("weight") or 0) * (s.get("reps") or 0) for s in current_sets[:n]
        )
        previous_volume = sum(
            (s.get("weight") or 0) * (s.get("reps") or 0) for s in previous_sets[:n]
        )
        return current_volume >= previous_volume

    def _weight_resolution(self, metadata: ExerciseMetadata) -> float:
        """
        Get the weight resolution (smallest valid weight change) for an exercise.
        This is 5 lbs for all standard equipment (barbells, dumbbells, cables, machines).
        """
        if metadata.min_increment_lb <= 0:
            return 1.0  # Bodyweight — no rounding needed
        return 5.0  # Standard weight resolution for all gym equipment

    def _round_to_increment(self, weight: float, increment: float) -> float:
        """Round weight to the nearest valid increment (ties round up)."""
        if increment <= 0:
            return weight
        # Use math.floor(x + 0.5) to avoid Python's banker's rounding
        return math.floor(weight / increment + 0.5) * increment

    def _apply_safety_guards(
        self, sets: List[RecommendedSet], latest_sets: List[Dict], increment: float
    ) -> List[RecommendedSet]:
        """
        Apply safety guards:
        - No weight jump > 10% of last session's max
        - No weight < 80% of last session's max (unless deloading)
        - All weights rounded to valid increments
        - Sets ordered heaviest-first
        """
        if not latest_sets:
            return sets

        max_prev_weight = max((s.get("weight", 0) for s in latest_sets), default=0)
        if max_prev_weight <= 0:
            return sets

        guarded = []
        for s in sets:
            weight = s.weight
            # No jump > 10%
            if weight > max_prev_weight * 1.10:
                weight = self._round_to_increment(max_prev_weight * 1.10, increment)
            # No drop below 80% (unless weight is already low)
            if weight < max_prev_weight * 0.80 and weight > 0:
                weight = self._round_to_increment(max_prev_weight * 0.80, increment)
            # Round to increment
            weight = self._round_to_increment(weight, increment)
            guarded.append(RecommendedSet(set_number=s.set_number, reps=s.reps, weight=weight))

        # Order heaviest-first
        guarded.sort(key=lambda s: s.weight, reverse=True)
        # Re-number
        for i, s in enumerate(guarded):
            s.set_number = i + 1

        return guarded
