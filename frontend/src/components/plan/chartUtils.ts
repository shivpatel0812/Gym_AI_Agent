import { exerciseMatchesMuscleGroup, muscleGroupsForSplitDay, resolveExerciseCategory } from "../workouts/sessionLogic";
import type { MuscleGroupDay, ProjectedExercise } from "../../api/trainingPlan";

export type WorkoutSet = {
  /** The number the user logged, not the index after filtering. */
  setNumber: number;
  weight: number;
  reps: number;
};

export type CustomExercise = { id?: string; name: string; muscle_group?: string };

export type LoggedSession = {
  key: string;
  date: string;
  exerciseId: string;
  exerciseName: string;
  sets: WorkoutSet[];
  topSet: { weight: number; reps: number };
  e1rm: number;
  /** No set in this session carried external load. */
  isBodyweight: boolean;
  /** Firestore workout session id when the server provided one. */
  sessionId?: string;
};

/**
 * What a progression line measures.
 *
 * e1RM is meaningless for unloaded work — the Epley formula multiplies by
 * weight, so every set of pull-ups estimates to zero and the line sits flat on
 * the floor no matter how the reps climb. An exercise that is never loaded is
 * therefore charted in reps instead.
 */
export type ProgressionMetric = "e1rm" | "reps";

export type SessionTrend = "baseline" | "progress" | "maintain" | "stall" | "gap";

export type ChartPoint = {
  key: string;
  date: string;
  /** Epoch ms. The x axis spaces points by time, not by index. */
  t: number;
  /** null = nothing to plot here — render a break, never a zero. */
  value: number | null;
  session?: LoggedSession;
  /** Every session behind this point (a muscle-group day holds several). */
  sessions?: LoggedSession[];
  trend?: SessionTrend;
  label?: string;
  /** When set, the scrub badge shows this instead of "value unit · label". */
  scrubText?: string;
};

export type ExerciseChart = {
  points: ChartPoint[];
  metric: ProgressionMetric;
  sessions: LoggedSession[];
};

const GAP_DAYS = 14;
const ROLLING_WINDOW = 3;
const DAY_MS = 86_400_000;

/** Epley estimated 1RM. Returns 0 for unloaded work — see ProgressionMetric. */
export function calcE1rm(weight: number, reps: number) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

/**
 * Parse a logged date to epoch ms.
 *
 * Sessions are stored as `YYYY-MM-DD`, which `new Date()` reads as UTC
 * midnight and then renders a day early west of Greenwich; noon local avoids
 * that. Full timestamps are passed through rather than having `T12:00:00`
 * appended, which would produce an invalid date and silently read as NaN.
 */
export function parseDate(value: string): number {
  if (!value) return NaN;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  return new Date(normalized).getTime();
}

/** Stimulus counts reps when a movement carries no external load. */
export function sessionStimulus(sets: WorkoutSet[]) {
  return sets.reduce(
    (sum, set) => sum + (set.weight > 0 ? set.weight * set.reps : set.reps),
    0
  );
}

