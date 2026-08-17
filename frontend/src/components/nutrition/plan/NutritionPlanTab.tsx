import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import CreateNutritionPlanModal from "./CreateNutritionPlanModal";
import EditMealAnchorModal, { slotIcon, sumAnchorMacros } from "./EditMealAnchorModal";
import {
  FlexibleMeal,
  MealAnchor,
  NutritionPlan,
  endNutritionPlan,
  frequencyLabel,
  getActiveNutritionPlan,
  goalLabel,
  pauseNutritionPlan,
  resumeNutritionPlan,
  updateNutritionPlan,
} from "../../../api/nutritionPlan";
import { colors, spacing, borderRadius } from "../../../theme";

interface Props {
  onAskCoach?: (prompt: string) => void;
}

const MACRO_TILES = [
  { key: "protein", label: "Protein", icon: "food-steak" as const, color: "#FF6B35", unit: "g" },
  { key: "carbs", label: "Carbs", icon: "barley" as const, color: "#F5C542", unit: "g" },
  { key: "fats", label: "Fat", icon: "water" as const, color: "#C4B5FD", unit: "g" },
  { key: "fiber", label: "Fiber", icon: "leaf" as const, color: "#4ADE80", unit: "g" },
];

export default function NutritionPlanTab({ onAskCoach }: Props) {
  const [plan, setPlan] = useState<NutritionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTargets, setEditingTargets] = useState(false);
  const [cal, setCal] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fats, setFats] = useState("");
  const [fiber, setFiber] = useState("");
  const [addingFlex, setAddingFlex] = useState(false);
  const [editingAnchor, setEditingAnchor] = useState<MealAnchor | null>(null);
  const [editingAnchorIndex, setEditingAnchorIndex] = useState<number | null>(null);
  const [anchorEditorOpen, setAnchorEditorOpen] = useState(false);
  const [newFlex, setNewFlex] = useState<FlexibleMeal>({
    name: "Dinner",
    frequency: "most_days",
    calorie_min: 650,
    calorie_max: 900,
    protein_min: 25,
    protein_max: 40,
  });

  const load = useCallback(async () => {
    try {
      const active = await getActiveNutritionPlan();
      setPlan(active);
      if (active?.targets) {
        setCal(String(active.targets.calories ?? ""));
        setProtein(String(active.targets.protein ?? ""));
        setCarbs(String(active.targets.carbs ?? ""));
        setFats(String(active.targets.fats ?? ""));
        setFiber(String(active.targets.fiber ?? ""));
      }
    } catch (error) {
      console.error("Error loading nutrition plan:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const savePatch = async (patch: Partial<NutritionPlan>) => {
    if (!plan) return;
    try {
      const updated = await updateNutritionPlan(plan.id, patch);
      setPlan(updated);
    } catch {
      Alert.alert("Error", "Could not save that change.");
    }
  };

  const saveTargets = async () => {
    await savePatch({
      targets: {
        ...plan?.targets,
        calories: Number(cal) || plan?.targets.calories,
        protein: Number(protein) || plan?.targets.protein,
        carbs: Number(carbs) || plan?.targets.carbs,
        fats: Number(fats) || plan?.targets.fats,
        fiber: Number(fiber) || plan?.targets.fiber,
      },
    });
    setEditingTargets(false);
  };

  const openNewAnchor = () => {
    setEditingAnchor({
      slot: "breakfast",
      label: "",
      foods: [],
      frequency: "daily",
    });
    setEditingAnchorIndex(null);
    setAnchorEditorOpen(true);
  };

  const openEditAnchor = (anchor: MealAnchor, index: number) => {
    setEditingAnchor(anchor);
    setEditingAnchorIndex(index);
    setAnchorEditorOpen(true);
  };

  const saveAnchor = async (next: MealAnchor) => {
    if (!plan) return;
    const anchors = [...(plan.meal_anchors || [])];
    if (editingAnchorIndex != null && editingAnchorIndex >= 0) {
      anchors[editingAnchorIndex] = next;
    } else if (next.id) {
      const idx = anchors.findIndex((a) => a.id === next.id);
      if (idx >= 0) anchors[idx] = next;
      else anchors.push(next);
    } else {
      anchors.push(next);
    }
    await savePatch({ meal_anchors: anchors });
    setAnchorEditorOpen(false);
    setEditingAnchor(null);
    setEditingAnchorIndex(null);
  };

  const removeAnchor = (id?: string, index?: number) => {
    if (!plan) return;
    Alert.alert("Remove this regular food?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await savePatch({
            meal_anchors: plan.meal_anchors.filter((a, i) => (id ? a.id !== id : i !== index)),
          });
          setAnchorEditorOpen(false);
          setEditingAnchor(null);
          setEditingAnchorIndex(null);
        },
      },
    ]);
  };

  const addFlexMeal = async () => {
    if (!plan || !newFlex.name.trim()) return;
    await savePatch({ flexible_meals: [...(plan.flexible_meals || []), newFlex] });
    setAddingFlex(false);
  };

  const removeFlex = (id?: string, index?: number) => {
    if (!plan) return;
    savePatch({
      flexible_meals: plan.flexible_meals.filter((m, i) => (id ? m.id !== id : i !== index)),
    });
  };

  const confirmStatus = (title: string, message: string, action: () => Promise<void>) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: title,
        style: title === "End Plan" ? "destructive" : "default",
        onPress: async () => {
          try {
            await action();
            await load();
          } catch {
            Alert.alert("Error", `Could not ${title.toLowerCase()}.`);
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

  if (!plan) {
    return (
      <View style={styles.container}>
        <View style={styles.empty}>
          <MaterialCommunityIcons name="food-apple-outline" size={36} color={colors.accentPrimary} />
          <Text style={styles.emptyTitle}>No nutrition plan</Text>
          <Text style={styles.emptyBody}>
            Answer a few questions about how you actually eat. We'll save regular foods and
            flexible meals so Today can guide you around them — not a new menu every day.
          </Text>
          <TouchableOpacity style={styles.primary} onPress={() => setCreateOpen(true)}>
            <Text style={styles.primaryText}>Create Nutrition Plan</Text>
          </TouchableOpacity>
          {onAskCoach ? (
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => onAskCoach("I want a nutrition plan that supports my training. ")}
            >
              <Text style={styles.secondaryText}>Design with Coach</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <CreateNutritionPlanModal
          visible={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            load();
          }}
        />
      </View>
    );
  }

  const range =
    plan.targets.calories_min && plan.targets.calories_max
      ? `${plan.targets.calories_min}–${plan.targets.calories_max} kcal`
      : null;

  const macroValues: Record<string, number | null | undefined> = {
    protein: plan.targets.protein,
    carbs: plan.targets.carbs,
    fats: plan.targets.fats,
    fiber: plan.targets.fiber,
  };

  const preferenceTags = [
    ...(plan.preferences?.likes || []),
    ...(plan.preferences?.dislikes || []).map((d) => `No ${d}`),
  ];
  if (plan.preferences?.dietary_restrictions) {
    preferenceTags.push(plan.preferences.dietary_restrictions);
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
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
        <View style={styles.statusRow}>
          <View style={[styles.badge, plan.status === "paused" ? styles.badgePaused : styles.badgeActive]}>
            <Text
              style={[
                styles.badgeText,
                { color: plan.status === "paused" ? "#F59E0B" : "#4ADE80" },
              ]}
            >
              {plan.status === "paused" ? "PAUSED" : "ACTIVE"}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setCreateOpen(true)}>
            <Text style={styles.link}>New plan</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>{goalLabel(plan.goal)}</Text>
        {plan.goal_detail ? <Text style={styles.subtitle}>{plan.goal_detail}</Text> : null}

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Daily target</Text>
            <TouchableOpacity onPress={() => (editingTargets ? saveTargets() : setEditingTargets(true))}>
              <Text style={styles.link}>{editingTargets ? "Save" : "Edit"}</Text>
            </TouchableOpacity>
          </View>

          {editingTargets ? (
            <View style={styles.editGrid}>
              {[
                ["Calories", cal, setCal],
                ["Protein", protein, setProtein],
                ["Carbs", carbs, setCarbs],
                ["Fat", fats, setFats],
                ["Fiber", fiber, setFiber],
              ].map(([label, val, set]) => (
                <View key={label as string} style={styles.editField}>
                  <Text style={styles.label}>{label as string}</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={val as string}
                    onChangeText={set as (v: string) => void}
                  />
                </View>
              ))}
            </View>
          ) : (
            <>
              <Text style={styles.kcalValue}>
                {plan.targets.calories?.toLocaleString() ?? "—"} kcal
              </Text>
              {range ? <Text style={styles.kcalRange}>{range}</Text> : null}

              <View style={styles.macroRow}>
                {MACRO_TILES.map((tile) => {
                  const value = macroValues[tile.key];
                  return (
                    <View key={tile.key} style={styles.macroTile}>
                      <MaterialCommunityIcons name={tile.icon} size={16} color={tile.color} />
                      <Text style={styles.macroValue}>
                        {value ?? "—"}
                        {value != null ? tile.unit : ""}
                      </Text>
                      <Text style={styles.macroLabel}>{tile.label}</Text>
                      <View style={styles.macroBarTrack}>
                        <View style={[styles.macroBarFill, { backgroundColor: tile.color }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </View>

        <Text style={styles.sectionLabel}>MEAL STRUCTURE</Text>

        <View style={styles.sectionBlock}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Meal Anchors</Text>
            <TouchableOpacity onPress={openNewAnchor}>
              <Text style={styles.addLink}>+ Add anchor</Text>
            </TouchableOpacity>
          </View>

          {(plan.meal_anchors || []).map((anchor, i) => {
            const macros = sumAnchorMacros(anchor.foods || []);
            const hasMacros =
              macros.calories > 0 || macros.protein > 0 || macros.carbs > 0 || macros.fats > 0;
            return (
              <TouchableOpacity
                key={anchor.id || `${anchor.label}-${i}`}
                style={styles.listCard}
                onPress={() => openEditAnchor(anchor, i)}
                onLongPress={() => removeAnchor(anchor.id, i)}
                activeOpacity={0.7}
              >
                <View style={styles.slotIconWrap}>
                  <MaterialCommunityIcons
                    name={slotIcon(anchor.slot)}
                    size={20}
                    color={colors.accentPrimary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>{anchor.label}</Text>
                  <Text style={styles.listMeta}>{frequencyLabel(anchor.frequency)}</Text>
                  <Text style={styles.listBody}>
                    {(anchor.foods || []).map((f) => f.name).join(", ") || "No foods listed"}
                  </Text>
                  {hasMacros ? (
                    <View style={styles.pillRow}>
                      <View style={styles.pill}>
                        <Text style={styles.pillText}>{Math.round(macros.calories)} kcal</Text>
                      </View>
                      <View style={styles.pill}>
                        <Text style={styles.pillText}>{Math.round(macros.protein)}g protein</Text>
                      </View>
                      <View style={styles.pill}>
                        <Text style={styles.pillText}>{Math.round(macros.carbs)}g carbs</Text>
                      </View>
                      <View style={styles.pill}>
                        <Text style={styles.pillText}>{Math.round(macros.fats)}g fat</Text>
                      </View>
                    </View>
                  ) : null}
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            );
          })}

          {!plan.meal_anchors?.length ? (
            <Text style={styles.emptyHint}>No regular foods saved yet. Tap + Add anchor to log macros.</Text>
          ) : null}
        </View>

        <View style={styles.sectionBlock}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Flexible Meals</Text>
            <TouchableOpacity onPress={() => setAddingFlex((v) => !v)}>
              <Text style={styles.addLink}>{addingFlex ? "Cancel" : "+ Add meal"}</Text>
            </TouchableOpacity>
          </View>

          {(plan.flexible_meals || []).map((meal, i) => (
            <TouchableOpacity
              key={meal.id || `${meal.name}-${i}`}
              style={styles.listCard}
              onLongPress={() => removeFlex(meal.id, i)}
              activeOpacity={0.7}
            >
              <View style={styles.slotIconWrap}>
                <MaterialCommunityIcons
                  name="silverware-fork-knife"
                  size={20}
                  color={colors.accentPrimary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{meal.name}</Text>
                <Text style={styles.listMeta}>{frequencyLabel(meal.frequency)}</Text>
                <Text style={styles.listBody}>
                  {meal.calorie_min || "?"}–{meal.calorie_max || "?"} kcal
                  {meal.protein_min || meal.protein_max
                    ? ` · ${meal.protein_min || "?"}–${meal.protein_max || "?"}g protein`
                    : ""}
                </Text>
                <View style={styles.flexBadge}>
                  <Text style={styles.flexBadgeText}>
                    {meal.user_controls_food ? "You mostly control this" : "Flexible / not fully controlled"}
                  </Text>
                </View>
                {meal.notes ? <Text style={styles.listNote}>{meal.notes}</Text> : null}
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ))}

          {addingFlex ? (
            <View style={styles.inlineForm}>
              <TextInput
                style={styles.input}
                value={newFlex.name}
                onChangeText={(v) => setNewFlex((d) => ({ ...d, name: v }))}
                placeholder="Dinner"
                placeholderTextColor={colors.textMuted}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  keyboardType="numeric"
                  value={String(newFlex.calorie_min ?? "")}
                  onChangeText={(v) => setNewFlex((d) => ({ ...d, calorie_min: Number(v) || null }))}
                  placeholder="Cal min"
                  placeholderTextColor={colors.textMuted}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  keyboardType="numeric"
                  value={String(newFlex.calorie_max ?? "")}
                  onChangeText={(v) => setNewFlex((d) => ({ ...d, calorie_max: Number(v) || null }))}
                  placeholder="Cal max"
                  placeholderTextColor={colors.textMuted}
                />
              </View>
              <TouchableOpacity style={styles.smallPrimary} onPress={addFlexMeal}>
                <Text style={styles.primaryText}>Save meal</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {(plan.food_priorities?.length || preferenceTags.length || plan.preferences) ? (
          <>
            <Text style={styles.sectionLabel}>GUIDANCE</Text>

            {plan.food_priorities?.length ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Food priorities</Text>
                {plan.food_priorities.map((priority, i) => (
                  <View key={i} style={styles.priorityRow}>
                    <MaterialCommunityIcons name="check" size={16} color={colors.accentPrimary} />
                    <Text style={styles.priorityText}>{priority}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {plan.preferences ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Preferences</Text>
                <Text style={styles.prefStyle}>
                  {plan.preferences.guidance_style === "strict" ? "Stricter targets" : "Flexible guidance"}
                </Text>
                {preferenceTags.length ? (
                  <View style={styles.tagRow}>
                    {preferenceTags.map((tag) => (
                      <View key={tag} style={styles.tag}>
                        <Text style={styles.tagText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}

        {onAskCoach ? (
          <TouchableOpacity
            style={styles.coachBtn}
            onPress={() =>
              onAskCoach(`I want to adjust my nutrition plan (${goalLabel(plan.goal)}). `)
            }
          >
            <MaterialCommunityIcons name="chat-processing-outline" size={18} color={colors.accentPrimary} />
            <Text style={styles.coachBtnText}>Adjust with Coach</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.footerActions}>
          {plan.status === "paused" ? (
            <TouchableOpacity
              onPress={() =>
                confirmStatus("Resume Plan", "Use this plan for Today guidance again?", () =>
                  resumeNutritionPlan(plan.id)
                )
              }
            >
              <Text style={styles.footerLink}>Resume plan</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() =>
                confirmStatus("Pause Plan", "Today will stop using this plan until you resume.", () =>
                  pauseNutritionPlan(plan.id)
                )
              }
            >
              <Text style={styles.footerLink}>Pause plan</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.footerDivider}>|</Text>
          <TouchableOpacity
            onPress={() =>
              confirmStatus("End Plan", "This plan will no longer drive Today guidance.", () =>
                endNutritionPlan(plan.id)
              )
            }
          >
            <Text style={[styles.footerLink, styles.footerDanger]}>End plan</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <CreateNutritionPlanModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />

      <EditMealAnchorModal
        visible={anchorEditorOpen}
        anchor={editingAnchor}
        onClose={() => {
          setAnchorEditorOpen(false);
          setEditingAnchor(null);
          setEditingAnchorIndex(null);
        }}
        onSave={saveAnchor}
        onDelete={
          editingAnchorIndex != null
            ? () => removeAnchor(editingAnchor?.id, editingAnchorIndex)
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
  empty: {
    margin: spacing.lg,
    backgroundColor: "#1C1C1E",
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    borderWidth: 1.5,
    borderColor: colors.accentPrimary,
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary, marginTop: spacing.sm },
  emptyBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeActive: { backgroundColor: "rgba(74,222,128,0.15)" },
  badgePaused: { backgroundColor: "rgba(245,158,11,0.15)" },
  badgeText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  title: { fontSize: 28, fontWeight: "700", color: colors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
  link: { color: colors.accentPrimary, fontWeight: "700", fontSize: 14 },
  addLink: { color: colors.accentPrimary, fontWeight: "700", fontSize: 13 },
  card: {
    backgroundColor: "#1C1C1E",
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  cardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  kcalValue: { fontSize: 32, fontWeight: "700", color: colors.textPrimary, marginTop: 2 },
  kcalRange: { fontSize: 13, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  macroRow: { flexDirection: "row", gap: 8, marginTop: spacing.sm },
  macroTile: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  macroValue: { fontSize: 15, fontWeight: "700", color: colors.textPrimary, marginTop: 2 },
  macroLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  macroBarTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: "#2A2D35",
    marginTop: 4,
    overflow: "hidden",
  },
  macroBarFill: { height: "100%", width: "70%", borderRadius: 2 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textMuted,
    letterSpacing: 0.8,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionBlock: { marginBottom: spacing.md, gap: 8 },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  listCard: {
    backgroundColor: "#1C1C1E",
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  slotIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(255,107,53,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  listTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  listMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  listBody: { fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
  listNote: { fontSize: 12, color: colors.textMuted, marginTop: 6, lineHeight: 16 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  pill: {
    backgroundColor: colors.background,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillText: { fontSize: 12, color: colors.textSecondary, fontWeight: "600" },
  flexBadge: {
    alignSelf: "flex-start",
    marginTop: 8,
    backgroundColor: "rgba(255,107,53,0.12)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  flexBadgeText: { fontSize: 11, fontWeight: "600", color: colors.accentPrimary },
  priorityRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 10 },
  priorityText: { flex: 1, fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  prefStyle: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: 8 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: {
    backgroundColor: colors.background,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: { fontSize: 13, color: colors.textPrimary, fontWeight: "600" },
  coachBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,107,53,0.45)",
  },
  coachBtnText: { color: colors.accentPrimary, fontWeight: "700", fontSize: 14 },
  footerActions: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  footerLink: { color: colors.accentPrimary, fontWeight: "700", fontSize: 14 },
  footerDanger: { color: colors.danger },
  footerDivider: { color: colors.textMuted, fontSize: 14 },
  editGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  editField: { width: "47%" },
  label: { fontSize: 11, fontWeight: "700", color: colors.textMuted, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    color: colors.textPrimary,
    padding: spacing.sm,
    backgroundColor: colors.background,
  },
  inlineForm: { gap: 8, marginTop: 4 },
  emptyHint: { fontSize: 13, color: colors.textMuted, paddingVertical: 8 },
  primary: {
    backgroundColor: colors.accentPrimary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  smallPrimary: {
    backgroundColor: colors.accentPrimary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700" },
  secondary: {
    marginTop: spacing.sm,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.accentPrimary,
  },
  secondaryText: { color: colors.accentPrimary, fontWeight: "700" },
});
