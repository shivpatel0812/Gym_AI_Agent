import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Switch,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { FlexibleMeal, FREQUENCY_OPTIONS } from "../../../api/nutritionPlan";
import { bp, nutritionSheet } from "../../../lib/blueprintTheme";
import { spacing } from "../../../theme";

interface Props {
  visible: boolean;
  meal: FlexibleMeal | null;
  onClose: () => void;
  onSave: (meal: FlexibleMeal) => void | Promise<void>;
  onDelete?: () => void;
}

function emptyMeal(): FlexibleMeal {
  return {
    name: "Dinner",
    frequency: "most_days",
    calorie_min: 650,
    calorie_max: 900,
    protein_min: 25,
    protein_max: 40,
    user_controls_food: false,
    notes: null,
  };
}

export default function EditFlexibleMealModal({
  visible,
  meal,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<FlexibleMeal>(emptyMeal());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraft(meal ? { ...meal } : emptyMeal());
  }, [visible, meal]);

  const update = (patch: Partial<FlexibleMeal>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({
        id: meal?.id,
        name: draft.name.trim(),
        frequency: draft.frequency || "most_days",
        calorie_min: draft.calorie_min != null ? Number(draft.calorie_min) : null,
        calorie_max: draft.calorie_max != null ? Number(draft.calorie_max) : null,
        protein_min: draft.protein_min != null ? Number(draft.protein_min) : null,
        protein_max: draft.protein_max != null ? Number(draft.protein_max) : null,
        user_controls_food: Boolean(draft.user_controls_food),
        notes: draft.notes?.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{meal?.id ? "Edit flexible meal" : "Add flexible meal"}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={20} color={bp.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.hint}>
              Meals you don't fully control — family dinner, work lunches, etc. We'll plan the rest of the day around these ranges.
            </Text>

            <Text style={styles.label}>Name</Text>
            <TextInput
              style={styles.input}
              value={draft.name}
              onChangeText={(v) => update({ name: v })}
              placeholder="Dinner"
              placeholderTextColor={bp.muted2}
            />

            <Text style={styles.label}>How often</Text>
            <View style={styles.chipRow}>
              {FREQUENCY_OPTIONS.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={[styles.chip, draft.frequency === f.id && styles.chipOn]}
                  onPress={() => update({ frequency: f.id })}
                >
                  <Text style={[styles.chipText, draft.frequency === f.id && styles.chipTextOn]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Calorie range</Text>
            <View style={styles.row2}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                keyboardType="numeric"
                value={draft.calorie_min != null ? String(draft.calorie_min) : ""}
                onChangeText={(v) => update({ calorie_min: v === "" ? null : Number(v) || 0 })}
                placeholder="Min"
                placeholderTextColor={bp.muted2}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                keyboardType="numeric"
                value={draft.calorie_max != null ? String(draft.calorie_max) : ""}
                onChangeText={(v) => update({ calorie_max: v === "" ? null : Number(v) || 0 })}
                placeholder="Max"
                placeholderTextColor={bp.muted2}
              />
            </View>

            <Text style={styles.label}>Protein range (optional)</Text>
            <View style={styles.row2}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                keyboardType="numeric"
                value={draft.protein_min != null ? String(draft.protein_min) : ""}
                onChangeText={(v) => update({ protein_min: v === "" ? null : Number(v) || 0 })}
                placeholder="Min g"
                placeholderTextColor={bp.muted2}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                keyboardType="numeric"
                value={draft.protein_max != null ? String(draft.protein_max) : ""}
                onChangeText={(v) => update({ protein_max: v === "" ? null : Number(v) || 0 })}
                placeholder="Max g"
                placeholderTextColor={bp.muted2}
              />
            </View>

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>You mostly control this meal</Text>
                <Text style={styles.switchHint}>Turn on if you pick the food but want a calorie range</Text>
              </View>
              <Switch
                value={Boolean(draft.user_controls_food)}
                onValueChange={(v) => update({ user_controls_food: v })}
                trackColor={{ false: bp.border, true: bp.accent }}
              />
            </View>

            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, { minHeight: 64 }]}
              value={draft.notes || ""}
              onChangeText={(v) => update({ notes: v })}
              placeholder="e.g. Family dinner, calories are approximate"
              placeholderTextColor={bp.muted2}
              multiline
            />
          </ScrollView>

          <View style={styles.actions}>
            {onDelete ? (
              <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
                <Text style={styles.deleteText}>Remove</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.secondary} onPress={onClose}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.primary, !draft.name.trim() && styles.primaryDisabled]}
              onPress={handleSave}
              disabled={!draft.name.trim() || saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const local = StyleSheet.create({
  row2: { flexDirection: "row", gap: 8 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
  },
  switchLabel: { fontSize: 14, fontWeight: "600", color: bp.text },
  switchHint: { fontSize: 12, color: bp.muted2, marginTop: 2, lineHeight: 16 },
});

const styles = { ...nutritionSheet, ...local };