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
    """Cooking fat is capped based on portion size and meal context."""

    def test_small_portion_home_oil_cap(self):
        """A 100g home snack shouldn't have more than ~10g oil."""
        assert _reasonable_oil_cap(100, "home") == 10

    def test_small_portion_restaurant_oil_cap(self):
        """A 100g restaurant snack can have up to ~20g oil."""
        assert _reasonable_oil_cap(100, "restaurant_or_takeout") == 20

    def test_regular_meal_home_oil_cap(self):
        """A 400g home meal is capped at ~30g oil (~2 tbsp)."""
        assert _reasonable_oil_cap(400, "home") == 30

    def test_regular_meal_restaurant_oil_cap(self):
        """A 400g restaurant meal can have up to ~55g oil (~4 tbsp)."""
        assert _reasonable_oil_cap(400, "restaurant_or_takeout") == 55

    def test_large_meal_home_oil_cap(self):
        """A 600g home meal is capped at ~40g oil."""
        assert _reasonable_oil_cap(600, "home") == 40

    def test_large_meal_restaurant_oil_cap(self):
        """A 600g restaurant meal can have up to ~70g oil."""
        assert _reasonable_oil_cap(600, "restaurant_or_takeout") == 70

    def test_default_context_is_home(self):
        """Without context specified, default to home (conservative)."""
        assert _reasonable_oil_cap(400) == 30  # Same as home

    def test_oil_capped_in_analysis_home_context(self):
        """build_photo_analysis caps oil based on portion and home context."""
        parsed = {
            "image_quality": {"lighting": "good", "sharpness": "sharp", "full_meal_visible": True},
            "identity_confidence": "high",
            "portion": {"estimated_grams": 200, "low_grams": 180, "high_grams": 220},
            "scale_references": [],
            "cooking_fat": {"estimated_grams": 50, "basis": "typical_recipe"},  # Too high!
            "components": [{"item": "dal", "estimated_grams": 200, "calories": 200}],
            "meal_context": {"setting": "home", "confidence": "high", "cues": ["glass plate"]},
        }
        analysis = build_photo_analysis(parsed)

        # 200g home portion caps oil at 18g, but model claimed 50g
        assert analysis["cooking"]["oil_grams"] == 18.0
        assert analysis["cooking"]["oil_capped_from"] == 50.0
        assert analysis["cooking"]["context_used"] == "home"

    def test_oil_cap_higher_for_restaurant(self):
        """Restaurant context allows more oil."""
        parsed = {
            "image_quality": {"lighting": "good", "sharpness": "sharp", "full_meal_visible": True},
            "identity_confidence": "high",
            "portion": {"estimated_grams": 200, "low_grams": 180, "high_grams": 220},
            "scale_references": [],
            "cooking_fat": {"estimated_grams": 30, "basis": "typical_recipe"},
            "components": [{"item": "dal", "estimated_grams": 200, "calories": 300}],
            "meal_context": {"setting": "restaurant_or_takeout", "confidence": "high", "cues": ["takeout box"]},
        }
        analysis = build_photo_analysis(parsed)

        # 200g restaurant portion caps at 35g, claimed 30g — not capped
        assert analysis["cooking"]["oil_grams"] == 30.0
        assert analysis["cooking"]["oil_capped_from"] is None
        assert analysis["cooking"]["context_used"] == "restaurant_or_takeout"

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

        # 400g home portion caps at 30g, claimed 20g — no capping needed
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

    def test_restaurant_style_oil_assumption_capped_for_home(self):
        """Model assumes restaurant-style oil but photo shows home cooking."""
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
            # Model inferred home from the glass katori
            "meal_context": {"setting": "home", "confidence": "high", "cues": ["katori on dining table"]},
        }
        analysis = build_photo_analysis(parsed, cooking_style="light")

        # 150g home portion: 100->10, 200->18, so 150g gets 10 (threshold is <=100)
        # Actually 150 > 100 so it uses 200 bracket: 18g max for home
        assert analysis["cooking"]["oil_grams"] == 18.0  # Capped from 40 to 18
        assert analysis["cooking"]["oil_capped_from"] == 40.0
        assert analysis["cooking"]["context_used"] == "home"


# --------------------------------------------------------------------------
# Meal context inference
# --------------------------------------------------------------------------


