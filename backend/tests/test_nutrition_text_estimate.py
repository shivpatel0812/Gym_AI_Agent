"""The typed-description path: what the user said, and whether it was heard.

The complaint these pin: "I said I think it's about 600 calories, and it came
back 1100." Two separate failures produced that, and both are covered here —
the prompt read a whole-meal figure as if it priced one part and stacked the
rest on top of it, and nothing downstream ever compared the answer against the
figure the user had given.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from nutrition import gpt_food_lookup
from nutrition.gpt_food_lookup import _build_prompt, estimate_food_from_query
from nutrition.text_estimate import (
    build_text_analysis,
    check_hint,
    describe_evidence,
    parse_calorie_hint,
    should_escalate_text,
)


# --------------------------------------------------------------------------
# Reading the user's own figure
# --------------------------------------------------------------------------


class TestScopingACalorieFigure:
    def test_a_bare_figure_prices_the_whole_meal(self):
        hint = parse_calorie_hint("3 frankie wraps, i think that was about 600 calories")
        assert hint["stated_calories"] == 600
        assert hint["scope"] == "whole"

    def test_felt_like_is_still_the_whole_meal(self):
        assert parse_calorie_hint("chole bhature, felt like 900 cal")["scope"] == "whole"

    def test_each_prices_one_part(self):
        hint = parse_calorie_hint("3 wraps, the tortilla was like 150 cal each")
        assert hint["stated_calories"] == 150
        assert hint["scope"] == "part"

    def test_a_part_marker_elsewhere_does_not_capture_the_figure(self):
        # "total" belongs to a different clause than the number; reading the
        # whole sentence for markers gets this backwards.
        hint = parse_calorie_hint("6 rotis in total, each one about 120 calories")
        assert hint["scope"] == "part"

    def test_no_figure_is_no_hint(self):
        assert parse_calorie_hint("two rotis and dal") is None
        assert parse_calorie_hint("") is None

    def test_a_calorie_figure_is_not_evidence_of_a_portion(self):
        # "600 calories" contains a digit. Counting it as "they said how much"
        # would score an unquantified description as a quantified one.
        query = "some paneer sabzi, maybe 600 calories"
        evidence = describe_evidence(query, parse_calorie_hint(query))
        assert evidence["quantified"] is False


class TestComparingAgainstTheUsersFigure:
    def test_a_large_gap_on_a_whole_meal_figure_is_flagged(self):
        check = check_hint({"stated_calories": 600, "scope": "whole"}, 1100)
        assert check["disagrees"] is True
        assert check["direction"] == "higher"

    def test_ordinary_self_report_bias_is_not_flagged(self):
        # People undercount. 600 answered with 700 is the tool doing its job,
        # not a disagreement worth interrupting anyone over.
        assert check_hint({"stated_calories": 600, "scope": "whole"}, 700)["disagrees"] is False

    def test_a_part_figure_is_never_compared_against_the_total(self):
        # A per-component figure SHOULD come out far below the meal total —
        # comparing them would fire on every correctly handled part hint.
        assert check_hint({"stated_calories": 150, "scope": "part"}, 1100) is None

    def test_no_figure_means_nothing_to_check(self):
        assert check_hint(None, 1100) is None


class TestThePromptStatesTheScope:
    def test_a_whole_meal_figure_is_named_as_covering_everything(self):
        prompt = _build_prompt(
            "3 frankie wraps, about 600 calories",
            None,
            parse_calorie_hint("3 frankie wraps, about 600 calories"),
        )
        assert "WHOLE meal" in prompt
        assert "600 kcal" in prompt
        assert "Do not add components on top of it" in prompt

    def test_a_part_figure_is_named_as_covering_one_part(self):
        query = "3 wraps, tortilla was 150 cal each"
        prompt = _build_prompt(query, None, parse_calorie_hint(query))
        assert "ONE PART" in prompt

    def test_the_rules_forbid_double_listing_a_dish_and_its_parts(self):
        # The reconciler only ever raises, so a dish listed twice — once whole,
        # once as its components — ratchets straight into the total.
        assert "Never list the same food twice" in gpt_food_lookup.ESTIMATE_RULES


# --------------------------------------------------------------------------
# Confidence, on what a sentence actually pins down
# --------------------------------------------------------------------------


class TestTextConfidence:
    def test_an_unquantified_description_can_never_score_high(self):
        analysis = build_text_analysis(
            {"identity_confidence": "high", "grams": 300},
            query="some rice",
        )
        assert analysis["confidence"]["level"] != "high"
        assert any("how much" in reason for reason in analysis["confidence"]["reasons"])

    def test_a_quantified_prepared_description_scores_better(self):
        vague = build_text_analysis(
            {"identity_confidence": "high", "grams": 300}, query="some rice"
        )
        precise = build_text_analysis(
            {"identity_confidence": "high", "grams": 300},
            query="180 g basmati rice, boiled, no butter",
        )
        assert precise["confidence"]["score"] > vague["confidence"]["score"]

    def test_a_disagreement_with_the_user_is_a_stated_reason(self):
        analysis = build_text_analysis(
            {"identity_confidence": "high", "grams": 400},
            query="2 parathas, about 600 calories",
            hint_check={
                "stated_calories": 600,
                "estimated_calories": 1100,
                "difference_ratio": 0.833,
                "direction": "higher",
                "disagrees": True,
            },
        )
        assert any("600 kcal you guessed" in r for r in analysis["confidence"]["reasons"])

    def test_the_shape_matches_the_photo_path(self):
        # The scan results card renders one shape. A missing key here is a
        # crash on a described meal and nothing on a photographed one.
        analysis = build_text_analysis({"grams": 100}, query="1 apple")
        for key in ("confidence", "portion", "components", "cooking", "scene",
                    "assumptions", "uncertainties", "matched_saved_food"):
            assert key in analysis
        assert analysis["scene"]["uncounted"] == []


# --------------------------------------------------------------------------
# Routing
# --------------------------------------------------------------------------


class TestEscalationTriggers:
    def test_disagreeing_with_the_user_buys_a_second_pass(self):
        decision = should_escalate_text(
            {"components": [], "portion": {}},
            None,
            {"stated_calories": 600, "estimated_calories": 1100,
             "difference_ratio": 0.833, "direction": "higher", "disagrees": True},
        )
        assert decision["escalate"] is True
        assert "600 kcal" in decision["triggers"][0]

    def test_a_vague_one_word_entry_does_not(self):
        # Low confidence is not a routing signal: there is nothing more for a
        # stronger model to extract from "rice".
        decision = should_escalate_text(
            {"components": [{"name": "rice"}],
             "confidence": {"level": "low"},
             "portion": {"estimated_grams": 150, "low_grams": 130, "high_grams": 170}},
            None,
            None,
            calories=200,
        )
        assert decision["escalate"] is False

    def test_impossible_calorie_density_escalates(self):
        decision = should_escalate_text(
            {"components": [],
             "portion": {"estimated_grams": 80, "low_grams": 70, "high_grams": 90}},
            None,
            None,
            calories=900,
        )
        assert decision["escalate"] is True
        assert any("per gram" in trigger for trigger in decision["triggers"])


# --------------------------------------------------------------------------
# End to end, against a fake client
# --------------------------------------------------------------------------


class _Message:
    def __init__(self, content):
        self.content = content


class _Choice:
    def __init__(self, content):
        self.message = _Message(content)


class _Response:
    def __init__(self, content):
        self.choices = [_Choice(content)]


class _FakeCompletions:
    def __init__(self, by_model):
        self.by_model = by_model
        self.models = []

    def create(self, **kwargs):
        model = kwargs["model"]
        self.models.append(model)
        payload = self.by_model.get(model)
        if payload is None:
            raise RuntimeError(f"no canned response for {model}")
        return _Response(json.dumps(payload))


class _FakeClient:
    def __init__(self, by_model):
        self.chat = type("chat", (), {})()
        self.chat.completions = _FakeCompletions(by_model)


def _payload(calories, protein=25.0, components=None, **extra):
    return {
        "name": "Frankie wraps",
        "serving": "3 wraps",
        "grams": 500,
        "identity_confidence": "high",
        "portion": {"estimated_grams": 500, "low_grams": 450, "high_grams": 560},
        "components": components if components is not None else [],
        "calories": calories,
        "protein": protein,
        "carbs": 90.0,
        "fats": 30.0,
        "fiber": 8.0,
        **extra,
    }


@pytest.fixture
def fake_openai(monkeypatch):
    def install(by_model):
        client = _FakeClient(by_model)
        monkeypatch.setattr(gpt_food_lookup, "get_openai_client", lambda: client)
        return client

    return install


class TestTwoPasses:
    def test_the_first_pass_is_not_the_cheapest_model_in_the_app(self, fake_openai):
        # It ran a hardcoded gpt-4o-mini — a model not even in ALLOWED_MODELS —
        # while a photo of the same meal got gpt-4o with escalation.
        client = fake_openai({"gpt-4o": _payload(620)})
        estimate_food_from_query("3 frankie wraps, about 600 calories")
        assert client.chat.completions.models[0] == "gpt-4o"

    def test_disagreeing_with_the_user_escalates(self, fake_openai):
        client = fake_openai({
            "gpt-4o": _payload(1100),
            "gpt-5.6-sol": _payload(720),
        })
        result = estimate_food_from_query("3 frankie wraps, i think that was about 600 calories")

        assert client.chat.completions.models == ["gpt-4o", "gpt-5.6-sol"]
        assert result["calories"] == 720
        assert result["analysis"]["routing"]["escalated"] is True

    def test_a_surviving_disagreement_is_reported_not_buried(self, fake_openai):
        # The stronger pass agrees with the first: the user really did
        # undercount. That is a fine answer — but it has to be visible, or a
        # corrected underestimate and a bug look identical from the card.
        fake_openai({
            "gpt-4o": _payload(1100),
            "gpt-5.6-sol": _payload(
                1080, hint_disagreement="about 400 kcal of it is the oil the wraps are fried in"
            ),
        })
        result = estimate_food_from_query("3 frankie wraps, i think that was about 600 calories")

        check = result["analysis"]["hint_check"]
        assert check["stated_calories"] == 600
        assert check["estimated_calories"] == 1080
        assert check["disagrees"] is True
        assert "oil" in check["reason"]

    def test_agreement_leaves_nothing_to_report(self, fake_openai):
        fake_openai({"gpt-4o": _payload(640)})
        result = estimate_food_from_query("3 frankie wraps, about 600 calories")

        assert result["analysis"]["hint_check"]["disagrees"] is False
        assert result["analysis"]["routing"]["escalated"] is False

    def test_a_failed_second_pass_keeps_the_first_answer(self, fake_openai):
        # Escalation must never be able to turn a usable estimate into none.
        client = fake_openai({"gpt-4o": _payload(1100)})
        result = estimate_food_from_query("3 frankie wraps, i think that was about 600 calories")

        assert client.chat.completions.models[0] == "gpt-4o"
        assert "gpt-5.6-sol" in client.chat.completions.models
        assert result["calories"] == 1100
        assert result["analysis"]["routing"]["escalated"] is False

    def test_escalation_can_be_switched_off(self, fake_openai):
        client = fake_openai({"gpt-4o": _payload(1100)})
        estimate_food_from_query(
            "3 frankie wraps, about 600 calories", allow_escalation=False
        )
        assert client.chat.completions.models == ["gpt-4o"]

    def test_the_estimate_carries_its_own_evidence(self, fake_openai):
        fake_openai({
            "gpt-4o": _payload(
                640,
                components=[
                    {"item": "flour tortilla", "calories": 400, "protein": 10,
                     "carbs": 70, "fats": 6, "fiber": 3},
                    {"item": "chickpea filling", "calories": 240, "protein": 15,
                     "carbs": 20, "fats": 12, "fiber": 5},
                ],
                assumptions=["shallow fried in a little oil"],
            )
        })
        result = estimate_food_from_query("3 frankie wraps, about 600 calories")
        analysis = result["analysis"]

        assert [c["name"] for c in analysis["components"]] == [
            "flour tortilla",
            "chickpea filling",
        ]
        assert analysis["assumptions"] == ["shallow fried in a little oil"]
        assert analysis["source"] == "text"
