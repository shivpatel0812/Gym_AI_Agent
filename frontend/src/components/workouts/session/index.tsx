import { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Exercise, Split, WorkoutSession } from "../types";
import defaultExercises, { categories, categoryToMuscleGroup } from "../../../data/defaultExercises";
import { colors, spacing, borderRadius } from "../../../theme";
import apiClient from "../../../api/client";

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
  const [lastExerciseData, setLastExerciseData] = useState<Record<string, any>>({});
  const [maxExerciseData, setMaxExerciseData] = useState<Record<string, any>>({});
  const [aiRecommendations, setAiRecommendations] = useState<Record<string, any>>({});
  const [aiRecommendationLoading, setAiRecommendationLoading] = useState<Record<string, boolean>>({});
  const [aiSummaryStatus, setAiSummaryStatus] = useState<{
    hasSetup: boolean;
    needsSetup: boolean;
    isGenerating: boolean;
  }>({ hasSetup: false, needsSetup: false, isGenerating: false });

  // Check AI summary status on mount
  useEffect(() => {
    checkAiSummaryStatus();
  }, []);

  // Check AI recommendation status and auto-trigger if needed
  const checkAiSummaryStatus = async () => {
    try {
      const response = await apiClient.get("/api/workout-sessions/ai-recommendation-check");
      const data = response.data;
      
      setAiSummaryStatus({
        hasSetup: data.has_summary || false,
        needsSetup: data.needs_initial_setup || false,
        isGenerating: false,
      });
      
      // Auto-trigger first-time setup if ready
      if (data.needs_initial_setup && !data.has_summary) {
        generateAiSummary();
      }
    } catch (error) {
      console.log("AI recommendations not available:", error);
    }
  };

  // Generate AI summary (first-time setup or manual refresh)
  const generateAiSummary = async () => {
    setAiSummaryStatus(prev => ({ ...prev, isGenerating: true }));
    try {
      await apiClient.get("/api/workout-sessions/ai-summary");
      setAiSummaryStatus(prev => ({ 
        ...prev, 
        hasSetup: true, 
        needsSetup: false, 
        isGenerating: false 
      }));
    } catch (error) {
      console.error("Error generating AI summary:", error);
      setAiSummaryStatus(prev => ({ ...prev, isGenerating: false }));
    }
  };

  // Fetch AI recommendation for an exercise
  const fetchAiRecommendation = async (
    exerciseId: string, 
    exerciseName: string, 
    positionInWorkout: number
  ) => {
    // Don't fetch if AI isn't set up
    if (!aiSummaryStatus.hasSetup && !aiSummaryStatus.needsSetup) {
      return;
    }
    
    setAiRecommendationLoading(prev => ({ ...prev, [exerciseId]: true }));
    
    try {
      const response = await apiClient.post(`/api/workout-sessions/ai-recommendation/${exerciseId}`, {
        exercise_name: exerciseName,
        split_name: formData.split_name || undefined,
        split_day: formData.split_day || undefined,
        position_in_workout: positionInWorkout
      });
      
      if (response.data && response.data.status === "success") {
        setAiRecommendations(prev => ({
          ...prev,
          [exerciseId]: response.data.recommendation
        }));
      }
    } catch (error) {
      console.log("No AI recommendation available for this exercise");
    } finally {
      setAiRecommendationLoading(prev => ({ ...prev, [exerciseId]: false }));
    }
  };

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

  const formatLastTime = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);
    
    const diffTime = today.getTime() - compareDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
  };

  const handleExerciseChange = async (exerciseId: string, exerciseName: string) => {
    const selectedExercise = allExercises.find((ex) => ex.id === exerciseId);
    const isCardio = selectedExercise?.category === "CARDIO";
    const positionInWorkout = formData.exercises.length; // Position is the current length (0-indexed)
    
    // Fetch last time this exercise was done
    try {
      const response = await apiClient.get(`/api/workout-sessions/last-exercise/${exerciseId}`);
      if (response.data) {
        setLastExerciseData(prev => ({
          ...prev,
          [exerciseId]: response.data
        }));
      }
    } catch (error) {
      // Silently fail if no previous data exists
      console.log("No previous exercise data found");
    }
    
    // Fetch all-time max for this exercise
    try {
      const maxResponse = await apiClient.get(`/api/workout-sessions/max-exercise/${exerciseId}`);
      if (maxResponse.data) {
        setMaxExerciseData(prev => ({
          ...prev,
          [exerciseId]: maxResponse.data
        }));
      }
    } catch (error) {
      // Silently fail if no max data exists
      console.log("No max exercise data found");
    }
    
    // Fetch AI recommendation for this exercise
    fetchAiRecommendation(exerciseId, exerciseName, positionInWorkout);
    
    setFormData({
      ...formData,
      exercises: [
        ...formData.exercises,
        isCardio
          ? {
              exercise_id: exerciseId,
              exercise_name: exerciseName,
              time: undefined,
              speed: undefined,
            }
          : {
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
          const isCardio = ex.hasOwnProperty("time") || ex.hasOwnProperty("speed");
          
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

              {/* Last Time Info */}
              {lastExerciseData[ex.exercise_id] && (
                <View style={styles.lastTimeContainer}>
                  <View style={styles.lastTimeHeader}>
                    <MaterialCommunityIcons
                      name="clock-outline"
                      size={16}
                      color={colors.accentPrimary}
                    />
                    <Text style={styles.lastTimeLabel}>
                      Last time: {formatLastTime(lastExerciseData[ex.exercise_id].date)}
                    </Text>
                  </View>
                  {lastExerciseData[ex.exercise_id].exercise_data && (
                    <View style={styles.lastTimeDetails}>
                      {lastExerciseData[ex.exercise_id].exercise_data.time !== undefined ? (
                        <Text style={styles.lastTimeText}>
                          Time: {lastExerciseData[ex.exercise_id].exercise_data.time} min
                          {lastExerciseData[ex.exercise_id].exercise_data.speed && 
                            ` | Speed: ${lastExerciseData[ex.exercise_id].exercise_data.speed} mph`}
                        </Text>
                      ) : lastExerciseData[ex.exercise_id].exercise_data.sets && Array.isArray(lastExerciseData[ex.exercise_id].exercise_data.sets) ? (
                        <View>
                          <Text style={styles.lastTimeText}>
                            {lastExerciseData[ex.exercise_id].exercise_data.sets.length} set{lastExerciseData[ex.exercise_id].exercise_data.sets.length > 1 ? 's' : ''}
                          </Text>
                          {lastExerciseData[ex.exercise_id].exercise_data.sets.slice(0, 3).map((set: any, setIdx: number) => (
                            <Text key={setIdx} style={styles.lastTimeSetText}>
                              Set {set.set_number}: {set.reps} reps
                              {set.weight && ` @ ${set.weight} lbs`}
                            </Text>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.lastTimeText}>
                          {lastExerciseData[ex.exercise_id].exercise_data.sets} sets x {lastExerciseData[ex.exercise_id].exercise_data.reps} reps
                          {lastExerciseData[ex.exercise_id].exercise_data.weight && 
                            ` @ ${lastExerciseData[ex.exercise_id].exercise_data.weight} lbs`}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              )}

              {/* AI Recommendation */}
              {aiRecommendationLoading[ex.exercise_id] ? (
                <View style={styles.aiRecommendationContainer}>
                  <View style={styles.aiRecommendationHeader}>
                    <ActivityIndicator size="small" color="#10B981" />
                    <Text style={styles.aiRecommendationLabel}>
                      Getting AI recommendation...
                    </Text>
                  </View>
                </View>
              ) : aiRecommendations[ex.exercise_id] && (
                <View style={styles.aiRecommendationContainer}>
                  <View style={styles.aiRecommendationHeader}>
                    <MaterialCommunityIcons
                      name="lightbulb-on"
                      size={16}
                      color="#10B981"
                    />
                    <Text style={styles.aiRecommendationLabel}>
                      AI Recommendation
                    </Text>
                    {aiRecommendations[ex.exercise_id].confidence && (
                      <View style={[
                        styles.confidenceBadge,
                        { backgroundColor: aiRecommendations[ex.exercise_id].confidence === 'high' 
                          ? 'rgba(16, 185, 129, 0.2)' 
                          : aiRecommendations[ex.exercise_id].confidence === 'medium'
                          ? 'rgba(245, 158, 11, 0.2)'
                          : 'rgba(107, 114, 128, 0.2)' 
                        }
                      ]}>
                        <Text style={[
                          styles.confidenceText,
                          { color: aiRecommendations[ex.exercise_id].confidence === 'high' 
                            ? '#10B981' 
                            : aiRecommendations[ex.exercise_id].confidence === 'medium'
                            ? '#F59E0B'
                            : '#6B7280' 
                          }
                        ]}>
                          {aiRecommendations[ex.exercise_id].confidence}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.aiRecommendationDetails}>
                    {/* Cardio recommendation */}
                    {aiRecommendations[ex.exercise_id].time !== undefined ? (
                      <Text style={styles.aiRecommendationText}>
                        Target: {aiRecommendations[ex.exercise_id].time} min
                        {aiRecommendations[ex.exercise_id].speed && 
                          ` @ ${aiRecommendations[ex.exercise_id].speed} mph`}
                      </Text>
                    ) : aiRecommendations[ex.exercise_id].sets && Array.isArray(aiRecommendations[ex.exercise_id].sets) ? (
                      /* Strength recommendation with sets array */
                      <View>
                        <Text style={styles.aiRecommendationText}>
                          Target: {aiRecommendations[ex.exercise_id].sets.length} set{aiRecommendations[ex.exercise_id].sets.length > 1 ? 's' : ''}
                        </Text>
                        {aiRecommendations[ex.exercise_id].sets.map((set: any, setIdx: number) => (
                          <Text key={setIdx} style={styles.aiRecommendationSetText}>
                            Set {set.set_number || setIdx + 1}: {set.reps} reps
                            {set.weight && ` @ ${set.weight} lbs`}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    
                    {/* Progression type badge */}
                    {aiRecommendations[ex.exercise_id].progression_type && (
                      <View style={[
                        styles.progressionBadge,
                        { backgroundColor: aiRecommendations[ex.exercise_id].progression_type === 'increase_weight'
                          ? 'rgba(34, 197, 94, 0.2)'
                          : aiRecommendations[ex.exercise_id].progression_type === 'increase_reps'
                          ? 'rgba(255, 107, 53, 0.2)'
                          : aiRecommendations[ex.exercise_id].progression_type === 'deload'
                          ? 'rgba(245, 158, 11, 0.2)'
                          : 'rgba(107, 114, 128, 0.2)'
                        }
                      ]}>
                        <Text style={[
                          styles.progressionText,
                          { color: aiRecommendations[ex.exercise_id].progression_type === 'increase_weight'
                            ? '#22C55E'
                            : aiRecommendations[ex.exercise_id].progression_type === 'increase_reps'
                            ? '#FF6B35'
                            : aiRecommendations[ex.exercise_id].progression_type === 'deload'
                            ? '#F59E0B'
                            : '#6B7280'
                          }
                        ]}>
                          {aiRecommendations[ex.exercise_id].progression_type.replace('_', ' ')}
                        </Text>
                      </View>
                    )}
                    
                    {/* Reasoning */}
                    {aiRecommendations[ex.exercise_id].reasoning && (
                      <Text style={styles.aiReasoningText}>
                        {aiRecommendations[ex.exercise_id].reasoning}
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {/* All-Time Max Info */}
              {maxExerciseData[ex.exercise_id] && (
                <View style={styles.maxContainer}>
                  <View style={styles.maxHeader}>
                    <MaterialCommunityIcons
                      name="trophy"
                      size={16}
                      color={colors.warning}
                    />
                    <Text style={styles.maxLabel}>
                      All-Time Max
                    </Text>
                  </View>
                  {maxExerciseData[ex.exercise_id] && (
                    <View style={styles.maxDetails}>
                      {(maxExerciseData[ex.exercise_id].max_time != null || maxExerciseData[ex.exercise_id].max_speed != null) ? (
                        <View>
                          {maxExerciseData[ex.exercise_id].max_time != null && (
                            <Text style={styles.maxText}>
                              Best Time: {maxExerciseData[ex.exercise_id].max_time} min
                            </Text>
                          )}
                          {maxExerciseData[ex.exercise_id].max_speed != null && (
                            <Text style={styles.maxText}>
                              Best Speed: {maxExerciseData[ex.exercise_id].max_speed} mph
                            </Text>
                          )}
                        </View>
                      ) : (
                        <View>
                          {/* Primary: Max Weight - Most Prominent */}
                          {maxExerciseData[ex.exercise_id].max_weight != null && (
                            <View style={{ marginBottom: spacing.xs }}>
                              <Text style={styles.maxWeightPrimary}>
                                Personal Best: {maxExerciseData[ex.exercise_id].max_weight} lbs
                              </Text>
                              {/* Calculate estimated 1RM if we have max weight and reps */}
                              {maxExerciseData[ex.exercise_id].max_weight != null && maxExerciseData[ex.exercise_id].max_reps != null && maxExerciseData[ex.exercise_id].max_reps > 0 && (
                                <Text style={styles.maxText}>
                                  Est. 1RM: {Math.round(maxExerciseData[ex.exercise_id].max_weight * (1 + maxExerciseData[ex.exercise_id].max_reps / 30))} lbs
                                </Text>
                              )}
                            </View>
                          )}
                          
                          {/* Heaviest Sets - Weight-focused */}
                          {maxExerciseData[ex.exercise_id].max_per_set && Object.keys(maxExerciseData[ex.exercise_id].max_per_set).length > 0 && (
                            <View style={styles.maxPerSetContainer}>
                              <Text style={styles.maxPerSetTitle}>Heaviest Sets:</Text>
                              {Object.entries(maxExerciseData[ex.exercise_id].max_per_set)
                                .sort(([a, aData], [b, bData]) => {
                                  // Sort by weight (descending), then by set number
                                  const weightA = (aData as any).weight || 0;
                                  const weightB = (bData as any).weight || 0;
                                  if (weightB !== weightA) return weightB - weightA;
                                  return parseInt(a) - parseInt(b);
                                })
                                .map(([setNum, setData]: [string, any]) => (
                                  <Text key={setNum} style={styles.maxPerSetText}>
                                    Set {setNum}: {setData.weight != null ? `${setData.weight} lbs` : ''}
                                    {setData.reps != null && setData.reps > 0 && ` × ${setData.reps} reps`}
                                  </Text>
                                ))}
                            </View>
                          )}
                          
                          {/* Secondary metrics - smaller, less prominent */}
                          {maxExerciseData[ex.exercise_id].max_volume != null && (
                            <View style={[styles.maxPerSetContainer, { marginTop: spacing.xs }]}>
                              <Text style={[styles.maxText, { opacity: 0.7 }]}>
                                Max Volume: {Math.round(maxExerciseData[ex.exercise_id].max_volume)} lbs
                              </Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}

              {isCardio ? (
                <View style={styles.cardioContainer}>
                  <View style={styles.inputRow}>
                    <Text style={styles.cardioLabel}>Time (minutes)</Text>
                    <TextInput
                      style={styles.cardioInput}
                      value={ex.time ? String(ex.time) : ""}
                      onChangeText={(text) => {
                        const newExercises = [...formData.exercises];
                        newExercises[idx] = {
                          ...newExercises[idx],
                          time: text ? parseFloat(text) : undefined,
                        };
                        setFormData({ ...formData, exercises: newExercises });
                      }}
                      placeholder="Time"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={styles.inputRow}>
                    <Text style={styles.cardioLabel}>Speed (mph)</Text>
                    <TextInput
                      style={styles.cardioInput}
                      value={ex.speed ? String(ex.speed) : ""}
                      onChangeText={(text) => {
                        const newExercises = [...formData.exercises];
                        newExercises[idx] = {
                          ...newExercises[idx],
                          speed: text ? parseFloat(text) : undefined,
                        };
                        setFormData({ ...formData, exercises: newExercises });
                      }}
                      placeholder="Speed"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
              ) : (
                <>
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
                </>
              )}
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
  lastTimeContainer: {
    backgroundColor: "#252f3f",
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.accentPrimary,
  },
  lastTimeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  lastTimeLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accentPrimary,
  },
  lastTimeDetails: {
    marginTop: spacing.xs,
  },
  lastTimeText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.xs / 2,
  },
  lastTimeSetText: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: spacing.xs / 2,
    marginLeft: spacing.sm,
  },
  aiRecommendationContainer: {
    backgroundColor: "#1a2a1f",
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: "#10B981",
  },
  aiRecommendationHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  aiRecommendationLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#10B981",
  },
  aiRecommendationDetails: {
    marginTop: spacing.xs,
  },
  aiRecommendationText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.xs / 2,
    fontWeight: "600",
  },
  aiRecommendationSetText: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: spacing.xs / 2,
    marginLeft: spacing.sm,
  },
  aiReasoningText: {
    fontSize: 11,
    color: "#6B7280",
    marginTop: spacing.sm,
    fontStyle: "italic",
  },
  confidenceBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: "auto",
  },
  confidenceText: {
    fontSize: 10,
    fontWeight: "600",
  },
  progressionBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 12,
    marginTop: spacing.sm,
    alignSelf: "flex-start",
  },
  progressionText: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  maxContainer: {
    backgroundColor: "#2a1f1a",
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  maxHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  maxLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.warning,
  },
  maxDetails: {
    marginTop: spacing.xs,
  },
  maxText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.xs / 2,
  },
  maxWeightPrimary: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.text,
    marginBottom: spacing.xs / 2,
  },
  maxPerSetContainer: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  maxPerSetTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.warning,
    marginBottom: spacing.xs / 2,
  },
  maxPerSetText: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: spacing.xs / 2,
    marginLeft: spacing.sm,
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
  cardioContainer: {
    marginBottom: spacing.lg,
  },
  inputRow: {
    marginBottom: spacing.md,
  },
  cardioLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    fontStyle: "italic",
    marginBottom: spacing.sm,
  },
  cardioInput: {
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