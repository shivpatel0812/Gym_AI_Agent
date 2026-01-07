import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import Button from "../shared/Button";
import Input from "../shared/Input";
import Card from "../shared/Card";
import { colors, spacing, borderRadius } from "../../theme";

interface ExerciseFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ExerciseForm({ onSuccess, onCancel }: ExerciseFormProps) {
  const [newExercise, setNewExercise] = useState({
    name: "",
    type: "strength",
    muscle_group: "",
    is_custom: true,
  });

  const createExercise = async () => {
    try {
      await apiClient.post("/api/exercises", newExercise);
      setNewExercise({
        name: "",
        type: "strength",
        muscle_group: "",
        is_custom: true,
      });
      onSuccess();
    } catch (error) {
      console.error("Error creating exercise:", error);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="dumbbell" size={32} color={colors.accentPrimary} />
        <Text style={styles.title}>Create Exercise</Text>
      </View>

      <Card style={styles.card}>
        <Input
          label="Exercise Name"
          placeholder="e.g., Bench Press"
          value={newExercise.name}
          onChangeText={(text) => setNewExercise({ ...newExercise, name: text })}
          icon={<MaterialCommunityIcons name="dumbbell" size={20} color={colors.textSecondary} />}
        />

        <Text style={styles.label}>Type</Text>
        <View style={styles.typeContainer}>
          <TouchableOpacity
            style={[styles.typeButton, newExercise.type === "strength" && styles.typeButtonActive]}
            onPress={() => setNewExercise({ ...newExercise, type: "strength" })}
          >
            <MaterialCommunityIcons
              name={newExercise.type === "strength" ? "weight-lifter" : "weight-lifter"}
              size={20}
              color={newExercise.type === "strength" ? colors.textPrimary : colors.textSecondary}
            />
            <Text
              style={[
                styles.typeButtonText,
                newExercise.type === "strength" && styles.typeButtonTextActive,
              ]}
            >
              Strength
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeButton, newExercise.type === "cardio" && styles.typeButtonActive]}
            onPress={() => setNewExercise({ ...newExercise, type: "cardio" })}
          >
            <MaterialCommunityIcons
              name={newExercise.type === "cardio" ? "run-fast" : "run-fast"}
              size={20}
              color={newExercise.type === "cardio" ? colors.textPrimary : colors.textSecondary}
            />
            <Text
              style={[
                styles.typeButtonText,
                newExercise.type === "cardio" && styles.typeButtonTextActive,
              ]}
            >
              Cardio
            </Text>
          </TouchableOpacity>
        </View>

        <Input
          label="Muscle Group (Optional)"
          placeholder="e.g., Chest, Back, Legs"
          value={newExercise.muscle_group}
          onChangeText={(text) => setNewExercise({ ...newExercise, muscle_group: text })}
          icon={<MaterialCommunityIcons name="arm-flex" size={20} color={colors.textSecondary} />}
        />

        <View style={styles.buttonRow}>
          <Button title="Save" onPress={createExercise} variant="primary" style={styles.button} />
          <Button title="Cancel" onPress={onCancel} variant="secondary" style={styles.button} />
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  card: {
    margin: spacing.lg,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  typeContainer: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  typeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  typeButtonActive: {
    borderColor: colors.accentPrimary,
    backgroundColor: colors.accentPrimary + "20",
  },
  typeButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  typeButtonTextActive: {
    color: colors.accentPrimary,
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  button: {
    flex: 1,
  },
});
