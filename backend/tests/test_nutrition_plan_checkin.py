"""Two-week check-in: the plan measured against what was actually eaten."""

import json
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from nutrition import blueprint_ai
from nutrition.logged_meals import fits_target, group_logged_by_slot, slot_log_facts
from nutrition.plan_builder import NutritionPlanBuilder
from nutrition.plan_checkin import (
    build_plan_checkin,
    checkin_edit_candidates,
    checkin_facts,
)
from nutrition.plan_review import build_plan_review


def _plan(**overrides):
    plan = NutritionPlanBuilder.validate_plan({
        "goal": "muscle",
        "targets": {"calories": 2400, "protein": 180},
        "meal_anchors": [
            {
                "id": "b",
                "slot": "breakfast",
                "label": "Shake and yogurt",
                "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                "foods": [{"name": "Shake and yogurt", "calories": 550, "protein": 50}],
            },
            {
                "id": "l",
                "slot": "lunch",
                "label": "Chipotle bowl",
                "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                "foods": [{"name": "Chipotle bowl"}],
            },
        ],
    })
    plan.update(overrides)
    return plan


def _entries(days: int = 10, dinner: str = "Dal with rice"):
    out = []
    for offset in range(days):
        out.append({
            "date": (date.today() - timedelta(days=offset)).isoformat(),
            "food_items": [
                {"name": "Shake and yogurt", "meal": "breakfast", "calories": 550, "protein": 50},
                {"name": "Chipotle bowl", "meal": "lunch", "calories": 800, "protein": 45},
                {"name": dinner, "meal": "dinner", "calories": 780, "protein": 30},
            ],
        })
    return out


def test_repeat_meals_are_counted_by_day_not_by_entry():
    """Eating the same thing twice in one sitting is not a daily habit."""
    entries = [{
        "date": "2026-08-20",
        "food_items": [
            {"name": "Rice bowl", "meal": "dinner", "calories": 400},
            {"name": "Rice bowl", "meal": "dinner", "calories": 400},
        ],
    }]
    dinner = group_logged_by_slot(entries)["dinner"]
    assert dinner[0]["times_logged"] == 1


def test_similar_names_group_together():
    entries = [
        {"date": "2026-08-20", "food_items": [{"name": "chicken burrito", "meal": "lunch", "calories": 700}]},
        {"date": "2026-08-21", "food_items": [{"name": "chicken burrito bowl", "meal": "lunch", "calories": 750}]},
    ]
    lunch = group_logged_by_slot(entries)["lunch"]
    assert len(lunch) == 1
    assert lunch[0]["times_logged"] == 2


def test_a_meal_that_runs_hot_is_flagged_with_a_reason_not_dropped():
    """The thing someone eats most is worth offering even when it does not fit."""
    target = {"calorie_min": 600, "calorie_max": 800, "protein_min": 45}
    verdict = fits_target({"calories": 1200, "protein": 40}, target)

    assert verdict["verdict"] == "over"
    assert "above" in verdict["reason"]


def test_low_protein_is_called_out_against_the_slot_floor():
    target = {"calorie_min": 600, "calorie_max": 900, "protein_min": 45}
    verdict = fits_target({"calories": 780, "protein": 15}, target)

    assert verdict["verdict"] == "low_protein"
    assert "45g" in verdict["reason"]


def test_pre_workout_is_not_flagged_for_low_protein():
    """A banana before training is fuel — protein is not this slot's job."""
    target = {
        "slot": "pre_workout",
        "calorie_min": 150,
        "calorie_max": 250,
        "protein_min": 5,
    }
    verdict = fits_target(
        {"calories": 200, "protein": 1},
        target,
        slot="pre_workout",
    )

    assert verdict["verdict"] == "fits"
    assert "training fuel" in verdict["reason"]


def test_slot_facts_score_each_logged_meal_against_the_slot_target():
    facts = slot_log_facts(
        _entries(),
        "dinner",
        {"calorie_min": 650, "calorie_max": 900, "protein_min": 45},
    )
    assert facts["days_with_logs"] == 10
    assert facts["repeat_meals"][0]["fit"] == "low_protein"


def test_checkin_finds_meals_eaten_but_never_planned():
    facts = checkin_facts(_plan(), _entries())
    habits = {h["name"] for h in facts["unplanned_habits"]}

    assert "Dal with rice" in habits
    # Things already in the plan are not reported as unplanned.
    assert not any("Chipotle" in name for name in habits)


def test_checkin_finds_saved_meals_whose_macros_the_log_can_fill():
    facts = checkin_facts(_plan(), _entries())
    missing = {m["label"]: m for m in facts["anchors_missing_macros"]}

    assert "Chipotle bowl" in missing
    assert missing["Chipotle bowl"]["logged_calories"] == 800


