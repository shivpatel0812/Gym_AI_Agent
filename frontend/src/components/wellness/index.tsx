import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, StatusBar } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import StressSection from "./StressSection";
import BodyFeelingsSection from "./BodyFeelingsSection";
import WellnessSurveySection from "./WellnessSurveySection";
import SleepSection from "./SleepSection";
import { colors, spacing, borderRadius } from "../../theme";

type TabType = "stress" | "body" | "survey" | "sleep";

export default function Wellness() {
  const [activeTab, setActiveTab] = useState<TabType>("stress");

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Wellness</Text>
      </View>
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "stress" && styles.tabActive]}
          onPress={() => setActiveTab("stress")}
        >
          <MaterialCommunityIcons
            name={activeTab === "stress" ? "brain" : "brain-outline"}
            size={20}
            color={activeTab === "stress" ? colors.accentPrimary : colors.textSecondary}
            style={styles.tabIcon}
          />
          <Text style={[styles.tabText, activeTab === "stress" && styles.tabTextActive]}>
            Stress
          </Text>
          {activeTab === "stress" && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "body" && styles.tabActive]}
          onPress={() => setActiveTab("body")}
        >
          <MaterialCommunityIcons
            name={activeTab === "body" ? "body" : "body-outline"}
            size={20}
            color={activeTab === "body" ? colors.accentPrimary : colors.textSecondary}
            style={styles.tabIcon}
          />
          <Text style={[styles.tabText, activeTab === "body" && styles.tabTextActive]}>
            Body
          </Text>
          {activeTab === "body" && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "survey" && styles.tabActive]}
          onPress={() => setActiveTab("survey")}
        >
          <MaterialCommunityIcons
            name={activeTab === "survey" ? "clipboard-text" : "clipboard-text-outline"}
            size={20}
            color={activeTab === "survey" ? colors.accentPrimary : colors.textSecondary}
            style={styles.tabIcon}
          />
          <Text style={[styles.tabText, activeTab === "survey" && styles.tabTextActive]}>
            Survey
          </Text>
          {activeTab === "survey" && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "sleep" && styles.tabActive]}
          onPress={() => setActiveTab("sleep")}
        >
          <MaterialCommunityIcons
            name={activeTab === "sleep" ? "bedtime" : "bedtime-outline"}
            size={20}
            color={activeTab === "sleep" ? colors.accentPrimary : colors.textSecondary}
            style={styles.tabIcon}
          />
          <Text style={[styles.tabText, activeTab === "sleep" && styles.tabTextActive]}>
            Sleep
          </Text>
          {activeTab === "sleep" && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === "stress" && <StressSection />}
        {activeTab === "body" && <BodyFeelingsSection />}
        {activeTab === "survey" && <WellnessSurveySection />}
        {activeTab === "sleep" && <SleepSection />}
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    position: "relative",
  },
  tabActive: {
    backgroundColor: colors.cardBackground,
  },
  tabIcon: {
    marginBottom: spacing.xs,
  },
  tabText: {
    fontSize: 12,
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
