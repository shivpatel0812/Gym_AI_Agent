"""Coach review of a user-built plan: the checkable facts behind the words."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from nutrition.plan_builder import NutritionPlanBuilder
from nutrition.plan_review import build_plan_review, plan_facts


def _plan(**overrides):
    plan = NutritionPlanBuilder.validate_plan({
        "goal": "muscle",
        "targets": {"calories": 2800, "protein": 190},
        "meal_anchors": [
            {
                "id": "b",
                "slot": "breakfast",
                "label": "Breakfast",
                "days": ["mon", "tue", "wed", "thu", "fri"],
                "foods": [{"name": "Greek yogurt", "calories": 150, "protein": 20}],
            },
            {
                "id": "d",
                "slot": "dinner",
                "label": "Dinner out",
                "kind": "uncertain",
                "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                "foods": [],
            },
        ],
    })
    plan.update(overrides)
    return plan


def test_plan_facts_finds_uncovered_days_and_slots():
    facts = plan_facts(_plan())

    # The breakfast anchor is weekdays only; the uncertain dinner covers all 7.
    assert facts["days_with_no_anchor"] == []
    assert "lunch" in facts["slots_with_no_anchor"]
    assert [u["label"] for u in facts["uncertain_meals"]] == ["Dinner out"]
    assert facts["anchor_count"] == 2


def test_plan_facts_reports_the_unplanned_calorie_gap():
    facts = plan_facts(_plan())
    # 150 kcal of anchors against a 2800 target is a large hole.
    assert facts["calorie_gap"] > 2000
    assert facts["protein_gap"] > 100


def test_review_without_a_model_still_returns_real_findings(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    review = build_plan_review(_plan())

    assert review["source"] == "rules"
    assert review["verdict"]
    titles = " ".join(i["title"] for i in review["improvements"])
    assert "unplanned" in titles or "short of target" in titles
    # Every improvement is actionable, not just an observation.
    assert all(i["how"] for i in review["improvements"])
    assert review["facts"]["anchor_count"] == 2


def test_review_leads_with_agreement_when_the_plan_is_solid(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    plan = NutritionPlanBuilder.validate_plan({
        "goal": "maintain",
        "targets": {"calories": 2000, "protein": 150},
        "meal_anchors": [
            {
                "slot": slot,
                "label": slot.title(),
                "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
                "foods": [{"name": f"{slot} food", "calories": 650, "protein": 50}],
            }
            for slot in ("breakfast", "lunch", "dinner")
        ],
    })
    review = build_plan_review(plan)

    assert review["working"]
    assert "hard part done" in " ".join(review["working"])


def test_health_focus_shows_up_in_the_review(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    review = build_plan_review(_plan(health_focuses=["cholesterol"]))

    assert any("cholesterol" in i["title"].lower() for i in review["improvements"])
