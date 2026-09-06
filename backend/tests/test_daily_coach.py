from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo
import daily_coach as coach
from models import DailyRoutine

NOW = datetime(2026, 9, 7, 8, tzinfo=ZoneInfo("America/New_York"))


def data():
    return {
        "profile": {"nutrition_targets": {"calories": 2000, "water": 8}},
        "nutrition_plan": {"targets": {"calories": 2350, "protein": 150}, "meal_anchors": [
            {"label": "Shake and oatmeal", "slot": "breakfast", "days": ["mon"]},
            {"label": "Weekend eggs", "slot": "breakfast", "frequency": "weekends"}]},
        "workout_plan": {"weekly_schedule": {"monday": "Pull"}, "days": [
            {"day_name": "Pull", "exercises": [{"exercise_name": "Row", "sets": 3, "reps": 10}]}]},
        "macros": [{"date": "2026-09-06", "total_calories": 1800, "total_protein": 100},
                   {"date": "2026-09-07", "food_items": [{"name": "Yogurt", "calories": 150, "protein": 20}]}],
        "routines": [{"name": "Office", "scheduled_days": ["mon"], "completed_dates": []}]}


def test_monday_connects_actual_plan_targets_food_and_routine():
    context = coach.build_context(data(), NOW)
    assert context["workout"]["day_name"] == "Pull"
    assert context["workout"]["exercises"][0]["sets"] == 3
    assert [m["label"] for m in context["meals"]] == ["Shake and oatmeal"]
    assert context["targets"] == {"calories": 2350, "protein": 150, "water": 8}
    assert context["totals"]["2026-09-07"]["calories"] == 150
    assert context["routines"][0]["basis"] == "scheduled"
    assert context["yesterday_date"] == "2026-09-06"


def test_no_logs_are_unknown_and_not_zero_or_a_missed_workout():
    context = coach.build_context({}, NOW, ["sleep"])
    assert context["totals"]["2026-09-07"] == {"calories": None, "protein": None, "water": None}
    assert context["workout"]["status"] == "no_plan"
    assert context["unavailable"] == ["sleep"]
    assert "incomplete" in coach.fallback_brief(context)["yesterday"]


def test_completed_workout_is_not_prescribed_again():
    rows = data()
    rows["workout_sessions"] = [{"date": "2026-09-07", "split_day": "Pull"}]
    context = coach.build_context(rows, NOW)
    assert context["workout"]["completed"]
    assert "already logged" in coach.fallback_brief(context)["summary"]
    rows["workout_sessions"][0]["split_day"] = "Push"
    assert not coach.build_context(rows, NOW)["workout"]["completed"]


def test_one_routine_log_is_not_a_habit_and_other_day_schedule_wins():
    rows = data()
    routine = {"name": "Office", "completed_dates": ["2026-08-31", "2026-08-31"]}
    rows["routines"] = [routine]
    assert coach.build_context(rows, NOW)["routines"][0]["basis"] == "unscheduled"
    routine["completed_dates"].append("2026-08-24")
    assert coach.build_context(rows, NOW)["routines"][0]["basis"] == "pattern"
    routine["scheduled_days"] = ["tue"]
    assert coach.build_context(rows, NOW)["routines"][0]["basis"] == "unscheduled"


def test_weekday_food_habits_count_distinct_past_days_only():
    rows = {"macros": [{"date": d, "food_items": [{"name": "Shake"}, {"name": "Shake"}]} for d in
                       ("2026-08-31", "2026-08-24", "2026-09-07", "2026-09-08")]}
    assert coach.build_context(rows, NOW)["usual_foods_this_weekday"] == [{"name": "Shake", "days_logged": 2}]


def test_rest_day_and_unscheduled_are_distinct():
    rows = data()
    rows["workout_plan"]["weekly_schedule"]["monday"] = "Rest"
    assert coach.build_context(rows, NOW)["workout"]["status"] == "rest"
    rows["workout_plan"]["weekly_schedule"] = {}
    assert coach.build_context(rows, NOW)["workout"]["status"] == "unscheduled"


def test_no_key_has_useful_fallback_without_changing_targets(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    context = coach.build_context(data(), NOW)
    result = coach.generate_brief(context)
    assert result["source"] == "rules"
    assert "Pull" in result["summary"]
    assert "normal targets" in result["yesterday"]
    assert context["targets"]["calories"] == 2350


def test_invalid_ai_output_falls_back(monkeypatch):
    import openai
    monkeypatch.setenv("OPENAI_API_KEY", "test-placeholder")
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **kw:
        SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"summary":"Made up","priorities":[{"action":"delete"}]}'))]))))
    monkeypatch.setattr(openai, "OpenAI", lambda **kw: client)
    assert coach.generate_brief(coach.build_context(data(), NOW))["source"] == "rules"


def test_cache_invalidates_when_logs_change_and_is_scoped_to_user(monkeypatch):
    storage = {}
    class Ref:
        def __init__(self, path=""): self.path = path
        def collection(self, key): return Ref(self.path + "/" + key)
        def document(self, key): return Ref(self.path + "/" + key)
        def get(self): return SimpleNamespace(to_dict=lambda: storage.get(self.path))
        def set(self, value): storage[self.path] = value
    context = coach.build_context(data(), NOW)
    calls = []
    monkeypatch.setattr(coach, "load_context", lambda *a: context)
    monkeypatch.setattr(coach, "generate_brief", lambda ctx: calls.append(1) or coach.fallback_brief(ctx))
    db = Ref()
    coach.get_brief(db, "a", NOW)
    assert coach.get_brief(db, "a", NOW)["cached"]
    assert len(calls) == 1
    context["totals"]["2026-09-07"]["water"] = 2
    assert not coach.get_brief(db, "a", NOW)["cached"]
    coach.get_brief(db, "b", NOW)
    assert len(calls) == 3


def test_routine_schedule_roundtrips():
    routine = DailyRoutine(name="Office", scheduled_days=["mon", "wed"])
    assert routine.model_dump()["scheduled_days"] == ["mon", "wed"]
