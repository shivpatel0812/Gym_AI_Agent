import { exerciseMatchesMuscleGroup, resolveExerciseCategory } from "../workouts/sessionLogic";
import type { ProjectedExercise } from "../../api/trainingPlan";

export type WorkoutSet = { setNumber: number; weight: number; reps: number };

export type LoggedSession = {
  key: string;
  date: string;
  exerciseId: string;
  exerciseName: string;
  sets: WorkoutSet[];
  topSet: { weight: number; reps: number };
  e1rm: number;
};

export type SessionTrend = "progress" | "maintain" | "stall" | "gap";

export type ChartPoint = {
  key: string;
  date: string;
  /** null = missing session gap — do not connect across this point */
  value: number | null;
  session?: LoggedSession;
  trend?: SessionTrend;
  label?: string;
};

const GAP_DAYS = 14;
const ROLLING_WINDOW = 3;

export function calcE1rm(weight: number, reps: number) {
  if (!weight && !reps) return 0;
  return (weight || 0) * (1 + (reps || 0) / 30);
}

export function sessionStimulus(sets: WorkoutSet[]) {
  return sets.reduce((sum, set) => sum + (set.weight || 0) * (set.reps || 0), 0);
}

export function daysBetween(a: string, b: string) {
  const da = new Date(`${a}T12:00:00`);
  const db = new Date(`${b}T12:00:00`);
  if (Number.isNaN(da.valueOf()) || Number.isNaN(db.valueOf())) return 0;
  return Math.abs(Math.round((db.getTime() - da.getTime()) / 86_400_000));
}

/** Compare two logged sessions for progression semantics. */
export function compareSessions(
  prev: LoggedSession | undefined,
  next: LoggedSession
): SessionTrend {
  if (!prev) return "progress";
  const pw = prev.topSet.weight || 0;
  const pr = prev.topSet.reps || 0;
  const nw = next.topSet.weight || 0;
  const nr = next.topSet.reps || 0;

  if (pw === nw && pr === nr) return "maintain";
  if (nw > pw || (nw === pw && nr > pr)) return "progress";
  if (nw < pw || (nw === pw && nr < pr)) return "stall";
  return compareSessionsByE1rm(prev, next);
}

function compareSessionsByE1rm(prev: LoggedSession, next: LoggedSession): SessionTrend {
  const delta = next.e1rm - prev.e1rm;
  if (Math.abs(delta) < 1) return "maintain";
  return delta > 0 ? "progress" : "stall";
}

