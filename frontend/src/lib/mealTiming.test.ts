import { describe, expect, it } from "vitest";
import {
  dropTargetAt,
  foodClockLabel,
  formatClockMinutes,
  formatDuration,
  isMoved,
  moveFoodToMeal,
  replaceFoodAt,
} from "./mealTiming";
import type { FoodItem } from "../components/nutrition/types";

const banana = (extra: Partial<FoodItem> = {}): FoodItem => ({
  name: "Banana",
  calories: 105,
  protein: 1,
  meal: "Snacks",
  ...extra,
});

describe("moveFoodToMeal", () => {
  it("records the slot the app chose, not the last stop on the way", () => {
    // Snacks -> Dinner -> Pre-workout. The mis-filing was "snack", and
    // overwriting the origin at each hop would report dinner as the mistake.
    const first = moveFoodToMeal(banana(), "Dinner");
    const second = moveFoodToMeal(first, "Pre-Workout");
    expect(second.moved_from).toBe("Snacks");
    expect(second.meal).toBe("Pre-Workout");
    expect(second.slot_source).toBe("user");
  });

  it("clears the marks when the food goes back where it started", () => {
    const moved = moveFoodToMeal(banana(), "Dinner");
    const back = moveFoodToMeal(moved, "Snacks");
    expect(back.moved_from).toBeUndefined();
    expect(back.slot_source).toBeUndefined();
    expect(back.meal).toBe("Snacks");
  });

  it("treats a same-slot move as a no-op", () => {
    const food = banana({ meal: "Pre-Workout" });
    // "Shake" and "Pre-Workout" are the same slot — nothing changed.
    expect(moveFoodToMeal(food, "Shake")).toBe(food);
    expect(moveFoodToMeal(food, "Pre-Workout")).toBe(food);
  });

  it("keeps every other field on the row", () => {
    const food = banana({ usual_id: "u1", quantity: 2, logged_at: "2026-09-04T15:00:00Z" });
    const moved = moveFoodToMeal(food, "Dinner");
    expect(moved.usual_id).toBe("u1");
    expect(moved.quantity).toBe(2);
    expect(moved.logged_at).toBe("2026-09-04T15:00:00Z");
  });

  it("does not mutate the row it was handed", () => {
    const food = banana();
    moveFoodToMeal(food, "Dinner");
    expect(food.meal).toBe("Snacks");
    expect(food.moved_from).toBeUndefined();
  });

  it("does not invent an origin for a row that never had a slot", () => {
    const moved = moveFoodToMeal(banana({ meal: undefined }), "Dinner");
    expect(moved.moved_from).toBeUndefined();
    expect(moved.slot_source).toBe("user");
  });
});

describe("isMoved", () => {
  it("is false for a row sitting where the app put it", () => {
    expect(isMoved(banana())).toBe(false);
  });

  it("is false when the origin and the current slot are the same slot", () => {
    expect(isMoved(banana({ meal: "Pre-Workout", moved_from: "Shake" }))).toBe(false);
  });

  it("is true once the row sits elsewhere", () => {
    expect(isMoved(moveFoodToMeal(banana(), "Dinner"))).toBe(true);
  });
});

describe("replaceFoodAt", () => {
  it("swaps one row and leaves the rest alone", () => {
    const items = [banana({ name: "A" }), banana({ name: "B" }), banana({ name: "C" })];
    const next = replaceFoodAt(items, 1, banana({ name: "B2" }));
    expect(next.map((f) => f.name)).toEqual(["A", "B2", "C"]);
  });

  it("strips the server-computed fit from every row on the way out", () => {
    const items = [
      banana({ fit: { score: 70, band: "good", reason: "" } }),
      banana({ fit: { score: 40, band: "poor", reason: "" } }),
    ];
    const next = replaceFoodAt(items, 0, banana());
    expect(next.every((f) => !("fit" in f))).toBe(true);
  });
});

describe("foodClockLabel", () => {
  it("reads the log time when it lands on the day being logged", () => {
    const at = new Date(2026, 8, 4, 7, 42).toISOString();
    expect(foodClockLabel(banana({ logged_at: at }), "2026-09-04")).toMatch(/7:42/);
  });

  it("shows nothing for a day filled in after the fact", () => {
    // Logged Wednesday morning, filed under Tuesday: the write time says
    // nothing about when dinner happened.
    const at = new Date(2026, 8, 4, 9, 14).toISOString();
    expect(foodClockLabel(banana({ logged_at: at }), "2026-09-03")).toBeNull();
  });

  it("takes an explicit eaten_at even on a backfilled day", () => {
    const label = foodClockLabel(
      banana({
        logged_at: new Date(2026, 8, 4, 9, 14).toISOString(),
        eaten_at: new Date(2026, 8, 3, 18, 30).toISOString(),
      }),
      "2026-09-03"
    );
    expect(label).toMatch(/6:30/);
  });

  it("shows nothing rather than a placeholder when there is no timestamp", () => {
    expect(foodClockLabel(banana(), "2026-09-04")).toBeNull();
    expect(foodClockLabel(banana({ logged_at: "not a date" }), "2026-09-04")).toBeNull();
  });
});

describe("dropTargetAt", () => {
  const zones = [
    { id: "Breakfast", x: 0, y: 100, width: 70, height: 60 },
    { id: "Lunch", x: 70, y: 100, width: 70, height: 60 },
  ];

  it("finds the zone under the finger", () => {
    expect(dropTargetAt(35, 130, zones)).toBe("Breakfast");
    expect(dropTargetAt(100, 130, zones)).toBe("Lunch");
  });

  it("returns null outside every zone, so a stray drop cancels", () => {
    expect(dropTargetAt(35, 40, zones)).toBeNull();
    expect(dropTargetAt(400, 130, zones)).toBeNull();
    expect(dropTargetAt(35, 130, [])).toBeNull();
  });
});

describe("formatting", () => {
  it("formats clock minutes across noon and midnight", () => {
    expect(formatClockMinutes(0)).toBe("12:00 AM");
    expect(formatClockMinutes(12 * 60)).toBe("12:00 PM");
    expect(formatClockMinutes(13 * 60 + 5)).toBe("1:05 PM");
    expect(formatClockMinutes(null)).toBeNull();
  });

  it("formats a span in hours and minutes", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(80)).toBe("1h 20m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(undefined)).toBeNull();
  });
});
