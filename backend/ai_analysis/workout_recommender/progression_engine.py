"""
Deterministic Workout Progression Engine.

Pure-Python double progression logic. No LLM calls.
Given exercise history + user goal, computes exact weight/reps for next session.
"""

from dataclasses import dataclass, field
import os
from enum import Enum
from typing import List, Dict, Optional, Any
import math
from statistics import median

from .cardio_progression import compute_cardio_progression
from .goal_configs import get_goal_config, resolve_goal_config, GoalConfig, RepRangeConfig
from .prescription import (
    Branch,
    count_regressions,
    typical_reps,
    ProgressionStrategy,
    SessionOutcome,
    describe_band,
    evaluate_session,
    near_top_streak,
    same_load,
    select_strategy,
)
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


# How far under the band's floor a session has to land before the load itself
# is judged to be the problem rather than the effort. Missing 12-15 with 11
# reps is a session to repeat; missing it with 8 means the weight was never
# going to allow the band. Reasoned, not calibrated.
LOAD_MISMATCH_REPS = 3

# Readiness thresholds for the demotion ladder. Placeholders: nobody knows
# how much a night of poor sleep should move a top set, so these are a
# starting point to be validated against real logs, not a finding.
READINESS_FULL = 0.90    # at or above: change nothing
READINESS_REDUCED = 0.75 # between: one step down. below: two.

# Demotion is off until the thresholds have been checked against outcomes.
# While off, the engine still records what it *would* have done, so the
# decision can be validated before it ever changes a user's session.
READINESS_DEMOTION_ENABLED = os.getenv("READINESS_DEMOTION_ENABLED", "").lower() in (
    "1", "true", "yes",
)


class Decision(str, Enum):
    FIRST_SESSION = "first_session"
    NEEDS_STARTING_WEIGHT = "needs_starting_weight"
    INCREASE_WEIGHT = "increase_weight"
    INCREASE_REPS = "increase_reps"
    MAINTAIN = "maintain"
    FILL_BAND = "fill_band"
    REDUCE_LOAD = "reduce_load"
    DELOAD = "deload"
    LIGHT_DAY = "light_day"
    CARDIO_PROGRESS = "cardio_progress"
    # Cardio has more than one outcome now: it can hold on high fatigue, back
    # off after an abandoned session, sit at a pace ceiling, or need a pace
    # logged before it can progress one.
    CARDIO_HOLD = "cardio_hold"
    CARDIO_BACKOFF = "cardio_backoff"
    CARDIO_MAINTAIN = "cardio_maintain"
    CARDIO_NEEDS_PACE = "cardio_needs_pace"
    CARDIO_FIRST_SESSION = "cardio_first_session"
    BODYWEIGHT_PROGRESS = "bodyweight_progress"


# Cardio prescriptions name their own decision; this maps them onto the enum
# the rest of the pipeline switches on.
CARDIO_DECISIONS = {
    "cardio_progress": Decision.CARDIO_PROGRESS,
    "cardio_hold": Decision.CARDIO_HOLD,
    "cardio_backoff": Decision.CARDIO_BACKOFF,
    "cardio_maintain": Decision.CARDIO_MAINTAIN,
    "cardio_needs_pace": Decision.CARDIO_NEEDS_PACE,
    "cardio_first_session": Decision.CARDIO_FIRST_SESSION,
}


@dataclass
class RecommendedSet:
    set_number: int
    reps: int
    weight: float

    # The band this set should land in. `reps` stays the single number to hit
    # (it equals rep_low) so older clients that render one figure keep working;
    # clients that understand a band read these two instead.
    rep_low: Optional[int] = None
    rep_high: Optional[int] = None
    # "straight" | "top" | "backoff" — what this set is for, under TOP_SET.
    role: str = "straight"
    # The single target inside rep_low-rep_high. Keeping this structured lets
    # the workout card say "6-10, aim 9" instead of presenting a vague range.
    preferred_reps: Optional[int] = None

    def to_dict(self) -> Dict:
        payload = {
            "set_number": self.set_number,
            "reps": self.reps,
            "weight": self.weight,
            "role": self.role,
        }
        if self.rep_low is not None:
            payload["rep_low"] = self.rep_low
        if self.rep_high is not None:
            payload["rep_high"] = self.rep_high
        if self.preferred_reps is not None:
            payload["preferred_reps"] = self.preferred_reps
        return payload


