import defaultExercises from "../../data/defaultExercises";
import {
  SessionExercise,
  WorkoutSession,
  WorkoutSet,
  SessionFormData,
} from "./types";

export function isCardioExercise(ex: SessionExercise) {
  return (
    Boolean(ex.exercise_id?.startsWith("default-cardio")) ||
    Object.prototype.hasOwnProperty.call(ex, "time") ||
    Object.prototype.hasOwnProperty.call(ex, "speed") ||
    Object.prototype.hasOwnProperty.call(ex, "intensity") ||
    Object.prototype.hasOwnProperty.call(ex, "fatigue")
  );
}

export function isTreadmillCardio(ex: SessionExercise) {
  const id = ex.exercise_id || "";
  return (
    id === "default-cardio-incline-walk" ||
    id === "default-cardio-run" ||
    id === "default-cardio-normal-walk"
  );
}

export function isSportCardio(ex: SessionExercise) {
  return (
    Boolean(ex.exercise_id?.startsWith("default-cardio-sport")) ||
    (isCardioExercise(ex) && !isTreadmillCardio(ex))
  );
}

function sportIdFromName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `default-cardio-sport-${slug || "other"}`;
}

export function migrateSessionCardioToExercises(
  session: WorkoutSession
): SessionExercise[] {
  const exercises = [...(session.exercises || [])];
  const sport = (session.cardio_sport || "").trim();
  if (!sport && session.cardio_minutes == null) return exercises;

  const alreadyLogged = exercises.some(
    (ex) =>
      isSportCardio(ex) ||
      (sport && ex.exercise_name.toLowerCase() === sport.toLowerCase())
  );
  if (alreadyLogged) return exercises;

  const catalogMatch = defaultExercises.find(
    (ex) =>
      ex.category === "CARDIO" && ex.name.toLowerCase() === sport.toLowerCase()
  );
  exercises.unshift({
    exercise_id: catalogMatch?.id || sportIdFromName(sport || "Other Sport"),
    exercise_name: sport || "Cardio",
    time: session.cardio_minutes,
    intensity: session.cardio_intensity ?? 5,
    fatigue: session.cardio_fatigue ?? 5,
  });
  return exercises;
}

export function hasCardioLog(data: {
  exercises?: SessionExercise[];
  cardio_sport?: string;
  cardio_minutes?: string | number;
}) {
  if (data.exercises?.some(isCardioExercise)) return true;
  const sport = String(data.cardio_sport || "").trim();
  const minutes = Number(data.cardio_minutes);
  return Boolean(sport) || (Number.isFinite(minutes) && minutes > 0);
}

export function isValidSet(set: WorkoutSet) {
  const reps = Number(set.reps) || 0;
  const weight = Number(set.weight);
  return reps > 0 || (Number.isFinite(weight) && weight > 0);
}

export function formatDateOrdinal(dateStr?: string) {
  if (!dateStr) return "";
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
      ? "nd"
      : day % 10 === 3 && day !== 13
      ? "rd"
      : "th";
  const month = d.toLocaleDateString("en-US", { month: "short" });
  return `${month} ${day}${suffix}`;
}

export function sessionListTitle(session: {
  date?: string;
  split_name?: string;
  split_day?: string;
  workout_name?: string;
}) {
  const datePart = formatDateOrdinal(session.date);
  const split = (
    session.split_day ||
    session.split_name ||
    session.workout_name ||
    ""
  ).trim();
  if (datePart && split) return `${datePart} ${split}`;
  return datePart || split || "Workout Session";
}

export function sessionHeadline(
  splitName?: string,
  splitDay?: string,
  dateStr?: string
) {
  const name = (splitDay || splitName || "Workout Session").trim();
  const datePart = dateStr
    ? (() => {
        const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
        if (Number.isNaN(d.getTime())) return "";
        return `${d.getMonth() + 1}/${d.getDate()}`;
      })()
    : "";
  return datePart ? `${name} ${datePart}` : name;
}

export function isLastWorkoutRecent(lastData: any, maxDays = 30): boolean {
  const dateStr = lastData?.date;
  if (!dateStr) return false;
  const parsed = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const days = (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24);
  return days >= 0 && days <= maxDays;
}

export function lastWorkingSets(
  lastData: any
): { reps: number; weight?: number }[] {
  const raw = lastData?.exercise_data?.sets;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidSet).map((s: any) => ({
    reps: Number(s.reps) || 0,
    weight: s.weight != null && s.weight !== "" ? Number(s.weight) : undefined,
  }));
}

