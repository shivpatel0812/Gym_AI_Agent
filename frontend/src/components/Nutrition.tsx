import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, StatusBar } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import MacrosSection from "./nutrition/MacrosSection";
import HydrationSection from "./nutrition/HydrationSection";
import { colors, spacing, borderRadius } from "../theme";

type TabType = "macros" | "hydration";

export default function Nutrition() {
  const [activeTab, setActiveTab] = useState<TabType>("macros");

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Nutrition</Text>
      </View>
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "macros" && styles.tabActive]}
          onPress={() => setActiveTab("macros")}
        >
          <MaterialCommunityIcons
            name={activeTab === "macros" ? "food" : "food-outline"}
            size={20}
            color={activeTab === "macros" ? colors.accentPrimary : colors.textSecondary}
            style={styles.tabIcon}
          />
          <Text style={[styles.tabText, activeTab === "macros" && styles.tabTextActive]}>
            Macros
          </Text>
          {activeTab === "macros" && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "hydration" && styles.tabActive]}
          onPress={() => setActiveTab("hydration")}
        >
          <MaterialCommunityIcons
            name={activeTab === "hydration" ? "water" : "water-outline"}
            size={20}
            color={activeTab === "hydration" ? colors.accentPrimary : colors.textSecondary}
            style={styles.tabIcon}
          />
          <Text style={[styles.tabText, activeTab === "hydration" && styles.tabTextActive]}>
            Hydration
          </Text>
          {activeTab === "hydration" && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === "macros" && <MacrosSection />}
        {activeTab === "hydration" && <HydrationSection />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: Platform.OS === "ios" ? 60 : StatusBar.currentHeight ? StatusBar.currentHeight + 16 : 16,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.textPrimary,
    textAlign: "left",
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    position: "relative",
  },
  tabActive: {
    // Active state handled by indicator
  },
  tabIcon: {
    marginRight: spacing.xs,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.accentPrimary,
  },
  tabIndicator: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: colors.accentPrimary,
    borderTopLeftRadius: borderRadius.sm,
    borderTopRightRadius: borderRadius.sm,
  },
  content: {
    flex: 1,
  },
});
