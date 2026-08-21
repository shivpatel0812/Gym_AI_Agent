import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  FlexibleMeal,
  FREQUENCY_OPTIONS,
  GOAL_OPTIONS,
  MealAnchor,
  NutritionGoal,
  NutritionPlan,
  SLOT_OPTIONS,
  activateNutritionPlan,
  deleteNutritionPlan,
  frequencyLabel,
  goalLabel,
  proposeNutritionPlan,
} from "../../../api/nutritionPlan";
import { colors, spacing, borderRadius } from "../../../theme";
import {
  AI_MODEL_OPTIONS,
  AI_MODEL_STORAGE_KEY,
  AiModelId,
  DEFAULT_AI_MODEL,
  normalizeAiModel,
} from "../../../lib/aiModels";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** When set, generate from the nutrition interview instead of the wizard. */
  conversationId?: string | null;
  /** Model for propose; defaults to stored preference / GPT-4o. */
  model?: string | null;
}

type Step = "goal" | "habits" | "flexible" | "prefs" | "generating" | "review";

const emptyAnchor = (): MealAnchor => ({
  slot: "breakfast",
  label: "",
  foods: [],
  frequency: "daily",
});

const emptyFlex = (): FlexibleMeal => ({
  name: "Dinner",
  frequency: "most_days",
  calorie_min: 650,
  calorie_max: 900,
  protein_min: 25,
  protein_max: 40,
  user_controls_food: false,
  notes: "",
});

