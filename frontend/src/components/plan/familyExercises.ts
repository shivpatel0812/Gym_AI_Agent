/**
 * Flatten Push A / Push B (etc.) into one exercise list for the family page.
 *
 * The same lift on both variants becomes one card whose detail shows Workout 1
 * and Workout 2 together — not two separate "Session A" / "Session B" stacks.
 */

import { variantCaption, type DayFamily } from "./dayFamilies";
import type { ProjectedDay, ProjectedExercise, WeekPoint } from "../../api/trainingPlan";

export type FamilyExerciseGroup = {
  key: string;
  exercises: ProjectedExercise[];
  dayNames: string[];
  /** single day copy | same lift on A and B | weighted + bodyweight dual track */
  kind: "single" | "session_variants" | "dual_track";
};

type Entry = { exercise: ProjectedExercise; dayName: string; index: number };

/** "Weighted Dips" and "Dips" are the same movement for grouping. */
export function normalizeExerciseName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/^weighted\s+/i, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Group key for one exercise.
 *
 * Prefer the normalized name. Catalog/custom ids for the same lift often
 * differ across Push A and Push B ("Weighted Dips" twice with two ids), and
 * keying on id alone left duplicate cards on the family page.
 */
export function exerciseGroupKey(exercise: ProjectedExercise): string {
  const byName = normalizeExerciseName(exercise.exercise_name);
  if (byName) return `name:${byName}`;
  const id = String(exercise.exercise_id || "").trim();
  if (id) return `id:${id}`;
  return `anon:${exercise.exercise_name || "exercise"}`;
}

/**
 * True when two rows are the same lift — shared normalized name, or the same
 * non-empty exercise_id (weighted + bodyweight pull-ups share an id).
 */
export function sameFamilyLift(a: ProjectedExercise, b: ProjectedExercise): boolean {
  const nameA = normalizeExerciseName(a.exercise_name);
  const nameB = normalizeExerciseName(b.exercise_name);
  if (nameA && nameB && nameA === nameB) return true;
  const idA = String(a.exercise_id || "").trim();
  const idB = String(b.exercise_id || "").trim();
  return Boolean(idA && idB && idA === idB);
}

export function groupFamilyExercises(
  family: DayFamily<ProjectedDay>
): FamilyExerciseGroup[] {
  const entries: Entry[] = [];
  let index = 0;
  for (const day of family.days) {
    for (const exercise of day.exercises || []) {
      entries.push({ exercise, dayName: day.day_name, index: index++ });
    }
  }

  // Union-find so "same name" OR "same id" both collapse into one card —
  // Weighted Dips on A/B often carry different ids, while dual-track pull-ups
  // share an id under two names.
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    let cursor = i;
    while (cursor !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (sameFamilyLift(entries[i].exercise, entries[j].exercise)) {
        union(i, j);
      }
    }
  }

  const buckets = new Map<number, Entry[]>();
  const order: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const root = find(i);
    if (!buckets.has(root)) {
      order.push(root);
      buckets.set(root, []);
    }
    buckets.get(root)!.push(entries[i]);
  }

  return order.map((root) => {
    const items = buckets.get(root)!.sort((a, b) => a.index - b.index);
    const dayNames = [...new Set(items.map((item) => item.dayName))];
    const exercises = items.map((item) => item.exercise);
    let kind: FamilyExerciseGroup["kind"] = "single";
    if (exercises.length > 1) {
      kind = dayNames.length > 1 ? "session_variants" : "dual_track";
    }
    return {
      key: exerciseGroupKey(exercises[0]),
      exercises,
      dayNames,
      kind,
    };
  });
}

/** Labels like "Session A · Session B" for a multi-variant card. */
export function familySessionLabels(
  dayNames: string[],
  familyKey: string
): string {
  const labels = dayNames.map((name) => {
    const caption = variantCaption(name, familyKey);
    if (!caption) return name;
    if (/^(a|b|1|2|heavy|volume)$/i.test(caption)) {
      return `Session ${caption.toUpperCase()}`;
    }
    return caption;
  });
  return [...new Set(labels)].join(" · ");
}

/**
 * Fold A/B copies into one projection so ProgressionTable / Trajectory can
 * render Workout 1 and Workout 2 on the same roadmap.
 *
 * History is per lift, not per plan day — every A/B copy already carries the
 * same `recent_sessions`. Concatenating them doubled every set on the card
 * (Sep 4 showed 80×6, 80×4, 75×6, 70×7 twice).
 */
export function mergeSessionVariants(
  exercises: ProjectedExercise[]
): ProjectedExercise {
  const primary =
    exercises.find((item) => item.priority === "high") || exercises[0];
  if (!primary || exercises.length <= 1) return primary;

  const schedule: WeekPoint[] = [];
  exercises.forEach((exercise, index) => {
    const session = index + 1;
    const points =
      exercise.schedule && exercise.schedule.length
        ? exercise.schedule
        : (exercise.realistic || []).map((point) => ({
            ...point,
            session: 1,
          }));
    for (const point of points) {
      schedule.push({ ...point, session });
    }
  });
  schedule.sort(
    (a, b) => a.week - b.week || (a.session || 1) - (b.session || 1)
  );

  // Pick the richest single history payload rather than merging copies.
  const historySource = exercises.reduce((best, exercise) => {
    const bestN = (best.recent_sessions || []).length;
    const nextN = (exercise.recent_sessions || []).length;
    if (nextN > bestN) return exercise;
    const bestH = (best.history_context?.recent_sessions || []).length;
    const nextH = (exercise.history_context?.recent_sessions || []).length;
    return nextH > bestH ? exercise : best;
  }, primary);

  return {
    ...primary,
    sessions_per_week: Math.max(
      primary.sessions_per_week || 1,
      exercises.length
    ),
    schedule,
    recent_sessions: historySource.recent_sessions,
    history_context: historySource.history_context
      ? {
          ...historySource.history_context,
          lifetime_session_count: Math.max(
            primary.history_context?.lifetime_session_count || 0,
            ...exercises.map(
              (item) => item.history_context?.lifetime_session_count || 0
            )
          ),
        }
      : primary.history_context,
  };
}
