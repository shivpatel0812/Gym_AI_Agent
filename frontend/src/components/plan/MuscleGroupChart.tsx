import { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { MuscleGroupDay, ProjectedExercise } from "../../api/trainingPlan";
import { MUSCLE_GROUP_LABELS } from "../workouts/sessionLogic";
import { colors } from "../../theme";
import {
  buildMuscleGroupPoints,
  buildMuscleGroupPointsFromExercises,
  muscleGroupsForDay,
  sessionsForPoint,
  type ChartPoint,
  type CustomExercise,
  type LoggedSession,
} from "./chartUtils";
import ScrubbableLineChart from "./ScrubbableLineChart";
import WorkoutDetailCallout from "./WorkoutDetailCallout";

export default function MuscleGroupCharts({
  exercises,
  history,
  customExercises,
}: {
  exercises: ProjectedExercise[];
  /** Whole-log stimulus by muscle group, keyed by catalog category. */
  history?: Record<string, MuscleGroupDay[]>;
  customExercises?: CustomExercise[];
}) {
  // Which groups this day trains comes from the plan; the numbers behind them
  // come from the whole log. Every group the day touches gets a chart — the
  // old cap of three silently hid a muscle with no indication it existed.
  const groups = useMemo(
    () => muscleGroupsForDay(exercises, customExercises),
    [exercises, customExercises]
  );
  if (!groups.length) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Muscle-group stimulus</Text>
      <Text style={styles.sub}>
        Rolling volume across every logged session — drag to see which lifts drove each day
      </Text>
      {groups.map((group) => (
        <MuscleGroupBlock
          key={group}
          muscleGroup={group}
          exercises={exercises}
          history={history}
          customExercises={customExercises}
        />
      ))}
    </View>
  );
}

function MuscleGroupBlock({
  muscleGroup,
  exercises,
  history,
  customExercises,
}: {
  muscleGroup: string;
  exercises: ProjectedExercise[];
  history?: Record<string, MuscleGroupDay[]>;
  customExercises?: CustomExercise[];
}) {
  const points = useMemo(() => {
    const days = history?.[muscleGroup];
    // The server resolves muscle groups across the whole log, custom
    // exercises included. Falling back to the plan day's exercises keeps this
    // working against a server that predates that field.
    if (days?.length) return buildMuscleGroupPoints(days);
    return buildMuscleGroupPointsFromExercises(exercises, muscleGroup, customExercises);
  }, [history, muscleGroup, exercises, customExercises]);

  const [scrubSessions, setScrubSessions] = useState<LoggedSession[]>([]);
  const label = MUSCLE_GROUP_LABELS[muscleGroup] || muscleGroup;

  const onScrub = (point: ChartPoint | null) => setScrubSessions(sessionsForPoint(point));

  return (
    <View style={styles.block}>
      <Text style={styles.groupLabel}>{label}</Text>
      <ScrubbableLineChart
        points={points}
        height={112}
        accent={colors.accentPrimary}
        unit="volume"
        onScrub={onScrub}
      />
      {scrubSessions.length ? (
        <WorkoutDetailCallout
          sessions={scrubSessions}
          title={`Logged ${label.toLowerCase()} work`}
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
