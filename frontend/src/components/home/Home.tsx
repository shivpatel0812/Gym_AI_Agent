import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Alert,
} from "react-native";
import Slider from "@react-native-community/slider";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import apiClient from "../../api/client";
import { colors, spacing } from "../../theme";
import { todayKey } from "../wellness/types";
import { LevelSlider } from "../wellness/ui";
import LogFoodForm from "../nutrition/LogFoodForm";
import { FoodItem } from "../nutrition/types";
import { TodaysWorkout } from "../workouts/types";
import { EMPTY_USUALS, getUsuals, toggleUsual } from "../../api/nutritionPlan";
import type { Usual, UsualsPayload } from "../../api/nutritionPlan";

type SheetKind = "sleep" | "stress" | "wellness" | "food" | "routine" | null;

type Routine = {
  id?: string;
  name: string;
  description?: string;
  icon?: string;
  sort_order?: number;
  completed_dates?: string[];
};

const ROUTINE_ICONS: { name: keyof typeof MaterialCommunityIcons.glyphMap; label: string }[] = [
  { name: "book-open-page-variant", label: "Study" },
  { name: "dog", label: "Dog" },
  { name: "briefcase-outline", label: "Work" },
  { name: "car-outline", label: "Commute" },
  { name: "walk", label: "Walk" },
  { name: "run", label: "Run" },
  { name: "bike", label: "Bike" },
  { name: "dumbbell", label: "Gym" },
  { name: "food-apple-outline", label: "Meal" },
  { name: "cup-water", label: "Water" },
  { name: "laptop", label: "Desk" },
  { name: "home-outline", label: "Home" },
  { name: "heart-outline", label: "Health" },
  { name: "phone-outline", label: "Call" },
  { name: "music", label: "Music" },
  { name: "sleep", label: "Rest" },
];

const SLOT_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  breakfast: "coffee-outline",
  shake: "cup",
  pre_workout: "dumbbell",
  lunch: "food-fork-drink",
  snack: "food-apple-outline",
  dinner: "silverware-fork-knife",
  late_night: "weather-night",
  other: "food",
};

/** Flip a usual locally so the tap lands before the round trip does. */
function flipUsual(payload: UsualsPayload, id: string): UsualsPayload {
  const apply = (u: Usual) => (u.id === id ? { ...u, logged: !u.logged, can_undo: !u.logged } : u);
  const usuals = payload.usuals.map(apply);
  return {
    ...payload,
    usuals,
    slots: payload.slots.map((slot) => ({ ...slot, usuals: slot.usuals.map(apply) })),
    logged_count: usuals.filter((u) => u.expected && u.logged).length,
  };
}

