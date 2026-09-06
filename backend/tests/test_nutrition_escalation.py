"""Cheap-first, escalate-on-doubt routing for meal photos.

The case these are built around: a five-compartment Indian thali, sharply lit
and fully visible, estimated at 440 kcal when the truth was ~650. The existing
confidence score rated that photo 72/"medium" with no nudge — because it grades
photo legibility, not accuracy. Routing on it would have skipped the one photo
that needed help.
"""

from nutrition import analyzer
from nutrition.gpt_food_lookup import assess_macro_coherence
from nutrition.photo_estimate import should_escalate


def _analysis(components=(), level="medium", portion=None):
    return {
        "confidence": {"score": 72, "level": level, "reasons": [], "should_nudge": False},
        "components": [{"name": name, "calories": 100} for name in components],
        "portion": portion or {"estimated_grams": 500, "low_grams": 400, "high_grams": 650},
    }


# --- coherence -------------------------------------------------------------


def test_coherence_reports_the_gap_it_repairs():
    result = assess_macro_coherence(
        {
            "calories": 440,
            "protein": 16,
            "carbs": 73,
            "fats": 10.5,
            "components": [{"calories": 130}, {"calories": 230}, {"calories": 200}],
        }
    )

    assert result["reported_calories"] == 440
    assert result["component_sum"] == 560
    assert result["calories"] == 560
    assert result["repaired"] is True
    assert result["gap_ratio"] == 0.214


def test_coherent_estimate_reports_no_repair():
    result = assess_macro_coherence(
        {
            "calories": 560,
            "protein": 20,
            "carbs": 90,
            "fats": 13,
            "components": [{"calories": 330}, {"calories": 230}],
        }
    )

    assert result["repaired"] is False
    assert result["gap_ratio"] == 0.0


# --- the escalation rule ---------------------------------------------------


def test_complex_plate_escalates():
    decision = should_escalate(_analysis(components="abcde"))

    assert decision["escalate"] is True
    assert "5 components on one plate" in decision["triggers"]


def test_incoherent_arithmetic_escalates():
    decision = should_escalate(
        _analysis(components="ab"),
        {"repaired": True, "gap_ratio": 0.21},
    )

    assert decision["escalate"] is True
    assert any("missed its own parts by 21%" in t for t in decision["triggers"])


def test_a_rounding_level_repair_does_not_escalate():
    # Nudging calories by a couple of kcal to reconcile rounding is normal and
    # must not buy a second call on every photo.
    decision = should_escalate(
        _analysis(components="ab"),
        {"repaired": True, "gap_ratio": 0.01},
    )

    assert decision["escalate"] is False


def test_simple_coherent_plate_stays_cheap():
    decision = should_escalate(
        _analysis(components="ab"),
        {"repaired": False, "gap_ratio": 0.0},
    )

    assert decision["escalate"] is False
    assert decision["triggers"] == []


def test_unloggably_wide_portion_range_escalates():
    decision = should_escalate(
        _analysis(components="a", portion={"estimated_grams": 400, "low_grams": 200, "high_grams": 620})
    )

    assert decision["escalate"] is True


def test_good_photo_of_a_simple_meal_is_not_escalated_on_legibility():
    """A "medium" confidence score alone is not a reason to spend more.

    Only an explicitly low first pass is — otherwise nearly every plate photo
    escalates, since a plate without a known package caps the score below high.
    """
    assert should_escalate(_analysis(components="ab", level="medium"))["escalate"] is False
    assert should_escalate(_analysis(components="ab", level="low"))["escalate"] is True


# --- the two-pass flow -----------------------------------------------------


def _vision(model, calories, components, coherence=None):
    return {
        "name": "Indian thali",
        "amount": "1 tray",
        "calories": calories,
        "protein": 20,
        "carbs": 90,
        "fats": 13,
        "fiber": 9,
        "model": model,
        "analysis": _analysis(components=components),
        "coherence": coherence or {"repaired": False, "gap_ratio": 0.0},
    }


