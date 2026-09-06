import { describe, expect, it } from "vitest";
import { scaleFoodItem } from "./foodQuantity";
import { extractRecentMeals } from "./recentMeals";
import { localDateKey } from "./localDate";

describe("reusing scanned nutrients", () => {
  const food = { name: "Yogurt", calories: 100, protein: 8, sugar: 6.5, sodium: 85 };
  it("scales sugar and sodium when a saved food is logged again", () => {
    const scaled = scaleFoodItem(food, 3);
    expect(scaled.sugar).toBe(19.5);
    expect(scaled.sodium).toBe(255);
    expect(scaleFoodItem({ ...food, sugar: undefined }, 3).sugar).toBeUndefined();
  });
  it("preserves nutrients on recent meal picks", () => {
    const [pick] = extractRecentMeals([{ date: localDateKey(new Date()), food_items: [food] }]);
    expect(pick.sugar).toBe(6.5);
    expect(pick.sodium).toBe(85);
  });
});
