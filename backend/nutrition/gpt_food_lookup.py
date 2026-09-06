"""
Estimate macros for a typed food query, e.g. "2 belvita crackers".
"""
import json
import math
from typing import Dict, Optional, Tuple
from ai_models import ESCALATION_MODEL, completion_kwargs, is_gpt5_family, resolve_model

from .gpt_fallback import get_openai_client
from .nutrients import NUTRIENT_RULES, optional_nutrients
from .text_estimate import (
    build_text_analysis,
    check_hint,
    parse_calorie_hint,
    should_escalate_text,
)


ESTIMATE_RULES = """
Estimate nutrition for the FULL amount the user ate — not one unit, not per 100g.

Rules:
1. Parse quantity carefully: "I had 3", "3 of these", "in total", "x3" means multiply the whole item.
2. Split the meal into components (wrap/bread, filling, oil, sauce, toppings). Estimate each, then SUM.
   Each component's "calories" field is the TOTAL for that component across all qty, not per-unit.
3. Never list the same food twice — once as the finished dish and again as its parts. Either one
   "chicken frankie" row, or separate tortilla / filling / oil rows. Not both.
4. PART calorie hint — the user prices ONE component ("the tortilla was like 150 cal each"): use their
   figure for THAT component only. Do NOT treat it as the total for the meal. Add filling, cooking oil,
   and extras on top.
5. WHOLE-MEAL calorie hint — the user prices the ENTIRE meal ("I think that was about 600 calories",
   "felt like 600", "maybe 600 total"): their figure already covers everything they described. NEVER
   add components on top of it, and never treat it as a floor to build up from. Estimate the meal
   independently, then compare against their figure:
     - within 25%: your estimate agrees with them; keep it.
     - more than 25% apart: keep your own estimate — people routinely undercount oil, sauces and
       portion size — but you MUST fill in "hint_disagreement" naming the specific items or amounts
       that account for the gap, e.g. "roughly 350 kcal of it is the 3 tbsp of oil a paratha is
       shallow-fried in". If you cannot name what accounts for the gap, then your estimate is the one
       that is wrong: revise it toward their figure before answering.
6. Aim for the most likely central estimate. Do not systematically overestimate or underestimate.
7. Include cooking oil only when the user states it or the named preparation normally requires it. Do
   not infer extra oil merely because a dish is homemade.
8. If the description is sparse, use a typical preparation as a neutral prior and avoid unusually lean
   or unusually rich assumptions. Push that uncertainty into portion.low_grams / portion.high_grams,
   never into a smaller central estimate.
9. Calories must be at least 4*protein + 4*carbs + 9*fats (within 20 kcal). If not, raise calories to
   maintain basic consistency.
10. calories MUST equal the sum of component calories when component calories are provided.

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
        if not math.isfinite(n) or n < 0:
            return default
        return n
    except (TypeError, ValueError):
        return default


# Macro fields on a component row, and the key each maps to on the top level.
_COMPONENT_MACROS = (
    ("protein", ("protein",)),
    ("carbs", ("carbs",)),
    ("fats", ("fats", "fat")),
    ("fiber", ("fiber",)),
)


def _stated(parsed: Dict, keys) -> float:
    for key in keys:
        if key in parsed:
            return _num(parsed.get(key))
    return 0.0


def _component_macro_sums(components) -> Dict[str, float]:
    """What the model's own line items add up to, per macro."""
    sums = {name: 0.0 for name, _ in _COMPONENT_MACROS}
    sums["calories"] = 0.0
    if not isinstance(components, list):
        return sums
    for part in components:
        if not isinstance(part, dict):
            continue
        sums["calories"] += _num(part.get("calories"))
        for name, keys in _COMPONENT_MACROS:
            sums[name] += _stated(part, keys)
    return sums


