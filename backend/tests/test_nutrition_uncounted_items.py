"""
The omission case: food that is in the photo and in no ledger.

Built around khichdi photographed with a katori of dahi, logged as khichdi.
Every guard in the pipeline passed it, and none of them was broken — they all
test for INCONSISTENCY, and an omission is perfectly consistent. The yogurt is
missing from the components, from the total and from the macro arithmetic
alike, so `assess_macro_coherence` has nothing to repair.

Two inversions made it worse, both pinned below: `should_escalate` routed on
component COUNT, so dropping an item made the plate look simpler and the
stronger second pass less likely; and the confidence score paid five points for
a short ledger, so missing the yogurt raised confidence in the answer.
"""

from nutrition.photo_estimate import (
    build_photo_analysis,
    normalize_components,
    normalize_scene,
    should_escalate,
)
from nutrition.vision_prompt import (
    PROMPT_VARIANTS,
    rules_for,
    schema_extra_for,
)


def scene(items_seen=(), excluded=()):
    return {"items_seen": list(items_seen), "excluded": list(excluded)}


def parsed(components=(), items_seen=(), excluded=(), **extra):
    return {
        "components": [
            {"item": name, "calories": 200, "protein": 8} for name in components
        ],
        "scene": scene(items_seen, excluded),
        "portion": {"estimated_grams": 450, "low_grams": 380, "high_grams": 520},
        "identity_confidence": "high",
        "image_quality": {
            "lighting": "good",
            "sharpness": "sharp",
            "full_meal_visible": True,
            "view_angle": "top_down",
        },
        **extra,
    }


def analysis_for(**kwargs):
    return build_photo_analysis(parsed(**kwargs))


# --- the case ---------------------------------------------------------------


def test_the_yogurt_is_named_when_it_is_seen_and_not_costed():
    analysis = analysis_for(
        components=["Khichdi"],
        items_seen=["khichdi", "a katori of plain yogurt"],
    )
    assert analysis["scene"]["uncounted"] == ["a katori of plain yogurt"]


def test_an_uncounted_item_escalates_even_though_the_plate_looks_simple():
    # One component is far under COMPLEX_MEAL_COMPONENTS, the numbers are
    # coherent, confidence is not low and the portion range is tight — every
    # pre-existing trigger says "easy photo". The omission is the only signal.
    analysis = analysis_for(
        components=["Khichdi"],
        items_seen=["khichdi", "a katori of plain yogurt"],
    )
    decision = should_escalate(analysis, {"repaired": False})
    assert decision["escalate"] is True
    assert "yogurt" in decision["triggers"][0]


def test_missing_an_item_no_longer_raises_confidence():
    # The +5 for a short ledger is exactly backwards when the ledger is short
    # *because* something was dropped.
    complete = analysis_for(
        components=["Khichdi", "Plain yogurt"],
        items_seen=["khichdi", "plain yogurt"],
    )
    missing = analysis_for(
        components=["Khichdi"],
        items_seen=["khichdi", "plain yogurt"],
    )
    assert missing["confidence"]["score"] < complete["confidence"]["score"]


def test_the_user_is_told_what_was_left_out():
    analysis = analysis_for(
        components=["Khichdi"],
        items_seen=["khichdi", "a katori of plain yogurt"],
    )
    assert any("Not counted" in reason for reason in analysis["confidence"]["reasons"])


# --- what must NOT trigger --------------------------------------------------


def test_a_component_covering_several_seen_items_is_accounted_for():
    # A model that folds rice and dal into one "khichdi" row has costed both.
    # Comparing counts would call this a miss; matching on identity does not.
    analysis = analysis_for(
        components=["Rice and lentil khichdi"],
        items_seen=["rice", "lentils", "khichdi"],
    )
    assert analysis["scene"]["uncounted"] == []
    assert should_escalate(analysis, None)["escalate"] is False


def test_an_item_excluded_with_a_reason_is_explained_not_missing():
    analysis = analysis_for(
        components=["Khichdi"],
        items_seen=["khichdi", "water"],
        excluded=[{"item": "water", "reason": "no calories"}],
    )
    assert analysis["scene"]["uncounted"] == []
    assert analysis["scene"]["excluded"] == [
        {"item": "water", "reason": "no calories"}
    ]


