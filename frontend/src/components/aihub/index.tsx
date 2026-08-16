import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, StatusBar } from "react-native";
import AIChat from "../AIChat";
import AIAnalysis from "../AIAnalysis";
import { colors, spacing } from "../../theme";

type TabType = "coach" | "analysis";

export default function AIHub() {
  const [activeTab, setActiveTab] = useState<TabType>("coach");

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.tabBar}>
        {(
          [
            { id: "coach", label: "Coach" },
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
      <View style={styles.content}>{activeTab === "coach" ? <AIChat /> : <AIAnalysis />}</View>
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
