export type CookingStyle = "light" | "normal" | "generous";
export type PortionChoice = "smaller" | "estimated" | "larger";

export const COOKING_STYLE_STORAGE_KEY = "gymai_cooking_style";

export type MacroValues = {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  sugar?: number;
  sodium?: number;
};

export type PhotoComponent = {
  name: string;
  amount?: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  sugar?: number;
  sodium?: number;
};

export type PhotoConfidence = {
  score: number;
  level: "low" | "medium" | "high";
  reasons: string[];
  shouldNudge: boolean;
};

export type PhotoEstimate = MacroValues & {
  name: string;
  amount?: string;
  estimatedGrams?: number;
  analysis: {
    confidence: PhotoConfidence;
    cookingStyle: CookingStyle;
    oilGrams: number;
    portionLowGrams?: number;
    portionHighGrams?: number;
    assumptions: string[];
    uncertainties: string[];
    matchedSavedFood: boolean;
    // Per-item breakdown from the vision pass. Rendering it is what lets the
    // user see a missing item instead of having to guess at it.
    components: PhotoComponent[];
    /**
     * Food the model said it could see and then did not cost — the omission
     * that used to be silent. Empty for the v1/v2 prompts, which are never
     * asked for an inventory. See backend/nutrition/photo_estimate.py.
     */
    uncounted: string[];
  };
};

const PORTION_FACTORS: Record<PortionChoice, number> = {
  smaller: 0.8,
  estimated: 1,
  larger: 1.25,
};

const OIL_FACTORS: Record<CookingStyle, number> = {
  light: 0.5,
  normal: 1,
  generous: 1.5,
};

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function optionalNutrient(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && !value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function scaleNutrient(value: number | undefined, factor: number, digits = 1) {
  const number = optionalNutrient(value);
  return number === undefined ? undefined : Math.round(number * factor * 10 ** digits) / 10 ** digits;
}

function roundMacro(value: number) {
  return Math.round(Math.max(0, value) * 10) / 10;
}

function componentList(value: unknown): PhotoComponent[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      name: String(item.name || item.item || "").trim(),
      amount: String(item.amount || "").trim() || undefined,
      calories: Math.round(finiteNumber(item.calories)),
      protein: roundMacro(finiteNumber(item.protein)),
      carbs: roundMacro(finiteNumber(item.carbs)),
      fats: roundMacro(finiteNumber(item.fats)),
      fiber: roundMacro(finiteNumber(item.fiber)),
      sugar: optionalNutrient(item.sugar),
      sodium: optionalNutrient(item.sodium),
    }))
    .filter((item) => item.name)
    .slice(0, 12);
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
    : [];
}

export function normalizeCookingStyle(value: unknown): CookingStyle {
  return value === "light" || value === "generous" ? value : "normal";
}

export function toPhotoEstimate(raw: any, titleFallback = ""): PhotoEstimate | null {
  const item = raw?.food || raw?.food_items?.[0] || raw;
  if (!item || typeof item !== "object" || !String(item.name || titleFallback).trim()) {
    return null;
  }

  const analysis = raw?.analysis && typeof raw.analysis === "object" ? raw.analysis : {};
  const confidenceRaw =
    analysis.confidence && typeof analysis.confidence === "object" ? analysis.confidence : {};
  const level =
    confidenceRaw.level === "high" || confidenceRaw.level === "medium"
      ? confidenceRaw.level
      : "low";
  const portion = analysis.portion && typeof analysis.portion === "object" ? analysis.portion : {};
  const cooking = analysis.cooking && typeof analysis.cooking === "object" ? analysis.cooking : {};

  return {
    name: String(titleFallback || item.name || "Meal").trim() || "Meal",
    amount: String(item.amount || item.serving || "").trim() || undefined,
    calories: Math.round(finiteNumber(item.calories)),
    protein: roundMacro(finiteNumber(item.protein)),
    carbs: roundMacro(finiteNumber(item.carbs)),
    fats: roundMacro(finiteNumber(item.fats)),
    fiber: roundMacro(finiteNumber(item.fiber)),
    sugar: optionalNutrient(item.sugar),
    sodium: optionalNutrient(item.sodium),
    estimatedGrams: finiteNumber(portion.estimated_grams) || undefined,
    analysis: {
      confidence: {
        score: Math.min(100, Math.round(finiteNumber(confidenceRaw.score))),
        level,
        reasons: stringList(confidenceRaw.reasons),
        shouldNudge: Boolean(confidenceRaw.should_nudge) || level === "low",
      },
      cookingStyle: normalizeCookingStyle(cooking.style),
      oilGrams: finiteNumber(cooking.oil_grams),
      portionLowGrams: finiteNumber(portion.low_grams) || undefined,
      portionHighGrams: finiteNumber(portion.high_grams) || undefined,
      assumptions: stringList(analysis.assumptions),
      uncertainties: stringList(analysis.uncertainties),
      matchedSavedFood: Boolean(analysis.matched_saved_food),
      components: componentList(analysis.components),
      uncounted: stringList(
        analysis.scene && typeof analysis.scene === "object"
          ? analysis.scene.uncounted
          : []
      ),
    },
  };
}

