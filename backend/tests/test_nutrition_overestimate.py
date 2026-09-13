"""Tests for overestimation prevention in food nutrition estimates.

These tests pin the fixes for systematic calorie overestimation:
1. Bidirectional coherence check — lowers totals when components justify less
2. Cooking fat caps — limits oil based on portion size
3. Ledger completeness detection — only lowers when ledger is complete
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from nutrition.gpt_food_lookup import (
    assess_macro_coherence,
    finalize_estimated_macros,
    _ledger_looks_complete,
    _macro_complete,
    OVERESTIMATE_GAP_RATIO,
)
from nutrition.photo_estimate import (
    _reasonable_oil_cap,
    build_photo_analysis,
)


# --------------------------------------------------------------------------
# Bidirectional coherence check
# --------------------------------------------------------------------------


class TestBidirectionalCoherence:
    """The coherence check now lowers overestimates, not just raises underestimates."""

    def test_stated_much_higher_than_components_gets_lowered(self):
        """When the model states 1100 kcal but components sum to 650, use the lower."""
        parsed = {
            "calories": 1100,
            "protein": 30,
            "carbs": 70,
            "fats": 25,
            "components": [
                {"item": "rice", "calories": 300, "protein": 6, "carbs": 60, "fats": 2},
                {"item": "dal", "calories": 200, "protein": 12, "carbs": 25, "fats": 5},
                {"item": "sabzi", "calories": 150, "protein": 4, "carbs": 12, "fats": 8},
            ],
        }
        coherence = assess_macro_coherence(parsed)

        # Component sum is 650, stated is 1100. Gap is (1100-650)/650 = 69% > 25%
        assert coherence["component_sum"] == 650
        assert coherence["reported_calories"] == 1100
        # Should be lowered to component_sum * 1.10 = 715
        assert coherence["calories"] == 715
        assert coherence["lowered"] is True
        assert coherence["repaired"] is True

    def test_small_gap_is_not_lowered(self):
        """A 15% gap is within normal variation and shouldn't trigger lowering."""
        parsed = {
            "calories": 750,
            "protein": 25,
            "carbs": 80,
            "fats": 20,
            "components": [
                {"item": "rice", "calories": 350, "protein": 7, "carbs": 70, "fats": 2},
                {"item": "curry", "calories": 300, "protein": 18, "carbs": 10, "fats": 18},
            ],
        }
        coherence = assess_macro_coherence(parsed)

        # Component sum is 650, stated is 750. Gap is 15% < 25%
        assert coherence["component_sum"] == 650
        assert coherence["calories"] == 750  # Kept as-is
        assert coherence["lowered"] is False

    def test_incomplete_ledger_not_lowered(self):
        """When some components lack calories, don't lower — the sum is partial."""
        parsed = {
            "calories": 800,
            "protein": 25,
            "carbs": 70,
            "fats": 30,
            "components": [
                {"item": "rice", "calories": 300, "protein": 6, "carbs": 60, "fats": 2},
                {"item": "dal", "protein": 12, "carbs": 25},  # Missing calories!
                {"item": "sabzi", "calories": 100, "protein": 4, "carbs": 10, "fats": 5},
            ],
        }
        coherence = assess_macro_coherence(parsed)

        # Ledger is incomplete, so even though sum (400) << stated (800),
        # we shouldn't lower because some items aren't priced
        assert coherence["component_sum"] == 400
        assert coherence["calories"] == 800  # Kept as-is
        assert coherence["lowered"] is False
        assert coherence["ledger_complete"] is False

    def test_underestimate_still_raised(self):
        """The original behavior — raising when components > stated — still works."""
        parsed = {
            "calories": 400,
            "protein": 20,
            "carbs": 50,
            "fats": 15,
            "components": [
                {"item": "rice", "calories": 300, "protein": 6, "carbs": 60, "fats": 2},
                {"item": "dal", "calories": 250, "protein": 14, "carbs": 30, "fats": 5},
            ],
        }
        coherence = assess_macro_coherence(parsed)

        # Component sum is 550, stated is 400. Should be raised.
        assert coherence["component_sum"] == 550
        assert coherence["calories"] == 550
        assert coherence["lowered"] is False
        assert coherence["repaired"] is True

    def test_macro_bidirectional_correction(self):
        """Macros are also corrected bidirectionally when ALL components have that macro."""
        parsed = {
            "calories": 600,
            "protein": 40,  # Overstated
            "carbs": 70,
            "fats": 20,
            "components": [
                {"item": "rice", "calories": 300, "protein": 6, "carbs": 60, "fats": 2},
                {"item": "dal", "calories": 300, "protein": 14, "carbs": 30, "fats": 8},
            ],
        }
        coherence = assess_macro_coherence(parsed)

        # Stated protein 40, component sum 20. Gap is 100% > 20%
        # All components have protein, so bidirectional correction applies
        # Should use component value
        assert coherence["protein"] == 20.0
        assert coherence["repaired"] is True

    def test_partial_macro_ledger_not_lowered(self):
        """When only some components have a macro, don't lower to the partial sum."""
        parsed = {
            "calories": 800,
            "protein": 50,  # Whole-plate estimate
            "carbs": 90,
            "fats": 25,
            "components": [
                {"item": "rice", "calories": 300, "protein": 6, "carbs": 60, "fats": 2},
                {"item": "dal", "calories": 200, "protein": 12, "carbs": 30, "fats": 5},
                {"item": "sabzi", "calories": 150, "carbs": 12, "fats": 8},  # No protein!
                {"item": "roti", "calories": 150, "carbs": 26, "fats": 1},   # No protein!
            ],
        }
        coherence = assess_macro_coherence(parsed)

        # Component protein sum is only 18, but 2 of 4 items are missing protein.
        # Should NOT lower stated protein (50) to partial sum (18).
        assert coherence["protein"] == 50.0


