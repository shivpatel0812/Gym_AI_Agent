import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, StatusBar } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import AIChat from "../AIChat";
import AIAnalysis from "../AIAnalysis";
import PlanTab from "../plan/PlanTab";
import { colors, spacing } from "../../theme";

type TabType = "coach" | "plan" | "analysis";
type ChatMode = "coach" | "plan" | "nutrition";

export default function AIHub() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const [activeTab, setActiveTab] = useState<TabType>("coach");
  // Lets the Plan tab hand a starter prompt to the Coach tab
  const [coachPrompt, setCoachPrompt] = useState<string | null>(null);
  const [coachMode, setCoachMode] = useState<ChatMode | null>(null);

  const askCoach = (prompt: string) => {
    setCoachPrompt(prompt);
    setActiveTab("coach");
  };

  useEffect(() => {
    const mode = route.params?.coachMode;
    const prompt = route.params?.prompt;
    if (mode === "plan" || mode === "nutrition") {
      setCoachMode(mode);
      setActiveTab("coach");
    }
    if (typeof prompt === "string" && prompt) {
      setCoachPrompt(prompt);
      setActiveTab("coach");
    }
    if (mode || prompt) {
      navigation.setParams({ coachMode: undefined, prompt: undefined });
    }
  }, [route.params, navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.tabBar}>
        {(
          [
            { id: "coach", label: "Coach" },
            { id: "plan", label: "Plan" },
            { id: "analysis", label: "Analysis" },
          ] as const
        ).map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity key={tab.id} style={styles.tab} onPress={() => setActiveTab(tab.id)}>
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
              {isActive ? <View style={styles.tabIndicator} /> : null}
            </TouchableOpacity>
          );
        })}
        </View>
      </View>
      <View style={styles.content}>
        {activeTab === "coach" ? (
          <AIChat
            initialPrompt={coachPrompt}
            onPromptConsumed={() => setCoachPrompt(null)}
            initialMode={coachMode}
            onModeConsumed={() => setCoachMode(null)}
          />
        ) : activeTab === "plan" ? (
          <PlanTab onAskCoach={askCoach} />
        ) : (
          <AIAnalysis />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: Platform.OS === "ios" ? 54 : StatusBar.currentHeight ? StatusBar.currentHeight + 8 : 8,
    backgroundColor: colors.background,
  },
  tabBar: {
    flexDirection: "row",
    gap: 24,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: { paddingVertical: 12, position: "relative" },
  tabText: { fontSize: 14, fontWeight: "600", color: colors.textSecondary },
  tabTextActive: { color: "#fff" },
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
