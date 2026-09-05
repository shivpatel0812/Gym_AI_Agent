/**
 * A login-free page that renders the Plan Hub charts against fixtures.
 *
 * The chart bugs were all data-shape bugs — a layoff, an unticked set, an
 * unloaded lift — and none of them are reachable from a seeded demo account on
 * demand. This mounts the real components with the exact shapes that used to
 * break them, so the rendering can be checked in a browser rather than
 * inferred from the geometry.
 *
 * To run it:
 *   1. Replace App.tsx's default export with `() => <ChartHarness />`
 *   2. `npx expo start --web`
 *   3. Restore App.tsx afterwards
 *
 * Nothing in the app imports this, so it costs the shipped bundle nothing.
 * `Trajectory` and `FocusExerciseDetail` are exported from PlanHub for it.
 */
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { MuscleGroupDay, ProjectedExercise } from "../api/trainingPlan";
import HistoryStrip from "../components/plan/HistoryStrip";
import MuscleGroupCharts from "../components/plan/MuscleGroupChart";
import ScrubbableLineChart from "../components/plan/ScrubbableLineChart";
import { FocusExerciseDetail, Trajectory } from "../components/plan/PlanHub";
import {
  buildExerciseChart,
  buildMuscleGroupPoints,
  sessionsForPoint,
  type ChartPoint,
} from "../components/plan/chartUtils";
import { colors } from "../theme";

const set = (weight: number, reps: number, extra: Record<string, unknown> = {}) => ({
  weight,
  reps,
  ...extra,
});

function week(n: number, weight: number, reps: number) {
  return { week: n, weight, reps, e1rm: Math.round(weight * (1 + reps / 30)) };
}

function base(overrides: Partial<ProjectedExercise>): ProjectedExercise {
  return {
    exercise_id: "ex",
    exercise_name: "Exercise",
    sets: 3,
    reps: 8,
    order: 1,
    day_name: "Push",
    sessions_per_week: 2,
    seeded_from_history: true,
    current: week(0, 80, 6),
    best_case: [1, 2, 3, 4, 5, 6].map((w) => week(w, 80 + w * 2.5, 6)),
    realistic: [1, 2, 3, 4, 5, 6].map((w) => week(w, 80 + w * 1.5, 6)),
    gain: { best_case_e1rm: 15, realistic_e1rm: 9, best_case_pct: 15, realistic_pct: 9 },
    ...overrides,
  } as ProjectedExercise;
}

/** A three-month layoff mid-history — the line must break, not flatline. */
const withGap = base({
  exercise_id: "gap",
  exercise_name: "Incline Dumbbell Press",
  recent_sessions: [
    { date: "2026-04-04", sets: [set(70, 8), set(70, 7), set(70, 6)] },
    { date: "2026-04-11", sets: [set(72.5, 8), set(72.5, 6), set(70, 8)] },
    { date: "2026-04-18", sets: [set(75, 7), set(75, 6), set(72.5, 7)] },
    // Layoff.
    { date: "2026-08-01", sets: [set(70, 6), set(70, 5), set(65, 8)] },
    { date: "2026-08-08", sets: [set(75, 6), set(75, 5), set(70, 8)] },
    { date: "2026-08-15", sets: [set(80, 6), set(80, 4), set(75, 7)] },
    { date: "2026-08-22", sets: [set(80, 7), set(80, 5), set(75, 8)] },
  ],
  history_context: { lifetime_session_count: 34 },
});

/** No external load anywhere — must chart in reps, not a flat zero line. */
const bodyweight = base({
  exercise_id: "bw",
  exercise_name: "Pull-ups",
  current: week(0, 0, 8),
  best_case: [],
  realistic: [],
  recent_sessions: [
    { date: "2026-08-01", sets: [set(0, 6), set(0, 5), set(0, 4)] },
    { date: "2026-08-08", sets: [set(0, 8), set(0, 6), set(0, 5)] },
    { date: "2026-08-15", sets: [set(0, 9), set(0, 7), set(0, 6)] },
    { date: "2026-08-22", sets: [set(0, 11), set(0, 8), set(0, 7)] },
  ],
});

/** Every set left unticked — the session must survive via its top set. */
const unticked = base({
  exercise_id: "unticked",
  exercise_name: "Barbell Row",
  recent_sessions: [
    { date: "2026-08-01", sets: [set(135, 8, { completed: true })] },
    {
      date: "2026-08-08",
      sets: [set(145, 8, { completed: false }), set(145, 6, { completed: false })],
      top_set: { weight: 145, reps: 8 },
    },
    { date: "2026-08-15", sets: [set(155, 7, { completed: true })] },
  ],
});

/** One logged session only: the TODAY divider must not clip off the edge. */
const single = base({
  exercise_id: "single",
  exercise_name: "Overhead Press",
  recent_sessions: [{ date: "2026-08-20", sets: [set(95, 5), set(95, 5)] }],
});

/** Set 3 is present on only some sessions — the filter must break, not zero. */
const mixedSets = base({
  exercise_id: "mixed",
  exercise_name: "Incline Dumbbell Press",
  priority: "high",
  goal: "strength",
  recent_sessions: [
    { date: "2026-08-01", sets: [set(70, 8), set(70, 7), set(65, 8)] },
    { date: "2026-08-08", sets: [set(75, 7), set(75, 6)] },
    { date: "2026-08-15", sets: [set(75, 8), set(75, 7), set(70, 9)] },
    { date: "2026-08-22", sets: [set(80, 6), set(80, 5)] },
  ],
  history_context: { lifetime_session_count: 18 },
});

