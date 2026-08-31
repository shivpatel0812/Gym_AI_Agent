import { View, Text, StyleSheet } from "react-native";
import { colors } from "../../theme";
import { formatSetLine, formatShortDate, type LoggedSession } from "./chartUtils";

export default function WorkoutDetailCallout({
  sessions,
  title,
}: {
  sessions: LoggedSession[];
  title?: string;
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
            session.sets.map((set) => (
              <Text key={`${session.key}-${set.setNumber}`} style={styles.setLine}>
                Set {set.setNumber}: {formatSetLine(set)}
              </Text>
            ))
          ) : (
            <Text style={styles.setLine}>Session logged — no set detail saved</Text>
          )}
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
});
