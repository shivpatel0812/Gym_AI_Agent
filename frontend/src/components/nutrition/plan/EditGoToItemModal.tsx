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
import { GO_TO_SLOT_OPTIONS, GoToItem, WEEKDAY_OPTIONS } from "../../../api/nutritionPlan";
import { slotIcon } from "./EditMealAnchorModal";
import { bp, nutritionSheet } from "../../../lib/blueprintTheme";
import { spacing } from "../../../theme";

interface Props {
  visible: boolean;
  item: GoToItem | null;
  onClose: () => void;
  onSave: (item: GoToItem) => void | Promise<void>;
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

function emptyItem(): GoToItem {
  return { slot: "other", name: "", amount: "", calories: null, protein: null, carbs: null, fats: null, fiber: null };
}

export default function EditGoToItemModal({ visible, item, onClose, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState<GoToItem>(emptyItem());
  const [query, setQuery] = useState("");
  const [savedFoods, setSavedFoods] = useState<FoodDbItem[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraft(
      item
        ? {
            slot: "other",
            ...item,
            days: (item.days || []).map((d) => String(d).slice(0, 3).toLowerCase() as any),
          }
        : emptyItem()
    );
    setQuery("");
    setShowCustom(false);
  }, [visible, item]);

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

  const pickFromDb = (food: FoodDbItem) => {
    setDraft({
      id: item?.id,
      slot: draft.slot || "other",
      name: food.name,
      amount: food.serving,
      calories: Math.round(food.calories),
      protein: Math.round(food.protein * 10) / 10,
      carbs: Math.round(food.carbs * 10) / 10,
      fats: Math.round(food.fats * 10) / 10,
      fiber: food.fiber != null ? Math.round(food.fiber * 10) / 10 : null,
      days: draft.days || [],
      notes: draft.notes,
    });
    setQuery("");
    setShowCustom(true);
  };

  const update = (patch: Partial<GoToItem>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({
        id: item?.id,
        slot: draft.slot || "other",
        name: draft.name.trim(),
        amount: draft.amount?.trim() || null,
        calories: draft.calories != null ? Number(draft.calories) : null,
        protein: draft.protein != null ? Number(draft.protein) : null,
        carbs: draft.carbs != null ? Number(draft.carbs) : null,
        fats: draft.fats != null ? Number(draft.fats) : null,
        fiber: draft.fiber != null ? Number(draft.fiber) : null,
        days: draft.days || [],
        notes: draft.notes?.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const hasMacros =
    (Number(draft.calories) || 0) > 0 ||
    (Number(draft.protein) || 0) > 0 ||
    (Number(draft.carbs) || 0) > 0 ||
    (Number(draft.fats) || 0) > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{item?.id ? "Edit go-to item" : "Add go-to item"}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={20} color={bp.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Search your food database</Text>
            <Text style={styles.hint}>Pick from saved foods or the built-in catalog, then tweak the serving.</Text>

            <View style={styles.searchBox}>
              <MaterialCommunityIcons name="magnify" size={18} color={bp.muted2} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search foods..."
                placeholderTextColor={bp.muted2}
                autoCorrect={false}
              />
            </View>
            {results.map((food) => (
              <TouchableOpacity key={food.name} style={styles.resultRow} onPress={() => pickFromDb(food)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultName}>{food.name}</Text>
                  <Text style={styles.resultMeta}>
                    {food.serving} · {Math.round(food.calories)} kcal · {Math.round(food.protein)}g P
                  </Text>
                </View>
                <MaterialCommunityIcons name="plus-circle" size={22} color={bp.accent} />
              </TouchableOpacity>
            ))}

            <Text style={styles.label}>When do you reach for this?</Text>
            <View style={styles.chipRow}>
              {GO_TO_SLOT_OPTIONS.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.chip, (draft.slot || "other") === s.id && styles.chipOn]}
                  onPress={() => update({ slot: s.id })}
                >
                  <MaterialCommunityIcons
                    name={slotIcon(s.id)}
                    size={14}
                    color={(draft.slot || "other") === s.id ? bp.accent : bp.muted2}
                  />
                  <Text style={[styles.chipText, (draft.slot || "other") === s.id && styles.chipTextOn]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Days</Text>
            <Text style={styles.hint}>Tap days this go-to usually shows up.</Text>
            <View style={styles.chipRow}>
              {WEEKDAY_OPTIONS.map((d) => {
                const selected = (draft.days || []).map(String).includes(d.id);
                return (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.dayChip, selected && styles.dayChipOn]}
                    onPress={() => {
                      const cur = (draft.days || []).map(String);
                      const next = selected
                        ? cur.filter((x) => x !== d.id)
                        : [...cur, d.id];
                      update({ days: next as any });
                    }}
                  >
                    <Text style={[styles.dayChipText, selected && styles.dayChipTextOn]}>
                      {d.short}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity style={styles.customToggle} onPress={() => setShowCustom((v) => !v)}>
              <Text style={styles.customToggleText}>
                {showCustom || draft.name ? "Edit item details" : "+ Enter food manually"}
              </Text>
            </TouchableOpacity>

            {showCustom || draft.name ? (
              <View style={styles.customBox}>
                <TextInput
                  style={styles.input}
                  value={draft.name}
                  onChangeText={(v) => update({ name: v })}
                  placeholder="Food name"
                  placeholderTextColor={bp.muted2}
                />
                <TextInput
                  style={styles.input}
                  value={draft.amount || ""}
                  onChangeText={(v) => update({ amount: v })}
                  placeholder="Amount (e.g. 1 scoop, 200g)"
                  placeholderTextColor={bp.muted2}
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
                        value={draft[key] != null ? String(draft[key]) : ""}
                        onChangeText={(v) =>
                          update({ [key]: v === "" ? null : Number(v) || 0 })
                        }
                        placeholder="0"
                        placeholderTextColor={bp.muted2}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {hasMacros ? (
              <View style={styles.pillRow}>
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{Math.round(Number(draft.calories) || 0)} kcal</Text>
                </View>
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{Math.round(Number(draft.protein) || 0)}g protein</Text>
                </View>
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{Math.round(Number(draft.carbs) || 0)}g carbs</Text>
                </View>
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{Math.round(Number(draft.fats) || 0)}g fat</Text>
                </View>
              </View>
            ) : null}

            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, { minHeight: 64 }]}
              value={draft.notes || ""}
              onChangeText={(v) => update({ notes: v })}
              placeholder="e.g. Post-workout, keep in fridge"
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
  customToggle: { paddingVertical: spacing.sm },
  customToggleText: { color: bp.accent, fontWeight: "700", fontSize: 13 },
  customBox: { gap: 8, marginBottom: 8 },
  macroEditRow: { flexDirection: "row", gap: 6 },
  macroEditField: { flex: 1 },
  macroEditLabel: {
    fontSize: 10,
    color: bp.muted2,
    fontWeight: "700",
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  macroEditInput: {
    borderWidth: 1,
    borderColor: bp.border,
    borderRadius: 8,
    color: bp.text,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: bp.surface,
    fontSize: 13,
    textAlign: "center",
  },
});

const styles = { ...nutritionSheet, ...local };