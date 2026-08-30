"""
Scoped, reviewable edits to one exercise in the Active Plan.

Two inputs write to the same plan and they are deliberately not equals:

  Plan Mode  is the editor of record for structure — which days exist, which
             exercises are in the program, what the goal is. It rebuilds.
  Coach chat is for micro-patches — this lift's target moved because of how
             the last session went. It may not restructure anything.

So the ops here can change intent on an exercise that is already in the plan
and nothing else. There is no op to add an exercise, remove one, or touch a
day, because a freeform chat turn should never be able to reshape a program
the user spent a guided conversation building.

Nothing here writes to Firestore. `normalize_edits` turns raw model output into
reviewable ops; `apply_edits` turns accepted ops into a new `days` list the
existing PATCH path validates and stores.
"""

import copy
import uuid
from typing import Any, Dict, List, Optional, Tuple

VALID_GOALS = {"strength", "hypertrophy", "fat_loss", "general"}
VALID_PRIORITIES = {"high", "supporting", "normal"}

# A patch set is meant to be reviewed at a glance, between sets if need be.
MAX_EDITS = 6

MIN_REPS, MAX_REPS = 1, 30
MIN_SETS, MAX_SETS = 1, 10

EDIT_STATUS_PENDING = "pending"
EDIT_STATUS_APPLIED = "applied"
EDIT_STATUS_DISMISSED = "dismissed"

SET_STATUS_PENDING = "pending"
SET_STATUS_APPLIED = "applied"
SET_STATUS_DISMISSED = "dismissed"
SET_STATUS_PARTIALLY_APPLIED = "partially_applied"
SET_STATUS_SUPERSEDED = "superseded"

# op -> the plan-exercise field it writes
OP_FIELDS = {
    "set_rep_range": "target_rep_range",
    "set_sets": "sets",
    "set_priority": "priority",
    "set_goal": "goal",
    "set_notes": "notes",
}


def _find_exercise(
    plan: Dict[str, Any], day_name: str, exercise_name: str
) -> Tuple[Optional[Dict], Optional[Dict]]:
    """The (day, exercise) a patch names, matched leniently on name or id."""
    wanted_day = str(day_name or "").strip().lower()
    wanted_ex = str(exercise_name or "").strip().lower()
    for day in plan.get("days") or []:
        if wanted_day and str(day.get("day_name", "")).strip().lower() != wanted_day:
            continue
        for exercise in day.get("exercises") or []:
            names = {
                str(exercise.get("exercise_name") or "").strip().lower(),
                str(exercise.get("exercise_id") or "").strip().lower(),
            }
            if wanted_ex in names:
                return day, exercise
    return None, None


def _clamp(value: Any, low: int, high: int) -> Optional[int]:
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return None


def _normalize_rep_range(value: Any) -> Optional[List[int]]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    low, high = _clamp(value[0], MIN_REPS, MAX_REPS), _clamp(value[1], MIN_REPS, MAX_REPS)
    if low is None or high is None:
        return None
    return [min(low, high), max(low, high)]


def _describe(op: str, exercise_name: str, value: Any) -> str:
    if op == "set_rep_range":
        return f"{exercise_name}: target {value[0]}-{value[1]} reps"
    if op == "set_sets":
        return f"{exercise_name}: {value} working sets"
    if op == "set_priority":
        return f"{exercise_name}: priority {value}"
    if op == "set_goal":
        return f"{exercise_name}: {str(value).replace('_', ' ')} focus"
    return f"{exercise_name}: coaching note updated"


