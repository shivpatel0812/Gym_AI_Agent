"""
Sleep baselines and the confidence gate.

The rule under test: a personal sleep target is inferred from the user's own
logged nights, and when too few nights are logged the metric is *cancelled* —
no target, no deviation, no confidence — rather than falling back to a
population default. A fabricated target produces a confident deviation, and a
confident deviation is what the lever and readiness layers act on.
"""

from datetime import datetime, timedelta

import pytest

from metrics import compute_baseline, read_metric
from metrics.baseline import (
    FULL_CONFIDENCE_SAMPLES,
    MIN_SAMPLES,
    STATUS_INSUFFICIENT,
    STATUS_NO_DATA,
    STATUS_OK,
)


# --- the gate -------------------------------------------------------------

def test_no_history_is_cancelled():
    b = compute_baseline("sleep_hours", [])
    assert b.status == STATUS_NO_DATA
    assert b.target is None
    assert b.confidence == 0.0
    assert not b.usable


@pytest.mark.parametrize("n", range(1, MIN_SAMPLES))
def test_below_the_sample_floor_is_cancelled(n):
    b = compute_baseline("sleep_hours", [7.0] * n)
    assert b.status == STATUS_INSUFFICIENT
    assert b.target is None
    assert not b.usable
    # The count is still reported, so a UI can say how close the user is.
    assert b.samples == n


def test_at_the_floor_a_baseline_exists():
    b = compute_baseline("sleep_hours", [7.0] * MIN_SAMPLES)
    assert b.status == STATUS_OK
    assert b.usable
    assert b.target == 7.0
    assert b.source == "inferred"


def test_confidence_ramps_with_evidence():
    thin = compute_baseline("sleep_hours", [7.0] * MIN_SAMPLES)
    thick = compute_baseline("sleep_hours", [7.0] * FULL_CONFIDENCE_SAMPLES)
    assert thin.confidence < thick.confidence
    assert thick.confidence == 1.0


# --- the statistic --------------------------------------------------------

def test_baseline_is_a_median_so_one_bad_night_does_not_move_it():
    # Six normal nights and one all-nighter. A mean would read 6.6h and
    # quietly lower the target the user is measured against.
    nights = [8.0, 8.0, 7.5, 8.0, 7.5, 8.0, 0.5]
    b = compute_baseline("sleep_hours", nights)
    assert b.target == 8.0


def test_booleans_are_not_measurements():
    b = compute_baseline("sleep_hours", [7.0, True, 8.0, False, 7.5, 8.0, 7.0])
    assert b.samples == 5


# --- declared targets -----------------------------------------------------

def test_declared_goal_beats_inference():
    b = compute_baseline("sleep_hours", [6.0] * 20, declared_target=8.0)
    assert b.target == 8.0
    assert b.source == "declared"
    assert b.confidence == 1.0


def test_declared_goal_survives_having_no_history():
    # It did not need history to be true.
    b = compute_baseline("sleep_hours", [], declared_target=7.5)
    assert b.usable
    assert b.target == 7.5


# --- readings -------------------------------------------------------------

def test_deviation_is_signed_and_normalized():
    b = compute_baseline("sleep_hours", [8.0] * 14)
    assert read_metric("sleep_hours", 6.0, b).deviation == -0.25
    assert read_metric("sleep_hours", 10.0, b).deviation == 0.25
    assert read_metric("sleep_hours", 8.0, b).deviation == 0.0


def test_cancelled_baseline_cancels_the_reading():
    b = compute_baseline("sleep_hours", [7.0, 7.0])  # under the floor
    reading = read_metric("sleep_hours", 4.0, b)
    # A 4-hour night is dramatic, and we still say nothing about it.
    assert reading.deviation is None
    assert reading.confidence == 0.0
    assert not reading.usable
    assert reading.status == STATUS_INSUFFICIENT


def test_reading_carries_the_baseline_confidence():
    b = compute_baseline("sleep_hours", [8.0] * FULL_CONFIDENCE_SAMPLES)
    assert read_metric("sleep_hours", 7.0, b).confidence == 1.0


