import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "../../theme";
import { formatSetLine, formatShortDate, type LoggedSession } from "./chartUtils";

export default function WorkoutDetailCallout({
  sessions,
  title,
  onOpenSession,
}: {
  sessions: LoggedSession[];
  title?: string;
  /** Opens the logged workout when the server attached a session id. */
  onOpenSession?: (sessionId: string) => void;
}) {
  if (!sessions.length) return null;

  return (
    <View style={styles.box}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {sessions.map((session) => (
        <View key={session.key} style={styles.session}>
          <Text style={styles.headline}>
            {formatShortDate(session.date)} · {session.exerciseName}
          </Text>
          {session.sets.length ? (
            session.sets.map((set, index) => (
              <Text key={`${session.key}-${index}-${set.setNumber}`} style={styles.setLine}>
                Set {set.setNumber}: {formatSetLine(set)}
              </Text>
            ))
          ) : (
            <Text style={styles.setLine}>Session logged — no set detail saved</Text>
          )}
          {session.sessionId && onOpenSession ? (
            <TouchableOpacity
              style={styles.openBtn}
              onPress={() => onOpenSession(session.sessionId!)}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            >
              <MaterialCommunityIcons name="open-in-new" size={14} color={colors.accentPrimary} />
              <Text style={styles.openText}>Open workout</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  title: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  session: { gap: 3 },
  headline: { fontSize: 12, fontWeight: "800", color: colors.textPrimary },
  setLine: { fontSize: 11, color: colors.textSecondary, lineHeight: 16 },
  openBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
    alignSelf: "flex-start",
  },
  openText: { fontSize: 12, fontWeight: "700", color: colors.accentPrimary },
});
