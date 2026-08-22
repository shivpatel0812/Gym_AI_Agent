"""Nutrition plan builder validation, fallback, and today guidance."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from nutrition.plan_builder import (
    NutritionPlanBuilder,
    GOAL_KEYS,
    infer_nutrition_goal,
    suggest_nutrition_goal,
)
from nutrition.today_guidance import build_today_guidance, plan_coverage


def test_fallback_plan_keeps_anchors_and_flexible_dinner():
    answers = {
        "goal": "muscle",
        "goal_notes": "Build muscle without a lot of extra fat",
        "typical_day": "Greek yogurt and oatmeal every morning, protein shake midday, family dinner",
        "meal_anchors": [
            {
                "slot": "breakfast",
                "label": "Breakfast",
                "frequency": "daily",
                "foods": [
                    {"name": "Greek yogurt", "calories": 150, "protein": 20},
                    {"name": "oatmeal", "calories": 300, "protein": 10},
                ],
            },
            {
                "slot": "shake",
                "label": "Protein shake",
                "frequency": "daily",
                "foods": [{"name": "protein shake", "calories": 200, "protein": 30}],
            },
        ],
        "flexible_meals": [
            {
                "name": "Dinner",
                "frequency": "most_days",
                "calorie_min": 650,
                "calorie_max": 900,
                "protein_min": 25,
                "protein_max": 40,
                "user_controls_food": False,
            }
        ],
        "preferences": {"guidance_style": "flexible", "likes": ["berries"]},
    }
    plan = NutritionPlanBuilder.fallback_plan(answers)
    assert plan["goal"] == "muscle"
    assert plan["targets"]["calories"] >= 1200
    assert len(plan["meal_anchors"]) == 2
    assert plan["meal_anchors"][0]["foods"][0]["name"] == "Greek yogurt"
    assert plan["flexible_meals"][0]["name"] == "Dinner"
    assert plan["flexible_meals"][0]["calorie_min"] == 650
    assert "dinner" in (plan["strategy"] or "").lower() or "Dinner" in (plan["strategy"] or "")


def test_validate_plan_clamps_and_fills_ids():
    plan = NutritionPlanBuilder.validate_plan({
        "goal": "not-a-goal",
        "targets": {"calories": 50, "protein": 900},
        "meal_anchors": [{"label": "Breakfast", "foods": [{"name": "eggs"}]}],
        "flexible_meals": [{"name": "Dinner", "calorie_min": 900, "calorie_max": 600}],
    })
    assert plan["goal"] == "maintain"
    assert 1200 <= plan["targets"]["calories"] <= 4500
    assert 60 <= plan["targets"]["protein"] <= 300
    assert plan["meal_anchors"][0]["id"]
    assert plan["flexible_meals"][0]["calorie_min"] <= plan["flexible_meals"][0]["calorie_max"]


def test_normalize_go_to_items():
    plan = NutritionPlanBuilder.validate_plan({
        "goal": "muscle",
        "go_to_items": [
            {"name": "Premier Protein Shake", "slot": "shake", "calories": 160, "protein": 30},
            "Greek yogurt",
        ],
    })
    assert len(plan["go_to_items"]) == 2
    assert plan["go_to_items"][0]["id"]
    assert plan["go_to_items"][0]["slot"] == "shake"
    assert plan["go_to_items"][0]["name"] == "Premier Protein Shake"
    assert plan["go_to_items"][0]["protein"] == 30
    assert plan["go_to_items"][1]["name"] == "Greek yogurt"
    assert plan["go_to_items"][1]["slot"] == "other"


def test_today_guidance_dinner_budget_after_anchors():
    plan = {
        "status": "active",
        "goal": "muscle",
        "targets": {"calories": 2200, "protein": 175},
        "meal_anchors": [
            {"slot": "breakfast", "label": "Breakfast", "foods": [{"name": "Greek yogurt"}]},
            {"slot": "shake", "label": "Protein shake", "foods": [{"name": "protein shake"}]},
        ],
        "flexible_meals": [
            {"name": "Dinner", "calorie_min": 650, "calorie_max": 900, "protein_min": 25, "protein_max": 40}
        ],
        "food_priorities": ["Leave calorie flexibility for dinner"],
        "preferences": {"likes": ["Greek yogurt"], "guidance_style": "flexible"},
    }
    logged = [
        {"name": "Greek yogurt", "meal": "Breakfast", "calories": 150, "protein": 20, "carbs": 8, "fats": 4},
        {"name": "oatmeal", "meal": "Breakfast", "calories": 300, "protein": 10, "carbs": 50, "fats": 5},
        {"name": "protein shake", "meal": "Snacks", "calories": 200, "protein": 30, "carbs": 8, "fats": 3},
    ]
    guidance = build_today_guidance(plan, logged)
    assert guidance["has_plan"] is True
    assert guidance["remaining"]["calories"] == 1550
    assert any("Dinner" in m for m in guidance["messages"])
    assert guidance["remaining"]["protein"] == 115
    assert any("protein" in m.lower() for m in guidance["messages"])
    # Both anchors are logged, so the whole remainder is free for dinner.
    assert guidance["available_for_flexible"] == 1550


def test_dinner_budget_excludes_unlogged_anchors():
    """The headline must not offer the lunch anchor's calories to dinner."""
    plan = {
        "status": "active",
        "targets": {"calories": 2800, "protein": 180},
        "meal_anchors": [
            {
                "slot": "breakfast",
                "label": "Breakfast",
                "foods": [{"name": "Greek yogurt", "calories": 342, "protein": 26}],
            },
            {
                "slot": "lunch",
                "label": "Lunch",
                "foods": [{"name": "Chicken breast", "calories": 535, "protein": 61}],
            },
        ],
        "flexible_meals": [
            {"name": "Dinner", "calorie_min": 650, "calorie_max": 900, "protein_max": 40}
        ],
    }
    logged = [{"name": "Greek yogurt", "meal": "Breakfast", "calories": 331, "protein": 20}]

    guidance = build_today_guidance(plan, logged)

    # 2800 - 331 logged = 2469 left, minus the 535 lunch anchor still to come.
    assert guidance["remaining"]["calories"] == 2469
    assert guidance["available_for_flexible"] == 1934
    assert "1934" in guidance["headline"]
    assert "Lunch" in guidance["headline"]
    # The old code reported the stored 650-900 range as the available budget.
    assert "650–900" not in guidance["headline"]


