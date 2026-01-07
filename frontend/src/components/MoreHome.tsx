import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import LinearGradient from "./shared/LinearGradient";
import { colors, spacing, borderRadius, shadows } from "../theme";

interface MoreHomeProps {
  navigation: any;
}

export default function MoreHome({ navigation }: MoreHomeProps) {
  const features = [
    {
      id: "Dashboard",
      title: "Dashboard",
      subtitle: "Overview of your fitness",
      icon: "view-dashboard" as keyof typeof MaterialCommunityIcons.glyphMap,
      gradient: [colors.accentPrimary, colors.accentSecondary],
      screen: "Dashboard",
    },
    {
      id: "AIChat",
      title: "AI Coach",
      subtitle: "Chat with your fitness AI",
      icon: "robot" as keyof typeof MaterialCommunityIcons.glyphMap,
      gradient: [colors.accentPrimary, colors.accentSecondary],
      screen: "AIChat",
    },
    {
      id: "AIAnalysis",
      title: "AI Analysis",
      subtitle: "Monthly fitness insights",
      icon: "chart-line" as keyof typeof MaterialCommunityIcons.glyphMap,
      gradient: [colors.accentSecondary, "#A78BFA"],
      screen: "AIAnalysis",
    },
    {
      id: "UserProfile",
      title: "My Profile",
      subtitle: "Complete fitness profile",
      icon: "account-circle" as keyof typeof MaterialCommunityIcons.glyphMap,
      gradient: [colors.success, "#34D399"],
      screen: "UserProfile",
    },
    {
      id: "Calendar",
      title: "Calendar",
      subtitle: "View all activities",
      icon: "calendar-month" as keyof typeof MaterialCommunityIcons.glyphMap,
      gradient: [colors.warning, "#FBBF24"],
      screen: "Calendar",
    },
  ];

  return (
    <ScrollView style={styles.container}>
      <LinearGradient colors={[colors.background, colors.cardBackground]} style={styles.header}>
        <Text style={styles.title}>More Features</Text>
        <Text style={styles.subtitle}>Explore advanced fitness tools</Text>
      </LinearGradient>

      <View style={styles.grid}>
        {features.map((feature) => (
          <TouchableOpacity
            key={feature.id}
            style={styles.cardWrapper}
            onPress={() => navigation.navigate(feature.screen)}
            activeOpacity={0.8}
          >
            <LinearGradient colors={feature.gradient} style={styles.card}>
              <MaterialCommunityIcons name={feature.icon} size={48} color={colors.textPrimary} />
              <Text style={styles.cardTitle}>{feature.title}</Text>
              <Text style={styles.cardSubtitle}>{feature.subtitle}</Text>
            </LinearGradient>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing["2xl"],
    paddingTop: spacing["3xl"],
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  grid: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.lg,
  },
  cardWrapper: {
    marginBottom: spacing.md,
  },
  card: {
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: "center",
    ...shadows.large,
    minHeight: 180,
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: spacing.lg,
    textAlign: "center",
  },
  cardSubtitle: {
    fontSize: 14,
    color: colors.textPrimary,
    opacity: 0.9,
    marginTop: spacing.xs,
    textAlign: "center",
  },
});
