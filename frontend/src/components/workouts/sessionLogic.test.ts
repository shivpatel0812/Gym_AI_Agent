import { describe, expect, it, vi } from "vitest";
import {
  buildSessionPayload,
  emptySessionForm,
  getBestSetLabel,
  layoutExercisesFromSession,
  mapRecSets,
  recDropsLastWorkoutLoad,
  recHasApplicableSets,
  recHasWeightedSets,
  recNeedsAlgorithmRefresh,
  toStoredRecommendation,
} from "./sessionLogic";

describe("imported workout auto-save", () => {
  const importedExercises = () =>
    layoutExercisesFromSession({
      date: "2026-09-01",
      exercises: [
        {
          exercise_id: "default-chest-bench-press",
          exercise_name: "Bench Press",
          sets: [
            { set_number: 1, reps: 8, weight: 135 },
            { set_number: 2, reps: 8, weight: 135 },
            { set_number: 3, reps: 8, weight: 135 },
          ],
        },
        {
          exercise_id: "default-chest-cable-fly",
          exercise_name: "Cable Fly",
          sets: [
            { set_number: 1, reps: 12, weight: 30 },
            { set_number: 2, reps: 12, weight: 30 },
          ],
        },
      ],
    });

  it("keeps every empty imported exercise and set row in a draft payload", () => {
    const form = { ...emptySessionForm(), exercises: importedExercises() };

    const payload = buildSessionPayload(form, null, {
      preserveUnloggedExercises: true,
    });

    expect(payload.exercises.map((exercise) => exercise.exercise_name)).toEqual([
      "Bench Press",
      "Cable Fly",
    ]);
    expect(payload.exercises[0].sets).toHaveLength(3);
    expect(payload.exercises[1].sets).toHaveLength(2);
  });

  it("keeps untouched exercises during auto-save but excludes them on finish", () => {
    const exercises = importedExercises();
    const benchSets = exercises[0].sets;
    if (!Array.isArray(benchSets)) throw new Error("expected imported set rows");
    benchSets[0] = { ...benchSets[0], reps: 10, weight: 145, completed: true };
    const form = { ...emptySessionForm(), exercises };

    const draft = buildSessionPayload(form, null, {
      preserveUnloggedExercises: true,
    });
    const completed = buildSessionPayload(form);

    expect(draft.exercises).toHaveLength(2);
    expect(draft.exercises[0].sets).toHaveLength(3);
    expect(completed.exercises.map((exercise) => exercise.exercise_name)).toEqual([
      "Bench Press",
    ]);
    expect(completed.exercises[0].sets).toHaveLength(1);
  });
});

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

  it("detects a cached recommendation that erased a logged added load", () => {
    const lastData = {
      exercise_data: { sets: [{ set_number: 1, reps: 8, weight: 50 }] },
    };
    expect(recDropsLastWorkoutLoad(bodyweightRec, lastData)).toBe(true);
    expect(
      recDropsLastWorkoutLoad(
        { sets: [{ set_number: 1, reps: 9, weight: 50 }] },
        lastData
      )
    ).toBe(false);
  });

  it("refreshes recommendations saved before the current algorithm", () => {
    expect(recNeedsAlgorithmRefresh({ sets: [{ reps: 4, weight: 80 }] })).toBe(true);
    expect(
      recNeedsAlgorithmRefresh({
        algorithm_version: 1,
        sets: [{ reps: 5, weight: 80 }],
      })
    ).toBe(false);
  });

  it("persists the algorithm version with a workout draft", () => {
    expect(toStoredRecommendation({ algorithm_version: 1, sets: [] })).toMatchObject({
      algorithm_version: 1,
    });
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
