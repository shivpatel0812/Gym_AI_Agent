"""
Today's headline has to agree with the ring sitting under it.

Found by driving the running app: the Nutrition page showed
"114 calories over target." directly above a calorie ring reading
"2,284 consumed · 66 left · 2,350 target". Both numbers were computed
correctly. The sentence was wrong.

`available` subtracts the planned meals the user has NOT eaten yet, so a
negative value is a PROJECTION — "if you also eat what you have planned, you
land 114 over" — and the headline stated it as a fact about the present. A user
who is 66 under target was told they had overeaten, which is the one thing a
calorie tracker must never get backwards.
"""

from nutrition.today_guidance import build_today_guidance


def plan(calories=2350, protein=150, anchors=(), flexible=()):
    return {
        "status": "active",
        "targets": {"calories": calories, "protein": protein},
        "meal_anchors": [
            {
                "id": f"a{i}",
                "label": label,
                "slot": "dinner",
                "frequency": "daily",
                "foods": [{"name": label, "calories": kcal, "protein": pro}],
            }
            for i, (label, kcal, pro) in enumerate(anchors)
        ],
        "flexible_meals": list(flexible),
    }


def logged(calories, protein, name="Breakfast"):
    return [{"name": name, "meal": "Breakfast", "calories": calories, "protein": protein}]


def headline_for(*args, **kwargs):
    return build_today_guidance(*args, **kwargs)["messages"][0]


# --- the bug ----------------------------------------------------------------


def test_a_projection_is_not_reported_as_a_fact():
    # 2284 of 2350 logged -> 66 left. A 180 kcal dinner is still to come, so
    # `available` is -114. The user has NOT overeaten.
    result = build_today_guidance(
        plan(anchors=[("Dinner", 180, 20)]),
        logged(2284, 90),
    )
    line = result["messages"][0]
    assert "over target" not in line
    # It has to name the number the ring shows, or the two disagree on screen.
    assert "66 calories left" in line
    assert "Dinner" in line
    assert "114 over" in line


def test_actually_being_over_target_still_says_so_plainly():
    # 2500 logged against 2350: genuinely over, with nothing left to come.
    line = headline_for(plan(anchors=[("Dinner", 180, 20)]), logged(2500, 120))
    assert "over target" in line


def test_room_left_after_the_planned_meals_reads_as_room():
    line = headline_for(plan(anchors=[("Dinner", 180, 20)]), logged(1200, 60))
    assert "calories left after Dinner" in line


def test_no_plan_means_no_guidance_rather_than_a_guess():
    assert build_today_guidance(None, logged(1200, 60)) == {"has_plan": False}


def test_a_flexible_meal_keeps_its_conditional_wording():
    # This branch was always right; the regression guard is that it stays that
    # way, since the fixed branch was modelled on it.
    result = build_today_guidance(
        plan(
            anchors=[("Dinner", 400, 30)],
            flexible=[{"name": "Lunch", "frequency": "daily", "calorie_min": 500, "calorie_max": 700}],
        ),
        logged(2100, 90),
    )
    line = result["messages"][0]
    assert "would put you over target" in line
    assert "Dinner" in line
