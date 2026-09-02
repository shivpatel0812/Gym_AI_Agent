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
import ImportSessionModal from "./ImportSessionModal";
import {
  buildSessionPayload,
  confidencePct,
  emptySessionForm,
  emptyWorkoutSets,
  formatLastPerformance,
  formatShortDate,
  formatDateOrdinal,
  getBestSetLabel,
  formatExerciseSetsSummary,
  getRecentMuscleGroupLogs,
  muscleGroupHistoryLabel,
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
  layoutExercisesFromSession,
  mapRecSets,
  migrateSessionCardioToExercises,
  MUSCLE_GROUP_LABELS,
  muscleGroupsForSplitDay,
  recCopiesLastWorkout,
  recHasWeightedSets,
  resolveExerciseCategory,
  resolveLastExercise,
  sessionDurationMinutes,
  sessionHeadline,
  sessionToForm,
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
 * Older saved recommendations may contain paragraph-length LLM prose. Keep
 * short explanations as written; replace verbose ones with a complete summary
 * derived from the recommendation itself instead of clipping them in the UI.
 */
function compactRecommendationReasoning(recommendation: any): string {
  const reasoning = String(recommendation?.reasoning || "").replace(/\s+/g, " ").trim();
  if (!reasoning || (reasoning.length <= 150 && reasoning.split(" ").length <= 22)) {
    return reasoning;
  }

  const firstSet = Array.isArray(recommendation?.sets) ? recommendation.sets[0] : null;
  const weight = Number(firstSet?.weight || 0);
  const reps = Number(
    firstSet?.preferred_reps ?? firstSet?.reps ?? recommendation?.suggested_reps ?? 0
  );
  const load = weight > 0 ? ` at ${weight} lbs` : "";

  switch (recommendation?.progression_type) {
    case "increase_reps":
    case "bodyweight_progress":
      return reps > 0
        ? `Last session earned a rep increase—aim for ${reps} reps${load}.`
        : "Last session earned a small rep increase while keeping the same load.";
    case "increase_weight":
      return weight > 0
        ? `You reached the top of your range, so move to ${weight} lbs and rebuild reps.`
        : "You reached the top of your range, so increase the load and rebuild reps.";
    case "fill_band":
      return `Keep the same load and bring every set into the target rep range.`;
    case "maintain":
      return `Hold the current load while you rebuild consistent reps.`;
    case "deload":
      return weight > 0
        ? `Use ${weight} lbs this session to recover before resuming progression.`
        : "Use a lighter session to recover before resuming progression.";
    case "first_session":
      return weight > 0
        ? `Use this session to establish a clean baseline at ${weight} lbs.`
        : "Use this session to establish a clean baseline.";
    default:
      return "This target follows your latest completed session and current rep range.";
  }
}

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
  const [showImportModal, setShowImportModal] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<"top" | "bottom" | "inline">("top");
  const [exerciseInsertAfter, setExerciseInsertAfter] = useState<number | null>(null);
  const sessionScrollRef = useRef<ScrollView>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<"browse" | "search">("browse");
  const [selectedBodyPart, setSelectedBodyPart] = useState<string | null>(null);
  const [equipmentFilter, setEquipmentFilter] = useState<string | null>(null);
  const [showSessionDetails, setShowSessionDetails] = useState(false);
  const [activeMuscleFilter, setActiveMuscleFilter] = useState<{
    cardIdx: number;
    group: string;
  } | null>(null);
  const [collapsedHistoryCards, setCollapsedHistoryCards] = useState<Set<number>>(new Set());
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
  const staleRecRetryRef = useRef<Set<string>>(new Set());
  const latestNextSetRequestRef = useRef<Record<string, string>>({});
  const previousNextSetRequestRef = useRef<Record<string, string>>({});
  const previousSuggestedSetRef = useRef<Record<string, { index: number; set: WorkoutSet }>>({});
  const [updatedSetIndex, setUpdatedSetIndex] = useState<Record<string, number>>({});
  const fetchedLastRef = useRef<Set<string>>(new Set());
  const formDataRef = useRef(formData);
  const editingSessionIdRef = useRef(editingSessionId);
  // Which sets were already complete, so a transition fires the suggestion
  // exactly once rather than on every subsequent render.
  const completedSetsRef = useRef<Record<string, boolean>>({});
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
  const splitMuscleGroups = useMemo(
    () =>
      muscleGroupsForSplitDay(
        formData.split_day || activePlanDay?.day_name,
        formData.split_name || activePlanDay?.plan_name
      ),
    [formData.split_day, formData.split_name, activePlanDay]
  );
  const resolveCategory = useCallback(
    (exerciseId: string, exerciseName: string) =>
      resolveExerciseCategory(exerciseId, exerciseName, exercises),
    [exercises]
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

  useEffect(() => {
    setActiveMuscleFilter(null);
  }, [formData.split_day, formData.split_name]);

  const performAutoSave = useCallback(
    async () => {
      const run = async () => {
        const data = formDataRef.current;
        const payload = buildSessionPayload(data, timerPersistRef.current());
        const canSave = payload.exercises.length > 0 || hasCardioLog(data);
        if (!canSave) {
          // Nothing valid to write. Distinct from a failed request, and not an
          // error while the user is still filling the form in — but it must not
          // read as a successful save either.
          return false;
        }
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
          return {
            ...prev,
            exercises: prev.exercises.map((ex) =>
              ex.exercise_id === exerciseId
                ? {
                    ...ex,
                    ai_recommendation: stored,
                    ...(rec?.plan_context ? { plan_context: rec.plan_context } : {}),
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

  const handleExerciseChange = async (
    exerciseId: string,
    exerciseName: string,
    options?: { insertAfter?: number | null }
  ) => {
    const selectedExercise = allExercises.find((ex) => ex.id === exerciseId);
    const isCardio = selectedExercise?.category === "CARDIO";
    const insertAfter =
      options && "insertAfter" in options ? options.insertAfter ?? null : exerciseInsertAfter;
    const positionInWorkout =
      insertAfter != null ? insertAfter + 1 : formData.exercises.length;
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
    const newExercise: SessionExercise = isCardio
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
          sets: emptyWorkoutSets(3),
        };
    setFormData((prev) => {
      const next = [...prev.exercises];
      if (insertAfter != null && insertAfter >= 0) {
        next.splice(insertAfter + 1, 0, newExercise);
      } else {
        next.push(newExercise);
      }
      return { ...prev, exercises: next };
    });
    if (!isCardio) {
      fetchAiRecommendation(exerciseId, exerciseName, positionInWorkout);
    }
    setExerciseInsertAfter(null);
    setExerciseSearchQuery("");
    setCategoryFilter(null);
    setShowExercisePicker(false);
    setPickerAnchor("top");
    setSelectedBodyPart(null);
    setEquipmentFilter(null);
  };

  const addExerciseFromHistory = (
    exerciseId: string,
    exerciseName: string,
    insertAfter?: number | null
  ) => {
    if (formData.exercises.some((ex) => ex.exercise_id === exerciseId)) {
      Alert.alert("Already added", `${exerciseName} is already in this workout.`);
      return;
    }
    void handleExerciseChange(exerciseId, exerciseName, {
      insertAfter: insertAfter ?? null,
    });
  };

  const closeExercisePicker = () => {
    setExerciseInsertAfter(null);
    setShowExercisePicker(false);
    setPickerAnchor("top");
    setSelectedBodyPart(null);
    setEquipmentFilter(null);
    setExerciseSearchQuery("");
    setCategoryFilter(null);
  };

  const openExercisePicker = (
    anchor: "top" | "bottom" | "inline",
    mode: "browse" | "search" = "browse",
    insertAfterIndex?: number | null
  ) => {
    if (insertAfterIndex !== undefined) {
      setExerciseInsertAfter(insertAfterIndex);
    }
    setPickerAnchor(anchor);
    setShowExercisePicker(true);
    setPickerMode(mode);
    if (mode === "browse" && anchor === "top") {
      setSelectedBodyPart(null);
      setEquipmentFilter(null);
    }
    if (anchor === "bottom") {
      setTimeout(() => sessionScrollRef.current?.scrollToEnd({ animated: true }), 150);
    }
  };

  const renderExercisePickerPanel = (panelKey: string) => (
    <>
      <View style={[styles.searchWrap, panelKey !== "top" && { marginTop: 8 }]}>
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
            if (q) openExercisePicker(pickerAnchor, "search");
          }}
          onFocus={() =>
            openExercisePicker(pickerAnchor, exerciseSearchQuery ? "search" : "browse")
          }
          placeholder="Search exercises..."
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pills}>
        {categoryFilterPills.map((pill) => (
          <TouchableOpacity
            key={`${panelKey}-${pill.label}`}
            onPress={() => {
              setCategoryFilter(pill.id);
              openExercisePicker(pickerAnchor, "browse");
              if (pill.id === "ARMS") setSelectedBodyPart("BICEPS");
              else if (pill.id === "CORE") setSelectedBodyPart("CORE / ABS");
              else if (pill.id) setSelectedBodyPart(pill.id);
              else setSelectedBodyPart(null);
            }}
            style={[styles.pill, categoryFilter === pill.id && styles.pillActive]}
          >
            <Text style={[styles.pillText, categoryFilter === pill.id && styles.pillTextActive]}>
              {pill.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
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
        onClose={closeExercisePicker}
      />
    </>
  );

  const toggleMuscleHistory = (cardIdx: number, expand?: boolean) => {
    setCollapsedHistoryCards((prev) => {
      const next = new Set(prev);
      if (expand === true) next.delete(cardIdx);
      else if (expand === false) next.add(cardIdx);
      else if (next.has(cardIdx)) next.delete(cardIdx);
      else next.add(cardIdx);
      return next;
    });
  };

  const renderMuscleHistory = (cardIdx: number, exerciseGroup: string | null) => {
    const group =
      activeMuscleFilter?.cardIdx === cardIdx
        ? activeMuscleFilter.group
        : exerciseGroup;
    if (!group) return null;

    const expanded = !collapsedHistoryCards.has(cardIdx);
    const recentLogs = getRecentMuscleGroupLogs(
      sessions,
      group,
      resolveCategory,
      editingSessionId,
      5
    );
    const groupLabel = MUSCLE_GROUP_LABELS[group]?.toLowerCase() || "muscle";

    return (
      <>
        <TouchableOpacity
          style={styles.recentHistoryHeader}
          onPress={() => toggleMuscleHistory(cardIdx)}
          activeOpacity={0.7}
        >
          <Text style={styles.recentHistoryLabel}>{muscleGroupHistoryLabel(group)}</Text>
          <MaterialCommunityIcons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
        {expanded ? (
          !recentLogs.length ? (
            <Text style={styles.muscleHistoryEmpty}>No recent {groupLabel} work logged yet.</Text>
          ) : (
          <View style={styles.muscleHistory}>
            {recentLogs.map(({ session, exercise: hit }) => {
              const alreadyAdded = formData.exercises.some(
                (ex) => ex.exercise_id === hit.exercise_id
              );
              const setsSummary = formatExerciseSetsSummary(hit);
              return (
                <TouchableOpacity
                  key={`${session.id}-${hit.exercise_id}-${session.date}`}
                  style={[
                    styles.muscleHistoryRow,
                    alreadyAdded && styles.muscleHistoryRowAdded,
                  ]}
                  disabled={alreadyAdded}
                  onPress={() =>
                    addExerciseFromHistory(hit.exercise_id, hit.exercise_name, cardIdx)
                  }
                >
                  <View style={styles.muscleHistoryMain}>
                    <View style={styles.muscleHistoryTopLine}>
                      <Text style={styles.muscleHistoryDate}>
                        {formatShortDate(String(session.date || ""))}
                      </Text>
                      <Text
                        style={[
                          styles.muscleHistoryName,
                          alreadyAdded && styles.muscleHistoryNameAdded,
                        ]}
                        numberOfLines={2}
                      >
                        {hit.exercise_name}
                      </Text>
                    </View>
                    <Text style={styles.muscleHistoryPerf}>{setsSummary}</Text>
                  </View>
                  {!alreadyAdded ? (
                    <MaterialCommunityIcons
                      name="plus-circle-outline"
                      size={18}
                      color={colors.accentPrimary}
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="check-circle-outline"
                      size={18}
                      color={colors.textMuted}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          )
        ) : null}
      </>
    );
  };

  const hydrateImportedExercises = async (imported: SessionExercise[], startIdx: number) => {
    for (let i = 0; i < imported.length; i++) {
      const ex = imported[i];
      const idx = startIdx + i;
      try {
        const response = await apiClient.get(lastExerciseUrl(ex.exercise_id));
        if (response.data) {
          setLastExerciseData((prev) => ({ ...prev, [ex.exercise_id]: response.data }));
        }
      } catch {}
      try {
        const maxResponse = await apiClient.get(
          `/api/workout-sessions/max-exercise/${ex.exercise_id}`
        );
        if (maxResponse.data) {
          setMaxExerciseData((prev) => ({ ...prev, [ex.exercise_id]: maxResponse.data }));
        }
      } catch {}
      if (!isCardioExercise(ex)) {
        fetchAiRecommendation(ex.exercise_id, ex.exercise_name, idx);
      }
    }
  };

  const applyImportedLayout = (source: WorkoutSession, mode: "replace" | "append") => {
    const imported = layoutExercisesFromSession(source);
    if (!imported.length) {
      Alert.alert("Nothing to import", "That workout has no exercises to copy.");
      return;
    }

    const splitPatch =
      mode === "replace" || !formData.split_day
        ? {
            split_id: source.split_id || formData.split_id,
            split_name: source.split_name || source.workout_name || formData.split_name,
            split_day: source.split_day || formData.split_day,
          }
        : {};

    let nextExercises: SessionExercise[];
    let startIdx: number;
    if (mode === "replace") {
      nextExercises = imported;
      startIdx = 0;
    } else {
      const existingIds = new Set(formData.exercises.map((ex) => ex.exercise_id));
      const toAdd = imported.filter((ex) => !existingIds.has(ex.exercise_id));
      if (!toAdd.length) {
        Alert.alert("Already added", "Every exercise from that workout is already in this session.");
        return;
      }
      startIdx = formData.exercises.length;
      nextExercises = [...formData.exercises, ...toAdd];
    }

    setFormData((prev) => ({
      ...prev,
      ...splitPatch,
      exercises: nextExercises,
    }));
    setShowImportModal(false);
    closeExercisePicker();

    const importedSlice =
      mode === "replace" ? imported : nextExercises.slice(startIdx);
    hydrateImportedExercises(importedSlice, startIdx);
  };

  const handleImportSession = (source: WorkoutSession) => {
    if (formData.exercises.length === 0) {
      applyImportedLayout(source, "replace");
      return;
    }
    Alert.alert(
      "Import workout layout",
      "Add these exercises to your current list, or replace what you have?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Add to list", onPress: () => applyImportedLayout(source, "append") },
        { text: "Replace all", style: "destructive", onPress: () => applyImportedLayout(source, "replace") },
      ]
    );
  };

  const resetForm = () => {
    setFormData(emptySessionForm());
    setActivePlanDay(null);
    setEditingSessionId(null);
    setShowForm(false);
    setShowExercisePicker(false);
    setPickerAnchor("top");
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
      if (!saved) {
        // Previously this only bailed when there was no session id yet, so a
        // failed final write to an *existing* session fell through, reset the
        // form and reported success — silently discarding every set added
        // since the last autosave. A failed save is a failed save.
        setSaveError(
          editingSessionIdRef.current
            ? "Could not save your latest changes — check your connection and try again."
            : "Could not save workout"
        );
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
        const setCount = Math.max(1, Number(ex.sets) || 3);
        return {
          exercise_id: ex.exercise_id,
          exercise_name: ex.exercise_name,
          // Resolved server-side; carried through for display only
          plan_context: ex.plan_context,
          sets: emptyWorkoutSets(setCount),
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

  /**
   * Every reps/weight/set edit funnels through here.
   *
   * Must be a functional update. Reading `formData` from the render closure
   * loses writes: the AI-recommendation response updates the same state
   * functionally and lands between a keystroke and its re-render, so whichever
   * committed second silently discarded the other. When the typed reps were
   * the casualty, the set failed `isValidSet`, the exercise was stripped from
   * the payload, `canSave` went false — and the workout simply never saved,
   * with no error shown.
   */
  const patchExercise = (idx: number, patch: Partial<SessionExercise>) => {
    setFormData((prev) => {
      if (idx < 0 || idx >= prev.exercises.length) return prev;
      const next = [...prev.exercises];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, exercises: next };
    });
  };

  /** Same rule: derive from `prev`, never from the closure. */
  const patchSet = (
    exerciseIdx: number,
    setIdx: number,
    patch: Partial<WorkoutSet>
  ) => {
    setFormData((prev) => {
      const exercise = prev.exercises[exerciseIdx];
      if (!exercise || !Array.isArray(exercise.sets)) return prev;
      const sets = [...exercise.sets];
      if (setIdx < 0 || setIdx >= sets.length) return prev;
      sets[setIdx] = { ...sets[setIdx], ...patch };
      const next = [...prev.exercises];
      next[exerciseIdx] = { ...exercise, sets };
      return { ...prev, exercises: next };
    });
  };

  const removeExercise = (exerciseIdx: number) => {
    setFormData((prev) => ({
      ...prev,
      exercises: prev.exercises.filter((_, i) => i !== exerciseIdx),
    }));
  };

  const addSet = (idx: number) => {
    setFormData((prev) => {
      const exercise = prev.exercises[idx];
      if (!exercise) return prev;
      const currentSets = Array.isArray(exercise.sets) ? exercise.sets : [];
      const next = [...prev.exercises];
      next[idx] = {
        ...exercise,
        sets: [
          ...currentSets,
          {
            set_number: currentSets.length + 1,
            reps: 0,
            weight: undefined,
            completed: false,
          },
        ],
      };
      return { ...prev, exercises: next };
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

  /**
   * Every keystroke in a reps or weight field lands here.
   *
   * The sets array is rebuilt from `prev` inside the updater, never from the
   * render closure. Reading `formData.exercises[...]` out here meant that two
   * edits committed in one React batch — or an edit racing the AI
   * recommendation, which updates the same state functionally — handed
   * `patchExercise` an array built from state that had already moved on. The
   * later write reverted the earlier one, and a reverted set fails
   * `isValidSet`, gets stripped from the payload, and takes the whole save
   * with it: `canSave` goes false and nothing is written, silently.
   *
   * The follow-up suggestion is fired from an effect rather than from inside
   * the updater, so the updater stays pure and safe to re-invoke.
   */
  const updateSet = (exerciseIdx: number, setIdx: number, patch: Partial<WorkoutSet>) => {
    setFormData((prev) => {
      const exercise = prev.exercises[exerciseIdx];
      if (!exercise || !Array.isArray(exercise.sets)) return prev;
      const sets = [...exercise.sets];
      if (setIdx < 0 || setIdx >= sets.length) return prev;
      const updated: WorkoutSet = { ...sets[setIdx], ...patch };
      updated.completed = isValidSet(updated);
      sets[setIdx] = updated;
      const exercises = [...prev.exercises];
      exercises[exerciseIdx] = { ...exercise, sets };
      return { ...prev, exercises };
    });
  };

  // Fire the next-set suggestion when a set actually transitions to complete,
  // read from committed state rather than guessed at inside a state updater.
  useEffect(() => {
    const seen = completedSetsRef.current;
    formData.exercises.forEach((exercise, exerciseIdx) => {
      if (!Array.isArray(exercise.sets)) return;
      exercise.sets.forEach((set, setIdx) => {
        const key = `${exercise.exercise_id}:${setIdx}`;
        const isComplete = Boolean(set.completed);
        const wasComplete = Boolean(seen[key]);
        seen[key] = isComplete;
        if (isComplete && !wasComplete && showForm) {
          void recommendNextAfterCompletedSet(
            exerciseIdx,
            exercise.sets as WorkoutSet[],
            setIdx
          );
        }
      });
    });
  }, [formData.exercises, showForm]);

  const recommendNextAfterCompletedSet = async (
    exerciseIdx: number,
    sets: WorkoutSet[],
    completedSetIdx: number
  ) => {
    const exercise = formDataRef.current.exercises[exerciseIdx];
    if (!exercise || !Array.isArray(exercise.sets)) return;

    const remaining = sets.filter((s) => !s.completed);
    if (!remaining.length) return;

    const completed = sets.filter((s) => s.completed);
    const set = sets[completedSetIdx];
    const earlierExercises = formDataRef.current.exercises.slice(0, exerciseIdx).map((ex) => ({
      exercise_id: ex.exercise_id,
      exercise_name: ex.exercise_name,
      sets: Array.isArray(ex.sets) ? ex.sets.filter((s) => s.completed === true) : [],
    }));
    const requestId = `${exercise.exercise_id}-${set.set_number}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    latestNextSetRequestRef.current[exercise.exercise_id] = requestId;
    try {
      const response = await apiClient.post(
        `/api/workout-sessions/ai-recommendation/${exercise.exercise_id}/next-set`,
        {
          exercise_name: exercise.exercise_name,
          completed_sets: completed,
          remaining_sets: remaining,
          current_workout_exercises: earlierExercises,
          base_recommendation: aiRecommendations[exercise.exercise_id] || exercise.ai_recommendation,
          request_id: requestId,
          previous_request_id:
            previousNextSetRequestRef.current[exercise.exercise_id] ||
            exercise.ai_recommendation?.next_set_request_id,
        }
      );
      if (latestNextSetRequestRef.current[exercise.exercise_id] !== requestId) return;
      if (response.data?.request_id && response.data.request_id !== requestId) return;
      previousNextSetRequestRef.current[exercise.exercise_id] = requestId;
      if (response.data?.status !== "success" || !response.data.next_set) return;
      const nextIndex = sets.findIndex((s) => !s.completed);
      if (nextIndex < 0) return;
      const next = response.data.next_set;
      const updatedRecommendation = {
        ...(aiRecommendations[exercise.exercise_id] || exercise.ai_recommendation || {}),
        next_set_reasoning: response.data.reasoning,
        next_set_action: response.data.action,
        next_set_request_id: requestId,
        suggested_next_set: next,
        suggested_next_set_index: nextIndex,
      };
      patchExercise(exerciseIdx, {
        ai_recommendation: toStoredRecommendation(updatedRecommendation),
      });
      setAiRecommendations((prev) => ({ ...prev, [exercise.exercise_id]: updatedRecommendation }));
      setUpdatedSetIndex((prev) => ({ ...prev, [exercise.exercise_id]: nextIndex }));
    } catch {
      // Set is still logged; next-set suggestion is best-effort.
    }
  };

  const undoNextSetRecommendation = (exerciseIdx: number) => {
    const exercise = formDataRef.current.exercises[exerciseIdx];
    const previous = exercise && previousSuggestedSetRef.current[exercise.exercise_id];
    if (!exercise || !Array.isArray(exercise.sets) || !previous) return;
    const sets = [...exercise.sets];
    sets[previous.index] = previous.set;
    const requestId = previousNextSetRequestRef.current[exercise.exercise_id];
    delete previousSuggestedSetRef.current[exercise.exercise_id];
    patchExercise(exerciseIdx, { sets });
    setUpdatedSetIndex((current) => {
      const next = { ...current };
      delete next[exercise.exercise_id];
      return next;
    });
    setAiRecommendations((prev) => ({
      ...prev,
      [exercise.exercise_id]: {
        ...(prev[exercise.exercise_id] || {}),
        next_set_reasoning: "Original planned set restored.",
        next_set_action: "rejected",
      },
    }));
    if (requestId) {
      apiClient.post("/api/workout-sessions/ai-recommendation-feedback", {
        request_id: requestId,
        accepted: false,
        reason: "user_restored_original_set",
      }).catch(() => {});
    }
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
    const category = resolveExerciseCategory(exerciseId, exerciseName, exercises);
    if (category) {
      return MUSCLE_GROUP_LABELS[category] || category.charAt(0) + category.slice(1).toLowerCase();
    }
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
          ref={sessionScrollRef}
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

          <View style={styles.sessionHeaderCard}>
            <View style={styles.formHeader}>
              <TouchableOpacity onPress={handleCancel} style={styles.backBtn}>
                <MaterialCommunityIcons name="arrow-left" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              <View style={styles.flex}>
                <View style={styles.titleRow}>
                  <Text style={styles.formTitle} numberOfLines={1}>
                    {formData.split_day || formData.split_name || "Workout"}
                  </Text>
                  <TouchableOpacity
                    style={styles.dateChip}
                    onPress={() => setShowDatePicker(true)}
                    hitSlop={8}
                  >
                    <MaterialCommunityIcons
                      name="calendar-outline"
                      size={12}
                      color={colors.accentPrimary}
                    />
                    <Text style={styles.dateChipText}>{formatShortDate(formData.date)}</Text>
                  </TouchableOpacity>
                  <View style={styles.saveBadgeInline}>
                    <MaterialCommunityIcons
                      name={
                        isAutoSaving
                          ? "cloud-sync-outline"
                          : lastSaved
                            ? "cloud-check-outline"
                            : "cloud-outline"
                      }
                      size={13}
                      color={
                        isAutoSaving
                          ? colors.warning
                          : lastSaved
                            ? colors.success
                            : colors.textMuted
                      }
                    />
                    <Text style={styles.saveBadgeText} numberOfLines={1}>
                      {isAutoSaving
                        ? "Saving"
                        : lastSaved
                          ? lastSaved.toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : formData.exercises.length > 0
                            ? "Auto-save"
                            : ""}
                    </Text>
                  </View>
                  {Platform.OS === "web" ? (
                    <input
                      type="date"
                      value={formData.date}
                      onChange={(e: any) => {
                        if (e.target.value) {
                          setFormData((prev) => ({ ...prev, date: e.target.value }));
                        }
                      }}
                      aria-label="Workout date"
                      style={{
                        position: "absolute",
                        right: 0,
                        top: 0,
                        width: 88,
                        height: 28,
                        opacity: 0,
                        cursor: "pointer",
                      }}
                    />
                  ) : null}
                </View>
                {Platform.OS !== "web" && showDatePicker ? (
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
                        setFormData((prev) => ({ ...prev, date: `${y}-${m}-${d}` }));
                      }
                    }}
                  />
                ) : null}
                <View style={styles.splitRow}>
                  <TouchableOpacity
                    style={[styles.dropBtn, styles.dropBtnFlex]}
                    onPress={() => {
                      setShowSplitDropdown(!showSplitDropdown);
                      setShowDayDropdown(false);
                    }}
                  >
                    <Text style={styles.dropBtnLabel}>Split</Text>
                    <View style={styles.dropBtnValueRow}>
                      <Text style={styles.dropBtnText} numberOfLines={1}>
                        {formData.split_id
                          ? splits.find((s) => s.id === formData.split_id)?.name ||
                            formData.split_name ||
                            "Split"
                          : "None"}
                      </Text>
                      <MaterialCommunityIcons
                        name="chevron-down"
                        size={14}
                        color={colors.textSecondary}
                      />
                    </View>
                  </TouchableOpacity>
                  {formData.split_id && selectedSplit?.days?.length ? (
                    <TouchableOpacity
                      style={[styles.dropBtn, styles.dropBtnFlex]}
                      onPress={() => {
                        setShowDayDropdown(!showDayDropdown);
                        setShowSplitDropdown(false);
                      }}
                    >
                      <Text style={styles.dropBtnLabel}>Day</Text>
                      <View style={styles.dropBtnValueRow}>
                        <Text style={styles.dropBtnText} numberOfLines={1}>
                          {formData.split_day || "Pick day"}
                        </Text>
                        <MaterialCommunityIcons
                          name="chevron-down"
                          size={14}
                          color={colors.textSecondary}
                        />
                      </View>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {showSplitDropdown ? (
                  <View style={styles.menu}>
                    <TouchableOpacity
                      onPress={() => {
                        setFormData((prev) => ({ ...prev, split_id: "", split_name: "", split_day: "" }));
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
                          setFormData((prev) => ({
                            ...prev,
                            split_id: split.id || "",
                            split_name: split.name,
                            split_day: onlyDay,
                          }));
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
                ) : null}
                {showDayDropdown && selectedSplit?.days ? (
                  <View style={styles.menu}>
                    {selectedSplit.days.map((day, index) => (
                      <TouchableOpacity
                        key={index}
                        onPress={() => {
                          setFormData((prev) => ({ ...prev, split_day: day }));
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
                ) : null}
              </View>
            </View>

            <View style={styles.controlDivider} />
            <View style={styles.controlRow}>
              <Text style={styles.timerTextLarge}>{timer.formattedTime}</Text>
              <View style={styles.timerControls}>
                <TouchableOpacity
                  style={[styles.timerBtn, timer.isRunning && styles.timerBtnActive]}
                  onPress={timer.isRunning ? timer.stop : timer.start}
                >
                  <MaterialCommunityIcons
                    name={timer.isRunning ? "pause" : "play"}
                    size={14}
                    color={timer.isRunning ? colors.accentPrimary : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.timerBtnText,
                      timer.isRunning && styles.timerBtnTextActive,
                    ]}
                  >
                    {timer.isRunning ? "Pause" : "Start"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconCircle} onPress={timer.refresh}>
                  <MaterialCommunityIcons name="refresh" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={[
                  styles.finishBtn,
                  styles.finishBtnFlex,
                  ((formData.exercises.length === 0 && !hasCardioLog(formData)) || isSaving) &&
                    styles.disabled,
                ]}
                disabled={
                  (formData.exercises.length === 0 && !hasCardioLog(formData)) || isSaving
                }
                onPress={handleFinish}
              >
                <Text style={styles.finishText}>{isSaving ? "..." : "Finish"}</Text>
              </TouchableOpacity>
            </View>
          </View>
          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

          <TouchableOpacity
            style={styles.detailsRow}
            onPress={() => setShowSessionDetails(!showSessionDetails)}
          >
            <Text style={styles.detailsToggle}>Session details</Text>
            <MaterialCommunityIcons
              name={showSessionDetails ? "chevron-up" : "chevron-down"}
              size={16}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
          {showSessionDetails && (
            <TextInput
              value={formData.notes}
              onChangeText={(notes) => setFormData((prev) => ({ ...prev, notes }))}
              placeholder="How did the workout feel?"
              placeholderTextColor={colors.textMuted}
              style={styles.notes}
              multiline
            />
          )}

          {(!showExercisePicker || pickerAnchor === "top") && (
            <>
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
                    if (q) openExercisePicker("top", "search");
                  }}
                  onFocus={() => openExercisePicker("top", exerciseSearchQuery ? "search" : "browse")}
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
                      openExercisePicker("top", "browse");
                      if (pill.id === "ARMS") setSelectedBodyPart("BICEPS");
                      else if (pill.id === "CORE") setSelectedBodyPart("CORE / ABS");
                      else if (pill.id) setSelectedBodyPart(pill.id);
                      else setSelectedBodyPart(null);
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
            </>
          )}

          <TouchableOpacity
            style={styles.importButton}
            onPress={() => setShowImportModal(true)}
          >
            <MaterialCommunityIcons name="history" size={18} color={colors.accentPrimary} />
            <Text style={styles.importButtonText}>Import from previous workout</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.addDashed}
            onPress={() => openExercisePicker("top", "browse", null)}
          >
            <MaterialCommunityIcons name="plus" size={18} color={colors.textSecondary} />
            <Text style={styles.addDashedText}>Add exercise</Text>
          </TouchableOpacity>

          {showExercisePicker && pickerAnchor === "top" && renderExercisePickerPanel("top")}

          {formData.exercises.map((ex, idx) => {
            const exerciseSets = Array.isArray(ex.sets) ? ex.sets : [];
            const isCardio = isCardioExercise(ex);
            const sportCardio = isSportCardio(ex);
            const treadmillCardio = isTreadmillCardio(ex);
            const isCollapsed = collapsedExercises[idx] ?? false;
            const completedCount = exerciseSets.filter((set) => set.completed).length;
            const categoryLabel = getExerciseCategory(ex.exercise_id, ex.exercise_name);
            const exerciseMuscleGroup = resolveCategory(ex.exercise_id, ex.exercise_name);
            const displayedMuscleGroup =
              activeMuscleFilter?.cardIdx === idx
                ? activeMuscleFilter.group
                : exerciseMuscleGroup;
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
                                    {set.rep_low != null && set.rep_high != null
                                      ? `${set.rep_low}-${set.rep_high} reps${set.preferred_reps ? ` · aim ${set.preferred_reps}` : ""}`
                                      : `${set.reps} reps`}
                                    {set.weight != null && Number(set.weight) > 0
                                      ? `\n${set.weight} lbs`
                                      : ""}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          )}
                          {aiRec.calibration_required ? (
                            <Text style={styles.calibrationHint}>
                              Calibration set: complete 6 controlled reps, choose how it felt, and the next set will adapt.
                            </Text>
                          ) : null}
                          {aiRec.reasoning ? (
                            <Text style={styles.reasoning}>
                              {compactRecommendationReasoning(aiRec)}
                            </Text>
                          ) : null}
                          {Array.isArray(aiRec.progression_options) &&
                          aiRec.progression_options.length > 1 ? (
                            <View style={styles.progressionOptions}>
                              {aiRec.progression_options.slice(0, 2).map((option: any) => (
                                <View key={option.kind || option.label} style={styles.progressionOption}>
                                  <Text style={styles.progressionOptionLabel}>
                                    {(option.label || "Option").toUpperCase()}
                                  </Text>
                                  <Text style={styles.progressionOptionValue}>
                                    {Number(option.weight) > 0
                                      ? `${option.weight} lb × ${option.reps}`
                                      : `${option.reps} reps`}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                          {aiRec.next_set_reasoning ? (
                            <View style={styles.nextSetCoach}>
                              <Text style={styles.nextSetLabel}>NEXT SET</Text>
                              <Text style={styles.nextSetText}>{aiRec.next_set_reasoning}</Text>
                              {previousSuggestedSetRef.current[ex.exercise_id] ? (
                                <TouchableOpacity
                                  style={styles.undoRecommendation}
                                  onPress={() => undoNextSetRecommendation(idx)}
                                >
                                  <Text style={styles.undoRecommendationText}>Undo recommendation</Text>
                                </TouchableOpacity>
                              ) : null}
                            </View>
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
                            <View style={{ width: 24 }} />
                          </View>
                          {exerciseSets.map((set, setIdx) => {
                            const lastSet = lastSets[setIdx];
                            const recSet =
                              aiRec?.suggested_next_set_index === setIdx
                                ? aiRec?.suggested_next_set
                                : Array.isArray(aiRec?.sets)
                                  ? aiRec.sets[setIdx]
                                  : null;
                            const repPlaceholder =
                              recSet?.preferred_reps ??
                              recSet?.reps ??
                              (lastSet && lastSet.reps > 0 ? lastSet.reps : undefined);
                            const weightPlaceholder =
                              recSet?.weight ??
                              (lastSet?.weight != null && lastSet.weight > 0
                                ? lastSet.weight
                                : undefined);
                            return (
                              <View key={setIdx} style={[
                                styles.setBlock,
                                updatedSetIndex[ex.exercise_id] === setIdx && styles.updatedSetBlock,
                                set.completed && styles.completedSetRow,
                              ]}>
                              <View style={styles.setRow}>
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
                                    repPlaceholder != null && Number(repPlaceholder) > 0
                                      ? String(repPlaceholder)
                                      : "—"
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
                                    weightPlaceholder != null && Number(weightPlaceholder) > 0
                                      ? String(weightPlaceholder)
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
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  </View>
                )}

                {!isCardio && (
                  <View style={styles.cardActionBar}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.cardActionScroll}
                      contentContainerStyle={styles.cardActionRow}
                    >
                      <TouchableOpacity style={styles.actionPillDashed} onPress={() => addSet(idx)}>
                        <Text style={styles.actionPillDashedText}>+ Set</Text>
                      </TouchableOpacity>
                      {splitMuscleGroups.map((group) => {
                        const selected = displayedMuscleGroup === group;
                        const historyExpanded = !collapsedHistoryCards.has(idx);
                        return (
                          <TouchableOpacity
                            key={group}
                            style={[styles.actionPillSolid, selected && styles.actionPillSolidActive]}
                            onPress={() => {
                              if (selected && historyExpanded) {
                                toggleMuscleHistory(idx, false);
                                return;
                              }
                              toggleMuscleHistory(idx, true);
                              if (group === exerciseMuscleGroup) {
                                setActiveMuscleFilter(null);
                              } else {
                                setActiveMuscleFilter({ cardIdx: idx, group });
                              }
                            }}
                          >
                            <Text
                              style={[
                                styles.actionPillSolidText,
                                selected && styles.actionPillSolidTextActive,
                              ]}
                            >
                              {MUSCLE_GROUP_LABELS[group] || group}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      <TouchableOpacity
                        style={styles.actionAddCircle}
                        onPress={() => openExercisePicker("inline", "browse", idx)}
                      >
                        <MaterialCommunityIcons name="plus" size={16} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </ScrollView>
                    {displayedMuscleGroup ? (
                      <View style={styles.muscleHistoryBlock}>
                        {renderMuscleHistory(idx, exerciseMuscleGroup)}
                      </View>
                    ) : null}
                  </View>
                )}

                {showExercisePicker && pickerAnchor === "inline" && exerciseInsertAfter === idx && (
                  <View style={styles.inlinePickerWrap}>
                    <Text style={styles.inlinePickerHint}>
                      Insert after {ex.exercise_name}
                    </Text>
                    {renderExercisePickerPanel(`inline-${idx}`)}
                  </View>
                )}
              </View>
            );
          })}

          {formData.exercises.length > 0 && (
            <TouchableOpacity
              style={[styles.addDashed, { marginTop: 8 }]}
              onPress={() => openExercisePicker("bottom", "browse", null)}
            >
              <MaterialCommunityIcons name="plus" size={18} color={colors.textSecondary} />
              <Text style={styles.addDashedText}>Add exercise</Text>
            </TouchableOpacity>
          )}

          {showExercisePicker && pickerAnchor === "bottom" && renderExercisePickerPanel("bottom")}
        </ScrollView>
        <ImportSessionModal
          visible={showImportModal}
          sessions={sessions}
          excludeSessionId={editingSessionId}
          onClose={() => setShowImportModal(false)}
          onSelect={handleImportSession}
        />
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
  formHeader: { flexDirection: "row", gap: 8, flex: 1 },
  sessionHeaderCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 2,
  },
  formTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: "800", flex: 1 },
  dateChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateChipText: { fontSize: 10, fontWeight: "700", color: colors.accentPrimary },
  saveBadgeInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginLeft: "auto",
  },
  splitRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  dropBtn: {
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dropBtnFlex: { flex: 1 },
  dropBtnLabel: {
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: colors.textMuted,
    marginBottom: 1,
  },
  dropBtnValueRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  dropBtnText: { color: colors.textPrimary, fontSize: 12, fontWeight: "700", flex: 1 },
  menu: {
    marginTop: 6,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    overflow: "hidden",
  },
  menuItem: { paddingHorizontal: 12, paddingVertical: 10 },
  menuItemActive: { backgroundColor: "rgba(156, 192, 232,0.2)" },
  menuText: { color: colors.textPrimary, fontSize: 13 },
  muted: { color: colors.textSecondary, fontSize: 12 },
  controlDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: 2,
  },
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 2,
  },
  timerTextLarge: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    lineHeight: 24,
    minWidth: 72,
  },
  saveBadgeText: { color: colors.textSecondary, fontSize: 10 },
  timerControls: { flexDirection: "row", alignItems: "center", gap: 4, flex: 1 },
  timerBtn: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  timerBtnActive: {
    borderColor: colors.accentPrimary,
    backgroundColor: "rgba(156, 192, 232, 0.12)",
  },
  timerBtnText: { color: colors.textSecondary, fontSize: 11, fontWeight: "700" },
  timerBtnTextActive: { color: colors.accentPrimary },
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
    backgroundColor: colors.accentPrimary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  finishBtnFlex: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 32,
  },
  finishText: { color: colors.onAccent, fontWeight: "800", fontSize: 12 },
  disabled: { opacity: 0.4 },
  error: { color: colors.danger, fontSize: 12, marginBottom: 8 },
  detailsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    paddingHorizontal: 2,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailsToggle: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
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
  importButton: {
    width: "100%",
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderHover,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  importButtonText: { color: colors.accentPrimary, fontSize: 13, fontWeight: "700" },
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
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  aiLoading: { color: colors.ai, fontWeight: "600", marginLeft: 8 },
  aiHead: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7, marginBottom: 6 },
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
  recSets: { flexDirection: "row", gap: 7, marginBottom: 8 },
  recSet: {
    flex: 1,
    backgroundColor: "rgba(11,12,16,0.5)",
    borderRadius: 10,
    padding: 8,
  },
  recSetLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  recSetVal: { color: "#fff", fontSize: 13, fontWeight: "700", marginTop: 3 },
  reasoning: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginBottom: 8 },
  progressionOptions: { flexDirection: "row", gap: 7, marginBottom: 8 },
  progressionOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.22)",
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 7,
    backgroundColor: "rgba(11,12,16,0.3)",
  },
  progressionOptionLabel: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  progressionOptionValue: { color: colors.ai, fontSize: 12, fontWeight: "800", marginTop: 2 },
  nextSetCoach: { backgroundColor: "rgba(94,234,212,0.08)", borderRadius: 8, padding: 10, marginBottom: 10 },
  nextSetLabel: { color: colors.ai, fontSize: 10, fontWeight: "700", marginBottom: 4 },
  nextSetText: { color: colors.text, fontSize: 12, lineHeight: 18 },
  undoRecommendation: { alignSelf: "flex-start", marginTop: 8, paddingVertical: 4 },
  undoRecommendationText: { color: colors.ai, fontSize: 11, fontWeight: "700" },
  calibrationHint: { color: colors.ai, fontSize: 11, lineHeight: 16, marginBottom: 10 },
  applySets: {
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.4)",
    borderRadius: 10,
    paddingVertical: 8,
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
  exBody: { paddingHorizontal: 14, paddingVertical: 10 },
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
  setHead: { flexDirection: "row", gap: 6, marginBottom: 4 },
  setCol: { color: colors.textMuted, fontSize: 9, fontWeight: "700" },
  setRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  setBlock: { borderWidth: 1, borderColor: "transparent", borderRadius: 8, padding: 2, marginBottom: 2 },
  updatedSetBlock: { borderColor: "rgba(94,234,212,0.5)", backgroundColor: "rgba(94,234,212,0.06)" },
  completedSetRow: { opacity: 0.72 },
  setNum: { color: colors.textSecondary, fontSize: 13 },
  lastHint: { color: colors.textMuted, fontSize: 8 },
  setInput: {
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: "#fff",
    textAlign: "center",
    fontSize: 13,
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
  cardActionBar: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  cardActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flexGrow: 1,
    paddingHorizontal: 4,
  },
  cardActionScroll: {
    alignSelf: "stretch",
  },
  actionPillDashed: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderHover,
  },
  actionPillDashedText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  actionPillSolid: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionPillSolidActive: {
    borderColor: colors.accentPrimary,
    backgroundColor: "rgba(156, 192, 232, 0.12)",
  },
  actionPillSolidText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  actionPillSolidTextActive: { color: colors.accentPrimary },
  actionAddCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderHover,
    alignItems: "center",
    justifyContent: "center",
  },
  recentHistoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 8,
    marginBottom: 6,
    alignSelf: "stretch",
    paddingVertical: 2,
  },
  recentHistoryLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    textAlign: "center",
  },
  muscleHistoryBlock: {
    paddingBottom: 2,
    alignSelf: "stretch",
    alignItems: "center",
  },
  inlinePickerWrap: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  inlinePickerHint: {
    color: colors.accentPrimary,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 8,
  },
  muscleHistory: { gap: 6, alignSelf: "stretch" },
  muscleHistoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  muscleHistoryRowAdded: { opacity: 0.55 },
  muscleHistoryMain: { flex: 1, gap: 4, minWidth: 0 },
  muscleHistoryTopLine: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  muscleHistoryDate: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    minWidth: 52,
  },
  muscleHistoryName: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  muscleHistoryNameAdded: { color: colors.textMuted },
  muscleHistoryPerf: { color: colors.accentPrimary, fontSize: 12, fontWeight: "700" },
  muscleHistoryEmpty: { color: colors.textMuted, fontSize: 11, paddingBottom: 2 },
});
