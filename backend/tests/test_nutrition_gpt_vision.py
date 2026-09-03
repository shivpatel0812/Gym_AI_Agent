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
    assert "Do not infer oil merely because food is homemade" in prompt

