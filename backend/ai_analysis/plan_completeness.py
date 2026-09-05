"""Keep a focused goal from shrinking the user's routine into one lift."""

from copy import deepcopy


def complete_routine(plan, source, strict=False, preserve_order=False):
    """Restore silent omissions; declared adaptations remain reviewable changes.

    Day identity is explicit: generated variants name their source_day. We do
    not infer Push/Pull/Legs or guess muscle groups from arbitrary day names.
    """
    from .plan_builder import PlanBuilder

    plan = deepcopy(plan)
    changes = plan.setdefault("changes", [])
    days = plan.setdefault("days", [])
    key = lambda value: str(value or "").strip().lower()
    claimed = set()

    def removed(day, exercise=None):
        return not strict and any(
            key(c.get("action")) in ("removed", "swapped")
            and key(c.get("day_name")) == key(day)
            and (key(c.get("replaces") or c.get("exercise_name")) == key(exercise))
            for c in changes
        )

    for original in (source or {}).get("days") or []:
        name = original.get("day_name")
        if not name or removed(name):
            continue
        matches = [d for d in days if key(d.get("day_name")) == key(name)
                   or key(d.get("source_day")) == key(name)]
        if not matches:
            renamed = PlanBuilder._same_day_renamed(original, days, claimed)
            matches = [d for d in days if key(d.get("day_name")) == renamed] if renamed else []
        if not matches:
            days.append(deepcopy(original))
            matches = [days[-1]]
            carried = plan.setdefault("carried_forward_days", [])
            if name not in carried:
                carried.append(name)
            schedule = plan.setdefault("weekly_schedule", {})
            for weekday, assignment in (source.get("weekly_schedule") or {}).items():
                if assignment == name and key(schedule.get(weekday, "Rest")) == "rest":
                    schedule[weekday] = name
            changes.append({"action": "preserved", "day_name": name,
                            "reason": "Kept your existing workout alongside the focus goal."})
        for day in matches:
            claimed.add(key(day.get("day_name")))
            exercises = day.setdefault("exercises", [])
            present = PlanBuilder._day_exercise_keys(day)
            for index, exercise in enumerate(original.get("exercises") or []):
                identity = key(exercise.get("exercise_id") or exercise.get("exercise_name"))
                if identity in present or removed(day["day_name"], exercise.get("exercise_name")):
                    continue
                exercises.insert(min(index, len(exercises)), deepcopy(exercise))
                present.add(identity)
                changes.append({"action": "preserved", "day_name": day["day_name"],
                                "exercise_name": exercise.get("exercise_name"),
                                "reason": "Retained from your workout history so this day stays complete."})
            for index, exercise in enumerate(exercises):
                exercise["order"] = index + 1
            if preserve_order:
                positions = {key(ex.get("exercise_id") or ex.get("exercise_name")): i
                             for i, ex in enumerate(original.get("exercises") or [])}
                exercises.sort(key=lambda ex: positions.get(
                    key(ex.get("exercise_id") or ex.get("exercise_name")), len(positions)))
                for index, exercise in enumerate(exercises):
                    exercise["order"] = index + 1
    return plan


def completeness_errors(plan):
    days = plan.get("days") or []
    schedule = plan.get("weekly_schedule") or {}
    scheduled = set(schedule.values())
    errors = []
    if not days:
        errors.append("Include the complete training week.")
    for day in days:
        name = day.get("day_name")
        if not day.get("exercises"):
            errors.append(f"Fill {name} with the user's exercises or appropriate new exercises.")
        if name not in scheduled:
            errors.append(f"Assign {name} to its agreed weekday; it is currently unscheduled.")
    return errors
