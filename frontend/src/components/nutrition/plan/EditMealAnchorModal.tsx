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
  mealAnchorKind,
  mealFoodGroups,
  sumGroupedFoodMacros,
} from "../../../api/nutritionPlan";
import { bp, nutritionSheet } from "../../../lib/blueprintTheme";
import { borderRadius, spacing } from "../../../theme";

interface Props {
  visible: boolean;
  anchor: MealAnchor | null;
  onClose: () => void;
  onSave: (anchor: MealAnchor) => void | Promise<void>;
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
  return sumGroupedFoodMacros(foods);
}

function newGroupKey() {
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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
  const [mealKind, setMealKind] = useState<"individual" | "potential" | "uncertain">("individual");
  const [place, setPlace] = useState("");
  const [foods, setFoods] = useState<MealAnchorFood[]>([]);
  const [query, setQuery] = useState("");
  const [savedFoods, setSavedFoods] = useState<FoodDbItem[]>([]);
  const [recentLogs, setRecentLogs] = useState<FoodDbItem[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [custom, setCustom] = useState(emptyFood());
  const [showCustom, setShowCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  /** When set, next search/custom add joins this food group as an alternate. */
  const [alternateForKey, setAlternateForKey] = useState<string | null>(null);

  const varies = mealKind === "potential";
  const uncertain = mealKind === "uncertain";

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
    const kind = mealAnchorKind(anchor || {});
    setMealKind(kind);
    setPlace(anchor?.place || "");
    setFoods(anchor?.foods?.length ? anchor.foods.map((f) => ({ ...f })) : []);
    setQuery("");
    setCustom(emptyFood());
    setShowCustom(false);
    setAttachOpen(kind === "potential" || kind === "uncertain");
    setAlternateForKey(null);
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
    apiClient
      .get("/api/macros")
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res.data) ? res.data : [];
        const seen = new Set<string>();
        const out: FoodDbItem[] = [];
        for (const row of rows.slice(0, 80)) {
          const name = String(row?.name || "").trim();
          if (!name) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(
            toFoodDbItem({
              id: row.id,
              name,
              serving: row.serving || row.amount || "1 serving",
              calories: row.calories,
              protein: row.protein,
              carbs: row.carbs,
              fats: row.fats,
              fiber: row.fiber,
            })
          );
          if (out.length >= 24) break;
        }
        setRecentLogs(out);
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

  const previousMeals = useMemo(() => {
    const byName = new Map<string, FoodDbItem>();
    for (const food of recentLogs) byName.set(food.name.toLowerCase(), food);
    for (const food of savedFoods) byName.set(food.name.toLowerCase(), food);
    return Array.from(byName.values()).slice(0, 30);
  }, [recentLogs, savedFoods]);

  const attachResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = previousMeals.length ? previousMeals : catalog;
    if (!q) return pool.slice(0, 12);
    return pool.filter((f) => foodMatchesQuery(f, q)).slice(0, 12);
  }, [query, previousMeals, catalog]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((f) => foodMatchesQuery(f, q)).slice(0, 8);
  }, [query, catalog]);

  const totals = sumAnchorMacros(foods);
  const foodGroups = useMemo(() => mealFoodGroups(foods), [foods]);

  const addFromDb = (item: FoodDbItem) => {
    const groupKey = alternateForKey || newGroupKey();
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
        group_key: !varies && !uncertain ? groupKey : undefined,
        match_similar: false,
      },
    ]);
    setQuery("");
    setAlternateForKey(null);
    if (!label.trim() && !varies && !alternateForKey) setLabel(item.name);
  };

  const addCustom = () => {
    if (!custom.name.trim()) return;
    const groupKey = alternateForKey || newGroupKey();
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
        group_key: !varies && !uncertain ? groupKey : undefined,
        match_similar: false,
      },
    ]);
    setCustom(emptyFood());
    setShowCustom(false);
    setAlternateForKey(null);
  };

  const updateFood = (index: number, patch: Partial<MealAnchorFood>) => {
    setFoods((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const removeFood = (index: number) => {
    setFoods((prev) => prev.filter((_, i) => i !== index));
  };

  const removeGroup = (groupKey: string) => {
    setFoods((prev) =>
      prev.filter((f, i) => {
        const key = f.group_key || `solo:${i}:${String(f.name || "").toLowerCase()}`;
        return key !== groupKey;
      })
    );
    if (alternateForKey === groupKey) setAlternateForKey(null);
  };

  const handleSave = async () => {
    const kind = mealKind;
    const nextLabel =
      label.trim() ||
      (kind === "potential" ? place.trim() || "Potential meal" : "") ||
      (kind === "uncertain" ? place.trim() || "Uncertain meal" : "") ||
      foods[0]?.name ||
      "Regular meal";
    if (kind === "individual" && !foods.length && !label.trim()) return;
    if (kind !== "individual" && !label.trim() && !place.trim() && !foods.length) return;
    setSaving(true);
    try {
      await Promise.resolve(
        onSave({
          id: anchor?.id,
          slot,
          label: nextLabel,
          frequency: days.length === 7 ? "daily" : days.length ? "most_days" : frequency,
          days,
          notes: notes.trim() || null,
          kind,
          varies: kind === "potential",
          uncertain: kind === "uncertain",
          place: place.trim() || null,
          foods: foods.length ? foods : kind === "individual" ? [{ name: nextLabel }] : [],
          source: anchor?.source || undefined,
        })
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{anchor?.id ? "Edit meal anchor" : "Add meal anchor"}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <MaterialCommunityIcons name="close" size={20} color={bp.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Label</Text>
            <TextInput
              style={styles.input}
              value={label}
              onChangeText={setLabel}
              placeholder="Breakfast"
              placeholderTextColor={bp.muted2}
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
                    color={slot === s.id ? bp.accent : bp.muted2}
                  />
                  <Text style={[styles.chipText, slot === s.id && styles.chipTextOn]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Meal type</Text>
            <View style={styles.chipRow}>
              {(
                [
                  ["individual", "Individual", bp.accent, bp.accentSoft],
                  ["potential", "Potential", bp.potential, bp.potentialSoft],
                  ["uncertain", "Uncertain", bp.uncertain, bp.uncertainSoft],
                ] as const
              ).map(([id, text, color, soft]) => {
                const on = mealKind === id;
                return (
                  <TouchableOpacity
                    key={id}
                    style={[
                      styles.chip,
                      on && { borderColor: color, backgroundColor: soft },
                    ]}
                    onPress={() => {
                      setMealKind(id);
                      if (id !== "individual") setAttachOpen(true);
                    }}
                  >
                    <View style={[styles.kindDot, { backgroundColor: color }]} />
                    <Text style={[styles.chipText, on && { color }]}>{text}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {varies && !uncertain ? (
              <View style={styles.variesBox}>
                <Text style={styles.hint}>
                  e.g. “Fannie Lunch” — attach 3–4 options you rotate through.
                </Text>
                <Text style={styles.label}>Place / spot</Text>
                <TextInput
                  style={styles.input}
                  value={place}
                  onChangeText={setPlace}
                  placeholder="e.g. Fannie Mae, Chipotle"
                  placeholderTextColor={bp.muted2}
                />
              </View>
            ) : null}
            {uncertain ? (
              <View style={[styles.variesBox, { borderColor: "rgba(123,163,196,0.45)" }]}>
                <Text style={styles.hint}>
                  Open day — you don’t know yet. Optional place + idea meals for later.
                </Text>
                <Text style={styles.label}>Place / context (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={place}
                  onChangeText={setPlace}
                  placeholder="e.g. out with friends, work cafeteria"
                  placeholderTextColor={bp.muted2}
                />
              </View>
            ) : null}

            <Text style={styles.label}>Days you're certain</Text>
            <Text style={styles.hint}>
              Turn on days you know this meal. Leave Thu–Sun off if those are uncertain — keep the meal
              slot on Uncertain and add places there.
            </Text>
            <View style={styles.chipRow}>
              {WEEKDAY_OPTIONS.map((d) => {
                const on = days.includes(d.id);
                return (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.dayChip, on && styles.dayChipOn]}
                    onPress={() =>
                      setDays((prev) =>
                        prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                      )
                    }
                  >
                    <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>
                      {d.short || d.label.slice(0, 1)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {days.length > 0 && days.length < 7 ? (
              <Text style={styles.hint}>
                Open / uncertain:{" "}
                {WEEKDAY_OPTIONS.filter((d) => !days.includes(d.id))
                  .map((d) => d.label)
                  .join(", ")}
              </Text>
            ) : null}
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

            <Text style={styles.label}>
              {uncertain
                ? "Idea meals (optional)"
                : varies
                  ? "Options (add 3–4)"
                  : "Foods & macros"}
            </Text>
            <Text style={styles.hint}>
              {uncertain
                ? "Optional ideas for when you decide — or leave empty."
                : varies
                  ? "Attach 3–4 previous meals as options — pick one when you eat."
                  : alternateForKey
                    ? "Pick another food that also counts for this slot (e.g. another yogurt)."
                    : "Each card is one meal slot. Add alternates or “any similar” so Previous still matches."}
            </Text>
            {varies || uncertain ? (
              <TouchableOpacity
                style={styles.attachBtn}
                onPress={() => setAttachOpen((v) => !v)}
              >
                <MaterialCommunityIcons name="history" size={16} color={bp.ai} />
                <Text style={styles.attachBtnText}>
                  {attachOpen ? "Hide previous meals" : "Attach previous meals"}
                </Text>
              </TouchableOpacity>
            ) : null}

            {!varies && !uncertain
              ? foodGroups.map((group) => {
                  const primary = group.primary;
                  if (!primary) return null;
                  const primaryIndex = foods.findIndex(
                    (f) => f === primary || (f.name === primary.name && f.group_key === group.key)
                  );
                  const pi = primaryIndex >= 0 ? primaryIndex : foods.indexOf(primary);
                  const alternates = foods.filter((f, i) => {
                    const key = f.group_key || `solo:${i}:${String(f.name || "").toLowerCase()}`;
                    return key === group.key && f !== primary;
                  });
                  const addingHere = alternateForKey === group.key;
                  return (
                    <View key={group.key} style={styles.foodCard}>
                      <View style={styles.foodHead}>
                        <Text style={styles.foodName}>{primary.name}</Text>
                        <TouchableOpacity onPress={() => removeGroup(group.key)}>
                          <MaterialCommunityIcons name="close" size={18} color={bp.muted2} />
                        </TouchableOpacity>
                      </View>
                      <TextInput
                        style={styles.input}
                        value={primary.amount || ""}
                        onChangeText={(v) => pi >= 0 && updateFood(pi, { amount: v })}
                        placeholder="Amount (e.g. 200g)"
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
                              value={primary[key] != null ? String(primary[key]) : ""}
                              onChangeText={(v) =>
                                pi >= 0 &&
                                updateFood(pi, { [key]: v === "" ? null : Number(v) || 0 })
                              }
                              placeholder="0"
                              placeholderTextColor={bp.muted2}
                            />
                          </View>
                        ))}
                      </View>

                      {alternates.length ? (
                        <View style={styles.altRow}>
                          {alternates.map((alt) => {
                            const ai = foods.indexOf(alt);
                            return (
                              <View key={`${alt.name}-${ai}`} style={styles.altChip}>
                                <Text style={styles.altChipText} numberOfLines={1}>
                                  {alt.name}
                                </Text>
                                <TouchableOpacity onPress={() => ai >= 0 && removeFood(ai)} hitSlop={6}>
                                  <MaterialCommunityIcons name="close" size={14} color={bp.muted2} />
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                        </View>
                      ) : null}

                      <View style={styles.groupActions}>
                        <TouchableOpacity
                          style={[
                            styles.groupToggle,
                            group.matchSimilar && styles.groupToggleOn,
                          ]}
                          onPress={() => {
                            const on = !group.matchSimilar;
                            setFoods((prev) => {
                              let key = primary.group_key;
                              if (!key || String(key).startsWith("solo:")) {
                                key = newGroupKey();
                              }
                              return prev.map((f, i) => {
                                const isPrimary = i === pi;
                                const fKey =
                                  f.group_key || `solo:${i}:${String(f.name || "").toLowerCase()}`;
                                const inGroup =
                                  isPrimary ||
                                  fKey === group.key ||
                                  (primary.group_key && f.group_key === primary.group_key);
                                if (!inGroup && !isPrimary) return f;
                                return {
                                  ...f,
                                  group_key: key,
                                  match_similar: on,
                                };
                              });
                            });
                          }}
                        >
                          <MaterialCommunityIcons
                            name={
                              group.matchSimilar
                                ? "checkbox-marked-outline"
                                : "checkbox-blank-outline"
                            }
                            size={16}
                            color={group.matchSimilar ? bp.accent : bp.muted}
                          />
                          <Text
                            style={[
                              styles.groupToggleText,
                              group.matchSimilar && { color: bp.accent },
                            ]}
                          >
                            Any similar (e.g. any yogurt)
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.altAddBtn, addingHere && styles.altAddBtnOn]}
                          onPress={() => {
                            if (addingHere) {
                              setAlternateForKey(null);
                              return;
                            }
                            let key = primary.group_key || "";
                            if (!key || key.startsWith("solo:")) {
                              key = newGroupKey();
                              if (pi >= 0) updateFood(pi, { group_key: key });
                            }
                            setAlternateForKey(key);
                          }}
                        >
                          <Text style={[styles.altAddText, addingHere && { color: bp.accent }]}>
                            {addingHere ? "Cancel alternate" : "+ Alternate"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              : (foods || []).map((food, i) => (
                  <View key={`${food.name}-${i}`} style={styles.foodCard}>
                    <View style={styles.foodHead}>
                      <Text style={styles.foodName}>{food.name}</Text>
                      <TouchableOpacity onPress={() => removeFood(i)}>
                        <MaterialCommunityIcons name="close" size={18} color={bp.muted2} />
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      style={styles.input}
                      value={food.amount || ""}
                      onChangeText={(v) => updateFood(i, { amount: v })}
                      placeholder="Amount (e.g. 200g)"
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
                            value={food[key] != null ? String(food[key]) : ""}
                            onChangeText={(v) =>
                              updateFood(i, { [key]: v === "" ? null : Number(v) || 0 })
                            }
                            placeholder="0"
                            placeholderTextColor={bp.muted2}
                          />
                        </View>
                      ))}
                    </View>
                  </View>
                ))}

            <View style={styles.searchBox}>
              <MaterialCommunityIcons name="magnify" size={18} color={bp.muted2} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder={
                  alternateForKey ? "Search alternate food..." : "Search foods..."
                }
                placeholderTextColor={bp.muted2}
                autoCorrect={false}
              />
            </View>
            {((varies || uncertain) && attachOpen ? attachResults : results).map((item) => (
              <TouchableOpacity
                key={`${item.id || item.name}`}
                style={styles.resultRow}
                onPress={() => addFromDb(item)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultName}>{item.name}</Text>
                  <Text style={styles.resultMeta}>
                    {item.serving} · {Math.round(item.calories)} kcal · {Math.round(item.protein)}g P
                  </Text>
                </View>
                <MaterialCommunityIcons name="plus-circle" size={22} color={bp.accent} />
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
                  placeholderTextColor={bp.muted2}
                />
                <TextInput
                  style={styles.input}
                  value={custom.amount || ""}
                  onChangeText={(v) => setCustom((c) => ({ ...c, amount: v }))}
                  placeholder="Amount"
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
                        value={custom[key] != null ? String(custom[key]) : ""}
                        onChangeText={(v) =>
                          setCustom((c) => ({ ...c, [key]: v === "" ? null : Number(v) || 0 }))
                        }
                        placeholder="0"
                        placeholderTextColor={bp.muted2}
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
                <Text style={styles.totalsTitle}>{varies ? "Options total (typical ~avg)" : "Meal total"}</Text>
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
              style={[
                styles.primary,
                ((!varies && !uncertain && !foods.length && !label.trim()) ||
                  ((varies || uncertain) && !label.trim() && !place.trim() && !foods.length)) &&
                  styles.primaryDisabled,
              ]}
              onPress={handleSave}
              disabled={
                ((!varies && !uncertain && !foods.length && !label.trim()) ||
                  ((varies || uncertain) && !label.trim() && !place.trim() && !foods.length) ||
                  saving)
              }
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
  dayChip: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: bp.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: bp.surface2,
    minWidth: 36,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  kindDot: { width: 6, height: 6, borderRadius: 3 },
  foodCard: {
    backgroundColor: bp.surface2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: bp.border,
    padding: spacing.md,
    gap: 8,
    marginBottom: 8,
  },
  groupActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  groupToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: bp.border,
  },
  groupToggleOn: {
    borderColor: `${bp.accent}88`,
    backgroundColor: bp.accentSoft,
  },
  groupToggleText: { color: bp.muted, fontSize: 11, fontWeight: "700" },
  altAddBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: bp.border,
  },
  altAddBtnOn: {
    borderColor: `${bp.accent}88`,
    backgroundColor: bp.accentSoft,
  },
  altAddText: { color: bp.muted, fontSize: 11, fontWeight: "800" },
  altRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  altChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: bp.surface,
    borderWidth: 1,
    borderColor: bp.border,
  },
  altChipText: { color: "#fff", fontSize: 11, fontWeight: "600", maxWidth: 140 },
  foodHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  foodName: { fontSize: 14, fontWeight: "700", color: bp.text, flex: 1 },
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
  variesBox: {
    gap: 8,
    padding: 12,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.25)",
    backgroundColor: bp.aiSoft,
  },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.35)",
    backgroundColor: bp.aiSoft,
    marginBottom: 4,
  },
  attachBtnText: { color: bp.ai, fontWeight: "700", fontSize: 12 },
  customToggle: { paddingVertical: spacing.sm },
  customToggleText: { color: bp.accent, fontWeight: "700", fontSize: 13 },
  customBox: { gap: 8, marginBottom: 8 },
  totalsRow: { marginTop: spacing.md, gap: 8 },
  totalsTitle: { fontSize: 13, fontWeight: "700", color: bp.text },
  smallPrimary: {
    backgroundColor: bp.accent,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
});

const styles = { ...nutritionSheet, ...local };