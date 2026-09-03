export type CookingStyle = "light" | "normal" | "generous";
export type PortionChoice = "smaller" | "estimated" | "larger";

export const COOKING_STYLE_STORAGE_KEY = "gymai_cooking_style";

export type MacroValues = {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
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

function roundMacro(value: number) {
  return Math.round(Math.max(0, value) * 10) / 10;
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
  };

  const merged = { ...calculated };
  if (manual) {
    (Object.keys(merged) as (keyof MacroValues)[]).forEach((key) => {
      const value = manual[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        merged[key] = key === "calories" ? Math.round(value) : roundMacro(value);
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
    },
  };
}
