import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, borderRadius } from "../../theme";
import { categories } from "../../data/defaultExercises";

export type PickerExercise = {
  id: string;
  name: string;
  category: string | null;
  equipment: string | null;
  is_default: boolean;
};

type Props = {
  allExercises: PickerExercise[];
  pickerMode: "browse" | "search";
  selectedBodyPart: string | null;
  equipmentFilter: string | null;
  searchQuery: string;
  onModeChange: (mode: "browse" | "search") => void;
  onBodyPartChange: (part: string | null) => void;
  onEquipmentFilterChange: (eq: string | null) => void;
  onSearchChange: (q: string) => void;
  onSelect: (id: string, name: string) => void;
  onClose: () => void;
};

export default function ExercisePicker({
  allExercises,
  pickerMode,
  selectedBodyPart,
  equipmentFilter,
  searchQuery,
  onModeChange,
  onBodyPartChange,
  onEquipmentFilterChange,
  onSearchChange,
  onSelect,
  onClose,
}: Props) {
  const equipmentTypes = selectedBodyPart
    ? ([
        ...new Set(
          allExercises
            .filter((ex) => ex.category === selectedBodyPart)
            .map((ex) => ex.equipment)
            .filter(Boolean)
        ),
      ] as string[])
    : [];

  const bodyPartExercises = allExercises.filter((ex) => {
    if (ex.category !== selectedBodyPart) return false;
    if (equipmentFilter && ex.equipment !== equipmentFilter) return false;
    return true;
  });

  const searchResults = allExercises.filter((ex) =>
    ex.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {selectedBodyPart && pickerMode === "browse" ? (
            <TouchableOpacity
              onPress={() => {
                onBodyPartChange(null);
                onEquipmentFilterChange(null);
              }}
              style={styles.iconBtn}
            >
              <MaterialCommunityIcons
                name="arrow-left"
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          ) : null}
          <Text style={styles.title}>Select Exercise</Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.iconBtn}>
          <MaterialCommunityIcons
            name="close"
            size={20}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity
          onPress={() => {
            onModeChange("browse");
            onSearchChange("");
          }}
          style={[styles.tab, pickerMode === "browse" && styles.tabActive]}
        >
          <Text
            style={[
              styles.tabText,
              pickerMode === "browse" && styles.tabTextActive,
            ]}
          >
            Browse
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            onModeChange("search");
            onBodyPartChange(null);
            onEquipmentFilterChange(null);
          }}
          style={[styles.tab, pickerMode === "search" && styles.tabActive]}
        >
          <Text
            style={[
              styles.tabText,
              pickerMode === "search" && styles.tabTextActive,
            ]}
          >
            Search
          </Text>
        </TouchableOpacity>
      </View>

      {pickerMode === "browse" ? (
        selectedBodyPart ? (
          <View style={styles.body}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionLabel}>
                {selectedBodyPart} Exercises
              </Text>
              <TouchableOpacity
                onPress={() => {
                  onBodyPartChange(null);
                  onEquipmentFilterChange(null);
                }}
              >
                <Text style={styles.changeLink}>Change Body Part</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.eqRow}
            >
              {equipmentTypes.map((eq) => (
                <TouchableOpacity
                  key={eq}
                  onPress={() =>
                    onEquipmentFilterChange(equipmentFilter === eq ? null : eq)
                  }
                  style={[
                    styles.eqPill,
                    equipmentFilter === eq && styles.eqPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.eqPillText,
                      equipmentFilter === eq && styles.eqPillTextActive,
                    ]}
                  >
                    {eq}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {bodyPartExercises.map((ex) => (
              <TouchableOpacity
                key={ex.id}
                onPress={() => onSelect(ex.id, ex.name)}
                style={styles.exRow}
              >
                <Text style={styles.exName}>{ex.name}</Text>
                {ex.equipment ? (
                  <Text style={styles.exEq}>{ex.equipment.toUpperCase()}</Text>
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.body}>
            <Text style={styles.sectionLabel}>Select Body Part</Text>
            <View style={styles.grid}>
              {categories.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  onPress={() => onBodyPartChange(cat)}
                  style={styles.catBtn}
                >
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={18}
                    color={colors.textMuted}
                  />
                  <Text style={styles.catText}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )
      ) : (
        <View style={styles.body}>
          <View style={styles.searchWrap}>
            <MaterialCommunityIcons
              name="magnify"
              size={18}
              color={colors.textSecondary}
              style={styles.searchIcon}
            />
            <TextInput
              value={searchQuery}
              onChangeText={onSearchChange}
              placeholder="Search all exercises..."
              placeholderTextColor={colors.textMuted}
              autoFocus
              style={styles.searchInput}
            />
          </View>
          {searchQuery.trim()
            ? searchResults.map((ex) => (
                <TouchableOpacity
                  key={ex.id}
                  onPress={() => onSelect(ex.id, ex.name)}
                  style={styles.exRow}
                >
                  <Text style={styles.exName}>{ex.name}</Text>
                  {ex.equipment ? (
                    <Text style={styles.exEq}>{ex.equipment.toUpperCase()}</Text>
                  ) : null}
                </TouchableOpacity>
              ))
            : null}
          {searchQuery.trim() && searchResults.length === 0 ? (
            <Text style={styles.empty}>No exercises match your search.</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: { padding: 4 },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  tabs: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: borderRadius.sm,
    alignItems: "center",
  },
  tabActive: { backgroundColor: colors.accentPrimary },
  tabText: { color: colors.textSecondary, fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: "#fff" },
  body: { padding: spacing.lg },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: colors.textSecondary,
    textTransform: "uppercase",
    marginBottom: spacing.md,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  changeLink: { color: colors.ai, fontSize: 12, fontWeight: "600" },
  eqRow: { marginBottom: spacing.md, flexGrow: 0 },
  eqPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  eqPillActive: {
    borderColor: colors.accentPrimary,
    backgroundColor: "rgba(255,107,53,0.1)",
  },
  eqPillText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  eqPillTextActive: { color: colors.accentPrimary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catBtn: {
    width: "48%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "rgba(11,12,16,0.6)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  catText: { color: "#fff", fontSize: 13, fontWeight: "600", flex: 1 },
  exRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  exName: { color: "#fff", fontSize: 14, fontWeight: "600", flex: 1 },
  exEq: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    marginLeft: 8,
  },
  searchWrap: {
    position: "relative",
    marginBottom: spacing.md,
    justifyContent: "center",
  },
  searchIcon: { position: "absolute", left: 14, zIndex: 1 },
  searchInput: {
    height: 44,
    paddingLeft: 40,
    paddingRight: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: "#fff",
  },
  empty: {
    color: colors.textSecondary,
    textAlign: "center",
    paddingVertical: 24,
    fontSize: 14,
  },
});