def assess_macro_coherence(parsed: Dict) -> Dict:
    """Compare a model's stated totals against what its own parts imply.

    A model that reports 440 kcal under components summing to 560, or macros
    justifying 600, is telling you it is out of its depth on this photo. The
    repair below is still worth applying — but discarding the fact that a
    repair was needed throws away the best available signal that the estimate
    deserves a second, stronger pass.

    **Every macro is reconciled, not only calories.** Calories were protected
    from the start and protein was not, so a ledger reading 41g protein under a
    stated 25g logged 25g — and rendered the disagreeing ledger underneath it.
    Protein is the macro users track most closely and the one a forgotten side
    of yogurt or dal costs the most.

    The repair only ever raises a figure. A model that itemises four components
    and fills protein in on two of them would otherwise drag the total DOWN to
    a partial sum, which is a worse answer than the one it replaced.
    """
    reported = int(round(_num(parsed.get("calories"))))
    sums = _component_macro_sums(parsed.get("components"))
    component_sum = sums["calories"]

    macros = {}
    macro_repaired = False
    for name, keys in _COMPONENT_MACROS:
        stated = round(_stated(parsed, keys), 1)
        from_parts = round(sums[name], 1)
        resolved_macro = max(stated, from_parts)
        macros[name] = resolved_macro
        if resolved_macro != stated:
            macro_repaired = True

    macro_kcal = 4 * macros["protein"] + 4 * macros["carbs"] + 9 * macros["fats"]

    resolved = reported
    if component_sum > resolved:
        resolved = int(round(component_sum))
    if macro_kcal > resolved + 20:
        # Macros already justify more calories than reported — trust the macros.
        resolved = int(round(macro_kcal))

    gap = abs(resolved - reported)
    stated_protein = round(_stated(parsed, ("protein",)), 1)
    protein_gap = abs(macros["protein"] - stated_protein)
    return {
        "reported_calories": reported,
        "component_sum": int(round(component_sum)),
        "macro_kcal": int(round(macro_kcal)),
        "calories": resolved,
        "protein": macros["protein"],
        "carbs": macros["carbs"],
        "fats": macros["fats"],
        "fiber": macros["fiber"],
        "reported_protein": stated_protein,
        "component_protein": round(sums["protein"], 1),
        "repaired": resolved != reported or macro_repaired,
        # Share of the final number that the model did not account for.
        "gap_ratio": round(gap / resolved, 3) if resolved > 0 else 0.0,
        # Tracked separately: a plate can be right on calories and badly wrong
        # on protein, and calories-only routing never sees it.
        "protein_gap_ratio": (
            round(protein_gap / macros["protein"], 3) if macros["protein"] > 0 else 0.0
        ),
    }


def finalize_estimated_macros(parsed: Dict, query: str = "") -> Tuple[int, float, float, float, float]:
    """Apply arithmetic consistency without inventing an upward bias."""
    coherence = assess_macro_coherence(parsed)
    return (
        coherence["calories"],
        coherence["protein"],
        coherence["carbs"],
        coherence["fats"],
        coherence["fiber"],
    )




def _schema_block(name_hint: str) -> str:
    return f"""{{
  "name": "short food title for the log",
  "serving": "the full amount they ate, e.g. 3 frankie wraps",
  "grams": number,
  "identity_confidence": "high" | "medium" | "low",
  "portion": {{"estimated_grams": number, "low_grams": number, "high_grams": number}},
  "components": [
    {{"item": "flour tortilla", "qty": 3, "estimated_grams": 150, "calories": 450,
      "protein": 12, "carbs": 84, "fats": 6, "fiber": 4}},
    {{"item": "chickpea and pea filling with oil", "qty": 3, "estimated_grams": 300,
      "calories": 360, "protein": 15, "carbs": 42, "fats": 14, "fiber": 9}}
  ],
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "fiber": number,
  "sugar": number or null,
  "sodium": number or null,
  "hint_disagreement": "why your total differs from the calorie figure the user gave, or null",
  "assumptions": ["short assumption"],
  "uncertainties": ["short uncertainty"],
  "aliases": ["short phrases someone might search"]
}}

Round calories to a whole number. Round protein, carbs, fats, and fiber to 1 decimal.
If grams are unknown, estimate. aliases should include the original query and simpler names.
{name_hint}"""


def _build_prompt(query: str, name: Optional[str], hint: Optional[Dict]) -> str:
    title_line = (
        f'The logged food title should be: "{name.strip()}". Use that as "name".\n'
        if (name or "").strip()
        else ""
    )
    # The scope is decided here, deterministically, and stated to the model —
    # not left for the model to infer. Mis-scoping a whole-meal figure as a
    # per-part one is the failure this whole path was rebuilt around; a model
    # that mis-scopes it will also report the mis-scoped reading back.
    hint_line = ""
    if hint:
        if hint["scope"] == "whole":
            hint_line = (
                f'\nThe user has given their own figure for the WHOLE meal: '
                f'{hint["stated_calories"]} kcal ("{hint["text"]}"). Rule 5 applies — that figure '
                f'already covers everything they described. Do not add components on top of it.\n'
            )
        else:
            hint_line = (
                f'\nThe user has priced ONE PART of the meal at {hint["stated_calories"]} kcal '
                f'("{hint["text"]}"). Rule 4 applies — that covers that part only.\n'
            )

    return f"""The user is logging food.

{title_line}Description of what they ate:
"{query}"
{hint_line}
{ESTIMATE_RULES}
{NUTRIENT_RULES}
{_schema_block("")}"""


