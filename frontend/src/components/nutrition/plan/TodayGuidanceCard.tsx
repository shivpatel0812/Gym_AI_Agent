import { View, Text, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { TodayGuidance } from "../../../api/nutritionPlan";
import { colors, spacing, borderRadius } from "../../../theme";

export default function TodayGuidanceCard({ guidance }: { guidance: TodayGuidance | null }) {
  if (!guidance?.has_plan || !guidance.messages?.length) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="lightbulb-outline" size={18} color={colors.accentPrimary} />
        <Text style={styles.title}>From your plan</Text>
      </View>
      {guidance.headline ? <Text style={styles.headline}>{guidance.headline}</Text> : null}
      {(guidance.messages || [])
        .filter((m) => m !== guidance.headline)
        .map((message, i) => (
          <Text key={i} style={styles.body}>
            {message}
          </Text>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: "rgba(156, 192, 232,0.35)",
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { fontSize: 13, fontWeight: "700", color: colors.accentPrimary, letterSpacing: 0.3 },
  headline: { fontSize: 15, fontWeight: "600", color: colors.textPrimary, lineHeight: 21 },
  body: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
});
