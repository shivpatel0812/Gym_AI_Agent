import { describe, expect, it } from "vitest";

import {
  adjustPhotoEstimate,
  normalizeCookingStyle,
  PhotoEstimate,
  toPhotoEstimate,
} from "./photoEstimate";

const estimate: PhotoEstimate = {
  name: "Rice bowl",
  amount: "1 bowl",
  estimatedGrams: 400,
  calories: 600,
  protein: 25,
  carbs: 80,
  fats: 20,
  fiber: 8,
  analysis: {
    confidence: { score: 65, level: "medium", reasons: [], shouldNudge: false },
    cookingStyle: "normal",
    oilGrams: 10,
    portionLowGrams: 320,
    portionHighGrams: 500,
    assumptions: [],
    uncertainties: [],
    matchedSavedFood: false,
  },
};

describe("photo estimate normalization", () => {
  it("preserves backend confidence and portion metadata", () => {
    const parsed = toPhotoEstimate({
      food: {
        name: "Curry",
        amount: "1 bowl",
        calories: 500,
        protein: 18,
        carbs: 55,
        fats: 22,
        fiber: 7,
      },
      analysis: {
        confidence: {
          score: 42,
          level: "low",
          reasons: ["No reliable size reference was found"],
          should_nudge: true,
        },
        portion: { estimated_grams: 375, low_grams: 280, high_grams: 500 },
        cooking: { style: "light", oil_grams: 5 },
        assumptions: ["typical recipe"],
        matched_saved_food: true,
      },
    });

    expect(parsed?.analysis.confidence.level).toBe("low");
    expect(parsed?.analysis.confidence.shouldNudge).toBe(true);
    expect(parsed?.estimatedGrams).toBe(375);
    expect(parsed?.analysis.cookingStyle).toBe("light");
    expect(parsed?.analysis.matchedSavedFood).toBe(true);
  });

  it("defaults missing confidence to a low-confidence nudge", () => {
    const parsed = toPhotoEstimate({ name: "Apple", calories: 95, protein: 0.5 });
    expect(parsed?.analysis.confidence.level).toBe("low");
    expect(parsed?.analysis.confidence.shouldNudge).toBe(true);
  });
});

describe("optional photo adjustments", () => {
  it("scales portion without requiring raw macro edits", () => {
    const smaller = adjustPhotoEstimate(estimate, "smaller", "normal");
    expect(smaller.calories).toBe(480);
    expect(smaller.protein).toBe(20);
    expect(smaller.estimatedGrams).toBe(320);
    expect(smaller.amount).toBe("Smaller · 1 bowl");
  });

  it("changes only the cooking-fat contribution when oil style changes", () => {
    const light = adjustPhotoEstimate(estimate, "estimated", "light");
    expect(light.calories).toBe(555);
    expect(light.fats).toBe(15);
    expect(light.protein).toBe(25);
    expect(light.carbs).toBe(80);
  });

  it("lets advanced edits override selected macro fields", () => {
    const manual = adjustPhotoEstimate(estimate, "estimated", "normal", {
      calories: 575,
      protein: 30,
    });
    expect(manual.calories).toBe(575);
    expect(manual.protein).toBe(30);
    expect(manual.carbs).toBe(80);
  });
});

it("allowlists the persisted cooking preference", () => {
  expect(normalizeCookingStyle("generous")).toBe("generous");
  expect(normalizeCookingStyle("anything else")).toBe("normal");
});
