import { describe, expect, it } from "vitest";

import {
  adjustPhotoEstimate,
  normalizeCookingStyle,
  PhotoEstimate,
  scalePhotoEstimate,
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
    source: "photo",
    confidence: { score: 65, level: "medium", reasons: [], shouldNudge: false },
    cookingStyle: "normal",
    oilGrams: 10,
    portionLowGrams: 320,
    portionHighGrams: 500,
    assumptions: [],
    uncertainties: [],
    matchedSavedFood: false,
    uncounted: [],
    components: [
      { name: "Rice", amount: "1 cup", calories: 400, protein: 8, carbs: 70, fats: 8, fiber: 2 },
      { name: "Chicken", amount: "100g", calories: 200, protein: 17, carbs: 10, fats: 12, fiber: 6 },
    ],
  },
};

describe("the user's own calorie figure", () => {
  it("carries a whole-meal disagreement through to the card", () => {
    const parsed = toPhotoEstimate({
      food: { name: "Frankie wraps", calories: 1100, protein: 30, carbs: 90, fats: 55, fiber: 8 },
      analysis: {
        source: "text",
        hint_check: {
          stated_calories: 600,
          estimated_calories: 1100,
          difference_ratio: 0.833,
          direction: "higher",
          disagrees: true,
          reason: "about 400 kcal of it is the frying oil",
        },
      },
    });

    expect(parsed?.analysis.source).toBe("text");
    expect(parsed?.analysis.hintCheck?.statedCalories).toBe(600);
    expect(parsed?.analysis.hintCheck?.disagrees).toBe(true);
    expect(parsed?.analysis.hintCheck?.reason).toContain("frying oil");
  });

  it("leaves the field absent when the user gave no figure", () => {
    const parsed = toPhotoEstimate({
      food: { name: "Rice", calories: 200, protein: 4 },
      analysis: { source: "photo" },
    });
    expect(parsed?.analysis.hintCheck).toBeUndefined();
    expect(parsed?.analysis.source).toBe("photo");
  });

  it("drops an unexplained gap rather than inventing a reason for it", () => {
    const parsed = toPhotoEstimate({
      food: { name: "Thali", calories: 900, protein: 30 },
      analysis: {
        source: "text",
        hint_check: {
          stated_calories: 600,
          estimated_calories: 900,
          difference_ratio: 0.5,
          direction: "higher",
          disagrees: true,
          reason: "",
        },
      },
    });
    expect(parsed?.analysis.hintCheck?.disagrees).toBe(true);
    expect(parsed?.analysis.hintCheck?.reason).toBeUndefined();
  });
});

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

  it("keeps the per-item breakdown the backend already computed", () => {
    const parsed = toPhotoEstimate({
      food: { name: "Thali", calories: 650, protein: 22, carbs: 100, fats: 17 },
      analysis: {
        components: [
          { name: "Chapati", amount: "1 medium", calories: 130, protein: 4, carbs: 26, fats: 1 },
          { item: "Kadhi", calories: 300, protein: 10, carbs: 40, fats: 11 },
          { name: "", calories: 50 },
        ],
      },
    });

    expect(parsed?.analysis.components).toHaveLength(2);
    expect(parsed?.analysis.components[0].name).toBe("Chapati");
    // The backend emits "item"; the vision prompt and the adjust chat both use
    // that key, so dropping those rows would silently halve the ledger.
    expect(parsed?.analysis.components[1].name).toBe("Kadhi");
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

  it("keeps the ledger summing to the displayed calories", () => {
    const smaller = adjustPhotoEstimate(estimate, "smaller", "normal");
    const sum = smaller.analysis.components.reduce((total, c) => total + c.calories, 0);
    expect(sum).toBe(smaller.calories);
  });

  it("books a cooking-style change as its own oil line", () => {
    const light = adjustPhotoEstimate(estimate, "estimated", "light");
    const oil = light.analysis.components.find((c) => c.name.startsWith("Cooking oil"));
    expect(oil?.calories).toBe(-45);
    const sum = light.analysis.components.reduce((total, c) => total + c.calories, 0);
    expect(sum).toBe(light.calories);
  });

  it("drops the ledger when a manual macro edit overrides it", () => {
    const manual = adjustPhotoEstimate(estimate, "estimated", "normal", { calories: 575 });
    expect(manual.analysis.components).toEqual([]);
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


describe("serving multiples", () => {
  it("scales grams alongside the macros", () => {
    const tripled = scalePhotoEstimate(estimate, 3);

    expect(tripled.calories).toBe(1800);
    expect(tripled.protein).toBe(75);
    // The bug this pins: grams left at 1x while calories tripled makes the
    // saved food's density wrong by 3x on every future re-log.
    expect(tripled.estimatedGrams).toBe(1200);
  });

  it("scales the component ledger with the total", () => {
    const doubled = scalePhotoEstimate(estimate, 2);
    const sum = doubled.analysis.components.reduce((t, c) => t + c.calories, 0);

    expect(sum).toBe(doubled.calories);
  });

  it("labels the multiple in the amount", () => {
    expect(scalePhotoEstimate(estimate, 2).amount).toBe("2x 1 bowl");
  });

  it("is a no-op at one serving", () => {
    expect(scalePhotoEstimate(estimate, 1)).toBe(estimate);
  });

  it("ignores a nonsense serving count", () => {
    expect(scalePhotoEstimate(estimate, 0)).toBe(estimate);
    expect(scalePhotoEstimate(estimate, NaN)).toBe(estimate);
  });
});

describe("uncounted items", () => {
  it("carries the model's own list of food it saw and did not cost", () => {
    const parsed = toPhotoEstimate({
      food: { name: "Khichdi", calories: 600, protein: 14 },
      analysis: {
        scene: {
          items_seen: ["khichdi", "katori of yogurt"],
          uncounted: ["katori of yogurt"],
        },
      },
    });
    expect(parsed?.analysis.uncounted).toEqual(["katori of yogurt"]);
  });

  it("is empty for the older prompts, which are never asked for an inventory", () => {
    const parsed = toPhotoEstimate({
      food: { name: "Khichdi", calories: 600, protein: 14 },
      analysis: { components: [] },
    });
    expect(parsed?.analysis.uncounted).toEqual([]);
  });
});

describe("sugar and sodium", () => {
  it("keeps unknown values distinct from zero", () => {
    const parsed = toPhotoEstimate({ name: "Meal", sugar: null, sodium: "" })!;
    expect(parsed.sugar).toBeUndefined();
    expect(parsed.sodium).toBeUndefined();
    expect(scalePhotoEstimate(parsed, 3).sodium).toBeUndefined();
    const zero = toPhotoEstimate({ name: "Meal", sugar: 0, sodium: 0 })!;
    expect(zero.sugar).toBe(0);
    expect(zero.sodium).toBe(0);
  });

  it("scales nutrients with the portion and servings, but not cooking oil", () => {
    const base = { ...estimate, sugar: 12.5, sodium: 600 };
    const smaller = adjustPhotoEstimate(base, "smaller", "generous");
    expect(smaller.sugar).toBe(10);
    expect(smaller.sodium).toBe(480);
    const twice = scalePhotoEstimate(smaller, 2);
    expect(twice.sugar).toBe(20);
    expect(twice.sodium).toBe(960);
    expect(adjustPhotoEstimate(base, "estimated", "light").sodium).toBe(600);
  });

  it("carries component nutrients and rejects malformed values", () => {
    const parsed = toPhotoEstimate({
      food: { name: "Meal", sugar: -5, sodium: Infinity },
      analysis: { components: [{ name: "Rice", sugar: 1.5, sodium: 200 }] },
    })!;
    expect(parsed.sugar).toBeUndefined();
    expect(parsed.sodium).toBeUndefined();
    const scaled = scalePhotoEstimate(parsed, 2).analysis.components[0];
    expect(scaled.sugar).toBe(3);
    expect(scaled.sodium).toBe(400);
  });
});
