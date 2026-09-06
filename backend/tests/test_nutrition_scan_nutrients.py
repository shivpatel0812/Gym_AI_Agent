"""Regression coverage for scan units, unknown values, storage and concurrency."""
import asyncio
import json
import math
import threading

import pytest
from pydantic import ValidationError

from models import FoodItem, SavedFood, SavedFoodUpdate, AcceptedEstimateRequest
from nutrition.nutrients import optional_nutrients
from nutrition.gpt_food_lookup import finalize_estimated_macros
from nutrition.photo_estimate import normalize_components
from nutrition.adjust_estimate import _extract_revised_estimate
from nutrition import analyzer, gpt_vision
from routers import macros
from test_nutrition_gpt_vision import _Client


def test_unknown_is_not_zero_and_units_are_preserved():
    assert optional_nutrients({}) == {"sugar": None, "sodium": None}
    assert optional_nutrients({"sugar": 0, "sodium": "420"}) == {"sugar": 0, "sodium": 420}
    for invalid in (None, "", True, -1, "bad", math.inf, math.nan):
        assert optional_nutrients({"sodium": invalid})["sodium"] is None


def test_only_complete_component_ledgers_can_supply_missing_totals():
    rows = [{"sugar": 2, "sodium": 100}, {"sugar": 3, "sodium": 250}]
    assert optional_nutrients({"components": rows}) == {"sugar": 5, "sodium": 350}
    rows[1]["sodium"] = None
    assert optional_nutrients({"components": rows})["sodium"] is None
    assert optional_nutrients({"sodium": 400, "components": rows})["sodium"] == 400


def test_scan_and_revision_carry_nutrients_without_counting_sugar_as_extra_calories(monkeypatch, tmp_path):
    payload = {"name": "Yogurt", "calories": 150, "protein": 10, "carbs": 20,
               "fats": 3, "sugar": 12.5, "sodium": 85}
    client = _Client(payload)
    monkeypatch.setattr(gpt_vision, "get_openai_client", lambda: client)
    path = tmp_path / 'meal.jpg'
    path.write_bytes(b'fixture')
    result = gpt_vision.gpt_vision_estimate(str(path), model='gpt-4o')
    assert (result['sugar'], result['sodium'], result['calories']) == (12.5, 85, 150)
    monkeypatch.setattr(analyzer, 'gpt_vision_estimate', lambda *a, **k: result)
    response = analyzer.analyze_food_image(str(path), allow_escalation=False)
    assert response['food']['sodium'] == 85
    revised = _extract_revised_estimate(json.dumps({**payload, 'sugar': 8, 'sodium': 60}), payload)
    assert (revised['sugar'], revised['sodium']) == (8, 60)
    # A changed meal with missing nutrients must not inherit stale old values.
    revised = _extract_revised_estimate('{"calories": 200, "protein": 15}', payload)
    assert revised['sugar'] is None and revised['sodium'] is None
    prompt = client.chat.completions.kwargs['messages'][0]['content'][0]['text']
    assert 'per serving, per 100g, or per package' in prompt
    assert 'milligrams' in prompt and 'percent daily value' in prompt


def test_nutrients_survive_all_storage_models_and_per_serving_conversion():
    values = dict(name='Yogurt', serving='1 cup', grams=150, calories=150, protein=10, sugar=12, sodium=90)
    for model in (FoodItem, SavedFood, SavedFoodUpdate, AcceptedEstimateRequest):
        data = model(**values).model_dump()
        assert data['sugar'] == 12 and data['sodium'] == 90
        with pytest.raises(ValidationError):
            model(**{**values, 'sodium': float('inf')})
    saved = macros._saved_food_payload({**values, 'quantity': 3}, 'now')
    assert saved['sugar'] == 4 and saved['sodium'] == 30
    old = macros._saved_food_payload(dict(name='old food', calories=100, protein=5), 'now')
    assert 'sugar' not in old and 'sodium' not in old


def test_nonfinite_macros_do_not_break_normalization():
    assert finalize_estimated_macros({'calories': float('inf'), 'protein': float('nan')})[:2] == (0, 0)
    assert normalize_components([{'item': 'rice', 'calories': float('nan')}])[0]['calories'] == 0


def test_photo_without_context_skips_saved_food_read(monkeypatch):
    def fail(*args):
        raise AssertionError('Unnecessary database read')
    monkeypatch.setattr(macros, '_foods_ref', fail)
    assert macros._photo_food_priors('user', None, '  ') == []


@pytest.mark.parametrize("archive_fails", [False, True])
def test_scan_work_overlaps_archive_and_keeps_event_loop_free(monkeypatch, tmp_path, archive_fails):
    path = tmp_path / 'meal.jpg'
    path.write_bytes(b'fixture')
    loop_thread = threading.get_ident()
    archive_started = threading.Event()
    model_started = threading.Event()
    archive = {'image_base64': 'fixture'}

    async def normalize(file):
        return str(path)

    def estimate(*args, **kwargs):
        assert threading.get_ident() != loop_thread
        model_started.set()
        assert archive_started.wait(3), 'Archive did not run alongside the model'
        return {'food': {'name': 'Yogurt', 'sugar': 12, 'sodium': 90}}

    def compress(image_path):
        archive_started.set()
        assert model_started.wait(3), 'Model did not run alongside archive compression'
        if archive_fails:
            raise RuntimeError('Archive unavailable')
        return archive

    def save(*args, **kwargs):
        assert threading.get_ident() != loop_thread
        assert kwargs['archive'] is (None if archive_fails else archive)
        assert path.exists(), 'Photo removed before processing finished'
        assert kwargs['estimate']['sodium'] == 90
        return 'photo-log'

    monkeypatch.setattr(macros, '_save_normalized_food_image', normalize)
    monkeypatch.setattr(macros, '_photo_food_priors', lambda *a: [])
    monkeypatch.setattr(macros, 'analyze_food_image', estimate)
    monkeypatch.setattr(macros, 'compress_image_for_archive', compress)
    monkeypatch.setattr(macros, 'create_photo_log', save)
    result = asyncio.run(macros.analyze_food_image_endpoint(
        file=None, description=None, title=None, cooking_style=None,
        model=None, prompt_variant=None, user_id='test'))
    assert result['photo_log_id'] == 'photo-log'
    assert result['timings_ms']['total'] >= 0
    assert not path.exists()
