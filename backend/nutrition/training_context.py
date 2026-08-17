"""Compact view of the active training plan for nutrition generation and chat."""

from typing import Any, Dict, Optional


def load_training_context(db, user_id: str) -> Dict[str, Any]:
    """Active workout/training plan, trimmed for nutrition prompts."""
    try:
        from ai_analysis.plan_store import PlanStore

        plan = PlanStore(db, user_id).get_active()
    except Exception as e:
        print(f"Warning: could not load training plan for nutrition: {e}")
        return {"has_plan": False}

    if not plan:
        return {"has_plan": False}

    days = []
    for day in plan.get("days") or []:
        exercises = []
        for ex in day.get("exercises") or []:
            name = ex.get("exercise_name") or ex.get("name")
            if name:
                exercises.append(name)
        days.append({
            "name": day.get("day_name"),
            "focus": day.get("focus"),
            "exercises": exercises[:8],
        })

    return {
        "has_plan": True,
        "plan_name": plan.get("plan_name"),
        "primary_goal": plan.get("primary_goal"),
        "duration_weeks": plan.get("duration_weeks"),
        "days": days,
    }


def conversation_notes(messages: Optional[list], limit: int = 16) -> str:
    """Flatten recent chat turns so nutrition generation can use the interview."""
    lines = []
    for message in (messages or [])[-limit:]:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        content = (message.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        lines.append(f"{role}: {content}")
    return "\n".join(lines)
