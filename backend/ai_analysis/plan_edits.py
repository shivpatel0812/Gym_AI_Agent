"""
Reviewable edits to the Active Plan.

Two lanes write the same plan and are deliberately not equals:

  Plan Mode  is the editor of record for structure — which days exist, which
             exercises are in the program, what the goal is. It can rebuild
             and can stage structure patches (add/remove lifts, fill a day
             from a logged session).
  Coach chat may stage the same reviewable ops when the user asks to improve
             the plan. Nothing writes until Accept on Plan Hub.

Nothing here writes to Firestore. `normalize_edits` turns raw model output into
reviewable ops; `apply_edits` turns accepted ops into a new `days` list the
existing PATCH path validates and stores.
"""

import copy
import uuid
from typing import Any, Dict, List, Optional, Tuple

VALID_GOALS = {"strength", "hypertrophy", "fat_loss", "general"}
VALID_PRIORITIES = {"high", "supporting", "normal"}

# Filling a sparse day from history can need one op per lift.
MAX_EDITS = 16

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

# Field patches on an exercise already in the plan
FIELD_OPS = {
    "set_rep_range": "target_rep_range",
    "set_sets": "sets",
    "set_priority": "priority",
    "set_goal": "goal",
    "set_notes": "notes",
}

# Multi-field destination finish line (weight × reps by week N)
DESTINATION_OPS = {
    "set_destination",
    "clear_destination",
}

# Structure patches — still staged for review, never silent
STRUCTURE_OPS = {
    "add_exercise",
    "remove_exercise",
    "add_day",
    "remove_day",
    "replace_day_exercises",
}

ALL_OPS = set(FIELD_OPS) | STRUCTURE_OPS | DESTINATION_OPS

MIN_DEST_WEIGHT, MAX_DEST_WEIGHT = 1.0, 2000.0
MIN_DEST_WEEKS, MAX_DEST_WEEKS = 1, 16


def _find_day(plan: Dict[str, Any], day_name: str) -> Optional[Dict]:
    wanted = str(day_name or "").strip().lower()
    if not wanted:
        return None
    for day in plan.get("days") or []:
        if str(day.get("day_name", "")).strip().lower() == wanted:
            return day
    return None


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


