"""Low-cost operational metrics for the per-set recommendation path."""

from datetime import datetime, timezone
from typing import Any, Dict

from firebase_admin import firestore


def record_recommendation_metrics(db, user_id: str, result: Dict[str, Any], latency_ms: int) -> None:
    """Best-effort atomic counters; metrics must never break a workout."""
    try:
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        ref = (
            db.collection("users").document(user_id)
            .collection("workout_recommendation_metrics").document(day)
        )
        source = result.get("source") or "unknown"
        ref.set({
            "date": day,
            "calls": firestore.Increment(1),
            "tokens": firestore.Increment(int(result.get("tokens_used") or 0)),
            "fallbacks": firestore.Increment(1 if source == "deterministic_fallback" else 0),
            "latency_total_ms": firestore.Increment(max(0, int(latency_ms))),
            "last_source": source,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, merge=True)
    except Exception:
        pass


def summarize_recommendation_metrics(documents) -> Dict[str, Any]:
    rows = [doc.to_dict() for doc in documents]
    calls = sum(int(row.get("calls") or 0) for row in rows)
    tokens = sum(int(row.get("tokens") or 0) for row in rows)
    fallbacks = sum(int(row.get("fallbacks") or 0) for row in rows)
    rejections = sum(int(row.get("rejections") or 0) for row in rows)
    outcomes = sum(int(row.get("outcomes") or 0) for row in rows)
    missed_targets = sum(int(row.get("missed_targets") or 0) for row in rows)
    failed_sets = sum(int(row.get("failed_sets") or 0) for row in rows)
    manual_changes = sum(int(row.get("manual_changes") or 0) for row in rows)
    latency = sum(int(row.get("latency_total_ms") or 0) for row in rows)
    return {
        "days": len(rows),
        "calls": calls,
        "tokens": tokens,
        "fallbacks": fallbacks,
        "rejections": rejections,
        "outcomes": outcomes,
        "missed_targets": missed_targets,
        "failed_sets": failed_sets,
        "manual_changes": manual_changes,
        "fallback_rate": round(fallbacks / calls, 4) if calls else 0,
        "rejection_rate": round(rejections / calls, 4) if calls else 0,
        "miss_rate": round(missed_targets / outcomes, 4) if outcomes else 0,
        "average_latency_ms": round(latency / calls) if calls else 0,
    }
