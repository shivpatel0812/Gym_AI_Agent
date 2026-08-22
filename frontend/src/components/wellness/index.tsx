import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, StatusBar } from "react-native";
import StressSection from "./StressSection";
import BodyFeelingsSection from "./BodyFeelingsSection";
import WellnessSurveySection from "./WellnessSurveySection";
import SleepSection from "./SleepSection";
import { colors, spacing } from "../../theme";

type TabType = "stress" | "body" | "survey" | "sleep";

export default function Wellness() {
  const [activeTab, setActiveTab] = useState<TabType>("stress");
  const tabs: { id: TabType; label: string }[] = [
    { id: "stress", label: "Stress" },
    { id: "body", label: "Body" },
    { id: "survey", label: "Survey" },
    { id: "sleep", label: "Sleep" },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Wellness</Text>
        <Text style={styles.sub}>Track mental and physical well-being</Text>
      </View>
      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity key={tab.id} style={styles.tab} onPress={() => setActiveTab(tab.id)}>
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
              {isActive ? <View style={styles.tabIndicator} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        {activeTab === "stress" && <StressSection />}
        {activeTab === "body" && <BodyFeelingsSection />}
        {activeTab === "survey" && <WellnessSurveySection />}
        {activeTab === "sleep" && <SleepSection />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: Platform.OS === "ios" ? 60 : StatusBar.currentHeight ? StatusBar.currentHeight + 16 : 16,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { fontSize: 32, fontWeight: "700", color: "#fff" },
  sub: { color: "#7C8CA0", fontSize: 14, marginTop: 4 },
  tabBar: {
    flexDirection: "row",
    gap: 24,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: { paddingVertical: 12, position: "relative" },
  tabText: { fontSize: 14, fontWeight: "600", color: colors.textSecondary },
  tabTextActive: { color: colors.textPrimary },
  tabIndicator: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.accentPrimary,
    borderRadius: 999,
  },
  content: { flex: 1 },
});
