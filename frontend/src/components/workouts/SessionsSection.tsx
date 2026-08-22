import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import DateTimePicker from "@react-native-community/datetimepicker";
import apiClient from "../../api/client";
import {
  Exercise,
  Split,
  WorkoutSession,
  SessionExercise,
  WorkoutSet,
  TodaysWorkout,
  PlanContextInfo,
} from "./types";
import defaultExercises, { categoryToMuscleGroup } from "../../data/defaultExercises";
import { colors, spacing, borderRadius } from "../../theme";
import { persistFromSession, useSessionTimer } from "../../hooks/useSessionTimer";
import Button from "../shared/Button";
import { todayKey } from "../wellness/types";
import ExercisePicker, { PickerExercise } from "./ExercisePicker";
import {
  buildSessionPayload,
  confidencePct,
  emptySessionForm,
  formatLastPerformance,
  formatShortDate,
  formatDateOrdinal,
  getBestSetLabel,
  groupSessionsByWeek,
  hasCardioLog,
  hydrateAiRecommendations,
  isCardioExercise,
  isLastWorkoutRecent,
  isSportCardio,
  isTreadmillCardio,
  isValidSet,
  lastWorkoutHasWeight,
  lastWorkingSets,
  mapRecSets,
  migrateSessionCardioToExercises,
  recCopiesLastWorkout,
  recHasWeightedSets,
  resolveLastExercise,
  sessionDurationMinutes,
  sessionHeadline,
  sessionToForm,
  setsFromLastWorkout,
  splitBadgeColors,
  splitLabel,
  toStoredRecommendation,
} from "./sessionLogic";

interface SessionsSectionProps {
  exercises: Exercise[];
  splits: Split[];
}

const PLAN_GOAL_LABELS: Record<string, string> = {
  strength: "Strength Focus",
  hypertrophy: "Hypertrophy Focus",
  fat_loss: "Fat Loss Focus",
  general: "General Focus",
};

/**
 * Label an exercise only when the plan genuinely changes how it's trained.
 * Labelling every exercise would be noise, so a plain hypertrophy accessory
 * that matches the user's normal goal stays unlabelled.
 */
