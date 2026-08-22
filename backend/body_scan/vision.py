"""
Vision analysis for body-scan progress photos.

Images are analyzed in-memory / from temp files and never stored long-term.
Output is qualitative JSON only — no fabricated body-fat percentages.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from nutrition.gpt_fallback import get_openai_client
from ai_models import resolve_model, completion_kwargs
from .schemas import empty_observations, normalize_observations


@dataclass
class ScanImage:
    """One uploaded view, held in memory only — never written to disk."""
    data: bytes
    mime: str = "image/jpeg"


SYSTEM = """You are a careful physique observer for a fitness coaching app.
You describe relative muscular development, visible asymmetries, and possible posture cues from progress photos.
You NEVER invent precise body-fat percentages, medical diagnoses, or confident claims from poor photos.
When unsure, mark fields uncertain and say so in limitations.
Reply with JSON only."""


PROMPT = """Analyze these guided progress photos (views provided: {views}).

Return JSON:
{{
  "regions": {{
    "chest": {{"development": "underdeveloped|balanced|prominent|uncertain", "notes": "optional"}},
    "back": {{"development": "...", "notes": null}},
    "shoulders": {{"development": "...", "notes": null}},
    "arms": {{"development": "...", "notes": null}},
    "legs": {{"development": "...", "notes": null}},
    "core": {{"development": "...", "notes": null}},
    "glutes": {{"development": "...", "notes": null}}
  }},
  "asymmetries": [
    {{"region": "shoulders", "side": "left|right|uncertain", "severity": "mild|moderate|uncertain", "notes": "optional"}}
  ],
  "posture": {{
    "forward_head": "none|possible|likely|uncertain",
    "rounded_shoulders": "...",
    "anterior_pelvic_tilt": "...",
    "posterior_pelvic_tilt": "...",
    "uneven_shoulders": "..."
  }},
  "photo_quality": {{
    "full_body_visible": true,
    "lighting": "good|dim|harsh|uncertain",
    "pose_usable": true,
    "clothing_obscures": true,
    "views_match_labels": true,
    "notes": "what specifically limits this read"
  }},
  "overall_notes": "2-3 careful sentences",
  "confidence": "low|medium|high",
  "limitations": "what could make this wrong (lighting, pose, clothing, angle)"
}}

Rules:
- Qualitative only. No body fat %, weight, or medical claims.
- Prefer uncertain over guessing.
- Clothing, lighting, and pose strongly affect appearance — hedge.
- Do not comment on attractiveness. Stay coaching-relevant.

Assess photo_quality FIRST, then let it govern confidence:
- Set "views_match_labels" false if a photo does not actually show the view it
  was labeled as, or if the same photo appears more than once.
- Set "clothing_obscures" true if baggy clothing hides the torso or legs.
- confidence "high" requires full body visible, usable pose, and an unobscured
  torso in all three views. If any of those fail, confidence is at most "medium".
- If the photos cannot support a read at all, use confidence "low", mark every
  region "uncertain", and say why in limitations. That is a valid, useful answer
  — do not fill in plausible-looking ratings to be helpful.
"""


def _encode(image: "ScanImage") -> Optional[Dict[str, str]]:
    try:
        return {
            "mime": image.mime or "image/jpeg",
            "b64": base64.b64encode(image.data).decode("utf-8"),
        }
    except Exception as e:
        print(f"body_scan encode error: {e}")
        return None


def _safe_json(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def analyze_scan_photos(
    images: Dict[str, "ScanImage"],
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """
    images: { "front"|"side"|"back": ScanImage }
    Returns normalized observations. Bytes stay in memory and are never persisted.
    """
    client = get_openai_client()
    if not client:
        obs = empty_observations()
        obs["limitations"] = "Vision model unavailable. Try again later."
        return obs

    content: List[Dict[str, Any]] = [
        {
            "type": "text",
            "text": PROMPT.format(views=", ".join(sorted(images.keys()))),
        }
    ]
    for view, image in images.items():
        encoded = _encode(image)
        if not encoded:
            continue
        content.append({"type": "text", "text": f"View: {view}"})
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:{encoded['mime']};base64,{encoded['b64']}",
                # "low" downsamples to ~512px, which cannot support the
                # asymmetry and posture reads this prompt asks for — the model
                # would hedge or confabulate. Detail is the whole feature here.
                "detail": "high",
            },
        })

    if len(content) <= 1:
        return empty_observations()

    try:
        resolved = resolve_model(model)
        resp = client.chat.completions.create(
            **completion_kwargs(resolved, max_tokens=1200, temperature=0.2),
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": content},
            ],
            response_format={"type": "json_object"},
        )
        raw = _safe_json(resp.choices[0].message.content or "")
        return normalize_observations(raw)
    except Exception as e:
        print(f"body_scan vision error: {e}")
        obs = empty_observations()
        obs["limitations"] = "Vision analysis failed. Photos were not kept."
        return obs