def test_checkin_separates_a_wrong_plan_from_an_unfollowed_one(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    # 2130 logged against a 2400 target is a real shortfall worth naming.
    checkin = build_plan_checkin(_plan(), _entries())

    assert checkin["facts"]["days_logged"] == 10
    assert checkin["facts"]["calorie_delta"] < 0
    assert checkin["improve"]
    assert all(item["how"] for item in checkin["improve"])


def test_checkin_with_no_logs_asks_for_logs_rather_than_inventing_findings(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    checkin = build_plan_checkin(_plan(), [])

    assert checkin["can_propose_edits"] is False
    assert "log" in checkin["improve"][0]["title"].lower()


def test_proposed_edits_only_ever_add_or_fill_in(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    plan = _plan()
    candidates = checkin_edit_candidates(plan, checkin_facts(plan, _entries()))
    ops = {c["op"] for c in candidates}

    assert ops == {"add_meal_anchor", "update_meal_anchor"}
    # A check-in never proposes losing a meal the user chose.
    assert not any("remove" in op for op in ops)
    # Every proposal explains itself with the user's own numbers.
    assert all(c["rationale"] for c in candidates)


def test_added_meals_are_stamped_as_coming_from_the_log():
    plan = _plan()
    candidates = checkin_edit_candidates(plan, checkin_facts(plan, _entries()))
    added = next(c for c in candidates if c["op"] == "add_meal_anchor")

    assert added["payload"]["source"] == "logged"
    assert added["payload"]["foods"][0]["calories"] == 780


class _FakeCompletions:
    """Mimics the real client closely enough to catch bad kwargs."""

    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def create(self, *, messages, model, **kwargs):
        self.calls.append({"model": model, "messages": messages, **kwargs})

        class _Message:
            content = json.dumps(self.payload)

        class _Choice:
            message = _Message()

        class _Response:
            choices = [_Choice()]

        return _Response()


class _FakeClient:
    def __init__(self, payload):
        self.chat = type("Chat", (), {"completions": _FakeCompletions(payload)})()


def test_checkin_reaches_the_model_rather_than_falling_back(monkeypatch):
    """
    Regression: these call sites used to pass `model=` alongside the kwargs
    helper, which already sets it. Python raised TypeError before the request
    was ever made, the broad except swallowed it, and the feature silently
    served the rules fallback forever.
    """
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    client = _FakeClient({
        "summary": "Ten days logged and the plan is mostly holding.",
        "continue": ["Breakfast lands in range every day."],
        "improve": [{"title": "Add your dinner", "why": "You eat it daily.", "how": "Save it."}],
    })
    monkeypatch.setattr("openai.OpenAI", lambda **kwargs: client)

    checkin = build_plan_checkin(_plan(), _entries())

    assert checkin["source"] == "ai"
    assert client.chat.completions.calls


def test_plan_review_reaches_the_model_rather_than_falling_back(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    client = _FakeClient({
        "verdict": "The shape is right, the numbers need work.",
        "working": ["Two meals mapped out."],
        "improvements": [{"title": "Fill in lunch", "why": "It is blank.", "how": "Add a meal."}],
    })
    monkeypatch.setattr("openai.OpenAI", lambda **kwargs: client)

    review = build_plan_review(_plan())

    assert review["source"] == "ai"


def test_slot_suggestions_reach_the_model_rather_than_returning_nothing(monkeypatch):
    """This is why lunch and dinner showed no recommendations at all."""
    client = _FakeClient({
        "ideas": [{
            "label": "Dal with rice",
            "foods": [{"name": "Dal with rice", "calories": 780, "protein": 30}],
            "from_logs": True,
        }],
        "guidance": "Aim for 650-900 kcal here.",
        "anchor_verdicts": [{"anchor_id": "b", "verdict": "solid", "advice": "Keep it daily."}],
    })
    monkeypatch.setattr(blueprint_ai, "_client", lambda: client)

    result = blueprint_ai.suggest_slot_fills(
        _plan(),
        "breakfast",
        slot_target={"calorie_min": 550, "calorie_max": 725, "protein_min": 45},
        log_facts=slot_log_facts(_entries(), "breakfast"),
    )

    assert result["ideas"]
    assert result["guidance"]
    assert result["anchor_verdicts"][0]["verdict"] == "solid"


def test_verdicts_about_meals_not_in_this_slot_are_dropped(monkeypatch):
    """A verdict with nothing to sit next to would render as a loose claim."""
    client = _FakeClient({
        "ideas": [{"label": "Something", "foods": [{"name": "x", "calories": 500}]}],
        "anchor_verdicts": [
            {"anchor_id": "l", "verdict": "adjust", "advice": "Lunch is light."},
            {"anchor_id": "nope", "verdict": "solid", "advice": "Unknown meal."},
        ],
    })
    monkeypatch.setattr(blueprint_ai, "_client", lambda: client)

    result = blueprint_ai.suggest_slot_fills(_plan(), "breakfast")
    assert result["anchor_verdicts"] == []


def test_an_options_anchor_needs_enough_meals_to_be_worth_rotating(monkeypatch):
    client = _FakeClient({
        "ideas": [{"label": "A", "foods": [{"name": "a", "calories": 500}]}],
        "options_anchor": {"label": "Dinner options", "foods": [{"name": "one", "calories": 700}]},
    })
    monkeypatch.setattr(blueprint_ai, "_client", lambda: client)

    result = blueprint_ai.suggest_slot_fills(_plan(), "dinner")
    assert result["options_anchor"] is None