def _one_pass(client, prompt: str, model: str) -> Optional[Dict]:
    """One JSON completion, with a single retry on unparseable output."""
    last_error = None
    for attempt in range(2):
        try:
            response = client.chat.completions.create(
                **completion_kwargs(
                    model,
                    # Reasoning tokens come out of this budget, so a flat 700
                    # truncates the JSON on a reasoning model and the estimate
                    # silently demotes to nothing. Same lesson as the vision path.
                    max_tokens=4000 if is_gpt5_family(model) else 1200,
                    temperature=0.1 if attempt == 0 else 0.0,
                ),
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
            parsed = _parse_json(response.choices[0].message.content or "")
            if parsed and isinstance(parsed, dict):
                return parsed
        except Exception as e:
            last_error = e
    if last_error:
        print(f"Error estimating food from query on {model}: {last_error}")
    return None


def _shape(parsed: Dict, query: str, name: Optional[str]) -> Dict:
    """Turn one raw model response into the saved-food payload plus its evidence."""
    coherence = assess_macro_coherence(parsed)
    calories, protein, carbs, fats, fiber = finalize_estimated_macros(parsed, query=query)

    if calories > MAX_CALORIES:
        print(f"Warning: clamped implausible calories ({calories}) for query: {query!r}")
        calories = MAX_CALORIES

    logged_name = str((name or "").strip() or parsed.get("name") or query).strip()[:120] or query
    serving = str(parsed.get("serving") or query).strip()[:80] or query
    grams = _num(parsed.get("grams"), 100) or 100
    if grams > MAX_GRAMS:
        grams = MAX_GRAMS
    aliases = parsed.get("aliases") if isinstance(parsed.get("aliases"), list) else []
    alias_strs = [str(a).strip()[:80] for a in aliases if str(a).strip()]
    if query not in alias_strs:
        alias_strs.append(query)

    return {
        "food": {
            "name": logged_name,
            "serving": serving,
            "grams": round(grams, 1),
            "calories": calories,
            "protein": protein,
            "carbs": carbs,
            "fats": fats,
            "fiber": fiber,
            **optional_nutrients(parsed),
            "aliases": alias_strs[:12],
        },
        "parsed": parsed,
        "coherence": coherence,
    }


def estimate_food_from_query(
    query: str,
    name: Optional[str] = None,
    *,
    model: Optional[str] = None,
    allow_escalation: bool = True,
    has_saved_prior: bool = False,
) -> Optional[Dict]:
    """Estimate macros for a typed description, cheap pass first.

    Two passes, not one — the same argument `analyzer.py` makes for photos, and
    for the same reason: a mixed multi-component meal is where a cheap model
    shades each part low independently and the errors compound. Until Sep 2026
    this path ran a single hardcoded `gpt-4o-mini` call, a model not even in
    `ALLOWED_MODELS`, with no ledger, no confidence and no second opinion,
    while the photo of the same meal got gpt-4o with escalation to
    gpt-5.6-sol. A user who typed their meal instead of photographing it was
    silently on the weakest estimator in the app.

    The returned dict is the saved-food payload plus `analysis` — the evidence
    behind it, in the same shape the photo path returns, so the results card
    renders both. Callers persisting the food to the library must not persist
    `analysis`; it describes one estimate, not the food.
    """
    client = get_openai_client()
    if not client:
        print("Warning: OPENAI_API_KEY not set. Skipping food estimate.")
        return None

    q = (query or "").strip()
    if not q:
        return None

    hint = parse_calorie_hint(q)
    prompt = _build_prompt(q, name, hint)
    first_model = resolve_model(model)

    parsed = _one_pass(client, prompt, first_model)
    if not parsed:
        print(f"Warning: could not parse model output for query: {q!r}")
        return None

    shaped = _shape(parsed, q, name)
    hint_check = check_hint(hint, shaped["food"]["calories"])
    analysis = build_text_analysis(
        parsed,
        query=q,
        hint=hint,
        hint_check=hint_check,
        has_saved_prior=has_saved_prior,
    )
    decision = should_escalate_text(
        analysis,
        shaped["coherence"],
        hint_check,
        calories=shaped["food"]["calories"],
    )

    final_model = first_model
    escalated = False
    if decision["escalate"] and allow_escalation and first_model != ESCALATION_MODEL:
        stronger = _one_pass(client, prompt, ESCALATION_MODEL)
        # A failed second pass is not a failed estimate. Keep the first answer
        # rather than dropping the log entirely.
        if stronger:
            escalated = True
            final_model = ESCALATION_MODEL
            shaped = _shape(stronger, q, name)
            hint_check = check_hint(hint, shaped["food"]["calories"])
            analysis = build_text_analysis(
                stronger,
                query=q,
                hint=hint,
                hint_check=hint_check,
                has_saved_prior=has_saved_prior,
            )

    if hint_check:
        # Only ever the model's own words about the gap, never a generated
        # excuse: if it could not name what accounts for the difference, the
        # card says so plainly rather than manufacturing a reason.
        hint_check["reason"] = (
            str(shaped["parsed"].get("hint_disagreement") or "").strip()[:200] or None
        )
        analysis["hint_check"] = hint_check

    analysis["routing"] = {
        "first_pass_model": first_model,
        "final_model": final_model,
        "escalated": escalated,
        "triggers": decision["triggers"],
    }

    return {**shaped["food"], "analysis": analysis}
