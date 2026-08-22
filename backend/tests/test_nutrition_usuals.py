"""One-tap usuals: what shows, when, and whether it counts as eaten."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from nutrition.usuals import (
    applies_on_weekday,
    build_usuals,
    current_slot,
    entry_totals,
    find_usual,
    foods_to_log,
    learn_usuals,
    logged_state,
)


PLAN = {
    "status": "active",
    "targets": {"calories": 2200, "protein": 175},
    "meal_anchors": [
        {
            "id": "anchor-breakfast",
            "slot": "breakfast",
            "label": "Breakfast",
            "frequency": "daily",
            "foods": [
                {"name": "Greek yogurt", "calories": 150, "protein": 20},
                {"name": "Oatmeal", "calories": 300, "protein": 10},
            ],
        },
        {
            "id": "anchor-shake",
            "slot": "shake",
            "label": "Protein shake",
            "frequency": "daily",
            "foods": [{"name": "Protein shake", "amount": "1 scoop", "calories": 200, "protein": 30}],
        },
    ],
}


def test_plan_anchors_become_tappable_usuals():
    payload = build_usuals(PLAN, [], hour=8, weekday=2)

    assert payload["has_usuals"] is True
    assert [u["id"] for u in payload["usuals"]] == ["anchor-breakfast"]
    breakfast = find_usual(payload, "anchor-breakfast")
    assert breakfast["calories"] == 450
    assert breakfast["protein"] == 30
    assert breakfast["detail"] == "Greek yogurt, Oatmeal"
    assert breakfast["logged"] is False
    assert payload["expected_count"] == 1
    assert payload["logged_count"] == 0


def test_breakfast_hides_after_10am():
    """At 10:57 only snack-window items should show — not breakfast."""
    plan = {
        **PLAN,
        "go_to_items": [
            {"id": "goto-snack", "slot": "snack", "name": "Premier Protein Shake", "calories": 160, "protein": 30},
            {"id": "goto-anytime", "slot": "other", "name": "yogurt cup", "calories": 100, "protein": 12},
        ],
    }
    payload = build_usuals(plan, [], hour=10, weekday=2)

    assert find_usual(payload, "anchor-breakfast") is None
    assert find_usual(payload, "goto-snack") is not None
    assert find_usual(payload, "goto-anytime") is not None
    slot_ids = [s["slot"] for s in payload["slots"]]
    assert "breakfast" not in slot_ids


def test_current_slot_follows_the_clock():
    assert current_slot(["breakfast", "shake", "dinner"], 8) == "breakfast"
    assert current_slot(["breakfast", "shake", "dinner"], 10) == "shake"
    assert current_slot(["breakfast", "shake", "dinner"], 19) == "dinner"
    # Before any window opens, lead with the first meal of the day.
    assert current_slot(["breakfast", "dinner"], 4) == "breakfast"
    assert current_slot([], 9) is None


def test_current_slot_is_ordered_first():
    """At dinner time the dinner tile should not be buried behind breakfast."""
    plan = {
        **PLAN,
        "meal_anchors": PLAN["meal_anchors"] + [{
            "id": "anchor-dinner",
            "slot": "dinner",
            "label": "Dinner",
            "frequency": "daily",
            "foods": [{"name": "Chicken and rice", "calories": 700, "protein": 50}],
        }],
    }
    payload = build_usuals(plan, [], hour=19, weekday=2)

    assert payload["current_slot"] == "dinner"
    assert payload["current_slot_label"] == "Dinner"
    assert payload["current_time_label"] == "Dinner time"
    assert payload["slots"][0]["slot"] == "dinner"
    assert payload["usuals"][0]["id"] == "anchor-dinner"


def test_slots_carry_a_time_of_day_label():
    plan = {
        **PLAN,
        "meal_anchors": PLAN["meal_anchors"] + [{
            "id": "anchor-late", "slot": "late_night", "label": "Cottage cheese",
            "frequency": "daily", "foods": [{"name": "Cottage cheese", "calories": 180, "protein": 24}],
        }],
    }
    payload = build_usuals(plan, [], hour=8, weekday=2)
    labels = {slot["slot"]: slot["time_label"] for slot in payload["slots"]}

    assert labels == {"breakfast": "Breakfast time"}
    assert find_usual(payload, "anchor-late") is None


def test_tapped_usual_reads_as_logged_and_can_be_undone():
    logged = [
        {"name": "Greek yogurt", "meal": "Breakfast", "calories": 150, "protein": 20, "usual_id": "anchor-breakfast"},
        {"name": "Oatmeal", "meal": "Breakfast", "calories": 300, "protein": 10, "usual_id": "anchor-breakfast"},
    ]
    payload = build_usuals(PLAN, logged, hour=9, weekday=2)
    breakfast = find_usual(payload, "anchor-breakfast")

    assert breakfast["logged"] is True
    assert breakfast["can_undo"] is True
    assert payload["logged_count"] == 1


def test_hand_logged_food_counts_as_eaten_but_is_not_removable():
    """Otherwise tapping it would double-log, or delete food we never wrote."""
    logged = [
        {"name": "Greek yogurt", "meal": "Breakfast", "calories": 150, "protein": 20},
        {"name": "Oatmeal", "meal": "Breakfast", "calories": 300, "protein": 10},
    ]
    breakfast = find_usual(build_usuals(PLAN, logged, hour=9, weekday=2), "anchor-breakfast")

    assert breakfast["logged"] is True
    assert breakfast["can_undo"] is False


def test_partly_eaten_usual_is_not_marked_logged():
    logged = [{"name": "Greek yogurt", "meal": "Breakfast", "calories": 150, "protein": 20}]
    assert logged_state("anchor-breakfast", PLAN["meal_anchors"][0]["foods"], logged) == (False, False)


def test_weekday_only_usuals_hide_on_the_weekend():
    plan = {
        "status": "active",
        "meal_anchors": [{
            "id": "anchor-desk-lunch",
            "slot": "lunch",
            "label": "Desk lunch",
            "frequency": "weekdays",
            "foods": [{"name": "Turkey wrap", "calories": 500, "protein": 35}],
        }],
    }
    assert build_usuals(plan, [], hour=12, weekday=2)["has_usuals"] is True
    assert build_usuals(plan, [], hour=12, weekday=5)["has_usuals"] is False

    assert applies_on_weekday("weekdays", 4) is True
    assert applies_on_weekday("weekends", 4) is False
    assert applies_on_weekday("daily", 6) is True


def test_occasional_usuals_show_but_do_not_count_against_the_day():
    plan = {
        "status": "active",
        "meal_anchors": [
            {
                "id": "anchor-shake",
                "slot": "shake",
                "label": "Protein shake",
                "frequency": "daily",
                "foods": [{"name": "Protein shake", "calories": 200, "protein": 30}],
            },
            {
                "id": "anchor-treat",
                "slot": "snack",
                "label": "Ice cream",
                "frequency": "occasionally",
                "foods": [{"name": "Ice cream", "calories": 300, "protein": 5}],
            },
        ],
    }
    payload = build_usuals(plan, [], hour=10, weekday=2)

    assert len(payload["usuals"]) == 2
    assert payload["expected_count"] == 1
    assert find_usual(payload, "anchor-treat")["expected"] is False


def test_learns_repeat_foods_from_the_log():
    history = [
        {"date": f"2026-08-{day:02d}", "food_items": [
            {"name": "Protein shake", "meal": "Snacks", "calories": 200, "protein": 30},
            {"name": "Chipotle bowl", "meal": "Lunch", "calories": 800, "protein": 45},
        ]}
        for day in (10, 11, 12)
    ] + [
        {"date": "2026-08-13", "food_items": [{"name": "Sushi", "meal": "Dinner", "calories": 600, "protein": 30}]}
    ]

    learned = learn_usuals(history)
    names = [u["label"] for u in learned]

    assert "Protein shake" in names
    assert "Chipotle bowl" in names
    # One-off dinners are not somebody's routine.
    assert "Sushi" not in names
    shake = next(u for u in learned if u["label"] == "Protein shake")
    assert shake["id"] == "learned:protein-shake"
    assert shake["slot"] == "snack"
    assert shake["days_logged"] == 3
    assert shake["foods"][0]["calories"] == 200


def test_learning_counts_days_not_entries():
    """Three coffees in one morning is not a daily habit."""
    history = [{"date": "2026-08-10", "food_items": [
        {"name": "Latte", "meal": "Breakfast", "calories": 120, "protein": 6},
    ] * 3}]
    assert learn_usuals(history) == []


def test_learned_usuals_fill_in_when_there_is_no_plan():
    history = [
        {"date": f"2026-08-{day:02d}", "food_items": [
            {"name": "Egg whites", "meal": "Breakfast", "calories": 180, "protein": 32},
        ]}
        for day in (10, 11, 12)
    ]
    payload = build_usuals(None, [], history=history, hour=8, weekday=2)

    assert payload["has_usuals"] is True
    assert payload["usuals"][0]["source"] == "learned"
    assert payload["usuals"][0]["slot"] == "breakfast"


def test_learned_usuals_do_not_duplicate_plan_anchors():
    history = [
        {"date": f"2026-08-{day:02d}", "food_items": [
            {"name": "Protein shake", "meal": "Snacks", "calories": 200, "protein": 30},
        ]}
        for day in (10, 11, 12)
    ]
    payload = build_usuals(PLAN, [], history=history, hour=10, weekday=2)

    assert [u["source"] for u in payload["usuals"]] == ["plan"]


def test_foods_to_log_tags_items_for_undo():
    usual = find_usual(build_usuals(PLAN, [], hour=10, weekday=2), "anchor-shake")
    items = foods_to_log(usual)

    assert len(items) == 1
    assert items[0]["usual_id"] == "anchor-shake"
    assert items[0]["meal"] == "Snacks"
    assert items[0]["amount"] == "1 scoop"
    assert items[0]["calories"] == 200
    assert items[0]["protein"] == 30


def test_entry_totals_match_the_items():
    totals = entry_totals([
        {"calories": 150, "protein": 20, "carbs": 8, "fats": 4},
        {"calories": 300, "protein": 10, "carbs": 50, "fats": 5, "fiber": 6},
    ])
    assert totals["total_calories"] == 450
    assert totals["total_protein"] == 30
    assert totals["total_carbs"] == 58
    assert totals["total_fats"] == 9
    assert totals["total_fiber"] == 6


def test_no_plan_and_no_history_is_an_empty_row():
    payload = build_usuals(None, [], hour=9, weekday=2)
    assert payload["has_usuals"] is False
    assert payload["usuals"] == []
    assert payload["current_slot"] is None
