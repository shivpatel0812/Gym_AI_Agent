import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../../api/client";
import foodDatabase, { FoodDbItem } from "../../../data/foodDatabase";
import {
  FREQUENCY_OPTIONS,
  MealAnchor,
  MealAnchorFood,
  MealSlot,
  PRIMARY_SLOT_OPTIONS,
  WEEKDAY_OPTIONS,
  WeekdayKey,
  frequencyLabel,
} from "../../../api/nutritionPlan";
import { colors, spacing, borderRadius } from "../../../theme";

interface Props {
  visible: boolean;
  anchor: MealAnchor | null;
  onClose: () => void;
  onSave: (anchor: MealAnchor) => void;
  onDelete?: () => void;
}

function toFoodDbItem(raw: any): FoodDbItem {
  return {
    id: raw.id,
    name: String(raw.name || "").trim(),
    serving: String(raw.serving || "1 serving").trim(),
    grams: Number(raw.grams) > 0 ? Number(raw.grams) : 100,
    calories: Number(raw.calories) || 0,
    protein: Number(raw.protein) || 0,
    carbs: Number(raw.carbs) || 0,
    fats: Number(raw.fats) || 0,
    fiber: Number(raw.fiber) || 0,
    aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
  };
}

function foodMatchesQuery(food: FoodDbItem, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const blob = [food.name, food.serving, ...(food.aliases || [])].join(" ").toLowerCase();
  if (blob.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length > 2 && !/^\d+$/.test(t));
  return tokens.length > 0 && tokens.every((t) => blob.includes(t));
}

function emptyFood(): MealAnchorFood {
  return { name: "", amount: "", calories: null, protein: null, carbs: null, fats: null, fiber: null };
}

