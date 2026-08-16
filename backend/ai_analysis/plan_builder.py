"""
Plan Builder - turns an AI Coach conversation into a structured Active Plan.

The LLM decides *intent*: which days emphasise what, which lifts are the
priority, what rep ranges express the goal. It never decides weights — the
deterministic ProgressionEngine does that from workout history.

Output is validated against a strict schema before it is ever shown to the
user, because these fields drive real training behaviour.
"""

import json
from datetime import datetime
from typing import Dict, List, Any, Optional

from openai import OpenAI

from data.default_exercises import validate_exercise_id, EXERCISE_BY_ID

# Catalog lookup by name, so a plan that names an exercise instead of using its
# id can still be linked to the real exercise the user logs against.
CATALOG_BY_NAME = {
    str(ex.get("name", "")).strip().lower(): ex_id
    for ex_id, ex in EXERCISE_BY_ID.items()
    if ex.get("name")
}

# How closely the plan must follow the user's Current Split
PLAN_MODES = {
    "follow_split": (
        "FOLLOW MY SPLIT. Keep the user's existing workouts and exercises intact. "
        "You may reorder exercises, set per-exercise goals, rep ranges, priorities, "
        "day types and progression intent. Do NOT add, remove or swap exercises, "
        "and do NOT change which days they train."
    ),
    "adapt_split": (
        "ADAPT MY SPLIT. Use the existing split as the foundation. You may add, "
        "remove or swap individual exercises, change how often a lift is trained, "
        "and reorganise days where it clearly serves the goal. Keep the overall "
        "shape of their routine recognisable, and justify every change."
    ),
    "build_for_me": (
        "BUILD FOR ME. You have broad freedom to design the best program for the "
        "goal, while still respecting their training history, preferred exercises, "
        "available equipment and weekly schedule."
    ),
}
DEFAULT_PLAN_MODE = "adapt_split"

VALID_GOALS = {"strength", "hypertrophy", "fat_loss", "general"}
VALID_PRIORITIES = {"high", "supporting", "normal"}
VALID_DAY_TYPES = {"heavy", "volume", "light", "normal", "deload"}
DAYS_OF_WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

MAX_DURATION_WEEKS = 24
DEFAULT_DURATION_WEEKS = 6


