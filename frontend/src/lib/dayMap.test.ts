/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
vi.mock("../api/client", () => ({ default: {} }));
vi.mock("../../../web-app/src/lib/api-client", () => ({ default: {} }));
import * as native from "./dayMap";
import * as web from "../../../web-app/src/lib/dayMap";

for (const [name, helpers] of [["native", native], ["web", web]] as const) {
  describe(`${name} meal plan weekdays`, () => {
    const plan: any = { id: "plan", goal: "maintain", targets: { calories: 2200, protein: 150 },
      meal_anchors: [
        { id: "breakfast", slot: "breakfast", label: "Breakfast favorites", frequency: "weekdays", foods: [{ name: "Shake", calories: 200 }, { name: "Yogurt" }, { name: "Oatmeal" }] },
        { id: "lunch", slot: "lunch", label: "Sandwich", frequency: "most_days", days: ["mon"], foods: [{ name: "Sandwich" }] },
        { id: "weekend", slot: "breakfast", label: "Weekend eggs", frequency: "weekends", foods: [{ name: "Eggs" }] },
      ],
      go_to_items: [{ id: "shake", slot: "breakfast", name: "Shake", days: ["mon", "sat"] }, { id: "lunch-shake", slot: "lunch", name: "Shake", days: ["mon"] }],
      flexible_meals: [{ id: "dinner", name: "Dinner out", frequency: "weekends" }],
    };
    it("shows weekday and weekend anchors on their actual days", () => {
      const map = helpers.buildDayMap(plan);
      const breakfast = map.sections.find((s) => s.slot === "breakfast")!;
      expect(helpers.mealItemsForDay(breakfast, "mon").anchors.map((a) => a.title)).toEqual(["Breakfast favorites"]);
      expect(helpers.mealItemsForDay(breakfast, "sat").anchors.map((a) => a.title)).toEqual(["Weekend eggs"]);
      const lunch = map.sections.find((s) => s.slot === "lunch")!;
      expect(helpers.mealItemsForDay(lunch, "tue").anchors).toHaveLength(0);
    });
    it("deduplicates a go-to only when the same food is anchored for that meal and day", () => {
      const map = helpers.buildDayMap(plan);
      const breakfast = map.sections.find((s) => s.slot === "breakfast")!;
      expect(helpers.mealItemsForDay(breakfast, "mon").goTos).toHaveLength(0);
      expect(helpers.mealItemsForDay(breakfast, "sat").goTos.map((g) => g.title)).toEqual(["Shake"]);
      expect(map.sections.find((s) => s.slot === "lunch")!.goTos).toHaveLength(1);
      expect(breakfast.goTos).toHaveLength(1); // Still editable in weekly details.
    });
    it("keeps flexible meals and unscheduled options accessible", () => {
      const map = helpers.buildDayMap(plan);
      const dinner = map.sections.find((s) => s.slot === "dinner")!;
      expect(helpers.mealItemsForDay(dinner, "mon").anchors).toHaveLength(0);
      expect(helpers.mealItemsForDay(dinner, "sun").anchors).toHaveLength(1);
      expect(helpers.mealItemsForDay({ ...dinner, goTos: [{ id: "any", kind: "goto", slot: "dinner", title: "Soup", detail: "", days: [] }] }, "wed").goTos).toHaveLength(1);
    });
    it("normalizes schedules without fabricating weekdays", () => {
      expect(helpers.scheduledDays(["Monday", "MON", "invalid"])).toEqual(["mon"]);
      expect(helpers.scheduledDays([], "daily")).toHaveLength(7);
      expect(helpers.scheduledDays([], "most_days")).toEqual([]);
    });
  });
}

it("does not count a go-to twice in the weekly overview", () => {
  const plan: any = { targets: { calories: 2200 }, meal_anchors: [
    { slot: "breakfast", label: "Shake", frequency: "daily", foods: [{ name: "Shake", calories: 200 }] },
  ], go_to_items: [{ slot: "breakfast", name: "Shake", calories: 200, days: ["mon"] }], flexible_meals: [] };
  expect(native.buildDayMap(plan).weeklyBars.find((day) => day.id === "mon")?.calories).toBe(200);
});