function planExerciseLabel(ctx?: PlanContextInfo): string | null {
  if (!ctx) return null;
  if (ctx.source !== "plan_exercise") return null;

  const parts: string[] = [];
  if (ctx.goal && ctx.goal !== "hypertrophy") {
    parts.push(PLAN_GOAL_LABELS[ctx.goal] || ctx.goal);
  }
  if (ctx.priority === "high") parts.push("High Priority");
  if (!parts.length && ctx.target_rep_range) {
    parts.push(`Target ${ctx.target_rep_range[0]}-${ctx.target_rep_range[1]} reps`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export default function SessionsSection({ exercises, splits }: SessionsSectionProps) {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptySessionForm());
  const [showSplitDropdown, setShowSplitDropdown] = useState(false);
  const [showDayDropdown, setShowDayDropdown] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [exerciseSearchQuery, setExerciseSearchQuery] = useState("");
  const [lastExerciseData, setLastExerciseData] = useState<Record<string, any>>({});
  const [maxExerciseData, setMaxExerciseData] = useState<Record<string, any>>({});
  const [aiRecommendations, setAiRecommendations] = useState<Record<string, any>>({});
  const [aiRecommendationLoading, setAiRecommendationLoading] = useState<Record<string, boolean>>({});
  const [startingWeights, setStartingWeights] = useState<Record<string, string>>({});
  const [collapsedExercises, setCollapsedExercises] = useState<Record<number, boolean>>({});
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<"browse" | "search">("browse");
  const [selectedBodyPart, setSelectedBodyPart] = useState<string | null>(null);
  const [equipmentFilter, setEquipmentFilter] = useState<string | null>(null);
  const [showSessionDetails, setShowSessionDetails] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [todaysPlanWorkout, setTodaysPlanWorkout] = useState<TodaysWorkout | null>(null);
  // Purpose of the session being logged, when it came from the Active Plan
  const [activePlanDay, setActivePlanDay] = useState<{
    day_name?: string;
    day_goal?: string;
    day_type?: string;
    focus?: string;
    plan_name?: string;
  } | null>(null);

  const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRecApplyRef = useRef<Set<string>>(new Set());
  const staleRecRetryRef = useRef<Set<string>>(new Set());
  const fetchedLastRef = useRef<Set<string>>(new Set());
  const formDataRef = useRef(formData);
  const editingSessionIdRef = useRef(editingSessionId);
  const autoSaveChainRef = useRef(Promise.resolve(true));
  formDataRef.current = formData;
  editingSessionIdRef.current = editingSessionId;

  const editingSession = sessions.find((s) => s.id === editingSessionId);
  const weekGroups = useMemo(() => groupSessionsByWeek(sessions), [sessions]);
  const todaySession = useMemo(() => {
    const key = todayKey();
    return (
      sessions.find((s) => String(s.date || "").slice(0, 10) === key) || null
    );
  }, [sessions]);
  const todaySessionExercises = useMemo(
    () => (todaySession ? migrateSessionCardioToExercises(todaySession) : []),
    [todaySession]
  );
  const timer = useSessionTimer(
    showForm ? editingSessionId || "draft" : null,
    persistFromSession(editingSession)
  );
  const timerPersistRef = useRef(timer.getPersist);
  timerPersistRef.current = timer.getPersist;

  const lastExerciseUrl = (exerciseId: string) => {
    const sessionId = editingSessionIdRef.current;
    const query = sessionId
      ? `?exclude_session_id=${encodeURIComponent(sessionId)}`
      : "";
    return `/api/workout-sessions/last-exercise/${exerciseId}${query}`;
  };

  const fetchSessions = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/workout-sessions");
      setSessions(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error fetching sessions:", error);
    }
  }, []);

  // The Active Plan is the source of truth for today's workout. Falls back to
  // the legacy structural plan so users without a goal plan are unaffected.
  const fetchTodaysPlanData = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/training-plan/today");
      if (res.data?.status && res.data.status !== "no_plan") return res.data;
    } catch {
      // fall through to the legacy endpoint
    }
    try {
      const res = await apiClient.get("/api/workout-plan/today");
      return res.data;
    } catch {
      return null;
    }
  }, []);

  const fetchTodaysPlan = useCallback(async () => {
    setTodaysPlanWorkout(await fetchTodaysPlanData());
  }, [fetchTodaysPlanData]);

  useEffect(() => {
    fetchSessions();
    fetchTodaysPlan();
    apiClient
      .get("/api/workout-sessions/ai-recommendation-check")
      .then((res) => {
        if (res.data?.needs_initial_setup && !res.data.has_summary) {
          apiClient.get("/api/workout-sessions/ai-summary").catch(() => {});
        }
      })
      .catch(() => {});
  }, [fetchSessions, fetchTodaysPlan]);

  const performAutoSave = useCallback(
    async () => {
      const run = async () => {
        const data = formDataRef.current;
        const payload = buildSessionPayload(data, timerPersistRef.current());
        const canSave = payload.exercises.length > 0 || hasCardioLog(data);
        if (!canSave) return false;
        setIsAutoSaving(true);
        try {
          const sessionId = editingSessionIdRef.current;
          if (sessionId) {
            await apiClient.put(`/api/workout-sessions/${sessionId}`, payload);
          } else {
            const response = await apiClient.post("/api/workout-sessions", payload);
            if (response.data?.id) {
              editingSessionIdRef.current = response.data.id;
              setEditingSessionId(response.data.id);
            }
          }
          setLastSaved(new Date());
          setSaveError(null);
          fetchSessions();
          return true;
        } catch (error) {
          console.error("Error auto-saving session:", error);
          setSaveError("Auto-save failed");
          return false;
        } finally {
          setIsAutoSaving(false);
        }
      };
      const queued = autoSaveChainRef.current.then(run, run);
      autoSaveChainRef.current = queued.then(
        () => true,
        () => true
      );
      return queued;
    },
    [fetchSessions]
  );

  useEffect(() => {
    if (!showForm || (formData.exercises.length === 0 && !hasCardioLog(formData))) {
      return;
    }
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(() => {
      void performAutoSave();
    }, 800);
    return () => {
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    };
  }, [formData.exercises, formData.date, formData.split_name, formData.split_day, formData.notes, showForm, performAutoSave]);

  const allExercises: PickerExercise[] = useMemo(() => {
    const defaults = defaultExercises.map((ex) => ({
      id: ex.id,
      name: ex.name,
      category: ex.category,
      equipment: ex.equipment,
      is_default: true,
    }));
    const customs = exercises
      .filter((ex) => ex.id)
      .map((ex) => {
        let category: string | null = null;
        if (ex.muscle_group) {
          const muscleGroup = ex.muscle_group.toLowerCase();
          for (const [cat, muscle] of Object.entries(categoryToMuscleGroup)) {
            if (muscleGroup.includes(muscle.toLowerCase())) {
              category = cat;
              break;
            }
          }
        }
        return {
          id: ex.id!,
          name: ex.name,
          category,
          equipment: null,
          is_default: false,
        };
      });
    return [...defaults, ...customs];
  }, [exercises]);

  const fetchAiRecommendation = async (
    exerciseId: string,
    exerciseName: string,
    positionInWorkout: number,
    planTargetSets?: number,
    planTargetReps?: number
  ) => {
    setAiRecommendationLoading((prev) => ({ ...prev, [exerciseId]: true }));
    try {
      const currentExercises = formDataRef.current.exercises.map((ex) => ({
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        sets: ex.sets || [],
      }));
      const response = await apiClient.post(
        `/api/workout-sessions/ai-recommendation/${exerciseId}`,
        {
          exercise_name: exerciseName,
          split_name: formDataRef.current.split_name || undefined,
          // Lets the backend resolve which plan day applies
          split_day: formDataRef.current.split_day || undefined,
          position_in_workout: positionInWorkout,
          current_workout_exercises: currentExercises,
          plan_target_sets: planTargetSets,
          plan_target_reps: planTargetReps,
          exclude_session_id: editingSessionIdRef.current || undefined,
        }
      );
      if (response.data?.status === "success") {
        const rec = response.data.recommendation;
        const stored = toStoredRecommendation(rec);
        setAiRecommendations((prev) => ({ ...prev, [exerciseId]: rec }));
        setFormData((prev) => {
          if (!prev.exercises.some((ex) => ex.exercise_id === exerciseId)) return prev;
          const shouldApplySets =
            recHasWeightedSets(rec) && pendingRecApplyRef.current.has(exerciseId);
          if (shouldApplySets) pendingRecApplyRef.current.delete(exerciseId);
          return {
            ...prev,
            exercises: prev.exercises.map((ex) =>
              ex.exercise_id === exerciseId
                ? {
                    ...ex,
                    ai_recommendation: stored,
                    ...(rec?.plan_context ? { plan_context: rec.plan_context } : {}),
                    ...(shouldApplySets ? { sets: mapRecSets(rec) } : {}),
                  }
                : ex
            ),
          };
        });
      }
    } catch {
      // no rec
    } finally {
      setAiRecommendationLoading((prev) => ({ ...prev, [exerciseId]: false }));
    }
  };

  useEffect(() => {
    if (!showForm) return;
    formData.exercises.forEach((ex, idx) => {
      if (!ex.exercise_id || isCardioExercise(ex)) return;
      const rec = aiRecommendations[ex.exercise_id] || ex.ai_recommendation;
      if (!rec?.sets?.length || aiRecommendationLoading[ex.exercise_id]) return;
      const lastData = resolveLastExercise(
        lastExerciseData[ex.exercise_id],
        sessions,
        ex.exercise_id,
        ex.exercise_name,
        editingSessionId
      );
      const lastSets = lastWorkingSets(lastData);
      if (!recCopiesLastWorkout(rec, lastSets)) return;
      if (staleRecRetryRef.current.has(ex.exercise_id)) return;
      staleRecRetryRef.current.add(ex.exercise_id);
      void fetchAiRecommendation(ex.exercise_id, ex.exercise_name, idx);
    });
  }, [showForm, formData.exercises, aiRecommendations, lastExerciseData, sessions, editingSessionId, aiRecommendationLoading]);

  useEffect(() => {
    if (!showForm) return;
    formData.exercises.forEach((ex) => {
      const id = ex.exercise_id;
      if (!id) return;
      const cacheKey = `${id}:${editingSessionId || ""}`;
      if (fetchedLastRef.current.has(cacheKey)) return;
      fetchedLastRef.current.add(cacheKey);
      apiClient
        .get(lastExerciseUrl(id))
        .then((res) => {
          if (res.data && res.data.session_id !== editingSessionIdRef.current) {
            setLastExerciseData((prev) => ({ ...prev, [id]: res.data }));
          }
        })
        .catch(() => {});
      apiClient
        .get(`/api/workout-sessions/max-exercise/${id}`)
        .then((res) => {
          if (res.data) setMaxExerciseData((prev) => ({ ...prev, [id]: res.data }));
        })
        .catch(() => {});
    });
  }, [showForm, formData.exercises, editingSessionId]);

  const handleExerciseChange = async (exerciseId: string, exerciseName: string) => {
    const selectedExercise = allExercises.find((ex) => ex.id === exerciseId);
    const isCardio = selectedExercise?.category === "CARDIO";
    const positionInWorkout = formData.exercises.length;
    let lastData: any = null;
    try {
      const response = await apiClient.get(lastExerciseUrl(exerciseId));
      if (response.data) {
        lastData = response.data;
        setLastExerciseData((prev) => ({ ...prev, [exerciseId]: response.data }));
      }
    } catch {}
    try {
      const maxResponse = await apiClient.get(
        `/api/workout-sessions/max-exercise/${exerciseId}`
      );
      if (maxResponse.data) {
        setMaxExerciseData((prev) => ({ ...prev, [exerciseId]: maxResponse.data }));
      }
    } catch {}
    if (!isCardio) pendingRecApplyRef.current.add(exerciseId);
    const lastSets = !isCardio ? setsFromLastWorkout(lastData, 3) : null;
    setFormData({
      ...formData,
      exercises: [
        ...formData.exercises,
        isCardio
          ? {
              exercise_id: exerciseId,
              exercise_name: exerciseName,
              time: lastData?.exercise_data?.time ?? lastData?.time,
              ...(exerciseId.startsWith("default-cardio-sport")
                ? {
                    intensity: lastData?.exercise_data?.intensity ?? 5,
                    fatigue: lastData?.exercise_data?.fatigue ?? 5,
                  }
                : { speed: lastData?.exercise_data?.speed }),
            }
          : {
              exercise_id: exerciseId,
              exercise_name: exerciseName,
              sets: lastSets || [
                { set_number: 1, reps: 0, weight: undefined },
                { set_number: 2, reps: 0, weight: undefined },
                { set_number: 3, reps: 0, weight: undefined },
              ],
            },
      ],
    });
    if (!isCardio) {
      fetchAiRecommendation(exerciseId, exerciseName, positionInWorkout);
    }
    setExerciseSearchQuery("");
    setCategoryFilter(null);
    setShowExercisePicker(false);
    setSelectedBodyPart(null);
    setEquipmentFilter(null);
  };

  const resetForm = () => {
    setFormData(emptySessionForm());
    setActivePlanDay(null);
    setEditingSessionId(null);
    setShowForm(false);
    setShowExercisePicker(false);
    setExerciseSearchQuery("");
    setCategoryFilter(null);
    setPickerMode("browse");
    setSelectedBodyPart(null);
    setEquipmentFilter(null);
    setLastExerciseData({});
    setMaxExerciseData({});
    setAiRecommendations({});
    fetchedLastRef.current = new Set();
    staleRecRetryRef.current = new Set();
    setAiRecommendationLoading({});
    setLastSaved(null);
    setIsAutoSaving(false);
    setIsSaving(false);
    setSaveError(null);
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
  };

  const handleFinish = async () => {
    const payload = buildSessionPayload(formDataRef.current, timerPersistRef.current());
    if (payload.exercises.length === 0 && !hasCardioLog(formDataRef.current)) {
      setSaveError("Add at least one set or a cardio activity before finishing.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      timer.stop();
      const saved = await performAutoSave();
      if (!saved && !editingSessionIdRef.current) {
        setSaveError("Could not save workout");
        return;
      }
      timer.clear();
      resetForm();
      fetchSessions();
      fetchTodaysPlan();
    } catch {
      setSaveError("Could not save workout");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = async () => {
    await performAutoSave();
    resetForm();
    fetchSessions();
    fetchTodaysPlan();
  };

  const handleEdit = (session: WorkoutSession) => {
    setFormData(sessionToForm(session));
    setAiRecommendations(hydrateAiRecommendations(session.exercises || []));
    setEditingSessionId(session.id || null);
    setShowDatePicker(false);
    setShowForm(true);
  };

  const handleDelete = (sessionId: string) => {
    Alert.alert("Delete Workout", "Are you sure you want to delete this workout session?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiClient.delete(`/api/workout-sessions/${sessionId}`);
            fetchSessions();
            fetchTodaysPlan();
          } catch (error) {
            console.error("Error deleting session:", error);
          }
        },
      },
    ]);
  };

  const handleStartPlan = async () => {
    try {
      const todayData = await fetchTodaysPlanData();
      if (!todayData || todayData.status !== "workout_day" || !todayData.exercises) return;
      // Respect the plan's exercise order. The Current Split is never reordered.
      todayData.exercises = [...todayData.exercises].sort(
        (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)
      );
      const lastResults = await Promise.all(
        todayData.exercises.map(async (ex: any) => {
          try {
            const response = await apiClient.get(lastExerciseUrl(ex.exercise_id));
            return response.data || null;
          } catch {
            return null;
          }
        })
      );
      const lastById: Record<string, any> = {};
      todayData.exercises.forEach((ex: any, idx: number) => {
        if (lastResults[idx]) lastById[ex.exercise_id] = lastResults[idx];
      });
      setLastExerciseData((prev) => ({ ...prev, ...lastById }));
      const planExercises = todayData.exercises.map((ex: any, idx: number) => {
        const isCardio = ex.exercise_id?.startsWith("default-cardio");
        if (isCardio) {
          const sport = String(ex.exercise_id || "").startsWith("default-cardio-sport");
          return {
            exercise_id: ex.exercise_id,
            exercise_name: ex.exercise_name,
            time: undefined,
            ...(sport ? { intensity: 5, fatigue: 5 } : { speed: undefined }),
          };
        }
        const lastSets = setsFromLastWorkout(lastResults[idx], ex.sets || 3);
        pendingRecApplyRef.current.add(ex.exercise_id);
        return {
          exercise_id: ex.exercise_id,
          exercise_name: ex.exercise_name,
          // Resolved server-side; carried through for display only
          plan_context: ex.plan_context,
          sets:
            lastSets ||
            Array.from({ length: ex.sets || 3 }, (_, i) => ({
              set_number: i + 1,
              reps: 0,
              weight: undefined,
              completed: false,
            })),
        };
      });
      setFormData({
        ...emptySessionForm(),
        split_id: todayData.split_id || "",
        split_name: todayData.plan_name || "",
        split_day: todayData.day_name || "",
        exercises: planExercises,
      });
      setActivePlanDay({
        day_name: todayData.day_name,
        day_goal: todayData.day_goal,
        day_type: todayData.day_type,
        focus: todayData.focus,
        plan_name: todayData.plan_name,
      });
      setShowForm(true);
      planExercises.forEach((ex: any, idx: number) => {
        if (isCardioExercise(ex) || String(ex.exercise_id || "").startsWith("default-cardio")) {
          return;
        }
        const planEx = todayData.exercises[idx];
        // Only sets/reps are passed as overrides. Goal, priority, rep range and
        // day type are resolved from the plan on the backend.
        fetchAiRecommendation(ex.exercise_id, ex.exercise_name, idx, planEx?.sets, planEx?.reps);
      });
    } catch (error) {
      console.error("Error loading plan workout:", error);
    }
  };

  const patchExercise = (idx: number, patch: Partial<SessionExercise>) => {
    const next = [...formData.exercises];
    next[idx] = { ...next[idx], ...patch };
    setFormData({ ...formData, exercises: next });
  };

  const removeExercise = (exerciseIdx: number) => {
    setFormData({
      ...formData,
      exercises: formData.exercises.filter((_, i) => i !== exerciseIdx),
    });
  };

  const addSet = (idx: number) => {
    const exercise = formData.exercises[idx];
    const currentSets = Array.isArray(exercise.sets) ? exercise.sets : [];
    const last = currentSets[currentSets.length - 1];
    patchExercise(idx, {
      sets: [
        ...currentSets,
        {
          set_number: currentSets.length + 1,
          reps: last?.reps || 0,
          weight: last?.weight,
          completed: false,
        },
      ],
    });
  };

  const removeSet = (exerciseIdx: number, setIdx: number) => {
    const exercise = formData.exercises[exerciseIdx];
    const currentSets = Array.isArray(exercise.sets) ? exercise.sets : [];
    const remaining = currentSets
      .filter((_, i) => i !== setIdx)
      .map((set, i) => ({ ...set, set_number: i + 1 }));
    if (remaining.length === 0) {
      removeExercise(exerciseIdx);
      return;
    }
    patchExercise(exerciseIdx, { sets: remaining });
  };

  const updateSet = (exerciseIdx: number, setIdx: number, patch: Partial<WorkoutSet>) => {
    const exercise = formData.exercises[exerciseIdx];
    const currentSets = Array.isArray(exercise.sets) ? [...exercise.sets] : [];
    currentSets[setIdx] = { ...currentSets[setIdx], ...patch };
    patchExercise(exerciseIdx, { sets: currentSets });
  };

  const applyAiSets = (exerciseId: string, exerciseIdx: number) => {
    const rec = aiRecommendations[exerciseId];
    if (!rec?.sets || !Array.isArray(rec.sets)) return;
    patchExercise(exerciseIdx, { sets: mapRecSets(rec) });
  };

  const applyStartingWeight = (exerciseId: string, exerciseIdx: number) => {
    const rec = aiRecommendations[exerciseId];
    const startingWeight = Number(startingWeights[exerciseId]);
    if (!rec?.needs_starting_weight || !Number.isFinite(startingWeight) || startingWeight <= 0) {
      return;
    }
    const setCount = Math.max(1, rec.suggested_sets || 3);
    const reps = Math.max(1, rec.suggested_reps || 6);
    patchExercise(exerciseIdx, {
      sets: Array.from({ length: setCount }, (_, i) => ({
        set_number: i + 1,
        reps,
        weight: startingWeight,
        completed: false,
      })),
    });
  };

  const getExerciseCategory = (exerciseId: string, exerciseName: string) => {
    const fromDefault = defaultExercises.find(
      (e) => e.id === exerciseId || e.name === exerciseName
    );
    if (fromDefault?.category) {
      return fromDefault.category.charAt(0) + fromDefault.category.slice(1).toLowerCase();
    }
    const fromCustom = exercises.find((e) => e.id === exerciseId || e.name === exerciseName);
    if (fromCustom?.muscle_group) return fromCustom.muscle_group;
    return "Exercise";
  };

  const categoryFilterPills = [
    { id: null as string | null, label: "All" },
    { id: "CHEST", label: "Chest" },
    { id: "SHOULDERS", label: "Shoulders" },
    { id: "BACK", label: "Back" },
    { id: "ARMS", label: "Arms" },
    { id: "LEGS", label: "Legs" },
    { id: "CORE", label: "Core" },
  ];

  if (showForm) {
    const selectedSplit = splits.find((s) => s.id === formData.split_id);
    return (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.formPad}
          keyboardShouldPersistTaps="handled"
        >
          {activePlanDay && (activePlanDay.day_goal || activePlanDay.day_type) ? (
            <View style={styles.planBanner}>
              <MaterialCommunityIcons name="target" size={14} color={colors.accentPrimary} />
              <Text style={styles.planBannerText}>
                {[activePlanDay.day_type, activePlanDay.day_goal]
                  .filter(Boolean)
                  .map((part, i) =>
                    i === 0 && part
                      ? part.charAt(0).toUpperCase() + part.slice(1)
                      : part
                  )
                  .join(" · ")}
              </Text>
            </View>
          ) : null}

          <View style={styles.formHeader}>
            <TouchableOpacity onPress={handleCancel} style={styles.backBtn}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.flex}>
              <View style={styles.titleRow}>
                <Text style={styles.formTitle}>
                  {sessionHeadline(
                    formData.split_name,
                    formData.split_day,
                    formData.date
                  )}
                </Text>
                <View>
                  <TouchableOpacity onPress={() => setShowDatePicker(true)} hitSlop={8}>
                    <MaterialCommunityIcons name="calendar" size={18} color={colors.accentPrimary} />
                  </TouchableOpacity>
                  {Platform.OS === "web" ? (
                    <input
                      type="date"
                      value={formData.date}
                      onChange={(e: any) => {
                        if (e.target.value) {
                          setFormData({ ...formData, date: e.target.value });
                        }
                      }}
                      aria-label="Workout date"
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: 28,
                        height: 28,
                        opacity: 0,
                        cursor: "pointer",
                      }}
                    />
                  ) : null}
                </View>
              </View>
              {Platform.OS !== "web" && showDatePicker && (
                <DateTimePicker
                  value={new Date(`${formData.date}T00:00:00`)}
                  mode="date"
                  display="spinner"
                  onChange={(_, date) => {
                    setShowDatePicker(false);
                    if (date) {
                      const y = date.getFullYear();
                      const m = String(date.getMonth() + 1).padStart(2, "0");
                      const d = String(date.getDate()).padStart(2, "0");
                      setFormData({ ...formData, date: `${y}-${m}-${d}` });
                    }
                  }}
                />
              )}
              <View style={styles.splitRow}>
                <TouchableOpacity
                  style={styles.dropBtn}
                  onPress={() => {
                    setShowSplitDropdown(!showSplitDropdown);
                    setShowDayDropdown(false);
                  }}
                >
                  <Text style={styles.dropBtnText}>
                    {formData.split_id
                      ? splits.find((s) => s.id === formData.split_id)?.name ||
                        formData.split_name ||
                        "Split"
                      : "Split"}
                  </Text>
                  <MaterialCommunityIcons name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                {formData.split_id && selectedSplit?.days?.length ? (
                  <TouchableOpacity
                    style={styles.dropBtn}
                    onPress={() => {
                      setShowDayDropdown(!showDayDropdown);
                      setShowSplitDropdown(false);
                    }}
                  >
                    <Text style={styles.dropBtnText}>
                      {formData.split_day || "Day"}
                    </Text>
                    <MaterialCommunityIcons name="chevron-down" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                ) : null}
              </View>
              {showSplitDropdown && (
                <View style={styles.menu}>
                  <TouchableOpacity
                    onPress={() => {
                      setFormData({ ...formData, split_id: "", split_name: "", split_day: "" });
                      setShowSplitDropdown(false);
                    }}
                    style={[styles.menuItem, !formData.split_id && styles.menuItemActive]}
                  >
                    <Text style={styles.menuText}>No split</Text>
                  </TouchableOpacity>
                  {splits.map((split) => (
                    <TouchableOpacity
                      key={split.id}
                      onPress={() => {
                        const onlyDay = split.days?.length === 1 ? split.days[0] : "";
                        setFormData({
                          ...formData,
                          split_id: split.id || "",
                          split_name: split.name,
                          split_day: onlyDay,
                        });
                        setShowSplitDropdown(false);
                      }}
                      style={[
                        styles.menuItem,
                        formData.split_id === split.id && styles.menuItemActive,
                      ]}
                    >
                      <Text style={styles.menuText}>{split.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {showDayDropdown && selectedSplit?.days && (
                <View style={styles.menu}>
                  {selectedSplit.days.map((day, index) => (
                    <TouchableOpacity
                      key={index}
                      onPress={() => {
                        setFormData({ ...formData, split_day: day });
                        setShowDayDropdown(false);
                      }}
                      style={[
                        styles.menuItem,
                        formData.split_day === day && styles.menuItemActive,
                      ]}
                    >
                      <Text style={styles.menuText}>{day}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {timer.firstStartedAt ? (
                <Text style={styles.muted}>
                  Started{" "}
                  {new Date(timer.firstStartedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Text>
              ) : null}
            </View>
          </View>

          <Text style={styles.savedHint}>
            {isAutoSaving
              ? "Saving..."
              : lastSaved
              ? `Saved ${lastSaved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : formData.exercises.length > 0
              ? "Auto-saves as you log"
              : ""}
          </Text>

          <View style={styles.timerRow}>
            <Text style={styles.timerText}>{timer.formattedTime}</Text>
            <TouchableOpacity
              style={styles.timerBtn}
              onPress={timer.isRunning ? timer.stop : timer.start}
            >
              <MaterialCommunityIcons
                name={timer.isRunning ? "stop" : "play"}
                size={16}
                color={colors.textSecondary}
              />
              <Text style={styles.timerBtnText}>{timer.isRunning ? "Stop" : "Start"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconCircle} onPress={timer.refresh}>
              <MaterialCommunityIcons name="refresh" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.finishBtn,
                ((formData.exercises.length === 0 && !hasCardioLog(formData)) || isSaving) &&
                  styles.disabled,
              ]}
              disabled={
                (formData.exercises.length === 0 && !hasCardioLog(formData)) || isSaving
              }
              onPress={handleFinish}
            >
              <Text style={styles.finishText}>
                {isSaving ? "Finishing..." : "Finish Workout"}
              </Text>
            </TouchableOpacity>
          </View>
          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

          <TouchableOpacity onPress={() => setShowSessionDetails(!showSessionDetails)}>
            <Text style={styles.detailsToggle}>
              {showSessionDetails ? "Hide session details" : "Session details"}
            </Text>
          </TouchableOpacity>
          {showSessionDetails && (
            <TextInput
              value={formData.notes}
              onChangeText={(notes) => setFormData({ ...formData, notes })}
              placeholder="How did the workout feel?"
              placeholderTextColor={colors.textMuted}
              style={styles.notes}
              multiline
            />
          )}

          <View style={styles.searchWrap}>
            <MaterialCommunityIcons
              name="magnify"
              size={18}
              color={colors.textSecondary}
              style={styles.searchIcon}
            />
            <TextInput
              value={exerciseSearchQuery}
              onChangeText={(q) => {
                setExerciseSearchQuery(q);
                if (q) {
                  setShowExercisePicker(true);
                  setPickerMode("search");
                }
              }}
              onFocus={() => setShowExercisePicker(true)}
              placeholder="Search exercises..."
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
            />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pills}>
            {categoryFilterPills.map((pill) => (
              <TouchableOpacity
                key={pill.label}
                onPress={() => {
                  setCategoryFilter(pill.id);
                  setShowExercisePicker(true);
                  if (pill.id === "ARMS") setSelectedBodyPart("BICEPS");
                  else if (pill.id === "CORE") setSelectedBodyPart("CORE / ABS");
                  else if (pill.id) setSelectedBodyPart(pill.id);
                  else setSelectedBodyPart(null);
                  setPickerMode("browse");
                }}
                style={[styles.pill, categoryFilter === pill.id && styles.pillActive]}
              >
                <Text
                  style={[styles.pillText, categoryFilter === pill.id && styles.pillTextActive]}
                >
                  {pill.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={styles.addDashed}
            onPress={() => {
              setShowExercisePicker(true);
              setPickerMode("browse");
              setSelectedBodyPart(null);
              setEquipmentFilter(null);
            }}
          >
            <MaterialCommunityIcons name="plus" size={18} color={colors.textSecondary} />
            <Text style={styles.addDashedText}>Add exercise</Text>
          </TouchableOpacity>

          {showExercisePicker && (
            <ExercisePicker
              allExercises={allExercises}
              pickerMode={pickerMode}
              selectedBodyPart={selectedBodyPart}
              equipmentFilter={equipmentFilter}
              searchQuery={exerciseSearchQuery}
              onModeChange={setPickerMode}
              onBodyPartChange={setSelectedBodyPart}
              onEquipmentFilterChange={setEquipmentFilter}
              onSearchChange={setExerciseSearchQuery}
              onSelect={handleExerciseChange}
              onClose={() => {
                setShowExercisePicker(false);
                setSelectedBodyPart(null);
                setEquipmentFilter(null);
                setExerciseSearchQuery("");
                setCategoryFilter(null);
              }}
            />
          )}

          {formData.exercises.map((ex, idx) => {
            const exerciseSets = Array.isArray(ex.sets) ? ex.sets : [];
            const isCardio = isCardioExercise(ex);
            const sportCardio = isSportCardio(ex);
            const treadmillCardio = isTreadmillCardio(ex);
            const isCollapsed = collapsedExercises[idx] ?? false;
            const completedCount = exerciseSets.filter(isValidSet).length;
            const categoryLabel = getExerciseCategory(ex.exercise_id, ex.exercise_name);
            const roleLabel = idx === 0 ? "Primary" : "Secondary";
            const lastData = resolveLastExercise(
              lastExerciseData[ex.exercise_id],
              sessions,
              ex.exercise_id,
              ex.exercise_name,
              editingSessionId
            );
            const lastSets = lastWorkingSets(lastData);
            const maxData = maxExerciseData[ex.exercise_id];
            const aiRec = aiRecommendations[ex.exercise_id] || ex.ai_recommendation;
            const aiLoading = aiRecommendationLoading[ex.exercise_id];
            const bestSetLabel = getBestSetLabel(maxData);
            const confPct =
              aiRec && !aiRec.needs_starting_weight ? confidencePct(aiRec.confidence) : null;
            const lastLine = formatLastPerformance(lastData);
            const showAi = !isCardio && !!(aiRec || aiLoading);

            return (
              <View key={`${ex.exercise_id}-${idx}`} style={styles.exCard}>
                <View style={styles.exHeader}>
                  <View style={styles.flex}>
                    <Text style={styles.exName}>{ex.exercise_name}</Text>
                    <Text style={styles.exMeta}>
                      {categoryLabel} · {roleLabel}
                    </Text>
                    {planExerciseLabel(ex.plan_context) ? (
                      <Text style={styles.exPlanLabel}>
                        {planExerciseLabel(ex.plan_context)}
                      </Text>
                    ) : null}
                    {lastLine && isCollapsed ? (
                      <Text style={styles.lastOrangeHeader}>
                        Last {lastData?.date ? formatShortDate(lastData.date) : ""}: {lastLine}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.exHeaderRight}>
                    {!isCardio && (
                      <Text style={styles.setCount}>
                        {completedCount}/{exerciseSets.length} sets
                      </Text>
                    )}
                    {showAi && (
                      <View style={styles.aiBadge}>
                        <Text style={styles.aiBadgeText}>AI</Text>
                      </View>
                    )}
                    <TouchableOpacity onPress={() => removeExercise(idx)}>
                      <MaterialCommunityIcons name="delete-outline" size={18} color={colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() =>
                        setCollapsedExercises((prev) => ({ ...prev, [idx]: !prev[idx] }))
                      }
                    >
                      <MaterialCommunityIcons
                        name="chevron-down"
                        size={22}
                        color={colors.textSecondary}
                        style={isCollapsed ? { transform: [{ rotate: "90deg" }] } : undefined}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                {!isCollapsed && (
                  <View>
                    {showAi &&
                      (aiLoading ? (
                      <View style={styles.aiBand}>
                        <ActivityIndicator color={colors.ai} />
                        <Text style={styles.aiLoading}>Getting AI recommendation...</Text>
                      </View>
                    ) : (
                      aiRec && (
                        <View style={styles.aiBand}>
                          <View style={styles.aiHead}>
                            <Text style={styles.aiCoach}>✦ AI COACH</Text>
                            {aiRec.generated_at ? (
                              <Text style={styles.aiSaved}>Saved with this session</Text>
                            ) : null}
                            {confPct ? (
                              <View style={styles.confBadge}>
                                <Text style={styles.confText}>{confPct} confidence</Text>
                              </View>
                            ) : null}
                          </View>
                          {aiRec.needs_starting_weight &&
                            !(lastWorkoutHasWeight(lastData) && isLastWorkoutRecent(lastData)) &&
                            !recHasWeightedSets(aiRec) && (
                              <View style={styles.startBox}>
                                <Text style={styles.startHint}>
                                  There is no usable weighted history yet. Pick a weight you can
                                  control for {aiRec.suggested_reps || 6} reps.
                                </Text>
                                <View style={styles.startRow}>
                                  <TextInput
                                    keyboardType="decimal-pad"
                                    value={startingWeights[ex.exercise_id] || ""}
                                    onChangeText={(v) =>
                                      setStartingWeights((prev) => ({
                                        ...prev,
                                        [ex.exercise_id]: v,
                                      }))
                                    }
                                    placeholder="Starting weight"
                                    placeholderTextColor={colors.textMuted}
                                    style={styles.startInput}
                                  />
                                  <TouchableOpacity
                                    style={styles.useStart}
                                    disabled={
                                      !startingWeights[ex.exercise_id] ||
                                      Number(startingWeights[ex.exercise_id]) <= 0
                                    }
                                    onPress={() => applyStartingWeight(ex.exercise_id, idx)}
                                  >
                                    <Text style={styles.useStartText}>Use starting weight</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            )}
                          {Array.isArray(aiRec.sets) && (
                            <View style={styles.recSets}>
                              {aiRec.sets.slice(0, 3).map((set: any, setIdx: number) => (
                                <View key={setIdx} style={styles.recSet}>
                                  <Text style={styles.recSetLabel}>SET {setIdx + 1}</Text>
                                  <Text style={styles.recSetVal}>
                                    {set.reps} reps
                                    {set.weight != null && Number(set.weight) > 0
                                      ? `\n${set.weight} lbs`
                                      : ""}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          )}
                          {aiRec.reasoning ? (
                            <Text style={styles.reasoning}>{aiRec.reasoning}</Text>
                          ) : null}
                          {recHasWeightedSets(aiRec) && (
                            <TouchableOpacity
                              style={styles.applySets}
                              onPress={() => applyAiSets(ex.exercise_id, idx)}
                            >
                              <MaterialCommunityIcons name="lightning-bolt" size={15} color={colors.ai} />
                              <Text style={styles.applySetsText}>Apply sets</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )
                    ))}

                    {(lastLine || maxData?.max_weight != null) && (
                      <View style={styles.historyBox}>
                        {lastLine ? (
                          <View style={[styles.historyLast, maxData?.max_weight != null && { marginBottom: 10 }]}>
                            <Text style={styles.statLabelOrange}>
                              LAST{lastData?.date ? ` · ${formatShortDate(lastData.date)}` : ""}
                            </Text>
                            <Text style={styles.lastOrange}>{lastLine}</Text>
                          </View>
                        ) : null}
                        {maxData?.max_weight != null && (
                          <View style={styles.statsRow}>
                            <View style={styles.stat}>
                              <Text style={styles.statLabelOrange}>PR</Text>
                              <Text style={styles.statVal}>{maxData.max_weight} lbs</Text>
                            </View>
                            {maxData.max_reps != null && maxData.max_reps > 0 && (
                              <View style={styles.stat}>
                                <Text style={styles.statLabel}>Est. 1RM</Text>
                                <Text style={styles.statVal}>
                                  {Math.round(maxData.max_weight * (1 + maxData.max_reps / 30))} lbs
                                </Text>
                              </View>
                            )}
                            {bestSetLabel && (
                              <View style={styles.stat}>
                                <Text style={styles.statLabel}>Best Set</Text>
                                <Text style={styles.statVal}>{bestSetLabel}</Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    )}

                    <View style={styles.exBody}>
                      {isCardio ? (
                        <View>
                          {ex.exercise_id === "default-cardio-sport-other" && (
                            <>
                              <Text style={styles.fieldLabel}>Sport</Text>
                              <TextInput
                                value={
                                  ex.exercise_name === "Other Sport" ? "" : ex.exercise_name
                                }
                                onChangeText={(v) =>
                                  patchExercise(idx, { exercise_name: v || "Other Sport" })
                                }
                                placeholder="What did you play?"
                                placeholderTextColor={colors.textMuted}
                                style={styles.field}
                              />
                            </>
                          )}
                          <Text style={styles.fieldLabel}>Time (minutes)</Text>
                          <TextInput
                            keyboardType="numeric"
                            value={ex.time != null ? String(ex.time) : ""}
                            onChangeText={(v) =>
                              patchExercise(idx, { time: v ? parseFloat(v) : undefined })
                            }
                            placeholder="e.g. 45"
                            placeholderTextColor={colors.textMuted}
                            style={styles.field}
                          />
                          {treadmillCardio && (
                            <>
                              <Text style={styles.fieldLabel}>Speed (mph)</Text>
                              <TextInput
                                keyboardType="decimal-pad"
                                value={ex.speed != null ? String(ex.speed) : ""}
                                onChangeText={(v) =>
                                  patchExercise(idx, { speed: v ? parseFloat(v) : undefined })
                                }
                                placeholder="—"
                                placeholderTextColor={colors.textMuted}
                                style={styles.field}
                              />
                            </>
                          )}
                          {sportCardio && (
                            <>
                              <View style={styles.sliderHead}>
                                <Text style={styles.fieldLabel}>Intensity</Text>
                                <Text style={styles.sliderVal}>{ex.intensity ?? 5}/10</Text>
                              </View>
                              <Slider
                                minimumValue={1}
                                maximumValue={10}
                                step={1}
                                value={ex.intensity ?? 5}
                                onValueChange={(v) => patchExercise(idx, { intensity: v })}
                                minimumTrackTintColor={colors.accentPrimary}
                                maximumTrackTintColor={colors.border}
                                thumbTintColor={colors.accentPrimary}
                              />
                              <View style={styles.sliderEnds}>
                                <Text style={styles.muted}>Easy</Text>
                                <Text style={styles.muted}>Max</Text>
                              </View>
                              <View style={styles.sliderHead}>
                                <Text style={styles.fieldLabel}>How tired do you feel?</Text>
                                <Text style={styles.sliderVal}>{ex.fatigue ?? 5}/10</Text>
                              </View>
                              <Slider
                                minimumValue={1}
                                maximumValue={10}
                                step={1}
                                value={ex.fatigue ?? 5}
                                onValueChange={(v) => patchExercise(idx, { fatigue: v })}
                                minimumTrackTintColor={colors.accentPrimary}
                                maximumTrackTintColor={colors.border}
                                thumbTintColor={colors.accentPrimary}
                              />
                              <View style={styles.sliderEnds}>
                                <Text style={styles.muted}>Fresh</Text>
                                <Text style={styles.muted}>Exhausted</Text>
                              </View>
                            </>
                          )}
                        </View>
                      ) : (
                        <View>
                          <View style={styles.setHead}>
                            <Text style={[styles.setCol, { flex: 0.7 }]}>SET</Text>
                            <Text style={[styles.setCol, { flex: 2 }]}>REPS</Text>
                            <Text style={[styles.setCol, { flex: 2 }]}>WEIGHT</Text>
                            <Text style={[styles.setCol, { flex: 1.2 }]}>RPE</Text>
                            <View style={{ width: 22 }} />
                          </View>
                          {exerciseSets.map((set, setIdx) => {
                            const lastSet = lastSets[setIdx];
                            return (
                              <View key={setIdx} style={styles.setRow}>
                                <View style={{ flex: 0.7 }}>
                                  <Text style={styles.setNum}>{set.set_number}</Text>
                                  {lastSet ? (
                                    <Text style={styles.lastHint}>
                                      {lastSet.weight != null && lastSet.weight > 0
                                        ? `${lastSet.reps}×${lastSet.weight}`
                                        : `${lastSet.reps}r`}
                                    </Text>
                                  ) : null}
                                </View>
                                <TextInput
                                  keyboardType="number-pad"
                                  value={set.reps === 0 ? "" : String(set.reps)}
                                  onChangeText={(v) =>
                                    updateSet(idx, setIdx, {
                                      reps: v === "" ? 0 : parseInt(v, 10) || 0,
                                    })
                                  }
                                  placeholder={
                                    lastSet && lastSet.reps > 0 ? String(lastSet.reps) : "—"
                                  }
                                  placeholderTextColor={colors.textMuted}
                                  style={[styles.setInput, { flex: 2 }]}
                                />
                                <TextInput
                                  keyboardType="decimal-pad"
                                  value={set.weight != null ? String(set.weight) : ""}
                                  onChangeText={(v) =>
                                    updateSet(idx, setIdx, {
                                      weight: v ? parseFloat(v) : undefined,
                                    })
                                  }
                                  placeholder={
                                    lastSet && lastSet.weight != null && lastSet.weight > 0
                                      ? String(lastSet.weight)
                                      : "—"
                                  }
                                  placeholderTextColor={colors.textMuted}
                                  style={[styles.setInput, { flex: 2 }]}
                                />
                                <TextInput
                                  keyboardType="number-pad"
                                  value={set.rpe != null ? String(set.rpe) : ""}
                                  onChangeText={(v) =>
                                    updateSet(idx, setIdx, {
                                      rpe: v ? parseInt(v, 10) : undefined,
                                    })
                                  }
                                  placeholder="—"
                                  placeholderTextColor={colors.textMuted}
                                  style={[styles.setInput, { flex: 1.2 }]}
                                />
                                <TouchableOpacity onPress={() => removeSet(idx, setIdx)}>
                                  <MaterialCommunityIcons
                                    name="close"
                                    size={16}
                                    color={colors.textMuted}
                                  />
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                          <TouchableOpacity style={styles.addSet} onPress={() => addSet(idx)}>
                            <Text style={styles.addSetText}>+ Add set</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                )}
              </View>
            );
          })}

          {formData.exercises.length > 0 && (
            <TouchableOpacity
              style={[styles.addDashed, { marginTop: 8 }]}
              onPress={() => {
                setShowExercisePicker(true);
                setPickerMode("browse");
              }}
            >
              <MaterialCommunityIcons name="plus" size={18} color={colors.textSecondary} />
              <Text style={styles.addDashedText}>Add exercise</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.listPad}>
      <View style={styles.listTop}>
        <Text style={styles.count}>
          {sessions.length} session{sessions.length !== 1 ? "s" : ""} logged
        </Text>
        <Button title="New Session" onPress={() => setShowForm(true)} />
      </View>

      {todaySession ? (
        <View style={styles.todayCard}>
          <View style={styles.todayLeft}>
            <View style={styles.todayIcon}>
              <MaterialCommunityIcons name="dumbbell" size={22} color={colors.accentPrimary} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.todayBadge}>TODAY'S WORKOUT</Text>
              <Text style={styles.todayTitle}>
                {splitLabel(todaySession) || todaySession.workout_name || "Workout"}
              </Text>
              <Text style={styles.muted}>
                {todaySessionExercises.length} exercise
                {todaySessionExercises.length !== 1 ? "s" : ""}
                {sessionDurationMinutes(todaySession)
                  ? ` · ${sessionDurationMinutes(todaySession)} min`
                  : ""}
              </Text>
            </View>
          </View>
          {todaySessionExercises.length > 0 && (
            <View style={styles.lastExRow}>
              {todaySessionExercises.slice(0, 4).map((ex, i) => (
                <View key={`${ex.exercise_id}-${i}`} style={styles.lastExChip}>
                  <Text style={styles.lastExChipText} numberOfLines={1}>
                    {ex.exercise_name}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <TouchableOpacity style={styles.startPlan} onPress={() => handleEdit(todaySession)}>
            <Text style={styles.startPlanText}>Open session</Text>
          </TouchableOpacity>
        </View>
      ) : todaysPlanWorkout?.status === "workout_day" ? (
        <View style={styles.todayCard}>
          <View style={styles.todayLeft}>
            <View style={styles.todayIcon}>
              <MaterialCommunityIcons name="dumbbell" size={22} color={colors.accentPrimary} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.todayBadge}>TODAY'S WORKOUT</Text>
              <Text style={styles.todayTitle}>{todaysPlanWorkout.day_name || "Workout"}</Text>
              <Text style={styles.muted}>
                {todaysPlanWorkout.exercises?.length || 0} exercises
              </Text>
            </View>
          </View>
          {(todaysPlanWorkout.exercises?.length || 0) > 0 && (
            <View style={styles.lastExRow}>
              {todaysPlanWorkout.exercises!.slice(0, 4).map((ex, i) => (
                <View key={`${ex.exercise_id}-${i}`} style={styles.lastExChip}>
                  <Text style={styles.lastExChipText} numberOfLines={1}>
                    {ex.exercise_name}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <TouchableOpacity style={styles.startPlan} onPress={handleStartPlan}>
            <Text style={styles.startPlanText}>Start Workout</Text>
          </TouchableOpacity>
        </View>
      ) : todaysPlanWorkout?.status === "rest_day" ? (
        <View style={styles.todayCard}>
          <Text style={styles.todayBadge}>TODAY'S WORKOUT</Text>
          <Text style={styles.todayTitle}>Rest day</Text>
        </View>
      ) : null}

      {weekGroups.map((group) => (
        <View key={group.key} style={styles.weekBlock}>
          <Text style={styles.weekLabel}>{group.label}</Text>
          <View style={styles.weekCard}>
            {group.sessions.map((session, index) => {
              const listedExercises = migrateSessionCardioToExercises(session);
              const exerciseCount = listedExercises.length;
              const minutes = sessionDurationMinutes(session);
              const label = splitLabel(session);
              const badge = splitBadgeColors(label);
              return (
                <View key={session.id || `${session.date}-${index}`}>
                  {index > 0 ? <View style={styles.weekDivider} /> : null}
                  <TouchableOpacity
                    style={styles.sessionRow}
                    onPress={() => handleEdit(session)}
                  >
                    <View style={styles.flex}>
                      <View style={styles.sessionTop}>
                        <Text style={styles.sessionDate}>{formatDateOrdinal(session.date)}</Text>
                        {badge && label ? (
                          <View style={[styles.splitBadge, { backgroundColor: badge.bg }]}>
                            <Text style={[styles.splitBadgeText, { color: badge.text }]}>
                              {label}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.sessionMeta}>
                        {exerciseCount} exercise{exerciseCount !== 1 ? "s" : ""}
                        {minutes != null ? ` · ${minutes} min` : ""}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => session.id && handleDelete(session.id)}
                      hitSlop={12}
                    >
                      <MaterialCommunityIcons
                        name="delete-outline"
                        size={18}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>
                    <MaterialCommunityIcons
                      name="chevron-right"
                      size={22}
                      color={colors.borderHover}
                    />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listPad: { padding: spacing.lg, paddingBottom: 40 },
  formPad: { padding: spacing.lg, paddingBottom: 80 },
  listTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
    gap: 12,
  },
  count: { color: colors.textSecondary, fontSize: 14, fontWeight: "500", flex: 1 },
  todayCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: "#9CC0E8",
    borderRadius: 16,
    padding: 20,
    marginBottom: spacing.lg,
  },
  todayLeft: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  todayIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(156, 192, 232,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  todayBadge: {
    color: colors.accentPrimary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  todayTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  exPlanLabel: {
    color: colors.accentPrimary,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  planBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(156, 192, 232,0.12)",
    marginBottom: 10,
  },
  planBannerText: {
    color: colors.accentPrimary,
    fontSize: 12,
    fontWeight: "700",
  },
  startPlan: {
    backgroundColor: colors.accentPrimary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  startPlanText: { color: colors.onAccent, fontWeight: "700" },
  lastExRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  lastExChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: "48%",
  },
  lastExChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "500" },
  weekBlock: { marginBottom: 20 },
  weekLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginBottom: 10,
  },
  weekCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    overflow: "hidden",
  },
  weekDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  sessionTop: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  sessionDate: { color: "#fff", fontSize: 16, fontWeight: "700" },
  splitBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  splitBadgeText: { fontSize: 11, fontWeight: "700" },
  sessionMeta: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  formHeader: { flexDirection: "row", gap: 10, marginBottom: 8 },
  backBtn: { paddingTop: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  formTitle: { color: "#fff", fontSize: 18, fontWeight: "700", flexShrink: 1 },
  splitRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  dropBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
  },
  dropBtnText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  menu: {
    marginTop: 6,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: "hidden",
  },
  menuItem: { paddingHorizontal: 12, paddingVertical: 10 },
  menuItemActive: { backgroundColor: "rgba(156, 192, 232,0.2)" },
  menuText: { color: "#fff", fontSize: 13 },
  muted: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  savedHint: { color: colors.textMuted, fontSize: 11, marginBottom: 8 },
  timerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  timerText: { color: "#fff", fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  timerBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  timerBtnText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  finishBtn: {
    marginLeft: "auto",
    backgroundColor: colors.accentPrimary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  finishText: { color: colors.onAccent, fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.4 },
  error: { color: colors.danger, fontSize: 12, marginBottom: 8 },
  detailsToggle: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 12 },
  notes: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: "#fff",
    padding: 12,
    marginBottom: 16,
  },
  searchWrap: { justifyContent: "center", marginBottom: 10 },
  searchIcon: { position: "absolute", left: 14, zIndex: 1 },
  searchInput: {
    height: 44,
    paddingLeft: 40,
    paddingRight: 16,
    borderRadius: 12,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    color: "#fff",
  },
  pills: { marginBottom: 12, flexGrow: 0 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  pillActive: {
    borderColor: colors.accentPrimary,
    backgroundColor: "rgba(156, 192, 232,0.1)",
  },
  pillText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  pillTextActive: { color: colors.accentPrimary },
  addDashed: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderHover,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12,
  },
  addDashedText: { color: colors.textSecondary, fontSize: 14, fontWeight: "600" },
  exCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 16,
  },
  exHeader: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  exName: { color: "#fff", fontSize: 16, fontWeight: "700" },
  exMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  lastOrange: { color: colors.accentPrimary, fontSize: 12, lineHeight: 18 },
  lastOrangeHeader: { color: colors.accentPrimary, fontSize: 12, marginTop: 4, lineHeight: 18 },
  exHeaderRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  setCount: { color: colors.textSecondary, fontSize: 12 },
  aiBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(94,234,212,0.15)",
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  aiBadgeText: { color: colors.ai, fontSize: 10, fontWeight: "700" },
  aiBand: {
    backgroundColor: "#142422",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(94,234,212,0.2)",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  aiLoading: { color: colors.ai, fontWeight: "600", marginLeft: 8 },
  aiHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 },
  aiCoach: {
    color: colors.ai,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  aiSaved: { color: "rgba(94,234,212,0.7)", fontSize: 10, fontWeight: "600" },
  confBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(94,234,212,0.15)",
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.3)",
  },
  confText: { color: colors.ai, fontSize: 10, fontWeight: "700" },
  aiLast: { color: colors.textMuted, fontSize: 11, marginBottom: 10 },
  startBox: {
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.3)",
    backgroundColor: "rgba(11,12,16,0.6)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  startHint: { color: colors.textSecondary, fontSize: 12, marginBottom: 8 },
  startRow: { gap: 8 },
  startInput: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    color: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  useStart: {
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.4)",
    backgroundColor: "rgba(94,234,212,0.1)",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  useStartText: { color: colors.ai, fontWeight: "600", fontSize: 13 },
  recSets: { flexDirection: "row", gap: 8, marginBottom: 10 },
  recSet: {
    flex: 1,
    backgroundColor: "rgba(11,12,16,0.5)",
    borderRadius: 12,
    padding: 10,
  },
  recSetLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  recSetVal: { color: "#fff", fontSize: 13, fontWeight: "700", marginTop: 4 },
  reasoning: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  applySets: {
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.4)",
    borderRadius: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  applySetsText: { color: colors.ai, fontWeight: "600", fontSize: 13 },
  statsBand: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(42,45,53,0.6)",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  historyBox: {
    marginHorizontal: 16,
    marginBottom: 4,
    marginTop: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(156, 192, 232,0.28)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  historyLast: {},
  statsRow: { flexDirection: "row" },
  stat: { flex: 1 },
  statLabelOrange: { color: colors.accentPrimary, fontSize: 10, fontWeight: "700" },
  statLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "600" },
  statVal: { color: "#fff", fontSize: 14, fontWeight: "700", marginTop: 2 },
  exBody: { paddingHorizontal: 16, paddingVertical: 16 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 8,
  },
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 12,
    color: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sliderHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  sliderVal: { color: colors.accentPrimary, fontWeight: "700" },
  sliderEnds: { flexDirection: "row", justifyContent: "space-between" },
  setHead: { flexDirection: "row", gap: 8, marginBottom: 8 },
  setCol: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  setRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  setNum: { color: colors.textSecondary, fontSize: 14 },
  lastHint: { color: colors.textMuted, fontSize: 9 },
  setInput: {
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: "#fff",
    textAlign: "center",
    fontSize: 14,
  },
  addSet: {
    marginTop: 4,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  addSetText: { color: colors.textSecondary, fontWeight: "600" },
});
