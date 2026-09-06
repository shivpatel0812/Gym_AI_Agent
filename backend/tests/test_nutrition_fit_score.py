"""Goal-relative fit scoring.

The property under test throughout: the SAME food scores differently under
different goals and different meal budgets. A scorer where that isn't true is
a health score wearing a fit score's name.
"""

from nutrition.fit_score import score_day, score_food

CUT = {"goal": "fat_loss", "daily_calories": 2000, "daily_protein": 170}
BULK = {"goal": "lean_bulk", "daily_calories": 2800, "daily_protein": 190}
DINNER = {"calorie_min": 550, "calorie_max": 750, "protein_min": 45}

CHICKEN = {"name": "Chicken breast", "calories": 330, "protein": 62, "carbs": 0, "fats": 7}
KADHI = {"name": "Kadhi with dumplings", "calories": 620, "protein": 15, "carbs": 60, "fats": 34}
LENTILS = {"name": "Dal", "calories": 300, "protein": 18, "carbs": 45, "fats": 4, "fiber": 12}
KETCHUP = {"name": "Ketchup", "calories": 25, "protein": 0.3, "carbs": 6, "fats": 0}


# --- the guard rails -------------------------------------------------------


def test_no_targets_means_no_score():
    # A fit score against an invented target looks like information and is
    # noise. Same stance as `estimate_maintenance_calories`.
    assert score_food(CHICKEN, goal="fat_loss", daily_calories=None, daily_protein=None) is None
    assert score_food(CHICKEN, goal="fat_loss", daily_calories=2000, daily_protein=0) is None


def test_a_condiment_is_not_scored():
    result = score_food(KETCHUP, slot_target=DINNER, **CUT)
    assert result["band"] == "trivial"
    assert result["score"] is None


def test_scoring_is_deterministic():
    first = score_food(KADHI, slot_target=DINNER, **CUT)
    second = score_food(KADHI, slot_target=DINNER, **CUT)
    assert first == second


# --- the point of the whole thing ------------------------------------------


def test_the_same_food_scores_differently_by_goal():
    on_cut = score_food(KADHI, slot_target=DINNER, **CUT)
    on_bulk = score_food(KADHI, slot_target=DINNER, **BULK)

    # Identical food, identical slot. Only the goal moved.
    assert on_bulk["score"] > on_cut["score"]


def test_protein_dense_food_wins_under_every_goal():
    for targets in (CUT, BULK):
        chicken = score_food(CHICKEN, slot_target=DINNER, **targets)
        kadhi = score_food(KADHI, slot_target=DINNER, **targets)
        assert chicken["score"] > kadhi["score"], targets["goal"]
    assert score_food(CHICKEN, slot_target=DINNER, **CUT)["band"] in ("excellent", "good")


def test_a_tiny_item_is_penalised_only_on_a_surplus():
    small = {"name": "Rice cake", "calories": 90, "protein": 2, "carbs": 19, "fats": 0.5}
    on_cut = score_food(small, slot_target=DINNER, **CUT)
    on_bulk = score_food(small, slot_target=DINNER, **BULK)

    # Compact is a virtue when calories are scarce and a failure when the job
    # is getting them in.
    assert on_cut["score"] > on_bulk["score"]
    assert on_bulk["reason"] == "Too small to move your surplus"


def test_an_item_eating_the_whole_meal_budget_is_flagged():
    huge = {"name": "Loaded plate", "calories": 950, "protein": 20, "carbs": 120, "fats": 40}
    result = score_food(huge, slot_target=DINNER, **CUT)

    assert result["reason"] == "Uses more than this meal's whole budget"
    assert result["band"] == "poor"


def test_slot_budget_changes_the_score_of_one_food():
    generous = score_food(KADHI, slot_target={"calorie_max": 1100}, **CUT)
    tight = score_food(KADHI, slot_target={"calorie_max": 400}, **CUT)

    assert generous["score"] > tight["score"]


def test_fiber_is_credited():
    without = dict(LENTILS, fiber=0)
    assert score_food(LENTILS, slot_target=DINNER, **CUT)["score"] > score_food(
        without, slot_target=DINNER, **CUT
    )["score"]


def test_protein_ratio_is_reported_for_explanation():
    result = score_food(CHICKEN, slot_target=DINNER, **CUT)
    # 62g / 330 kcal against a required 170/2000 — comfortably above 1.
    assert result["protein_ratio"] > 2
    assert result["slot_share"] == round(330 / 750, 2)


# --- the day roll-up -------------------------------------------------------


