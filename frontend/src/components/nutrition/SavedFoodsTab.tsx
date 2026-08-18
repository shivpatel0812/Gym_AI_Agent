import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import { colors, spacing, borderRadius } from "../../theme";
import { FoodDbItem } from "../../data/foodDatabase";

function toItem(raw: any): FoodDbItem {
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

const field = {
  height: 44,
  paddingHorizontal: 12,
  borderRadius: 10,
  backgroundColor: colors.background,
  borderWidth: 1,
  borderColor: colors.border,
  color: "#fff",
  fontSize: 14,
};

export default function SavedFoodsTab() {
  const [foods, setFoods] = useState<FoodDbItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<FoodDbItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/macros/foods");
      const items = Array.isArray(res.data) ? res.data.map(toItem) : [];
      setFoods(items.filter((f) => f.name && f.id));
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Could not load saved foods.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return foods;
    return foods.filter((f) =>
      [f.name, f.serving, ...(f.aliases || [])].join(" ").toLowerCase().includes(q)
    );
  }, [foods, query]);

  const saveEdit = async () => {
    if (!editing?.id || !editing.name.trim()) return;
    setSaving(true);
    try {
      const res = await apiClient.patch(`/api/macros/foods/${editing.id}`, {
        name: editing.name.trim(),
        serving: editing.serving.trim() || "1 serving",
        grams: Number(editing.grams) || 100,
        calories: Number(editing.calories) || 0,
        protein: Number(editing.protein) || 0,
        carbs: Number(editing.carbs) || 0,
        fats: Number(editing.fats) || 0,
        fiber: Number(editing.fiber) || 0,
      });
      const next = toItem(res.data);
      setFoods((prev) => prev.map((f) => (f.id === next.id ? next : f)));
      setEditing(null);
    } catch (err: any) {
      Alert.alert("Could not save", err?.response?.data?.detail || "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = (food: FoodDbItem) => {
    if (!food.id) return;
    Alert.alert("Delete this saved food?", food.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiClient.delete(`/api/macros/foods/${food.id}`);
            setFoods((prev) => prev.filter((f) => f.id !== food.id));
            if (editing?.id === food.id) setEditing(null);
          } catch {
            Alert.alert("Error", "Could not delete that food.");
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accentPrimary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.accentPrimary}
        />
      }
    >
      <Text style={styles.title}>Saved foods</Text>
      <Text style={styles.subtitle}>
        Foods you've logged or estimated. Edit macros here so search stays accurate.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.search}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search saved foods"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      {editing ? (
        <View style={styles.editor}>
          <Text style={styles.editorTitle}>Edit {editing.name}</Text>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={field}
            value={editing.name}
            onChangeText={(v) => setEditing({ ...editing, name: v })}
          />
          <Text style={styles.label}>Serving</Text>
          <TextInput
            style={field}
            value={editing.serving}
            onChangeText={(v) => setEditing({ ...editing, serving: v })}
            placeholder="e.g. 180g"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.label}>Grams in one serving</Text>
          <TextInput
            style={field}
            keyboardType="numeric"
            value={String(editing.grams ?? "")}
            onChangeText={(v) => setEditing({ ...editing, grams: Number(v) || 0 })}
          />
          <View style={styles.macroRow}>
            {(
              [
                ["calories", "kcal"],
                ["protein", "P"],
                ["carbs", "C"],
                ["fats", "F"],
                ["fiber", "Fi"],
              ] as const
            ).map(([key, short]) => (
              <View key={key} style={styles.macroField}>
                <Text style={styles.macroLabel}>{short}</Text>
                <TextInput
                  style={styles.macroInput}
                  keyboardType="numeric"
                  value={editing[key] != null ? String(editing[key]) : ""}
                  onChangeText={(v) =>
                    setEditing({ ...editing, [key]: v === "" ? 0 : Number(v) || 0 })
                  }
                />
              </View>
            ))}
          </View>
          <View style={styles.editorActions}>
            <TouchableOpacity style={styles.secondary} onPress={() => setEditing(null)}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primary, saving && { opacity: 0.5 }]}
              onPress={saveEdit}
              disabled={saving || !editing.name.trim()}
            >
              <Text style={styles.primaryText}>{saving ? "Saving..." : "Save"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {filtered.map((food) => (
        <View key={food.id} style={styles.card}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setEditing({ ...food })}>
            <Text style={styles.foodName}>{food.name}</Text>
            <Text style={styles.foodMeta}>
              {food.serving} · {Math.round(food.calories)} kcal · {Math.round(food.protein)}g P
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setEditing({ ...food })} style={styles.iconBtn}>
            <MaterialCommunityIcons name="pencil" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => remove(food)} style={styles.iconBtn}>
            <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.danger} />
          </TouchableOpacity>
        </View>
      ))}

      {!filtered.length ? (
        <Text style={styles.empty}>
          {query
            ? "No saved foods match that search."
            : "Nothing saved yet. Log a custom food or estimate one and it will show up here."}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.lg, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: "700", color: colors.textPrimary },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  error: { color: colors.danger, marginBottom: spacing.sm },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.cardBackground,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: 12, fontSize: 14 },
  editor: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 6,
    marginBottom: spacing.md,
  },
  editorTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary, marginBottom: 4 },
  label: { fontSize: 11, fontWeight: "700", color: colors.textMuted, marginTop: 6 },
  macroRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  macroField: { flex: 1 },
  macroLabel: { fontSize: 10, fontWeight: "700", color: colors.textMuted, marginBottom: 2 },
  macroInput: {
    ...field,
    height: 40,
    paddingHorizontal: 6,
    textAlign: "center",
  },
  editorActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  primary: {
    flex: 1,
    backgroundColor: colors.accentPrimary,
    borderRadius: borderRadius.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700" },
  secondary: {
    flex: 1,
    borderRadius: borderRadius.md,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.textSecondary, fontWeight: "700" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: 8,
    gap: 4,
  },
  foodName: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  foodMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  iconBtn: { padding: 6 },
  empty: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginTop: spacing.md },
});