def test_missing_value_with_a_good_baseline_is_still_no_reading():
    b = compute_baseline("sleep_hours", [8.0] * 14)
    assert read_metric("sleep_hours", None, b).deviation is None


# --- through the recovery digest ------------------------------------------

class _Doc:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None
        self.id = "doc"

    def to_dict(self):
        return self._data


class _Db:
    def __init__(self, by_collection, profile=None):
        self.by_collection = by_collection
        self.profile = profile
        self._current = None
        self._filters = []
        self._is_profile = False

    def collection(self, name):
        self._current = name
        if name == "user_profile":
            self._is_profile = True
        return self

    def document(self, name):
        return self

    def where(self, field, op, value):
        self._filters.append((field, op, value))
        return self

    def stream(self):
        filters, self._filters = self._filters, []
        rows = self.by_collection.get(self._current, [])
        for field, op, value in filters:
            if field == "date" and op == ">=":
                rows = [r for r in rows if r["date"] >= value]
            if field == "date" and op == "<=":
                rows = [r for r in rows if r["date"] <= value]
        return [_Doc(r) for r in rows]

    def get(self):
        is_profile, self._is_profile = self._is_profile, False
        return _Doc(self.profile if is_profile else None)


def _nights(hours_list):
    today = datetime.now()
    return [
        {"date": (today - timedelta(days=i)).strftime("%Y-%m-%d"), "hours_slept": h}
        for i, h in enumerate(hours_list)
    ]


def test_recovery_digest_reports_an_inferred_target():
    from ai_analysis.data_analyzer import FitnessDataAnalyzer

    db = _Db({"sleep": _nights([7.5, 7.0, 7.5, 8.0, 7.5, 7.0, 7.5])})
    recovery = FitnessDataAnalyzer(db, "u1").build_rolling_summary(window_days=28)["recovery"]

    assert recovery["sleep_baseline"]["status"] == "ok"
    assert recovery["sleep_baseline"]["target"] == 7.5
    assert recovery["sleep_baseline"]["source"] == "inferred"


def test_recovery_digest_cancels_sleep_on_thin_data():
    from ai_analysis.data_analyzer import FitnessDataAnalyzer

    db = _Db({"sleep": _nights([7.5, 6.0])})
    recovery = FitnessDataAnalyzer(db, "u1").build_rolling_summary(window_days=28)["recovery"]

    assert recovery["sleep_baseline"]["status"] == "insufficient_data"
    assert recovery["sleep_baseline"]["target"] is None
    # The observed average is still reported — it is an observation, not a
    # target, and the coach may legitimately mention it.
    assert recovery["avg_sleep_hours"] == 6.8


def test_recovery_digest_prefers_a_declared_goal():
    from ai_analysis.data_analyzer import FitnessDataAnalyzer

    db = _Db({"sleep": _nights([6.0] * 10)}, profile={"sleep_goal": 8.0})
    recovery = FitnessDataAnalyzer(db, "u1").build_rolling_summary(window_days=28)["recovery"]

    assert recovery["sleep_baseline"]["target"] == 8.0
    assert recovery["sleep_baseline"]["source"] == "declared"


# --- through the coach prompt ---------------------------------------------

def test_coach_prompt_mentions_a_usable_baseline():
    from ai_analysis.ai_coach import FitnessAICoach

    # A syntactically valid key: the client is constructed but never called.
    coach = FitnessAICoach(api_key="sk-test", user_profile={})
    context = coach._build_chatbot_context({
        "recovery": {
            "avg_sleep_hours": 6.2,
            "sleep_baseline": {"status": "ok", "target": 7.5, "confidence": 1.0},
        }
    })
    assert "usual ~7.5h" in context


def test_coach_prompt_stays_silent_about_a_cancelled_baseline():
    from ai_analysis.ai_coach import FitnessAICoach

    # A syntactically valid key: the client is constructed but never called.
    coach = FitnessAICoach(api_key="sk-test", user_profile={})
    context = coach._build_chatbot_context({
        "recovery": {
            "avg_sleep_hours": 6.2,
            "sleep_baseline": {"status": "insufficient_data", "target": None},
        }
    })
    assert "usual" not in context
    assert "6.2h sleep" in context
