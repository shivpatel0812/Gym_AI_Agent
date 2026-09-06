import { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { MuscleGroupDay, ProjectedExercise } from "../../api/trainingPlan";
import { MUSCLE_GROUP_LABELS } from "../workouts/sessionLogic";
import { borderRadius, colors, spacing, typography, weight } from "../../theme";
import {
  buildMuscleGroupPoints,
  buildMuscleGroupPointsFromExercises,
  muscleGroupsForPlanFamily,
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
  familyKey,
  dayNames,
  focus,
}: {
  exercises: ProjectedExercise[];
  /** Whole-log stimulus by muscle group, keyed by catalog category. */
  history?: Record<string, MuscleGroupDay[]>;
  customExercises?: CustomExercise[];
  /** Plan Hub family — "pull" → Back + Biceps, never Shoulders. */
  familyKey?: string;
  dayNames?: string[];
  focus?: string;
}) {
  // Which groups this day trains comes from the split family when we know it;
  // exercise categories alone would put Face Pulls' SHOULDERS chart on Pull.
  const groups = useMemo(
    () =>
      muscleGroupsForPlanFamily(familyKey || "", exercises, {
        dayNames,
        focus,
        customExercises,
      }),
    [familyKey, exercises, dayNames, focus, customExercises]
  );
  if (!groups.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          No muscle groups mapped for this day yet. Open an exercise to see its roadmap.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
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
    padding: spacing.md,
    gap: spacing.md,
  },
  empty: {
    padding: spacing.md,
  },
  emptyText: {
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.textMutedCool,
  },
  block: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderCool,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  groupLabel: {
    fontSize: typography.body,
    fontWeight: weight.heavy,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
});
