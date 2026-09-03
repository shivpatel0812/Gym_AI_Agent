import asyncio
import io
import os

from fastapi import HTTPException, UploadFile
from PIL import Image
from starlette.datastructures import Headers

from nutrition.gpt_food_lookup import finalize_estimated_macros
from nutrition.photo_estimate import build_photo_analysis, normalize_cooking_style
from routers.macros import (
    MAX_FOOD_IMAGE_EDGE,
    _rank_photo_food_priors,
    _saved_food_payload,
    _save_normalized_food_image,
)


def _clear_photo_payload(**overrides):
    payload = {
        "image_quality": {
            "lighting": "good",
            "sharpness": "sharp",
            "full_meal_visible": True,
            "view_angle": "angled",
        },
        "identity_confidence": "high",
        "portion": {
            "estimated_grams": 300,
            "low_grams": 260,
            "high_grams": 340,
        },
        "scale_references": [{"type": "known_package", "reliability": "strong"}],
        "cooking_fat": {
            "estimated_grams": 0,
            "basis": "none",
            "visible_evidence": "none",
        },
        "components": [{"item": "rice", "estimated_grams": 300, "calories": 390}],
    }
    payload.update(overrides)
    return payload


def test_macro_finalization_no_longer_invents_fat_or_category_floors():
    calories, protein, carbs, fats, fiber = finalize_estimated_macros(
        {
            "calories": 100,
            "protein": 5,
            "carbs": 10,
            "fats": 4,
            "fiber": 2,
        },
        query="3 samosas",
    )

    assert calories == 100
    assert protein == 5
    assert carbs == 10
    assert fats == 4
    assert fiber == 2

    # A calorie/macro mismatch is no longer silently routed into extra oil.
    calories, _, _, fats, _ = finalize_estimated_macros(
        {"calories": 500, "protein": 20, "carbs": 40, "fats": 10}
    )
    assert calories == 500
    assert fats == 10


def test_confidence_is_high_with_observable_portion_evidence():
    analysis = build_photo_analysis(
        _clear_photo_payload(),
        has_user_hint=True,
        cooking_style="light",
    )

    assert analysis["confidence"]["level"] == "high"
    assert analysis["confidence"]["should_nudge"] is False
    assert analysis["cooking"]["style"] == "light"
    assert analysis["portion"]["estimated_grams"] == 300


def test_model_cannot_claim_high_portion_confidence_without_scale_or_history():
    payload = _clear_photo_payload(scale_references=[])
    analysis = build_photo_analysis(payload, has_user_hint=True)

    assert analysis["confidence"]["score"] <= 74
    assert analysis["confidence"]["level"] == "medium"
    assert "No reliable size reference was found" in analysis["confidence"]["reasons"]


def test_missing_portion_or_incomplete_plate_forces_low_confidence_nudge():
    payload = _clear_photo_payload(
        portion={},
        image_quality={
            "lighting": "poor",
            "sharpness": "blurry",
            "full_meal_visible": False,
            "view_angle": "unknown",
        },
    )
    analysis = build_photo_analysis(payload)

    assert analysis["confidence"]["level"] == "low"
    assert analysis["confidence"]["should_nudge"] is True
    assert analysis["portion"]["estimated_grams"] == 0


def test_cooking_style_is_allowlisted():
    assert normalize_cooking_style("LIGHT") == "light"
    assert normalize_cooking_style("generous") == "generous"
    assert normalize_cooking_style("lots and lots") == "normal"


def test_photo_priors_require_relevance_and_repeated_explicit_corrections():
    foods = [
        {
            "name": "Veggie bowl",
            "serving": "1 bowl",
            "aliases": ["rice vegetables"],
            "last_used_at": "2026-09-01",
            "photo_only": True,
            "photo_calibrated": False,
        },
        {
            "name": "Veggie bowl calibrated",
            "serving": "1 bowl",
            "aliases": ["rice vegetables"],
            "last_used_at": "2026-09-02",
            "photo_only": True,
            "photo_calibrated": True,
        },
        {
            "name": "Protein shake",
            "serving": "1 glass",
            "aliases": [],
            "last_used_at": "2026-09-02",
        },
    ]

    priors = _rank_photo_food_priors(foods, "Veggie bowl", "homemade with rice")
    assert [food["name"] for food in priors] == ["Veggie bowl calibrated"]


def test_generic_food_memory_does_not_race_photo_calibration():
    assert _saved_food_payload(
        {
            "name": "Veggie bowl",
            "calories": 500,
            "protein": 20,
            "log_source": "photo",
            "was_adjusted": False,
        },
        "2026-09-02T12:00:00",
    ) is None


def test_uploaded_food_image_is_oriented_resized_and_reencoded_as_jpeg():
    source = Image.new("RGBA", (2400, 1800), (255, 0, 0, 128))
    buffer = io.BytesIO()
    source.save(buffer, format="PNG")
    upload = UploadFile(
        file=io.BytesIO(buffer.getvalue()),
        filename="meal.png",
        headers=Headers({"content-type": "image/png"}),
    )

    path = asyncio.run(_save_normalized_food_image(upload))
    try:
        with Image.open(path) as normalized:
            assert normalized.format == "JPEG"
            assert normalized.mode == "RGB"
            assert max(normalized.size) == MAX_FOOD_IMAGE_EDGE
    finally:
        os.unlink(path)


def test_invalid_upload_is_rejected_before_model_call():
    upload = UploadFile(
        file=io.BytesIO(b"not an image"),
        filename="meal.jpg",
        headers=Headers({"content-type": "image/jpeg"}),
    )

    try:
        asyncio.run(_save_normalized_food_image(upload))
        assert False, "invalid image should fail"
    except HTTPException as exc:
        assert exc.status_code == 400
