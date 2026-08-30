import { useMemo } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { migrateSessionCardioToExercises } from "./sessionLogic";
import type { WorkoutSession } from "./types";
import { borderRadius, colors, spacing } from "../../theme";

type Props = {
  visible: boolean;
  sessions: WorkoutSession[];
  excludeSessionId?: string | null;
  onClose: () => void;
  onSelect: (session: WorkoutSession) => void;
};

export default function ImportSessionModal({
  visible,
  sessions,
  excludeSessionId,
  onClose,
  onSelect,
}: Props) {
  const options = useMemo(() => {
    return sessions
      .filter((session) => session.id !== excludeSessionId)
      .filter((session) => migrateSessionCardioToExercises(session).length > 0)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, 25);
  }, [sessions, excludeSessionId]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Import workout layout</Text>
              <Text style={styles.subtitle}>
                Pull in every exercise from a past session — fresh sets for today.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.close}>
              <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content}>
            {options.length ? (
              options.map((session) => {
                const exercises = migrateSessionCardioToExercises(session);
                const label =
                  session.split_day || session.workout_name || session.split_name || "Workout";
                return (
                  <TouchableOpacity
                    key={session.id || `${session.date}-${session.created_at}`}
                    style={styles.sessionRow}
                    onPress={() => onSelect(session)}
                  >
                    <View style={styles.sessionIcon}>
                      <MaterialCommunityIcons name="history" size={18} color={colors.accentPrimary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sessionName}>{label}</Text>
                      <Text style={styles.sessionMeta}>
                        {formatDate(session.date)} · {exercises.length} exercises
                      </Text>
                      <Text style={styles.exerciseList} numberOfLines={2}>
                        {exercises.map((exercise) => exercise.exercise_name).join(" · ")}
                      </Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                );
              })
            ) : (
              <Text style={styles.empty}>Log a workout first — then you can reuse its layout here.</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function formatDate(value?: string) {
  if (!value) return "Unknown date";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,.78)", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 20, fontWeight: "800", color: colors.textPrimary },
  subtitle: { fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: 4 },
  close: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: colors.surface,
  },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 13,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
  },
  sessionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.cardBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionName: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  sessionMeta: { fontSize: 11, color: colors.accentPrimary, marginTop: 2 },
  exerciseList: { fontSize: 10, lineHeight: 14, color: colors.textSecondary, marginTop: 3 },
  empty: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, paddingVertical: 24 },
});
