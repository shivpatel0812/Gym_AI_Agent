import { useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Exercise, Split, WorkoutSession } from "../types";
import defaultExercises, { categories, categoryToMuscleGroup } from "../../../data/defaultExercises";
import { colors, spacing, borderRadius } from "../../../theme";

interface SessionFormProps {
  exercises: Exercise[];
  splits: Split[];
  onSuccess: (session: WorkoutSession) => void;
  onCancel: () => void;
  initialSession?: WorkoutSession;
}

export default function SessionForm({
  exercises,
  splits,
  onSuccess,
  onCancel,
  initialSession,
}: SessionFormProps) {
  const [formData, setFormData] = useState<{
    date: string;
    workout_name: string;
    split_name: string;
    split_day: string;
    exercises: any[];
    notes: string;
  }>({
    date: initialSession?.date || new Date().toISOString().split("T")[0],
    workout_name: (initialSession as any)?.workout_name || initialSession?.split_name || "",
    split_name: initialSession?.split_name || "",
    split_day: (initialSession as any)?.split_day || "",
    exercises: initialSession?.exercises || [],
    notes: initialSession?.notes || "",
  });

  const [showSplitDropdown, setShowSplitDropdown] = useState(false);
  const [showDayDropdown, setShowDayDropdown] = useState(false);
  const [selectedSplitId, setSelectedSplitId] = useState<string>(() => {
    if (initialSession?.split_name) {
      const split = splits.find((s) => s.name === initialSession.split_name);
      return split?.id || "";
    }
    return "";
  });

  const selectedSplit = selectedSplitId ? splits.find((s) => s.id === selectedSplitId) : null;
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(null);
  const [exerciseTab, setExerciseTab] = useState<"browse" | "search">("browse");
  const [exerciseSearchQuery, setExerciseSearchQuery] = useState("");

  const allExercises = useMemo(() => {
    const defaultExercisesList = (defaultExercises || []).map((ex) => ({
      id: ex.id,
      name: ex.name,
      category: ex.category,
      equipment: ex.equipment,
      is_default: true,
    }));

    const customExercisesList = (exercises || [])
      .filter((ex) => ex.id)
      .map((ex) => {
        let category = null;
        if (ex.muscle_group) {
          const muscleGroup = ex.muscle_group.toLowerCase();
          for (const [cat, muscle] of Object.entries(categoryToMuscleGroup)) {
            if (muscleGroup.includes(muscle.toLowerCase())) {
              category = cat;
              break;
            }
          }
        }
        return {
          id: ex.id!,
          name: ex.name,
          category: category,
          equipment: null,
          is_default: false,
        };
      });

    return [...defaultExercisesList, ...customExercisesList];
  }, [exercises]);

  const handleExerciseChange = (exerciseId: string, exerciseName: string) => {
    setFormData({
      ...formData,
      exercises: [
        ...formData.exercises,
        {
          exercise_id: exerciseId,
          exercise_name: exerciseName,
          sets: [{ set_number: 1, reps: 0, weight: undefined }],
        },
      ],
    });
    setExerciseSearchQuery("");
    setSelectedCategory(null);
    setSelectedEquipment(null);
  };

  const handleSubmit = () => {
    const payload = {
      date: formData.date,
      workout_name: formData.workout_name || undefined,
      split_name: formData.split_name || undefined,
      split_day: formData.split_day || undefined,
      exercises: formData.exercises,
      notes: formData.notes || undefined,
    };
    onSuccess(payload as WorkoutSession);
  };

  const filteredExercises = useMemo(() => {
    if (exerciseTab === "browse") {
      if (!selectedCategory) return [];
      return allExercises.filter(
        (ex) =>
          ex.category === selectedCategory &&
          (!selectedEquipment || ex.equipment === selectedEquipment)
      );
    } else {
      if (!exerciseSearchQuery.trim()) return [];
      const query = exerciseSearchQuery.toLowerCase();
      return allExercises
        .filter((ex) => ex.name.toLowerCase().includes(query))
        .slice(0, 20);
    }
  }, [allExercises, selectedCategory, selectedEquipment, exerciseTab, exerciseSearchQuery]);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onCancel} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.title}>
          {initialSession ? "Edit Workout Session" : "Log Workout Session"}
        </Text>
      </View>

      {/* Form Fields */}
      <View style={styles.formSection}>
        {/* Workout Name */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Workout Name (Optional)</Text>
          <TextInput
            style={styles.input}
            value={formData.workout_name}
            onChangeText={(text) => setFormData({ ...formData, workout_name: text })}
            placeholder="e.g., Push Day, Leg Day, Full Body"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        {/* Date */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Date</Text>
          <TextInput
            style={styles.input}
            value={formData.date}
            onChangeText={(text) => setFormData({ ...formData, date: text })}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        {/* Split Dropdown */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>Split (Optional)</Text>
          <TouchableOpacity
            style={styles.dropdown}
            onPress={() => setShowSplitDropdown(!showSplitDropdown)}
          >
            <Text style={styles.dropdownText}>
              {selectedSplitId
                ? splits.find((s) => s.id === selectedSplitId)?.name || "No Split"
                : "No Split"}
            </Text>
            <MaterialCommunityIcons
              name={showSplitDropdown ? "chevron-up" : "chevron-down"}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
          {showSplitDropdown && (
            <View style={styles.dropdownMenu}>
              <TouchableOpacity
                style={[
                  styles.dropdownItem,
                  !selectedSplitId && styles.dropdownItemActive,
                ]}
                onPress={() => {
                  setSelectedSplitId("");
                  setFormData({ ...formData, split_name: "", split_day: "" });
                  setShowSplitDropdown(false);
                }}
              >
                <Text style={styles.dropdownItemText}>No Split</Text>
              </TouchableOpacity>
              {splits.map((split) => (
                <TouchableOpacity
                  key={split.id}
                  style={[
                    styles.dropdownItem,
                    selectedSplitId === split.id && styles.dropdownItemActive,
                  ]}
                  onPress={() => {
                    setSelectedSplitId(split.id || "");
                    setFormData({ ...formData, split_name: split.name, split_day: "" });
                    setShowSplitDropdown(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>{split.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Day Dropdown - Only show if a split is selected */}
        {selectedSplit && selectedSplit.days && selectedSplit.days.length > 0 && (
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Split Day (Optional)</Text>
            <TouchableOpacity
              style={styles.dropdown}
              onPress={() => setShowDayDropdown(!showDayDropdown)}
            >
              <Text style={styles.dropdownText}>
                {formData.split_day || "Select Day"}
              </Text>
              <MaterialCommunityIcons
                name={showDayDropdown ? "chevron-up" : "chevron-down"}
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
            {showDayDropdown && (
              <View style={styles.dropdownMenu}>
                <TouchableOpacity
                  style={[
                    styles.dropdownItem,
                    !formData.split_day && styles.dropdownItemActive,
                  ]}
                  onPress={() => {
                    setFormData({ ...formData, split_day: "" });
                    setShowDayDropdown(false);
                  }}
                >
                  <Text style={styles.dropdownItemText}>No Specific Day</Text>
                </TouchableOpacity>
                {selectedSplit.days.map((day, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.dropdownItem,
                      formData.split_day === day && styles.dropdownItemActive,
                    ]}
                    onPress={() => {
                      setFormData({ ...formData, split_day: day });
                      setShowDayDropdown(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{day}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Exercises Section */}
      <View style={styles.exercisesSection}>
        <Text style={styles.sectionTitle}>Exercises</Text>

        {/* Exercise Selection Box */}
        <View style={styles.exerciseSelectionBox}>
          <View style={styles.exerciseSelectionHeader}>
            <Text style={styles.exerciseSelectionTitle}>Select Exercise</Text>
          </View>

          {/* Tabs */}
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              style={[styles.tab, exerciseTab === "browse" && styles.tabActive]}
              onPress={() => setExerciseTab("browse")}
            >
              <Text
                style={[
                  styles.tabText,
                  exerciseTab === "browse" && styles.tabTextActive,
                ]}
              >
                Browse
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, exerciseTab === "search" && styles.tabActive]}
              onPress={() => setExerciseTab("search")}
            >
              <Text
                style={[
                  styles.tabText,
                  exerciseTab === "search" && styles.tabTextActive,
                ]}
              >
                Search
              </Text>
            </TouchableOpacity>
          </View>

          {exerciseTab === "browse" ? (
            !selectedCategory ? (
              <View>
                <Text style={styles.subsectionTitle}>Select Body Part</Text>
                <View style={styles.categoryGrid}>
                  {categories.map((category) => (
                    <TouchableOpacity
                      key={category}
                      style={styles.categoryButton}
                      onPress={() => setSelectedCategory(category)}
                    >
                      <Text style={styles.categoryButtonText}>
                        {">"} {category}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {!categories.includes("CARDIO") && (
                    <TouchableOpacity
                      style={styles.categoryButton}
                      onPress={() => setSelectedCategory("CARDIO")}
                    >
                      <Text style={styles.categoryButtonText}>
                        {">"} CARDIO
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ) : (
              <View>
                <View style={styles.categoryHeader}>
                  <Text style={styles.categoryTitle}>
                    {selectedCategory} Exercises
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedCategory(null);
                      setSelectedEquipment(null);
                    }}
                  >
                    <Text style={styles.changeCategoryText}>
                      Change Body Part
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.filterTitle}>Filter by Equipment</Text>
                <View style={styles.equipmentFilters}>
                  {["Barbell", "Dumbbell", "Cable", "Machine", "Bodyweight"].map(
                    (equip) => (
                      <TouchableOpacity
                        key={equip}
                        style={[
                          styles.equipmentFilter,
                          selectedEquipment === equip &&
                            styles.equipmentFilterActive,
                        ]}
                        onPress={() =>
                          setSelectedEquipment(
                            selectedEquipment === equip ? null : equip
                          )
                        }
                      >
                        <Text
                          style={[
                            styles.equipmentFilterText,
                            selectedEquipment === equip &&
                              styles.equipmentFilterTextActive,
                          ]}
                        >
                          {equip}
                        </Text>
                      </TouchableOpacity>
                    )
                  )}
                </View>

                <FlatList
                  data={filteredExercises}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.exerciseButton}
                      onPress={() => handleExerciseChange(item.id, item.name)}
                    >
                      <Text style={styles.exerciseButtonText}>{item.name}</Text>
                      {item.equipment && (
                        <View style={styles.equipmentBadge}>
                          <Text style={styles.equipmentBadgeText}>
                            {item.equipment}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  )}
                  scrollEnabled={false}
                />
              </View>
            )
          ) : (
            <View>
              <View style={styles.searchContainer}>
                <MaterialCommunityIcons
                  name="magnify"
                  size={20}
                  color={colors.textSecondary}
                />
                <TextInput
                  style={styles.searchInput}
                  value={exerciseSearchQuery}
                  onChangeText={setExerciseSearchQuery}
                  placeholder="Search for a workout..."
                  placeholderTextColor={colors.textSecondary}
                  autoFocus
                />
              </View>
              {exerciseSearchQuery && (
                <FlatList
                  data={filteredExercises}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.exerciseButton}
                      onPress={() => handleExerciseChange(item.id, item.name)}
                    >
                      <Text style={styles.exerciseButtonText}>{item.name}</Text>
                      <Text style={styles.exerciseCategoryText}>
                        {item.category}
                      </Text>
                    </TouchableOpacity>
                  )}
                  scrollEnabled={false}
                />
              )}
            </View>
          )}
        </View>

        {/* List of Added Exercises */}
        {formData.exercises.map((ex, idx) => {
          const exerciseSets = Array.isArray(ex.sets) ? ex.sets : [];
          return (
            <View key={idx} style={styles.exerciseCard}>
              <View style={styles.exerciseCardHeader}>
                <Text style={styles.exerciseCardTitle}>{ex.exercise_name}</Text>
                <TouchableOpacity
                  onPress={() =>
                    setFormData({
                      ...formData,
                      exercises: formData.exercises.filter((_, i) => i !== idx),
                    })
                  }
                >
                  <MaterialCommunityIcons
                    name="close"
                    size={24}
                    color={colors.danger}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.setsHeader}>
                <Text style={styles.setHeaderText}>Set</Text>
                <Text style={styles.setHeaderText}>Reps</Text>
                <Text style={styles.setHeaderText}>Weight (lbs)</Text>
              </View>

              <View style={styles.setsContainer}>
                {exerciseSets.map((set: any, setIdx: number) => (
                  <View key={setIdx} style={styles.setRow}>
                    <Text style={styles.setNumber}>{set.set_number}</Text>
                    <TextInput
                      style={styles.setInput}
                      value={set.reps === 0 ? "" : String(set.reps)}
                      onChangeText={(text) => {
                        const newExercises = [...formData.exercises];
                        const newSets = [...exerciseSets];
                        const value = text === "" ? 0 : parseInt(text) || 0;
                        newSets[setIdx] = { ...newSets[setIdx], reps: value };
                        newExercises[idx] = {
                          ...newExercises[idx],
                          sets: newSets,
                        };
                        setFormData({ ...formData, exercises: newExercises });
                      }}
                      placeholder="Reps"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="number-pad"
                    />
                    <TextInput
                      style={styles.setInput}
                      value={set.weight ? String(set.weight) : ""}
                      onChangeText={(text) => {
                        const newExercises = [...formData.exercises];
                        const newSets = [...exerciseSets];
                        newSets[setIdx] = {
                          ...newSets[setIdx],
                          weight: text ? parseFloat(text) : undefined,
                        };
                        newExercises[idx] = {
                          ...newExercises[idx],
                          sets: newSets,
                        };
                        setFormData({ ...formData, exercises: newExercises });
                      }}
                      placeholder="Weight"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="decimal-pad"
                    />
                  </View>
                ))}
              </View>

              <TouchableOpacity
                style={styles.addSetButton}
                onPress={() => {
                  const newExercises = [...formData.exercises];
                  const newSets = [...exerciseSets];
                  newSets.push({
                    set_number: exerciseSets.length + 1,
                    reps: 0,
                    weight: undefined,
                  });
                  newExercises[idx] = {
                    ...newExercises[idx],
                    sets: newSets,
                  };
                  setFormData({ ...formData, exercises: newExercises });
                }}
              >
                <MaterialCommunityIcons
                  name="plus"
                  size={20}
                  color={colors.background}
                />
                <Text style={styles.addSetButtonText}>Add Set</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        <TouchableOpacity
          style={styles.addExerciseButton}
          onPress={() => {
            // Scroll to top to show exercise selection
          }}
        >
          <MaterialCommunityIcons
            name="plus"
            size={20}
            color={colors.accentPrimary}
          />
          <Text style={styles.addExerciseButtonText}>Add Exercise</Text>
        </TouchableOpacity>
      </View>

      {/* Notes */}
      <View style={styles.inputContainer}>
        <Text style={styles.label}>Notes (Optional)</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          value={formData.notes}
          onChangeText={(text) => setFormData({ ...formData, notes: text })}
          placeholder="How did the workout feel?"
          placeholderTextColor={colors.textSecondary}
          multiline
          textAlignVertical="top"
        />
      </View>

      {/* Action Buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[
            styles.actionButton,
            styles.saveButton,
            formData.exercises.length === 0 && styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={formData.exercises.length === 0}
        >
          <Text style={styles.actionButtonText}>
            {initialSession ? "Update Workout" : "Save Workout"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.cancelButton]}
          onPress={onCancel}
        >
          <Text style={[styles.actionButtonText, styles.cancelButtonText]}>
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  backButton: {
    marginRight: spacing.md,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  formSection: {
    marginBottom: spacing.xl,
  },
  inputContainer: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: "#2d3b4e",
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 16,
    borderWidth: 0,
  },
  dropdown: {
    backgroundColor: "#2d3b4e",
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dropdownText: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  dropdownMenu: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    marginTop: spacing.xs,
    overflow: "hidden",
  },
  dropdownItem: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownItemActive: {
    backgroundColor: colors.accentPrimary + "20",
  },
  dropdownItemText: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  exercisesSection: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  exerciseSelectionBox: {
    backgroundColor: "#1a2332",
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: "#2d3b4e",
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  exerciseSelectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  exerciseSelectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  tabsContainer: {
    flexDirection: "row",
    backgroundColor: "#2d3b4e",
    borderRadius: borderRadius.lg,
    padding: spacing.xs,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: colors.textPrimary,
  },
  tabText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.background,
  },
  subsectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  categoryButton: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#2d3b4e",
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "transparent",
  },
  categoryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    fontStyle: "italic",
  },
  categoryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  categoryTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    fontStyle: "italic",
    textTransform: "uppercase",
  },
  changeCategoryText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.accentPrimary,
  },
  filterTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  equipmentFilters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  equipmentFilter: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.xl,
    backgroundColor: "#2d3b4e",
  },
  equipmentFilterActive: {
    backgroundColor: colors.accentPrimary,
  },
  equipmentFilterText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  equipmentFilterTextActive: {
    color: colors.textPrimary,
  },
  exerciseButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#2d3b4e",
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exerciseButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    flex: 1,
  },
  equipmentBadge: {
    backgroundColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: borderRadius.sm,
  },
  equipmentBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
  },
  exerciseCategoryText: {
    fontSize: 12,
    color: colors.textSecondary,
    textTransform: "uppercase",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2d3b4e",
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
    paddingVertical: spacing.md,
  },
  exerciseCard: {
    backgroundColor: "#1a2332",
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: "#2d3b4e",
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  exerciseCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  exerciseCardTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    fontStyle: "italic",
    textTransform: "uppercase",
    flex: 1,
  },
  setsHeader: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  setHeaderText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    fontStyle: "italic",
  },
  setsContainer: {
    marginBottom: spacing.lg,
  },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  setNumber: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textSecondary,
    fontStyle: "italic",
    width: 40,
  },
  setInput: {
    flex: 1,
    backgroundColor: "#2d3b4e",
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: 16,
  },
  addSetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.textPrimary,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  addSetButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.background,
  },
  addExerciseButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.textPrimary + "33",
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  addExerciseButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.accentPrimary,
  },
  notesInput: {
    height: 100,
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  actionButton: {
    flex: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: "center",
  },
  saveButton: {
    backgroundColor: colors.accentPrimary,
  },
  cancelButton: {
    backgroundColor: colors.textPrimary,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  cancelButtonText: {
    color: colors.background,
  },
});