export function daysBetween(a: string, b: string) {
  const da = parseDate(a);
  const db = parseDate(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return 0;
  return Math.abs(Math.round((db - da) / DAY_MS));
}

/** The value this session contributes to a chart drawn in `metric`. */
export function sessionValue(
  session: LoggedSession,
  metric: ProgressionMetric
): number | null {
  if (metric === "reps") return session.topSet.reps || null;
  // A loaded exercise charted in e1RM has nothing honest to plot for a session
  // done without load. A break says "no comparable data"; a zero would claim a
  // total collapse in strength.
  return session.isBodyweight ? null : session.e1rm || null;
}

/** An exercise is charted in reps only when it was never loaded. */
export function metricForSessions(sessions: LoggedSession[]): ProgressionMetric {
  return sessions.some((session) => !session.isBodyweight) ? "e1rm" : "reps";
}

/** Compare two logged sessions for progression semantics. */
export function compareSessions(
  prev: LoggedSession | undefined,
  next: LoggedSession
): SessionTrend {
  // Nothing precedes the first session, so it is neither progress nor a
  // plateau. Calling it "progress" made every new exercise open on a green
  // dot reading "moving up" against no comparison at all.
  if (!prev) return "baseline";

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

type RawSet = {
  set_number?: number;
  weight?: number;
  reps?: number;
  completed?: boolean;
};
type RawSession = {
  date?: string;
  session_id?: string;
  sets?: RawSet[];
  top_set?: { weight?: number; reps?: number } | null;
};

/**
 * The one list of logged sessions for an exercise.
 *
 * `recent_sessions` is the server's display history — lifetime, matched by id
 * or name, unloaded sets kept. `history_context.recent_sessions` is the older
 * fallback. Concatenating the two double-counted any date they shared and let
 * a thinner record win on arrival order, so exactly one wins here, and every
 * caller uses this function so the chart and the list beneath it can never
 * disagree about which sessions exist.
 */
export function rawSessionsFor(exercise: ProjectedExercise): RawSession[] {
  const primary = (exercise.recent_sessions || []) as RawSession[];
  const fallback = (exercise.history_context?.recent_sessions || []) as RawSession[];
  const chosen = primary.length ? primary : fallback;
  // The projector emits synthetic `week-N` rows for its forward curve. They
  // are not logged history and must never reach a history line.
  return chosen.filter(
    (session) => session.date && !String(session.date).startsWith("week-")
  );
}

/** True when `incoming` is already present as a contiguous block in `existing`. */
function sameSetPayload(existing: RawSet[], incoming: RawSet[]): boolean {
  if (!incoming.length) return true;
  if (existing.length !== incoming.length) return false;
  return incoming.every((set, index) => {
    const other = existing[index];
    return (
      (other?.weight || 0) === (set.weight || 0) &&
      (other?.reps || 0) === (set.reps || 0) &&
      (other?.set_number || index + 1) === (set.set_number || index + 1)
    );
  });
}

export function getSessionRecords(exercise: ProjectedExercise): LoggedSession[] {
  const byDate = new Map<string, RawSet[]>();
  const topByDate = new Map<string, { weight: number; reps: number }>();
  const idByDate = new Map<string, string>();

  for (const session of rawSessionsFor(exercise)) {
    const date = String(session.date);
    // Two entries on one date are the same day's work for this lift, so their
    // sets join rather than one replacing the other — unless the second entry
    // is an identical copy (A/B plan rows sharing one history payload).
    const sets = byDate.get(date) || [];
    const incoming = session.sets || [];
    if (!sameSetPayload(sets, incoming)) {
      sets.push(...incoming);
    }
    byDate.set(date, sets);

    if (session.session_id && !idByDate.has(date)) {
      idByDate.set(date, session.session_id);
    }

    if (session.top_set && !topByDate.has(date)) {
      topByDate.set(date, {
        weight: session.top_set.weight || 0,
        reps: session.top_set.reps || 0,
      });
    }
  }

  const records: LoggedSession[] = [];

  for (const date of [...byDate.keys()].sort()) {
    const raw = byDate.get(date)!;
    const sets: WorkoutSet[] = raw
      // The logged ordinal is read before anything is dropped, so hiding an
      // unticked set 2 leaves set 3 labelled "Set 3" rather than "Set 2".
      .map((set, index) => ({
        setNumber: set.set_number || index + 1,
        weight: set.weight || 0,
        reps: set.reps || 0,
        completed: set.completed,
      }))
      .filter((set) => set.completed !== false && set.reps > 0)
      .map(({ completed: _completed, ...set }) => set);

    const fallbackTop = topByDate.get(date);
    // A session whose sets were all left unticked still happened. Older logs
    // are full of them, and dropping the session entirely made real work
    // disappear from the chart with no indication it had been discarded.
    const usable = sets.length > 0;
    if (!usable && !(fallbackTop && fallbackTop.reps > 0)) continue;

    const pool: WorkoutSet[] = usable
      ? sets
      : [{ setNumber: 1, weight: fallbackTop!.weight, reps: fallbackTop!.reps }];

    const loaded = pool.filter((set) => set.weight > 0);
    const isBodyweight = loaded.length === 0;

    const topSet = isBodyweight
      ? pool.reduce((best, set) => (set.reps > best.reps ? set : best), pool[0])
      : loaded.reduce(
          (best, set) =>
            calcE1rm(set.weight, set.reps) > calcE1rm(best.weight, best.reps) ? set : best,
          loaded[0]
        );

    const e1rm = isBodyweight
      ? 0
      : Math.round(Math.max(...loaded.map((set) => calcE1rm(set.weight, set.reps))));

    records.push({
      key: `${exercise.exercise_id}-${date}`,
      date,
      exerciseId: exercise.exercise_id,
      exerciseName: exercise.exercise_name,
      sets: usable ? sets : pool,
      topSet: { weight: topSet.weight, reps: topSet.reps },
      e1rm,
      isBodyweight,
      sessionId: idByDate.get(date),
    });
  }

  return records;
}

/**
 * Exercise-level chart: one point per logged session, with gaps and trends.
 *
 * `valueFor` overrides the y value (the per-set filter uses it). Returning
 * null breaks the line instead of dropping it to zero.
 */
export function buildExerciseChart(
  exercise: ProjectedExercise,
  valueFor?: (session: LoggedSession, metric: ProgressionMetric) => number | null
): ExerciseChart {
  const sessions = getSessionRecords(exercise);
  const metric = metricForSessions(sessions);
  const read = valueFor || sessionValue;
  const points: ChartPoint[] = [];
  let prev: LoggedSession | undefined;

  for (const session of sessions) {
    if (prev && daysBetween(prev.date, session.date) > GAP_DAYS) {
      points.push({
        key: `gap-${prev.date}-${session.date}`,
        date: session.date,
        t: parseDate(session.date),
        value: null,
        trend: "gap",
      });
    }
    points.push({
      key: session.key,
      date: session.date,
      t: parseDate(session.date),
      value: read(session, metric),
      session,
      sessions: [session],
      trend: compareSessions(prev, session),
    });
    prev = session;
  }

  return { points, metric, sessions };
}

function categoryForExercise(
  exercise: ProjectedExercise,
  customExercises: CustomExercise[] = []
) {
  return resolveExerciseCategory(
    exercise.exercise_id,
    exercise.exercise_name,
    customExercises
  );
}

/**
 * Muscle-group chart from the server's whole-log stimulus history.
 *
 * Smoothed over a rolling window so one unusually heavy session does not read
 * as a trend, and broken across layoffs rather than averaged through them.
 */
export function buildMuscleGroupPoints(days: MuscleGroupDay[]): ChartPoint[] {
  const ordered = [...(days || [])].sort((a, b) => a.date.localeCompare(b.date));
  const raw: ChartPoint[] = [];
  let prevDate: string | undefined;

  for (const day of ordered) {
    const sessions: LoggedSession[] = (day.sessions || []).map((entry, index) => {
      const sets: WorkoutSet[] = (entry.sets || [])
        .map((set, i) => ({
          setNumber: set.set_number || i + 1,
          weight: set.weight || 0,
          reps: set.reps || 0,
        }))
        .filter((set) => set.reps > 0);
      const loaded = sets.filter((set) => set.weight > 0);
      const top =
        loaded.length > 0
          ? loaded.reduce(
              (best, set) =>
                calcE1rm(set.weight, set.reps) > calcE1rm(best.weight, best.reps) ? set : best,
              loaded[0]
            )
          : sets.reduce(
              (best, set) => (set.reps > best.reps ? set : best),
              sets[0] || { setNumber: 1, weight: 0, reps: 0 }
            );
      return {
        key: `${day.date}-${entry.exercise_id || entry.exercise_name}-${index}`,
        date: day.date,
        exerciseId: entry.exercise_id || "",
        exerciseName: entry.exercise_name || "Exercise",
        sets,
        topSet: { weight: top.weight, reps: top.reps },
        e1rm: loaded.length ? Math.round(calcE1rm(top.weight, top.reps)) : 0,
        isBodyweight: loaded.length === 0,
      };
    });

    if (prevDate && daysBetween(prevDate, day.date) > GAP_DAYS) {
      raw.push({
        key: `gap-${prevDate}-${day.date}`,
        date: day.date,
        t: parseDate(day.date),
        value: null,
        trend: "gap",
      });
    }

    const setCount = sessions.reduce((n, session) => n + session.sets.length, 0);
    raw.push({
      key: `mg-${day.date}`,
      date: day.date,
      t: parseDate(day.date),
      value: day.stimulus,
      session: sessions[0],
      sessions,
      // Scrub shows sets, not the stimulus number — "537 volume" was meaningless
      // next to the set list the callout already renders.
      scrubText: `${setCount} set${setCount === 1 ? "" : "s"}`,
      label: `${setCount} set${setCount === 1 ? "" : "s"}`,
    });
    prevDate = day.date;
  }

  const smoothed = rollingAverage(raw.map((point) => point.value), ROLLING_WINDOW);

  return raw.map((point, index) => {
    if (point.value == null) return point;
    const value = smoothed[index] ?? point.value;
    // Both sides of this comparison must be smoothed. Measuring a smoothed
    // value against the previous *raw* one reintroduced exactly the
    // single-session sensitivity the smoothing exists to remove.
    let previous: number | null = null;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (raw[i].value == null) break;
      previous = smoothed[i] ?? raw[i].value;
      break;
    }
    let trend: SessionTrend = previous == null ? "baseline" : "maintain";
    if (previous != null) {
      if (value > previous * 1.03) trend = "progress";
      else if (value < previous * 0.97) trend = "stall";
    }
    return { ...point, value, trend };
  });
}

/** Fallback for a server that predates `muscle_group_history`. */
export function buildMuscleGroupPointsFromExercises(
  exercises: ProjectedExercise[],
  muscleGroup: string,
  customExercises: CustomExercise[] = []
): ChartPoint[] {
  const byDate = new Map<string, MuscleGroupDay>();

  for (const exercise of exercises) {
    const category = categoryForExercise(exercise, customExercises);
    if (!exerciseMatchesMuscleGroup(category, muscleGroup)) continue;
    for (const session of getSessionRecords(exercise)) {
      const day =
        byDate.get(session.date) ||
        ({ date: session.date, stimulus: 0, sessions: [] } as MuscleGroupDay);
      day.stimulus += sessionStimulus(session.sets);
      day.sessions.push({
        exercise_id: session.exerciseId,
        exercise_name: session.exerciseName,
        sets: session.sets.map((set) => ({
          set_number: set.setNumber,
          weight: set.weight,
          reps: set.reps,
        })),
      });
      byDate.set(session.date, day);
    }
  }

  return buildMuscleGroupPoints([...byDate.values()]);
}

/** Rolling mean that restarts after a layoff rather than averaging across it. */
export function rollingAverage(values: Array<number | null>, window: number) {
  const out: Array<number | null> = [];
  let recent: number[] = [];
  for (const value of values) {
    if (value == null) {
      out.push(null);
      // A gap ends the window. Carrying pre-layoff sessions into the average
      // made the first session back look like a continuation of old volume.
      recent = [];
      continue;
    }
    recent.push(value);
    if (recent.length > window) recent.shift();
    out.push(recent.reduce((a, b) => a + b, 0) / recent.length);
  }
  return out;
}

export function muscleGroupsForDay(
  exercises: ProjectedExercise[],
  customExercises: CustomExercise[] = []
) {
  const groups = new Set<string>();
  for (const exercise of exercises) {
    const category = categoryForExercise(exercise, customExercises);
    if (category) groups.add(category);
  }
  return [...groups];
}

/**
 * Which body-part charts belong on a Push / Pull / Legs page.
 *
 * Exercise categories alone are the wrong source: Face Pulls are catalogued as
 * SHOULDERS but live on Pull days, which put a Shoulders chart under Pull.
 * The family name is the intent — Pull is Back + Biceps, Push carries Shoulders.
 */
export function muscleGroupsForPlanFamily(
  familyKey: string,
  exercises: ProjectedExercise[],
  options: {
    dayNames?: string[];
    focus?: string;
    customExercises?: CustomExercise[];
  } = {}
): string[] {
  const fromFamily = muscleGroupsForSplitDay(
    familyKey,
    undefined,
    options.focus
  );
  if (fromFamily.length) return fromFamily;

  for (const name of options.dayNames || []) {
    const fromDay = muscleGroupsForSplitDay(name, undefined, options.focus);
    if (fromDay.length) return fromDay;
  }

  return muscleGroupsForDay(exercises, options.customExercises || []);
}

export function formatShortDate(value: string) {
  const time = parseDate(value);
  return Number.isNaN(time)
    ? value
    : new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatSetLine(set: WorkoutSet) {
  return set.weight > 0 ? `${set.weight}×${set.reps}` : `${set.reps} reps`;
}

export function trendLabel(trend?: SessionTrend) {
  if (trend === "progress") return "moving up";
  if (trend === "stall") return "stall detected";
  if (trend === "gap") return "missing session";
  if (trend === "baseline") return "first session";
  return "holding steady";
}

/**
 * Data-mark colours.
 *
 * Deliberately not the UI accents: the brand teal and orange sit above the
 * lightness band that reads as a mark on the dark card surface, and using the
 * accent for "progress" made progress and maintain identical on any chart
 * whose accent was already teal.
 */
export const TREND_COLORS: Record<SessionTrend, string> = {
  progress: "#0D9488",
  maintain: "#7C8AA5",
  stall: "#E2622B",
  gap: "#4A4A50",
  baseline: "#8E8E93",
};

export function trendColor(trend?: SessionTrend) {
  return TREND_COLORS[trend || "maintain"];
}

export function sessionsForPoint(point: ChartPoint | null): LoggedSession[] {
  if (!point) return [];
  if (point.sessions?.length) return point.sessions;
  return point.session ? [point.session] : [];
}
