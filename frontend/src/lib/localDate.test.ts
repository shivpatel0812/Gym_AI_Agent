import { describe, expect, it } from "vitest";
import { localDateKey } from "./localDate";
import { localDateKey as webDateKey } from "../../../web-app/src/lib/localDate";

describe("local logging dates on both clients", () => {
  it.each([
    ["America/New_York", "2026-09-04T21:30:00-04:00", "2026-09-04"],
    ["Asia/Tokyo", "2026-09-01T00:30:00+09:00", "2026-09-01"],
    ["America/New_York", "2026-03-08T01:59:00-05:00", "2026-03-08"],
    ["America/New_York", "2026-03-08T03:01:00-04:00", "2026-03-08"],
    ["Pacific/Auckland", "2027-01-01T00:01:00+13:00", "2027-01-01"],
  ])("keeps the calendar day in %s at %s", (zone, instant, expected) => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = zone;
      expect(localDateKey(new Date(instant))).toBe(expected);
      expect(webDateKey(new Date(instant))).toBe(expected);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
