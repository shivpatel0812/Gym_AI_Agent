import json

from nutrition import gpt_vision


class _Message:
    def __init__(self, content):
        self.content = content


class _Choice:
    def __init__(self, content):
        self.message = _Message(content)


class _Response:
    def __init__(self, payload):
        self.choices = [_Choice(json.dumps(payload))]


class _Completions:
    def __init__(self, payload):
        self.payload = payload
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return _Response(self.payload)


class _Chat:
    def __init__(self, payload):
        self.completions = _Completions(payload)


class _Client:
    def __init__(self, payload):
        self.chat = _Chat(payload)


def test_vision_uses_high_detail_and_passes_user_calibration(monkeypatch, tmp_path):
    payload = {
        "name": "Vegetable bowl",
        "amount": "1 bowl",
        "portion": {"estimated_grams": 350, "low_grams": 280, "high_grams": 430},
        "image_quality": {
            "lighting": "good",
            "sharpness": "sharp",
            "full_meal_visible": True,
            "view_angle": "angled",
        },
        "scale_references": [{"type": "bowl", "reliability": "medium"}],
        "identity_confidence": "high",
        "cooking_fat": {
            "estimated_grams": 5,
            "basis": "user_preference",
            "visible_evidence": "none",
        },
        "components": [
            {
                "item": "vegetables and rice",
                "estimated_grams": 350,
                "calories": 420,
                "protein": 15,
                "carbs": 70,
                "fats": 9,
                "fiber": 8,
            }
        ],
        "calories": 420,
        "protein": 15,
        "carbs": 70,
        "fats": 9,
        "fiber": 8,
        "assumptions": ["light cooking oil"],
        "uncertainties": [],
    }
    client = _Client(payload)
    monkeypatch.setattr(gpt_vision, "get_openai_client", lambda: client)
    image_path = tmp_path / "meal.jpg"
    image_path.write_bytes(b"test-image")

    result = gpt_vision.gpt_vision_estimate(
        str(image_path),
        "homemade with little oil",
        model="gpt-4o",
        title="My veggie bowl",
        cooking_style="light",
        prior_foods=[
            {
                "name": "My veggie bowl",
                "serving": "1 bowl",
                "grams": 340,
                "calories": 400,
                "protein": 14,
                "carbs": 68,
                "fats": 8,
            }
        ],
    )

    assert result["name"] == "My veggie bowl"
    assert result["analysis"]["matched_saved_food"] is True
    request = client.chat.completions.kwargs
    image_part = request["messages"][0]["content"][1]
    prompt = request["messages"][0]["content"][0]["text"]
    assert image_part["image_url"]["detail"] == "high"
    assert "My veggie bowl" in prompt
    assert "Usual cooking-oil style: light" in prompt
    assert "Do not intentionally bias high or low" in prompt
    assert result["analysis"]["components"]


def test_default_prompt_supplies_anchors_instead_of_prohibitions(monkeypatch, tmp_path):
    """v1 told the model what not to assume and gave it nothing to assume
    instead, which is how five compartments each land low at once.

    v3 is the default now and is built by extending v2, so every anchor below
    must still be in the prompt — this is what catches v3 dropping one.
    """
    client = _Client({"name": "Thali", "calories": 650, "protein": 22, "carbs": 100, "fats": 17})
    monkeypatch.setattr(gpt_vision, "get_openai_client", lambda: client)
    image_path = tmp_path / "meal.jpg"
    image_path.write_bytes(b"test-image")

    result = gpt_vision.gpt_vision_estimate(str(image_path), model="gpt-4o")
    prompt = client.chat.completions.kwargs["messages"][0]["content"][0]["text"]

    assert result["prompt_variant"] == "v3"
    # v3's own addition: enumerate the frame before costing anything.
    assert "inventory the frame" in prompt
    assert '"items_seen"' in prompt
    # A default anchor plus a wider range, rather than a smaller central guess.
    assert "dinner plate ~26cm" in prompt
    assert "Uncertainty belongs in the range" in prompt
    # Dish-defining fat is recipe knowledge, not a homemade stereotype.
    assert "carries its tadka" in prompt
    assert "never reduces it to zero" in prompt
    # The whole-plate check that keeps per-item shortfalls from compounding.
    assert "those shortfalls add up" in prompt
    # v1 forced the total to match the component sum, which hides the
    # disagreement `assess_macro_coherence` reads as an escalation signal.
    assert "should match the component calorie sum" not in prompt


def test_old_prompt_stays_selectable_for_comparison(monkeypatch, tmp_path):
    client = _Client({"name": "Thali", "calories": 440, "protein": 16, "carbs": 73, "fats": 10})
    monkeypatch.setattr(gpt_vision, "get_openai_client", lambda: client)
    image_path = tmp_path / "meal.jpg"
    image_path.write_bytes(b"test-image")

    result = gpt_vision.gpt_vision_estimate(str(image_path), model="gpt-4o", prompt_variant="v1")
    prompt = client.chat.completions.kwargs["messages"][0]["content"][0]["text"]

    assert result["prompt_variant"] == "v1"
    assert "Do not infer oil merely because food is homemade" in prompt
    assert "dinner plate ~26cm" not in prompt
    # Asking v1 for an inventory would make it v3 and leave nothing to compare.
    assert "items_seen" not in prompt


def test_unknown_variant_falls_back_to_the_default(monkeypatch, tmp_path):
    client = _Client({"name": "Thali", "calories": 650, "protein": 22, "carbs": 100, "fats": 17})
    monkeypatch.setattr(gpt_vision, "get_openai_client", lambda: client)
    image_path = tmp_path / "meal.jpg"
    image_path.write_bytes(b"test-image")

    result = gpt_vision.gpt_vision_estimate(str(image_path), model="gpt-4o", prompt_variant="v99")
    assert result["prompt_variant"] == "v3"



def test_reasoning_model_gets_headroom_for_thinking(monkeypatch, tmp_path):
    """A truncated JSON response parses as None and silently demotes the
    estimate to the description-only fallback, so the reasoning pass needs its
    own budget on top of the payload."""
    client = _Client({"name": "Thali", "calories": 650, "protein": 22, "carbs": 100, "fats": 17})
    monkeypatch.setattr(gpt_vision, "get_openai_client", lambda: client)
    image_path = tmp_path / "meal.jpg"
    image_path.write_bytes(b"test-image")

    gpt_vision.gpt_vision_estimate(str(image_path), model="gpt-5.6-sol")
    kwargs = client.chat.completions.kwargs

    assert kwargs["max_completion_tokens"] == 4000
    assert "max_tokens" not in kwargs
    # GPT-5 rejects a custom temperature on this endpoint.
    assert "temperature" not in kwargs


def test_non_reasoning_model_has_room_for_full_nutrient_ledger(monkeypatch, tmp_path):
    client = _Client({"name": "Thali", "calories": 650, "protein": 22, "carbs": 100, "fats": 17})
    monkeypatch.setattr(gpt_vision, "get_openai_client", lambda: client)
    image_path = tmp_path / "meal.jpg"
    image_path.write_bytes(b"test-image")

    gpt_vision.gpt_vision_estimate(str(image_path), model="gpt-4o")
    kwargs = client.chat.completions.kwargs

    assert kwargs["max_tokens"] == 1800
    assert "max_completion_tokens" not in kwargs
