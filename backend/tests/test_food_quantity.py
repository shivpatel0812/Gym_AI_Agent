"""
Logging N of something: what the Saved Foods library learns from it.

A logged row stores the PRODUCT (per-unit x quantity) so every existing total
keeps summing `calories` unchanged. The library, however, stores one serving --
so the quantity has to be divided back out on the way in.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routers.macros import _logged_food_quantity, _saved_food_payload

NOW = "2026-08-24T12:00:00"


def test_multi_unit_log_is_remembered_per_serving():
    """The bug this pins: 3 rice cakes must not redefine a rice cake as 3."""
    payload = _saved_food_payload(
        {
            "name": "Rice cake",
            "calories": 105,
            "protein": 6,
            "carbs": 21,
            "fats": 0.9,
            "fiber": 1.2,
            "quantity": 3,
            "unit_amount": "1 cake",
            "amount": "3 × 1 cake",
        },
        NOW,
    )
    assert payload["calories"] == 35
    assert payload["protein"] == 2
    assert payload["carbs"] == 7
    assert payload["fats"] == 0.3
    assert payload["fiber"] == 0.4
    # The per-unit label, never the "3 × 1 cake" product label.
    assert payload["serving"] == "1 cake"


def test_remembering_is_idempotent_across_repeats():
    """
    Re-logging what was remembered must not drift. Without the divide, each
    round trip would multiply the stored value again.
    """
    first = _saved_food_payload(
        {"name": "Rice cake", "calories": 105, "protein": 6, "quantity": 3, "unit_amount": "1 cake"},
        NOW,
    )
    # The library entry is now logged again as a single serving.
    second = _saved_food_payload(
        {
            "name": "Rice cake",
            "calories": first["calories"],
            "protein": first["protein"],
            "quantity": 1,
            "unit_amount": first["serving"],
        },
        NOW,
    )
    assert second["calories"] == first["calories"]
    assert second["protein"] == first["protein"]


def test_single_unit_log_is_unchanged():
    """Rows without quantity are the pre-existing shape and must pass through."""
    payload = _saved_food_payload(
        {"name": "Greek yogurt", "calories": 150, "protein": 20, "amount": "1 cup"},
        NOW,
    )
    assert payload["calories"] == 150
    assert payload["protein"] == 20
    assert payload["serving"] == "1 cup"


def test_multi_unit_row_without_unit_label_gets_generic_serving():
    """`amount` reads "3 × ..." on a multi-unit row, so it is not a serving."""
    payload = _saved_food_payload(
        {"name": "Rice cake", "calories": 105, "protein": 6, "quantity": 3, "amount": "×3"},
        NOW,
    )
    assert payload["serving"] == "1 serving"
    assert payload["calories"] == 35


def test_unstorable_rows_are_skipped():
    assert _saved_food_payload({"name": "  ", "calories": 10, "protein": 1}, NOW) is None
    assert _saved_food_payload({"name": "Egg", "calories": "abc", "protein": 1}, NOW) is None


def test_quantity_is_never_zero_or_negative():
    """Guards the divide: a bad quantity must degrade to 1, not blow up."""
    for bad in (0, -3, None, "", "abc", [1]):
        assert _logged_food_quantity({"quantity": bad}) == 1.0
    assert _logged_food_quantity({"quantity": 4}) == 4.0
