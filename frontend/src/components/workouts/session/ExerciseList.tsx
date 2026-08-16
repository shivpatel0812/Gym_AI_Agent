import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

interface ExerciseEntry {
  exercise_id: string;
  exercise_name: string;
  sets: any;
  is_custom?: boolean;
  plan_context?: {
    goal?: string;
    priority?: string;
    target_rep_range?: [number, number];
    source?: string;
  };
}

const GOAL_LABELS: Record<string, string> = {
  strength: "Strength Focus",
  hypertrophy: "Hypertrophy",
  fat_loss: "Fat Loss",
  general: "General",
};

/**
 * Only label an exercise when the plan actually changes how it's trained.
 * A plan that just repeats the user's normal goal isn't worth the clutter.
 */
function planLabel(ctx?: ExerciseEntry["plan_context"]): string | null {
  if (!ctx) return null;
  const fromPlan = ctx.source === "plan_exercise" || ctx.source === "plan_day";
  if (!fromPlan) return null;

  const parts: string[] = [];
  if (ctx.priority === "high") parts.push("High Priority");
  if (ctx.goal && ctx.goal !== "hypertrophy") parts.push(GOAL_LABELS[ctx.goal] || ctx.goal);
  if (!parts.length && ctx.target_rep_range) {
    parts.push(`${ctx.target_rep_range[0]}-${ctx.target_rep_range[1]} reps`);
  }
  return parts.length ? parts.join(" · ") : null;
}

interface ExerciseListProps {
  exercises: ExerciseEntry[];
  onRemove: (index: number) => void;
}

export default function ExerciseList({
  exercises,
  onRemove,
}: ExerciseListProps) {
  return (
    <>
      {exercises.map((ex, idx) => (
        <View key={idx} style={styles.exerciseItem}>
          <View style={styles.exerciseItemContent}>
            <View style={styles.exerciseHeader}>
              <Text style={styles.exerciseName}>{ex.exercise_name}</Text>
              {ex.is_custom && (
                <View style={styles.customBadge}>
                  <Text style={styles.customBadgeText}>Custom</Text>
                </View>
              )}
            </View>
            {planLabel(ex.plan_context) ? (
              <Text style={styles.planLabel}>{planLabel(ex.plan_context)}</Text>
            ) : null}
            {Array.isArray(ex.sets) ? (
              <View style={styles.setsDisplay}>
                {ex.sets.map((set: any, setIdx: number) => (
                  <Text key={setIdx} style={styles.setDisplayText}>
                    Set {set.set_number}: {set.reps} reps
                    {set.weight && ` @ ${set.weight}lbs`}
                  </Text>
                ))}
              </View>
            ) : (
              <Text style={styles.exerciseItemText}>
                {ex.sets} sets x {ex.reps} reps
                {ex.weight && ` @ ${ex.weight}lbs`}
              </Text>
            )}
          </View>
          <TouchableOpacity
            onPress={() => onRemove(idx)}
            style={styles.removeButton}
          >
            <Text style={styles.removeButtonText}>Remove</Text>
          </TouchableOpacity>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  exerciseItem: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  exerciseItemContent: {
    flex: 1,
  },
  exerciseHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  planLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#FF6B35",
    marginTop: 2,
  },
  customBadge: {
    backgroundColor: "#fbbf24",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  customBadgeText: {
    color: "#78350f",
    fontSize: 10,
    fontWeight: "600",
  },
  setsDisplay: {
    marginTop: 4,
  },
  setDisplayText: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 2,
  },
  exerciseItemText: {
    fontSize: 14,
    color: "#374151",
  },
  removeButton: {
    backgroundColor: "#ef4444",
    borderRadius: 6,
    padding: 6,
    paddingHorizontal: 12,
  },
  removeButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
});