def test_guidance_does_not_suggest_food_already_eaten():
    plan = {
        "status": "active",
        "targets": {"calories": 2800, "protein": 180},
        "meal_anchors": [
            {
                "slot": "breakfast",
                "label": "Breakfast",
                "foods": [{"name": "Chicken breast", "calories": 300, "protein": 60}],
            }
        ],
        "preferences": {"likes": ["chicken", "paneer"]},
    }
    logged = [{"name": "Chicken breast", "meal": "Lunch", "calories": 300, "protein": 60}]

    guidance = build_today_guidance(plan, logged)
    protein_msg = " ".join(m for m in guidance["messages"] if "protein" in m.lower())

    # "chicken" and "Chicken breast" are the same food and it was already eaten.
    assert "hicken" not in protein_msg
    assert "paneer" in protein_msg


def test_protein_suggestions_dedupe_overlapping_names():
    """A like that is a substring of an anchor food must not be listed twice."""
    plan = {
        "status": "active",
        "targets": {"calories": 2800, "protein": 180},
        "meal_anchors": [
            {
                "slot": "lunch",
                "label": "Lunch",
                "foods": [{"name": "Chicken breast", "calories": 535, "protein": 61}],
            }
        ],
        "preferences": {"likes": ["chicken", "paneer"]},
    }

    guidance = build_today_guidance(plan, [])
    protein_msg = " ".join(m for m in guidance["messages"] if "protein" in m.lower())

    assert "Chicken breast" in protein_msg
    assert "chicken," not in protein_msg
    assert "paneer" in protein_msg


def test_plan_coverage_flags_unreachable_target():
    """Anchors + flexible max fall ~1000 kcal short of the 2800 target."""
    plan = {
        "status": "active",
        "targets": {"calories": 2800, "protein": 180},
        "meal_anchors": [
            {"label": "Breakfast", "foods": [{"name": "Yogurt", "calories": 342, "protein": 26}]},
            {"label": "Lunch", "foods": [{"name": "Chicken", "calories": 535, "protein": 61}]},
        ],
        "flexible_meals": [
            {"name": "Dinner", "calorie_min": 650, "calorie_max": 900, "protein_max": 40}
        ],
    }

    coverage = plan_coverage(plan)
    assert coverage["planned_calories_max"] == 1777
    assert coverage["calorie_gap"] == 1023
    assert coverage["protein_gap"] == 53

    guidance = build_today_guidance(plan, [])
    assert any("unplanned" in m for m in guidance["messages"])