def test_a_generic_word_never_matches_the_wrong_dish():
    # "side" and "bowl" carry no identity — matching on them would let a bowl
    # of rice account for a bowl of yogurt.
    analysis = analysis_for(
        components=["Bowl of rice"],
        items_seen=["bowl of rice", "side bowl of yogurt"],
    )
    assert analysis["scene"]["uncounted"] == ["side bowl of yogurt"]


def test_an_unidentifiable_entry_does_not_escalate():
    # Nothing to match on is not evidence of an omission.
    analysis = analysis_for(components=["Khichdi"], items_seen=["a side"])
    assert analysis["scene"]["uncounted"] == []


# --- the older variants stay comparable ------------------------------------


def test_v1_and_v2_produce_no_scene_and_so_no_new_trigger():
    # They are never asked for an inventory; the trigger has to be inert for
    # them or a v2-vs-v3 replay would be measuring two changes at once.
    analysis = build_photo_analysis(
        {
            "components": [{"item": "Khichdi", "calories": 600}],
            "portion": {"estimated_grams": 450, "low_grams": 380, "high_grams": 520},
            "identity_confidence": "high",
            "image_quality": {"lighting": "good", "sharpness": "sharp", "full_meal_visible": True},
        }
    )
    assert analysis["scene"] == {"items_seen": [], "excluded": [], "uncounted": []}
    assert should_escalate(analysis, None)["escalate"] is False


def test_only_v3_asks_for_the_inventory_block():
    assert schema_extra_for("v1") == ""
    assert schema_extra_for("v2") == ""
    assert "items_seen" in schema_extra_for("v3")


def test_v3_keeps_every_v2_rule_that_is_not_the_title_rule():
    v2_rules = [line for line in PROMPT_VARIANTS["v2"].splitlines() if line.strip()]
    v3 = rules_for("v3")
    dropped = [line for line in v2_rules if line not in v3]
    # Only the title rule is replaced — v2's compounding fix must survive.
    assert len(dropped) == 1 and "title" in dropped[0]
    assert "inventory the frame" in v3


def test_an_unknown_variant_falls_back_rather_than_failing():
    assert rules_for("v99") == rules_for(None)


# --- normalization guards ---------------------------------------------------


def test_scene_survives_junk_from_the_model():
    assert normalize_scene({}, []) == {"items_seen": [], "excluded": [], "uncounted": []}
    assert normalize_scene({"scene": "yes"}, [])["items_seen"] == []
    assert normalize_scene({"scene": {"items_seen": "rice"}}, [])["items_seen"] == []


def test_a_bare_string_exclusion_still_carries_a_reason_field():
    result = normalize_scene({"scene": {"excluded": ["napkin"]}}, [])
    assert result["excluded"] == [{"item": "napkin", "reason": "no reason given"}]


def test_duplicate_sightings_are_collapsed():
    result = normalize_scene(
        {"scene": {"items_seen": ["yogurt", "yogurt", "khichdi"]}},
        normalize_components([{"item": "Khichdi", "calories": 100}]),
    )
    assert result["items_seen"] == ["yogurt", "khichdi"]
    assert result["uncounted"] == ["yogurt"]


# --- macros are reconciled against the ledger, not just calories ------------


def test_protein_is_reconciled_against_the_component_ledger():
    # The bug this pins: calories took the max of stated vs component sum from
    # the start; protein was read straight off the top level. A ledger reading
    # 41g under a stated 25g logged 25g — and rendered the disagreeing ledger
    # right underneath the number.
    from nutrition.gpt_food_lookup import finalize_estimated_macros

    estimate = {
        "calories": 700, "protein": 25, "carbs": 90, "fats": 20,
        "components": [
            {"item": "Khichdi", "calories": 520, "protein": 16, "carbs": 80, "fats": 12},
            {"item": "Yogurt", "calories": 180, "protein": 25, "carbs": 10, "fats": 8},
        ],
    }
    calories, protein, carbs, fats, _fiber = finalize_estimated_macros(estimate)
    assert protein == 41.0
    assert carbs == 90.0  # stated already covers the parts
    assert fats == 20.0
    assert calories == 700


