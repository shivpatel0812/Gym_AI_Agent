import { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { ProjectedExercise } from "../../api/trainingPlan";
import { MUSCLE_GROUP_LABELS } from "../workouts/sessionLogic";
import { colors } from "../../theme";
import {
  buildMuscleGroupChartPoints,
  muscleGroupsForDay,
  sessionsForMuscleGroupOnDate,
  type ChartPoint,
  type LoggedSession,
} from "./chartUtils";
import ScrubbableLineChart from "./ScrubbableLineChart";
import WorkoutDetailCallout from "./WorkoutDetailCallout";

export default function MuscleGroupCharts({ exercises }: { exercises: ProjectedExercise[] }) {
  const groups = useMemo(() => muscleGroupsForDay(exercises).slice(0, 3), [exercises]);
  if (!groups.length) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Muscle-group stimulus</Text>
      <Text style={styles.sub}>
        Rolling volume trend — drag to see which lifts drove each session
      </Text>
      {groups.map((group) => (
        <MuscleGroupBlock key={group} muscleGroup={group} exercises={exercises} />
      ))}
    </View>
  );
}

function MuscleGroupBlock({
  muscleGroup,
  exercises,
}: {
  muscleGroup: string;
  exercises: ProjectedExercise[];
}) {
  const points = useMemo(
    () => buildMuscleGroupChartPoints(exercises, muscleGroup),
    [exercises, muscleGroup]
  );
  const [scrubSessions, setScrubSessions] = useState<LoggedSession[]>([]);

  const onScrub = (point: ChartPoint | null) => {
    if (!point?.date) {
      setScrubSessions([]);
      return;
    }
    setScrubSessions(sessionsForMuscleGroupOnDate(exercises, muscleGroup, point.date));
  };

  return (
    <View style={styles.block}>
      <Text style={styles.groupLabel}>{MUSCLE_GROUP_LABELS[muscleGroup] || muscleGroup}</Text>
      <ScrubbableLineChart points={points} height={100} accent={colors.ai} onScrub={onScrub} />
      {scrubSessions.length ? (
        <WorkoutDetailCallout
          sessions={scrubSessions}
          title={`Logged ${(MUSCLE_GROUP_LABELS[muscleGroup] || muscleGroup).toLowerCase()} work`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  heading: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, color: colors.textMuted },
  sub: { fontSize: 11, color: colors.textSecondary, marginTop: -4, marginBottom: 4 },
  block: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  groupLabel: { fontSize: 13, fontWeight: "800", color: colors.textPrimary, marginBottom: 4 },
});
