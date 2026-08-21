"""Parse natural-language training goals into a structured object."""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from nutrition.gpt_fallback import get_openai_client
from ai_models import resolve_model, completion_kwargs
from .schemas import normalize_goal


def parse_goal_text(raw_text: str, model: Optional[str] = None) -> Dict[str, Any]:
    text = (raw_text or "").strip()
    if not text:
        return normalize_goal({}, "")

    client = get_openai_client()
    if not client:
        # Deterministic fallback: keyword heuristic
        lower = text.lower()
        direction = "recomp"
        if any(w in lower for w in ("cut", "lean", "fat loss", "lose fat")):
            direction = "cut"
        elif any(w in lower for w in ("strong", "strength", "1rm", "pr")):
            direction = "strength"
        elif any(w in lower for w in ("bigger", "grow", "hypertrophy", "muscle")):
            direction = "hypertrophy"
        targets = []
        for area in ("shoulder", "chest", "back", "arm", "leg", "glute", "core", "abs"):
            if area in lower:
                targets.append(area + ("s" if not area.endswith("s") and area != "back" and area != "chest" and area != "core" else ""))
        return normalize_goal(
            {
                "direction": direction,
                "target_areas": targets[:6],
                "protect_lifts": [],
                "constraints": [],
                "parsed_confidence": "low",
            },
            text,
        )

    prompt = f"""Parse this fitness goal into JSON.

User goal: "{text}"

Return:
{{
  "direction": "hypertrophy|strength|cut|recomp|maintain",
  "target_areas": ["shoulders", "chest", ...],
  "protect_lifts": ["squat", "bench", ...],
  "constraints": ["short notes"],
  "parsed_confidence": "low|medium|high"
}}

Rules: only use what the user said or clearly implied. Do not invent injuries.
"""
    try:
        resolved = resolve_model(model)
        resp = client.chat.completions.create(
            **completion_kwargs(resolved, max_tokens=400, temperature=0.2),
            messages=[
                {"role": "system", "content": "You parse fitness goals into JSON. No medical advice."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content or "{}"
        data = json.loads(content)
        if not isinstance(data, dict):
            data = {}
        return normalize_goal(data, text)
    except Exception as e:
        print(f"body_scan goal parse error: {e}")
        return normalize_goal({"direction": "recomp", "parsed_confidence": "low"}, text)
