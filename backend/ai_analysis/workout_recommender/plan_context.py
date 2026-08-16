"""
Plan Context Resolver - the single place that answers "what is the intent for
this exercise today?"

The Active Plan supplies *intent* (goal, priority, rep-range, day type). The
deterministic ProgressionEngine still computes the exact weights and reps. No
LLM output ever becomes a number here.

Resolution order, most specific wins:

    1. Exercise-specific Active Plan context
    2. Workout/day Active Plan context
    3. Manual per-exercise training focus (an explicit user override)
    4. User's global profile goal
    5. Default fallback

Everything that needs plan intent goes through resolve(); special cases must
not be scattered across routers and engines.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple

from .goal_configs import is_known_goal, resolve_goal_key, DEFAULT_GOAL
from .training_focus import TrainingFocusStore

PLAN_COLLECTION = "workout_plans"

# Plan statuses whose intent should be applied to recommendations
LIVE_STATUSES = {"active"}

DAY_TYPE_TO_INTENSITY = {
    "heavy": "heavy",
    "volume": "normal",
    "light": "light",
    "deload": "light",
    "normal": "normal",
}


@dataclass
class PlanContext:
    """Resolved training intent for one exercise."""

    goal: str = DEFAULT_GOAL
    source: str = "default"  # plan_exercise | plan_day | training_focus | profile | default
    priority: Optional[str] = None
    target_rep_range: Optional[Tuple[int, int]] = None
    day_type: Optional[str] = None
    target_sets: Optional[int] = None
    notes: Optional[str] = None

    # Transparency — lets the UI say why a recommendation looks the way it does
    plan_id: Optional[str] = None
    plan_name: Optional[str] = None
    day_name: Optional[str] = None
    day_goal: Optional[str] = None

    @property
    def day_intensity(self) -> Optional[str]:
        """Map the plan's day_type onto the engine's intensity vocabulary."""
        if not self.day_type:
            return None
        return DAY_TYPE_TO_INTENSITY.get(str(self.day_type).lower())

    def to_dict(self) -> Dict[str, Any]:
        data = {
            "goal": self.goal,
            "source": self.source,
            "priority": self.priority,
            "day_type": self.day_type,
            "day_goal": self.day_goal,
            "plan_id": self.plan_id,
            "plan_name": self.plan_name,
            "day_name": self.day_name,
            "notes": self.notes,
        }
        if self.target_rep_range:
            data["target_rep_range"] = list(self.target_rep_range)
        return {k: v for k, v in data.items() if v is not None}


def normalize_rep_range(value: Any) -> Optional[Tuple[int, int]]:
    """
    Accept [low, high], (low, high), or "4-6" and return a sane (low, high).

    Returns None for anything unusable rather than guessing, so a malformed
    plan falls through to the goal config's range.
    """
    low = high = None

    if isinstance(value, (list, tuple)) and len(value) == 2:
        low, high = value[0], value[1]
    elif isinstance(value, str) and "-" in value:
        parts = value.split("-", 1)
        low, high = parts[0].strip(), parts[1].strip()
    else:
        return None

    try:
        low, high = int(low), int(high)
    except (TypeError, ValueError):
        return None

    if low <= 0 or high <= 0:
        return None
    if low > high:
        low, high = high, low
    if high > 50:
        return None
    return (low, high)


class PlanContextResolver:
    """Resolves Active Plan intent for a given exercise."""

    def __init__(self, db, user_id: str, focus_store: Optional[TrainingFocusStore] = None):
        self.db = db
        self.user_id = user_id
        self.focus_store = focus_store or TrainingFocusStore(db, user_id)
        self._plan: Optional[Dict[str, Any]] = None
        self._plan_loaded = False

    # --- plan lookup ------------------------------------------------------

    def get_active_plan(self) -> Optional[Dict[str, Any]]:
        """The user's live goal plan, or None. Cached per instance."""
        if self._plan_loaded:
            return self._plan

        self._plan_loaded = True
        self._plan = None
        try:
            docs = list(
                self.db.collection("users").document(self.user_id)
                .collection(PLAN_COLLECTION)
                .where("is_active", "==", True)
                .stream()
            )
        except Exception as e:
            print(f"Warning: could not read active plan: {e}")
            return None

        candidates = []
        for doc in docs:
            data = doc.to_dict() or {}
            data["id"] = doc.id
            status = data.get("status")
            # Legacy structural plans have no status; treat them as live so
            # existing behaviour is preserved.
            if status is None or status in LIVE_STATUSES:
                candidates.append(data)

        if not candidates:
            return None

        # Prefer a goal plan over a legacy structural one, then most recent
        candidates.sort(
            key=lambda p: (p.get("plan_type") == "goal", p.get("created_at") or ""),
            reverse=True,
        )
        self._plan = candidates[0]
        return self._plan

    # --- day / exercise lookup -------------------------------------------

    @staticmethod
    def _names_match(a: str, b: str) -> bool:
        a, b = (a or "").strip().lower(), (b or "").strip().lower()
        if not a or not b:
            return False
        return a == b or a in b or b in a

    def _find_day(self, plan: Dict, split_day: Optional[str]) -> Optional[Dict]:
        """The plan day for an explicit split day, else today's scheduled day."""
        days = plan.get("days") or []

        if split_day:
            for day in days:
                if self._names_match(day.get("day_name", ""), split_day):
                    return day
            return None

        schedule = plan.get("weekly_schedule") or {}
        today_name = schedule.get(datetime.now().strftime("%A").lower())
        if today_name and str(today_name).lower() != "rest":
            for day in days:
                if self._names_match(day.get("day_name", ""), today_name):
                    return day
        return None

    def _find_exercise(
        self, day: Optional[Dict], plan: Dict, exercise_id: str, exercise_name: str
    ) -> Tuple[Optional[Dict], Optional[Dict]]:
        """
        Locate the exercise entry, preferring the given day.

        Falls back to scanning every day so an exercise still resolves when the
        client doesn't say which day it belongs to. Returns (exercise, day).
        """
        def match(entry: Dict) -> bool:
            if exercise_id and entry.get("exercise_id") == exercise_id:
                return True
            return self._names_match(entry.get("exercise_name", ""), exercise_name)

        if day:
            for entry in day.get("exercises") or []:
                if match(entry):
                    return entry, day

        for candidate_day in plan.get("days") or []:
            for entry in candidate_day.get("exercises") or []:
                if match(entry):
                    return entry, candidate_day

        return None, day

    # --- resolution -------------------------------------------------------

    def resolve(
        self,
        exercise_id: str,
        exercise_name: str = "",
        split_day: Optional[str] = None,
        profile_goal: Optional[str] = None,
    ) -> PlanContext:
        """
        Resolve training intent for one exercise.

        Layers are applied least-specific first, so a more specific layer
        overrides only the fields it actually specifies.
        """
        # goal is always a canonical key ("fat_loss"), never a display alias
        # ("Lose Fat"), so every layer and the UI speak one vocabulary
        profile_known = is_known_goal(profile_goal or "")
        context = PlanContext(
            goal=resolve_goal_key(profile_goal) if profile_known else DEFAULT_GOAL,
            source="profile" if profile_known else "default",
        )

        # 3. Manual per-exercise focus overrides the profile goal
        focus = self.focus_store.get_focus_for_exercise(exercise_id, exercise_name)
        if focus and is_known_goal(focus.get("goal", "")):
            context.goal = resolve_goal_key(focus["goal"])
            context.source = "training_focus"
            context.notes = focus.get("note") or context.notes

        plan = self.get_active_plan()
        if not plan:
            return context

        day = self._find_day(plan, split_day)
        entry, entry_day = self._find_exercise(day, plan, exercise_id, exercise_name)
        day = entry_day or day

        # 2. Day-level plan intent
        if day:
            context.plan_id = plan.get("id")
            context.plan_name = plan.get("plan_name")
            context.day_name = day.get("day_name")
            context.day_goal = day.get("day_goal")
            context.day_type = day.get("day_type") or day.get("intensity")
            if is_known_goal(day.get("goal") or ""):
                context.goal = resolve_goal_key(day["goal"])
                context.source = "plan_day"

        # 1. Exercise-level plan intent (most specific)
        if entry:
            context.plan_id = plan.get("id")
            context.plan_name = plan.get("plan_name")
            if is_known_goal(entry.get("goal") or ""):
                context.goal = resolve_goal_key(entry["goal"])
                context.source = "plan_exercise"

            rep_range = normalize_rep_range(entry.get("target_rep_range"))
            if rep_range:
                context.target_rep_range = rep_range
                if context.source not in ("plan_exercise",):
                    context.source = "plan_exercise"

            if entry.get("priority"):
                context.priority = entry["priority"]
            if entry.get("intensity"):
                context.day_type = entry["intensity"]
            try:
                sets = int(entry.get("sets") or 0)
                if sets > 0:
                    context.target_sets = sets
            except (TypeError, ValueError):
                pass
            if entry.get("notes"):
                context.notes = entry["notes"]

        return context
