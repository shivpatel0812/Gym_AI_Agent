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
4. Pan-fried / "panned" / sauteed foods include cooking oil (typically 40–80 kcal per wrap/serving unless they said no oil).
5. Prefer a realistic overestimate over an underestimate. Street-style wraps (frankie, kathi roll, burrito) with legumes or meat are often 250–450 kcal EACH; three of them are usually 750–1300+ kcal, never just the wrap calories.
6. If the description is SPARSE (bare food name, no prep/oil/portion detail — e.g. "2 samosas", "a plate of biryani"), do NOT default to a lean textbook recipe. Assume typical home-cooked or restaurant-style preparation, which usually includes oil/ghee/butter, and bias toward the higher end of the plausible range for that dish.
7. Calories must be at least 4*protein + 4*carbs + 9*fats (within 15 kcal). If not, raise calories.
8. calories MUST equal the sum of component calories.

Return JSON only with:
"""

# Minimum plausible calories for common foods where sparse descriptions tend to
# get lowballed by the model (per unit/serving as named in the query, before qty
# multiplication — applied in finalize_estimated_macros using detected qty).
CATEGORY_FLOOR_KCAL = {
    "frankie": 250,
    "kathi roll": 250,
    "kati roll": 250,
    "burrito": 350,
    "samosa": 150,
    "biryani": 500,
    "paratha": 200,
    "naan": 200,
    "momo": 40,  # per piece
    "dumpling": 40,  # per piece
}

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


def _apply_category_floor(query: str, calories: float, components_summed: float) -> float:
    """If the query names a food known to get lowballed and the model's total
    looks too low for it, raise the floor. Only fires when we have no reason
    to already trust a higher number (component sum takes precedence upstream)."""
    q = (query or "").lower()
    for keyword, per_unit_floor in CATEGORY_FLOOR_KCAL.items():
        if keyword in q:
            # crude qty sniff: look for a leading digit near the keyword/query
            qty = 1
            for token in q.replace(",", " ").split():
                if token.isdigit():
                    qty = max(qty, int(token))
                    break
            floor = per_unit_floor * qty
            if calories < floor and components_summed < floor:
                return float(floor)
    return calories


def finalize_estimated_macros(parsed: Dict, query: str = "") -> Tuple[int, float, float, float, float]:
    """Raise calories to match component sums / macros; correct fat (not all
    macros) when calories imply more than protein+carbs+fat account for."""
    protein = round(_num(parsed.get("protein")), 1)
    carbs = round(_num(parsed.get("carbs")), 1)
    fats = round(_num(parsed.get("fats", parsed.get("fat"))), 1)
    fiber = round(_num(parsed.get("fiber")), 1)
    calories = int(round(_num(parsed.get("calories"))))

    summed = 0.0
    components = parsed.get("components")
    if isinstance(components, list):
        for part in components:
            if isinstance(part, dict):
                summed += _num(part.get("calories"))
    if summed > calories:
        calories = int(round(summed))

    # Sparse/known-tricky foods: enforce a category-level floor if both the
    # reported total and the component sum came in under it.
    floored = _apply_category_floor(query, calories, summed)
    if floored > calories:
        calories = int(round(floored))

    macro_kcal = 4 * protein + 4 * carbs + 9 * fats
    if macro_kcal > calories + 20:
        # Macros already justify more calories than reported — trust the macros.
        calories = int(round(macro_kcal))
    elif calories > macro_kcal + 30 and macro_kcal > 40:
        # Calories are higher than the macros justify. This is almost always a
        # missed-oil situation (cooking oil counted in the total but not
        # reflected in the fat field), so route the shortfall into fat rather
        # than scaling every macro — protein/carbs from the actual food
        # shouldn't change just because oil existed. Fiber is untouched
        # entirely since it isn't part of the calorie equation.
        missing_kcal = calories - macro_kcal
        fats = round(fats + missing_kcal / 9, 1)

    return calories, protein, carbs, fats, fiber


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