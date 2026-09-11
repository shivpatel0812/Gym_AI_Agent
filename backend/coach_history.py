"""Compact, deterministic history shared by the daily report context.

Long-term aggregates are cached daily; the last seven completed days are read
fresh. No AI call is needed to assemble either layer.
"""
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import math

from field_aliases import normalize_records

METRICS = {
    "macros": ("total_calories", "total_protein", "total_carbs", "total_fats", "total_fiber", "total_sugar", "total_sodium"),
    "hydration": ("amount_cups",), "sleep": ("hours_slept", "quality"),
    "stress": ("level",), "wellness_survey": ("fatigue", "body_aches", "energy", "mood"),
    "physical_activities": ("steps", "duration_minutes"),
    "workout_sessions": ("duration_minutes",), "weigh_ins": ("weight_lb",),
    "body_feelings": (),
}
SUM_DAILY = {"macros", "hydration", "physical_activities", "workout_sessions"}


def finite(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None


def summarize_source(name, rows):
    rows = sorted(normalize_records(name, rows), key=lambda r: str(r.get("date") or ""))
    dated = [r for r in rows if len(str(r.get("date") or "")) >= 10]
    result = {"records": len(dated), "days_logged": len({str(r["date"])[:10] for r in dated}),
              "first_date": str(dated[0]["date"])[:10] if dated else None,
              "last_date": str(dated[-1]["date"])[:10] if dated else None, "metrics": {}}
    for key in METRICS[name]:
        by_day = defaultdict(list)
        for row in dated:
            value = finite(row.get(key))
            if value is None and name == "macros":
                foods = [finite(f.get(key.removeprefix("total_"))) for f in row.get("food_items") or []]
                known = [f for f in foods if f is not None]
                value = sum(known) if known else None
            if value is not None:
                by_day[str(row["date"])[:10]].append(value)
        values = [sum(v) if name in SUM_DAILY else sum(v) / len(v) for v in by_day.values()]
        if values:
            result["metrics"][key] = {"average_per_logged_day": round(sum(values) / len(values), 2),
                                      "days_with_value": len(values), "first": round(values[0], 2), "latest": round(values[-1], 2)}
    notes = []
    for row in dated:
        for key in ("description", "notes"):
            if isinstance(row.get(key), str) and row[key].strip():
                notes.append({"date": str(row["date"])[:10], "text": row[key][:300]})
    if notes:
        result["recent_notes"] = notes[-3:]
    if name == "workout_sessions":
        result["sessions_by_day_name"] = dict(Counter(str(r.get("split_day") or r.get("split_name") or "Unnamed") for r in dated).most_common(10))
        result["recent_exercises"] = [{"date": str(r["date"])[:10], "day": r.get("split_day"),
            "exercises": [{k: e[k] for k in ("exercise_name", "name", "sets", "reps", "weight") if k in e}
                          for e in (r.get("exercises") or [])[:6]]} for r in dated[-3:]]
    if name == "macros":
        foods = defaultdict(set)
        for row in dated:
            for food in row.get("food_items") or []:
                if food.get("name"):
                    foods[str(food["name"])].add(str(row["date"])[:10])
        result["frequent_foods"] = [{"name": n, "days_logged": len(d)} for n, d in sorted(foods.items(), key=lambda p: (-len(p[1]), p[0]))[:10]]
    return result


def summarize_window(data, start, end, unavailable=()):
    return {"start": start, "end": end, "averages_use_logged_days_only": True,
            "sources": {name: {"status": "unavailable"} if name in unavailable else
                        {"status": "available", **summarize_source(name, [r for r in data.get(name, [])
                         if (start is None or str(r.get("date") or "")[:10] >= start) and str(r.get("date") or "")[:10] <= end])}
                        for name in METRICS}}


def load_history(user, now, refresh=False):
    """All available dated history before the recent week, not a 28-day cutoff."""
    end = (now.date() - timedelta(days=8)).isoformat()
    ref = user.collection("coach_context").document("history")
    try:
        saved = ref.get().to_dict() or {}
        if not refresh and saved.get("end") == end and saved.get("schema_version") == 2:
            return saved
    except Exception:
        pass
    data, unavailable = {}, []
    def read(name):
        return [d.to_dict() or {} for d in user.collection(name).where("date", "<", (now.date() - timedelta(days=7)).isoformat()).stream()]
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {name: pool.submit(read, name) for name in METRICS}
        for name, future in jobs.items():
            try:
                data[name] = future.result()
            except Exception:
                unavailable.append(name)
    history = {**summarize_window(data, None, end, unavailable), "schema_version": 2,
               "rebuilt_on": now.date().isoformat(), "unavailable": unavailable}
    if not unavailable:
        try:
            ref.set(history)
        except Exception:
            pass
    return history
