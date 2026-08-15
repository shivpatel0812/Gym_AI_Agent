"""
Estimate macros for a typed food query, e.g. "2 belvita crackers".
"""
import json
from typing import Dict, Optional
from .gpt_fallback import get_openai_client


def _parse_json(content: str) -> Optional[Dict]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        last_brace = text.rfind("}")
        if last_brace > 0:
            try:
                return json.loads(text[: last_brace + 1])
            except json.JSONDecodeError:
                return None
        return None


def _num(value, default=0):
    try:
        n = float(value)
        if n < 0:
            return default
        return n
    except (TypeError, ValueError):
        return default


def estimate_food_from_query(query: str, name: Optional[str] = None) -> Optional[Dict]:
    client = get_openai_client()
    if not client:
        print("Warning: OPENAI_API_KEY not set. Skipping food estimate.")
        return None

    q = (query or "").strip()
    if not q:
        return None

    try:
        title_line = (
            f'The logged food title should be: "{name.strip()}". Use that as "name".\n'
            if (name or "").strip()
            else ""
        )
        prompt = f"""The user is logging food.

{title_line}Description of what they ate (use this for portion size and ingredients): "{q}"

Estimate nutrition for the exact amount they described (e.g. "2 belvita crackers" = two crackers, not 100g).

Return JSON only:
{{
  "name": "short food title for the log, without the count if possible",
  "serving": "the amount they described, e.g. 2 crackers",
  "grams": number,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "fiber": number,
  "aliases": ["short phrases someone might search"]
}}

Round calories to a whole number. Round protein, carbs, fats, and fiber to 1 decimal.
If grams are unknown, estimate. aliases should include the original query and simpler names."""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            max_tokens=400,
            temperature=0.2,
        )
        parsed = _parse_json(response.choices[0].message.content or "")
        if not parsed or not isinstance(parsed, dict):
            return None

        fats = parsed.get("fats", parsed.get("fat"))
        name = str((name or "").strip() or parsed.get("name") or q).strip()[:120] or q
        serving = str(parsed.get("serving") or q).strip()[:80] or q
        grams = _num(parsed.get("grams"), 100) or 100
        aliases = parsed.get("aliases") if isinstance(parsed.get("aliases"), list) else []
        alias_strs = [str(a).strip()[:80] for a in aliases if str(a).strip()]
        if q not in alias_strs:
            alias_strs.append(q)

        return {
            "name": name,
            "serving": serving,
            "grams": round(grams, 1),
            "calories": int(round(_num(parsed.get("calories")))),
            "protein": round(_num(parsed.get("protein")), 1),
            "carbs": round(_num(parsed.get("carbs")), 1),
            "fats": round(_num(fats), 1),
            "fiber": round(_num(parsed.get("fiber")), 1),
            "aliases": alias_strs[:12],
        }
    except Exception as e:
        print(f"Error estimating food from query: {e}")
        return None
