import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from "react-native";
import {
  BAND_ADD_OPTIONS,
  BlueprintExtra,
  DayBand,
  MealSlot,
  slotLabel,
} from "../../../api/nutritionPlan";
import { defaultMacrosForAdd, slotForBandAdd } from "../../../lib/dayMap";
import { colors, spacing, borderRadius } from "../../../theme";

export type BlueprintPersistence = "anchor" | "flexible" | "one_time";

export interface BlueprintAddResult {
  persistence: BlueprintPersistence;
  band: DayBand;
  slot: MealSlot;
  label: string;
  notes?: string;
  calories?: number;
  protein?: number;
  calorie_min?: number;
  calorie_max?: number;
  protein_min?: number;
  protein_max?: number;
  foods?: { name: string }[];
  id?: string;
}

interface Props {
  visible: boolean;
  band: DayBand | null;
  editing?: BlueprintExtra | null;
  onClose: () => void;
  onSave: (result: BlueprintAddResult) => void;
  onDelete?: () => void;
}

export default function AddBlueprintModal({
  visible,
  band,
  editing,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const activeBand = (editing?.band as DayBand) || band;
  const isEdit = !!editing;

  const [mealSlot, setMealSlot] = useState<MealSlot>("snack");
  const [persistence, setPersistence] = useState<BlueprintPersistence>("one_time");
  const [label, setLabel] = useState("Snack");
  const [foodsText, setFoodsText] = useState("");
  const [notes, setNotes] = useState("");
  const [calories, setCalories] = useState("180");
  const [protein, setProtein] = useState("12");

  useEffect(() => {
    if (!visible) return;
    if (editing) {
      setMealSlot((editing.slot as MealSlot) || "snack");
      setPersistence("one_time");
      setLabel(editing.label || "");
      setFoodsText((editing.foods || []).map((f) => f.name).filter(Boolean).join(", "));
      setNotes(editing.notes || "");
      setCalories(String(editing.calories ?? ""));
      setProtein(String(editing.protein ?? ""));
      return;
    }
    if (!band) return;
    const opt = BAND_ADD_OPTIONS[0];
    setMealSlot(opt.id);
    setPersistence("one_time");
    setLabel(opt.defaultLabel);
    setFoodsText("");
    setNotes("");
    const macros = defaultMacrosForAdd(opt.id);
    setCalories(String(macros.calories ?? ""));
    setProtein(String(macros.protein ?? ""));
  }, [visible, band, editing]);

  const pickMeal = (slot: MealSlot, defaultLabel: string) => {
    setMealSlot(slot);
    if (!isEdit) setLabel(defaultLabel);
    const macros = defaultMacrosForAdd(slot);
    setCalories(String(macros.calories ?? ""));
    setProtein(String(macros.protein ?? ""));
  };

  const submit = () => {
    if (!activeBand) return;
    const resolvedSlot = isEdit
      ? ((mealSlot as MealSlot) || "snack")
      : slotForBandAdd(activeBand, mealSlot);
    const foods = foodsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
    const cal = Number(calories);
    const pro = Number(protein);
    const defaults = defaultMacrosForAdd(mealSlot);
    onSave({
      id: editing?.id,
      persistence: isEdit ? "one_time" : persistence,
      band: activeBand,
      slot: resolvedSlot,
      label: label.trim() || slotLabel(resolvedSlot),
      notes: notes.trim() || undefined,
      foods: foods.length ? foods : undefined,
      calories: Number.isFinite(cal) ? cal : defaults.calories,
      protein: Number.isFinite(pro) ? pro : defaults.protein,
      calorie_min: defaults.calorie_min,
      calorie_max: defaults.calorie_max,
      protein_min: defaults.protein_min,
      protein_max: defaults.protein_max,
    });
  };

  if (!activeBand) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {isEdit ? `Edit · ${activeBand}` : `Add to ${activeBand}`}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.link}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {!isEdit ? (
              <>
                <Text style={styles.label}>What are you adding?</Text>
                <View style={styles.row}>
                  {BAND_ADD_OPTIONS.map((opt) => {
                    const active = mealSlot === opt.id;
                    return (
                      <TouchableOpacity
                        key={opt.id}
                        style={[styles.chip, active && styles.chipOn]}
                        onPress={() => pickMeal(opt.id, opt.defaultLabel)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextOn]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.label}>Save as</Text>
                <View style={styles.row}>
                  {(
                    [
                      ["one_time", "One-time"],
                      ["anchor", "Anchor"],
                      ["flexible", "Flexible"],
                    ] as const
                  ).map(([id, text]) => {
                    const active = persistence === id;
                    return (
                      <TouchableOpacity
                        key={id}
                        style={[styles.chip, active && styles.chipOn]}
                        onPress={() => setPersistence(id)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextOn]}>{text}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.hint}>
                  {persistence === "one_time"
                    ? "Stays on this day blueprint only — not a forever habit."
                    : persistence === "anchor"
                      ? "Opens the meal editor so you can pick specific foods."
                      : "Becomes a flexible meal with a calorie range."}
                </Text>
              </>
            ) : (
              <Text style={styles.hint}>One-time on the blueprint — edit name, foods, and macros.</Text>
            )}

            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder="e.g. Pre-workout banana"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.label}>Foods (comma-separated)</Text>
            <TextInput
              style={styles.input}
              value={foodsText}
              onChangeText={setFoodsText}
              placeholder="yogurt, oatmeal, protein shake"
              placeholderTextColor={colors.textMuted}
            />

            <View style={styles.macroRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Calories</Text>
                <TextInput
                  style={styles.input}
                  value={calories}
                  onChangeText={setCalories}
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Protein (g)</Text>
                <TextInput
                  style={styles.input}
                  value={protein}
                  onChangeText={setProtein}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, { minHeight: 64, textAlignVertical: "top" }]}
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="Around training, keep it light…"
              placeholderTextColor={colors.textMuted}
            />
          </ScrollView>

          {isEdit && onDelete ? (
            <TouchableOpacity style={styles.danger} onPress={onDelete}>
              <Text style={styles.dangerText}>Remove from blueprint</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity style={styles.primary} onPress={submit}>
            <Text style={styles.primaryText}>
              {isEdit
                ? "Save changes"
                : persistence === "anchor"
                  ? "Continue to meal foods"
                  : `Add to ${activeBand}`}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: "90%",
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  link: { color: colors.accentPrimary, fontWeight: "700" },
  body: { padding: spacing.lg, gap: 4 },
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textMuted,
    letterSpacing: 0.4,
    marginTop: spacing.md,
    marginBottom: 6,
  },
  hint: { fontSize: 12, color: colors.textSecondary, marginTop: 6, lineHeight: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  chipOn: {
    borderColor: colors.accentPrimary,
    backgroundColor: "rgba(255,107,53,0.16)",
  },
  chipText: { color: colors.textSecondary, fontWeight: "700", fontSize: 13 },
  chipTextOn: { color: colors.accentPrimary },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    color: colors.textPrimary,
    padding: spacing.md,
    backgroundColor: colors.cardBackground,
  },
  macroRow: { flexDirection: "row", gap: 10 },
  primary: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.accentPrimary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  danger: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  dangerText: { color: "#FF453A", fontWeight: "700", fontSize: 14 },
});