def test_plan_coverage_silent_when_plan_adds_up():
    plan = {
        "status": "active",
        "targets": {"calories": 2000, "protein": 150},
        "meal_anchors": [
            {"label": "Breakfast", "foods": [{"name": "Yogurt", "calories": 600, "protein": 60}]},
            {"label": "Lunch", "foods": [{"name": "Chicken", "calories": 700, "protein": 60}]},
        ],
        "flexible_meals": [
            {"name": "Dinner", "calorie_min": 600, "calorie_max": 800, "protein_max": 45}
        ],
    }
    coverage = plan_coverage(plan)
    assert coverage["calorie_gap"] == -100
    assert not any("unplanned" in m for m in build_today_guidance(plan, [])["messages"])


def test_suggest_goal_reads_the_training_plan():
    training = {
        "has_plan": True,
        "plan_name": "Push Pull Legs Hypertrophy",
        "primary_goal": "build muscle",
        "days": [{"name": "Push", "focus": "chest", "exercises": ["Incline bench"]}] * 5,
    }
    suggestion = suggest_nutrition_goal(training)

    assert suggestion["goal"] == "muscle"
    assert suggestion["label"] == "Gain muscle"
    assert suggestion["from_training"] is True
    assert "Push Pull Legs Hypertrophy" in suggestion["reason"]
    assert "5 days/week" in suggestion["reason"]


def test_suggest_goal_detects_a_cut():
    training = {
        "has_plan": True,
        "plan_name": "Summer Cut",
        "primary_goal": "lose fat",
        "days": [],
    }
    assert suggest_nutrition_goal(training)["goal"] == "fat_loss"


def test_suggest_goal_without_training_plan_is_not_presented_as_derived():
    suggestion = suggest_nutrition_goal({"has_plan": False})

    assert suggestion["from_training"] is False
    assert suggestion["goal"] in GOAL_KEYS
    # The wizard hides the "from your training plan" banner on this.
    assert "No active training plan" in suggestion["reason"]


def test_explicit_goal_still_wins_over_inference():
    training = {"has_plan": True, "primary_goal": "build muscle", "days": []}
    assert infer_nutrition_goal({"goal": "fat_loss"}, training) == "fat_loss"


def test_today_guidance_without_plan():
    assert build_today_guidance(None, []) == {"has_plan": False}


def test_goal_keys_cover_product_goals():
    assert set(GOAL_KEYS) == {"fat_loss", "maintain", "muscle", "lean_bulk", "health"}


def test_infer_nutrition_goal_from_training_lifts():
    assert infer_nutrition_goal({}, {
        "has_plan": True,
        "primary_goal": "Hit 85s on incline press",
        "days": [{"exercises": ["Incline Dumbbell Press"]}],
    }) == "muscle"
    assert infer_nutrition_goal({"goal": "fat_loss"}, {
        "primary_goal": "Get stronger on bench",
    }) == "fat_loss"
    assert infer_nutrition_goal({"conversation_notes": "I want to cut for summer"}) == "fat_loss"


def test_fallback_plan_mentions_training_goal():
    plan = NutritionPlanBuilder.fallback_plan({
        "goal": "muscle",
        "training_context": {"has_plan": True, "primary_goal": "Hit 85s on incline press"},
    })
    assert "incline press" in (plan["strategy"] or "").lower()


def _existing_plan():
    return NutritionPlanBuilder.validate_plan({
        "goal": "muscle",
        "meal_anchors": [
            {
                "id": "keep-me",
                "slot": "breakfast",
                "label": "Breakfast",
                "kind": "potential",
                "place": "Fannie Mae",
                "days": ["mon", "tue", "wed"],
                "frequency": "most_days",
                "foods": [{"name": "Greek yogurt", "calories": 150, "protein": 20}],
            }
        ],
        "go_to_items": [{"id": "goto-1", "name": "Rice cakes", "slot": "snack"}],
        "preferences": {"likes": ["yogurt"], "dietary_restrictions": "no shellfish"},
    })


def test_preserve_existing_keeps_user_anchors_verbatim():
    existing = _existing_plan()
    regenerated = NutritionPlanBuilder.validate_plan({
        "goal": "muscle",
        # A "redesign" that drops the user's breakfast and invents a new one.
        "meal_anchors": [
            {"slot": "lunch", "label": "Chicken bowl", "foods": [{"name": "chicken"}]}
        ],
        "go_to_items": [],
        "preferences": {"likes": ["chicken"]},
    })

    merged = NutritionPlanBuilder.preserve_existing(regenerated, existing)

    kept = next(a for a in merged["meal_anchors"] if a["id"] == "keep-me")
    assert kept["kind"] == "potential"
    assert kept["place"] == "Fannie Mae"
    assert kept["days"] == ["mon", "tue", "wed"]
    assert [f["name"] for f in kept["foods"]] == ["Greek yogurt"]

    added = [a for a in merged["meal_anchors"] if a["id"] != "keep-me"]
    assert [a["label"] for a in added] == ["Chicken bowl"]
    assert "on top" in (added[0]["notes"] or "")

    assert [g["name"] for g in merged["go_to_items"]] == ["Rice cakes"]
    assert merged["preferences"]["likes"] == ["yogurt", "chicken"]
    assert merged["preferences"]["dietary_restrictions"] == "no shellfish"
    assert "Chicken bowl" in merged["carryover_note"]


