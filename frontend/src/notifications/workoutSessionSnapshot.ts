import type { SessionExercise, WorkoutSet } from "../components/workouts/types";

export type WorkoutLiveSnapshot = {
  dayLabel: string;
  exerciseName: string;
  exerciseIdx: number;
  setIdx: number;
  setNumber: number;
  totalSets: number;
  setLabel: string;
  prescription: string;
  weight?: number;
  reps?: number;
  elapsedSeconds: number;
  isRunning: boolean;
  /** Epoch ms = now - elapsed when running (or when last paused). */
  timerBaseEpochMs: number;
  pauseTimeEpochMs: number;
};

type AiRecMap = Record<string, any>;

function formatPrescription(weight?: number, reps?: number, repLow?: number, repHigh?: number) {
  const w = Number(weight);
  const r = Number(reps);
  const low = Number(repLow);
  const high = Number(repHigh);
  const weightPart = Number.isFinite(w) && w > 0 ? `${w}` : "";
  let repPart = "";
  if (Number.isFinite(r) && r > 0) repPart = String(r);
  else if (Number.isFinite(low) && Number.isFinite(high) && low > 0 && high > 0) {
    repPart = low === high ? String(low) : `${low}–${high}`;
  }
  if (weightPart && repPart) return `${weightPart} × ${repPart}`;
  if (weightPart) return `${weightPart} lbs`;
  if (repPart) return `${repPart} reps`;
  return "";
}

function resolvePrescribed(
  set: WorkoutSet,
  setIdx: number,
  aiRec: any,
  lastSets: { reps: number; weight?: number }[]
) {
  const suggestedIdx =
    typeof aiRec?.suggested_next_set_index === "number"
      ? aiRec.suggested_next_set_index
      : null;
  const recSet =
    suggestedIdx === setIdx && aiRec?.suggested_next_set
      ? aiRec.suggested_next_set
      : Array.isArray(aiRec?.sets)
        ? aiRec.sets[setIdx]
        : null;
  const last = lastSets[setIdx];
  const reps =
    Number(set.reps) > 0
      ? Number(set.reps)
      : Number(recSet?.preferred_reps ?? recSet?.reps ?? last?.reps) || undefined;
  const weight =
    set.weight != null && Number(set.weight) > 0
      ? Number(set.weight)
      : Number(recSet?.weight ?? last?.weight) || undefined;
  const repLow = Number(recSet?.rep_low) || undefined;
  const repHigh = Number(recSet?.rep_high) || undefined;
  return { reps, weight, repLow, repHigh };
}

/**
 * First incomplete set in order; if all complete, the last set of the last exercise.
 */
export function buildWorkoutLiveSnapshot(
  exercises: SessionExercise[],
  aiRecommendations: AiRecMap,
  opts: {
    dayLabel?: string;
    elapsedSeconds: number;
    isRunning: boolean;
    lastExerciseData?: Record<string, any>;
  }
): WorkoutLiveSnapshot | null {
  if (!exercises.length) return null;

  let exerciseIdx = 0;
  let setIdx = 0;
  let found = false;

  for (let ei = 0; ei < exercises.length; ei++) {
    const ex = exercises[ei];
    const sets = Array.isArray(ex.sets) ? ex.sets : [];
    if (!sets.length) continue;
    const incomplete = sets.findIndex((s) => !s.completed);
    if (incomplete >= 0) {
      exerciseIdx = ei;
      setIdx = incomplete;
      found = true;
      break;
    }
    exerciseIdx = ei;
    setIdx = Math.max(0, sets.length - 1);
  }
  if (!found && !Array.isArray(exercises[exerciseIdx]?.sets)) return null;

  const exercise = exercises[exerciseIdx];
  const sets = Array.isArray(exercise.sets) ? (exercise.sets as WorkoutSet[]) : [];
  if (!sets.length) return null;
  const set = sets[setIdx];
  const aiRec = aiRecommendations[exercise.exercise_id] || exercise.ai_recommendation;
  const lastRaw = opts.lastExerciseData?.[exercise.exercise_id];
  const lastSets: { reps: number; weight?: number }[] = Array.isArray(lastRaw?.sets)
    ? lastRaw.sets
    : [];
  const prescribed = resolvePrescribed(set, setIdx, aiRec, lastSets);
  const totalSets = sets.length;
  const setNumber = set.set_number || setIdx + 1;
  const elapsedSeconds = Math.max(0, Math.floor(opts.elapsedSeconds || 0));
  const now = Date.now();
  const timerBaseEpochMs = now - elapsedSeconds * 1000;

  return {
    dayLabel: (opts.dayLabel || "GymAI").trim() || "GymAI",
    exerciseName: exercise.exercise_name || "Exercise",
    exerciseIdx,
    setIdx,
    setNumber,
    totalSets,
    setLabel: `Set ${setNumber} of ${totalSets}`,
    prescription: formatPrescription(
      prescribed.weight,
      prescribed.reps,
      prescribed.repLow,
      prescribed.repHigh
    ),
    weight: prescribed.weight,
    reps: prescribed.reps,
    elapsedSeconds,
    isRunning: Boolean(opts.isRunning),
    timerBaseEpochMs,
    pauseTimeEpochMs: opts.isRunning ? 0 : now,
  };
}
