"""
Meal timing.

The property under test throughout: a time is only reported when it is
evidence. A log written three days after the meal, or a slot with two entries
in it, produces no "typical time" -- the alternative is a confident clock
reading built from when the user happened to open the app.
"""

from nutrition.meal_timing import (
    day_windows,
    format_clock,
    meal_time_minutes,
    slot_corrections,
    slot_timing,
    stamp_logged_at,
    summarize_meal_timing,
)


def food(name, meal, logged_at=None, **extra):
    return {"name": name, "calories": 400, "protein": 30, "meal": meal,
            "logged_at": logged_at, **extra}


def day(date, *items):
    return {"date": date, "food_items": list(items)}


# --- what counts as a time -------------------------------------------------


def test_a_log_written_on_the_day_it_is_filed_under_is_the_meal_time():
    item = food("Oats", "Breakfast", "2026-09-04T07:42:00-04:00")
    assert meal_time_minutes(item, "2026-09-04") == 7 * 60 + 42


def test_a_backfilled_log_carries_no_meal_time():
    # Filling in yesterday's dinner at 11pm tonight would otherwise report an
    # 11pm dinner and drag every average with it.
    item = food("Dal", "Dinner", "2026-09-04T23:10:00-04:00")
    assert meal_time_minutes(item, "2026-09-03") is None


def test_the_user_saying_when_they_ate_beats_the_write_time():
    item = food(
        "Dal", "Dinner",
        logged_at="2026-09-04T23:10:00-04:00",
        eaten_at="2026-09-03T18:30:00-04:00",
    )
    assert meal_time_minutes(item, "2026-09-03") == 18 * 60 + 30


def test_a_row_with_no_timestamps_is_skipped_not_defaulted():
    assert meal_time_minutes(food("Oats", "Breakfast"), "2026-09-04") is None


def test_utc_z_timestamps_parse():
    item = food("Oats", "Breakfast", "2026-09-04T07:42:00Z")
    assert meal_time_minutes(item, "2026-09-04") == 7 * 60 + 42


def test_garbage_timestamps_do_not_raise():
    assert meal_time_minutes(food("Oats", "Breakfast", "not a date"), "2026-09-04") is None


def test_clock_formatting_crosses_noon_and_midnight():
    assert format_clock(0) == "12:00 AM"
    assert format_clock(12 * 60) == "12:00 PM"
    assert format_clock(13 * 60 + 5) == "1:05 PM"
    assert format_clock(None) is None


# --- stamping --------------------------------------------------------------


def test_an_existing_stamp_is_never_overwritten():
    # An update rewrites the whole day, so re-stamping would re-date breakfast
    # to whenever dinner was added.
    items = [
        food("Oats", "Breakfast", "2026-09-04T07:42:00-04:00"),
        food("Dal", "Dinner"),
    ]
    stamped = stamp_logged_at(items, "2026-09-04T21:00:00-04:00")
    assert stamped[0]["logged_at"] == "2026-09-04T07:42:00-04:00"
    assert stamped[1]["logged_at"] == "2026-09-04T21:00:00-04:00"


def test_stamping_does_not_mutate_the_caller_s_rows():
    items = [food("Dal", "Dinner")]
    stamp_logged_at(items, "2026-09-04T21:00:00-04:00")
    assert items[0]["logged_at"] is None


# --- slot habits -----------------------------------------------------------


def test_a_slot_needs_several_days_before_it_has_a_typical_time():
    entries = [
        day("2026-09-01", food("Oats", "Breakfast", "2026-09-01T07:30:00-04:00")),
        day("2026-09-02", food("Oats", "Breakfast", "2026-09-02T07:50:00-04:00")),
    ]
    breakfast = slot_timing(entries)[0]
    assert breakfast["days_logged"] == 2
    assert breakfast["typical_time"] is None
    assert breakfast["consistency"] == "unknown"
    # The range it does know is still reported.
    assert breakfast["earliest_time"] == "7:30 AM"


def test_a_habit_reads_as_consistent_and_a_lottery_does_not():
    steady = [
        day(f"2026-09-0{i}", food("Oats", "Breakfast", f"2026-09-0{i}T07:{30 + i}:00-04:00"))
        for i in range(1, 6)
    ]
    slot = slot_timing(steady)[0]
    assert slot["typical_time"] == "7:33 AM"
    assert slot["consistency"] == "consistent"

    scattered = [
        day("2026-09-01", food("Oats", "Breakfast", "2026-09-01T06:00:00-04:00")),
        day("2026-09-02", food("Oats", "Breakfast", "2026-09-02T09:00:00-04:00")),
        day("2026-09-03", food("Oats", "Breakfast", "2026-09-03T13:00:00-04:00")),
    ]
    assert slot_timing(scattered)[0]["consistency"] == "scattered"


