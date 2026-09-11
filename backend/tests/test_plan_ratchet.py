"""
A plan that can only grow.

Every one of these is drawn from one real Push A day that went from four
exercises to thirteen over a week while the user was discussing one thing:
pressing 90s on incline. The stored `changes` list narrated the whole thing —
nine entries reading "Retained from your workout history so this day stays
complete" — and the user's report was exactly right on both counts: the
exercises they replaced stayed, and exercises they had never discussed
appeared beside them.

Five separate mechanisms, none of which alone would have been enough:

  * every plan ran in `adapt_split`, whose prompt grants the model authority to
    remove exercises — and the merge layer revoked it;
  * a removal only counted if the draft used one of two exact words;
  * the same lift under two ids read as two lifts;
  * nothing deduplicated a day;
  * a date the coach mentioned in passing could be adopted as a template, and
    adopting it imported not that session but a reconstruction built from
    several, one-off substitutions included.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from ai_analysis.plan_builder import PlanBuilder
from ai_analysis.plan_completeness import complete_routine


def ex(exercise_id, name, **extra):
    return {"exercise_id": exercise_id, "exercise_name": name,
            "sets": 3, "reps": 10, "target_rep_range": [10, 12], **extra}


def day(name, *exercises):
    return {"day_name": name, "exercises": list(exercises)}


class TestTheDraftOwnsTheDaysItReturns:
    """
    The bug under the bug. Every one of this user's plans ran in `adapt_split`
    — the default, never chosen — whose prompt tells the model in as many words
    that it "may add, remove or swap individual exercises". `complete_routine`
    then put back everything it removed. The prompt granted an authority the
    merge revoked, so the plan could only grow, and what accumulated came from
    a reconstruction of old logs rather than from anything the user discussed.
    """

    SOURCE = {"days": [day("Push A", ex("old-fly", "Cable Chest Fly (Mid)"),
                           ex("press", "Incline Dumbbell Press")),
                       day("Legs", ex("squat", "Smith Machine Squats"))]}

    def test_a_returned_day_is_taken_as_returned(self):
        proposal = {"days": [day("Push A", ex("press", "Incline Dumbbell Press"))]}
        plan = complete_routine(proposal, self.SOURCE)
        assert [e["exercise_id"] for e in plan["days"][0]["exercises"]] == ["press"]

    def test_a_day_never_discussed_is_still_carried_whole(self):
        """The guard that earns its place: a chat about Push is not a request
        to delete Legs."""
        proposal = {"days": [day("Push A", ex("press", "Incline Dumbbell Press"))]}
        plan = complete_routine(proposal, self.SOURCE)
        legs = next(d for d in plan["days"] if d["day_name"] == "Legs")
        assert [e["exercise_id"] for e in legs["exercises"]] == ["squat"]
        assert plan["carried_forward_days"] == ["Legs"]

    def test_follow_split_still_preserves_every_lift(self):
        """That mode's whole contract is that lifts do not change."""
        proposal = {"days": [day("Push A", ex("press", "Incline Dumbbell Press"))]}
        plan = complete_routine(proposal, self.SOURCE, strict=True)
        assert {e["exercise_id"] for e in plan["days"][0]["exercises"]} == {"press", "old-fly"}


class TestADeclaredRemovalIsBelieved:
    """
    Where a per-exercise source is legitimate — a logged session the user
    pointed at by name — a draft that says what it dropped must be believed.
    Only "removed" and "swapped" ever were, so any other verb put the lift
    straight back and left a `changes` entry asserting the opposite of what
    the plan contained.
    """

    SOURCE = {"days": [day("Push A", ex("old-fly", "Cable Chest Fly (Mid)"),
                           ex("press", "Incline Dumbbell Press"))]}

    def merge(self, proposal):
        return [e["exercise_id"] for e in complete_routine(
            proposal, self.SOURCE, backfill_exercises=True)["days"][0]["exercises"]]

    @pytest.mark.parametrize(
        "action", ["removed", "remove", "removing", "swapped", "swap",
                   "replaced", "replace", "dropped", "drop", "deleted"]
    )
    def test_any_removal_verb_sticks(self, action):
        assert self.merge({
            "days": [day("Push A", ex("press", "Incline Dumbbell Press"))],
            "changes": [{"action": action, "day_name": "Push A",
                         "exercise_name": "Cable Chest Fly (Mid)"}],
        }) == ["press"]

    def test_a_removal_can_name_the_lift_by_id(self):
        assert self.merge({
            "days": [day("Push A", ex("press", "Incline Dumbbell Press"))],
            "changes": [{"action": "removed", "day_name": "Push A",
                         "exercise_id": "old-fly"}],
        }) == ["press"]

    def test_an_unrelated_change_is_not_a_removal(self):
        """A model that reorders and fills `replaces` in has not removed
        anything. Reading it as one would delete work nobody asked to lose."""
        assert set(self.merge({
            "days": [day("Push A", ex("press", "Incline Dumbbell Press"))],
            "changes": [{"action": "reordered", "day_name": "Push A",
                         "exercise_name": "Incline Dumbbell Press",
                         "replaces": "Cable Chest Fly (Mid)"}],
        })) == {"press", "old-fly"}

    def test_silence_preserves_on_this_path(self):
        assert set(self.merge(
            {"days": [day("Push A", ex("press", "Incline Dumbbell Press"))]}
        )) == {"press", "old-fly"}


