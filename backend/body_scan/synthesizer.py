"""
Deterministic synthesis: scan observations + structured goal + training history
→ emphasis deltas. LLM only explains the why afterward.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from nutrition.gpt_fallback import get_openai_client
from ai_models import resolve_model, completion_kwargs
from .schemas import EMPHASIS_GROUPS, normalize_synthesis


REGION_TO_EMPHASIS = {
    "chest": ["chest", "upper_push"],
    "back": ["back", "upper_pull"],
    "shoulders": ["shoulders", "upper_push"],
    "arms": ["arms"],
    "legs": ["legs"],
    "glutes": ["glutes", "legs"],
    "core": ["core"],
}

GOAL_AREA_ALIASES = {
    "shoulder": "shoulders",
    "shoulders": "shoulders",
    "delts": "shoulders",
    "rear_delts": "rear_delts",
    "chest": "chest",
    "pecs": "chest",
    "back": "back",
    "lats": "back",
    "arms": "arms",
    "biceps": "arms",
    "triceps": "arms",
    "legs": "legs",
    "quads": "legs",
    "hamstrings": "legs",
    "glutes": "glutes",
    "core": "core",
    "abs": "core",
}


def _bump(emphasis: Dict[str, str], group: str, delta: int) -> None:
    if group not in EMPHASIS_GROUPS:
        return
    try:
        cur = int(str(emphasis.get(group, "0")).replace("+", "") or "0")
    except ValueError:
        cur = 0
    nxt = max(-2, min(2, cur + delta))
    if nxt > 0:
        emphasis[group] = f"+{nxt}"
    elif nxt < 0:
        emphasis[group] = str(nxt)
    else:
        emphasis[group] = "0"


def synthesize(
    observations: Dict[str, Any],
    goal: Dict[str, Any],
    history_summary: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Pure deterministic recommendation deltas."""
    history_summary = history_summary or {}
    emphasis = {g: "0" for g in EMPHASIS_GROUPS}
    flags: List[str] = []
    protect = list(goal.get("protect_lifts") or [])

    regions = observations.get("regions") or {}
    for region, meta in regions.items():
        if not isinstance(meta, dict):
            continue
        dev = meta.get("development")
        groups = REGION_TO_EMPHASIS.get(region, [])
        if dev == "underdeveloped":
            for g in groups:
                _bump(emphasis, g, 1)
            flags.append(f"possible_{region}_lag")
        elif dev == "prominent":
            # Don't punish; leave at 0 unless goal says otherwise
            pass

    for asym in observations.get("asymmetries") or []:
        if not isinstance(asym, dict):
            continue
        region = asym.get("region")
        severity = asym.get("severity")
        groups = REGION_TO_EMPHASIS.get(region, [region] if region in EMPHASIS_GROUPS else [])
        bump = 1 if severity == "mild" else 2 if severity == "moderate" else 0
        for g in groups:
            _bump(emphasis, g, bump)
        if region:
            flags.append(f"asymmetry_{region}_{asym.get('side') or 'uncertain'}")

    posture = observations.get("posture") or {}
    for key, level in posture.items():
        if level in ("possible", "likely"):
            flags.append(f"posture_{key}_{level}")
            if key in ("rounded_shoulders", "forward_head"):
                _bump(emphasis, "rear_delts", 1)
                _bump(emphasis, "upper_pull", 1)
            if key == "anterior_pelvic_tilt":
                _bump(emphasis, "glutes", 1)
                _bump(emphasis, "core", 1)

    # Goal target areas get an extra bump
    for area in goal.get("target_areas") or []:
        raw = str(area).lower().replace(" ", "_")
        key = GOAL_AREA_ALIASES.get(raw) or GOAL_AREA_ALIASES.get(raw.rstrip("s"))
        if key:
            _bump(emphasis, key, 1)
            if key == "shoulders":
                _bump(emphasis, "rear_delts", 1)

    direction = goal.get("direction") or "recomp"
    volume_bias = None
    if direction == "hypertrophy":
        volume_bias = "hypertrophy_volume"
    elif direction == "strength":
        volume_bias = "strength_priority"
    elif direction == "cut":
        volume_bias = "retain_muscle_cut"
        # Slightly favor larger muscle groups retention
        _bump(emphasis, "legs", 0)
    elif direction == "recomp":
        volume_bias = "recomp_balance"

    # History: if a region looks undertrained in logs, bump it
    undertrained = history_summary.get("undertrained_groups") or []
    for g in undertrained:
        g = str(g).lower()
        if g in EMPHASIS_GROUPS:
            _bump(emphasis, g, 1)
            flags.append(f"history_low_volume_{g}")

    overtrained = history_summary.get("high_volume_groups") or []
    for g in overtrained:
        g = str(g).lower()
        if g in EMPHASIS_GROUPS and emphasis.get(g) in ("0", "+1", "+2"):
            # Don't stack if already heavily emphasized from scan
            pass

    # Drop zeros for cleaner payload
    emphasis = {k: v for k, v in emphasis.items() if v != "0"}

    return normalize_synthesis({
        "emphasis": emphasis,
        "protect": protect,
        "volume_bias": volume_bias,
        "flags": flags[:12],
        "next_scan_days": 28,
        "applied": False,
    })


