import { describe, expect, it } from "vitest";
import { swapScheduleDays } from "./weekSchedule";

describe("swapScheduleDays", () => {
  it("swaps two weekday assignments and fills missing days with Rest", () => {
    const next = swapScheduleDays(
      { monday: "Push", tuesday: "Pull" },
      "monday",
      "wednesday"
    );
    expect(next.monday).toBe("Rest");
    expect(next.wednesday).toBe("Push");
    expect(next.tuesday).toBe("Pull");
    expect(next.sunday).toBe("Rest");
  });

  it("is a no-op when from and to are the same day", () => {
    const schedule = { monday: "Push", tuesday: "Rest" };
    expect(swapScheduleDays(schedule, "monday", "monday")).toBe(schedule);
  });
});