class TestMealContextInference:
    """Meal context (home vs restaurant) is inferred from visual and text cues."""

    def test_home_context_from_photo_cues(self):
        """Glass plate on dining table should infer home context."""
        from nutrition.photo_estimate import normalize_meal_context

        parsed = {
            "meal_context": {
                "setting": "home",
                "confidence": "high",
                "cues": ["glass plate on dining table", "simple plating"],
            }
        }
        context = normalize_meal_context(parsed)

        assert context["setting"] == "home"
        assert context["confidence"] == "high"
        assert "glass plate" in context["cues"][0]
        assert context["source"] == "photo_inference"

    def test_restaurant_context_from_takeout_box(self):
        """Takeout container should infer restaurant context."""
        from nutrition.photo_estimate import normalize_meal_context

        parsed = {
            "meal_context": {
                "setting": "restaurant_or_takeout",
                "confidence": "high",
                "cues": ["foil takeout container", "plastic lid visible"],
            }
        }
        context = normalize_meal_context(parsed)

        assert context["setting"] == "restaurant_or_takeout"
        assert context["confidence"] == "high"
        assert context["source"] == "photo_inference"

    def test_user_override_takes_precedence(self):
        """User saying 'homemade' overrides photo inference."""
        from nutrition.photo_estimate import normalize_meal_context

        parsed = {
            "meal_context": {
                "setting": "restaurant_or_takeout",  # Model guessed wrong
                "confidence": "medium",
                "cues": ["professional plating"],
            }
        }
        context = normalize_meal_context(parsed, user_override="home")

        assert context["setting"] == "home"
        assert context["confidence"] == "high"
        assert context["source"] == "user_override"

    def test_text_detection_homemade(self):
        """Text description mentioning 'homemade' triggers home context."""
        from nutrition.text_estimate import detect_meal_context_from_text

        context = detect_meal_context_from_text("2 rotis with dal, homemade")

        assert context["setting"] == "home"
        assert context["confidence"] == "high"
        assert "homemade" in context["cues"]
        assert context["source"] == "text_detection"

    def test_text_detection_restaurant_chain(self):
        """Text description mentioning Chipotle triggers restaurant context."""
        from nutrition.text_estimate import detect_meal_context_from_text

        context = detect_meal_context_from_text("chipotle burrito bowl with chicken")

        assert context["setting"] == "restaurant_or_takeout"
        assert context["confidence"] == "high"
        assert "chipotle" in context["cues"][0]
        assert context["source"] == "text_detection"

    def test_text_detection_takeout(self):
        """Text description mentioning 'takeout' triggers restaurant context."""
        from nutrition.text_estimate import detect_meal_context_from_text

        context = detect_meal_context_from_text("indian takeout, butter chicken and naan")

        assert context["setting"] == "restaurant_or_takeout"
        assert context["confidence"] == "high"
        assert "takeout" in context["cues"]
        assert context["source"] == "text_detection"

    def test_text_detection_no_markers(self):
        """Text without context markers returns uncertain."""
        from nutrition.text_estimate import detect_meal_context_from_text

        context = detect_meal_context_from_text("2 rotis with dal")

        assert context["setting"] == "uncertain"
        assert context["confidence"] == "low"
        assert context["source"] == "default"

    def test_uncertain_context_defaults_to_home_caps(self):
        """Uncertain context uses home oil caps (conservative)."""
        parsed = {
            "image_quality": {"lighting": "good", "sharpness": "sharp", "full_meal_visible": True},
            "identity_confidence": "high",
            "portion": {"estimated_grams": 300, "low_grams": 250, "high_grams": 350},
            "scale_references": [],
            "cooking_fat": {"estimated_grams": 50, "basis": "typical_recipe"},
            "components": [{"item": "curry", "estimated_grams": 300, "calories": 350}],
            # No meal_context or uncertain
        }
        analysis = build_photo_analysis(parsed)

        # Uncertain defaults to home. 300g > 200 so uses 400 bracket: 30g cap for home
        assert analysis["cooking"]["context_used"] == "home"
        assert analysis["cooking"]["oil_grams"] == 30.0  # Capped from 50 to 30
        assert analysis["cooking"]["oil_capped_from"] == 50.0

    def test_meal_context_in_analysis_output(self):
        """build_photo_analysis includes meal_context in output."""
        parsed = {
            "image_quality": {"lighting": "good", "sharpness": "sharp", "full_meal_visible": True},
            "identity_confidence": "high",
            "portion": {"estimated_grams": 300},
            "scale_references": [],
            "cooking_fat": {"estimated_grams": 15},
            "components": [{"item": "rice", "calories": 300}],
            "meal_context": {
                "setting": "home",
                "confidence": "high",
                "cues": ["ceramic plate", "dining table"],
            },
        }
        analysis = build_photo_analysis(parsed)

        assert "meal_context" in analysis
        assert analysis["meal_context"]["setting"] == "home"
        assert analysis["meal_context"]["source"] == "photo_inference"