class _Spy:
    """Stands in for gpt_vision_estimate and records each pass."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.models = []

    def __call__(self, image_path, description=None, *, model=None, **kwargs):
        self.models.append(model)
        return self.responses.pop(0) if self.responses else None


def test_complex_meal_is_re_run_on_the_stronger_model(monkeypatch):
    spy = _Spy(
        _vision("gpt-4o", 440, "abcde"),
        _vision("gpt-5.6-sol", 650, "abcde"),
    )
    monkeypatch.setattr(analyzer, "gpt_vision_estimate", spy)

    result = analyzer.analyze_food_image("/tmp/meal.jpg", model="gpt-4o")

    assert spy.models == ["gpt-4o", "gpt-5.6-sol"]
    assert result["food"]["calories"] == 650
    routing = result["analysis"]["routing"]
    assert routing["escalated"] is True
    assert routing["first_pass_model"] == "gpt-4o"
    assert routing["final_model"] == "gpt-5.6-sol"


def test_simple_meal_never_pays_for_a_second_pass(monkeypatch):
    spy = _Spy(_vision("gpt-4o", 300, "ab"))
    monkeypatch.setattr(analyzer, "gpt_vision_estimate", spy)

    result = analyzer.analyze_food_image("/tmp/apple.jpg", model="gpt-4o")

    assert spy.models == ["gpt-4o"]
    assert result["analysis"]["routing"]["escalated"] is False
    assert result["food"]["calories"] == 300


def test_a_failed_second_pass_keeps_the_first_answer(monkeypatch):
    # The first pass is a usable estimate. Letting an escalation failure drop
    # it to the description-only fallback would make escalation a downgrade.
    spy = _Spy(_vision("gpt-4o", 440, "abcde"), None)
    monkeypatch.setattr(analyzer, "gpt_vision_estimate", spy)

    result = analyzer.analyze_food_image("/tmp/meal.jpg", model="gpt-4o")

    assert result["food"]["calories"] == 440
    assert result["analysis"]["routing"]["escalated"] is False
    # The trigger is still recorded, so a bad estimate can be traced back.
    assert result["analysis"]["routing"]["triggers"]


def test_an_explicit_strong_model_does_not_escalate_to_itself(monkeypatch):
    spy = _Spy(_vision("gpt-5.6-sol", 650, "abcde"))
    monkeypatch.setattr(analyzer, "gpt_vision_estimate", spy)

    result = analyzer.analyze_food_image("/tmp/meal.jpg", model="gpt-5.6-sol")

    assert spy.models == ["gpt-5.6-sol"]
    assert result["analysis"]["routing"]["escalated"] is False


def test_escalation_can_be_switched_off(monkeypatch):
    spy = _Spy(_vision("gpt-4o", 440, "abcde"))
    monkeypatch.setattr(analyzer, "gpt_vision_estimate", spy)

    result = analyzer.analyze_food_image(
        "/tmp/meal.jpg", model="gpt-4o", allow_escalation=False
    )

    assert spy.models == ["gpt-4o"]
    assert result["analysis"]["routing"]["escalated"] is False
    assert result["analysis"]["routing"]["triggers"]


def test_unreadable_photo_still_falls_back_to_the_description(monkeypatch):
    monkeypatch.setattr(analyzer, "gpt_vision_estimate", _Spy(None))
    monkeypatch.setattr(
        analyzer,
        "estimate_food_from_query",
        lambda query, name=None, **kwargs: {
            "name": "Thali", "calories": 600, "protein": 20, "serving": "1 tray"
        },
    )

    result = analyzer.analyze_food_image("/tmp/blur.jpg", "a thali", model="gpt-4o")

    assert result["food"]["calories"] == 600
    assert "analysis" in result and "routing" not in result["analysis"]
