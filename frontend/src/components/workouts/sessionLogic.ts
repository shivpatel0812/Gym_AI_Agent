import defaultExercises, { categoryToMuscleGroup } from "../../data/defaultExercises";
import { localDateKey } from "../../lib/localDate";
import {
  SessionExercise,
  WorkoutSession,
  WorkoutSet,
  SessionFormData,
} from "./types";

/** Bump with the backend whenever persisted prescriptions must be recomputed. */
export const CURRENT_RECOMMENDATION_ALGORITHM_VERSION = 1;

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

export function splitLabel(session: {
  split_name?: string;
  split_day?: string;
  workout_name?: string;
}) {
  const raw = (session.split_day || session.split_name || session.workout_name || "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function splitBadgeColors(label: string): { bg: string; text: string } | null {
  const l = label.toLowerCase();
  if (!l) return null;
  if (l.includes("push")) return { bg: "#3D2B56", text: "#C084FC" };
  if (l.includes("pull")) return { bg: "#064E3B", text: "#34D399" };
  if (l.includes("leg") || l.includes("lower")) return { bg: "#3D2A14", text: "#9CC0E8" };
  if (l.includes("upper")) return { bg: "#2A1A14", text: "#FF8F66" };
  if (l.includes("full")) return { bg: "#1E2A38", text: "#E4B896" };
  return { bg: "#1E2A38", text: "#A1A1AA" };
}

export function sessionDurationMinutes(session: WorkoutSession): number | null {
  const ms = Number(session.timer_accumulated_ms) || 0;
  if (ms > 0) return Math.max(1, Math.round(ms / 60000));
  if (session.cardio_minutes && session.cardio_minutes > 0) {
    return Math.round(session.cardio_minutes);
  }
  const cardioTimes = (session.exercises || []).reduce(
    (sum, ex) => sum + (Number(ex.time) || 0),
    0
  );
  if (cardioTimes > 0) return Math.round(cardioTimes);
  return null;
}

function startOfWeekMonday(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

export function weekGroupLabel(weekStart: Date, now = new Date()) {
  const thisWeek = startOfWeekMonday(now);
  if (weekStart.getTime() === thisWeek.getTime()) return "THIS WEEK";
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const startMonth = weekStart.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const endMonth = weekEnd.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  if (startMonth === endMonth) {
    return `WEEK OF ${startMonth} ${weekStart.getDate()}–${weekEnd.getDate()}`;
  }
  return `WEEK OF ${startMonth} ${weekStart.getDate()}–${endMonth} ${weekEnd.getDate()}`;
}

export function groupSessionsByWeek(sessions: WorkoutSession[]) {
  const sorted = [...sessions].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || ""))
  );
  const map = new Map<string, { weekStart: Date; sessions: WorkoutSession[] }>();
  for (const session of sorted) {
    const parsed = new Date(`${String(session.date).slice(0, 10)}T00:00:00`);
    const base = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    const weekStart = startOfWeekMonday(base);
    const key = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, { weekStart, sessions: [] });
    map.get(key)!.sessions.push(session);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1].weekStart.getTime() - a[1].weekStart.getTime())
    .map(([key, group]) => ({
      key,
      label: weekGroupLabel(group.weekStart),
      sessions: group.sessions,
    }));
}