@dataclass
class ProgressionResult:
    sets: List[RecommendedSet]
    decision: Decision
    confidence: str  # "high", "medium", "low"
    reasoning_context: Dict = field(default_factory=dict)

    # Cardio fields (optional)
    time: Optional[int] = None
    speed: Optional[float] = None
    # "steady" | "sport". Sport has no pace to prescribe, so clients render an
    # effort target instead of a speed.
    cardio_modality: Optional[str] = None
    target_intensity: Optional[int] = None
    # The cardio analogue of `branch`: what to do if today does not go to plan.
    guidance: Optional[str] = None

    # Which shape of prescription this is, and the "if this, then that" the
    # user reads mid-set. Absent on the states where no branch makes sense
    # (needs-starting-weight, cardio, a first session with no history).
    strategy: Optional[str] = None
    branch: Optional[Branch] = None
    progression_options: List[Dict] = field(default_factory=list)

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
        if self.cardio_modality is not None:
            result["cardio_modality"] = self.cardio_modality
        if self.target_intensity is not None:
            result["target_intensity"] = self.target_intensity
        if self.guidance is not None:
            result["guidance"] = self.guidance
        if self.strategy is not None:
            result["strategy"] = self.strategy
        if self.branch is not None:
            result["branch"] = self.branch.to_dict()
        if self.progression_options:
            result["progression_options"] = self.progression_options
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
        focus_goal: Optional[str] = None,
        rep_range_override: Optional[tuple] = None,
        readiness: Optional[Any] = None,
    ) -> ProgressionResult:
        """
        Compute a recommendation, then record whether a per-exercise focus
        changed the goal config that applied.

        `readiness` is an optional ReadinessContext. Omitted or neutral, the
        result is byte-identical to what it would have been without it.

        Wraps the computation rather than threading the flag through each of
        its return paths.
        """
        result = self._compute_recommendation(
            rep_range_override=rep_range_override,
            exercise_id=exercise_id,
            exercise_name=exercise_name,
            user_goal=user_goal,
            recent_sessions=recent_sessions,
            num_sets=num_sets,
            day_intensity=day_intensity,
            heavy_day_weight=heavy_day_weight,
            exercise_record=exercise_record,
            top_lifts=top_lifts,
            stale_last_session=stale_last_session,
            focus_goal=focus_goal,
        )

        base_config = get_goal_config(user_goal)
        applied_config = resolve_goal_config(user_goal, focus_goal)
        if applied_config.name != base_config.name:
            result.reasoning_context = {
                **(result.reasoning_context or {}),
                "focus_goal": applied_config.name,
                "base_goal": base_config.name,
            }

        # Applied here rather than inside _compute_recommendation because that
        # method returns from a dozen places; the wrapper is the one point every
        # decision passes through.
        result = self._apply_readiness(
            result,
            readiness=readiness,
            exercise_id=exercise_id,
            exercise_name=exercise_name,
            recent_sessions=recent_sessions,
            num_sets=num_sets,
            goal_config=applied_config,
            exercise_record=exercise_record,
            rep_range_override=rep_range_override,
        )
        return result

    def _compute_recommendation(
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
        focus_goal: Optional[str] = None,
        rep_range_override: Optional[tuple] = None,
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
            focus_goal: Optional per-exercise goal override (e.g. "strength" on
                bench while the rest of the program stays hypertrophy). Ignored
                if unrecognized.

        Returns:
            ProgressionResult with sets, decision, confidence, and reasoning_context
        """
        # Resolve metadata: catalog → exercise record → name inference → default
        metadata = resolve_exercise_metadata(exercise_id, exercise_name, exercise_record)
        goal_config = resolve_goal_config(user_goal, focus_goal)
        # An explicit plan rep-range beats the goal config's default range
        rep_range = (
            RepRangeConfig(low=rep_range_override[0], high=rep_range_override[1])
            if rep_range_override
            else self._get_rep_range(metadata, goal_config)
        )
        increment = metadata.min_increment_lb

        # 1. Cardio?
        if metadata.muscle_group == "cardio":
            return self._handle_cardio(
                exercise_id=exercise_id,
                exercise_name=exercise_name,
                recent_sessions=recent_sessions,
                user_goal=user_goal,
                focus_goal=focus_goal,
            )

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
                exercise_record=exercise_record,
            )

        # Get the latest session data
        latest = recent_sessions[0]
        latest_sets = latest.get("sets", [])
        if not latest_sets:
            estimated = estimate_starting_weight(
                exercise_id, exercise_name, top_lifts, exercise_record=exercise_record
            )
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

        # How did the last session land against the band it was working in?
        # This replaces a total-volume comparison against the previous session,
        # which scored a successful weight increase as a failure and bounced the
        # user between two loads indefinitely.
        outcome = evaluate_session(latest_sets, rep_range)
        strategy = select_strategy(metadata, goal_config)

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
                and outcome == SessionOutcome.SWEPT_TOP
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

        # 7. Swept the ceiling → the weight has been earned outright.
        if outcome == SessionOutcome.SWEPT_TOP:
            result = self._handle_increase_weight(
                latest_sets, num_sets, rep_range, increment, metadata, strategy
            )
            if has_implausible:
                result.confidence = "low"
                result.reasoning_context["has_implausible_data"] = True
            return result

        # 7b. Brushing the ceiling two sessions running also earns it. Demanding
        # a flawless sweep is what pinned real lifters — the ones who land
        # 10,9,10 week after week — at the same load indefinitely.
        if outcome == SessionOutcome.AT_TOP:
            streak = near_top_streak(recent_sessions, rep_range)
            if streak >= 2:
                result = self._handle_increase_weight(
                    latest_sets, num_sets, rep_range, increment, metadata, strategy
                )
                result.reasoning_context["earned_by_streak"] = streak
                if has_implausible:
                    result.confidence = "low"
                    result.reasoning_context["has_implausible_data"] = True
                return result

        # 8. Going backwards at a fixed load is still a failure, even when the
        # individual session technically sits inside the band. A band judges
        # one session; a decline is only visible across several.
        regressions = count_regressions(recent_sessions, rep_range)

        if outcome == SessionOutcome.BELOW or regressions >= 1:
            result = self._handle_failure(
                recent_sessions, num_sets, rep_range, increment, goal_config,
                metadata, regressions=regressions,
            )
        else:
            result = self._handle_band_work(
                latest_sets, num_sets, rep_range, increment, metadata, outcome, strategy
            )

        if has_implausible:
            result.confidence = "low"
            result.reasoning_context["has_implausible_data"] = True

        skip_bump = result.decision in (
            Decision.DELOAD,
            Decision.LIGHT_DAY,
            Decision.MAINTAIN,
            Decision.REDUCE_LOAD,
            Decision.FILL_BAND,
            Decision.NEEDS_STARTING_WEIGHT,
            Decision.FIRST_SESSION,
        )
        if not skip_bump:
            result = self._ensure_progressed(
                result, latest_sets, num_sets, rep_range, increment, metadata
            )
        return result

    # === Private Methods ===

    # Each step down the ladder. A decision not listed here is already
    # conservative (deload, light day, a first session, a failure response) and
    # readiness has nothing to add to it.
    _DEMOTION_LADDER = {
        Decision.INCREASE_WEIGHT: Decision.INCREASE_REPS,
        Decision.INCREASE_REPS: Decision.MAINTAIN,
    }

    def _demoted_decision(self, decision, score: float):
        """Where this decision lands after `score` steps of demotion."""
        steps = 0
        if score < READINESS_REDUCED:
            steps = 2
        elif score < READINESS_FULL:
            steps = 1

        current = decision
        for _ in range(steps):
            nxt = self._DEMOTION_LADDER.get(current)
            if nxt is None:
                break
            current = nxt
        return current

    def _apply_readiness(
        self,
        result: ProgressionResult,
        readiness: Optional[Any],
        exercise_id: str,
        exercise_name: str,
        recent_sessions: List[Dict],
        num_sets: int,
        goal_config,
        exercise_record: Optional[Dict],
        rep_range_override: Optional[tuple],
    ) -> ProgressionResult:
        """
        Let recovery hold a recommendation back, never push it forward.

        Readiness demotes the *decision* rather than editing the numbers. That
        matters: _ensure_progressed rewrites any result identical to the last
        session into a rep increase, so a hand-lowered weight would be silently
        undone. MAINTAIN is already in that method's skip list, which is why
        moving down the ladder holds and adjusting weights directly does not.

        Asymmetric on purpose. Pushing someone who is wrecked risks injury;
        holding someone who feels great costs one boring session.
        """
        if readiness is None or not getattr(readiness, "usable", False):
            return result

        score = float(getattr(readiness, "score", 1.0))
        target = self._demoted_decision(result.decision, score)
        if target == result.decision:
            return result

        drivers = list(getattr(readiness, "drivers", []) or [])
        shadow = {
            "readiness_score": round(score, 3),
            "readiness_drivers": drivers,
            "readiness_would_demote_to": target.value,
            "readiness_applied": False,
        }

        if not READINESS_DEMOTION_ENABLED:
            # Shadow mode: record the decision that would have been taken so it
            # can be checked against real outcomes before it changes anything.
            result.reasoning_context = {**(result.reasoning_context or {}), **shadow}
            return result

        latest_sets = (recent_sessions[0].get("sets") if recent_sessions else None) or []
        if not latest_sets:
            result.reasoning_context = {**(result.reasoning_context or {}), **shadow}
            return result

        metadata = resolve_exercise_metadata(exercise_id, exercise_name, exercise_record)
        rep_range = (
            RepRangeConfig(low=rep_range_override[0], high=rep_range_override[1])
            if rep_range_override
            else self._get_rep_range(metadata, goal_config)
        )

        if target == Decision.INCREASE_REPS:
            demoted = self._handle_increase_reps(latest_sets, num_sets, rep_range, metadata)
        elif target == Decision.MAINTAIN:
            demoted = self._handle_maintain(latest_sets, num_sets, metadata)
        else:
            return result

        shadow["readiness_applied"] = True
        demoted.reasoning_context = {
            **(demoted.reasoning_context or {}),
            **shadow,
            "readiness_demoted_from": result.decision.value,
        }
        demoted.confidence = result.confidence
        return demoted

    def _handle_maintain(
        self, latest_sets: List[Dict], num_sets: int, metadata: ExerciseMetadata
    ) -> ProgressionResult:
        """Repeat the last session. Reached only via readiness demotion."""
        template = latest_sets[: num_sets] or latest_sets
        sets = []
        for i in range(num_sets):
            source = template[i] if i < len(template) else template[-1]
            sets.append(
                RecommendedSet(
                    set_number=i + 1,
                    reps=int(source.get("reps") or 0),
                    weight=float(source.get("weight") or 0),
                )
            )
        return ProgressionResult(
            sets=sets,
            decision=Decision.MAINTAIN,
            confidence="medium",
            reasoning_context={"reason": "readiness_hold"},
        )


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
        exercise_record: Optional[Dict] = None,
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

        estimated = estimate_starting_weight(
            exercise_id, exercise_name, top_lifts, exercise_record=exercise_record
        )
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

    def _handle_cardio(
        self,
        exercise_id: str,
        exercise_name: str,
        recent_sessions: List[Dict],
        user_goal: str,
        focus_goal: Optional[str] = None,
    ) -> ProgressionResult:
        """
        Modality-aware cardio progression.

        Delegates to `cardio_progression`, which builds duration to the goal's
        target before touching pace and caps both. The old version here added a
        minute and half a mile per hour every session regardless of goal,
        modality or how the last one went.
        """
        prescription = compute_cardio_progression(
            exercise_id=exercise_id,
            exercise_name=exercise_name,
            history=recent_sessions or [],
            user_goal=user_goal,
            focus_goal=focus_goal,
        )
        return ProgressionResult(
            sets=[],
            decision=CARDIO_DECISIONS.get(
                prescription.decision, Decision.CARDIO_PROGRESS
            ),
            confidence=prescription.confidence,
            reasoning_context={
                "reason": prescription.context.get("reason", prescription.decision),
                **prescription.context,
                "guidance": prescription.guidance,
            },
            time=prescription.time,
            speed=prescription.speed,
            cardio_modality=prescription.modality.value,
            target_intensity=prescription.target_intensity,
            guidance=prescription.guidance,
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

        # Add 1 rep per set. The band is a target to climb to, never a ceiling
        # to be pushed back under: the old min(prev + 1, rep_range.high) handed
        # someone who had just done 11 reps a prescription of 10 — a decrease,
        # labelled "rep increase" — and under a strength band it answered 11
        # with 6. Bodyweight work has no load to add, so clamping the one
        # variable that can progress is a dead end by construction.
        new_sets = []
        swept_band = True
        for i in range(num_sets):
            if i < len(latest_sets):
                prev_reps = latest_sets[i].get("reps") or rep_range.low
            else:
                prev_reps = rep_range.low
            if prev_reps < rep_range.high:
                swept_band = False
            new_reps = prev_reps + 1
            new_sets.append(RecommendedSet(
                set_number=i + 1,
                reps=new_reps,
                weight=0,
                rep_low=rep_range.low,
                rep_high=rep_range.high,
                preferred_reps=new_reps,
            ))

        # Past the top of the band, reps are no longer the useful variable.
        # Say so rather than silently prescribing an ever-longer set.
        guidance = None
        if swept_band:
            guidance = (
                "You are working above the top of this rep range on bodyweight "
                "alone — add external load (belt, vest or held plate) and rebuild "
                f"from {rep_range.low} reps."
            )

        return ProgressionResult(
            sets=new_sets,
            decision=Decision.BODYWEIGHT_PROGRESS,
            confidence="high",
            guidance=guidance,
            reasoning_context={
                "reason": "bodyweight_rep_increase",
                "prev_reps": [s.get("reps", 0) for s in latest_sets[:num_sets]],
                "new_reps": [s.reps for s in new_sets],
                "rep_range": (rep_range.low, rep_range.high),
                "above_band": swept_band,
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
        strategy: ProgressionStrategy = ProgressionStrategy.BAND,
    ) -> ProgressionResult:
        """Ceiling reached → move the load up and re-enter the band at its floor."""
        max_weight = max((s.get("weight", 0) for s in latest_sets), default=0)
        # Round to weight resolution (5 lbs for all standard equipment)
        resolution = self._weight_resolution(metadata)
        new_weight = self._round_to_increment(max_weight + increment, resolution)

        if strategy == ProgressionStrategy.TOP_SET:
            sets, branch = self._top_set_shape(
                num_sets, rep_range, new_weight, metadata, aim=rep_range.low
            )
        else:
            sets = self._straight_sets(num_sets, rep_range, new_weight, aim=rep_range.low)
            branch = Branch(
                condition=f"All {num_sets} sets at {rep_range.high} reps",
                action=f"Move up to {new_weight + increment:g} lbs next session",
                kind="earn_weight",
            )

        return ProgressionResult(
            sets=sets,
            decision=Decision.INCREASE_WEIGHT,
            confidence="high",
            strategy=strategy.value,
            branch=branch,
            reasoning_context={
                "reason": "increase_weight",
                "prev_weight": max_weight,
                "new_weight": new_weight,
                "increment": increment,
                "reset_reps": rep_range.low,
                "rep_range": (rep_range.low, rep_range.high),
            },
        )

    def _straight_sets(
        self,
        num_sets: int,
        rep_range: RepRangeConfig,
        weight: float,
        aim: int,
    ) -> List[RecommendedSet]:
        """One load, one aim, one band across every set."""
        return [
            RecommendedSet(
                set_number=i + 1,
                reps=aim,
                weight=weight,
                rep_low=rep_range.low,
                rep_high=rep_range.high,
                role="straight",
                preferred_reps=aim,
            )
            for i in range(num_sets)
        ]

    def _top_set_shape(
        self,
        num_sets: int,
        rep_range: RepRangeConfig,
        top_weight: float,
        metadata: ExerciseMetadata,
        aim: int,
    ) -> tuple:
        """
        One heavy set to chase, the rest backed off — and an explicit
        instruction for the likely case where the top set does not go.
        """
        resolution = self._weight_resolution(metadata)
        backoff_weight = self._round_to_increment(top_weight * 0.9, resolution)
        # A backoff that rounds onto the top set is not a backoff.
        if backoff_weight >= top_weight:
            backoff_weight = max(0.0, top_weight - resolution)

        sets = [
            RecommendedSet(
                set_number=1,
                reps=aim,
                weight=top_weight,
                rep_low=rep_range.low,
                rep_high=rep_range.high,
                role="top",
                preferred_reps=aim,
            )
        ]
        for i in range(1, num_sets):
            sets.append(
                RecommendedSet(
                    set_number=i + 1,
                    reps=rep_range.high,
                    weight=backoff_weight,
                    rep_low=rep_range.low,
                    rep_high=rep_range.high,
                    role="backoff",
                    preferred_reps=rep_range.high,
                )
            )

        branch = Branch(
            condition=f"If set 1 stops short of {aim} reps",
            action=(
                f"Drop to {backoff_weight:g} lbs and finish at {rep_range.high} reps"
                if num_sets > 1
                else f"Drop to {backoff_weight:g} lbs for {rep_range.high} reps"
            ),
            kind="miss_drop",
        )
        return sets, branch

    def _handle_band_work(
        self,
        latest_sets: List[Dict],
        num_sets: int,
        rep_range: RepRangeConfig,
        increment: float,
        metadata: ExerciseMetadata,
        outcome: SessionOutcome,
        strategy: ProgressionStrategy,
    ) -> ProgressionResult:
        """
        Hold the load and work the band. The aim moves with where the last
        session actually landed, rather than adding one rep to every set every
        time regardless of what happened.
        """
        # A load the user actually logged is a valid load on their equipment.
        # Do not round 12 lb down to 10 merely because generic cable metadata
        # assumes 5 lb increments. Resolution matters when moving to a NEW
        # load, not while adding reps at the same proven load.
        weight = max((s.get("weight", 0) for s in latest_sets), default=0)
        reps = [int(s.get("reps") or 0) for s in latest_sets if (s.get("reps") or 0) > 0]
        lowest = min(reps) if reps else rep_range.low
        typical = int(median(reps)) if reps else rep_range.low

        if outcome == SessionOutcome.AT_TOP:
            # One clean sweep away from earning the weight — say exactly that.
            aim = rep_range.high
            decision = Decision.INCREASE_REPS
            reason = "close_out_band"
        elif outcome == SessionOutcome.IN_BAND:
            # Anchored to the typical set, not the worst one. Anchoring to the
            # worst set strands anyone who reliably drops a rep somewhere in
            # the session: their weakest set never improves, so the aim never
            # moves, and they sit at one number for months.
            aim = min(typical + 1, rep_range.high)
            decision = Decision.INCREASE_REPS
            reason = "advance_in_band"
        else:  # PARTIAL — some sets fell through the floor
            aim = rep_range.low
            decision = Decision.FILL_BAND
            reason = "fill_band"

        if strategy == ProgressionStrategy.TOP_SET:
            sets, branch = self._top_set_shape(
                num_sets, rep_range, weight, metadata, aim=aim
            )
        else:
            sets = self._straight_sets(num_sets, rep_range, weight, aim=aim)
            next_weight = self._round_to_increment(
                weight + increment, self._weight_resolution(metadata)
            )
            branch = Branch(
                condition=f"All {num_sets} sets at {rep_range.high} reps",
                action=f"Move up to {next_weight:g} lbs next session",
                kind="earn_weight" if outcome != SessionOutcome.PARTIAL else "fill_band",
            )

        options = [{
            "kind": "target",
            "label": "Target",
            "weight": weight,
            "reps": aim,
        }]
        if rep_range.high > aim:
            options.append({
                "kind": "stretch",
                "label": "If strong",
                "weight": weight,
                "reps": rep_range.high,
            })

        return ProgressionResult(
            sets=sets,
            decision=decision,
            confidence="high",
            strategy=strategy.value,
            branch=branch,
            progression_options=options,
            reasoning_context={
                "reason": reason,
                "outcome": outcome.value,
                "weight": weight,
                "aim": aim,
                "prev_reps": [int(s.get("reps") or 0) for s in latest_sets[:num_sets]],
                "lowest_last_session": lowest,
                "rep_range": (rep_range.low, rep_range.high),
                "band": describe_band(rep_range.low, rep_range.high),
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
        last_weight = last_available.get("weight", max_weight)

        new_sets = []
        for i in range(num_sets):
            if i < len(latest_sets):
                prev_reps = latest_sets[i].get("reps", rep_range.low)
                prev_weight = latest_sets[i].get("weight", max_weight)
            else:
                # Pad with last set's data for consistency (not rep_range.low)
                prev_reps = last_reps
                prev_weight = last_weight
            # Add a rep, but never hand back fewer than were already done at
            # this load. A set sitting above the band's top gets held, not
            # rolled backwards — adding load is the other branch's job.
            new_reps = max(prev_reps, min(prev_reps + 1, rep_range.high))
            new_sets.append(RecommendedSet(
                set_number=i + 1,
                reps=new_reps,
                weight=prev_weight,
                rep_low=rep_range.low,
                rep_high=rep_range.high,
                preferred_reps=new_reps,
            ))

        target_reps = max((s.reps for s in new_sets), default=rep_range.low)
        options = [{
            "kind": "target",
            "label": "Target",
            "weight": max_weight,
            "reps": target_reps,
        }]
        if rep_range.high > target_reps:
            options.append({
                "kind": "stretch",
                "label": "If strong",
                "weight": max_weight,
                "reps": rep_range.high,
            })

        return ProgressionResult(
            sets=new_sets,
            decision=Decision.INCREASE_REPS,
            confidence="high",
            progression_options=options,
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
        regressions: Optional[int] = None,
    ) -> ProgressionResult:
        """
        Handle a session that went backwards.
        Count consecutive failures — if >= threshold, hold (MAINTAIN).
        Below threshold, go again at this load for what was managed last time.
        """
        threshold = goal_config.consecutive_failures_to_hold

        if force_failure:
            consecutive_failures = threshold  # Treat as immediate hold
        elif regressions is not None:
            consecutive_failures = regressions
        else:
            consecutive_failures = count_regressions(recent_sessions, rep_range)

        latest_sets = recent_sessions[0].get("sets", [])
        max_weight = max((s.get("weight", 0) for s in latest_sets), default=0)

        if consecutive_failures >= threshold:
            # Repeated sessions under the band. This used to re-serve the best
            # recent session verbatim — which is a closed loop: prescribing the
            # 9/8/8 that just failed a 12-15 band produces another failure and
            # another hold, forever, with nothing on the card acknowledging the
            # gap. Two ways out, chosen by how big that gap is.
            current = typical_reps(latest_sets)
            deficit = rep_range.low - int(current) if current is not None else 0

            if (
                deficit >= LOAD_MISMATCH_REPS
                and increment > 0
                and max_weight > 0
            ):
                # The load, not the effort, is what the band cannot survive.
                # Roughly 3% of load per rep of deficit, capped so this stays a
                # correction rather than a deload, then onto the exercise's grid.
                resolution = self._weight_resolution(metadata)
                factor = max(0.85, 1.0 - 0.03 * deficit)
                reduced = self._round_to_increment(max_weight * factor, resolution)
                # Rounding must not land back on the weight that just failed.
                if reduced >= max_weight:
                    reduced = self._round_to_increment(
                        max_weight - resolution, resolution
                    )
                reduced = max(resolution, reduced)

                if reduced < max_weight:
                    sets = self._straight_sets(
                        num_sets, rep_range, reduced, aim=rep_range.low
                    )
                    return ProgressionResult(
                        sets=sets,
                        decision=Decision.REDUCE_LOAD,
                        confidence="medium",
                        strategy=ProgressionStrategy.BAND.value,
                        progression_options=[{
                            "kind": "target",
                            "label": "Target",
                            "weight": reduced,
                            "reps": rep_range.low,
                        }],
                        branch=Branch(
                            condition=f"If {rep_range.low} reps goes easily",
                            action=f"Return to {max_weight:g} lbs next session",
                            kind="fill_band",
                        ),
                        reasoning_context={
                            "reason": "load_above_band",
                            "consecutive_failures": consecutive_failures,
                            "threshold": threshold,
                            "prev_weight": max_weight,
                            "weight": reduced,
                            "reps_short": deficit,
                            "aim": rep_range.low,
                            "rep_range": (rep_range.low, rep_range.high),
                        },
                    )

            # Short of the band, but only just. Hold the load and bridge one rep
            # at a time toward the floor — carrying the band on the sets so the
            # card can show what is actually being aimed at.
            best_session = self._find_best_recent_session(recent_sessions[:5])
            best_sets = best_session.get("sets", []) if best_session else latest_sets
            last_best = best_sets[-1] if best_sets else {}

            sets = []
            for i in range(num_sets):
                source = best_sets[i] if i < len(best_sets) else last_best
                weight = source.get("weight", max_weight)
                prev_reps = source.get("reps") or rep_range.low
                reps = max(prev_reps, min(prev_reps + 1, rep_range.high))
                sets.append(RecommendedSet(
                    set_number=i + 1,
                    reps=reps,
                    weight=weight,
                    rep_low=rep_range.low,
                    rep_high=rep_range.high,
                    preferred_reps=reps,
                ))

            return ProgressionResult(
                sets=sets,
                decision=Decision.MAINTAIN,
                confidence="medium",
                strategy=ProgressionStrategy.BAND.value,
                reasoning_context={
                    "reason": "maintain_after_failures",
                    "consecutive_failures": consecutive_failures,
                    "threshold": threshold,
                    "weight": max_weight,
                    "reps_short": max(0, deficit),
                    "rep_range": (rep_range.low, rep_range.high),
                },
            )
        else:
            # One step back, not yet often enough to hold. Stay at this load and
            # go for what was managed the session before.
            #
            # This used to re-serve the *previous* session's weights as well as
            # its reps, which is how a lifter who had just moved up got handed
            # back the load they had outgrown. The load they last worked is the
            # right one to try again; only the rep target rewinds.
            weight = max_weight

            prev_typical = None
            if len(recent_sessions) >= 2:
                prev_typical = typical_reps(recent_sessions[1].get("sets") or [])
            current_typical = typical_reps(latest_sets)
            target = prev_typical if prev_typical is not None else current_typical
            aim = int(target) if target is not None else rep_range.low
            aim = max(rep_range.low, min(aim, rep_range.high))

            sets = self._straight_sets(num_sets, rep_range, weight, aim=aim)
            options = [{
                "kind": "target",
                "label": "Target",
                "weight": weight,
                "reps": aim,
            }]
            if rep_range.high > aim:
                options.append({
                    "kind": "stretch",
                    "label": "If strong",
                    "weight": weight,
                    "reps": rep_range.high,
                })

            return ProgressionResult(
                sets=sets,
                decision=Decision.INCREASE_REPS,
                confidence="medium",
                strategy=ProgressionStrategy.BAND.value,
                progression_options=options,
                branch=Branch(
                    condition=f"If {aim} reps will not go again",
                    action="Hold this load once more before backing it off",
                    kind="fill_band",
                ),
                reasoning_context={
                    "reason": "retry_after_failure",
                    "consecutive_failures": consecutive_failures,
                    "threshold": threshold,
                    "weight": max_weight,
                    "aim": aim,
                    "rep_range": (rep_range.low, rep_range.high),
                },
            )

    def _count_consecutive_failures(
        self, recent_sessions: List[Dict], rep_range: RepRangeConfig
    ) -> int:
        """
        Count consecutive recent sessions that fell through the band floor.

        Judged against the band rather than against the previous session's
        total volume: dropping volume because the load went up is not a
        failure, and counting it as one is what used to roll a lifter back to
        the weight they had just outgrown.
        """
        failures = 0
        for session in recent_sessions:
            outcome = evaluate_session(session.get("sets") or [], rep_range)
            if outcome == SessionOutcome.BELOW:
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
        # Identical numbers are only a problem when there is headroom left in
        # the band. A prescription already sitting at the ceiling has nowhere
        # to go on reps, and inventing a bump there is how the engine ended up
        # telling people to "add a rep" at a cap they had already hit.
        if evaluate_session(latest_sets[:n], rep_range) in (
            SessionOutcome.SWEPT_TOP,
            SessionOutcome.AT_TOP,
        ):
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