def test_day_score_is_weighted_by_calories():
    items = [
        dict(CHICKEN, meal="lunch"),
        dict(KADHI, meal="dinner"),
    ]
    result = score_day(
        items,
        slot_targets={"lunch": DINNER, "dinner": DINNER},
        **CUT,
    )

    assert len(result["items"]) == 2
    scores = [i["score"] for i in result["items"]]
    # A 620 kcal dinner and a 330 kcal lunch are not equal votes, so the day
    # sits nearer the larger meal than a plain average would put it.
    assert result["day_score"] < round(sum(scores) / 2)
    assert min(scores) <= result["day_score"] <= max(scores)


def test_a_day_of_only_condiments_has_no_score():
    result = score_day([dict(KETCHUP, meal="dinner")], slot_targets={}, **CUT)
    assert result["day_score"] is None
    assert result["day_band"] is None


def test_items_without_a_slot_still_score():
    result = score_day([dict(CHICKEN, meal="")], slot_targets={"dinner": DINNER}, **CUT)
    assert result["items"][0]["score"] is not None


# --- the scan-screen preview ------------------------------------------------


def test_serving_count_changes_the_fit():
    """Why the scan screen re-requests instead of scoring once.

    A portion that fits a meal at 1x can swallow the whole budget at 3x, so a
    score computed on the base estimate would contradict the badge the same
    food gets in the day's log.
    """
    single = score_food(LENTILS, slot_target=DINNER, **CUT)
    tripled = score_food(
        {k: (v * 3 if isinstance(v, (int, float)) else v) for k, v in LENTILS.items()},
        slot_target=DINNER,
        **CUT,
    )

    assert tripled["score"] < single["score"]
    assert tripled["slot_share"] > single["slot_share"]


def test_pre_workout_never_says_low_protein():
    """A carb snack before training is doing its job — do not ding it for protein."""
    banana = {"name": "Banana", "calories": 105, "protein": 1.3, "carbs": 27, "fats": 0.4}
    pre = {"calorie_min": 120, "calorie_max": 220, "slot": "pre_workout"}

    as_dinner = score_food(banana, slot_target=DINNER, slot="dinner", **CUT)
    as_pre = score_food(banana, slot_target=pre, slot="pre_workout", **CUT)

    assert "protein" in as_dinner["reason"].lower() or as_dinner["band"] in ("poor", "fair")
    assert as_pre["reason"] == "Solid training fuel"
    assert "protein" not in as_pre["reason"].lower()
    assert as_pre["score"] > as_dinner["score"]


def test_pre_workout_label_aliases_resolve():
    banana = {
        "name": "Banana",
        "calories": 105,
        "protein": 1,
        "carbs": 27,
        "fats": 0,
        "meal": "pre-workout",
    }
    result = score_day(
        [banana],
        slot_targets={"pre_workout": {"calorie_min": 120, "calorie_max": 220}},
        **CUT,
    )
    assert result["items"][0]["reason"] == "Solid training fuel"


# --- day totals composite (History chart) ----------------------------------

from nutrition.fit_score import score_day_totals

PLAN = {"calories": 2000, "protein": 150, "carbs": 200, "fats": 65, "fiber": 30}


def test_day_on_target_is_excellent():
    result = score_day_totals(
        {"calories": 2000, "protein": 150, "carbs": 200, "fats": 65, "fiber": 30},
        goal="fat_loss",
        targets=PLAN,
    )
    assert result["score"] == 100
    assert result["source"] == "plan"
    assert result["band"] == "excellent"


def test_a_cut_day_low_on_calories_is_not_automatically_best():
    """'Low cal / high protein / high carb' is not a universal win — carbs and
    fats still have to land near the plan, and a surplus goal punishes the
    calorie gap harder than a cut does."""
    day = {"calories": 1600, "protein": 180, "carbs": 250, "fats": 40, "fiber": 25}
    cut = score_day_totals(day, goal="fat_loss", targets=PLAN)
    bulk = score_day_totals(
        day,
        goal="lean_bulk",
        targets={**PLAN, "calories": 2800, "protein": 190},
    )
    assert cut["score"] > bulk["score"]
    assert cut["score"] < 100


def test_no_plan_falls_back_to_protein_density():
    result = score_day_totals(
        {"calories": 2000, "protein": 160, "carbs": 0, "fats": 0, "fiber": 20},
        goal="",
        targets={},
    )
    assert result["source"] == "density"
    assert result["score"] is not None
    assert result["score"] >= 80
