"""
Goals and the meal-photo archive.

The recurring risk in both: reporting a number as what the user did when it is
actually what a model guessed, or turning two data points into a verdict.
"""

import pytest

from progress.goals import GoalStore, current_value, evaluate
from progress.photo_hub import build_photo_hub, correction_bias, summarize_log
from progress.weeks import week_axis
from datetime import date

AXIS = week_axis(date(2026, 9, 5), 12)

HUB = {
    "index": {"level": 106.0},
    "domains": [
        {"key": "strength", "detail": {"positions": [{"exercise_id": "bench", "peak_e1rm": 209.0}]}},
        {"key": "body", "detail": {"latest_weight_lb": 189.0}},
        {"key": "consistency", "detail": {"sessions_last_week": 3}},
    ],
}


def goal(**over):
    base = {
        "kind": "exercise_e1rm",
        "exercise_id": "bench",
        "target_value": 230,
        "start_value": 190,
        "start_date": "2026-07-01",
        "target_date": "2026-11-01",
    }
    return {**base, **over}


class TestGoalHonesty:
    def test_progress_is_measured_from_the_start_value_not_zero(self):
        """Otherwise someone with a 415 squat setting a 450 goal reads as 92%
        done before they train once."""
        out = evaluate(goal(), HUB, "2026-09-05")
        assert out["progress_pct"] == pytest.approx(47.5, abs=1)

    def test_too_early_refuses_a_verdict(self):
        """Two weeks in, the observed rate is a couple of points; a confident
        verdict from it is noise wearing a number."""
        out = evaluate(goal(start_date="2026-08-30"), HUB, "2026-09-05")
        assert out["on_track"] is None
        assert "too early" in out["note"].lower()

    def test_a_metric_with_no_data_says_so(self):
        out = evaluate(goal(exercise_id="deadlift"), HUB, "2026-09-05")
        assert out["on_track"] is None
        assert out["current_value"] is None

    def test_a_downward_goal_is_scored_in_its_own_direction(self):
        """A cut's target is below its start. Comparing rates by absolute size
        would call every successful cut 'behind'."""
        cut = {
            "kind": "bodyweight",
            "target_value": 180,
            "start_value": 205,
            "start_date": "2026-06-15",
            "target_date": "2026-11-01",
        }
        out = evaluate(cut, HUB, "2026-09-05")
        assert out["on_track"] is True
        assert out["progress_pct"] == pytest.approx(64.0, abs=1)

    def test_a_deadline_too_close_is_behind(self):
        cut = {
            "kind": "bodyweight",
            "target_value": 180,
            "start_value": 205,
            "start_date": "2026-06-15",
            "target_date": "2026-09-20",
        }
        assert evaluate(cut, HUB, "2026-09-05")["on_track"] is False

    def test_reaching_the_target_is_achieved_regardless_of_date(self):
        out = evaluate(goal(target_value=200), HUB, "2026-09-05")
        assert out["status"] == "achieved"

    def test_no_target_date_means_no_pace_to_be_behind(self):
        out = evaluate(goal(target_date=None), HUB, "2026-09-05")
        assert out["on_track"] is None
        assert "no pace" in out["note"]

    def test_lift_goals_read_the_peak_not_the_latest(self):
        """A goal must not un-achieve itself because of one bad session."""
        assert current_value(goal(), HUB) == 209.0


class TestGoalStore:
    class FakeDb:
        def __init__(self):
            self.written = {}
            self._id = 0

        def collection(self, _n):
            return self

        def document(self, name=None):
            self._doc = name or f"g{self._id}"
            self._id += 1
            return self

        @property
        def id(self):
            return self._doc

        def set(self, payload, merge=False):
            self.written[self._doc] = payload

        def limit(self, _n):
            return self

        def stream(self):
            return []

    def test_the_start_value_is_stamped_at_creation(self):
        """Recomputing it later from a sliding window would let '40% there'
        change without the user doing anything."""
        db = self.FakeDb()
        created = GoalStore(db, "u1").create(
            {"kind": "exercise_e1rm", "exercise_id": "bench", "target_value": 250}, HUB
        )
        assert created["start_value"] == 209.0

    def test_an_unknown_kind_is_rejected(self):
        with pytest.raises(ValueError):
            GoalStore(self.FakeDb(), "u1").create({"kind": "vibes", "target_value": 1}, HUB)


def photo(i, initial, accepted, turns=0, image=True):
    return {
        "id": f"p{i}",
        "created_at": f"2026-08-{10 + i:02d}T12:00:00",
        "has_image": image,
        "chat_turn_count": turns,
        "initial_estimate": {"name": "Khichdi", "calories": initial},
        "accepted_estimate": {"name": "Khichdi", "calories": accepted, "protein": 30}
        if accepted
        else None,
    }


class TestPhotoArchive:
    def test_images_never_ride_along_in_the_list(self):
        """They are base64 JPEGs in the document — sixty of them is a
        multi-megabyte response to draw thumbnails."""
        row = summarize_log({**photo(0, 500, 560), "image_base64": "AAAA"})
        assert "image_base64" not in row
        assert row["has_image"] is True

    def test_only_accepted_macros_count_as_what_was_eaten(self):
        """`initial_estimate` is what the model guessed; it is not evidence
        the user agreed."""
        row = summarize_log(photo(0, 500, None))
        assert row["logged"] is None
        assert row["first_guess_calories"] == 500

    def test_unlabelled_photos_cannot_flatter_the_bias(self):
        """Folding an unlabelled row in at its estimated value would make the
        model look perfectly calibrated against itself."""
        rows = [summarize_log(photo(i, 500, None)) for i in range(8)]
        assert correction_bias(rows)["measurable"] is False

    def test_a_consistent_lean_is_reported_with_its_direction(self):
        rows = [summarize_log(photo(i, 500, 575)) for i in range(8)]
        bias = correction_bias(rows)
        assert bias["measurable"] is True
        assert bias["direction"] == "low"
        assert bias["median_correction_pct"] == pytest.approx(15.0, abs=0.5)

    def test_thin_history_asks_for_more_rather_than_guessing(self):
        rows = [summarize_log(photo(i, 500, 575)) for i in range(2)]
        assert correction_bias(rows)["measurable"] is False
        assert "more corrected photos" in correction_bias(rows)["reason"]

    def test_tiny_corrections_are_not_a_disagreement(self):
        rows = [summarize_log(photo(i, 500, 505)) for i in range(8)]
        assert correction_bias(rows)["direction"] == "about right"

    def test_the_hub_separates_labelled_from_unlabelled(self):
        logs = [photo(i, 500, 560 if i % 2 else None) for i in range(8)]
        hub = build_photo_hub(logs, AXIS)
        assert hub["labelled"] + hub["unlabelled"] == hub["in_range"]
        assert hub["labelled"] == 4
