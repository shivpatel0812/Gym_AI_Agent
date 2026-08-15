import { useState, useEffect } from "react";
import {
  StyleSheet,
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  Platform,
  StatusBar,
} from "react-native";
import apiClient from "../../api/client";
import { Exercise, Split } from "./types";
import ExercisesSection from "./ExercisesSection";
import SplitsSection from "./SplitsSection";
import SessionsSection from "./SessionsSection";
import { colors, spacing } from "../../theme";

type TabType = "exercises" | "splits" | "sessions";

export default function Workouts() {
  const [activeTab, setActiveTab] = useState<TabType>("sessions");
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);

  useEffect(() => {
    fetchExercises();
    fetchSplits();
  }, []);

  const fetchExercises = async () => {
    try {
      const res = await apiClient.get("/api/exercises");
      setExercises(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error fetching exercises:", error);
      setExercises([]);
    }
  };

  const fetchSplits = async () => {
    try {
      const res = await apiClient.get("/api/splits");
      setSplits(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error fetching splits:", error);
      setSplits([]);
    }
  };

  const tabs: { id: TabType; label: string }[] = [
    { id: "sessions", label: "Sessions" },
    { id: "exercises", label: "Exercises" },
    { id: "splits", label: "Splits" },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Workouts</Text>
      </View>
      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={styles.tab}
              onPress={() => setActiveTab(tab.id)}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab.label}
              </Text>
              {isActive && <View style={styles.tabIndicator} />}
            </TouchableOpacity>
          );
        })}
      </View>
      {activeTab === "sessions" ? (
        <SessionsSection exercises={exercises} splits={splits} />
      ) : (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {activeTab === "exercises" && (
            <ExercisesSection onExercisesUpdate={fetchExercises} />
          )}
          {activeTab === "splits" && (
            <SplitsSection onSplitsUpdate={fetchSplits} />
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop:
      Platform.OS === "ios"
        ? 60
        : StatusBar.currentHeight
        ? StatusBar.currentHeight + 16
        : 16,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  tabBar: {
    flexDirection: "row",
    gap: 24,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 4,
  },
  tab: {
    paddingVertical: 12,
    position: "relative",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.textPrimary,
  },
  tabIndicator: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.accentPrimary,
    borderRadius: 999,
  },
  content: {
    flex: 1,
  },
});