class TestLedgerCompleteness:
    """The ledger must be complete before we trust it for lowering."""

    def test_complete_ledger(self):
        components = [
            {"item": "rice", "calories": 300},
            {"item": "dal", "calories": 200},
        ]
        assert _ledger_looks_complete(components) is True

    def test_incomplete_ledger_missing_calories(self):
        components = [
            {"item": "rice", "calories": 300},
            {"item": "dal", "protein": 12},  # No calories
        ]
        assert _ledger_looks_complete(components) is False

    def test_empty_ledger(self):
        assert _ledger_looks_complete([]) is False
        assert _ledger_looks_complete(None) is False

    def test_zero_calories_is_complete(self):
        """Zero is a stated value, not a missing one (e.g., water)."""
        components = [
            {"item": "rice", "calories": 300},
            {"item": "water", "calories": 0},
        ]
        assert _ledger_looks_complete(components) is True


class TestMacroCompleteness:
    """Per-macro completeness check for bidirectional macro correction."""

    def test_complete_protein_ledger(self):
        components = [
            {"item": "rice", "calories": 300, "protein": 6},
            {"item": "dal", "calories": 200, "protein": 12},
        ]
        assert _macro_complete(components, ("protein",)) is True

    def test_incomplete_protein_ledger(self):
        """Some items missing protein — don't lower protein to partial sum."""
        components = [
            {"item": "rice", "calories": 300, "protein": 6},
            {"item": "dal", "calories": 200, "protein": 12},
            {"item": "roti", "calories": 150},  # No protein!
        ]
        assert _macro_complete(components, ("protein",)) is False

    def test_fat_with_alternate_key(self):
        """Fats can be 'fats' or 'fat' — check both."""
        components = [
            {"item": "rice", "fats": 2},
            {"item": "dal", "fat": 5},  # Uses 'fat' not 'fats'
        ]
        assert _macro_complete(components, ("fats", "fat")) is True

    def test_empty_components(self):
        assert _macro_complete([], ("protein",)) is False
        assert _macro_complete(None, ("protein",)) is False


class TestFinalizeUsesCoherence:
    """finalize_estimated_macros applies the bidirectional correction."""

    def test_finalize_lowers_overestimate(self):
        parsed = {
            "calories": 1200,
            "protein": 30,
            "carbs": 100,
            "fats": 40,
            "components": [
                {"item": "meal", "calories": 700, "protein": 25, "carbs": 80, "fats": 25},
            ],
        }
        calories, protein, carbs, fats, fiber = finalize_estimated_macros(parsed)

        # 1200 stated, 700 component sum. Gap > 25%, should lower to 700 * 1.10 = 770
        assert calories == 770


# --------------------------------------------------------------------------
# Cooking fat caps
# --------------------------------------------------------------------------