export function getSessionRecords(exercise: ProjectedExercise): LoggedSession[] {
  const primary = exercise.recent_sessions || [];
  const fallback = exercise.history_context?.recent_sessions || [];
  const merged = [...primary, ...fallback];
  const seen = new Set<string>();

  return [...merged]
    .filter((session) => session.date && !String(session.date).startsWith("week-"))
    .filter((session) => {
      const key = String(session.date);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((session, index) => {
      const sets = (session.sets || [])
        .filter((set) => set.completed !== false && (set.reps || 0) > 0)
        .map((set, setIndex) => ({
          setNumber: setIndex + 1,
          weight: set.weight || 0,
          reps: set.reps || 0,
        }));

      const topFromContext =
        "top_set" in session && session.top_set
          ? {
              setNumber: 1,
              weight: session.top_set.weight || 0,
              reps: session.top_set.reps || 0,
            }
          : null;

      const topSet =
        sets.length > 0
          ? sets.reduce(
              (best, set) =>
                calcE1rm(set.weight, set.reps) > calcE1rm(best.weight, best.reps) ? set : best,
              sets[0]
            )
          : topFromContext;

      const e1rm = sets.length
        ? Math.max(...sets.map((set) => calcE1rm(set.weight, set.reps)))
        : topSet
          ? calcE1rm(topSet.weight, topSet.reps)
          : 0;

      return { session, index, sets, topSet, e1rm };
    })
    .filter(({ sets, topSet, e1rm }) => sets.length > 0 || (topSet && e1rm > 0))
    .map(({ session, index, sets, topSet, e1rm }) => ({
      key: `${exercise.exercise_id}-${session.date}-${index}`,
      date: String(session.date),
      exerciseId: exercise.exercise_id,
      exerciseName: exercise.exercise_name,
      sets,
      topSet: { weight: topSet?.weight || 0, reps: topSet?.reps || 0 },
      e1rm: Math.round(e1rm),
    }));
}

/** Exercise-level chart: e1RM per session with gaps and trend labels. */
export function buildExerciseChartPoints(
  exercise: ProjectedExercise,
  valueForSession: (session: LoggedSession) => number = (s) => s.e1rm
): ChartPoint[] {
  const sessions = getSessionRecords(exercise);
  const points: ChartPoint[] = [];
  let prev: LoggedSession | undefined;

  for (const session of sessions) {
    if (prev && daysBetween(prev.date, session.date) > GAP_DAYS) {
      points.push({
        key: `gap-${prev.date}-${session.date}`,
        date: session.date,
        value: null,
        trend: "gap",
      });
    }
    const trend = compareSessions(prev, session);
    points.push({
      key: session.key,
      date: session.date,
      value: valueForSession(session),
      session,
      trend,
    });
    prev = session;
  }
  return points;
}

function categoryForExercise(exercise: ProjectedExercise) {
  return resolveExerciseCategory(exercise.exercise_id, exercise.exercise_name);
}

/** Muscle-group chart: rolling total stimulus per session date. */
export function buildMuscleGroupChartPoints(
  exercises: ProjectedExercise[],
  muscleGroup: string
): ChartPoint[] {
  const byDate = new Map<
    string,
    { stimulus: number; sessions: LoggedSession[] }
  >();

  for (const exercise of exercises) {
    const category = categoryForExercise(exercise);
    if (!exerciseMatchesMuscleGroup(category, muscleGroup)) continue;
    for (const session of getSessionRecords(exercise)) {
      const stim = sessionStimulus(session.sets);
      const bucket = byDate.get(session.date) || { stimulus: 0, sessions: [] };
      bucket.stimulus += stim;
      bucket.sessions.push(session);
      byDate.set(session.date, bucket);
    }
  }

  const dates = [...byDate.keys()].sort();
  const raw: ChartPoint[] = [];
  let prevDate: string | undefined;

  for (const date of dates) {
    const bucket = byDate.get(date)!;
    if (prevDate && daysBetween(prevDate, date) > GAP_DAYS) {
      raw.push({ key: `gap-${prevDate}-${date}`, date, value: null, trend: "gap" });
    }
    raw.push({
      key: `mg-${muscleGroup}-${date}`,
      date,
      value: bucket.stimulus,
      session: bucket.sessions[0],
      label: `${bucket.sessions.length} lift${bucket.sessions.length === 1 ? "" : "s"}`,
    });
    prevDate = date;
  }

  // Smooth with a rolling window so one outlier session doesn't dominate.
  const values = raw.map((p) => p.value);
  const smoothed = rollingAverage(values, ROLLING_WINDOW);
  return raw.map((point, i) => {
    if (point.value == null) return point;
    const prev = raw.slice(0, i).filter((p) => p.value != null).at(-1);
    const smoothedValue = smoothed[i] ?? point.value;
    let trend: SessionTrend = "maintain";
    if (prev?.value != null) {
      if (smoothedValue > prev.value * 1.03) trend = "progress";
      else if (smoothedValue < prev.value * 0.97) trend = "stall";
    }
    return { ...point, value: smoothedValue, trend };
  });
}

export function rollingAverage(values: Array<number | null>, window: number) {
  const out: Array<number | null> = [];
  const recent: number[] = [];
  for (const value of values) {
    if (value == null) {
      out.push(null);
      continue;
    }
    recent.push(value);
    if (recent.length > window) recent.shift();
    out.push(recent.reduce((a, b) => a + b, 0) / recent.length);
  }
  return out;
}

export function muscleGroupsForDay(exercises: ProjectedExercise[]) {
  const groups = new Set<string>();
  for (const exercise of exercises) {
    const category = categoryForExercise(exercise);
    if (category) groups.add(category);
  }
  return [...groups];
}

export function formatShortDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatSetLine(set: WorkoutSet) {
  return set.weight > 0 ? `${set.weight}×${set.reps}` : `${set.reps} reps`;
}

export function trendLabel(trend?: SessionTrend) {
  if (trend === "progress") return "moving up";
  if (trend === "stall") return "stall detected";
  if (trend === "gap") return "missing session";
  return "holding steady";
}

export function trendColor(trend?: SessionTrend, accent = "#9CC0E8") {
  if (trend === "progress") return accent;
  if (trend === "stall") return "#F59E0B";
  if (trend === "gap") return "#636366";
  return "#5EEAD4";
}

export function sessionsForMuscleGroupOnDate(
  exercises: ProjectedExercise[],
  muscleGroup: string,
  date: string
): LoggedSession[] {
  const out: LoggedSession[] = [];
  for (const exercise of exercises) {
    const category = categoryForExercise(exercise);
    if (!exerciseMatchesMuscleGroup(category, muscleGroup)) continue;
    for (const session of getSessionRecords(exercise)) {
      if (session.date === date) out.push(session);
    }
  }
  return out;
}