export function setsFromLastWorkout(
  lastData: any,
  targetCount = 3
): WorkoutSet[] | null {
  if (!isLastWorkoutRecent(lastData)) return null;
  const raw = lastData?.exercise_data?.sets;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const usable = raw.filter(isValidSet);
  if (usable.length === 0) return null;
  const mapped: WorkoutSet[] = usable.map((s: any, i: number) => ({
    set_number: i + 1,
    reps: Number(s.reps) || 0,
    weight: s.weight != null && s.weight !== "" ? Number(s.weight) : undefined,
    completed: false,
  }));
  while (mapped.length < targetCount) {
    const last = mapped[mapped.length - 1];
    mapped.push({
      ...last,
      set_number: mapped.length + 1,
      completed: false,
    });
  }
  return mapped.slice(0, targetCount).map((s, i) => ({ ...s, set_number: i + 1 }));
}

function normalizeLastExerciseData(lastData: any) {
  if (!lastData?.exercise_data) return lastData;
  const ex = lastData.exercise_data;
  if (Array.isArray(ex.sets) && ex.sets.length > 0) return lastData;
  if (ex.reps || ex.weight) {
    const count =
      typeof ex.sets === "number" && ex.sets > 0 ? Number(ex.sets) : 1;
    return {
      ...lastData,
      exercise_data: {
        ...ex,
        sets: Array.from({ length: count }, (_, i) => ({
          set_number: i + 1,
          reps: Number(ex.reps) || 0,
          weight: ex.weight,
        })),
      },
    };
  }
  return lastData;
}