def _resolve_exercise_identity(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Map a freeform exercise dict onto catalog id/name when possible."""
    name = str(raw.get("exercise_name") or raw.get("name") or "").strip()
    eid = str(raw.get("exercise_id") or "").strip()
    if not name and not eid:
        return None

    try:
        from data.default_exercises import EXERCISE_BY_ID, validate_exercise_id
    except Exception:
        EXERCISE_BY_ID = {}
        validate_exercise_id = lambda _x: False  # noqa: E731

    catalog_by_name = {
        str(ex.get("name", "")).strip().lower(): ex_id
        for ex_id, ex in EXERCISE_BY_ID.items()
        if ex.get("name")
    }

    if eid and not validate_exercise_id(eid):
        # Keep custom ids the user already logs against.
        pass
    if not eid and name:
        eid = catalog_by_name.get(name.lower()) or ""
    if eid and not name and eid in EXERCISE_BY_ID:
        name = str(EXERCISE_BY_ID[eid].get("name") or eid)

    if not name:
        return None

    sets = _clamp(raw.get("sets"), MIN_SETS, MAX_SETS) or 3
    rep_range = _normalize_rep_range(raw.get("target_rep_range") or raw.get("rep_range"))
    if rep_range is None:
        reps = _clamp(raw.get("reps"), MIN_REPS, MAX_REPS)
        if reps is not None:
            rep_range = [reps, reps]

    priority = str(raw.get("priority") or "normal").strip().lower()
    if priority not in VALID_PRIORITIES:
        priority = "normal"
    goal = str(raw.get("goal") or "").strip().lower() or None
    if goal and goal not in VALID_GOALS:
        goal = None

    out: Dict[str, Any] = {
        "exercise_id": eid or f"custom-{uuid.uuid4().hex[:8]}",
        "exercise_name": name,
        "sets": sets,
        "reps": rep_range[0] if rep_range else 8,
        "order": _clamp(raw.get("order"), 1, 40) or 1,
        "priority": priority,
    }
    if rep_range:
        out["target_rep_range"] = rep_range
    if goal:
        out["goal"] = goal
    notes = str(raw.get("notes") or "").strip()[:200]
    if notes:
        out["notes"] = notes
    return out


def _normalize_exercise_list(value: Any) -> Optional[List[Dict[str, Any]]]:
    if not isinstance(value, list) or not value:
        return None
    cleaned: List[Dict[str, Any]] = []
    seen = set()
    for i, raw in enumerate(value[:20]):
        if not isinstance(raw, dict):
            continue
        ex = _resolve_exercise_identity(raw)
        if not ex:
            continue
        key = ex["exercise_name"].lower()
        if key in seen:
            continue
        seen.add(key)
        ex["order"] = i + 1
        cleaned.append(ex)
    return cleaned or None


def _normalize_destination(value: Any) -> Optional[Dict[str, Any]]:
    """weight + reps required together; weeks optional."""
    if not isinstance(value, dict):
        return None
    try:
        weight = float(value.get("weight"))
    except (TypeError, ValueError):
        return None
    reps = _clamp(value.get("reps"), MIN_REPS, MAX_REPS)
    if weight < MIN_DEST_WEIGHT or weight > MAX_DEST_WEIGHT or reps is None:
        return None
    out: Dict[str, Any] = {
        "weight": round(weight, 1),
        "reps": reps,
    }
    weeks_raw = value.get("weeks")
    if weeks_raw is not None and weeks_raw != "":
        weeks = _clamp(weeks_raw, MIN_DEST_WEEKS, MAX_DEST_WEEKS)
        if weeks is None:
            return None
        out["weeks"] = weeks
    return out


def _describe(op: str, exercise_name: str, value: Any, day_name: str = "") -> str:
    if op == "set_rep_range":
        return f"{exercise_name}: target {value[0]}-{value[1]} reps"
    if op == "set_sets":
        return f"{exercise_name}: {value} working sets"
    if op == "set_priority":
        return f"{exercise_name}: priority {value}"
    if op == "set_goal":
        return f"{exercise_name}: {str(value).replace('_', ' ')} focus"
    if op == "set_notes":
        return f"{exercise_name}: coaching note updated"
    if op == "set_destination":
        weeks = value.get("weeks")
        base = f"{exercise_name}: destination {value['weight']} lb × {value['reps']}"
        return f"{base} in {weeks} weeks" if weeks else base
    if op == "clear_destination":
        return f"{exercise_name}: clear destination goal"
    if op == "add_exercise":
        return f"Add {exercise_name} to {day_name or 'plan'}"
    if op == "remove_exercise":
        return f"Remove {exercise_name} from {day_name or 'plan'}"
    if op == "add_day":
        return f"Add training day: {value}"
    if op == "remove_day":
        return f"Remove training day: {day_name or value}"
    if op == "replace_day_exercises":
        n = len(value) if isinstance(value, list) else 0
        return f"Replace {day_name or 'day'} with {n} exercises"
    return f"{exercise_name}: updated"


def normalize_edits(
    plan: Optional[Dict[str, Any]], edits: Optional[List[Dict[str, Any]]]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Validate raw model output against the live plan.

    Returns (accepted, rejected). Field ops that name a missing exercise are
    rejected. Structure ops that would create a duplicate day/lift are rejected.
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

        if op not in ALL_OPS:
            rejected.append({"op": op, "reason": f"'{op}' is not a supported edit."})
            continue

        # --- structure -------------------------------------------------
        if op == "add_day":
            new_name = str(raw.get("value") or day_name or "").strip()
            if not new_name:
                rejected.append({"op": op, "reason": "No day name given."})
                continue
            if _find_day(plan, new_name):
                rejected.append({
                    "op": op,
                    "reason": f"Day '{new_name}' already exists on the plan.",
                })
                continue
            key = ("add_day", new_name.lower())
            if key in seen:
                continue
            seen.add(key)
            accepted.append({
                "id": uuid.uuid4().hex[:12],
                "op": op,
                "day_name": new_name,
                "exercise_id": None,
                "exercise_name": new_name,
                "field": "days",
                "from": None,
                "value": new_name,
                "title": _describe(op, new_name, new_name),
                "rationale": str(raw.get("rationale") or "").strip()[:200] or None,
                "status": EDIT_STATUS_PENDING,
            })
            if len(accepted) >= MAX_EDITS:
                break
            continue

        if op == "remove_day":
            target = day_name or str(raw.get("value") or "").strip()
            day = _find_day(plan, target)
            if not day:
                rejected.append({
                    "op": op,
                    "reason": f"Day '{target}' is not on the active plan.",
                })
                continue
            key = ("remove_day", str(day.get("day_name")).lower())
            if key in seen:
                continue
            seen.add(key)
            accepted.append({
                "id": uuid.uuid4().hex[:12],
                "op": op,
                "day_name": day.get("day_name"),
                "exercise_id": None,
                "exercise_name": day.get("day_name"),
                "field": "days",
                "from": [ex.get("exercise_name") for ex in (day.get("exercises") or [])],
                "value": None,
                "title": _describe(op, "", None, day.get("day_name")),
                "rationale": str(raw.get("rationale") or "").strip()[:200] or None,
                "status": EDIT_STATUS_PENDING,
            })
            if len(accepted) >= MAX_EDITS:
                break
            continue

        if op == "replace_day_exercises":
            day = _find_day(plan, day_name)
            if not day:
                rejected.append({
                    "op": op,
                    "reason": f"Day '{day_name}' is not on the active plan.",
                })
                continue
            exercises = _normalize_exercise_list(raw.get("value"))
            if not exercises:
                rejected.append({
                    "op": op,
                    "day_name": day_name,
                    "reason": "replace_day_exercises needs a non-empty exercise list.",
                })
                continue
            key = ("replace_day", str(day.get("day_name")).lower())
            if key in seen:
                continue
            seen.add(key)
            accepted.append({
                "id": uuid.uuid4().hex[:12],
                "op": op,
                "day_name": day.get("day_name"),
                "exercise_id": None,
                "exercise_name": day.get("day_name"),
                "field": "exercises",
                "from": [
                    ex.get("exercise_name") for ex in (day.get("exercises") or [])
                ],
                "value": exercises,
                "title": _describe(op, "", exercises, day.get("day_name")),
                "rationale": str(raw.get("rationale") or "").strip()[:200] or None,
                "status": EDIT_STATUS_PENDING,
            })
            if len(accepted) >= MAX_EDITS:
                break
            continue

        if op == "add_exercise":
            day = _find_day(plan, day_name)
            if not day:
                rejected.append({
                    "op": op,
                    "reason": f"Day '{day_name}' is not on the active plan.",
                })
                continue
            payload = raw.get("value") if isinstance(raw.get("value"), dict) else {}
            if exercise_name and "exercise_name" not in payload and "name" not in payload:
                payload = {**payload, "exercise_name": exercise_name}
            exercise = _resolve_exercise_identity(payload if isinstance(payload, dict) else {})
            if not exercise:
                rejected.append({
                    "op": op,
                    "reason": "add_exercise needs an exercise_name (and optional sets/reps).",
                })
                continue
            _, existing = _find_exercise(plan, day_name, exercise["exercise_name"])
            if existing:
                rejected.append({
                    "op": op,
                    "exercise_name": exercise["exercise_name"],
                    "reason": (
                        f"'{exercise['exercise_name']}' is already on "
                        f"{day.get('day_name')}."
                    ),
                })
                continue
            key = (
                "add_exercise",
                str(day.get("day_name")).lower(),
                exercise["exercise_name"].lower(),
            )
            if key in seen:
                continue
            seen.add(key)
            accepted.append({
                "id": uuid.uuid4().hex[:12],
                "op": op,
                "day_name": day.get("day_name"),
                "exercise_id": exercise.get("exercise_id"),
                "exercise_name": exercise.get("exercise_name"),
                "field": "exercises",
                "from": None,
                "value": exercise,
                "title": _describe(
                    op, exercise["exercise_name"], exercise, day.get("day_name")
                ),
                "rationale": str(raw.get("rationale") or "").strip()[:200] or None,
                "status": EDIT_STATUS_PENDING,
            })
            if len(accepted) >= MAX_EDITS:
                break
            continue

        if op == "remove_exercise":
            day, exercise = _find_exercise(plan, day_name, exercise_name)
            if not exercise:
                rejected.append({
                    "op": op,
                    "exercise_name": exercise_name,
                    "reason": (
                        f"'{exercise_name}' is not in the active plan"
                        + (f" on {day_name}." if day_name else ".")
                    ),
                })
                continue
            key = (
                "remove_exercise",
                str(day.get("day_name")).lower(),
                str(exercise.get("exercise_id") or exercise.get("exercise_name")),
            )
            if key in seen:
                continue
            seen.add(key)
            accepted.append({
                "id": uuid.uuid4().hex[:12],
                "op": op,
                "day_name": day.get("day_name"),
                "exercise_id": exercise.get("exercise_id"),
                "exercise_name": exercise.get("exercise_name"),
                "field": "exercises",
                "from": exercise.get("exercise_name"),
                "value": None,
                "title": _describe(
                    op,
                    exercise.get("exercise_name") or exercise_name,
                    None,
                    day.get("day_name"),
                ),
                "rationale": str(raw.get("rationale") or "").strip()[:200] or None,
                "status": EDIT_STATUS_PENDING,
            })
            if len(accepted) >= MAX_EDITS:
                break
            continue

        # --- destination finish line -----------------------------------
        if op in DESTINATION_OPS:
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
                    ),
                })
                continue

            if op == "set_destination":
                value = _normalize_destination(raw.get("value"))
                if value is None:
                    rejected.append({
                        "op": op,
                        "exercise_name": exercise_name,
                        "reason": (
                            "set_destination needs {weight, reps, weeks?} "
                            "with weight and reps together."
                        ),
                    })
                    continue
            else:
                value = None

            key = (
                op,
                str(day.get("day_name")),
                exercise.get("exercise_id") or exercise.get("exercise_name"),
            )
            if key in seen:
                continue
            seen.add(key)
            accepted.append({
                "id": uuid.uuid4().hex[:12],
                "op": op,
                "day_name": day.get("day_name"),
                "exercise_id": exercise.get("exercise_id"),
                "exercise_name": exercise.get("exercise_name"),
                "field": "destination",
                "from": {
                    "weight": exercise.get("target_weight"),
                    "reps": exercise.get("target_reps"),
                    "weeks": exercise.get("target_weeks"),
                },
                "value": value,
                "title": _describe(
                    op, exercise.get("exercise_name") or exercise_name, value or {}
                ),
                "rationale": str(raw.get("rationale") or "").strip()[:200] or None,
                "status": EDIT_STATUS_PENDING,
            })
            if len(accepted) >= MAX_EDITS:
                break
            continue

        # --- field patches ---------------------------------------------
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
                    + " Use add_exercise to put a new lift on a day."
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

        field = FIELD_OPS[op]
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
    persists through the normal validated update path.
    """
    days = copy.deepcopy(plan.get("days") or [])
    working = {"days": days}
    applied: List[str] = []

    for edit in edits:
        op = edit.get("op")

        if op == "add_day":
            name = str(edit.get("value") or edit.get("day_name") or "").strip()
            if name and not _find_day(working, name):
                days.append({
                    "day_name": name,
                    "focus": name,
                    "exercises": [],
                })
                applied.append(str(edit.get("id")))
            continue

        if op == "remove_day":
            target = str(edit.get("day_name") or "").strip().lower()
            before = len(days)
            days[:] = [
                d for d in days
                if str(d.get("day_name", "")).strip().lower() != target
            ]
            if len(days) < before:
                applied.append(str(edit.get("id")))
            continue

        if op == "replace_day_exercises":
            day = _find_day(working, edit.get("day_name"))
            if not day or not isinstance(edit.get("value"), list):
                continue
            day["exercises"] = copy.deepcopy(edit["value"])
            applied.append(str(edit.get("id")))
            continue

        if op == "add_exercise":
            day = _find_day(working, edit.get("day_name"))
            exercise = edit.get("value")
            if not day or not isinstance(exercise, dict):
                continue
            _, existing = _find_exercise(
                working, edit.get("day_name"), exercise.get("exercise_name")
            )
            if existing:
                continue
            bucket = day.setdefault("exercises", [])
            next_order = len(bucket) + 1
            entry = copy.deepcopy(exercise)
            entry["order"] = next_order
            bucket.append(entry)
            applied.append(str(edit.get("id")))
            continue

        if op == "remove_exercise":
            day = _find_day(working, edit.get("day_name"))
            if not day:
                continue
            wanted = str(edit.get("exercise_name") or "").strip().lower()
            wanted_id = str(edit.get("exercise_id") or "").strip().lower()
            before = len(day.get("exercises") or [])
            day["exercises"] = [
                ex for ex in (day.get("exercises") or [])
                if str(ex.get("exercise_name") or "").strip().lower() != wanted
                and str(ex.get("exercise_id") or "").strip().lower() != wanted_id
            ]
            if len(day.get("exercises") or []) < before:
                applied.append(str(edit.get("id")))
            continue

        if op == "set_destination":
            _, exercise = _find_exercise(
                working, edit.get("day_name"), edit.get("exercise_name")
            )
            value = edit.get("value")
            if not exercise or not isinstance(value, dict):
                continue
            exercise["target_weight"] = value.get("weight")
            exercise["target_reps"] = value.get("reps")
            if value.get("weeks") is not None:
                exercise["target_weeks"] = value.get("weeks")
            else:
                exercise.pop("target_weeks", None)
            applied.append(str(edit.get("id")))
            continue

        if op == "clear_destination":
            _, exercise = _find_exercise(
                working, edit.get("day_name"), edit.get("exercise_name")
            )
            if not exercise:
                continue
            exercise.pop("target_weight", None)
            exercise.pop("target_reps", None)
            exercise.pop("target_weeks", None)
            applied.append(str(edit.get("id")))
            continue

        # Field patch
        _, exercise = _find_exercise(
            working, edit.get("day_name"), edit.get("exercise_name")
        )
        if not exercise:
            continue
        field = edit.get("field") or FIELD_OPS.get(edit.get("op"))
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


# Back-compat alias used by older imports/tests
OP_FIELDS = FIELD_OPS
