import { describe, expect, it } from "vitest";
import type { ProjectedDay, ProjectedExercise } from "../../api/trainingPlan";
import { groupDaysByFamily } from "./dayFamilies";
import {
  familySessionLabels,
  groupFamilyExercises,
  mergeSessionVariants,
} from "./familyExercises";

function exercise(
  partial: Partial<ProjectedExercise> & Pick<ProjectedExercise, "exercise_id" | "exercise_name">
): ProjectedExercise {
  return {
    sets: 3,
    reps: 8,
    order: 1,
    day_name: partial.day_name || "Push A",
    sessions_per_week: 1,
    seeded_from_history: true,
    current: null,
    best_case: [],
    realistic: [],
    gain: {
      best_case_e1rm: 0,
      realistic_e1rm: 0,
      best_case_pct: null,
      realistic_pct: null,
    },
    ...partial,
  };
}

function day(name: string, exercises: ProjectedExercise[]): ProjectedDay {
  return {
    day_name: name,
    focus: name.includes("B") ? "Volume" : "Strength",
    sessions_per_week: 1,
    exercises,
  };
}

describe("groupFamilyExercises", () => {
  it("merges the same lift on Push A and Push B into one session_variants group", () => {
    const family = groupDaysByFamily([
      day("Push A", [
        exercise({
          exercise_id: "incline",
          exercise_name: "Incline Dumbbell Press",
          day_name: "Push A",
        }),
        exercise({
          exercise_id: "laterals",
          exercise_name: "Cable Lateral Raises",
          day_name: "Push A",
        }),
      ]),
      day("Push B", [
        exercise({
          exercise_id: "incline",
          exercise_name: "Incline Dumbbell Press",
          day_name: "Push B",
          priority: "high",
        }),
      ]),
    ])[0];

    const groups = groupFamilyExercises(family);
    expect(groups).toHaveLength(2);
    const incline = groups.find((group) =>
      group.exercises.some((item) => item.exercise_id === "incline")
    )!;
    expect(incline.kind).toBe("session_variants");
    expect(incline.exercises).toHaveLength(2);
    expect(incline.dayNames).toEqual(["Push A", "Push B"]);
    expect(familySessionLabels(incline.dayNames, "push")).toBe(
      "Session A · Session B"
    );
  });

  it("merges Weighted Dips across A/B even when exercise_ids differ", () => {
    const family = groupDaysByFamily([
      day("Push A", [
        exercise({
          exercise_id: "default-triceps-bw-parallel-dips",
          exercise_name: "Weighted Dips",
          day_name: "Push A",
        }),
      ]),
      day("Push B", [
        exercise({
          exercise_id: "custom-weighted-dips-xyz",
          exercise_name: "Weighted Dips",
          day_name: "Push B",
        }),
      ]),
    ])[0];

    const groups = groupFamilyExercises(family);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("session_variants");
    expect(groups[0].exercises).toHaveLength(2);
  });

  it("keeps weighted + bodyweight on the same day as dual_track", () => {
    const family = groupDaysByFamily([
      day("Pull", [
        exercise({
          exercise_id: "pullups",
          exercise_name: "Weighted Pull-Ups",
          day_name: "Pull",
        }),
        exercise({
          exercise_id: "pullups",
          exercise_name: "Pull-Ups",
          day_name: "Pull",
        }),
      ]),
    ])[0];

    const groups = groupFamilyExercises(family);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("dual_track");
  });
});

describe("mergeSessionVariants", () => {
  it("renumbers schedules so Workout 1 and Workout 2 share one table", () => {
    const merged = mergeSessionVariants([
      exercise({
        exercise_id: "incline",
        exercise_name: "Incline Dumbbell Press",
        day_name: "Push A",
        schedule: [
          {
            week: 1,
            weight: 80,
            reps: 6,
            e1rm: 96,
            session: 1,
            sets: [{ weight: 80, reps: 6 }],
          },
        ],
      }),
      exercise({
        exercise_id: "incline",
        exercise_name: "Incline Dumbbell Press",
        day_name: "Push B",
        schedule: [
          {
            week: 1,
            weight: 70,
            reps: 10,
            e1rm: 93,
            session: 1,
            sets: [
              { weight: 70, reps: 10 },
              { weight: 70, reps: 10 },
            ],
          },
        ],
      }),
    ]);

    expect(merged.sessions_per_week).toBe(2);
    expect(merged.schedule?.map((point) => point.session)).toEqual([1, 2]);
    expect(merged.schedule?.[0].weight).toBe(80);
    expect(merged.schedule?.[1].weight).toBe(70);
  });

  it("does not double logged sets when A and B share the same history", () => {
    const sharedHistory = [
      {
        date: "2026-09-04",
        sets: [
          { set_number: 1, weight: 80, reps: 6 },
          { set_number: 2, weight: 80, reps: 4 },
          { set_number: 3, weight: 75, reps: 6 },
          { set_number: 4, weight: 70, reps: 7 },
        ],
      },
    ];
    const merged = mergeSessionVariants([
      exercise({
        exercise_id: "incline",
        exercise_name: "Incline Dumbbell Press",
        day_name: "Push A",
        recent_sessions: sharedHistory,
      }),
      exercise({
        exercise_id: "incline",
        exercise_name: "Incline Dumbbell Press",
        day_name: "Push B",
        recent_sessions: sharedHistory,
      }),
    ]);

    expect(merged.recent_sessions).toHaveLength(1);
    expect(merged.recent_sessions?.[0].sets).toHaveLength(4);
  });
});