class TestCookingFatCaps:
    """Cooking fat is capped based on portion size."""

    def test_small_portion_oil_cap(self):
        """A 100g snack shouldn't have more than ~15g oil."""
        assert _reasonable_oil_cap(100) == 15

    def test_regular_meal_oil_cap(self):
        """A 400g meal is capped at ~40g oil (~3 tbsp)."""
        assert _reasonable_oil_cap(400) == 40

    def test_large_meal_oil_cap(self):
        """A 600g meal is capped at ~55g oil."""
        assert _reasonable_oil_cap(600) == 55

    def test_oil_capped_in_analysis(self):
        """build_photo_analysis caps oil based on portion and records if capped."""
        parsed = {
            "image_quality": {"lighting": "good", "sharpness": "sharp", "full_meal_visible": True},
            "identity_confidence": "high",
            "portion": {"estimated_grams": 200, "low_grams": 180, "high_grams": 220},
            "scale_references": [],
            "cooking_fat": {"estimated_grams": 50, "basis": "typical_recipe"},  # Too high!
            "components": [{"item": "dal", "estimated_grams": 200, "calories": 200}],
        }
        analysis = build_photo_analysis(parsed)

        # 200g portion caps oil at 25g, but model claimed 50g
        assert analysis["cooking"]["oil_grams"] == 25.0
        assert analysis["cooking"]["oil_capped_from"] == 50.0

    def test_reasonable_oil_not_capped(self):
        """When oil is reasonable for portion size, it's not capped."""
        parsed = {
            "image_quality": {"lighting": "good", "sharpness": "sharp", "full_meal_visible": True},
            "identity_confidence": "high",
            "portion": {"estimated_grams": 400, "low_grams": 350, "high_grams": 450},
            "scale_references": [],
            "cooking_fat": {"estimated_grams": 20, "basis": "typical_recipe"},  # Reasonable
            "components": [{"item": "curry", "estimated_grams": 400, "calories": 500}],
        }
        analysis = build_photo_analysis(parsed)

        # 400g portion caps at 40g, claimed 20g — no capping needed
        assert analysis["cooking"]["oil_grams"] == 20.0
        assert analysis["cooking"]["oil_capped_from"] is None


# --------------------------------------------------------------------------
# Integration scenarios
# --------------------------------------------------------------------------


class TestOverestimationScenarios:
    """End-to-end scenarios that previously produced overestimates."""

    def test_inflated_total_with_reasonable_components(self):
        """Model states high total but components tell the real story."""
        parsed = {
            "calories": 950,  # Way too high
            "protein": 25,
            "carbs": 90,
            "fats": 35,
            "fiber": 8,
            "components": [
                {"item": "2 chapatis", "calories": 260, "protein": 8, "carbs": 52, "fats": 2, "fiber": 3},
                {"item": "paneer sabzi", "calories": 280, "protein": 14, "carbs": 8, "fats": 22, "fiber": 2},
                {"item": "dal", "calories": 120, "protein": 8, "carbs": 15, "fats": 3, "fiber": 4},
            ],
        }
        coherence = assess_macro_coherence(parsed)
        calories, protein, carbs, fats, fiber = finalize_estimated_macros(parsed)

        # Components sum to 660. Stated 950 is 44% higher — should be lowered.
        assert coherence["component_sum"] == 660
        # Ceiling is 660 * 1.10 = 726
        assert calories == 726
        assert coherence["lowered"] is True

    def test_restaurant_style_oil_assumption_capped(self):
        """Model assumes restaurant-style oil but this is home cooking."""
        parsed = {
            "image_quality": {"lighting": "good", "sharpness": "sharp", "full_meal_visible": True},
            "identity_confidence": "high",
            "portion": {"estimated_grams": 150, "low_grams": 130, "high_grams": 170},
            "scale_references": [{"type": "katori", "reliability": "medium"}],
            "cooking_fat": {
                "estimated_grams": 40,  # Restaurant assumption: ~3 tbsp
                "basis": "typical_recipe",
            },
            "components": [
                {"item": "dal tadka", "estimated_grams": 150, "calories": 180},
            ],
        }
        analysis = build_photo_analysis(parsed, cooking_style="light")

        # 150g portion caps oil at 15g for small portion
        # But wait, 150g is between 100 and 200, so cap is 15 (at 100 threshold)
        # Actually looking at the thresholds: 100->15, 200->25
        # 150g > 100, so it falls into next bracket: 200 -> 25g max
        assert analysis["cooking"]["oil_grams"] == 25.0  # Capped from 40 to 25
        assert analysis["cooking"]["oil_capped_from"] == 40.0