function exerciseMatchesLast(
  ex: any,
  exerciseId?: string,
  exerciseName?: string
) {
  if (exerciseId && ex?.exercise_id === exerciseId) return true;
  if (
    exerciseName &&
    String(ex?.exercise_name || "").trim().toLowerCase() ===
      exerciseName.trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

export function findLastExerciseFromSessions(
  sessions: {
    id?: string;
    date?: string;
    created_at?: string;
    exercises?: any[];
  }[],
  exerciseId: string,
  exerciseName: string,
  excludeSessionId?: string | null
) {
  const matches: any[] = [];
  for (const session of sessions) {
    if (!session?.id || session.id === excludeSessionId) continue;
    const ex = (session.exercises || []).find((item) =>
      exerciseMatchesLast(item, exerciseId, exerciseName)
    );
    if (!ex) continue;
    matches.push(
      normalizeLastExerciseData({
        session_id: session.id,
        date: session.date,
        created_at: session.created_at,
        exercise_data: ex,
      })
    );
  }
  matches.sort((a, b) =>
    `${b.date || ""}|${b.created_at || ""}`.localeCompare(
      `${a.date || ""}|${b.created_at || ""}`
    )
  );
  return matches[0] || null;
}

export function formatLastPerformance(lastData: any): string | null {
  const ex = lastData?.exercise_data;
  if (!ex) return null;
  if (ex.time || ex.speed) {
    const parts: string[] = [];
    if (ex.time) parts.push(`${ex.time} min`);
    if (ex.speed) parts.push(`${ex.speed} mph`);
    return parts.length ? parts.join(" · ") : null;
  }
  const sets = lastWorkingSets(lastData);
  if (sets.length === 0) return null;
  return sets
    .map((s, i) => {
      const load =
        s.weight != null && s.weight > 0
          ? `${s.reps}×${s.weight} lbs`
          : `${s.reps} reps`;
      return `S${i + 1} ${load}`;
    })
    .join(" · ");
}

export function resolveLastExercise(
  apiLast: any,
  sessions: {
    id?: string;
    date?: string;
    created_at?: string;
    exercises?: any[];
  }[],
  exerciseId: string,
  exerciseName: string,
  excludeSessionId?: string | null
) {
  const normalizedApi = normalizeLastExerciseData(apiLast);
  if (
    normalizedApi &&
    normalizedApi.session_id &&
    normalizedApi.session_id !== excludeSessionId &&
    formatLastPerformance(normalizedApi)
  ) {
    return normalizedApi;
  }
  return findLastExerciseFromSessions(
    sessions,
    exerciseId,
    exerciseName,
    excludeSessionId
  );
}

export function lastWorkoutHasWeight(lastData: any): boolean {
  const sets = lastData?.exercise_data?.sets;
  if (!Array.isArray(sets)) return false;
  return sets.some((s: any) => Number(s.weight) > 0);
}

export function recCopiesLastWorkout(
  rec: any,
  lastSets: { reps: number; weight?: number }[]
) {
  if (!rec?.sets?.length || !lastSets.length) return false;
  const n = Math.min(3, rec.sets.length, lastSets.length);
  return Array.from({ length: n }).every((_, i) => {
    const recReps = Number(rec.sets[i].reps) || 0;
    const recWeight = Number(rec.sets[i].weight) || 0;
    const lastReps = Number(lastSets[i].reps) || 0;
    const lastWeight = Number(lastSets[i].weight) || 0;
    return recReps === lastReps && recWeight === lastWeight;
  });
}

export function recHasWeightedSets(rec: any): boolean {
  return Array.isArray(rec?.sets) && rec.sets.some((s: any) => Number(s.weight) > 0);
}

export function mapRecSets(rec: any): WorkoutSet[] {
  return rec.sets.map((s: any, i: number) => ({
    set_number: s.set_number || i + 1,
    reps: s.reps || 0,
    weight: s.weight,
    completed: false,
  }));
}

export function toStoredRecommendation(rec: any) {
  if (!rec || typeof rec !== "object") return undefined;
  return {
    sets: rec.sets,
    reasoning: rec.reasoning,
    progression_type: rec.progression_type,
    confidence: rec.confidence,
    needs_starting_weight: rec.needs_starting_weight,
    estimated_from_stale_history: rec.estimated_from_stale_history,
    estimated_from_top_lifts: rec.estimated_from_top_lifts,
    suggested_sets: rec.suggested_sets,
    suggested_reps: rec.suggested_reps,
    has_implausible_data: rec.has_implausible_data,
    time: rec.time,
    speed: rec.speed,
    generated_at: rec.generated_at || new Date().toISOString(),
  };
}

export function hydrateAiRecommendations(exercises: SessionExercise[]) {
  const out: Record<string, any> = {};
  for (const ex of exercises) {
    if (ex.exercise_id && ex.ai_recommendation) {
      out[ex.exercise_id] = ex.ai_recommendation;
    }
  }
  return out;
}

export function emptySessionForm(): SessionFormData {
  return {
    date: new Date().toISOString().split("T")[0],
    split_id: "",
    split_name: "",
    split_day: "",
    exercises: [],
    notes: "",
  };
}

export function sessionToForm(session: WorkoutSession): SessionFormData {
  return {
    date: session.date,
    split_id: session.split_id || "",
    split_name: session.split_name || "",
    split_day: session.split_day || "",
    exercises: migrateSessionCardioToExercises(session),
    notes: session.notes || "",
  };
}

export function buildSessionPayload(
  formData: SessionFormData,
  timer?: {
    accumulatedMs: number;
    runningSince: number | null;
    firstStartedAt: number | null;
  } | null
) {
  const filteredExercises = formData.exercises
    .map((ex) => {
      if (ex.sets && Array.isArray(ex.sets)) {
        const validSets = ex.sets.filter(isValidSet);
        if (
          validSets.length > 0 ||
          ex.time !== undefined ||
          ex.speed !== undefined ||
          isCardioExercise(ex)
        ) {
          return { ...ex, sets: validSets };
        }
        return null;
      }
      return ex;
    })
    .filter((ex): ex is SessionExercise => ex !== null);

  const firstSport = filteredExercises.find(isSportCardio);

  return {
    date: formData.date,
    split_id: formData.split_id || undefined,
    split_name: formData.split_name || undefined,
    split_day: formData.split_day || undefined,
    exercises: filteredExercises,
    notes: formData.notes || undefined,
    cardio_sport: firstSport?.exercise_name || null,
    cardio_minutes:
      firstSport?.time != null &&
      Number.isFinite(firstSport.time) &&
      firstSport.time > 0
        ? firstSport.time
        : null,
    cardio_intensity: firstSport?.intensity ?? null,
    cardio_fatigue: firstSport?.fatigue ?? null,
    timer_accumulated_ms: timer?.accumulatedMs ?? 0,
    timer_running_since: timer?.runningSince
      ? new Date(timer.runningSince).toISOString()
      : null,
    timer_started_at: timer?.firstStartedAt
      ? new Date(timer.firstStartedAt).toISOString()
      : null,
  };
}

export function formatShortDate(dateString: string) {
  const date = new Date(`${String(dateString).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function confidencePct(confidence?: string) {
  if (confidence === "high") return "92%";
  if (confidence === "medium") return "75%";
  if (confidence === "low") return "58%";
  return null;
}

export function getBestSetLabel(maxData: any) {
  if (!maxData?.max_per_set) return null;
  const entries = Object.entries(maxData.max_per_set) as [string, any][];
  if (!entries.length) return null;
  entries.sort((a, b) => (b[1].weight || 0) - (a[1].weight || 0));
  const best = entries[0][1];
  if (best?.weight == null) return null;
  return `${best.weight} × ${best.reps || 0}`;
}
