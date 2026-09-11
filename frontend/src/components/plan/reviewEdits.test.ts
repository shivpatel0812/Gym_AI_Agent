import { describe, expect, it } from "vitest";
import type { PlanDay } from "../../api/trainingPlan";
import {
  addExerciseToDay,
  addExerciseToDays,
  exerciseAlreadyOnDay,
  lastLiftConflict,
  lockedListPrompt,
  planDaysFromProjection,
  removeExerciseFromDay,
  removeExercisesFromDays,
} from "./reviewEdits";

function day(name: string, names: string[]): PlanDay {
  return {
    day_name: name,
    focus: name,
    exercises: names.map((exerciseName, index) => ({
      exercise_id: `id-${exerciseName}`,
      exercise_name: exerciseName,
      sets: 3,
      reps: 8,
      order: index + 1,
    })),
  };
}

describe("reviewEdits", () => {
  it("adds an exercise to the named day and inherits the last set scheme", () => {
    const days = [
      day("Push A", ["Incline Press"]),
      day("Pull A", ["Rows"]),
    ];
    days[0].exercises[0].sets = 4;
    days[0].exercises[0].target_rep_range = [4, 6];
    const next = addExerciseToDay(days, "Push A", {
      exercise_id: "default-chest-cable-fly-mid",
      exercise_name: "Cable Chest Fly (Mid)",
    });
    expect(next[0].exercises.map((ex) => ex.exercise_name)).toEqual([
      "Incline Press",
      "Cable Chest Fly (Mid)",
    ]);
    expect(next[0].exercises[1].sets).toBe(4);
    expect(next[0].exercises[1].target_rep_range).toEqual([4, 6]);
    expect(next[1].exercises).toHaveLength(1);
  });

  it("does not add a duplicate on the same day", () => {
    const days = [day("Push A", ["Incline Press"])];
    const next = addExerciseToDay(days, "Push A", {
      exercise_id: "id-Incline Press",
      exercise_name: "Incline Press",
    });
    expect(next[0].exercises).toHaveLength(1);
    expect(exerciseAlreadyOnDay(days[0], "id-Incline Press", "Incline Press")).toBe(true);
  });

  it("removes an exercise and reorders the rest", () => {
    const days = [day("Push A", ["Press", "Dips", "Fly"])];
    const next = removeExerciseFromDay(days, "Push A", days[0].exercises[1]);
    expect(next[0].exercises.map((ex) => ex.exercise_name)).toEqual(["Press", "Fly"]);
    expect(next[0].exercises.map((ex) => ex.order)).toEqual([1, 2]);
  });

  it("names the locked list for the coach", () => {
    const prompt = lockedListPrompt("Strength Block", [
      day("Push A", ["Press", "Fly"]),
      day("Pull A", ["Rows"]),
    ]);
    expect(prompt).toContain("Push A: Press, Fly");
    expect(prompt).toContain("Pull A: Rows");
    expect(prompt).toContain("Fill in sets");
  });

  it("adds a lift to every named session", () => {
    const days = [day("Push A", ["Press"]), day("Push B", ["Press"])];
    const next = addExerciseToDays(days, ["Push A", "Push B"], {
      exercise_id: "fly",
      exercise_name: "Fly",
    });
    expect(next[0].exercises.map((ex) => ex.exercise_name)).toEqual(["Press", "Fly"]);
    expect(next[1].exercises.map((ex) => ex.exercise_name)).toEqual(["Press", "Fly"]);
  });

  it("refuses to empty a day and otherwise removes across sessions", () => {
    const days = [day("Push A", ["Press"]), day("Push B", ["Press", "Fly"])];
    expect(
      lastLiftConflict(days, [{ day_name: "Push A", order: 1 }])
    ).toMatch(/last lift on Push A/);
    const next = removeExercisesFromDays(days, [
      { day_name: "Push B", order: 2 },
    ]);
    expect(next[1].exercises.map((ex) => ex.exercise_name)).toEqual(["Press"]);
  });

  it("strips projection-only fields before a plan write", () => {
    const days = planDaysFromProjection([
      {
        day_name: "Push A",
        focus: "Chest",
        exercises: [
          {
            exercise_id: "press",
            exercise_name: "Press",
            sets: 4,
            reps: 6,
            order: 1,
            // @ts-expect-error leftover projection payload must not be copied
            recent_sessions: [{ date: "2026-09-04" }],
          },
        ],
      },
    ]);
    expect(days[0].exercises[0]).toEqual({
      exercise_id: "press",
      exercise_name: "Press",
      sets: 4,
      reps: 6,
      order: 1,
      notes: undefined,
      goal: undefined,
      priority: undefined,
      target_rep_range: undefined,
      intensity: undefined,
      target_weight: undefined,
      target_reps: undefined,
      target_weeks: undefined,
    });
  });
});