def test_one_itemised_meal_is_one_data_point():
    # Four rows on one dinner is one dinner. Counting rows would let a single
    # heavily itemised meal define the slot's typical time.
    entries = [
        day(
            "2026-09-01",
            food("Rice", "Dinner", "2026-09-01T19:00:00-04:00"),
            food("Dal", "Dinner", "2026-09-01T19:02:00-04:00"),
            food("Roti", "Dinner", "2026-09-01T19:03:00-04:00"),
        ),
        day("2026-09-02", food("Curry", "Dinner", "2026-09-02T21:00:00-04:00")),
    ]
    dinner = slot_timing(entries)[0]
    assert dinner["days_logged"] == 2
    # The meal started at 7pm, not at the last row logged.
    assert dinner["earliest_time"] == "7:00 PM"
    assert dinner["latest_time"] == "9:00 PM"


def test_slots_come_back_in_the_order_a_day_runs():
    entries = [
        day(
            "2026-09-01",
            food("Bar", "Snacks", "2026-09-01T15:00:00-04:00"),
            food("Oats", "Breakfast", "2026-09-01T07:00:00-04:00"),
            food("Dal", "Dinner", "2026-09-01T19:00:00-04:00"),
        )
    ]
    assert [s["slot"] for s in slot_timing(entries)] == ["breakfast", "dinner", "snack"]


# --- the day's shape -------------------------------------------------------


def test_the_eating_window_spans_first_bite_to_last():
    entries = [
        day(
            "2026-09-01",
            food("Oats", "Breakfast", "2026-09-01T08:00:00-04:00"),
            food("Dal", "Dinner", "2026-09-01T20:30:00-04:00"),
        )
    ]
    window = day_windows(entries)[0]
    assert window["first_meal"] == "8:00 AM"
    assert window["last_meal"] == "8:30 PM"
    assert window["window_minutes"] == 750


def test_a_single_timed_meal_has_no_window_to_average():
    entries = [day("2026-09-01", food("Oats", "Breakfast", "2026-09-01T08:00:00-04:00"))]
    assert summarize_meal_timing(entries)["average_window_minutes"] is None


def test_a_day_with_no_usable_times_is_not_a_day_with_timing():
    entries = [day("2026-09-01", food("Oats", "Breakfast"))]
    summary = summarize_meal_timing(entries)
    assert summary["days_with_timing"] == 0
    assert summary["slots"] == []


# --- corrections -----------------------------------------------------------


def test_a_repeated_move_surfaces_as_a_correction():
    entries = [
        day("2026-09-01", food("Banana", "Pre-Workout", "2026-09-01T15:00:00-04:00",
                               moved_from="Snacks", slot_source="user")),
        day("2026-09-02", food("Banana", "Pre-Workout", "2026-09-02T15:10:00-04:00",
                               moved_from="Snacks", slot_source="user")),
    ]
    correction = slot_corrections(entries)[0]
    assert (correction["from_slot"], correction["to_slot"]) == ("snack", "pre_workout")
    assert correction["count"] == 2
    assert correction["foods"] == ["Banana"]


def test_a_food_moved_back_where_it_started_is_not_a_correction():
    # `moved_from` is cleared on the way back, so this is what a returned row
    # looks like. Nothing to learn from a drag that was undone.
    entries = [day("2026-09-01", food("Banana", "Snacks", "2026-09-01T15:00:00-04:00"))]
    assert slot_corrections(entries) == []


def test_a_move_within_one_slot_is_not_a_correction():
    # "Shake" and "Pre-Workout" are the same blueprint slot.
    entries = [
        day("2026-09-01", food("Shake", "Pre-Workout", "2026-09-01T15:00:00-04:00",
                               moved_from="Shake", slot_source="user"))
    ]
    assert slot_corrections(entries) == []


def test_corrections_are_counted_without_any_timestamps():
    # Timing and slot corrections are independent: an untimed row still says
    # the app filed it wrong.
    entries = [day("2026-09-01", food("Banana", "Pre-Workout", moved_from="Snacks"))]
    assert slot_corrections(entries)[0]["count"] == 1
