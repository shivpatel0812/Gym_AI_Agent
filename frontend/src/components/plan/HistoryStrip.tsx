import { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { ProjectedExercise } from "../../api/trainingPlan";
import { colors } from "../../theme";
import {
  buildExerciseChart,
  sessionsForPoint,
  trendLabel,
  type ChartPoint,
  type LoggedSession,
} from "./chartUtils";
import ScrubbableLineChart from "./ScrubbableLineChart";
import WorkoutDetailCallout from "./WorkoutDetailCallout";

export default function HistoryStrip({
  exercise,
  flat,
}: {
  exercise: ProjectedExercise;
  flat?: boolean;
}) {
  const chart = useMemo(() => buildExerciseChart(exercise), [exercise]);
  const [scrubSessions, setScrubSessions] = useState<LoggedSession[]>([]);

  const plotted = chart.points.filter((point) => point.value != null);
  // "Moving up" needs something to move up from, so a lone baseline point is
  // not a trend. Only a comparison against a previous session is reported.
  const comparable = plotted.filter(
    (point) => point.trend && point.trend !== "gap" && point.trend !== "baseline"
  );
  const latestTrend = comparable.at(-1)?.trend;
  const count = chart.sessions.length;

  const summary = !count
    ? "Log a session to start your history line"
    : `${count} session${count === 1 ? "" : "s"}${
        latestTrend ? ` · ${trendLabel(latestTrend)}` : " · first session logged"
      }`;

  const onScrub = (point: ChartPoint | null) => setScrubSessions(sessionsForPoint(point));

  return (
    <View style={styles.wrap}>
      <View style={styles.copy}>
        <Text style={styles.label}>Recent sessions</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {summary}
        </Text>
      </View>
      <View style={styles.chart}>
        <ScrubbableLineChart
          points={chart.points}
          height={56}
          flat={flat}
          showAxis={false}
          unit={chart.metric === "reps" ? "reps" : "e1RM"}
          onScrub={onScrub}
        />
      </View>
      {scrubSessions.length ? <WorkoutDetailCallout sessions={scrubSessions} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  copy: { marginBottom: 4 },
  label: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: colors.textMuted,
  },
  meta: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  chart: { marginTop: 2 },
});
