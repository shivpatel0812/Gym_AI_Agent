"""Keep a focused goal from shrinking the user's routine into one lift.

Preservation is one half of a pair and only works if the other half does. This
module puts back what a proposal dropped silently; a proposal that says what it
dropped is meant to be believed. When the believing half is too narrow the plan
can add and never subtract, which is not conservatism — it is a ratchet. One
real Push day grew from four exercises to thirteen over a week, every addition
stamped "Retained from your workout history so this day stays complete", and no
conversation could take anything back off it.
"""

from copy import deepcopy

# A removal only counts if the draft narrates it, and models do not agree on the
# verb. Matching the exact strings "removed" and "swapped" meant a draft that
# said "replaced", "dropped" or "remove" had the lift put straight back, with a
# `changes` entry claiming the opposite of what the plan contained.
REMOVAL_ACTIONS = ("remov", "replac", "swap", "drop", "delet")

# Fields that exist only on an exercise reconstructed from a logged session.
# They are not part of a prescription.
RECONSTRUCTION_FIELDS = ("rest_seconds", "source_date", "last_working_weight")


def _is_removal(action):
    action = str(action or "").strip().lower()
    return any(action.startswith(prefix) for prefix in REMOVAL_ACTIONS)


def _identities(exercise):
    """Every name a lift answers to — its id *and* its name, never one or other.

    The same lift reaches a plan under two different ids: the user's own custom
    exercise carries its Firestore doc id, while a coach edit that names it in
    prose mints a fresh `custom-xxxxxxxx`. Keyed on `id or name`, the two never
    match, so preservation inserts a second copy of a lift the day already has
    and the plan shows "Cable Tricept Pushdown" twice with different ids.
    """
    out = set()
    for field in ("exercise_id", "exercise_name"):
        value = str((exercise or {}).get(field) or "").strip().lower()
        if value:
            out.add(value)
    return out


def _restored(exercise):
    """A copy of a preserved lift that is a valid prescription.

    `complete_routine` runs *after* `validate_plan`, so anything it inserts
    skips every guarantee that pass makes. A lift carried in from a
    reconstructed session arrived with no `target_rep_range` — the band the
    engine judges a session against, the projection paces to, and the card
    displays — so it rendered in the plan with no reps beside it at all.
    """
    from .plan_builder import PlanBuilder

    entry = deepcopy(exercise)
    for field in RECONSTRUCTION_FIELDS:
        entry.pop(field, None)
    if not entry.get("target_rep_range"):
        reps = entry.get("reps")
        entry["target_rep_range"] = PlanBuilder._default_rep_range(
            reps if isinstance(reps, int) and 0 < reps <= 30 else 8
        )
    return entry


def complete_routine(plan, source, strict=False, preserve_order=False,
                     backfill_exercises=None):
    """Restore silent omissions; declared adaptations remain reviewable changes.

    Two guards live here and only one belongs in every mode.

    **Days** are carried over always. A conversation about Push is not a
    request to delete Legs, and a day that simply vanishes tells the user
    nothing — this is the guard that earns its place.

    **Exercises** are backfilled only where the mode asks for it.
    `follow_split` promises the model will not add, remove or swap lifts, so
    there the backfill *is* the contract. `adapt_split` and `build_for_me`
    tell the model in as many words that it "may add, remove or swap
    individual exercises" — and then this function put back everything it
    removed. The prompt granted an authority the merge revoked, so a plan
    could only ever grow, and the exercises that accumulated came from a
    reconstruction of old logs rather than from anything the user discussed.

    `backfill_exercises` defaults to `strict` for that reason. Callers with a
    genuine per-exercise source — an imported session the user pointed at —
    pass True explicitly.

    Day identity is explicit: generated variants name their source_day. We do
    not infer Push/Pull/Legs or guess muscle groups from arbitrary day names.
    """
    if backfill_exercises is None:
        backfill_exercises = strict
    from .plan_builder import PlanBuilder

    plan = deepcopy(plan)
    changes = plan.setdefault("changes", [])
    days = plan.setdefault("days", [])
    key = lambda value: str(value or "").strip().lower()
    claimed = set()

    def removed(day, exercise=None):
        """Did the draft declare this gone? `exercise` None asks about the day."""
        if strict:
            return False
        targets = _identities(exercise) if isinstance(exercise, dict) else set()
        for change in changes:
            if not _is_removal(change.get("action")):
                continue
            if key(change.get("day_name")) != key(day):
                continue
            named = {
                key(value) for value in (
                    change.get("replaces"),
                    change.get("exercise_name"),
                    change.get("exercise_id"),
                ) if key(value)
            }
            # A change naming no lift is about the day itself.
            if not targets:
                if not named:
                    return True
                continue
            if named & targets:
                return True
        return False

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
            # A day the draft returned is that day. Backfilling it overrides
            # the mode; a day it never returned was carried whole above and
            # needs nothing merged into it either.
            if backfill_exercises:
                present = set()
                for existing in exercises:
                    present |= _identities(existing)
                for index, exercise in enumerate(original.get("exercises") or []):
                    identity = _identities(exercise)
                    if identity & present or removed(day["day_name"], exercise):
                        continue
                    exercises.insert(min(index, len(exercises)), _restored(exercise))
                    present |= identity
                    changes.append({"action": "preserved", "day_name": day["day_name"],
                                    "exercise_name": exercise.get("exercise_name"),
                                    "reason": "Retained from your workout history so this day stays complete."})
            for index, exercise in enumerate(exercises):
                exercise["order"] = index + 1
            if preserve_order:
                originals = original.get("exercises") or []
                positions = {}
                for i, ex in enumerate(originals):
                    for ident in _identities(ex):
                        positions.setdefault(ident, i)
                last = len(originals)
                exercises.sort(key=lambda ex: min(
                    (positions[ident] for ident in _identities(ex) if ident in positions),
                    default=last,
                ))
                for index, exercise in enumerate(exercises):
                    exercise["order"] = index + 1
    return plan