def test_a_partial_ledger_never_drags_a_macro_down():
    # Two of four components carry protein. Summing them and trusting it would
    # replace a whole-plate estimate with a fragment of one.
    from nutrition.gpt_food_lookup import assess_macro_coherence

    result = assess_macro_coherence({
        "calories": 800, "protein": 50, "carbs": 90, "fats": 25,
        "components": [
            {"item": "Rice", "calories": 300, "protein": 6},
            {"item": "Dal", "calories": 200, "protein": 12},
            {"item": "Sabzi", "calories": 150},
            {"item": "Roti", "calories": 150},
        ],
    })
    assert result["protein"] == 50.0


def test_a_protein_disagreement_escalates_on_its_own():
    # Calories agree exactly; only protein is short. The calorie gap is 0, so
    # without a protein-specific signal nothing routes this photo.
    from nutrition.gpt_food_lookup import assess_macro_coherence

    coherence = assess_macro_coherence({
        "calories": 700, "protein": 25, "carbs": 90, "fats": 20,
        "components": [
            {"item": "Khichdi", "calories": 520, "protein": 16},
            {"item": "Yogurt", "calories": 180, "protein": 25},
        ],
    })
    assert coherence["gap_ratio"] == 0.0
    assert coherence["protein_gap_ratio"] > 0.08

    decision = should_escalate(analysis_for(components=["Khichdi", "Yogurt"]), coherence)
    assert decision["escalate"] is True
    assert any("protein" in trigger for trigger in decision["triggers"])


def test_an_estimate_with_no_ledger_is_left_alone():
    from nutrition.gpt_food_lookup import assess_macro_coherence

    result = assess_macro_coherence({"calories": 500, "protein": 30, "carbs": 50, "fats": 15})
    assert result["protein"] == 30.0
    assert result["repaired"] is False
    assert result["protein_gap_ratio"] == 0.0


def test_a_rounding_sized_protein_gap_does_not_buy_a_second_vision_call():
    # 8% of a 20g estimate is 1.6g — reachable by rounding line items, and
    # nothing about the user's day changes at that size.
    from nutrition.gpt_food_lookup import assess_macro_coherence

    coherence = assess_macro_coherence({
        "calories": 400, "protein": 18, "carbs": 40, "fats": 10,
        "components": [
            {"item": "Toast", "calories": 200, "protein": 8.5},
            {"item": "Egg", "calories": 200, "protein": 11.5},
        ],
    })
    assert coherence["protein"] == 20.0
    assert coherence["protein_gap_ratio"] >= 0.08  # ratio alone would fire
    assert should_escalate(analysis_for(components=["Toast", "Egg"]), coherence)[
        "escalate"
    ] is False


# --- the threshold that lost the protein ------------------------------------


def test_a_three_component_plate_earns_the_stronger_pass():
    """
    Measured Sep 2026 against the archived photos, cheap vs strong on the same
    image. Every Indian meal plate came back from gpt-4o with exactly three
    components -- one under the old threshold of four -- and every one was
    22-61% low on protein:

        Indian breakfast platter   -15% kcal   -22% protein
        Sabudana khichdi + yogurt  -36% kcal   -61% protein
        Sabudana khichdi + upma    -26% kcal   -52% protein

    The threshold sat one notch above where the degradation starts, so the
    plates that needed a second pass were exactly the ones that never got one.
    """
    analysis = analysis_for(components=["Khichdi", "Yogurt", "Plum"])
    decision = should_escalate(analysis, {"repaired": False})
    assert decision["escalate"] is True
    assert "3 components" in decision["triggers"][0]


def test_a_single_dish_still_pays_cheap_prices():
    # The cheap model handles one food on one plate perfectly well; escalating
    # everything would be paying strong-model prices for the common case.
    analysis = analysis_for(components=["Chicken breast"])
    assert should_escalate(analysis, {"repaired": False})["escalate"] is False
    two = analysis_for(components=["Chicken breast", "Rice"])
    assert should_escalate(two, {"repaired": False})["escalate"] is False
