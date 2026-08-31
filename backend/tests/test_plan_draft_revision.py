"""
Regenerating while a draft is pending revises that draft.

Taken from a live failure. The user ended their active plan, generated a draft
containing Pull A / Push A / Legs / Pull B / Push B, then asked the coach to
"make sure the weighted dips are in the push day". Because /propose consulted
only the *active* plan and there was none, the builder saw no existing plan at
all and rebuilt from the conversation — whose last turns were entirely about
dips on a push day. The result was a two-day, push-only plan that went live.
The three lost days were never removed; they were never in scope.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.plan_store import (
    STATUS_ACTIVE,
    STATUS_DRAFT,
    STATUS_SUPERSEDED,
    PlanStore,
)


class FakeDoc:
    def __init__(self, doc_id, data, exists=True):
        self.id = doc_id
        self._data = data
        self.exists = exists

    def to_dict(self):
        return dict(self._data)


class FakeDocRef:
    def __init__(self, collection, doc_id):
        self._collection = collection
        self.id = doc_id

    def get(self):
        data = self._collection.store.get(self.id)
        return FakeDoc(self.id, data or {}, exists=data is not None)

    def set(self, data):
        self._collection.store[self.id] = dict(data)

    def update(self, patch):
        self._collection.store.setdefault(self.id, {}).update(patch)


class FakeCollection:
    def __init__(self, store):
        self.store = store

    def document(self, doc_id=None):
        if doc_id is None:
            doc_id = f"generated-{len(self.store) + 1}"
        return FakeDocRef(self, doc_id)

    def limit(self, _n):
        return self

    def stream(self):
        return [FakeDoc(k, v) for k, v in self.store.items()]

    def collection(self, _name):
        return self


class FakeDb:
    """Minimal Firestore stand-in: users/{uid}/workout_plans."""

    def __init__(self, plans):
        self._collection = FakeCollection(dict(plans))

    def collection(self, _name):
        return self

    def document(self, _doc_id):
        return self

    # users/{uid}.collection("workout_plans")
    def __getattr__(self, name):
        raise AttributeError(name)


class FakeRoot:
    def __init__(self, plans):
        self.plans = FakeCollection(dict(plans))

    def collection(self, _name):
        return _Doc(self)


class _Doc:
    def __init__(self, root):
        self.root = root

    def document(self, _uid):
        return self

    def collection(self, _name):
        return self.root.plans


def store_with(plans):
    return PlanStore(FakeRoot(plans), "uid")


FIVE_DAY_DRAFT = {
    "plan_name": "Incline Power Push",
    "status": STATUS_DRAFT,
    "created_at": "2026-08-30T17:24:53",
    "source_conversation_id": "convo-1",
    "days": [
        {"day_name": "Pull A", "exercises": []},
        {"day_name": "Push A", "exercises": []},
        {"day_name": "Legs", "exercises": []},
        {"day_name": "Pull B", "exercises": []},
        {"day_name": "Push B", "exercises": []},
    ],
}


def test_a_pending_draft_is_found_when_nothing_is_active():
    store = store_with({"draft-1": FIVE_DAY_DRAFT})

    assert store.get_active() is None
    draft = store.latest_draft(conversation_id="convo-1")
    assert draft is not None
    assert [d["day_name"] for d in draft["days"]] == [
        "Pull A", "Push A", "Legs", "Pull B", "Push B"
    ]


def test_the_newest_draft_wins():
    older = {**FIVE_DAY_DRAFT, "created_at": "2026-08-30T17:00:00", "plan_name": "older"}
    newer = {**FIVE_DAY_DRAFT, "created_at": "2026-08-30T17:24:53", "plan_name": "newer"}
    store = store_with({"a": older, "b": newer})

    assert store.latest_draft(conversation_id="convo-1")["plan_name"] == "newer"


def test_a_draft_from_another_conversation_is_not_picked_up():
    """Iteration is scoped to the conversation the user is actually in."""
    other = {**FIVE_DAY_DRAFT, "source_conversation_id": "convo-2"}
    store = store_with({"a": other})

    assert store.latest_draft(conversation_id="convo-1") is None
    assert store.latest_draft(conversation_id="convo-2") is not None


def test_an_active_plan_still_takes_priority_over_a_draft():
    active = {
        "plan_name": "Live",
        "status": STATUS_ACTIVE,
        "created_at": "2026-08-29T00:00:00",
        "days": [{"day_name": "Push A", "exercises": []}],
    }
    store = store_with({"live": active, "draft": FIVE_DAY_DRAFT})

    assert store.get_active()["plan_name"] == "Live"


def test_superseding_retires_the_drafts_a_new_proposal_replaced():
    store = store_with({
        "old-1": {**FIVE_DAY_DRAFT, "created_at": "2026-08-30T17:00:00"},
        "old-2": {**FIVE_DAY_DRAFT, "created_at": "2026-08-30T17:10:00"},
        "keep": {**FIVE_DAY_DRAFT, "created_at": "2026-08-30T17:30:00"},
    })

    retired = store.supersede_drafts(keep_id="keep", conversation_id="convo-1")

    assert retired == 2
    assert store.get("keep")["status"] == STATUS_DRAFT
    assert store.get("old-1")["status"] == STATUS_SUPERSEDED
    assert store.latest_draft(conversation_id="convo-1")["created_at"] == "2026-08-30T17:30:00"


def test_superseding_leaves_other_conversations_alone():
    store = store_with({
        "mine": {**FIVE_DAY_DRAFT, "created_at": "2026-08-30T17:00:00"},
        "theirs": {**FIVE_DAY_DRAFT, "source_conversation_id": "convo-2"},
    })

    store.supersede_drafts(keep_id=None, conversation_id="convo-1")

    assert store.get("theirs")["status"] == STATUS_DRAFT


def test_carry_forward_rescues_the_draft_days_a_follow_up_did_not_mention():
    """
    The end-to-end shape of the fix: with the draft supplied as the baseline,
    a push-only proposal keeps the pull and leg days instead of losing them.
    """
    from ai_analysis.plan_builder import PlanBuilder

    def day(name, *names):
        return {
            "day_name": name,
            "exercises": [
                {"exercise_id": f"id-{n.lower().replace(' ', '-')}", "exercise_name": n,
                 "sets": 3, "reps": 8}
                for n in names
            ],
        }

    baseline = {
        "weekly_schedule": {
            "monday": "Pull A", "tuesday": "Push A", "wednesday": "Legs",
            "thursday": "Pull B", "friday": "Push B",
            "saturday": "Rest", "sunday": "Rest",
        },
        "days": [
            day("Pull A", "Lat Pulldowns", "Pull-Ups"),
            day("Push A", "Incline Dumbbell Press", "Cable Chest Fly (Mid)"),
            day("Legs", "Smith Machine Squats", "Bulgarian Split Squats"),
            day("Pull B", "Single-Arm Cable Rows", "Rope Hammer Curls"),
            day("Push B", "Incline Dumbbell Press", "Cable Tricept Pushdown"),
        ],
    }
    # What the model returned after "make sure weighted dips are on the push day"
    proposal = {
        "plan_name": "Incline Power Push",
        "weekly_schedule": {
            "tuesday": "Push A", "friday": "Push B", "monday": "Rest",
            "wednesday": "Rest", "thursday": "Rest", "saturday": "Rest", "sunday": "Rest",
        },
        "days": [
            day("Push A", "Incline Dumbbell Press", "Cable Chest Fly (Mid)"),
            day("Push B", "Incline Dumbbell Press", "Weighted Dips"),
        ],
        "changes": [],
    }

    plan = PlanBuilder.carry_forward_days(proposal, baseline)

    names = [d["day_name"] for d in plan["days"]]
    assert set(names) == {"Pull A", "Push A", "Legs", "Pull B", "Push B"}
    assert sorted(plan["carried_forward_days"]) == ["Legs", "Pull A", "Pull B"]
    # The dips the user asked for survive on the day they asked for
    push_b = next(d for d in plan["days"] if d["day_name"] == "Push B")
    assert "Weighted Dips" in [e["exercise_name"] for e in push_b["exercises"]]
    # And the rescued days get their weekdays back
    assert plan["weekly_schedule"]["wednesday"] == "Legs"
    assert plan["weekly_schedule"]["monday"] == "Pull A"