class PlanBuilder:
    """Generates and validates goal-based training plans."""

    def __init__(self, api_key: str, model: str = "gpt-4o"):
        self.client = OpenAI(api_key=api_key)
        self.model = model

    # --- prompt ------------------------------------------------------------

    def _build_prompt(
        self,
        conversation: List[Dict],
        split_context: Dict,
        profile: Dict,
        history_summary: Dict,
        plan_mode: str,
        existing_plan: Optional[Dict] = None,
        adjustment_request: Optional[str] = None,
    ) -> str:
        transcript = "\n".join(
            f"{m.get('role', 'user').upper()}: {m.get('content', '')}"
            for m in (conversation or [])
            if m.get("content")
        ) or "(no conversation — infer the goal from the profile)"

        sections = [
            f"MODE:\n{PLAN_MODES.get(plan_mode, PLAN_MODES[DEFAULT_PLAN_MODE])}",
            f"COACH CONVERSATION (the goal comes from here):\n{transcript}",
            f"USER PROFILE:\n{json.dumps(profile, indent=2, default=str)}",
            f"CURRENT SPLIT (their normal routine):\n{json.dumps(split_context, indent=2, default=str)}",
            f"RECENT TRAINING SUMMARY:\n{json.dumps(history_summary, indent=2, default=str)}",
        ]

        if existing_plan:
            sections.append(
                "EXISTING ACTIVE PLAN (you are revising this, not starting over):\n"
                + json.dumps(existing_plan, indent=2, default=str)
            )
        if adjustment_request:
            sections.append(f"REQUESTED ADJUSTMENT:\n{adjustment_request}")

        if plan_mode == "follow_split":
            allowed = self._allowed_exercises(split_context)
            if allowed:
                sections.append(
                    "You MUST only use these exercise_id values:\n"
                    + json.dumps(sorted(allowed), indent=2)
                )
            day_names = self._allowed_day_names(split_context)
            if day_names:
                sections.append(
                    "You MUST use exactly these day_name values and must not add, "
                    "rename, split or remove training days (splitting 'Push' into "
                    "'Push A' and 'Push B' is NOT allowed in this mode):\n"
                    + json.dumps(sorted(day_names), indent=2)
                )

        return "\n\n".join(sections) + """

Produce a training plan as JSON with exactly this shape:

{
  "plan_name": "short memorable name",
  "primary_goal": "one sentence stating the goal in the user's terms",
  "duration_weeks": 6,
  "split_type": "Push/Pull/Legs",
  "strategy": ["3-5 short bullets describing how the program attacks the goal"],
  "guidelines": ["3-5 short bullets on how to progress week to week"],
  "weekly_schedule": {
    "monday": "Push A", "tuesday": "Pull", "wednesday": "Rest",
    "thursday": "Push B", "friday": "Legs", "saturday": "Rest", "sunday": "Rest"
  },
  "days": [
    {
      "day_name": "Push A",
      "focus": "Chest / Shoulders / Triceps",
      "day_goal": "Incline strength",
      "day_type": "heavy",
      "goal": "hypertrophy",
      "exercises": [
        {
          "exercise_id": "must match an id given above",
          "exercise_name": "Incline Dumbbell Press",
          "sets": 4,
          "reps": 5,
          "order": 1,
          "goal": "strength",
          "priority": "high",
          "target_rep_range": [4, 6],
          "intensity": "heavy",
          "notes": "short cue"
        }
      ]
    }
  ],
  "changes": [
    {"action": "added|removed|swapped|reordered|frequency|rep_range",
     "day_name": "Push A", "exercise_name": "...", "replaces": "...",
     "reason": "why this serves the goal"}
  ]
}

RULES:
- "goal" must be one of: strength, hypertrophy, fat_loss, general
- "priority" must be one of: high, supporting, normal
- "day_type" must be one of: heavy, volume, light, normal, deload
- Put the priority lift EARLY in the day it matters most
- Give the priority lift a goal and rep range that match the stated aim; leave
  most accessories on the user's normal goal
- Never prescribe weights. Rep ranges and intent only.
- Every day_name in weekly_schedule (other than "Rest") must exist in days
- List every structural difference from the Current Split in "changes"
Return only the JSON object."""

    @staticmethod
    def _allowed_exercises(split_context: Dict) -> set:
        ids = set()
        for day in (split_context or {}).get("days", []) or []:
            for ex in day.get("exercises", []) or []:
                if ex.get("exercise_id"):
                    ids.add(ex["exercise_id"])
        return ids

    @staticmethod
    def _name_to_id(split_context: Dict) -> Dict[str, str]:
        """Name -> exercise_id, preferring ids the user's split already uses."""
        mapping = dict(CATALOG_BY_NAME)
        for day in (split_context or {}).get("days", []) or []:
            for ex in day.get("exercises", []) or []:
                name = str(ex.get("exercise_name") or "").strip().lower()
                if name and ex.get("exercise_id"):
                    mapping[name] = ex["exercise_id"]
        return mapping

    @staticmethod
    def _allowed_day_names(split_context: Dict) -> set:
        return {
            str(day["day_name"]).strip()
            for day in (split_context or {}).get("days", []) or []
            if day.get("day_name")
        }

    # --- generation --------------------------------------------------------

    def build_plan(
        self,
        conversation: List[Dict],
        split_context: Dict,
        profile: Dict,
        history_summary: Dict,
        plan_mode: str = DEFAULT_PLAN_MODE,
        existing_plan: Optional[Dict] = None,
        adjustment_request: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate a plan. Returns {status, plan} or {status, error}."""
        if plan_mode not in PLAN_MODES:
            plan_mode = DEFAULT_PLAN_MODE

        prompt = self._build_prompt(
            conversation, split_context, profile, history_summary,
            plan_mode, existing_plan, adjustment_request,
        )

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an expert strength coach who designs training "
                            "programs. You output strict JSON and never prescribe "
                            "specific weights — only structure, intent and rep ranges."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.4,
                max_tokens=3000,
                response_format={"type": "json_object"},
            )
            raw = json.loads(response.choices[0].message.content)
        except json.JSONDecodeError as e:
            return {"status": "error", "error": f"Plan was not valid JSON: {e}"}
        except Exception as e:
            return {"status": "error", "error": str(e)}

        strict = plan_mode == "follow_split"
        plan = PlanBuilder.validate_plan(
            raw,
            allowed_ids=self._allowed_exercises(split_context) if strict else None,
            allowed_day_names=self._allowed_day_names(split_context) if strict else None,
            name_to_id=self._name_to_id(split_context),
        )
        plan["plan_mode"] = plan_mode
        plan["plan_type"] = "goal"

        # Strict mode can legitimately drop everything if the model ignored the
        # constraints. Surface that rather than storing an empty plan — and say
        # which problem it actually was, since the fixes are different.
        if not plan["days"]:
            if strict and not self._allowed_exercises(split_context):
                return {
                    "status": "error",
                    "error": (
                        "We couldn't read the exercises in your current split, so there "
                        "was nothing to follow. Log a session against that split first, "
                        "or use Build For Me."
                    ),
                }
            return {
                "status": "error",
                "error": (
                    "The generated plan did not fit your split. Try again, or use "
                    "Adapt My Split to allow structural changes."
                ),
            }

        return {
            "status": "success",
            "plan": plan,
            "tokens_used": getattr(response.usage, "total_tokens", 0),
        }

    # --- validation --------------------------------------------------------

    @staticmethod
    def validate_plan(
        plan: Dict,
        allowed_ids: Optional[set] = None,
        allowed_day_names: Optional[set] = None,
        name_to_id: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """
        Coerce AI output into a plan that is safe to store and act on.

        Invalid enum values are dropped rather than guessed at, so a bad field
        falls through to the next layer of the resolver instead of silently
        changing how someone trains.
        """
        plan = dict(plan or {})

        # An empty constraint set means "we couldn't determine the split", not
        # "reject everything". Normalizing both to None keeps the two filters
        # consistent — otherwise an empty allowed_ids silently strips every
        # exercise while an empty allowed_day_names allows any day.
        allowed_ids = allowed_ids or None
        allowed_day_names = allowed_day_names or None

        plan["plan_name"] = str(plan.get("plan_name") or "Training Plan")[:80]
        plan["primary_goal"] = str(plan.get("primary_goal") or "").strip() or None
        plan["split_type"] = str(plan.get("split_type") or "Custom")[:40]

        try:
            weeks = int(plan.get("duration_weeks") or DEFAULT_DURATION_WEEKS)
        except (TypeError, ValueError):
            weeks = DEFAULT_DURATION_WEEKS
        plan["duration_weeks"] = max(1, min(MAX_DURATION_WEEKS, weeks))

        plan["strategy"] = PlanBuilder._string_list(plan.get("strategy"))
        plan["guidelines"] = PlanBuilder._string_list(plan.get("guidelines"))

        # --- days ---
        lowered_allowed_days = (
            {n.strip().lower() for n in allowed_day_names} if allowed_day_names else None
        )
        seen_day_names = set()
        days = []
        for day in plan.get("days") or []:
            if not isinstance(day, dict) or not day.get("day_name"):
                continue
            # In follow_split mode the model must not invent, rename or split
            # training days — that would change how often the user trains.
            if lowered_allowed_days is not None:
                if str(day["day_name"]).strip().lower() not in lowered_allowed_days:
                    print(f"[PlanBuilder] Dropped out-of-split day: {day['day_name']}")
                    continue

            exercises = []
            for ex in day.get("exercises") or []:
                if not isinstance(ex, dict):
                    continue
                exercise_id = str(ex.get("exercise_id") or "").strip()
                exercise_name = str(ex.get("exercise_name") or "").strip()

                # Models often put the display name in exercise_id. Repair it,
                # otherwise the plan only links to logged workouts through
                # fuzzy name matching, which breaks on renames and near-misses.
                if exercise_id and not validate_exercise_id(exercise_id):
                    lookup = (name_to_id or CATALOG_BY_NAME)
                    resolved = lookup.get(exercise_id.lower()) or lookup.get(
                        exercise_name.lower()
                    )
                    if resolved:
                        exercise_id = resolved
                if not exercise_id and exercise_name:
                    exercise_id = (name_to_id or CATALOG_BY_NAME).get(
                        exercise_name.lower(), ""
                    )
                if not exercise_id:
                    continue
                # Accept catalog ids, plus custom ids the split legitimately uses
                known = validate_exercise_id(exercise_id) or (
                    allowed_ids is not None and exercise_id in allowed_ids
                )
                if allowed_ids is not None and exercise_id not in allowed_ids:
                    continue
                if allowed_ids is None and not known and not exercise_name:
                    continue

                entry = {
                    "exercise_id": exercise_id,
                    "exercise_name": (exercise_name or "Exercise")[:80],
                    "sets": PlanBuilder._clamp(ex.get("sets"), 1, 10, 3),
                    "reps": PlanBuilder._clamp(ex.get("reps"), 1, 30, 8),
                    "order": len(exercises) + 1,
                }
                if ex.get("notes"):
                    entry["notes"] = str(ex["notes"])[:200]
                if ex.get("goal") in VALID_GOALS:
                    entry["goal"] = ex["goal"]
                if ex.get("priority") in VALID_PRIORITIES:
                    entry["priority"] = ex["priority"]
                if ex.get("intensity") in VALID_DAY_TYPES:
                    entry["intensity"] = ex["intensity"]
                rep_range = PlanBuilder._rep_range(ex.get("target_rep_range"))
                if rep_range:
                    entry["target_rep_range"] = rep_range
                exercises.append(entry)

            clean_day = {
                "day_name": str(day["day_name"])[:40],
                "focus": str(day.get("focus") or day["day_name"])[:80],
                "exercises": exercises,
                "estimated_duration_minutes": PlanBuilder._clamp(
                    day.get("estimated_duration_minutes"), 15, 180, max(30, len(exercises) * 8)
                ),
            }
            if day.get("day_goal"):
                clean_day["day_goal"] = str(day["day_goal"])[:80]
            if day.get("day_type") in VALID_DAY_TYPES:
                clean_day["day_type"] = day["day_type"]
            if day.get("goal") in VALID_GOALS:
                clean_day["goal"] = day["goal"]
            # A day with no exercises is not a usable training day; keeping it
            # produces a plan that looks real but prescribes nothing.
            if not exercises:
                print(f"[PlanBuilder] Dropped empty day: {clean_day['day_name']}")
                continue
            # Splits can list the same day twice; keep the first occurrence
            key = clean_day["day_name"].strip().lower()
            if key in seen_day_names:
                continue
            seen_day_names.add(key)
            days.append(clean_day)

        plan["days"] = days
        day_names = {d["day_name"] for d in days}

        # --- weekly schedule: only reference days that exist ---
        raw_schedule = plan.get("weekly_schedule") or {}
        schedule = {}
        for weekday in DAYS_OF_WEEK:
            value = raw_schedule.get(weekday)
            value = str(value).strip() if value else "Rest"
            if value.lower() == "rest" or value not in day_names:
                schedule[weekday] = "Rest"
            else:
                schedule[weekday] = value
        plan["weekly_schedule"] = schedule

        # --- changes ---
        changes = []
        for change in plan.get("changes") or []:
            if not isinstance(change, dict) or not change.get("action"):
                continue
            changes.append({
                "action": str(change["action"])[:20],
                "day_name": PlanBuilder._optional_text(change.get("day_name"), 40),
                "exercise_name": PlanBuilder._optional_text(change.get("exercise_name"), 80),
                "replaces": PlanBuilder._optional_text(change.get("replaces"), 80),
                "reason": PlanBuilder._optional_text(change.get("reason"), 200),
            })
        plan["changes"] = changes

        return plan

    # Models fill optional string fields with these instead of omitting them,
    # and they read as bugs when rendered ("replaces n/a")
    PLACEHOLDER_TEXT = {"n/a", "na", "none", "null", "-", "undefined", ""}

    @staticmethod
    def _optional_text(value: Any, limit: int) -> Optional[str]:
        """Return trimmed text, or None for a placeholder the model invented."""
        if value is None:
            return None
        text = str(value).strip()
        if text.lower() in PlanBuilder.PLACEHOLDER_TEXT:
            return None
        return text[:limit]

    @staticmethod
    def _string_list(value: Any, limit: int = 8) -> List[str]:
        if not isinstance(value, list):
            return []
        return [str(v).strip()[:200] for v in value if str(v).strip()][:limit]

    @staticmethod
    def _clamp(value: Any, low: int, high: int, fallback: int) -> int:
        try:
            return max(low, min(high, int(value)))
        except (TypeError, ValueError):
            return fallback

    @staticmethod
    def _rep_range(value: Any) -> Optional[List[int]]:
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            return None
        try:
            low, high = int(value[0]), int(value[1])
        except (TypeError, ValueError):
            return None
        if low <= 0 or high <= 0 or high > 50:
            return None
        return [min(low, high), max(low, high)]
