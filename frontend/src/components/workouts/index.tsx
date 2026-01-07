import { useState, useEffect } from "react";
import { StyleSheet, ScrollView, View, Text, TouchableOpacity, Platform, StatusBar } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import { Exercise, Split } from "./types";
import ExercisesSection from "./ExercisesSection";
import SplitsSection from "./SplitsSection";
import SessionsSection from "./SessionsSection";
import { colors, spacing, borderRadius } from "../../theme";

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
      setExercises([]); // Ensure it's always an array
    }
  };

  const fetchSplits = async () => {
    try {
      const res = await apiClient.get("/api/splits");
      setSplits(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error fetching splits:", error);
      setSplits([]); // Ensure it's always an array
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Workouts</Text>
      </View>
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "sessions" && styles.tabActive]}
          onPress={() => setActiveTab("sessions")}
        >
          <MaterialCommunityIcons
            name={activeTab === "sessions" ? "calendar" : "calendar-outline"}
            size={20}
            color={activeTab === "sessions" ? colors.accentPrimary : colors.textSecondary}
            style={styles.tabIcon}
          />
          <Text style={[styles.tabText, activeTab === "sessions" && styles.tabTextActive]}>
            Sessions
          </Text>
          {activeTab === "sessions" && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "exercises" && styles.tabActive]}
          onPress={() => setActiveTab("exercises")}
        >
          <MaterialCommunityIcons
            name={activeTab === "exercises" ? "dumbbell" : "dumbbell"}
            size={20}
            color={activeTab === "exercises" ? colors.accentPrimary : colors.textSecondary}
            style={styles.tabIcon}
          />
          <Text style={[styles.tabText, activeTab === "exercises" && styles.tabTextActive]}>
            Exercises
          </Text>
          {activeTab === "exercises" && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "splits" && styles.tabActive]}
          onPress={() => setActiveTab("splits")}
        >
          <MaterialCommunityIcons
            name={activeTab === "splits" ? "format-list-bulleted" : "format-list-bulleted"}
            size={20}
            color={activeTab === "splits" ? colors.accentPrimary : colors.textSecondary}
            style={styles.tabIcon}
          />
          <Text style={[styles.tabText, activeTab === "splits" && styles.tabTextActive]}>
            Splits
          </Text>
          {activeTab === "splits" && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {activeTab === "sessions" && <SessionsSection exercises={exercises} splits={splits} />}
        {activeTab === "exercises" && <ExercisesSection onExercisesUpdate={fetchExercises} />}
        {activeTab === "splits" && <SplitsSection onSplitsUpdate={fetchSplits} />}
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
