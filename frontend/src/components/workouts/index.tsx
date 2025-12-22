import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import apiClient from "../../api/client";
import { Exercise, Split } from "./types";
import ExercisesSection from "./ExercisesSection";
import SplitsSection from "./SplitsSection";
import SessionsSection from "./SessionsSection";

export default function Workouts() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);

  useEffect(() => {
    fetchExercises();
    fetchSplits();
  }, []);

  const fetchExercises = async () => {
    try {
      const res = await apiClient.get("/api/exercises");
      setExercises(res.data);
    } catch (error) {
      console.error("Error fetching exercises:", error);
    }
  };

  const fetchSplits = async () => {
    try {
      const res = await apiClient.get("/api/splits");
      setSplits(res.data);
    } catch (error) {
      console.error("Error fetching splits:", error);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Workouts</Text>
      </View>
      <ExercisesSection onExercisesUpdate={fetchExercises} />
      <SplitsSection onSplitsUpdate={fetchSplits} />
      <SessionsSection exercises={exercises} splits={splits} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    padding: 20,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#111827",
  },
});
