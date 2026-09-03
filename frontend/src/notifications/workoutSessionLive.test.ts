import { describe, expect, it } from "vitest";
import { buildWorkoutLiveSnapshot } from "./workoutSessionSnapshot";
import type { SessionExercise } from "../components/workouts/types";

describe("buildWorkoutLiveSnapshot", () => {
  const exercises: SessionExercise[] = [
    {
      exercise_id: "bench",
      exercise_name: "Bench Press",
      sets: [
        { set_number: 1, reps: 8, weight: 135, completed: true },
        { set_number: 2, reps: 0, completed: false },
        { set_number: 3, reps: 0, completed: false },
      ],
    },
  ];

  it("points at the first incomplete set and formats the prescription", () => {
    const snap = buildWorkoutLiveSnapshot(
      exercises,
      {
        bench: {
          sets: [
            { set_number: 1, reps: 8, weight: 135 },
            { set_number: 2, reps: 8, weight: 135 },
            { set_number: 3, reps: 8, weight: 135 },
          ],
        },
      },
      { dayLabel: "Push", elapsedSeconds: 125, isRunning: true }
    );
    expect(snap).toMatchObject({
      exerciseName: "Bench Press",
      setLabel: "Set 2 of 3",
      prescription: "135 × 8",
      exerciseIdx: 0,
      setIdx: 1,
      isRunning: true,
    });
  });

  it("returns null when there are no exercises", () => {
    expect(
      buildWorkoutLiveSnapshot([], {}, { elapsedSeconds: 0, isRunning: false })
    ).toBeNull();
  });
});