export function sessionListTitle(session: {
  date?: string;
  split_name?: string;
  split_day?: string;
  workout_name?: string;
}) {
  return sessionHeadline(
    session.split_name || session.workout_name,
    session.split_day,
    session.date
  );
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

export function emptyWorkoutSets(count = 3): WorkoutSet[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) => ({
    set_number: i + 1,
    reps: 0,
    weight: undefined,
    completed: false,
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

/** A cached prescription lost a load that was present in the source workout. */
export function recDropsLastWorkoutLoad(rec: any, lastData: any): boolean {
  return lastWorkoutHasWeight(lastData) && !recHasWeightedSets(rec);
}

/** Cached workout drafts can outlive recommendation-logic fixes. */
export function recNeedsAlgorithmRefresh(rec: any): boolean {
  const version = Number(rec?.algorithm_version) || 0;
  return version < CURRENT_RECOMMENDATION_ALGORITHM_VERSION;
}

/**
 * Whether a recommendation has anything to apply to the set rows.
 *
 * Distinct from `recHasWeightedSets`, which asks whether a *load* was
 * prescribed and gates the "pick a starting weight" prompt. Requiring a load
 * to enable "Apply sets" hid the button on every bodyweight exercise, where
 * reps are the entire prescription.
 */
export function recHasApplicableSets(rec: any): boolean {
  return (
    Array.isArray(rec?.sets) &&
    rec.sets.some((s: any) => Number(s.weight) > 0 || Number(s.reps) > 0)
  );
}

export function mapRecSets(rec: any): WorkoutSet[] {
  return rec.sets.map((s: any, i: number) => ({
    set_number: s.set_number || i + 1,
    reps: s.reps || 0,
    // Bodyweight prescriptions carry weight 0. Writing that into the row shows
    // a literal "0" in the load field; leaving it unset keeps the placeholder.
    weight: Number(s.weight) > 0 ? s.weight : undefined,
    rep_low: s.rep_low,
    rep_high: s.rep_high,
    preferred_reps: s.preferred_reps,
    completed: false,
  }));
}

export function toStoredRecommendation(rec: any) {
  if (!rec || typeof rec !== "object") return undefined;
  return {
    algorithm_version: rec.algorithm_version,
    sets: rec.sets,
    reasoning: rec.reasoning,
    progression_type: rec.progression_type,
    confidence: rec.confidence,
    rep_range: rec.rep_range,
    strategy: rec.strategy,
    branch: rec.branch,
    progression_options: rec.progression_options,
    next_set_reasoning: rec.next_set_reasoning,
    next_set_action: rec.next_set_action,
    next_set_request_id: rec.next_set_request_id,
    needs_starting_weight: rec.needs_starting_weight,
    estimated_from_stale_history: rec.estimated_from_stale_history,
    estimated_from_top_lifts: rec.estimated_from_top_lifts,
    estimated_from_related_exercises: rec.estimated_from_related_exercises,
    calibration_required: rec.calibration_required,
    suggested_sets: rec.suggested_sets,
    suggested_reps: rec.suggested_reps,
    has_implausible_data: rec.has_implausible_data,
    time: rec.time,
    speed: rec.speed,
    cardio_modality: rec.cardio_modality,
    target_intensity: rec.target_intensity,
    guidance: rec.guidance,
    plan_context: rec.plan_context,
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
    date: localDateKey(),
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
    split_name: session.split_name || session.workout_name || "",
    split_day: session.split_day || "",
    exercises: migrateSessionCardioToExercises(session),
    notes: session.notes || "",
  };
}

/** Copy exercise order and set counts from a logged session — fresh sets for a new workout. */
export function layoutExercisesFromSession(source: WorkoutSession): SessionExercise[] {
  return migrateSessionCardioToExercises(source).map((ex) => {
    if (isCardioExercise(ex)) {
      return {
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        time: undefined,
        ...(isSportCardio(ex)
          ? { intensity: 5, fatigue: 5 }
          : { speed: undefined }),
      };
    }
    const setCount = Array.isArray(ex.sets)
      ? Math.max(ex.sets.length, 1)
      : typeof ex.sets === "number" && ex.sets > 0
        ? ex.sets
        : 3;
    return {
      exercise_id: ex.exercise_id,
      exercise_name: ex.exercise_name,
      sets: Array.from({ length: setCount }, (_, i) => ({
        set_number: i + 1,
        reps: 0,
        weight: undefined,
        completed: false,
      })),
    };
  });
}

export function buildSessionPayload(
  formData: SessionFormData,
  timer?: {
    accumulatedMs: number;
    runningSince: number | null;
    firstStartedAt: number | null;
  } | null,
  options: { preserveUnloggedExercises?: boolean } = {}
) {
  const filteredExercises = formData.exercises
    .map((ex) => {
      if (ex.sets && Array.isArray(ex.sets)) {
        // Auto-save is also the draft store. Keep the whole imported layout in
        // that path, including exercises the user has not reached yet and the
        // remaining blank set rows on a partially completed exercise. The
        // completed-workout path still falls through to the valid-set filter
        // below, so skipped work does not become training history.
        if (options.preserveUnloggedExercises) return ex;
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
  // Prefer the set the estimated 1RM was actually computed from, so the two
  // stats sitting beside each other describe the same set. The max_per_set
  // scan below is the fallback for records saved before the API returned it.
  const e1rmSet = maxData?.best_e1rm_set;
  if (e1rmSet?.weight != null) {
    return `${e1rmSet.weight} \u00d7 ${e1rmSet.reps || 0}`;
  }
  if (!maxData?.max_per_set) return null;
  const entries = Object.entries(maxData.max_per_set) as [string, any][];
  if (!entries.length) return null;
  entries.sort((a, b) => (b[1].weight || 0) - (a[1].weight || 0));
  const best = entries[0][1];
  if (best?.weight == null) return null;
  return `${best.weight} × ${best.reps || 0}`;
}

export const MUSCLE_GROUP_LABELS: Record<string, string> = {
  CHEST: "Chest",
  SHOULDERS: "Shoulders",
  TRICEPS: "Triceps",
  BACK: "Back",
  BICEPS: "Biceps",
  LEGS: "Legs",
  GLUTES: "Glutes",
  CALVES: "Calves",
  "CORE / ABS": "Core",
};

export function resolveExerciseCategory(
  exerciseId: string,
  exerciseName: string,
  customExercises: { id?: string; name: string; muscle_group?: string }[] = []
): string | null {
  const fromDefault = defaultExercises.find(
    (e) => e.id === exerciseId || e.name === exerciseName
  );
  if (fromDefault?.category) return fromDefault.category;
  const fromCustom = customExercises.find(
    (e) => e.id === exerciseId || e.name === exerciseName
  );
  if (fromCustom?.muscle_group) {
    const muscleGroup = fromCustom.muscle_group.toLowerCase();
    for (const [cat, muscle] of Object.entries(categoryToMuscleGroup)) {
      if (muscleGroup.includes(muscle.toLowerCase())) return cat;
    }
  }
  return null;
}

export function exerciseMatchesMuscleGroup(
  category: string | null,
  filter: string
): boolean {
  if (!category) return false;
  if (filter === "ARMS") return category === "BICEPS" || category === "TRICEPS";
  if (filter === "CORE") return category === "CORE / ABS";
  return category === filter;
}

/** Infer muscle-group pills from a single label (day name, focus line, etc.). */
function muscleGroupsFromText(text: string): string[] | null {
  const key = text.toLowerCase().trim();
  if (!key) return null;
  if (/\bpull\b|pull day|back.*bicep|bicep.*back/.test(key)) {
    return ["BACK", "BICEPS"];
  }
  if (/\bpush\b|push day|chest.*tricep|tricep.*chest|shoulder.*tricep/.test(key)) {
    return ["CHEST", "SHOULDERS", "TRICEPS"];
  }
  if (/\bleg\b|lower|glute|quad|hamstring/.test(key)) {
    return ["LEGS", "GLUTES", "CALVES"];
  }
  if (/\bupper\b/.test(key)) {
    return ["CHEST", "BACK", "SHOULDERS", "BICEPS", "TRICEPS"];
  }
  if (/\bfull\b|total body/.test(key)) {
    return ["CHEST", "BACK", "SHOULDERS", "BICEPS", "TRICEPS", "LEGS"];
  }
  if (/\bchest\b/.test(key)) return ["CHEST", "TRICEPS"];
  if (/\bback\b/.test(key)) return ["BACK", "BICEPS"];
  if (/\bshoulder\b/.test(key)) return ["SHOULDERS"];
  if (/\barm\b|bicep|tricep/.test(key)) return ["BICEPS", "TRICEPS"];
  if (/\bcore\b|\babs\b/.test(key)) return ["CORE / ABS"];
  return null;
}

/** Parse plan focus lines like "Back / Biceps" into pill groups. */
function muscleGroupsFromFocus(focus: string): string[] | null {
  const key = focus.toLowerCase();
  const groups: string[] = [];
  if (/\bback\b/.test(key)) groups.push("BACK");
  if (/\bbicep/.test(key)) groups.push("BICEPS");
  if (/\bchest\b/.test(key)) groups.push("CHEST");
  if (/\bshoulder/.test(key)) groups.push("SHOULDERS");
  if (/\btricep/.test(key)) groups.push("TRICEPS");
  if (/\bleg|quad|hamstring/.test(key)) groups.push("LEGS");
  if (/\bglute/.test(key)) groups.push("GLUTES");
  if (/\bcalf|calves/.test(key)) groups.push("CALVES");
  if (/\bcore\b|\babs\b/.test(key)) groups.push("CORE / ABS");
  return groups.length ? [...new Set(groups)] : null;
}

/** Muscle groups relevant to the current split day (e.g. Push → chest, shoulders, triceps). */
export function muscleGroupsForSplitDay(
  splitDay?: string,
  splitName?: string,
  focus?: string
): string[] {
  // Day name and focus beat the plan title. A Pull session must not inherit
  // "Push" from a plan named "Push Pull Legs".
  for (const source of [splitDay, focus, splitName]) {
    if (!source?.trim()) continue;
    const fromText = muscleGroupsFromText(source);
    if (fromText) return fromText;
    const fromFocus = muscleGroupsFromFocus(source);
    if (fromFocus) return fromFocus;
  }
  return [];
}

/** History header for a muscle-group footer (e.g. "Recent shoulders history"). */
export function muscleGroupHistoryLabel(group: string): string {
  const label = MUSCLE_GROUP_LABELS[group]?.toLowerCase() || group.toLowerCase();
  return `Recent ${label} history`;
}

/** Uppercase history header for the split-aware card footer (e.g. "Recent push history"). */
export function splitHistoryLabel(splitDay?: string, splitName?: string): string {
  const key = `${splitDay || ""} ${splitName || ""}`.toLowerCase();
  if (/\bpush\b|push day/.test(key)) return "Recent push history";
  if (/\bpull\b|pull day/.test(key)) return "Recent pull history";
  if (/\bleg\b|lower/.test(key)) return "Recent legs history";
  if (/\bupper\b/.test(key)) return "Recent upper history";
  if (/\bfull\b|total body/.test(key)) return "Recent full body history";
  if (/\bchest\b/.test(key)) return "Recent chest history";
  if (/\bback\b/.test(key)) return "Recent back history";
  if (/\bshoulder\b/.test(key)) return "Recent shoulder history";
  if (/\barm\b|bicep|tricep/.test(key)) return "Recent arms history";
  if (/\bcore\b|\babs\b/.test(key)) return "Recent core history";
  const label = (splitDay || splitName || "workout").trim();
  return label ? `Recent ${label.toLowerCase()} history` : "Recent workout history";
}

export type MuscleGroupLogHit = {
  session: WorkoutSession;
  exercise: SessionExercise;
};

/** Last N individual exercise logs for a muscle group, newest first (not grouped by session). */
export function getRecentMuscleGroupLogs(
  sessions: WorkoutSession[],
  muscleGroup: string,
  resolveCategory: (exerciseId: string, exerciseName: string) => string | null,
  excludeSessionId?: string | null,
  limit = 5
): MuscleGroupLogHit[] {
  const hits: MuscleGroupLogHit[] = [];
  const sorted = [...sessions].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || ""))
  );
  for (const session of sorted) {
    if (session.id && session.id === excludeSessionId) continue;
    const matched = migrateSessionCardioToExercises(session).filter((ex) => {
      const cat = resolveCategory(ex.exercise_id, ex.exercise_name);
      return exerciseMatchesMuscleGroup(cat, muscleGroup);
    });
    for (const exercise of matched) {
      hits.push({ session, exercise });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

function workingSets(ex: SessionExercise) {
  if (!Array.isArray(ex.sets)) return [];
  return ex.sets.filter(
    (set) => set.completed || (Number(set.reps) > 0 && Number(set.weight) > 0)
  );
}

/** Compact set summary for history rows, e.g. "3×80, 4×80, 6×70". */
export function formatExerciseSetsSummary(ex: SessionExercise): string {
  const sets = workingSets(ex);
  if (!sets.length) return "—";
  return sets
    .map((set) => {
      const reps = Number(set.reps) || 0;
      const weight = Number(set.weight) || 0;
      if (weight > 0) return `${reps}×${weight}`;
      if (reps > 0) return `${reps} reps`;
      return null;
    })
    .filter(Boolean)
    .join(", ");
}

export function formatExerciseSessionSnapshot(ex: SessionExercise): string {
  const summary = formatExerciseSetsSummary(ex);
  if (summary !== "—") return summary;
  return ex.exercise_name;
}
