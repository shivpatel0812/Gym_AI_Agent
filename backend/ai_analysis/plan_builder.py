"""
Plan Builder - turns an AI Coach conversation into a structured Active Plan.

The LLM decides *intent*: which days emphasise what, which lifts are the
priority, what rep ranges express the goal. It never decides weights — the
deterministic ProgressionEngine does that from workout history.

Output is validated against a strict schema before it is ever shown to the
user, because these fields drive real training behaviour.
"""

import copy
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
        history_context: Optional[Dict] = None,
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

        if history_context and history_context.get("exercises"):
            sections.append(
                "WHAT THEY ACTUALLY TRAIN (read from every logged session, not from "
                "day labels — this is the most reliable record of their real routine):\n"
                + json.dumps(history_context["exercises"], indent=2, default=str)
                + "\nPrefer these exercises. They are movements the user has chosen, "
                "knows how to perform, and has load history for, which is what makes "
                "progression possible from day one."
            )
            coverage = history_context.get("coverage") or {}
            if coverage.get("untrained"):
                sections.append(
                    "MUSCLE COVERAGE GAP:\nNothing in their logs trains: "
                    + ", ".join(coverage["untrained"])
                    + f" (lower-body sessions logged: {coverage.get('lower_body_sessions', 0)}).\n"
                    "There is therefore no history to copy for these. Program them "
                    "anyway when the plan calls for them, choosing conservative "
                    "catalog movements and starting loads, and say in `changes` that "
                    "this is new work rather than something carried over."
                )
            if history_context.get("labels_to_distrust"):
                sections.append(
                    "UNRELIABLE DAY LABELS:\nThese exercises are logged under more than "
                    "one day name, so CURRENT SPLIT's day contents are partly mislabelled "
                    "and must not be treated as ground truth:\n"
                    + json.dumps(history_context["labels_to_distrust"], indent=2)
                    + "\nAssign each movement to the day it belongs on, not the day it "
                    "happens to have been logged under."
                )

        referenced = split_context.get("referenced_workouts") or [split_context.get("referenced_workout")]
        if any(item and item.get("found") for item in referenced):
            sections.append(
                "REFERENCED WORKOUT REQUIREMENT:\nThe user selected one or more logged workouts "
                "as source templates. For each item in referenced_workouts, preserve every "
                "exercise in its original order on that item's target_day. You may add supporting work in adapt/build "
                "modes, but do not omit a source exercise unless the user explicitly asked "
                "to remove it; list any such removal in changes. Weighted and bodyweight "
                "sets of the same exercise are one exercise with coordinated progression, "
                "not duplicate plan entries."
            )

        if existing_plan:
            sections.append(
                "EXISTING ACTIVE PLAN (you are revising this, not starting over):\n"
                + json.dumps(existing_plan, indent=2, default=str)
            )
            existing_days = [
                day["day_name"]
                for day in (existing_plan.get("days") or [])
                if day.get("day_name")
            ]
            if existing_days:
                sections.append(
                    "EXISTING DAY REQUIREMENT:\nA conversation about two days is not a "
                    "request to delete the rest. Return every one of these days, carrying "
                    "any the conversation did not mention over unchanged:\n"
                    + json.dumps(existing_days, indent=2)
                    + "\nTo drop a day you must say so explicitly with a "
                    '{"action": "removed", "day_name": "<day>", "exercise_name": null} '
                    "entry in changes, and only when the user actually asked for it."
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
- Days in the existing plan the conversation never mentions come back unchanged
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
    def _name_to_id(
        split_context: Dict, history_context: Optional[Dict] = None
    ) -> Dict[str, str]:
        """
        Name -> exercise_id, preferring ids the user's own logs already use.

        Layered weakest to strongest: the default catalog, then everything they
        have ever logged, then the split in front of us. Without the history
        layer a custom movement the user trains weekly resolves to nothing and
        is silently dropped from their plan, because it is not in the 135-entry
        default catalog and may not appear in whichever split was loaded.
        """
        mapping = dict(CATALOG_BY_NAME)
        for entry in (history_context or {}).get("exercises", []) or []:
            name = str(entry.get("exercise_name") or "").strip().lower()
            if name and entry.get("exercise_id"):
                mapping[name] = entry["exercise_id"]
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
        history_context: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """Generate a plan. Returns {status, plan} or {status, error}."""
        if plan_mode not in PLAN_MODES:
            plan_mode = DEFAULT_PLAN_MODE

        prompt = self._build_prompt(
            conversation, split_context, profile, history_summary,
            plan_mode, existing_plan, adjustment_request, history_context,
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
                # Revisions must re-emit the days they are carrying over, so a
                # five-day plan needs more room than a fresh two-day proposal.
                max_tokens=4000,
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
            name_to_id=self._name_to_id(split_context, history_context),
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

        # The prompt asks for untouched days back; this guarantees it.
        plan = PlanBuilder.carry_forward_days(plan, existing_plan)

        return {
            "status": "success",
            "plan": plan,
            "tokens_used": getattr(response.usage, "total_tokens", 0),
        }

    # How much of a day's work a proposed day must contain before it counts as
    # that same day under a new name. High enough that Push and Pull can never
    # be confused; low enough to survive a couple of swapped accessories.
    SAME_DAY_OVERLAP = 0.6

    @staticmethod
    def _day_exercise_keys(day: Dict) -> set:
        return {
            str(ex.get("exercise_id") or ex.get("exercise_name") or "").strip().lower()
            for ex in (day or {}).get("exercises") or []
            if ex.get("exercise_id") or ex.get("exercise_name")
        }

    @staticmethod
    def _same_day_renamed(
        source: Dict, proposed_days: List[Dict], claimed: set
    ) -> Optional[str]:
        """
        The proposed day that is this existing day renamed, if there is one.

        Judged on contents rather than the name, because the name is the thing
        that changed. Returns the matched day's key so the caller can mark it
        used — one proposed day cannot stand in for two existing ones.
        """
        source_keys = PlanBuilder._day_exercise_keys(source)
        if not source_keys:
            return None

        best, best_overlap = None, 0.0
        for day in proposed_days:
            key = str(day.get("day_name", "")).strip().lower()
            if not key or key in claimed:
                continue
            overlap = len(source_keys & PlanBuilder._day_exercise_keys(day)) / len(
                source_keys
            )
            if overlap > best_overlap:
                best, best_overlap = key, overlap

        return best if best_overlap >= PlanBuilder.SAME_DAY_OVERLAP else None

    @staticmethod
    def carry_forward_days(plan: Dict, existing_plan: Optional[Dict]) -> Dict:
        """
        Restore training days the proposal dropped without saying so.

        A proposal is built from one conversation, and a conversation about two
        days produces a two-day plan. Left alone, asking the coach to import a
        Push and a Pull workout deletes Legs — which the user never asked for
        and which nothing tells them about, since the day is simply absent.

        A day only disappears here if the model explicitly declared it removed,
        so intentional removals still work. Everything carried back is recorded
        in `changes` and in `carried_forward_days`, because a plan that quietly
        edits itself is the problem this method exists to fix.
        """
        existing_days = [
            day for day in ((existing_plan or {}).get("days") or [])
            if isinstance(day, dict) and day.get("day_name")
        ]
        if not existing_days:
            return plan

        present = {
            str(day.get("day_name")).strip().lower() for day in plan.get("days") or []
        }
        declared_removed = {
            str(change.get("day_name")).strip().lower()
            for change in plan.get("changes") or []
            if str(change.get("action") or "").startswith("remov")
            and change.get("day_name")
            and not change.get("exercise_name")  # a named exercise is not the day
        }

        days = list(plan.get("days") or [])
        # A day the model renamed is still that day. Matching on the name alone
        # restored "Pull A" alongside the "Pull" that replaced it — two
        # near-identical days, one of them unschedulable. Each proposed day can
        # absorb at most one existing day, so two similar days cannot both be
        # collapsed into one silently.
        claimed = {
            str(day.get("day_name")).strip().lower()
            for day in days
            if str(day.get("day_name", "")).strip().lower() in
            {str(d["day_name"]).strip().lower() for d in existing_days}
        }
        renamed = set()
        for source in existing_days:
            key = str(source["day_name"]).strip().lower()
            if key in present or key in declared_removed:
                continue
            match = PlanBuilder._same_day_renamed(source, days, claimed)
            if match:
                claimed.add(match)
                renamed.add(key)

        carried = []
        for index, source in enumerate(existing_days):
            key = str(source["day_name"]).strip().lower()
            if key in present or key in declared_removed or key in renamed:
                continue
            # Reinsert where it sat before, so Legs lands between Push and Pull
            # rather than being appended after everything else.
            days.insert(min(index, len(days)), copy.deepcopy(source))
            carried.append(source["day_name"])

        if not carried:
            return plan

        plan["days"] = days
        plan["carried_forward_days"] = carried

        # A carried day that nothing schedules is present but never trained, so
        # give it back its old weekday when that slot is still free.
        old_schedule = (existing_plan or {}).get("weekly_schedule") or {}
        schedule = plan.get("weekly_schedule") or {}
        for day_name in carried:
            if day_name in schedule.values():
                continue
            for weekday in DAYS_OF_WEEK:
                if old_schedule.get(weekday) == day_name and str(
                    schedule.get(weekday, "Rest")
                ).lower() == "rest":
                    schedule[weekday] = day_name
                    break
        plan["weekly_schedule"] = schedule

        plan["changes"] = (plan.get("changes") or []) + [
            {
                "action": "preserved",
                "day_name": day_name,
                "exercise_name": None,
                "replaces": None,
                "reason": "Kept from your previous plan — this conversation did not mention it.",
            }
            for day_name in carried
        ]
        return plan

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
        # Exercises the model asked for that we could not honour. Previously
        # these vanished with only a print, so a plan could claim in `changes`
        # to have added a lift that is nowhere in it.
        dropped: List[Dict[str, Any]] = []
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
                    dropped.append({
                        "day_name": str(day["day_name"]),
                        "exercise_name": exercise_name or "(unnamed)",
                        "reason": "not a known exercise, and no id we could match it to",
                    })
                    continue
                # Accept catalog ids, plus custom ids the split legitimately uses
                known = validate_exercise_id(exercise_id) or (
                    allowed_ids is not None and exercise_id in allowed_ids
                )
                if allowed_ids is not None and exercise_id not in allowed_ids:
                    dropped.append({
                        "day_name": str(day["day_name"]),
                        "exercise_name": exercise_name or exercise_id,
                        "reason": "not in your split, and this mode cannot add exercises",
                    })
                    continue
                if allowed_ids is None and not known and not exercise_name:
                    dropped.append({
                        "day_name": str(day["day_name"]),
                        "exercise_name": exercise_id,
                        "reason": "unrecognised exercise with no name",
                    })
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
                # Destination finish line — weight and reps travel together.
                try:
                    tw = float(ex.get("target_weight")) if ex.get("target_weight") is not None else None
                except (TypeError, ValueError):
                    tw = None
                tr = PlanBuilder._clamp(ex.get("target_reps"), 1, 30, None)
                if tw is not None and tw > 0 and tr is not None:
                    entry["target_weight"] = round(tw, 1)
                    entry["target_reps"] = tr
                    twk = PlanBuilder._clamp(ex.get("target_weeks"), 1, 16, None)
                    if twk is not None:
                        entry["target_weeks"] = twk
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
        plan["changes"] = PlanBuilder._verify_changes(changes, days)
        if dropped:
            plan["dropped_exercises"] = dropped

        return plan

    # Change actions that assert an exercise is now present in a day. `removed`
    # is deliberately absent: it asserts the opposite.
    PRESENCE_ACTIONS = ("added", "swapped", "reordered", "rep_range", "frequency")

    @staticmethod
    def _verify_changes(changes: List[Dict], days: List[Dict]) -> List[Dict]:
        """
        Drop claims the plan itself contradicts.

        A real one from a shipped plan: `changes` said "added Cable Rear Delt
        Flyes to Pull A" and Pull A contained no such exercise. The user reads
        the changelog, believes the lift is programmed, and never finds it. The
        model's narration is not evidence about the model's output, so anything
        it asserts is checked against the days actually returned.
        """
        by_day = {
            str(day.get("day_name", "")).strip().lower(): {
                str(ex.get("exercise_name", "")).strip().lower()
                for ex in day.get("exercises") or []
            }
            for day in days
        }

        verified = []
        for change in changes:
            action = str(change.get("action") or "").lower()
            day_name = change.get("day_name")
            exercise_name = change.get("exercise_name")

            if action in PlanBuilder.PRESENCE_ACTIONS and day_name and exercise_name:
                present = by_day.get(str(day_name).strip().lower())
                # An unknown day is a separate problem the schedule pass handles;
                # only contradict a claim about a day we actually returned.
                if present is not None and str(exercise_name).strip().lower() not in present:
                    print(
                        f"[PlanBuilder] Dropped unsupported change: "
                        f"{action} {exercise_name!r} on {day_name!r}"
                    )
                    continue
            verified.append(change)
        return verified

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