def test_preserve_existing_drops_ai_copies_of_the_same_meal():
    existing = _existing_plan()
    regenerated = NutritionPlanBuilder.validate_plan({
        "goal": "muscle",
        # Same slot + label as the anchor the user already set.
        "meal_anchors": [
            {"slot": "breakfast", "label": "Breakfast", "foods": [{"name": "egg whites"}]}
        ],
    })

    merged = NutritionPlanBuilder.preserve_existing(regenerated, existing)

    assert len(merged["meal_anchors"]) == 1
    assert [f["name"] for f in merged["meal_anchors"][0]["foods"]] == ["Greek yogurt"]
    assert "stay exactly as you entered them" in merged["carryover_note"]


def test_wizard_anchors_survive_a_model_that_ignores_them():
    """No live plan yet — the meals typed into the wizard are still locked."""
    answers = {
        "goal": "muscle",
        "meal_anchors": [
            {"slot": "breakfast", "label": "Breakfast", "foods": [{"name": "Greek yogurt"}]}
        ],
    }
    locked = NutritionPlanBuilder._locked_source(None, answers)
    model_output = NutritionPlanBuilder.validate_plan({
        "goal": "muscle",
        "meal_anchors": [
            # Same meal, re-costed — plus one the model invented.
            {
                "slot": "breakfast",
                "label": "Breakfast",
                "foods": [{"name": "Greek yogurt", "amount": "1 cup", "calories": 150, "protein": 20}],
            },
            {"slot": "snack", "label": "Cottage cheese", "foods": [{"name": "cottage cheese"}]},
        ],
    })

    merged = NutritionPlanBuilder.preserve_existing(model_output, locked)

    labels = [a["label"] for a in merged["meal_anchors"]]
    assert labels == ["Breakfast", "Cottage cheese"]
    # The user's food kept its identity but picked up the model's estimate.
    yogurt = merged["meal_anchors"][0]["foods"][0]
    assert yogurt["name"] == "Greek yogurt"
    assert yogurt["calories"] == 150
    assert yogurt["amount"] == "1 cup"


def test_cold_start_with_no_user_input_has_no_carryover_note():
    assert NutritionPlanBuilder._locked_source(None, {"goal": "muscle"}) is None
    plan = NutritionPlanBuilder.validate_plan({"goal": "muscle"})
    assert NutritionPlanBuilder.preserve_existing(plan, None)["carryover_note"] is None


def test_health_focus_shapes_priorities_and_fiber_floor():
    plan = NutritionPlanBuilder.validate_plan({
        "goal": "maintain",
        "targets": {"calories": 2200, "protein": 160, "fiber": 18},
        "health_focuses": ["cholesterol", "not_a_real_focus"],
        "health_notes": "  Doctor flagged my LDL  ",
        "food_priorities": ["Prioritize protein in meals you control"],
    })

    assert plan["health_focuses"] == ["cholesterol"]
    assert plan["health_notes"] == "Doctor flagged my LDL"
    assert plan["targets"]["fiber"] >= 32
    assert any("soluble fiber" in p for p in plan["food_priorities"])
    assert "Prioritize protein in meals you control" in plan["food_priorities"]


def test_health_focus_accepted_from_answers_and_kept_through_regenerate():
    plan = NutritionPlanBuilder.fallback_plan({
        "goal": "maintain",
        "health_focuses": ["blood_sugar"],
    })
    assert plan["health_focuses"] == ["blood_sugar"]
    assert "doctor or dietitian" in (plan["strategy"] or "")

    # A later regenerate that says nothing about health keeps the focus.
    locked = NutritionPlanBuilder._locked_source(plan, {})
    regenerated = NutritionPlanBuilder.validate_plan({"goal": "maintain"})
    assert NutritionPlanBuilder.preserve_existing(regenerated, locked)["health_focuses"] == [
        "blood_sugar"
    ]


def test_health_focus_labels_ignore_unknown_ids():
    from nutrition.plan_builder import health_focus_labels

    assert health_focus_labels(["digestion", "cancer"]) == ["Easier digestion"]
    assert health_focus_labels(None) == []
