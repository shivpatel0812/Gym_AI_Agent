import { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { ProjectedExercise } from "../../api/trainingPlan";
import { colors } from "../../theme";
import {
  buildExerciseChartPoints,
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
  const points = useMemo(() => buildExerciseChartPoints(exercise), [exercise]);
  const [scrubSessions, setScrubSessions] = useState<LoggedSession[]>([]);
  const latestTrend = points.filter((p) => p.trend && p.trend !== "gap").at(-1)?.trend;

  const onScrub = (point: ChartPoint | null) => {
    setScrubSessions(point?.session ? [point.session] : []);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.copy}>
        <Text style={styles.label}>Recent sessions</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {points.filter((p) => p.value != null).length
            ? `${points.filter((p) => p.value != null).length} sessions · ${trendLabel(latestTrend)}`
            : "Log a session to start your history line"}
        </Text>
      </View>
      <View style={styles.chart}>
        <ScrubbableLineChart
          points={points}
          height={56}
          flat={flat}
          showAxis={false}
          onScrub={onScrub}
        />
      </View>
      {scrubSessions.length ? (
        <WorkoutDetailCallout sessions={scrubSessions} />
      ) : null}
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