def explain_synthesis(
    observations: Dict[str, Any],
    goal: Dict[str, Any],
    synthesis: Dict[str, Any],
    model: Optional[str] = None,
) -> str:
    """LLM explains the deterministic synthesis — does not invent new numbers."""
    client = get_openai_client()
    fallback = (
        "Based on your photos, goal, and training history, the plan shifts volume "
        "toward the areas that look relatively behind and the muscles you named — "
        "without changing how loads are calculated from your logs."
    )
    if not client:
        return fallback

    prompt = f"""Explain this coaching synthesis in 2-4 short sentences for the athlete.
Do NOT invent body-fat %, weights, or new recommendations. Only explain what is already decided.

Goal: {json.dumps(goal)[:600]}
Observations confidence: {observations.get('confidence')}
Limitations: {observations.get('limitations')}
Overall notes: {observations.get('overall_notes')}
Synthesis: {json.dumps(synthesis)[:800]}

Tone: supportive, clear, non-judgmental. Mention that this is appearance-based coaching, not medical advice.
"""
    try:
        resolved = resolve_model(model)
        resp = client.chat.completions.create(
            **completion_kwargs(resolved, max_tokens=280, temperature=0.4),
            messages=[
                {"role": "system", "content": "You explain training emphasis changes. No medical advice."},
                {"role": "user", "content": prompt},
            ],
        )
        text = (resp.choices[0].message.content or "").strip()
        return text[:900] or fallback
    except Exception as e:
        print(f"body_scan explain error: {e}")
        return fallback


def summarize_training_history(sessions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Rough volume by keyword from recent workout sessions."""
    counts = {g: 0 for g in ("chest", "back", "shoulders", "arms", "legs", "glutes", "core")}
    keywords = {
        "chest": ("bench", "chest", "pec", "fly", "press" ),
        "back": ("row", "pulldown", "pull-up", "pullup", "lat", "deadlift"),
        "shoulders": ("shoulder", "overhead", "ohp", "lateral", "raise", "delt"),
        "arms": ("curl", "tricep", "bicep", "extension", "pushdown"),
        "legs": ("squat", "leg", "lunge", "rdl", "hamstring", "quad"),
        "glutes": ("hip thrust", "glute", "kickback"),
        "core": ("plank", "crunch", "core", "ab "),
    }
    for session in sessions or []:
        for ex in session.get("exercises") or []:
            name = str(ex.get("name") or ex.get("exercise_name") or "").lower()
            for group, keys in keywords.items():
                if any(k in name for k in keys):
                    counts[group] += 1
                    break
    total = sum(counts.values()) or 1
    undertrained = [g for g, c in counts.items() if c / total < 0.08 and total >= 5]
    high = [g for g, c in counts.items() if c / total > 0.35]
    return {
        "counts": counts,
        "undertrained_groups": undertrained,
        "high_volume_groups": high,
        "sessions_considered": len(sessions or []),
    }
