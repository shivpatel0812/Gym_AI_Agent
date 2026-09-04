import { describe, expect, it, vi } from "vitest";
import {
  emptySessionForm,
  getBestSetLabel,
  mapRecSets,
  recHasApplicableSets,
  recHasWeightedSets,
} from "./sessionLogic";

describe("workout date defaults", () => {
  it("uses the device calendar instead of the UTC date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 23, 30, 0));
    try {
      expect(emptySessionForm().date).toBe("2026-09-03");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getBestSetLabel", () => {
  it("names the set the estimated 1RM was computed from", () => {
    // Not the heaviest set in max_per_set — the two stats have to agree.
    const label = getBestSetLabel({
      best_e1rm: 171,
      best_e1rm_set: { weight: 135, reps: 8 },
      max_per_set: { 1: { weight: 150, reps: 3 } },
    });
    expect(label).toBe("135 × 8");
  });

  it("falls back to the heaviest logged set for older records", () => {
    expect(getBestSetLabel({ max_per_set: { 1: { weight: 150, reps: 3 } } })).toBe(
      "150 × 3"
    );
  });

  it("has nothing to show without any loaded set", () => {
    expect(getBestSetLabel({ max_per_set: {} })).toBeNull();
    expect(getBestSetLabel(null)).toBeNull();
  });
});

describe("applying a recommendation", () => {
  const bodyweightRec = { sets: [{ set_number: 1, reps: 12, weight: 0 }] };

  it("offers Apply on a bodyweight prescription", () => {
    // Gating on weight > 0 hid the button on every pull-up and dip, where reps
    // are the whole prescription.
    expect(recHasApplicableSets(bodyweightRec)).toBe(true);
  });

  it("still reports that no load was prescribed", () => {
    // The starting-weight prompt depends on this staying a question about load.
    expect(recHasWeightedSets(bodyweightRec)).toBe(false);
  });

  it("has nothing to apply from an empty prescription", () => {
    expect(recHasApplicableSets({ sets: [] })).toBe(false);
    expect(recHasApplicableSets(undefined)).toBe(false);
  });

  it("leaves the load field blank rather than writing a literal 0", () => {
    expect(mapRecSets(bodyweightRec)[0].weight).toBeUndefined();
    expect(mapRecSets({ sets: [{ reps: 8, weight: 95 }] })[0].weight).toBe(95);
  });
});