export default function CreateNutritionPlanModal({
  visible,
  onClose,
  onCreated,
  conversationId,
  model: modelProp,
}: Props) {
  const [step, setStep] = useState<Step>("goal");
  const [goal, setGoal] = useState<NutritionGoal>("maintain");
  const [goalNotes, setGoalNotes] = useState("");
  const [typicalDay, setTypicalDay] = useState("");
  const [anchors, setAnchors] = useState<MealAnchor[]>([]);
  const [anchorDraft, setAnchorDraft] = useState(emptyAnchor());
  const [anchorFoodsText, setAnchorFoodsText] = useState("");
  const [flexible, setFlexible] = useState<FlexibleMeal[]>([]);
  const [flexDraft, setFlexDraft] = useState(emptyFlex());
  const [likes, setLikes] = useState("");
  const [dislikes, setDislikes] = useState("");
  const [restrictions, setRestrictions] = useState("");
  const [onHand, setOnHand] = useState("");
  const [mealCount, setMealCount] = useState("3");
  const [largerDinner, setLargerDinner] = useState(true);
  const [style, setStyle] = useState<"flexible" | "strict">("flexible");
  const [draft, setDraft] = useState<NutritionPlan | null>(null);
  const [aiModel, setAiModel] = useState<AiModelId>(DEFAULT_AI_MODEL);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (modelProp) {
      setAiModel(normalizeAiModel(modelProp));
      return;
    }
    AsyncStorage.getItem(AI_MODEL_STORAGE_KEY)
      .then((raw) => {
        if (raw) setAiModel(normalizeAiModel(raw));
      })
      .catch(() => {});
  }, [modelProp, visible]);

  const selectAiModel = (model: AiModelId) => {
    setAiModel(model);
    AsyncStorage.setItem(AI_MODEL_STORAGE_KEY, model).catch(() => {});
  };

  useEffect(() => {
    if (!visible) return;
    setStep(conversationId ? "generating" : "goal");
    setDraft(null);
    setGoal("maintain");
    setGoalNotes("");
    setTypicalDay("");
    setAnchors([]);
    setAnchorDraft(emptyAnchor());
    setAnchorFoodsText("");
    setFlexible([]);
    setFlexDraft(emptyFlex());
    setLikes("");
    setDislikes("");
    setRestrictions("");
    setOnHand("");
    setMealCount("3");
    setLargerDinner(true);
    setStyle("flexible");
    if (!conversationId) return;

    let cancelled = false;
    (async () => {
      let model: AiModelId = modelProp
        ? normalizeAiModel(modelProp)
        : DEFAULT_AI_MODEL;
      if (!modelProp) {
        try {
          const raw = await AsyncStorage.getItem(AI_MODEL_STORAGE_KEY);
          if (raw) model = normalizeAiModel(raw);
        } catch {
          // keep default
        }
      }
      try {
        const plan = await proposeNutritionPlan({
          conversation_id: conversationId,
          model,
        });
        if (cancelled) return;
        setDraft(plan);
        setStep("review");
      } catch (error: any) {
        if (cancelled) return;
        setStep("goal");
        Alert.alert(
          "Could not create plan",
          error?.response?.data?.detail || "Something went wrong. Please try again."
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, conversationId, modelProp]);

  const addAnchor = () => {
    const foods = anchorFoodsText
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
    const label = anchorDraft.label.trim() || foods[0]?.name || slotLabel(anchorDraft.slot);
    if (!foods.length && !anchorDraft.label.trim()) {
      Alert.alert("Add a regular food", "Name the meal or list foods you eat often, like Greek yogurt, oatmeal.");
      return;
    }
    setAnchors((prev) => [
      ...prev,
      { ...anchorDraft, label, foods: foods.length ? foods : [{ name: label }] },
    ]);
    setAnchorDraft(emptyAnchor());
    setAnchorFoodsText("");
  };

  const addFlexible = () => {
    if (!flexDraft.name.trim()) {
      Alert.alert("Name the meal", "e.g. Dinner");
      return;
    }
    setFlexible((prev) => [...prev, { ...flexDraft, name: flexDraft.name.trim() }]);
    setFlexDraft(emptyFlex());
  };

  const generate = async () => {
    setStep("generating");
    try {
      const plan = await proposeNutritionPlan({
        goal,
        goal_notes: goalNotes.trim() || undefined,
        typical_day: typicalDay.trim() || undefined,
        meal_anchors: anchors,
        flexible_meals: flexible,
        conversation_id: conversationId || undefined,
        model: aiModel,
        preferences: {
          likes: splitList(likes),
          dislikes: splitList(dislikes),
          dietary_restrictions: restrictions.trim() || undefined,
          foods_on_hand: splitList(onHand),
          preferred_meal_count: Number(mealCount) || undefined,
          larger_dinner: largerDinner,
          guidance_style: style,
        },
      });
      setDraft(plan);
      setStep("review");
    } catch (error: any) {
      setStep("prefs");
      Alert.alert(
        "Could not create plan",
        error?.response?.data?.detail || "Something went wrong. Please try again."
      );
    }
  };

  const confirm = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await activateNutritionPlan(draft.id);
      onCreated();
    } catch (error) {
      Alert.alert("Error", "Could not activate the plan.");
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (draft) {
      try {
        await deleteNutritionPlan(draft.id);
      } catch {
        // Draft leftover is harmless
      }
    }
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {step === "review" ? "Review Nutrition Plan" : "Create Nutrition Plan"}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {step === "generating" ? (
            <View style={styles.generating}>
              <ActivityIndicator size="large" color={colors.accentPrimary} />
              <Text style={styles.generatingText}>Building your nutrition strategy...</Text>
              <Text style={styles.hint}>Using how you actually eat, not a generic meal plan</Text>
            </View>
          ) : step === "review" && draft ? (
            <>
              <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
                <Text style={styles.planName}>{goalLabel(draft.goal)}</Text>
                {draft.goal_detail ? <Text style={styles.bodyText}>{draft.goal_detail}</Text> : null}
                <Text style={styles.meta}>
                  {draft.targets.calories} kcal · {draft.targets.protein}g protein
                  {draft.targets.calories_min && draft.targets.calories_max
                    ? ` · range ${draft.targets.calories_min}–${draft.targets.calories_max}`
                    : ""}
                </Text>
                {draft.strategy ? (
                  <>
                    <Text style={styles.sub}>Daily strategy</Text>
                    <Text style={styles.bodyText}>{draft.strategy}</Text>
                  </>
                ) : null}
                {draft.meal_anchors?.length ? (
                  <>
                    <Text style={styles.sub}>Meal anchors</Text>
                    {draft.meal_anchors.map((a) => (
                      <Text key={a.id || a.label} style={styles.bullet}>
                        {a.label} · {frequencyLabel(a.frequency)}
                        {a.foods?.length ? ` — ${a.foods.map((f) => f.name).join(", ")}` : ""}
                      </Text>
                    ))}
                  </>
                ) : null}
                {draft.flexible_meals?.length ? (
                  <>
                    <Text style={styles.sub}>Flexible meals</Text>
                    {draft.flexible_meals.map((m) => (
                      <Text key={m.id || m.name} style={styles.bullet}>
                        {m.name} · {frequencyLabel(m.frequency)}
                        {m.calorie_min || m.calorie_max
                          ? ` · ${m.calorie_min || "?"}–${m.calorie_max || "?"} kcal`
                          : ""}
                      </Text>
                    ))}
                  </>
                ) : null}
                {draft.food_priorities?.length ? (
                  <>
                    <Text style={styles.sub}>Food priorities</Text>
                    {draft.food_priorities.map((p, i) => (
                      <Text key={i} style={styles.bullet}>
                        {p}
                      </Text>
                    ))}
                  </>
                ) : null}
              </ScrollView>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.secondary} onPress={discard} disabled={busy}>
                  <Text style={styles.secondaryText}>Discard</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primary} onPress={confirm} disabled={busy}>
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryText}>Use This Plan</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
                {step === "goal" ? (
                  <>
                    <Text style={styles.sub}>What's the goal?</Text>
                    {GOAL_OPTIONS.map((option) => (
                      <TouchableOpacity
                        key={option.id}
                        style={[styles.choice, goal === option.id && styles.choiceOn]}
                        onPress={() => setGoal(option.id)}
                      >
                        <Text style={[styles.choiceText, goal === option.id && styles.choiceTextOn]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    <Text style={styles.sub}>Anything specific? (optional)</Text>
                    <TextInput
                      style={styles.input}
                      value={goalNotes}
                      onChangeText={setGoalNotes}
                      placeholder="e.g. Build muscle while limiting extra fat gain"
                      placeholderTextColor={colors.textMuted}
                      multiline
                    />
                    <Text style={styles.sub}>AI model</Text>
                    <View style={styles.modelRow}>
                      {AI_MODEL_OPTIONS.map((opt) => {
                        const active = aiModel === opt.id;
                        return (
                          <TouchableOpacity
                            key={opt.id}
                            style={[styles.modelChip, active && styles.modelChipOn]}
                            onPress={() => selectAiModel(opt.id)}
                          >
                            <Text style={[styles.modelChipText, active && styles.modelChipTextOn]}>
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                ) : null}

                {step === "habits" ? (
                  <>
                    <Text style={styles.sub}>What does a typical day look like?</Text>
                    <Text style={styles.hint}>
                      We'll remember this so you don't have to re-explain breakfast every day.
                    </Text>
                    <TextInput
                      style={[styles.input, { minHeight: 90 }]}
                      value={typicalDay}
                      onChangeText={setTypicalDay}
                      placeholder="I usually eat Greek yogurt and oatmeal every morning, and a protein shake sometime during the day."
                      placeholderTextColor={colors.textMuted}
                      multiline
                    />
                    <Text style={styles.sub}>Meal anchors — foods you eat often</Text>
                    {anchors.map((a, i) => (
                      <View key={`${a.label}-${i}`} style={styles.chipRow}>
                        <Text style={styles.chipText}>
                          {a.label}: {a.foods.map((f) => f.name).join(", ")}
                        </Text>
                        <TouchableOpacity onPress={() => setAnchors((prev) => prev.filter((_, idx) => idx !== i))}>
                          <MaterialCommunityIcons name="close" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <View style={styles.slotRow}>
                      {SLOT_OPTIONS.map((s) => (
                        <TouchableOpacity
                          key={s.id}
                          style={[styles.miniChip, anchorDraft.slot === s.id && styles.miniChipOn]}
                          onPress={() => setAnchorDraft((d) => ({ ...d, slot: s.id, label: d.label || s.label }))}
                        >
                          <Text style={[styles.miniChipText, anchorDraft.slot === s.id && styles.miniChipTextOn]}>
                            {s.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput
                      style={styles.input}
                      value={anchorFoodsText}
                      onChangeText={setAnchorFoodsText}
                      placeholder="Greek yogurt, oatmeal, berries"
                      placeholderTextColor={colors.textMuted}
                    />
                    <TouchableOpacity style={styles.addBtn} onPress={addAnchor}>
                      <Text style={styles.addBtnText}>Add regular food</Text>
                    </TouchableOpacity>
                  </>
                ) : null}

                {step === "flexible" ? (
                  <>
                    <Text style={styles.sub}>Meals you don't fully control</Text>
                    <Text style={styles.hint}>
                      Family dinner, work lunches, etc. Rough ranges are enough — we'll plan the rest of the day around them.
                    </Text>
                    {flexible.map((m, i) => (
                      <View key={`${m.name}-${i}`} style={styles.chipRow}>
                        <Text style={styles.chipText}>
                          {m.name} · {m.calorie_min || "?"}–{m.calorie_max || "?"} kcal
                        </Text>
                        <TouchableOpacity onPress={() => setFlexible((prev) => prev.filter((_, idx) => idx !== i))}>
                          <MaterialCommunityIcons name="close" size={16} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TextInput
                      style={styles.input}
                      value={flexDraft.name}
                      onChangeText={(v) => setFlexDraft((d) => ({ ...d, name: v }))}
                      placeholder="Dinner"
                      placeholderTextColor={colors.textMuted}
                    />
                    <View style={styles.row2}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.label}>Cal min</Text>
                        <TextInput
                          style={styles.input}
                          keyboardType="numeric"
                          value={String(flexDraft.calorie_min ?? "")}
                          onChangeText={(v) => setFlexDraft((d) => ({ ...d, calorie_min: Number(v) || null }))}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.label}>Cal max</Text>
                        <TextInput
                          style={styles.input}
                          keyboardType="numeric"
                          value={String(flexDraft.calorie_max ?? "")}
                          onChangeText={(v) => setFlexDraft((d) => ({ ...d, calorie_max: Number(v) || null }))}
                        />
                      </View>
                    </View>
                    <View style={styles.row2}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.label}>Protein min</Text>
                        <TextInput
                          style={styles.input}
                          keyboardType="numeric"
                          value={String(flexDraft.protein_min ?? "")}
                          onChangeText={(v) => setFlexDraft((d) => ({ ...d, protein_min: Number(v) || null }))}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.label}>Protein max</Text>
                        <TextInput
                          style={styles.input}
                          keyboardType="numeric"
                          value={String(flexDraft.protein_max ?? "")}
                          onChangeText={(v) => setFlexDraft((d) => ({ ...d, protein_max: Number(v) || null }))}
                        />
                      </View>
                    </View>
                    <TextInput
                      style={styles.input}
                      value={flexDraft.notes || ""}
                      onChangeText={(v) => setFlexDraft((d) => ({ ...d, notes: v }))}
                      placeholder="I eat whatever my family is having"
                      placeholderTextColor={colors.textMuted}
                    />
                    <View style={styles.slotRow}>
                      {FREQUENCY_OPTIONS.map((f) => (
                        <TouchableOpacity
                          key={f.id}
                          style={[styles.miniChip, flexDraft.frequency === f.id && styles.miniChipOn]}
                          onPress={() => setFlexDraft((d) => ({ ...d, frequency: f.id }))}
                        >
                          <Text style={[styles.miniChipText, flexDraft.frequency === f.id && styles.miniChipTextOn]}>
                            {f.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TouchableOpacity style={styles.addBtn} onPress={addFlexible}>
                      <Text style={styles.addBtnText}>Add flexible meal</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setStep("prefs")} style={{ marginTop: spacing.md }}>
                      <Text style={styles.skip}>Skip — I control most meals</Text>
                    </TouchableOpacity>
                  </>
                ) : null}

                {step === "prefs" ? (
                  <>
                    <Text style={styles.sub}>Preferences that actually matter</Text>
                    <TextInput
                      style={styles.input}
                      value={likes}
                      onChangeText={setLikes}
                      placeholder="Foods you like (comma separated)"
                      placeholderTextColor={colors.textMuted}
                    />
                    <TextInput
                      style={styles.input}
                      value={dislikes}
                      onChangeText={setDislikes}
                      placeholder="Foods you dislike"
                      placeholderTextColor={colors.textMuted}
                    />
                    <TextInput
                      style={styles.input}
                      value={restrictions}
                      onChangeText={setRestrictions}
                      placeholder="Vegetarian, dairy-free, etc. (optional)"
                      placeholderTextColor={colors.textMuted}
                    />
                    <TextInput
                      style={styles.input}
                      value={onHand}
                      onChangeText={setOnHand}
                      placeholder="Foods you usually have around"
                      placeholderTextColor={colors.textMuted}
                    />
                    <Text style={styles.label}>Meals you prefer per day</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="numeric"
                      value={mealCount}
                      onChangeText={setMealCount}
                    />
                    <TouchableOpacity
                      style={[styles.choice, largerDinner && styles.choiceOn]}
                      onPress={() => setLargerDinner((v) => !v)}
                    >
                      <Text style={[styles.choiceText, largerDinner && styles.choiceTextOn]}>
                        I prefer a larger dinner
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.row2}>
                      {(["flexible", "strict"] as const).map((s) => (
                        <TouchableOpacity
                          key={s}
                          style={[styles.choice, { flex: 1 }, style === s && styles.choiceOn]}
                          onPress={() => setStyle(s)}
                        >
                          <Text style={[styles.choiceText, style === s && styles.choiceTextOn]}>
                            {s === "flexible" ? "Flexible guidance" : "Stricter targets"}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}
              </ScrollView>

              <View style={styles.actions}>
                {step !== "goal" ? (
                  <TouchableOpacity
                    style={styles.secondary}
                    onPress={() =>
                      setStep(step === "habits" ? "goal" : step === "flexible" ? "habits" : "flexible")
                    }
                  >
                    <Text style={styles.secondaryText}>Back</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.secondary} onPress={onClose}>
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.primary}
                  onPress={() => {
                    if (step === "goal") setStep("habits");
                    else if (step === "habits") setStep("flexible");
                    else if (step === "flexible") setStep("prefs");
                    else generate();
                  }}
                >
                  <Text style={styles.primaryText}>{step === "prefs" ? "Generate Plan" : "Next"}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function splitList(value: string) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function slotLabel(slot: string) {
  return SLOT_OPTIONS.find((s) => s.id === slot)?.label || slot;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: "94%",
    minHeight: "70%",
    paddingBottom: spacing.lg,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: 20, fontWeight: "700", color: colors.textPrimary, flex: 1, paddingRight: 12 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: spacing.lg, paddingBottom: spacing["2xl"], gap: spacing.sm },
  generating: { padding: spacing["3xl"], alignItems: "center", gap: spacing.md },
  generatingText: { color: colors.textPrimary, fontSize: 16, fontWeight: "600" },
  sub: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    marginTop: spacing.md,
    letterSpacing: 0.3,
  },
  hint: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  bodyText: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  planName: { fontSize: 24, fontWeight: "700", color: colors.textPrimary },
  meta: { fontSize: 13, color: colors.accentPrimary, fontWeight: "600", marginTop: 4 },
  bullet: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  label: { fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.cardBackground,
    color: colors.textPrimary,
    padding: spacing.md,
    fontSize: 14,
    marginTop: spacing.xs,
  },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    marginTop: spacing.xs,
  },
  choiceOn: { borderColor: colors.accentPrimary },
  choiceText: { color: colors.textSecondary, fontWeight: "600" },
  choiceTextOn: { color: colors.textPrimary },
  modelRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  modelChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  modelChipOn: {
    borderColor: colors.accentPrimary,
    backgroundColor: "rgba(255,107,53,0.18)",
  },
  modelChipText: { color: colors.textSecondary, fontWeight: "700", fontSize: 13 },
  modelChipTextOn: { color: colors.accentPrimary },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1C1C1E",
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  chipText: { color: colors.textPrimary, flex: 1, paddingRight: 8 },
  slotRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: spacing.sm },
  miniChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  miniChipOn: { borderColor: colors.accentPrimary, backgroundColor: "rgba(255,107,53,0.12)" },
  miniChipText: { fontSize: 12, color: colors.textSecondary, fontWeight: "600" },
  miniChipTextOn: { color: colors.accentPrimary },
  addBtn: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.accentPrimary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  addBtnText: { color: colors.accentPrimary, fontWeight: "700" },
  skip: { color: colors.textMuted, textAlign: "center" },
  row2: { flexDirection: "row", gap: spacing.sm },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  secondary: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  secondaryText: { color: colors.textSecondary, fontWeight: "600" },
  primary: {
    flex: 1.3,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "700" },
});