export function sumAnchorMacros(foods: MealAnchorFood[] = []) {
  return foods.reduce(
    (acc, food) => ({
      calories: acc.calories + (Number(food.calories) || 0),
      protein: acc.protein + (Number(food.protein) || 0),
      carbs: acc.carbs + (Number(food.carbs) || 0),
      fats: acc.fats + (Number(food.fats) || 0),
      fiber: acc.fiber + (Number(food.fiber) || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 }
  );
}

export function slotIcon(slot?: string): keyof typeof MaterialCommunityIcons.glyphMap {
  switch (slot) {
    case "breakfast":
      return "weather-sunny";
    case "lunch":
      return "white-balance-sunny";
    case "shake":
      return "cup";
    case "pre_workout":
      return "dumbbell";
    case "snack":
      return "cookie";
    case "dinner":
      return "silverware-fork-knife";
    case "late_night":
      return "weather-night";
    default:
      return "food-apple";
  }
}

export default function EditMealAnchorModal({
  visible,
  anchor,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const [label, setLabel] = useState("");
  const [slot, setSlot] = useState<MealSlot | string>("breakfast");
  const [frequency, setFrequency] = useState("daily");
  const [days, setDays] = useState<WeekdayKey[]>([]);
  const [notes, setNotes] = useState("");
  const [foods, setFoods] = useState<MealAnchorFood[]>([]);
  const [query, setQuery] = useState("");
  const [savedFoods, setSavedFoods] = useState<FoodDbItem[]>([]);
  const [custom, setCustom] = useState(emptyFood());
  const [showCustom, setShowCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLabel(anchor?.label || "");
    setSlot(anchor?.slot || "breakfast");
    setFrequency(anchor?.frequency || "daily");
    setDays(
      (anchor?.days || []).map((d) => String(d).slice(0, 3).toLowerCase() as WeekdayKey).filter(
        (d) => WEEKDAY_OPTIONS.some((w) => w.id === d)
      )
    );
    setNotes(anchor?.notes || "");
    setFoods(anchor?.foods?.length ? anchor.foods.map((f) => ({ ...f })) : []);
    setQuery("");
    setCustom(emptyFood());
    setShowCustom(false);
  }, [visible, anchor]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    apiClient
      .get("/api/macros/foods")
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res.data) ? res.data.map(toFoodDbItem) : [];
        setSavedFoods(items.filter((f) => f.name));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const catalog = useMemo(() => {
    const byName = new Map<string, FoodDbItem>();
    for (const food of foodDatabase) byName.set(food.name.toLowerCase(), food);
    for (const food of savedFoods) byName.set(food.name.toLowerCase(), food);
    return Array.from(byName.values());
  }, [savedFoods]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((f) => foodMatchesQuery(f, q)).slice(0, 8);
  }, [query, catalog]);

  const totals = sumAnchorMacros(foods);

  const addFromDb = (item: FoodDbItem) => {
    setFoods((prev) => [
      ...prev,
      {
        name: item.name,
        amount: item.serving,
        calories: Math.round(item.calories),
        protein: Math.round(item.protein * 10) / 10,
        carbs: Math.round(item.carbs * 10) / 10,
        fats: Math.round(item.fats * 10) / 10,
        fiber: item.fiber != null ? Math.round(item.fiber * 10) / 10 : null,
      },
    ]);
    setQuery("");
    if (!label.trim()) setLabel(item.name);
  };

  const addCustom = () => {
    if (!custom.name.trim()) return;
    setFoods((prev) => [
      ...prev,
      {
        name: custom.name.trim(),
        amount: custom.amount || null,
        calories: Number(custom.calories) || null,
        protein: Number(custom.protein) || null,
        carbs: Number(custom.carbs) || null,
        fats: Number(custom.fats) || null,
        fiber: Number(custom.fiber) || null,
      },
    ]);
    setCustom(emptyFood());
    setShowCustom(false);
  };

  const updateFood = (index: number, patch: Partial<MealAnchorFood>) => {
    setFoods((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const removeFood = (index: number) => {
    setFoods((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const nextLabel = label.trim() || foods[0]?.name || "Regular meal";
    if (!foods.length && !label.trim()) return;
    setSaving(true);
    onSave({
      id: anchor?.id,
      slot,
      label: nextLabel,
      frequency: days.length === 7 ? "daily" : days.length ? "most_days" : frequency,
      days,
      notes: notes.trim() || null,
      foods: foods.length ? foods : [{ name: nextLabel }],
    });
    setSaving(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{anchor?.id ? "Edit meal anchor" : "Add meal anchor"}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Label</Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder="Breakfast"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.label}>Meal</Text>
            <View style={styles.chipRow}>
              {PRIMARY_SLOT_OPTIONS.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.chip, slot === s.id && styles.chipOn]}
                  onPress={() => setSlot(s.id)}
                >
                  <MaterialCommunityIcons
                    name={slotIcon(s.id)}
                    size={14}
                    color={slot === s.id ? colors.accentPrimary : colors.textMuted}
                  />
                  <Text style={[styles.chipText, slot === s.id && styles.chipTextOn]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Days you usually eat this</Text>
            <View style={styles.chipRow}>
              {WEEKDAY_OPTIONS.map((d) => {
                const on = days.includes(d.id);
                return (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.dayChip, on && styles.chipOn]}
                    onPress={() =>
                      setDays((prev) =>
                        prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                      )
                    }
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{d.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={styles.chip}
                onPress={() => setDays(WEEKDAY_OPTIONS.map((d) => d.id))}
              >
                <Text style={styles.chipText}>Every day</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.chip}
                onPress={() => setDays(["mon", "tue", "wed", "thu", "fri"])}
              >
                <Text style={styles.chipText}>Weekdays</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.chip} onPress={() => setDays([])}>
                <Text style={styles.chipText}>Clear</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>How often (if no days picked)</Text>
            <View style={styles.chipRow}>
              {FREQUENCY_OPTIONS.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={[styles.chip, frequency === f.id && styles.chipOn]}
                  onPress={() => setFrequency(f.id)}
                >
                  <Text style={[styles.chipText, frequency === f.id && styles.chipTextOn]}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Foods & macros</Text>
            <Text style={styles.hint}>Search your food database or saved foods, then tweak amounts.</Text>

            {(foods || []).map((food, i) => (
              <View key={`${food.name}-${i}`} style={styles.foodCard}>
                <View style={styles.foodHead}>
                  <Text style={styles.foodName}>{food.name}</Text>
                  <TouchableOpacity onPress={() => removeFood(i)}>
                    <MaterialCommunityIcons name="close" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.input}
                  value={food.amount || ""}
                  onChangeText={(v) => updateFood(i, { amount: v })}
                  placeholder="Amount (e.g. 200g)"
                  placeholderTextColor={colors.textMuted}
                />
                <View style={styles.macroEditRow}>
                  {(
                    [
                      ["calories", "kcal"],
                      ["protein", "P"],
                      ["carbs", "C"],
                      ["fats", "F"],
                    ] as const
                  ).map(([key, short]) => (
                    <View key={key} style={styles.macroEditField}>
                      <Text style={styles.macroEditLabel}>{short}</Text>
                      <TextInput
                        style={styles.macroEditInput}
                        keyboardType="numeric"
                        value={food[key] != null ? String(food[key]) : ""}
                        onChangeText={(v) =>
                          updateFood(i, { [key]: v === "" ? null : Number(v) || 0 })
                        }
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ))}

            <View style={styles.searchBox}>
              <MaterialCommunityIcons name="magnify" size={18} color={colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search foods..."
                placeholderTextColor={colors.textMuted}
                autoCorrect={false}
              />
            </View>
            {results.map((item) => (
              <TouchableOpacity key={item.name} style={styles.resultRow} onPress={() => addFromDb(item)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultName}>{item.name}</Text>
                  <Text style={styles.resultMeta}>
                    {item.serving} · {Math.round(item.calories)} kcal · {Math.round(item.protein)}g P
                  </Text>
                </View>
                <MaterialCommunityIcons name="plus-circle" size={22} color={colors.accentPrimary} />
              </TouchableOpacity>
            ))}

            <TouchableOpacity style={styles.customToggle} onPress={() => setShowCustom((v) => !v)}>
              <Text style={styles.customToggleText}>
                {showCustom ? "Hide custom food" : "+ Add custom food with macros"}
              </Text>
            </TouchableOpacity>

            {showCustom ? (
              <View style={styles.customBox}>
                <TextInput
                  style={styles.input}
                  value={custom.name || ""}
                  onChangeText={(v) => setCustom((c) => ({ ...c, name: v }))}
                  placeholder="Food name"
                  placeholderTextColor={colors.textMuted}
                />
                <TextInput
                  style={styles.input}
                  value={custom.amount || ""}
                  onChangeText={(v) => setCustom((c) => ({ ...c, amount: v }))}
                  placeholder="Amount"
                  placeholderTextColor={colors.textMuted}
                />
                <View style={styles.macroEditRow}>
                  {(
                    [
                      ["calories", "kcal"],
                      ["protein", "P"],
                      ["carbs", "C"],
                      ["fats", "F"],
                    ] as const
                  ).map(([key, short]) => (
                    <View key={key} style={styles.macroEditField}>
                      <Text style={styles.macroEditLabel}>{short}</Text>
                      <TextInput
                        style={styles.macroEditInput}
                        keyboardType="numeric"
                        value={custom[key] != null ? String(custom[key]) : ""}
                        onChangeText={(v) =>
                          setCustom((c) => ({ ...c, [key]: v === "" ? null : Number(v) || 0 }))
                        }
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                      />
                    </View>
                  ))}
                </View>
                <TouchableOpacity style={styles.smallPrimary} onPress={addCustom}>
                  <Text style={styles.primaryText}>Add food</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {totals.calories > 0 || totals.protein > 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsTitle}>Meal total</Text>
                <View style={styles.pillRow}>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{Math.round(totals.calories)} kcal</Text>
                  </View>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{Math.round(totals.protein)}g protein</Text>
                  </View>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{Math.round(totals.carbs)}g carbs</Text>
                  </View>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{Math.round(totals.fats)}g fat</Text>
                  </View>
                </View>
              </View>
            ) : null}

            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, { minHeight: 64 }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. Usually after training"
              placeholderTextColor={colors.textMuted}
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
              style={[styles.primary, (!foods.length && !label.trim()) && styles.primaryDisabled]}
              onPress={handleSave}
              disabled={(!foods.length && !label.trim()) || saving}
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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "92%",
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: spacing.lg, paddingBottom: spacing["2xl"], gap: 8 },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 8, lineHeight: 16 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    fontSize: 14,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.background,
  },
  dayChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.background,
    minWidth: 44,
    alignItems: "center",
  },
  chipOn: { borderColor: colors.accentPrimary },
  chipText: { fontSize: 12, color: colors.textSecondary, fontWeight: "600" },
  chipTextOn: { color: colors.accentPrimary },
  foodCard: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 8,
    marginBottom: 8,
  },
  foodHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  foodName: { fontSize: 14, fontWeight: "700", color: colors.textPrimary, flex: 1 },
  macroEditRow: { flexDirection: "row", gap: 6 },
  macroEditField: { flex: 1 },
  macroEditLabel: { fontSize: 10, color: colors.textMuted, fontWeight: "700", marginBottom: 2 },
  macroEditInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    color: colors.textPrimary,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.cardBackground,
    fontSize: 13,
    textAlign: "center",
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    marginTop: 4,
  },
  searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: 12, fontSize: 14 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  resultMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  customToggle: { paddingVertical: spacing.sm },
  customToggleText: { color: colors.accentPrimary, fontWeight: "700", fontSize: 13 },
  customBox: { gap: 8, marginBottom: 8 },
  totalsRow: { marginTop: spacing.md, gap: 8 },
  totalsTitle: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    backgroundColor: colors.background,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillText: { fontSize: 12, color: colors.textSecondary, fontWeight: "600" },
  actions: {
    flexDirection: "row",
    gap: 10,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primary: {
    flex: 1,
    backgroundColor: colors.accentPrimary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  primaryDisabled: { opacity: 0.4 },
  primaryText: { color: "#fff", fontWeight: "700" },
  secondary: {
    flex: 1,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.textSecondary, fontWeight: "700" },
  deleteBtn: {
    flex: 1,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.4)",
  },
  deleteText: { color: colors.danger, fontWeight: "700" },
  smallPrimary: {
    backgroundColor: colors.accentPrimary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
});
