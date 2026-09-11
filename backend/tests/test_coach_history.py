from datetime import datetime
from zoneinfo import ZoneInfo
from coach_history import summarize_source, summarize_window, load_history
from daily_coach import build_context


def test_averages_sum_same_day_but_do_not_count_missing_days_as_zero():
    report = summarize_source("hydration", [{"date": "2026-09-01", "amount_cups": 2},
        {"date": "2026-09-01", "amount_cups": 4}, {"date": "2026-09-03", "amount_cups": 8}])
    assert report["metrics"]["amount_cups"]["average_per_logged_day"] == 7
    assert report["days_logged"] == 2


def test_legacy_wellness_fields_and_missing_numbers():
    report = summarize_source("wellness_survey", [{"date": "2026-09-01", "fatigue_level": 8}, {"date": "2026-09-02"}])
    assert report["metrics"]["fatigue"]["average_per_logged_day"] == 8
    assert report["metrics"]["fatigue"]["days_with_value"] == 1


def test_previous_week_excludes_today_and_older_history_has_no_28_day_cutoff():
    now = datetime(2026, 9, 7, tzinfo=ZoneInfo("America/New_York"))
    context = build_context({"sleep": [{"date": "2025-01-01", "hours_slept": 6},
        {"date": "2026-08-31", "hours_slept": 7}, {"date": "2026-09-06", "hours_slept": 9},
        {"date": "2026-09-07", "hours_slept": 4}]}, now)
    week = context["previous_week"]
    assert week["start"] == "2026-08-31"
    assert week["end"] == "2026-09-06"
    assert week["sources"]["sleep"]["metrics"]["hours_slept"]["average_per_logged_day"] == 8
    assert context["history"]["sources"]["sleep"]["first_date"] == "2025-01-01"
    assert context["days"]["2026-09-07"]["sleep"][0]["hours_slept"] == 4


def test_failed_read_is_distinct_from_no_logs():
    report = summarize_window({}, "2026-08-31", "2026-09-06", ["sleep"])
    assert report["sources"]["sleep"] == {"status": "unavailable"}
    assert report["sources"]["hydration"]["days_logged"] == 0


def test_chat_context_uses_user_statements_not_old_assistant_claims():
    context = build_context({"conversations": [{"messages": [
        {"role": "assistant", "content": "Invented office schedule"},
        {"role": "user", "content": "I go to the office on Mondays"}]}]}, datetime(2026, 9, 7))
    assert len(context["recent_user_statements"]) == 1
    assert context["recent_user_statements"][0]["text"] == "I go to the office on Mondays"


def test_all_nine_log_sources_are_represented():
    report = summarize_window({}, None, "2026-09-06")
    assert set(report["sources"]) == {"sleep", "stress", "wellness_survey", "body_feelings", "macros", "hydration", "physical_activities", "workout_sessions", "weigh_ins"}


def test_sugar_sodium_and_fiber_use_food_values_when_daily_total_missing():
    report = summarize_source("macros", [{"date": "2026-09-01", "food_items": [
        {"sugar": 5, "sodium": 250, "fiber": 2}, {"sugar": 3, "sodium": 100, "fiber": 4}]}])
    assert report["metrics"]["total_sugar"]["average_per_logged_day"] == 8
    assert report["metrics"]["total_sodium"]["average_per_logged_day"] == 350
    assert report["metrics"]["total_fiber"]["average_per_logged_day"] == 6


def test_history_is_cached_daily_and_manual_refresh_rebuilds():
    from types import SimpleNamespace
    storage, reads = {}, []
    class Ref:
        def __init__(self, path=""): self.path = path
        def collection(self, key): return Ref(self.path + "/" + key)
        def document(self, key): return Ref(self.path + "/" + key)
        def get(self): return SimpleNamespace(to_dict=lambda: storage.get(self.path))
        def set(self, value): storage[self.path] = value
        def where(self, *args): return self
        def stream(self):
            reads.append(self.path)
            return []
    now = datetime(2026, 9, 7)
    load_history(Ref(), now)
    assert len(reads) == 9
    load_history(Ref(), now)
    assert len(reads) == 9
    load_history(Ref(), now, refresh=True)
    assert len(reads) == 18