_PRESCRIPTION_FIELDS = (
    "sets",
    "reps",
    "target_rep_range",
    "priority",
    "goal",
    "notes",
    "intensity",
    "target_weight",
    "target_reps",
    "target_weeks",
)


def enforce_locked_exercises(plan, locked_plan):
    """Keep the user's hand-edited lift list; take the model's prescriptions.

    After Review Plan, the user can add or remove exercises. The next
    generation should fill in sets, rep ranges and goals from that list —
    not invent a new split. `complete_routine` restores silent omissions;
    it does not strip extras the model added. This does.
    """
    if not (locked_plan or {}).get("exercise_list_locked"):
        return plan

    from .plan_builder import PlanBuilder

    plan = deepcopy(plan)
    changes = plan.setdefault("changes", [])
    key = lambda value: str(value or "").strip().lower()
    locked_days = [
        day for day in (locked_plan.get("days") or [])
        if isinstance(day, dict) and day.get("day_name")
    ]
    if not locked_days:
        plan["exercise_list_locked"] = True
        return plan

    proposed = list(plan.get("days") or [])
    claimed_names = set()

    def match_day(original):
        wanted = key(original.get("day_name"))
        for day in proposed:
            day_key = key(day.get("day_name"))
            if day_key in claimed_names:
                continue
            if day_key == wanted or key(day.get("source_day")) == wanted:
                return day
        renamed = PlanBuilder._same_day_renamed(original, proposed, claimed_names)
        if renamed:
            for day in proposed:
                if key(day.get("day_name")) == renamed:
                    return day
        return None

    kept = []
    claimed = set()
    for original in locked_days:
        match = match_day(original)
        if match is not None:
            claimed_names.add(key(match.get("day_name")))
        locked_exercises = [
            ex for ex in (original.get("exercises") or []) if isinstance(ex, dict)
        ]
        if match is None:
            carried = deepcopy(original)
            for index, exercise in enumerate(carried.get("exercises") or []):
                exercise["order"] = index + 1
            kept.append(carried)
            changes.append({
                "action": "preserved",
                "day_name": original["day_name"],
                "reason": "Kept your edited workout; the model omitted this day.",
            })
            continue

        claimed.add(id(match))
        # Matched on id *and* name: the model re-emits a locked lift by name and
        # picks up a different id for it, and an id-only comparison then reads
        # the user's own lift as an extra to drop and the model's copy as a
        # missing one to preserve — one edited lift, two rows.
        locked_keys = set()
        for ex in locked_exercises:
            locked_keys |= _identities(ex)
        by_key = {}
        extras = []
        for exercise in match.get("exercises") or []:
            identity = _identities(exercise)
            matched = identity & locked_keys
            if matched and not (identity & set(by_key)):
                for ident in identity:
                    by_key[ident] = exercise
            elif not matched:
                extras.append(exercise.get("exercise_name") or exercise.get("exercise_id"))

        merged = []
        for exercise in locked_exercises:
            proposed_ex = next(
                (by_key[ident] for ident in _identities(exercise) if ident in by_key),
                None,
            )
            entry = deepcopy(exercise)
            if proposed_ex:
                for field in _PRESCRIPTION_FIELDS:
                    if proposed_ex.get(field) is not None:
                        entry[field] = proposed_ex[field]
            else:
                changes.append({
                    "action": "preserved",
                    "day_name": original["day_name"],
                    "exercise_name": exercise.get("exercise_name"),
                    "reason": "Kept from your edited list.",
                })
            merged.append(entry)

        for extra in extras:
            changes.append({
                "action": "removed",
                "day_name": original["day_name"],
                "exercise_name": extra,
                "reason": "Dropped a lift that was not on your edited list.",
            })

        for index, exercise in enumerate(merged):
            exercise["order"] = index + 1
        match["exercises"] = merged
        kept.append(match)

    for day in proposed:
        if id(day) in claimed:
            continue
        if any(key(kept_day.get("day_name")) == key(day.get("day_name")) for kept_day in kept):
            continue
        changes.append({
            "action": "removed",
            "day_name": day.get("day_name"),
            "reason": "Dropped a day that was not on your edited list.",
        })

    plan["days"] = kept
    plan["exercise_list_locked"] = True
    return plan


