import type { PlanDay, PlanExercise } from "../../api/trainingPlan";

function identity(exercise: { exercise_id?: string; exercise_name?: string }) {
  return (exercise.exercise_id || exercise.exercise_name || "").trim().toLowerCase();
}

export function exerciseAlreadyOnDay(day: PlanDay, exerciseId: string, exerciseName: string) {
  const wanted = new Set(
    [exerciseId, exerciseName].map((value) => value.trim().toLowerCase()).filter(Boolean)
  );
  return day.exercises.some((exercise) => wanted.has(identity(exercise)));
}

export function addExerciseToDay(
  days: PlanDay[],
  dayName: string,
  exercise: Pick<PlanExercise, "exercise_id" | "exercise_name">
): PlanDay[] {
  return days.map((day) => {
    if (day.day_name !== dayName) return day;
    if (exerciseAlreadyOnDay(day, exercise.exercise_id, exercise.exercise_name)) {
      return day;
    }
    const last = day.exercises[day.exercises.length - 1];
    const next: PlanExercise = {
      exercise_id: exercise.exercise_id,
      exercise_name: exercise.exercise_name,
      sets: last?.sets || 3,
      reps: last?.reps || 10,
      order: day.exercises.length + 1,
      target_rep_range: last?.target_rep_range || [8, 12],
      priority: "supporting",
    };
    return { ...day, exercises: [...day.exercises, next] };
  });
}

export function removeExerciseFromDay(
  days: PlanDay[],
  dayName: string,
  exercise: Pick<PlanExercise, "exercise_id" | "exercise_name" | "order">
): PlanDay[] {
  return days.map((day) => {
    if (day.day_name !== dayName) return day;
    const remaining = day.exercises.filter((item) => item.order !== exercise.order);
    return {
      ...day,
      exercises: remaining.map((item, index) => ({ ...item, order: index + 1 })),
    };
  });
}

export function addExerciseToDays(
  days: PlanDay[],
  dayNames: string[],
  exercise: Pick<PlanExercise, "exercise_id" | "exercise_name">
): PlanDay[] {
  let next = days;
  for (const dayName of dayNames) {
    next = addExerciseToDay(next, dayName, exercise);
  }
  return next;
}

export function lastLiftConflict(
  days: PlanDay[],
  removals: Array<{ day_name: string; order: number }>
): string | null {
  const byDay = new Map<string, Set<number>>();
  for (const removal of removals) {
    const orders = byDay.get(removal.day_name) || new Set();
    orders.add(removal.order);
    byDay.set(removal.day_name, orders);
  }
  for (const day of days) {
    const orders = byDay.get(day.day_name);
    if (!orders) continue;
    const remaining = day.exercises.filter((exercise) => !orders.has(exercise.order)).length;
    if (remaining === 0) {
      return `Can't remove the last lift on ${day.day_name}. Add another first.`;
    }
  }
  return null;
}

export function removeExercisesFromDays(
  days: PlanDay[],
  removals: Array<{ day_name: string; order: number }>
): PlanDay[] {
  const byDay = new Map<string, Set<number>>();
  for (const removal of removals) {
    const orders = byDay.get(removal.day_name) || new Set();
    orders.add(removal.order);
    byDay.set(removal.day_name, orders);
  }
  return days.map((day) => {
    const orders = byDay.get(day.day_name);
    if (!orders) return day;
    const remaining = day.exercises.filter((exercise) => !orders.has(exercise.order));
    return {
      ...day,
      exercises: remaining.map((exercise, index) => ({ ...exercise, order: index + 1 })),
    };
  });
}

/** Strip projection-only fields so a PATCH does not write history into the plan. */
export function planDaysFromProjection(
  days: Array<{
    day_name: string;
    focus?: string;
    day_goal?: string;
    day_type?: string;
    goal?: string;
    estimated_duration_minutes?: number;
    exercises: Array<{
      exercise_id: string;
      exercise_name: string;
      sets?: number;
      reps?: number;
      order?: number;
      notes?: string;
      goal?: string;
      priority?: string;
      target_rep_range?: [number, number];
      intensity?: string;
      target_weight?: number | null;
      target_reps?: number | null;
      target_weeks?: number | null;
    }>;
  }>
): PlanDay[] {
  return days.map((day) => ({
    day_name: day.day_name,
    focus: day.focus || day.day_name,
    day_goal: day.day_goal,
    day_type: day.day_type,
    goal: day.goal,
    estimated_duration_minutes: day.estimated_duration_minutes,
    exercises: day.exercises.map((exercise) => ({
      exercise_id: exercise.exercise_id,
      exercise_name: exercise.exercise_name,
      sets: exercise.sets ?? 3,
      reps: exercise.reps ?? 10,
      order: exercise.order ?? 1,
      notes: exercise.notes,
      goal: exercise.goal,
      priority: (["high", "supporting", "normal"].includes(String(exercise.priority || ""))
        ? (exercise.priority as PlanExercise["priority"])
        : undefined),
      target_rep_range: exercise.target_rep_range,
      intensity: exercise.intensity,
      target_weight: exercise.target_weight,
      target_reps: exercise.target_reps,
      target_weeks: exercise.target_weeks,
    })),
  }));
}

export function lockedListPrompt(planName: string, days: PlanDay[]) {
  const lines = days
    .filter((day) => day.exercises.length)
    .map(
      (day) =>
        `- ${day.day_name}: ${day.exercises.map((exercise) => exercise.exercise_name).join(", ")}`
    );
  return (
    `I've edited the exercise list on the draft "${planName}" by hand. ` +
    `Keep these lifts unless I ask otherwise:\n${lines.join("\n")}\n` +
    `Fill in sets, rep ranges, and goals from here.`
  );
}
