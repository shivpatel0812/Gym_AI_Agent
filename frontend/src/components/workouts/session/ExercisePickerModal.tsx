import { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  FlatList,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Exercise } from "../types";
import defaultExercises from "../../../data/defaultExercises";
import { colors, spacing, borderRadius } from "../../../theme";

interface ExercisePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectExercise: (exerciseName: string) => void;
  userExercises: Exercise[];
}

const CATEGORIES = [
  "All",
  "CHEST",
  "SHOULDERS",
  "BICEPS",
  "TRICEPS",
  "BACK",
  "LEGS",
  "GLUTES",
  "CALVES",
  "CORE / ABS",
];

const EQUIPMENT_TYPES = [
  "All",
  "Barbell",
  "Dumbbell",
  "Cable",
  "Machine",
  "Bodyweight",
];

type TabType = "browse" | "search";

export default function ExercisePickerModal({
  visible,
  onClose,
  onSelectExercise,
  userExercises,
}: ExercisePickerModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("browse");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedEquipment, setSelectedEquipment] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  // Merge default exercises with user custom exercises
  const allExercises = useMemo(() => {
    const defaultExs = (defaultExercises || []).map((ex) => ({
      id: ex.id,
      name: ex.name,
      category: ex.category,
      equipment: ex.equipment,
      isDefault: true,
    }));

    // Safely handle undefined or null userExercises
    const userExs = (userExercises || []).map((ex) => ({
      id: ex.id || `user-${ex.name}`,
      name: ex.name,
      category: ex.muscle_group || "OTHER",
      equipment: ex.type || "Other",
      isDefault: false,
    }));

    return [...defaultExs, ...userExs];
  }, [userExercises]);

  // Filter exercises for Browse tab
  const browseFilteredExercises = useMemo(() => {
    return allExercises.filter((ex) => {
      const categoryMatch =
        selectedCategory === "All" || ex.category === selectedCategory;
      const equipmentMatch =
        selectedEquipment === "All" || ex.equipment === selectedEquipment;
      return categoryMatch && equipmentMatch;
    });
  }, [allExercises, selectedCategory, selectedEquipment]);

  // Filter exercises for Search tab
  const searchFilteredExercises = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return allExercises.filter((ex) => ex.name.toLowerCase().includes(query));
  }, [allExercises, searchQuery]);

  const handleSelectExercise = (exerciseName: string) => {
    onSelectExercise(exerciseName);
    onClose();
    // Reset filters
    setSearchQuery("");
    setSelectedCategory("All");
    setSelectedEquipment("All");
    setActiveTab("browse");
  };

  const renderExerciseItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.exerciseItem}
      onPress={() => handleSelectExercise(item.name)}
      activeOpacity={0.7}
    >
      <View style={styles.exerciseItemLeft}>
        <MaterialCommunityIcons
          name={item.isDefault ? "dumbbell" : "account"}
          size={20}
          color={item.isDefault ? colors.accentPrimary : colors.success}
        />
        <View style={styles.exerciseInfo}>
          <Text style={styles.exerciseName}>{item.name}</Text>
          <View style={styles.exerciseMeta}>
            <Text style={styles.exerciseMetaText}>{item.category}</Text>
            <Text style={styles.exerciseMetaSeparator}>•</Text>
            <Text style={styles.exerciseMetaText}>{item.equipment}</Text>
          </View>
        </View>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={colors.textSecondary}
      />
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.headerTitle}>Select Exercise</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons
                name="close"
                size={24}
                color={colors.textPrimary}
              />
            </TouchableOpacity>
          </View>

          {/* Tab Bar */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tab, activeTab === "browse" && styles.tabActive]}
              onPress={() => setActiveTab("browse")}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "browse" && styles.tabTextActive,
                ]}
              >
                Browse
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === "search" && styles.tabActive]}
              onPress={() => setActiveTab("search")}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "search" && styles.tabTextActive,
                ]}
              >
                Search
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Content */}
        <View style={styles.content}>
          {activeTab === "browse" ? (
            <>
              {/* Category Filter */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.categoryScroll}
                contentContainerStyle={styles.categoryScrollContent}
              >
                {CATEGORIES.map((category) => (
                  <TouchableOpacity
                    key={category}
                    style={[
                      styles.categoryChip,
                      selectedCategory === category &&
                        styles.categoryChipActive,
                    ]}
                    onPress={() => setSelectedCategory(category)}
                  >
                    <Text
                      style={[
                        styles.categoryChipText,
                        selectedCategory === category &&
                          styles.categoryChipTextActive,
                      ]}
                    >
                      {category}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Equipment Filter */}
              <View style={styles.pickerContainer}>
                <Text style={styles.pickerLabel}>Equipment</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={selectedEquipment}
                    onValueChange={setSelectedEquipment}
                    style={styles.picker}
                  >
                    {EQUIPMENT_TYPES.map((equipment) => (
                      <Picker.Item
                        key={equipment}
                        label={equipment}
                        value={equipment}
                      />
                    ))}
                  </Picker>
                </View>
              </View>

              {/* Exercise List */}
              <FlatList
                data={browseFilteredExercises}
                renderItem={renderExerciseItem}
                keyExtractor={(item) => item.id}
                style={styles.exerciseList}
                contentContainerStyle={styles.exerciseListContent}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <MaterialCommunityIcons
                      name="dumbbell"
                      size={64}
                      color={colors.textSecondary}
                    />
                    <Text style={styles.emptyText}>No exercises found</Text>
                    <Text style={styles.emptySubtext}>
                      Try adjusting your filters
                    </Text>
                  </View>
                }
              />
            </>
          ) : (
            <>
              {/* Search Input */}
              <View style={styles.searchContainer}>
                <MaterialCommunityIcons
                  name="magnify"
                  size={20}
                  color={colors.textSecondary}
                />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search exercises..."
                  placeholderTextColor={colors.textSecondary}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoFocus
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery("")}>
                    <MaterialCommunityIcons
                      name="close-circle"
                      size={20}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                )}
              </View>

              {/* Search Results */}
              <FlatList
                data={searchFilteredExercises}
                renderItem={renderExerciseItem}
                keyExtractor={(item) => item.id}
                style={styles.exerciseList}
                contentContainerStyle={styles.exerciseListContent}
                ListEmptyComponent={
                  searchQuery.trim() ? (
                    <View style={styles.emptyState}>
                      <MaterialCommunityIcons
                        name="text-search"
                        size={64}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.emptyText}>
                        No results for "{searchQuery}"
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.emptyState}>
                      <MaterialCommunityIcons
                        name="magnify"
                        size={64}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.emptyText}>
                        Search for an exercise
                      </Text>
                      <Text style={styles.emptySubtext}>
                        Type to find exercises by name
                      </Text>
                    </View>
                  )
                }
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.cardBackground,
    paddingTop: spacing["2xl"],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  closeButton: {
    padding: spacing.sm,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: colors.accentPrimary,
  },
  tabText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.accentPrimary,
  },
  content: {
    flex: 1,
  },
  categoryScroll: {
    maxHeight: 50,
    marginVertical: spacing.md,
  },
  categoryScrollContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  categoryChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipActive: {
    backgroundColor: colors.accentPrimary,
    borderColor: colors.accentPrimary,
  },
  categoryChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  categoryChipTextActive: {
    color: colors.textPrimary,
  },
  pickerContainer: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  pickerLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  pickerWrapper: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  picker: {
    color: colors.textPrimary,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardBackground,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: spacing.md,
  },
  exerciseList: {
    flex: 1,
  },
  exerciseListContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  exerciseItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
  },
  exerciseItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    flex: 1,
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  exerciseMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  exerciseMetaText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  exerciseMetaSeparator: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing["3xl"],
  },
  emptyText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: spacing.lg,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});