/**
 * Multiply a whole estimate by a serving count.
 *
 * Everything derived from the food has to move together. Scaling only the
 * macros leaves `estimatedGrams` at one serving, and that value becomes the
 * saved food's `grams` — so a 3-serving log stores 3x the calories against 1x
 * the weight and every future re-log of that food is wrong by 3x, silently and
 * permanently.
 */
export function scalePhotoEstimate(base: PhotoEstimate, servings: number): PhotoEstimate {
  const factor = Number.isFinite(servings) && servings > 0 ? servings : 1;
  if (factor === 1) return base;
  return {
    ...base,
    calories: Math.round(base.calories * factor),
    protein: roundMacro(base.protein * factor),
    carbs: roundMacro(base.carbs * factor),
    fats: roundMacro(base.fats * factor),
    fiber: roundMacro(base.fiber * factor),
    sugar: scaleNutrient(base.sugar, factor),
    sodium: scaleNutrient(base.sodium, factor, 0),
    estimatedGrams: base.estimatedGrams
      ? roundMacro(base.estimatedGrams * factor)
      : undefined,
    amount: `${factor}x ${base.amount || "portion"}`,
    analysis: {
      ...base.analysis,
      oilGrams: roundMacro(base.analysis.oilGrams * factor),
      components: base.analysis.components.map((component) => ({
        ...component,
        calories: Math.round(component.calories * factor),
        protein: roundMacro(component.protein * factor),
        carbs: roundMacro(component.carbs * factor),
        fats: roundMacro(component.fats * factor),
        fiber: roundMacro(component.fiber * factor),
        sugar: scaleNutrient(component.sugar, factor),
        sodium: scaleNutrient(component.sodium, factor, 0),
      })),
    },
  };
}

export function adjustPhotoEstimate(
  base: PhotoEstimate,
  portion: PortionChoice,
  cookingStyle: CookingStyle,
  manual?: Partial<MacroValues> | null
): PhotoEstimate {
  const portionFactor = PORTION_FACTORS[portion];
  const baselineStyle = base.analysis.cookingStyle;
  const baselineOil = base.analysis.oilGrams;
  const normalOil = baselineOil > 0 ? baselineOil / OIL_FACTORS[baselineStyle] : 0;
  const oilDelta =
    (normalOil * OIL_FACTORS[cookingStyle] - baselineOil) * portionFactor;

  const calculated: MacroValues = {
    calories: Math.round(base.calories * portionFactor + oilDelta * 9),
    protein: roundMacro(base.protein * portionFactor),
    carbs: roundMacro(base.carbs * portionFactor),
    fats: roundMacro(base.fats * portionFactor + oilDelta),
    fiber: roundMacro(base.fiber * portionFactor),
    sugar: scaleNutrient(base.sugar, portionFactor),
    sodium: scaleNutrient(base.sodium, portionFactor, 0),
  };

  // The ledger has to keep summing to the number on screen, or it stops being
  // an explanation and becomes a second, contradicting estimate. Portion
  // scales every line; a cooking-style change is oil, so it gets its own line
  // rather than being smeared across the chapati.
  const scaledComponents: PhotoComponent[] = base.analysis.components.map((component) => ({
    ...component,
    calories: Math.round(component.calories * portionFactor),
    protein: roundMacro(component.protein * portionFactor),
    carbs: roundMacro(component.carbs * portionFactor),
    fats: roundMacro(component.fats * portionFactor),
    fiber: roundMacro(component.fiber * portionFactor),
    sugar: scaleNutrient(component.sugar, portionFactor),
    sodium: scaleNutrient(component.sodium, portionFactor, 0),
  }));
  if (scaledComponents.length && Math.round(oilDelta * 9) !== 0) {
    scaledComponents.push({
      name: `Cooking oil (${cookingStyle})`,
      amount: `${roundMacro(Math.abs(oilDelta))}g ${oilDelta >= 0 ? "more" : "less"}`,
      calories: Math.round(oilDelta * 9),
      protein: 0,
      carbs: 0,
      fats: roundMacro(oilDelta),
      fiber: 0,
    });
  }

  const merged = { ...calculated };
  let manualOverridesCalories = false;
  if (manual) {
    (Object.keys(merged) as (keyof MacroValues)[]).forEach((key) => {
      const value = manual[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        merged[key] = key === "calories" ? Math.round(value) : roundMacro(value);
        manualOverridesCalories = true;
      }
    });
  }

  const portionPrefix = portion === "estimated" ? "" : portion === "smaller" ? "Smaller · " : "Larger · ";
  return {
    ...base,
    ...merged,
    amount: `${portionPrefix}${base.amount || "estimated portion"}`,
    estimatedGrams: base.estimatedGrams
      ? roundMacro(base.estimatedGrams * portionFactor)
      : undefined,
    analysis: {
      ...base.analysis,
      cookingStyle,
      oilGrams: roundMacro(normalOil * OIL_FACTORS[cookingStyle] * portionFactor),
      // A manual macro override no longer follows from the line items, so the
      // ledger would be lying if we kept showing it.
      components: manualOverridesCalories ? [] : scaledComponents,
    },
  };
}
