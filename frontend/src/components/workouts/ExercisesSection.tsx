import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  FlatList,
  TouchableOpacity,
} from "react-native";
import BlurView from "../shared/BlurView";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import { Exercise } from "./types";
import ExerciseForm from "./ExerciseForm";
import Button from "../shared/Button";
import Card from "../shared/Card";
import Input from "../shared/Input";
import { colors, spacing, borderRadius, shadows } from "../../theme";

interface ExercisesSectionProps {
  onExercisesUpdate: () => void;
}

export default function ExercisesSection({
  onExercisesUpdate,
}: ExercisesSectionProps) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showExerciseForm, setShowExerciseForm] = useState(false);

  useEffect(() => {
    fetchExercises();
  }, []);

  const fetchExercises = async () => {
    try {
      const res = await apiClient.get("/api/exercises");
      setExercises(res.data);
      onExercisesUpdate();
    } catch (error) {
      console.error("Error fetching exercises:", error);
    }
  };

  const filteredExercises = exercises.filter((ex) =>
    ex.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Exercises</Text>
        <Button
          title="Create"
          onPress={() => setShowExerciseForm(true)}
          variant="primary"
          style={styles.createButton}
        />
      </View>

      <Input
        placeholder="Search exercises..."
        value={searchQuery}
        onChangeText={setSearchQuery}
        icon={
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={colors.textSecondary}
          />
        }
        style={styles.searchInput}
      />

      <Modal visible={showExerciseForm} animationType="slide" transparent>
        <BlurView intensity={20} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ExerciseForm
              onSuccess={() => {
                setShowExerciseForm(false);
                fetchExercises();
              }}
              onCancel={() => setShowExerciseForm(false)}
            />
          </View>
        </BlurView>
      </Modal>

      <FlatList
        data={filteredExercises}
        keyExtractor={(item) => item.id || ""}
        numColumns={2}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <Card style={styles.exerciseCard}>
            <View style={styles.exerciseCardContent}>
              <View style={styles.exerciseIconContainer}>
                <MaterialCommunityIcons
                  name="dumbbell"
                  size={24}
                  color={colors.accentPrimary}
                />
              </View>
              <Text style={styles.exerciseName}>{item.name}</Text>
              <Text style={styles.exerciseType}>{item.type}</Text>
              {item.muscle_group && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.muscle_group}</Text>
                </View>
              )}
            </View>
          </Card>
        )}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  createButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  searchInput: {
    marginBottom: spacing.md,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  modalContent: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.xl,
    maxHeight: "90%",
    borderWidth: 1,
    borderColor: colors.border,
  },
  listContent: {
    gap: spacing.sm,
  },
  exerciseCard: {
    flex: 1,
    margin: spacing.xs,
    minHeight: 120,
  },
  exerciseCardContent: {
    alignItems: "center",
  },
  exerciseIconContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentPrimary + "20",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  exerciseName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  exerciseType: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  badge: {
    backgroundColor: colors.accentPrimary + "20",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    marginTop: spacing.xs,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.accentPrimary,
  },
});