def normalize_edits(
    plan: Optional[Dict[str, Any]], edits: Optional[List[Dict[str, Any]]]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Validate raw model output against the live plan.

    Returns (accepted, rejected). An edit naming an exercise that is not in the
    plan is rejected here rather than stored, so the user is never offered a
    patch that could not be applied — and the model is told, so it can say so
    instead of claiming the change was made.
    """
    if not plan:
        return [], [{"reason": "There is no active training plan to edit."}]

    accepted: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    seen: set = set()

    for raw in (edits or [])[: MAX_EDITS * 2]:
        if not isinstance(raw, dict):
            continue
        op = str(raw.get("op") or "").strip()
        day_name = str(raw.get("day_name") or "").strip()
        exercise_name = str(raw.get("exercise_name") or "").strip()

        if op not in OP_FIELDS:
            rejected.append({"op": op, "reason": f"'{op}' is not a supported edit."})
            continue
        if not exercise_name:
            rejected.append({"op": op, "reason": "No exercise named."})
            continue

        day, exercise = _find_exercise(plan, day_name, exercise_name)
        if not exercise:
            rejected.append({
                "op": op,
                "exercise_name": exercise_name,
                "reason": (
                    f"'{exercise_name}' is not in the active plan"
                    + (f" on {day_name}." if day_name else ".")
                    + " Coach chat can retarget existing lifts, not add new ones."
                ),
            })
            continue

        value: Any = raw.get("value")
        if op == "set_rep_range":
            value = _normalize_rep_range(value)
        elif op == "set_sets":
            value = _clamp(value, MIN_SETS, MAX_SETS)
        elif op == "set_priority":
            value = str(value or "").strip().lower()
            value = value if value in VALID_PRIORITIES else None
        elif op == "set_goal":
            value = str(value or "").strip().lower()
            value = value if value in VALID_GOALS else None
        elif op == "set_notes":
            value = str(value or "").strip()[:200] or None

        if value is None:
            rejected.append({
                "op": op,
                "exercise_name": exercise_name,
                "reason": f"{raw.get('value')!r} is not a valid value for {op}.",
            })
            continue

        key = (str(day.get("day_name")), exercise.get("exercise_id"), op)
        if key in seen:
            continue
        seen.add(key)

        field = OP_FIELDS[op]
        accepted.append({
            "id": uuid.uuid4().hex[:12],
            "op": op,
            "day_name": day.get("day_name"),
            "exercise_id": exercise.get("exercise_id"),
            "exercise_name": exercise.get("exercise_name"),
            "field": field,
            "from": exercise.get(field),
            "value": value,
            "title": _describe(op, exercise.get("exercise_name") or exercise_name, value),
            "rationale": str(raw.get("rationale") or "").strip()[:200] or None,
            "status": EDIT_STATUS_PENDING,
        })
        if len(accepted) >= MAX_EDITS:
            break

    return accepted, rejected


def apply_edits(
    plan: Dict[str, Any], edits: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Build the new `days` list for a set of accepted edits.

    Returns (days, applied_edit_ids). The plan is not mutated; the caller
    persists through the normal validated update path. An edit whose exercise
    has since left the plan is skipped rather than recreated — the plan moved
    on, and a stale patch must not resurrect a lift the user removed.
    """
    days = copy.deepcopy(plan.get("days") or [])
    working = {"days": days}
    applied: List[str] = []

    for edit in edits:
        _, exercise = _find_exercise(
            working, edit.get("day_name"), edit.get("exercise_name")
        )
        if not exercise:
            continue
        field = edit.get("field") or OP_FIELDS.get(edit.get("op"))
        if not field:
            continue
        exercise[field] = edit["value"]
        applied.append(str(edit.get("id")))

    return days, applied


def set_status_for(edits: List[Dict[str, Any]]) -> str:
    """A patch set's status, derived from its edits rather than stored twice."""
    statuses = {edit.get("status") for edit in edits or []}
    if not statuses or statuses == {EDIT_STATUS_PENDING}:
        return SET_STATUS_PENDING
    if statuses == {EDIT_STATUS_APPLIED}:
        return SET_STATUS_APPLIED
    if statuses == {EDIT_STATUS_DISMISSED}:
        return SET_STATUS_DISMISSED
    if EDIT_STATUS_PENDING in statuses:
        return SET_STATUS_PENDING
    return SET_STATUS_PARTIALLY_APPLIED