class TestOneLiftUnderTwoIds:
    """
    A user's own custom exercise carries its Firestore doc id. The same lift
    named in prose by a coach edit is minted a fresh `custom-xxxxxxxx`. Keyed
    on `id or name` the two never matched, so preservation inserted a second
    copy of a lift the day already had — and the plan showed "Cable Tricept
    Pushdown" twice, ten lines apart, with identical rep ranges.
    """

    def test_the_same_name_under_a_different_id_is_the_same_lift(self):
        source = {"days": [day("Push A", ex("Sx3pm3BVNsrgTn3T0Sjr",
                                            "Cable Tricept Pushdown"))]}
        proposal = {"days": [day("Push A", ex("custom-cb2adc68",
                                              "Cable Tricept Pushdown"))]}
        kept = complete_routine(proposal, source,
                                backfill_exercises=True)["days"][0]["exercises"]
        assert len(kept) == 1

    def test_a_day_cannot_ship_the_same_lift_twice(self):
        plan = PlanBuilder.validate_plan({"days": [day(
            "Push A",
            ex("custom-cb2adc68", "Cable Tricept Pushdown"),
            ex("default-chest-db-incline-press", "Incline Dumbbell Press"),
            ex("Sx3pm3BVNsrgTn3T0Sjr", "Cable Tricept Pushdown"),
        )], "weekly_schedule": {"monday": "Push A"}})
        names = [e["exercise_name"] for e in plan["days"][0]["exercises"]]
        assert names.count("Cable Tricept Pushdown") == 1
        assert "Incline Dumbbell Press" in names


class TestImportingASessionImportsThatSession:
    """
    `split_context["days"]` is a reconstruction: the union of the last few
    sessions logged under a day name, so it holds every substitution the user
    has ever tried. Sourcing the referenced-workout merge from it meant that
    importing one named session also imported all of that — which is how a
    cable fly done once, in August, became a permanent fixture of Push A.
    """

    CONTEXT = {
        "days": [{
            "day_name": "Push A",
            # What the reconstruction holds: the import, plus leftovers from
            # other sessions, in the shape `_exercise_prescription` returns.
            "exercises": [
                {"exercise_id": "press", "exercise_name": "Incline Dumbbell Press",
                 "sets": 4, "reps": 6, "rest_seconds": 120},
                {"exercise_id": "fly-low-high", "exercise_name": "Cable Chest Fly (Low to High)",
                 "sets": 3, "reps": 8, "rest_seconds": 120},
            ],
        }],
        "referenced_workouts": [{
            "date": "2026-09-04", "found": True, "target_day": "Push A",
            "exercises": [
                {"exercise_id": "press", "exercise_name": "Incline Dumbbell Press",
                 "sets": 4, "reps": 6},
            ],
        }],
    }

    def test_only_the_referenced_session_is_imported(self):
        imported = PlanBuilder._imported_days(self.CONTEXT)
        assert [e["exercise_id"] for e in imported[0]["exercises"]] == ["press"]

    def test_a_session_that_was_not_found_imports_nothing(self):
        assert PlanBuilder._imported_days(
            {"referenced_workouts": [{"date": "2026-09-04", "found": False}]}
        ) == []

    def test_two_sessions_onto_one_day_merge_without_duplicating(self):
        context = {"referenced_workouts": [
            {"found": True, "target_day": "Push A", "exercises": [
                {"exercise_id": "press", "exercise_name": "Incline Dumbbell Press"}]},
            {"found": True, "target_day": "Push A", "exercises": [
                {"exercise_id": "press", "exercise_name": "Incline Dumbbell Press"},
                {"exercise_id": "dips", "exercise_name": "Parallel Bar Dips"}]},
        ]}
        imported = PlanBuilder._imported_days(context)
        assert [e["exercise_id"] for e in imported[0]["exercises"]] == ["press", "dips"]
