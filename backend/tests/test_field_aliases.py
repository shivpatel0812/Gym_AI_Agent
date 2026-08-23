"""
Regression tests for the web/mobile field-name divergence.

The web app wrote `fatigue_level` / `aches_level` / `energy_level` /
`stress_level` where the backend models use `fatigue` / `body_aches` /
`energy` / `level`. Because `numeric_values` drops records missing a key,
those entries did not error — they read as "never logged", so every recovery
and lifestyle summary silently ignored data the user had actually entered.
"""

from datetime import datetime, timedelta

from field_aliases import normalize_record, normalize_records


# --- unit -----------------------------------------------------------------

def test_legacy_field_fills_in_canonical():
    row = normalize_record("wellness_survey", {"fatigue_level": 7, "aches_level": 2})
    assert row["fatigue"] == 7
    assert row["body_aches"] == 2


def test_canonical_value_wins_over_legacy():
    # A document written after the clients converged is already correct; a
    # stale duplicate left over from an edit must not overwrite it.
    row = normalize_record("wellness_survey", {"fatigue": 3, "fatigue_level": 9})
    assert row["fatigue"] == 3


def test_zero_is_data_not_missing():
    # A logged fatigue of 0 is a real answer. Truthiness checks would drop it.
    row = normalize_record("wellness_survey", {"fatigue_level": 0})
    assert row["fatigue"] == 0


def test_aliases_are_scoped_per_collection():
    # `level` is only the right target for `stress_level` inside stress.
    assert normalize_record("stress", {"stress_level": 6})["level"] == 6
    assert "level" not in normalize_record("wellness_survey", {"stress_level": 6})


def test_unaliased_collection_passes_through_untouched():
    row = {"hours_slept": 7.5, "quality": 8}
    assert normalize_record("sleep", row) == row
    assert normalize_records("sleep", [row]) == [row]


def test_normalize_does_not_mutate_the_input():
    original = {"fatigue_level": 4}
    normalize_record("wellness_survey", original)
    assert original == {"fatigue_level": 4}


# --- integration through the analyzer -------------------------------------

class _Doc:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None
        self.id = "doc"

    def to_dict(self):
        return self._data


class _CollectionDb:
    """Firestore stand-in that returns different rows per collection."""

    def __init__(self, by_collection):
        self.by_collection = by_collection
        self._current = None
        self._filters = []

    def collection(self, name):
        self._current = name
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
        return _Doc(None)


def _recent_dates(n):
    today = datetime.now()
    return [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n)]


def test_web_written_wellness_reaches_the_recovery_summary():
    from ai_analysis.data_analyzer import FitnessDataAnalyzer

    dates = _recent_dates(4)
    db = _CollectionDb({
        "wellness_survey": [
            {"date": d, "fatigue_level": 8, "aches_level": 6, "energy_level": 3}
            for d in dates
        ],
    })

    summary = FitnessDataAnalyzer(db, "u1").build_rolling_summary(window_days=28)
    recovery = summary["recovery"]

    # Before the fix these were all None — indistinguishable from "not logged".
    assert recovery["days_wellness_logged"] == 4
    assert recovery["avg_fatigue"] == 8
    assert recovery["avg_body_aches"] == 6
    assert recovery["avg_energy"] == 3


def test_web_written_stress_reaches_the_lifestyle_summary():
    from ai_analysis.data_analyzer import FitnessDataAnalyzer

    dates = _recent_dates(3)
    db = _CollectionDb({
        "stress": [{"date": d, "stress_level": 8} for d in dates],
    })

    lifestyle = FitnessDataAnalyzer(db, "u1").build_rolling_summary(window_days=28)["lifestyle"]

    assert lifestyle["days_stress_logged"] == 3
    assert lifestyle["avg_stress"] == 8
    assert lifestyle["high_stress_days"] == 3


def test_mixed_old_and_new_documents_are_both_counted():
    # The realistic state of a real account: logged on web before the fix,
    # on mobile after it.
    from ai_analysis.data_analyzer import FitnessDataAnalyzer

    d1, d2 = _recent_dates(2)
    db = _CollectionDb({
        "wellness_survey": [
            {"date": d1, "fatigue_level": 8},   # old web write
            {"date": d2, "fatigue": 2},          # mobile / post-fix write
        ],
    })

    recovery = FitnessDataAnalyzer(db, "u1").build_rolling_summary(window_days=28)["recovery"]

    assert recovery["days_wellness_logged"] == 2
    assert recovery["avg_fatigue"] == 5  # (8 + 2) / 2


def test_coach_wellness_tool_sees_legacy_documents():
    from ai_analysis.coach_tools import CoachToolbox

    d = _recent_dates(1)[0]
    db = _CollectionDb({
        "wellness_survey": [{"date": d, "fatigue_level": 9, "aches_level": 4}],
        "stress": [{"date": d, "stress_level": 7}],
        "sleep": [{"date": d, "hours_slept": 5.5, "quality": 4}],
    })

    log = CoachToolbox(db, "u1").get_wellness_log(days=7)

    assert log["wellness"][0]["fatigue"] == 9
    assert log["wellness"][0]["body_aches"] == 4
    assert log["stress"][0]["level"] == 7
    assert log["sleep"][0]["hours"] == 5.5
