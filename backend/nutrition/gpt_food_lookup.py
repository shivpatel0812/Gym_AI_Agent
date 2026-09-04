"""
Estimate macros for a typed food query, e.g. "2 belvita crackers".
"""
import json
from typing import Dict, Optional, Tuple
from .gpt_fallback import get_openai_client


ESTIMATE_RULES = """
Estimate nutrition for the FULL amount the user ate — not one unit, not per 100g.

Rules:
1. Parse quantity carefully: "I had 3", "3 of these", "in total", "x3" means multiply the whole item.
2. Split the meal into components (wrap/bread, filling, oil, sauce, toppings). Estimate each, then SUM.
   Each component's "calories" field is the TOTAL for that component across all qty, not per-unit.
3. If the user gives a calorie hint for a PART (e.g. "tortilla was like 150 cal each"), use that for THAT part only. Do NOT treat it as the total for the meal. Add filling, cooking oil, and extras on top.
4. Aim for the most likely central estimate. Do not systematically overestimate or underestimate.
5. Include cooking oil only when the user states it or the named preparation normally requires it. Do not infer extra oil merely because a dish is homemade.
6. If the description is sparse, use a typical preparation as a neutral prior and avoid unusually lean or unusually rich assumptions.
7. Calories must be at least 4*protein + 4*carbs + 9*fats (within 20 kcal). If not, raise calories to maintain basic consistency.
8. calories MUST equal the sum of component calories when component calories are provided.

Return JSON only with:
"""

# Sane upper bounds so a hallucinated/malformed response can't silently pass through.
MAX_CALORIES = 5000
MAX_GRAMS = 2000


def _parse_json(content: str) -> Optional[Dict]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    # Trim any stray text before/after the JSON object itself.
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        text = text[first_brace : last_brace + 1]

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _num(value, default=0):
    try:
        n = float(value)
        if n < 0:
            return default
        return n
    except (TypeError, ValueError):
        return default


def assess_macro_coherence(parsed: Dict) -> Dict:
    """Compare a model's stated calories against what its own parts imply.

    A model that reports 440 kcal under components summing to 560, or macros
    justifying 600, is telling you it is out of its depth on this photo. The
    repair below is still worth applying — but discarding the fact that a
    repair was needed throws away the best available signal that the estimate
    deserves a second, stronger pass.
    """
    protein = round(_num(parsed.get("protein")), 1)
    carbs = round(_num(parsed.get("carbs")), 1)
    fats = round(_num(parsed.get("fats", parsed.get("fat"))), 1)
    reported = int(round(_num(parsed.get("calories"))))

    component_sum = 0.0
    components = parsed.get("components")
    if isinstance(components, list):
        for part in components:
            if isinstance(part, dict):
                component_sum += _num(part.get("calories"))

    macro_kcal = 4 * protein + 4 * carbs + 9 * fats

    resolved = reported
    if component_sum > resolved:
        resolved = int(round(component_sum))
    if macro_kcal > resolved + 20:
        # Macros already justify more calories than reported — trust the macros.
        resolved = int(round(macro_kcal))

    gap = abs(resolved - reported)
    return {
        "reported_calories": reported,
        "component_sum": int(round(component_sum)),
        "macro_kcal": int(round(macro_kcal)),
        "calories": resolved,
        "repaired": resolved != reported,
        # Share of the final number that the model did not account for.
        "gap_ratio": round(gap / resolved, 3) if resolved > 0 else 0.0,
    }


def finalize_estimated_macros(parsed: Dict, query: str = "") -> Tuple[int, float, float, float, float]:
    """Apply arithmetic consistency without inventing an upward calorie bias."""
    coherence = assess_macro_coherence(parsed)
    return (
        coherence["calories"],
        round(_num(parsed.get("protein")), 1),
        round(_num(parsed.get("carbs")), 1),
        round(_num(parsed.get("fats", parsed.get("fat"))), 1),
        round(_num(parsed.get("fiber")), 1),
    )


def estimate_food_from_query(query: str, name: Optional[str] = None) -> Optional[Dict]:
    client = get_openai_client()
    if not client:
        print("Warning: OPENAI_API_KEY not set. Skipping food estimate.")
        return None

    q = (query or "").strip()
    if not q:
        return None

    title_line = (
        f'The logged food title should be: "{name.strip()}". Use that as "name".\n'
        if (name or "").strip()
        else ""
    )
    prompt = f"""The user is logging food.

{title_line}Description of what they ate:
"{q}"

{ESTIMATE_RULES}
{{
  "name": "short food title for the log",
  "serving": "the full amount they ate, e.g. 3 frankie wraps",
  "grams": number,
  "components": [
    {{"item": "flour tortilla", "qty": 3, "calories": 450}},
    {{"item": "chickpea and pea filling with oil", "qty": 3, "calories": 360}}
  ],
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "fiber": number,
  "aliases": ["short phrases someone might search"]
}}

Round calories to a whole number. Round protein, carbs, fats, and fiber to 1 decimal.
If grams are unknown, estimate. aliases should include the original query and simpler names."""

    parsed = None
    last_error = None
    for attempt in range(2):  # one retry on malformed output
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_tokens=700,
                temperature=0.1 if attempt == 0 else 0.0,
            )
            parsed = _parse_json(response.choices[0].message.content or "")
            if parsed and isinstance(parsed, dict):
                break
        except Exception as e:
            last_error = e
            parsed = None

    if not parsed or not isinstance(parsed, dict):
        if last_error:
            print(f"Error estimating food from query: {last_error}")
        else:
            print(f"Warning: could not parse model output for query: {q!r}")
        return None

    calories, protein, carbs, fats, fiber = finalize_estimated_macros(parsed, query=q)

    # Sanity clamps — guards against hallucinated outliers slipping through.
    if calories > MAX_CALORIES:
        print(f"Warning: clamped implausible calories ({calories}) for query: {q!r}")
        calories = MAX_CALORIES

    logged_name = str((name or "").strip() or parsed.get("name") or q).strip()[:120] or q
    serving = str(parsed.get("serving") or q).strip()[:80] or q
    grams = _num(parsed.get("grams"), 100) or 100
    if grams > MAX_GRAMS:
        grams = MAX_GRAMS
    aliases = parsed.get("aliases") if isinstance(parsed.get("aliases"), list) else []
    alias_strs = [str(a).strip()[:80] for a in aliases if str(a).strip()]
    if q not in alias_strs:
        alias_strs.append(q)

    return {
        "name": logged_name,
        "serving": serving,
        "grams": round(grams, 1),
        "calories": calories,
        "protein": protein,
        "carbs": carbs,
        "fats": fats,
        "fiber": fiber,
        "aliases": alias_strs[:12],
    }