function remainingLine(remaining?: { calories: number | null; protein: number | null } | null) {
  if (!remaining) return null;
  const parts: string[] = [];
  if (remaining.calories != null) {
    const cal = Math.round(remaining.calories);
    parts.push(cal < 0 ? `${Math.abs(cal).toLocaleString()} cal over` : `${cal.toLocaleString()} cal left`);
  }
  if (remaining.protein != null && remaining.protein > 0) {
    parts.push(`${Math.round(remaining.protein)}g protein to go`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function todayEntry<T extends { date?: string }>(rows: T[]): T | undefined {
  const key = todayKey();
  return rows.find((row) => String(row.date || "").slice(0, 10) === key);
}

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{title}</Text>
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export default function Home() {
  const navigation = useNavigation<any>();
  const date = todayKey();
  const [sleepHours, setSleepHours] = useState<number | null>(null);
  const [sleepQuality, setSleepQuality] = useState<number | null>(null);
  const [sleepId, setSleepId] = useState<string | null>(null);
  const [stressLevel, setStressLevel] = useState<number | null>(null);
  const [stressId, setStressId] = useState<string | null>(null);
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [surveyLogged, setSurveyLogged] = useState(false);
  const [bodyId, setBodyId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [steps, setSteps] = useState(0);
  const [activeCal, setActiveCal] = useState(0);
  const [todayWorkout, setTodayWorkout] = useState<TodaysWorkout | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [usuals, setUsuals] = useState<UsualsPayload>(EMPTY_USUALS);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [saving, setSaving] = useState(false);

  const [draftSleep, setDraftSleep] = useState(7.5);
  const [draftStress, setDraftStress] = useState(5);
  const [draftStressNote, setDraftStressNote] = useState("");
  const [draftFatigue, setDraftFatigue] = useState(5);
  const [draftAches, setDraftAches] = useState(5);
  const [draftEnergy, setDraftEnergy] = useState(5);
  const [draftMood, setDraftMood] = useState(5);
  const [draftSleepQuality, setDraftSleepQuality] = useState(5);

  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [routineName, setRoutineName] = useState("");
  const [routineDesc, setRoutineDesc] = useState("");
  const [routineIcon, setRoutineIcon] = useState<string>("briefcase-outline");

  const load = useCallback(async () => {
    try {
      const [sleepRes, stressRes, surveyRes, bodyRes, activityRes, routineRes, planRes, usualsRes] =
        await Promise.all([
          apiClient.get("/api/sleep"),
          apiClient.get("/api/stress"),
          apiClient.get("/api/wellness-survey"),
          apiClient.get("/api/body-feelings"),
          apiClient.get("/api/physical-activities"),
          apiClient.get("/api/daily-routines"),
          apiClient.get("/api/workout-plan/today").catch(() => ({ data: null })),
          getUsuals(date).catch(() => EMPTY_USUALS),
        ]);
      const sleep = todayEntry(Array.isArray(sleepRes.data) ? sleepRes.data : []);
      const stress = todayEntry(Array.isArray(stressRes.data) ? stressRes.data : []);
      const survey = todayEntry(Array.isArray(surveyRes.data) ? surveyRes.data : []);
      const body = todayEntry(Array.isArray(bodyRes.data) ? bodyRes.data : []);
      const activities = Array.isArray(activityRes.data) ? activityRes.data : [];
      const todayActs = activities.filter((a: any) => String(a.date || "").slice(0, 10) === date);
      const stepTotal = todayActs.reduce((sum: number, a: any) => sum + (Number(a.steps) || 0), 0);
      const minutes = todayActs.reduce((sum: number, a: any) => sum + (Number(a.duration_minutes) || 0), 0);
      setSleepHours(sleep?.hours_slept != null ? Number(sleep.hours_slept) : null);
      setSleepId(sleep?.id || null);
      setSleepQuality(sleep?.quality != null ? Number(sleep.quality) : null);
      setDraftSleepQuality(sleep?.quality != null ? Number(sleep.quality) : 5);
      setStressLevel(stress?.level != null ? Number(stress.level) : null);
      setStressId(stress?.id || null);
      setDraftStressNote(stress?.description || "");
      setSurveyId(survey?.id || null);
      setSurveyLogged(Boolean(survey?.id || body?.id));
      setBodyId(body?.id || null);
      setDraftBody(body?.description || "");
      if (survey) {
        setDraftFatigue(survey.fatigue ?? 5);
        setDraftAches(survey.body_aches ?? 5);
        setDraftEnergy(survey.energy ?? 5);
        setDraftMood(survey.mood ?? 5);
      }
      setSteps(stepTotal);
      setActiveCal(minutes > 0 ? Math.round(minutes * 5) : Math.round(stepTotal * 0.04));
      setRoutines(Array.isArray(routineRes.data) ? routineRes.data : []);
      setTodayWorkout(planRes.data || null);
      setUsuals(usualsRes);
    } catch (error) {
      console.error("Error loading home:", error);
    }
  }, [date]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openSleep = () => {
    setDraftSleep(sleepHours ?? 7.5);
    setDraftSleepQuality(sleepQuality ?? 5);
    setSheet("sleep");
  };
  const openStress = () => {
    setDraftStress(stressLevel ?? 5);
    setSheet("stress");
  };
  const openWellness = () => setSheet("wellness");
  const openFood = () => setSheet("food");
  const openNewRoutine = () => {
    setEditingRoutine(null);
    setRoutineName("");
    setRoutineDesc("");
    setRoutineIcon("briefcase-outline");
    setSheet("routine");
  };
  const openEditRoutine = (routine: Routine) => {
    setEditingRoutine(routine);
    setRoutineName(routine.name);
    setRoutineDesc(routine.description || "");
    setRoutineIcon(routine.icon || "briefcase-outline");
    setSheet("routine");
  };

  const saveSleep = async () => {
    setSaving(true);
    try {
      const payload = { date, hours_slept: draftSleep, quality: draftSleepQuality };
      if (sleepId) await apiClient.put(`/api/sleep/${sleepId}`, payload);
      else {
        const res = await apiClient.post("/api/sleep", payload);
        setSleepId(res.data?.id || null);
      }
      setSheet(null);
      await load();
    } catch (error) {
      console.error("Error saving sleep:", error);
    } finally {
      setSaving(false);
    }
  };

  const saveStress = async () => {
    setSaving(true);
    try {
      const payload = {
        date,
        level: draftStress,
        description: draftStressNote.trim() || undefined,
      };
      if (stressId) await apiClient.put(`/api/stress/${stressId}`, payload);
      else {
        const res = await apiClient.post("/api/stress", payload);
        setStressId(res.data?.id || null);
      }
      setSheet(null);
      await load();
    } catch (error) {
      console.error("Error saving stress:", error);
    } finally {
      setSaving(false);
    }
  };

  const saveWellness = async () => {
    setSaving(true);
    try {
      const payload = {
        date,
        fatigue: draftFatigue,
        body_aches: draftAches,
        energy: draftEnergy,
        mood: draftMood,
      };
      if (surveyId) await apiClient.put(`/api/wellness-survey/${surveyId}`, payload);
      else {
        const res = await apiClient.post("/api/wellness-survey", payload);
        setSurveyId(res.data?.id || null);
      }
      if (draftBody.trim()) {
        const bodyPayload = { date, description: draftBody.trim() };
        if (bodyId) await apiClient.put(`/api/body-feelings/${bodyId}`, bodyPayload);
        else {
          const res = await apiClient.post("/api/body-feelings", bodyPayload);
          setBodyId(res.data?.id || null);
        }
      }
      setSheet(null);
      await load();
    } catch (error) {
      console.error("Error saving wellness:", error);
    } finally {
      setSaving(false);
    }
  };

  const addFood = async (food: FoodItem) => {
    try {
      const res = await apiClient.get("/api/macros");
      const rows = Array.isArray(res.data) ? res.data : [];
      const existing = todayEntry(rows);
      if (existing?.id) {
        await apiClient.put(`/api/macros/${existing.id}`, {
          date,
          food_items: [...(existing.food_items || []), food],
        });
      } else {
        await apiClient.post("/api/macros", { date, food_items: [food] });
      }
      setSheet(null);
      await load();
    } catch (error) {
      console.error("Error logging food:", error);
    }
  };

  const onToggleUsual = async (usual: Usual) => {
    // Logged by hand rather than tapped: it is already on the day, and this
    // feature has nothing of its own to remove.
    if (usual.logged && !usual.can_undo) return;
    setUsuals((prev) => flipUsual(prev, usual.id));
    try {
      setUsuals(await toggleUsual(usual.id, date));
    } catch (error) {
      console.error("Error toggling usual:", error);
      setUsuals((prev) => flipUsual(prev, usual.id));
    }
  };

  const saveRoutine = async () => {
    if (!routineName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: routineName.trim(),
        description: routineDesc.trim() || undefined,
        icon: routineIcon,
        sort_order: editingRoutine?.sort_order ?? routines.length,
        completed_dates: editingRoutine?.completed_dates || [],
      };
      if (editingRoutine?.id) await apiClient.put(`/api/daily-routines/${editingRoutine.id}`, payload);
      else await apiClient.post("/api/daily-routines", payload);
      setSheet(null);
      await load();
    } catch (error) {
      console.error("Error saving routine:", error);
    } finally {
      setSaving(false);
    }
  };

  const toggleRoutine = async (routine: Routine) => {
    if (!routine.id) return;
    try {
      await apiClient.post(`/api/daily-routines/${routine.id}/toggle`, { date });
      await load();
    } catch (error) {
      console.error("Error toggling routine:", error);
    }
  };

  const deleteRoutine = () => {
    if (!editingRoutine?.id) return;
    Alert.alert("Delete routine?", editingRoutine.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiClient.delete(`/api/daily-routines/${editingRoutine.id}`);
            setSheet(null);
            await load();
          } catch (error) {
            console.error("Error deleting routine:", error);
          }
        },
      },
    ]);
  };

  const doneCount = routines.filter((r) => (r.completed_dates || []).includes(date)).length;
  const progress = routines.length ? doneCount / routines.length : 0;
  const wellnessCount = surveyLogged ? 3 : 0;
  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const showWorkout = todayWorkout?.status === "workout_day" && !todayWorkout.already_logged;
  const budgetLine = remainingLine(usuals.remaining);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.greeting}>{greetingForHour(now.getHours())}</Text>
        <Text style={styles.dateLine}>{dateLabel}</Text>
      </View>

      <Text style={styles.sectionLabel}>Quick log</Text>
      <View style={styles.quickRow}>
        <TouchableOpacity style={styles.halfCard} onPress={openSleep}>
          <MaterialCommunityIcons name="moon-waning-crescent" size={22} color="#A78BFA" />
          <Text style={styles.cardLabel}>Sleep</Text>
          {sleepHours != null ? (
            <>
              <Text style={styles.cardValue}>{sleepHours} hrs</Text>
              {sleepQuality != null ? (
                <Text style={styles.bodyPreview}>Quality {sleepQuality}/10</Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.tap}>Tap to log</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.halfCard} onPress={openStress}>
          <MaterialCommunityIcons name="head-outline" size={22} color="#E9D5FF" />
          <Text style={styles.cardLabel}>Stress</Text>
          {stressLevel != null ? (
            <Text style={styles.cardValue}>{stressLevel}/10</Text>
          ) : (
            <Text style={styles.tap}>Tap to log</Text>
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.wellnessCard} onPress={openWellness}>
        <View style={styles.wellnessIcon}>
          <MaterialCommunityIcons name="heart" size={20} color="#F9A8D4" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardLabel}>Wellness</Text>
          <Text style={styles.cardValue}>Mood, energy, soreness</Text>
          {draftBody.trim() ? (
            <Text style={styles.bodyPreview} numberOfLines={1}>
              {draftBody.trim()}
            </Text>
          ) : null}
        </View>
        <Text style={styles.tap}>{wellnessCount}/3 logged</Text>
      </TouchableOpacity>

      <View style={styles.routinesHead}>
        <Text style={styles.sectionLabel}>Your usuals</Text>
        {usuals.expected_count > 0 ? (
          <Text style={styles.frac}>
            {usuals.logged_count}/{usuals.expected_count}
          </Text>
        ) : null}
      </View>

      {usuals.has_usuals ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.usualScroll}>
          {usuals.slots.map((slot) => (
            <View key={slot.slot} style={styles.usualGroup}>
              <View style={styles.usualGroupHead}>
                {slot.is_current ? <View style={styles.nowDot} /> : null}
                <Text style={[styles.usualTime, slot.is_current && styles.usualTimeNow]}>
                  {/* slot.label covers a backend that predates time labels. */}
                  {slot.time_label || slot.label}
                </Text>
              </View>
              <View style={styles.usualGroupRow}>
                {slot.usuals.map((usual) => (
                  <TouchableOpacity
                    key={usual.id}
                    activeOpacity={0.85}
                    style={[styles.usualChip, usual.logged && styles.usualChipOn]}
                    onPress={() => onToggleUsual(usual)}
                  >
                    <View style={[styles.usualIcon, usual.logged && styles.usualIconOn]}>
                      <MaterialCommunityIcons
                        name={SLOT_ICONS[usual.slot] || "food"}
                        size={16}
                        color={usual.logged ? "#0B0C10" : "#8E8E93"}
                      />
                    </View>
                    {usual.logged ? (
                      <View style={styles.usualCheck}>
                        <MaterialCommunityIcons name="check" size={10} color="#0B0C10" />
                      </View>
                    ) : null}
                    <Text style={[styles.usualName, usual.logged && styles.usualNameOn]} numberOfLines={2}>
                      {usual.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        <TouchableOpacity style={styles.emptyRoutines} onPress={() => navigation.navigate("Nutrition")}>
          <Text style={styles.emptyText}>
            Foods you log often show up here to tap — add your usual meals in your nutrition plan.
          </Text>
        </TouchableOpacity>
      )}

      {budgetLine ? <Text style={styles.remainingLine}>{budgetLine}</Text> : null}

      <TouchableOpacity style={styles.foodBtn} onPress={openFood}>
        <MaterialCommunityIcons name="food-apple" size={20} color="#4ADE80" />
        <Text style={styles.foodBtnText}>Log food</Text>
      </TouchableOpacity>

      <View style={styles.routinesHead}>
        <Text style={styles.sectionLabel}>Routines</Text>
        <View style={styles.routinesHeadRight}>
          <Text style={styles.frac}>
            {doneCount}/{routines.length || 0}
          </Text>
          <TouchableOpacity style={styles.plusBtn} onPress={openNewRoutine}>
            <MaterialCommunityIcons name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {routines.length === 0 ? (
        <TouchableOpacity style={styles.emptyRoutines} onPress={openNewRoutine}>
          <Text style={styles.emptyText}>Add a routine like commute, study, or dog walk</Text>
        </TouchableOpacity>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.routineRow}>
          {routines.map((routine) => {
            const done = (routine.completed_dates || []).includes(date);
            const icon = (routine.icon || "checkbox-marked-circle-outline") as keyof typeof MaterialCommunityIcons.glyphMap;
            return (
              <TouchableOpacity
                key={routine.id}
                style={[styles.routineChip, done && styles.routineChipOn]}
                onPress={() => toggleRoutine(routine)}
                onLongPress={() => openEditRoutine(routine)}
              >
                <TouchableOpacity style={styles.editDot} onPress={() => openEditRoutine(routine)} hitSlop={8}>
                  <MaterialCommunityIcons name="pencil-outline" size={12} color="#8E8E93" />
                </TouchableOpacity>
                <MaterialCommunityIcons name={icon} size={26} color={done ? "#FF6B35" : "#8E8E93"} />
                <Text style={styles.routineName} numberOfLines={1}>
                  {routine.name}
                </Text>
                {routine.description ? (
                  <Text style={styles.routineDesc} numberOfLines={1}>
                    {routine.description}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      <View style={styles.activityCard}>
        <View style={styles.activityCol}>
          <Text style={styles.cardLabel}>Steps</Text>
          <Text style={styles.bigStat}>{steps ? steps.toLocaleString() : "0"}</Text>
        </View>
        <View style={styles.activityCol}>
          <Text style={styles.cardLabel}>Active cal</Text>
          <Text style={styles.bigStat}>{activeCal ? activeCal.toLocaleString() : "0"}</Text>
        </View>
      </View>

      {showWorkout ? (
        <View style={styles.workoutCard}>
          <Text style={styles.todayLabel}>Today's workout</Text>
          <View style={styles.workoutRow}>
            <View style={styles.workoutIcon}>
              <MaterialCommunityIcons name="dumbbell" size={20} color="#FF6B35" />
            </View>
            <View>
              <Text style={styles.workoutTitle}>{todayWorkout?.day_name || "Workout"}</Text>
              <Text style={styles.cardLabel}>{todayWorkout?.exercises?.length || 0} exercises</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.startBtn} onPress={() => navigation.navigate("Workouts")}>
            <Text style={styles.startBtnText}>Start workout</Text>
          </TouchableOpacity>
        </View>
      ) : todayWorkout?.status === "rest_day" ? (
        <View style={styles.activityCard}>
          <Text style={styles.todayLabel}>Today's workout</Text>
          <Text style={styles.cardValue}>Rest day</Text>
        </View>
      ) : null}

      <Sheet visible={sheet === "sleep"} title="Sleep" onClose={() => setSheet(null)}>
        <View style={styles.blockHead}>
          <Text style={styles.muted}>Hours slept</Text>
          <Text style={styles.purpleVal}>{draftSleep} hrs</Text>
        </View>
        <Slider
          minimumValue={4}
          maximumValue={12}
          step={0.5}
          value={draftSleep}
          onValueChange={setDraftSleep}
          minimumTrackTintColor="#A78BFA"
          maximumTrackTintColor="#1C1C1F"
          thumbTintColor="#A78BFA"
        />
        <LevelSlider
          label="Estimated sleep quality"
          value={draftSleepQuality}
          onChange={setDraftSleepQuality}
          minLabel="Poor"
          maxLabel="Excellent"
        />
        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.5 }]} disabled={saving} onPress={saveSleep}>
          <Text style={styles.saveText}>{saving ? "Saving..." : "Save"}</Text>
        </TouchableOpacity>
      </Sheet>

      <Sheet visible={sheet === "stress"} title="Stress" onClose={() => setSheet(null)}>
        <LevelSlider
          label="Stress level"
          value={draftStress}
          onChange={setDraftStress}
          minLabel="Low"
          maxLabel="High"
          reverse
        />
        <Text style={styles.fieldLabel}>What's going on?</Text>
        <TextInput
          value={draftStressNote}
          onChangeText={setDraftStressNote}
          placeholder="What's causing the stress?"
          placeholderTextColor="#636366"
          style={[styles.input, { height: 88, textAlignVertical: "top" }]}
          multiline
        />
        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.5 }]} disabled={saving} onPress={saveStress}>
          <Text style={styles.saveText}>{saving ? "Saving..." : "Save"}</Text>
        </TouchableOpacity>
      </Sheet>

      <Sheet visible={sheet === "wellness"} title="Wellness" onClose={() => setSheet(null)}>
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
          <LevelSlider label="Mood" value={draftMood} onChange={setDraftMood} minLabel="Low" maxLabel="High" />
          <LevelSlider label="Energy" value={draftEnergy} onChange={setDraftEnergy} minLabel="Low" maxLabel="High" />
          <LevelSlider
            label="Soreness"
            value={draftAches}
            onChange={setDraftAches}
            minLabel="None"
            maxLabel="Severe"
            reverse
          />
          <Text style={styles.fieldLabel}>How does your body feel?</Text>
          <TextInput
            value={draftBody}
            onChangeText={setDraftBody}
            placeholder="How does your body feel today?"
            placeholderTextColor="#636366"
            style={[styles.input, { height: 88, textAlignVertical: "top" }]}
            multiline
          />
        </ScrollView>
        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.5 }]} disabled={saving} onPress={saveWellness}>
          <Text style={styles.saveText}>{saving ? "Saving..." : "Save"}</Text>
        </TouchableOpacity>
      </Sheet>

      <Sheet visible={sheet === "food"} title="Log food" onClose={() => setSheet(null)}>
        <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
          <LogFoodForm meal="Lunch" onAdd={addFood} onCancel={() => setSheet(null)} />
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === "routine"} title={editingRoutine ? "Edit routine" : "Add routine"} onClose={() => setSheet(null)}>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          value={routineName}
          onChangeText={setRoutineName}
          placeholder="Commute"
          placeholderTextColor="#636366"
          style={styles.input}
        />
        <Text style={styles.fieldLabel}>What is it?</Text>
        <TextInput
          value={routineDesc}
          onChangeText={setRoutineDesc}
          placeholder="Commute time, morning walk, study block…"
          placeholderTextColor="#636366"
          style={[styles.input, { height: 80, textAlignVertical: "top" }]}
          multiline
        />
        <Text style={styles.fieldLabel}>Icon</Text>
        <View style={styles.iconGrid}>
          {ROUTINE_ICONS.map((item) => {
            const on = routineIcon === item.name;
            return (
              <TouchableOpacity
                key={item.name}
                onPress={() => setRoutineIcon(item.name)}
                style={[styles.iconPick, on && styles.iconPickOn]}
              >
                <MaterialCommunityIcons name={item.name} size={20} color={on ? "#FF6B35" : "#fff"} />
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.saveBtn, (!routineName.trim() || saving) && { opacity: 0.5 }]}
          disabled={!routineName.trim() || saving}
          onPress={saveRoutine}
        >
          <Text style={styles.saveText}>{saving ? "Saving..." : editingRoutine ? "Save changes" : "Add routine"}</Text>
        </TouchableOpacity>
        {editingRoutine ? (
          <TouchableOpacity style={styles.deleteBtn} onPress={deleteRoutine}>
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 40,
    paddingTop: Platform.OS === "ios" ? 60 : StatusBar.currentHeight ? StatusBar.currentHeight + 16 : 16,
  },
  header: { marginBottom: 22 },
  greeting: { color: "#fff", fontSize: 32, fontWeight: "800" },
  dateLine: { color: "#8E8E93", fontSize: 16, marginTop: 4 },
  sectionLabel: {
    color: "#8E8E93",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  quickRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  halfCard: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    minHeight: 108,
  },
  cardLabel: { color: "#8E8E93", fontSize: 13, marginTop: 8 },
  cardValue: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 4 },
  bodyPreview: { color: "#8E8E93", fontSize: 12, marginTop: 4 },
  tap: { color: "#FF6B35", fontSize: 13, fontWeight: "600", marginTop: 8 },
  wellnessCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  wellnessIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#2A1A24",
    alignItems: "center",
    justifyContent: "center",
  },
  foodBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 12,
    marginBottom: 18,
  },
  foodBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  routinesHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  routinesHeadRight: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  frac: { color: "#8E8E93", fontSize: 13, fontWeight: "600" },
  plusBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#1C1C1F",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyRoutines: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  emptyText: { color: "#8E8E93", fontSize: 13 },
  routineRow: { gap: 10, paddingRight: 8, marginBottom: 12 },
  routineChip: {
    width: 92,
    minHeight: 96,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  routineChipOn: { borderColor: "#FF6B35" },
  usualScroll: { gap: 14, paddingRight: 8, marginBottom: 10 },
  usualGroup: { gap: 6 },
  usualGroupHead: { flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 2 },
  nowDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#4ADE80" },
  usualTime: {
    color: "#636366",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  usualTimeNow: { color: "#4ADE80" },
  usualGroupRow: { flexDirection: "row", gap: 8 },
  usualChip: {
    width: 84,
    height: 76,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 9,
  },
  usualChipOn: { backgroundColor: "#10231A", borderColor: "#4ADE80" },
  usualIcon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: "#1C1C1F",
    alignItems: "center",
    justifyContent: "center",
  },
  usualIconOn: { backgroundColor: "#4ADE80" },
  usualCheck: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#4ADE80",
    alignItems: "center",
    justifyContent: "center",
  },
  usualName: { color: "#fff", fontSize: 11, fontWeight: "700", lineHeight: 14, marginTop: 6 },
  usualNameOn: { color: "#DCFCE7" },
  remainingLine: { color: "#8E8E93", fontSize: 12, fontWeight: "600", marginBottom: 10 },
  editDot: { position: "absolute", top: 6, right: 6 },
  routineName: { color: "#fff", fontSize: 12, fontWeight: "600", marginTop: 8, textAlign: "center" },
  routineDesc: { color: "#8E8E93", fontSize: 10, marginTop: 2, textAlign: "center" },
  progressTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: "#1C1C1F",
    marginBottom: 18,
    overflow: "hidden",
  },
  progressFill: { height: 4, backgroundColor: "#5A5F6A", borderRadius: 999 },
  activityCard: {
    flexDirection: "row",
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  activityCol: { flex: 1 },
  bigStat: { color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 4 },
  workoutCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: "#FF6B35",
    borderRadius: 16,
    padding: 16,
  },
  todayLabel: {
    color: "#FF6B35",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  workoutRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  workoutIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#2A1A14",
    alignItems: "center",
    justifyContent: "center",
  },
  workoutTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  startBtn: {
    backgroundColor: "#FF6B35",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  startBtnText: { color: "#0B0C10", fontWeight: "700", fontSize: 16 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: "#111113",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 28 : 16,
    paddingTop: 8,
    maxHeight: "88%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#3A3A3C",
    marginBottom: 14,
  },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "700", marginBottom: 16 },
  blockHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  muted: { color: "#8E8E93" },
  purpleVal: { color: "#A78BFA", fontWeight: "700" },
  saveBtn: {
    backgroundColor: "#FF6B35",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  segRow: { flexDirection: "row", gap: 8 },
  seg: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#0A0A0B",
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  segText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  fieldLabel: { color: "#8E8E93", fontSize: 12, fontWeight: "600", marginBottom: 6, marginTop: 8 },
  input: {
    borderRadius: 12,
    backgroundColor: "#0A0A0B",
    borderWidth: 1,
    borderColor: colors.border,
    color: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  iconPick: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0A0A0B",
  },
  iconPickOn: { borderColor: "#FF6B35" },
  deleteBtn: { alignItems: "center", paddingVertical: 14 },
  deleteText: { color: "#EF4444", fontWeight: "600" },
});
