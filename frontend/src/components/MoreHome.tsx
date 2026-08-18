import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, borderRadius } from "../theme";

interface MoreHomeProps {
  navigation: any;
}

export default function MoreHome({ navigation }: MoreHomeProps) {
  const features = [
    {
      id: "Activity",
      title: "Activity",
      subtitle: "Steps and daily movement",
      icon: "run-fast" as keyof typeof MaterialCommunityIcons.glyphMap,
      screen: "Activity",
    },
    {
      id: "Wellness",
      title: "Wellness",
      subtitle: "Sleep, stress, body, and survey",
      icon: "heart-pulse" as keyof typeof MaterialCommunityIcons.glyphMap,
      screen: "Wellness",
    },
    {
      id: "Dashboard",
      title: "Dashboard",
      subtitle: "Overview of your fitness",
      icon: "view-dashboard" as keyof typeof MaterialCommunityIcons.glyphMap,
      screen: "Dashboard",
    },
    {
      id: "UserProfile",
      title: "My Profile",
      subtitle: "Complete fitness profile",
      icon: "account-circle" as keyof typeof MaterialCommunityIcons.glyphMap,
      screen: "UserProfile",
    },
    {
      id: "Calendar",
      title: "Calendar",
      subtitle: "View all activities",
      icon: "calendar-month" as keyof typeof MaterialCommunityIcons.glyphMap,
      screen: "Calendar",
    },
    {
      id: "SavedFoods",
      title: "Saved Foods",
      subtitle: "Edit foods you've logged before",
      icon: "food-apple-outline" as keyof typeof MaterialCommunityIcons.glyphMap,
      screen: "SavedFoods",
    },
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>More</Text>
        <Text style={styles.subtitle}>Activity, wellness, and profile</Text>
      </View>

      <View style={styles.grid}>
        {features.map((feature) => (
          <TouchableOpacity
            key={feature.id}
            style={styles.card}
            onPress={() => {
              if (feature.screen === "SavedFoods") {
                navigation.getParent()?.navigate("Nutrition", { tab: "foods" });
                return;
              }
              navigation.navigate(feature.screen);
            }}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name={feature.icon} size={22} color={colors.accentPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{feature.title}</Text>
              <Text style={styles.cardSubtitle}>{feature.subtitle}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
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
    paddingVertical: spacing.xl,
    paddingTop: spacing["2xl"],
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
    paddingBottom: spacing.xl,
    gap: 10,
  },
  card: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  cardSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