const chestHistory: MuscleGroupDay[] = [
  { date: "2026-06-06", stimulus: 5400, sessions: [lift("Incline Dumbbell Press", 70, 8)] },
  { date: "2026-06-13", stimulus: 5800, sessions: [lift("Incline Dumbbell Press", 72.5, 8)] },
  // A single very heavy day — smoothing must absorb it.
  { date: "2026-06-20", stimulus: 14200, sessions: [lift("Barbell Bench Press", 185, 5)] },
  { date: "2026-06-27", stimulus: 6100, sessions: [lift("Cable Flyes", 40, 12)] },
  // Layoff.
  { date: "2026-08-08", stimulus: 6400, sessions: [lift("Incline Dumbbell Press", 75, 7)] },
  { date: "2026-08-15", stimulus: 7100, sessions: [lift("Cable Flyes", 45, 12)] },
  { date: "2026-08-22", stimulus: 7900, sessions: [lift("Incline Dumbbell Press", 80, 6)] },
];

function lift(name: string, weight: number, reps: number) {
  return {
    exercise_id: name.toLowerCase().replace(/\s+/g, "-"),
    exercise_name: name,
    sets: [1, 2, 3].map((n) => ({ set_number: n, weight, reps })),
  };
}

function Case({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <View style={styles.case} testID={`case-${title}`}>
      <Text style={styles.caseTitle}>{title}</Text>
      <Text style={styles.caseNote}>{note}</Text>
      <View style={styles.caseBody}>{children}</View>
    </View>
  );
}

/**
 * Records the last scrub instead of clearing on release, so a completed drag
 * leaves something a browser test can read. PanResponder ignores synthetic
 * events, so the gesture has to be driven by real pointer input.
 */
function ScrubProbe({ points }: { points: ChartPoint[] }) {
  const [last, setLast] = useState("none");
  return (
    <View>
      <ScrubbableLineChart
        points={points}
        height={130}
        unit="e1RM"
        onScrub={(point) => {
          if (!point) return;
          const sessions = sessionsForPoint(point);
          setLast(
            `${point.date} value=${point.value ?? "null"} sets=${sessions[0]?.sets.length ?? 0}`
          );
        }}
      />
      <Text style={styles.probe} testID="scrub-readout">
        last scrub: {last}
      </Text>
    </View>
  );
}

export default function ChartHarness() {
  const bodyweightChart = buildExerciseChart(bodyweight);
  const gapChart = buildExerciseChart(withGap);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Plan Hub chart harness</Text>

      <Case
        title="Layoff"
        note="Three-month gap between Apr 18 and Aug 1. The line must break and the spacing must reflect real time."
      >
        <ScrubbableLineChart points={gapChart.points} height={140} unit="e1RM" />
      </Case>

      <Case
        title="Bodyweight"
        note="Pull-ups, no external load. Charted in reps — an e1RM axis would be a flat line of zeros."
      >
        <ScrubbableLineChart
          points={bodyweightChart.points}
          height={140}
          unit={bodyweightChart.metric === "reps" ? "reps" : "e1RM"}
        />
        <Text style={styles.meta}>metric: {bodyweightChart.metric}</Text>
      </Case>

      <Case
        title="Unticked sets"
        note="Aug 8 was logged with every set unticked. It must still appear, via its top set."
      >
        <HistoryStrip exercise={unticked} />
      </Case>

      <Case title="Trajectory — full history" note="History left of TODAY, projection right. Both scrub.">
        <Trajectory exercise={withGap} flat={false} />
      </Case>

      <Case
        title="Trajectory — one session"
        note="TODAY must stay inside the canvas rather than clipping off the left edge."
      >
        <Trajectory exercise={single} flat={false} />
      </Case>

      <Case
        title="Muscle group — smoothed"
        note="One 14,200 spike on Jun 20 must not dominate; the Jun 27 to Aug 8 layoff must break the line."
      >
        <ScrubbableLineChart points={buildMuscleGroupPoints(chestHistory)} height={140} unit="volume" />
      </Case>

      <Case title="Muscle group block" note="Whole-log history, all groups the day touches.">
        <MuscleGroupCharts exercises={[withGap]} history={{ CHEST: chestHistory }} />
      </Case>

      <Case
        title="Scrub probe"
        note="Drag across this chart; the readout below records the last point the gesture resolved to."
      >
        <ScrubProbe points={gapChart.points} />
      </Case>

      <Case
        title="Detail — goal and history"
        note="Session chips, the per-set filter, and the goal ring. Set 3 exists only on some sessions."
      >
        <FocusExerciseDetail exercise={mixedSets} onClose={() => {}} />
      </Case>

      <Case title="Empty" note="No sessions at all — an empty state, not a broken chart.">
        <HistoryStrip exercise={base({ exercise_id: "empty", recent_sessions: [] })} />
      </Case>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 18, maxWidth: 760 },
  heading: { color: colors.textPrimary, fontSize: 20, fontWeight: "800", marginBottom: 4 },
  case: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
  },
  caseTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: "800" },
  caseNote: { color: colors.textSecondary, fontSize: 11, marginTop: 3, lineHeight: 16 },
  caseBody: { marginTop: 10 },
  meta: { color: colors.textMuted, fontSize: 10, marginTop: 6 },
  probe: { color: colors.ai, fontSize: 11, marginTop: 8, fontWeight: "700" },
});