# How much of a day a draft may drop before it reads as a truncated response
# rather than a decision. Half is deliberately generous: swapping three lifts
# of eight is a real adaptation, returning two of eleven is a draft that ran
# out of room.
TRUNCATION_RATIO = 0.5

# Below this the ratio says nothing: a two-lift day dropping to one is an
# ordinary edit, not a response that ran out of room.
MIN_DAY_FOR_TRUNCATION = 3


def completeness_errors(plan, source=None):
    """What a draft must fix before it can be stored.

    The truncation check replaces what the per-exercise backfill used to do.
    This module exists because a draft can return Push A with two lifts when
    it had eleven — but silently rebuilding the day from old logs answered
    that by inventing work the user never discussed. Naming it as an error
    sends the draft back for one repair pass and, failing that, fails loudly.
    A draft that *says* it dropped the lifts is making a decision, and the
    modes that allow it are allowed to make it.
    """
    days = plan.get("days") or []
    schedule = plan.get("weekly_schedule") or {}
    scheduled = set(schedule.values())
    key = lambda value: str(value or "").strip().lower()
    errors = []
    if not days:
        errors.append("Include the complete training week.")
    for day in days:
        name = day.get("day_name")
        if not day.get("exercises"):
            errors.append(f"Fill {name} with the user's exercises or appropriate new exercises.")
        if name not in scheduled:
            errors.append(f"Assign {name} to its agreed weekday; it is currently unscheduled.")

    explained = {
        key(change.get("day_name"))
        for change in plan.get("changes") or []
        if isinstance(change, dict) and _is_removal(change.get("action"))
    }
    # A source day can legitimately become two — a heavy and a volume exposure
    # of one Upper day — so the comparison is against everything descended from
    # it. Judging each variant alone would read a deliberate split as a draft
    # that lost two thirds of the work.
    by_source = {}
    for day in days:
        for name in (day.get("day_name"), day.get("source_day")):
            if key(name):
                by_source.setdefault(key(name), [])
                if day not in by_source[key(name)]:
                    by_source[key(name)].append(day)
    for original in (source or {}).get("days") or []:
        descendants = by_source.get(key(original.get("day_name"))) or []
        if not descendants:
            continue  # carried over whole above; nothing was dropped
        if any(key(d.get("day_name")) in explained for d in descendants):
            continue
        before = len(original.get("exercises") or [])
        after = sum(len(d.get("exercises") or []) for d in descendants)
        if before >= MIN_DAY_FOR_TRUNCATION and after < before * TRUNCATION_RATIO:
            named = descendants[0].get("day_name")
            errors.append(
                f"{named} came back with {after} exercises where it had {before}. "
                f"Return the full day, or list each dropped lift in changes with "
                f'{{"action": "removed", "day_name": "{named}", '
                f'"exercise_name": "<lift>"}} and say why.'
            )
    return errors
