"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import apiClient from "@/lib/api-client";
import { WorkoutSession, WorkoutSet, Exercise, Split, SessionExercise, TodaysWorkout } from "@/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import {
  MdAdd,
  MdDelete,
  MdClose,
  MdKeyboardArrowDown,
  MdSearch,
  MdArrowBack,
  MdChevronRight,
  MdBolt,
  MdSwapHoriz,
  MdExpandMore,
  MdFitnessCenter,
  MdPlayArrow,
  MdStop,
  MdRefresh,
  MdSelfImprovement,
  MdCalendarToday,
} from "react-icons/md";
import { useSessionTimer, persistFromSession } from "@/hooks/useSessionTimer";
import defaultExercises, {
  categoryToMuscleGroup,
  categories,
} from "@/data/defaultExercises";

export interface SessionSummaryData {
  totalVolume: number;
  completedSets: number;
  totalSets: number;
  completedExercises: number;
  totalExercises: number;
  completionPercent: number;
  isActive: boolean;
  formattedTime: string;
  elapsedSeconds: number;
  isRunning: boolean;
  onTimerStart: () => void;
  onTimerStop: () => void;
  onTimerRefresh: () => void;
}

interface SessionsSectionProps {
  exercises: Exercise[];
  splits: Split[];
  editSessionId?: string | null;
  onSessionMetaChange?: (subtitle: string | null) => void;
  onSessionSummaryChange?: (data: SessionSummaryData | null) => void;
}

type SessionFormData = {
  date: string;
  split_id: string;
  split_name: string;
  split_day: string;
  exercises: SessionExercise[];
  notes: string;
  cardio_sport: string;
  cardio_minutes: string;
  cardio_intensity: number;
  cardio_fatigue: number;
};

const CARDIO_SPORTS = [
  "Basketball",
  "Soccer",
  "Football",
  "Tennis",
  "Running",
  "Cycling",
  "Swimming",
  "Hiking",
  "Walking",
  "Pickup",
  "Other",
];

const PRESET_CARDIO_SPORTS = CARDIO_SPORTS.filter((s) => s !== "Other");

function isCustomCardioSport(sport: string) {
  return Boolean(sport) && !PRESET_CARDIO_SPORTS.includes(sport);
}

function hasCardioLog(data: {
  cardio_sport?: string;
  cardio_minutes?: string | number;
}) {
  const sport = String(data.cardio_sport || "").trim();
  const minutes = Number(data.cardio_minutes);
  return Boolean(sport) || (Number.isFinite(minutes) && minutes > 0);
}

function isValidSet(set: WorkoutSet) {
  const reps = Number(set.reps) || 0;
  const weight = Number(set.weight);
  return reps > 0 || (Number.isFinite(weight) && weight > 0);
}

function formatSessionDateShort(dateStr?: string) {
  if (!dateStr) return "";
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function sessionHeadline(splitName?: string, splitDay?: string, dateStr?: string) {
  const name = (splitDay || splitName || "Workout Session").trim();
  const datePart = formatSessionDateShort(dateStr);
  return datePart ? `${name} ${datePart}` : name;
}

function formatDateOrdinal(dateStr?: string) {
  if (!dateStr) return "";
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
      ? "nd"
      : day % 10 === 3 && day !== 13
      ? "rd"
      : "th";
  const month = d.toLocaleDateString("en-US", { month: "short" });
  return `${month} ${day}${suffix}`;
}

function sessionListTitle(session: {
  date?: string;
  split_name?: string;
  split_day?: string;
  workout_name?: string;
}) {
  const datePart = formatDateOrdinal(session.date);
  const split = (
    session.split_day ||
    session.split_name ||
    session.workout_name ||
    ""
  ).trim();
  if (datePart && split) return `${datePart} ${split}`;
  return datePart || split || "Workout Session";
}

function isLastWorkoutRecent(lastData: any, maxDays = 30): boolean {
  const dateStr = lastData?.date;
  if (!dateStr) return false;
  const parsed = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const days = (Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24);
  return days >= 0 && days <= maxDays;
}

function setsFromLastWorkout(lastData: any, targetCount = 3): WorkoutSet[] | null {
  if (!isLastWorkoutRecent(lastData)) return null;
  const raw = lastData?.exercise_data?.sets;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const usable = raw.filter(isValidSet);
  if (usable.length === 0) return null;
  const mapped: WorkoutSet[] = usable.map((s: any, i: number) => ({
    set_number: i + 1,
    reps: Number(s.reps) || 0,
    weight: s.weight != null && s.weight !== "" ? Number(s.weight) : undefined,
    completed: false,
  }));
  while (mapped.length < targetCount) {
    const last = mapped[mapped.length - 1];
    mapped.push({
      ...last,
      set_number: mapped.length + 1,
      completed: false,
    });
  }
  return mapped.slice(0, targetCount).map((s, i) => ({ ...s, set_number: i + 1 }));
}

function normalizeLastExerciseData(lastData: any) {
  if (!lastData?.exercise_data) return lastData;
  const ex = lastData.exercise_data;
  if (Array.isArray(ex.sets) && ex.sets.length > 0) return lastData;
  if (ex.reps || ex.weight) {
    const count =
      typeof ex.sets === "number" && ex.sets > 0 ? Number(ex.sets) : 1;
    return {
      ...lastData,
      exercise_data: {
        ...ex,
        sets: Array.from({ length: count }, (_, i) => ({
          set_number: i + 1,
          reps: Number(ex.reps) || 0,
          weight: ex.weight,
        })),
      },
    };
  }
  return lastData;
}

function exerciseMatchesLast(ex: any, exerciseId?: string, exerciseName?: string) {
  if (exerciseId && ex?.exercise_id === exerciseId) return true;
  if (
    exerciseName &&
    String(ex?.exercise_name || "").trim().toLowerCase() ===
      exerciseName.trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

function findLastExerciseFromSessions(
  sessions: { id?: string; date?: string; created_at?: string; exercises?: any[] }[],
  exerciseId: string,
  exerciseName: string,
  excludeSessionId?: string | null
) {
  const matches: any[] = [];
  for (const session of sessions) {
    if (!session?.id || session.id === excludeSessionId) continue;
    const ex = (session.exercises || []).find((item) =>
      exerciseMatchesLast(item, exerciseId, exerciseName)
    );
    if (!ex) continue;
    matches.push(
      normalizeLastExerciseData({
        session_id: session.id,
        date: session.date,
        created_at: (session as any).created_at,
        exercise_data: ex,
      })
    );
  }
  matches.sort((a, b) =>
    `${b.date || ""}|${b.created_at || ""}`.localeCompare(
      `${a.date || ""}|${a.created_at || ""}`
    )
  );
  return matches[0] || null;
}

function resolveLastExercise(
  apiLast: any,
  sessions: { id?: string; date?: string; created_at?: string; exercises?: any[] }[],
  exerciseId: string,
  exerciseName: string,
  excludeSessionId?: string | null
) {
  const normalizedApi = normalizeLastExerciseData(apiLast);
  if (
    normalizedApi &&
    normalizedApi.session_id &&
    normalizedApi.session_id !== excludeSessionId &&
    formatLastPerformance(normalizedApi)
  ) {
    return normalizedApi;
  }
  return findLastExerciseFromSessions(
    sessions,
    exerciseId,
    exerciseName,
    excludeSessionId
  );
}

function lastWorkingSets(lastData: any): { reps: number; weight?: number }[] {
  const raw = lastData?.exercise_data?.sets;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidSet).map((s: any) => ({
    reps: Number(s.reps) || 0,
    weight: s.weight != null && s.weight !== "" ? Number(s.weight) : undefined,
  }));
}

function formatLastPerformance(lastData: any): string | null {
  const ex = lastData?.exercise_data;
  if (!ex) return null;
  if (ex.time || ex.speed) {
    const parts: string[] = [];
    if (ex.time) parts.push(`${ex.time} min`);
    if (ex.speed) parts.push(`${ex.speed} mph`);
    return parts.length ? parts.join(" · ") : null;
  }
  const sets = lastWorkingSets(lastData);
  if (sets.length === 0) return null;
  return sets
    .map((s, i) => {
      const load =
        s.weight != null && s.weight > 0
          ? `${s.reps}×${s.weight} lbs`
          : `${s.reps} reps`;
      return `S${i + 1} ${load}`;
    })
    .join(" · ");
}

function lastWorkoutHasWeight(lastData: any): boolean {
  const sets = lastData?.exercise_data?.sets;
  if (!Array.isArray(sets)) return false;
  return sets.some((s: any) => Number(s.weight) > 0);
}

function recCopiesLastWorkout(rec: any, lastSets: { reps: number; weight?: number }[]) {
  if (!rec?.sets?.length || !lastSets.length) return false;
  const n = Math.min(3, rec.sets.length, lastSets.length);
  return Array.from({ length: n }).every((_, i) => {
    const recReps = Number(rec.sets[i].reps) || 0;
    const recWeight = Number(rec.sets[i].weight) || 0;
    const lastReps = Number(lastSets[i].reps) || 0;
    const lastWeight = Number(lastSets[i].weight) || 0;
    return recReps === lastReps && recWeight === lastWeight;
  });
}

function recHasWeightedSets(rec: any): boolean {
  return Array.isArray(rec?.sets) && rec.sets.some((s: any) => Number(s.weight) > 0);
}

function mapRecSets(rec: any): WorkoutSet[] {
  return rec.sets.map((s: any, i: number) => ({
    set_number: s.set_number || i + 1,
    reps: s.reps || 0,
    weight: s.weight,
    completed: false,
  }));
}

function toStoredRecommendation(rec: any) {
  if (!rec || typeof rec !== "object") return undefined;
  return {
    sets: rec.sets,
    reasoning: rec.reasoning,
    progression_type: rec.progression_type,
    confidence: rec.confidence,
    needs_starting_weight: rec.needs_starting_weight,
    estimated_from_stale_history: rec.estimated_from_stale_history,
    estimated_from_top_lifts: rec.estimated_from_top_lifts,
    time: rec.time,
    speed: rec.speed,
    generated_at: rec.generated_at || new Date().toISOString(),
  };
}

function hydrateAiRecommendations(exercises: SessionExercise[]) {
  const out: Record<string, any> = {};
  for (const ex of exercises) {
    if (ex.exercise_id && ex.ai_recommendation) {
      out[ex.exercise_id] = ex.ai_recommendation;
    }
  }
  return out;
}

function emptySessionForm(): SessionFormData {
  return {
    date: new Date().toISOString().split("T")[0],
    split_id: "",
    split_name: "",
    split_day: "",
    exercises: [],
    notes: "",
    cardio_sport: "",
    cardio_minutes: "",
    cardio_intensity: 5,
    cardio_fatigue: 5,
  };
}

function sessionToForm(session: WorkoutSession): SessionFormData {
  return {
    date: session.date,
    split_id: session.split_id || "",
    split_name: session.split_name || "",
    split_day: session.split_day || "",
    exercises: session.exercises || [],
    notes: session.notes || "",
    cardio_sport: session.cardio_sport || "",
    cardio_minutes:
      session.cardio_minutes != null ? String(session.cardio_minutes) : "",
    cardio_intensity: session.cardio_intensity ?? 5,
    cardio_fatigue: session.cardio_fatigue ?? 5,
  };
}

function buildSessionPayload(
  formData: SessionFormData,
  timer?: { accumulatedMs: number; runningSince: number | null; firstStartedAt: number | null } | null
) {
  const filteredExercises = formData.exercises
    .map((ex) => {
      if (ex.sets && Array.isArray(ex.sets)) {
        const validSets = ex.sets.filter(isValidSet);
        if (validSets.length > 0 || ex.time !== undefined || ex.speed !== undefined) {
          return { ...ex, sets: validSets };
        }
        return null;
      }
      return ex;
    })
    .filter((ex): ex is SessionExercise => ex !== null);

  const minutes = Number(formData.cardio_minutes);
  const sport = formData.cardio_sport.trim();
  const hasCardio = Boolean(sport) || (Number.isFinite(minutes) && minutes > 0);

  return {
    date: formData.date,
    split_id: formData.split_id || undefined,
    split_name: formData.split_name || undefined,
    split_day: formData.split_day || undefined,
    exercises: filteredExercises,
    notes: formData.notes || undefined,
    cardio_sport: hasCardio ? sport || null : null,
    cardio_minutes: hasCardio && Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    cardio_intensity: hasCardio ? formData.cardio_intensity : null,
    cardio_fatigue: hasCardio ? formData.cardio_fatigue : null,
    timer_accumulated_ms: timer?.accumulatedMs ?? 0,
    timer_running_since: timer?.runningSince
      ? new Date(timer.runningSince).toISOString()
      : null,
    timer_started_at: timer?.firstStartedAt
      ? new Date(timer.firstStartedAt).toISOString()
      : null,
  };
}

function ActiveSessionTimer({
  formattedTime,
  isRunning,
  onStart,
  onStop,
  onRefresh,
}: {
  formattedTime: string;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="font-mono text-lg font-bold text-white tabular-nums">
        {formattedTime}
      </span>
      <button
        type="button"
        onClick={isRunning ? onStop : onStart}
        className="h-8 px-3 rounded-full bg-[#0B0C10] border border-[#2A2D35] flex items-center justify-center gap-1 text-xs font-semibold text-[#8E8E93] hover:text-white hover:border-[#FF6B35]/40 transition-colors"
        title={isRunning ? "Stop timer" : "Start timer"}
        aria-label={isRunning ? "Stop timer" : "Start timer"}
      >
        {isRunning ? <MdStop size={14} /> : <MdPlayArrow size={16} />}
        {isRunning ? "Stop" : "Start"}
      </button>
      <button
        type="button"
        onClick={onRefresh}
        className="w-8 h-8 rounded-full bg-[#0B0C10] border border-[#2A2D35] flex items-center justify-center text-[#8E8E93] hover:text-white hover:border-[#FF6B35]/40 transition-colors"
        title="Refresh timer from saved time"
        aria-label="Refresh timer"
      >
        <MdRefresh size={16} />
      </button>
    </div>
  );
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return "Cannot reach the server. Check that the API is up and CORS allows this site.";
    }
    const detail = error.response.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => item?.msg || JSON.stringify(item))
        .join("; ");
    }
    if (error.response.status === 404) {
      return "Save endpoint not found. The app may be calling the wrong API URL.";
    }
    return `${fallback} (${error.response.status})`;
  }
  return fallback;
}

export default function SessionsSection({
  exercises,
  splits,
  editSessionId: propEditSessionId,
  onSessionMetaChange,
  onSessionSummaryChange,
}: SessionsSectionProps) {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [formData, setFormData] = useState<SessionFormData>(emptySessionForm);
  const [showSplitDropdown, setShowSplitDropdown] = useState(false);
  const [showDayDropdown, setShowDayDropdown] = useState(false);
  const splitDropdownRef = useRef<HTMLDivElement>(null);
  const dayDropdownRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [exerciseSearchQuery, setExerciseSearchQuery] = useState("");
  const exerciseDropdownRef = useRef<HTMLDivElement>(null);
  const exerciseSelectionRef = useRef<HTMLDivElement>(null);
  const [lastExerciseData, setLastExerciseData] = useState<Record<string, any>>({});
  const [maxExerciseData, setMaxExerciseData] = useState<Record<string, any>>({});
  const [aiRecommendations, setAiRecommendations] = useState<Record<string, any>>({});
  const [aiRecommendationLoading, setAiRecommendationLoading] = useState<Record<string, boolean>>({});
  const [startingWeights, setStartingWeights] = useState<Record<string, string>>({});
  const [collapsedExercises, setCollapsedExercises] = useState<Record<number, boolean>>({});
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<"top" | "bottom">("top");
  const fetchedLastRef = useRef<Set<string>>(new Set());
  const shouldScrollPickerRef = useRef(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<"browse" | "search">("browse");
  const [selectedBodyPart, setSelectedBodyPart] = useState<string | null>(null);
  const [equipmentFilter, setEquipmentFilter] = useState<string | null>(null);
  const [showSessionDetails, setShowSessionDetails] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingRecApplyRef = useRef<Set<string>>(new Set());
  const staleRecRetryRef = useRef<Set<string>>(new Set());
  const formDataRef = useRef(formData);
  const editingSessionIdRef = useRef(editingSessionId);
  const autoSaveChainRef = useRef(Promise.resolve(true));
  formDataRef.current = formData;
  editingSessionIdRef.current = editingSessionId;
  const editingSession = sessions.find((s) => s.id === editingSessionId);
  const timer = useSessionTimer(
    showForm ? editingSessionId || "draft" : null,
    persistFromSession(editingSession)
  );
  const timerPersistRef = useRef(timer.getPersist);
  timerPersistRef.current = timer.getPersist;
  const [, setAiSummaryStatus] = useState<{
    hasSetup: boolean;
    needsSetup: boolean;
    isGenerating: boolean;
    sessionsLogged: number;
    sessionsNeeded: number;
  }>({ hasSetup: false, needsSetup: false, isGenerating: false, sessionsLogged: 0, sessionsNeeded: 3 });
  const [todaysPlanWorkout, setTodaysPlanWorkout] = useState<TodaysWorkout | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  const lastExerciseUrl = (exerciseId: string) => {
    const sessionId = editingSessionIdRef.current;
    const query = sessionId
      ? `?exclude_session_id=${encodeURIComponent(sessionId)}`
      : "";
    return `/api/workout-sessions/last-exercise/${exerciseId}${query}`;
  };

  const handleStartPlan = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/workout-plan/today");
      const todayData = res.data;
      if (todayData.status !== "workout_day" || !todayData.exercises) return;

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
          return {
            exercise_id: ex.exercise_id,
            exercise_name: ex.exercise_name,
            time: undefined,
            speed: undefined,
          };
        }
        const lastSets = setsFromLastWorkout(lastResults[idx], ex.sets || 3);
        const sets =
          lastSets ||
          Array.from({ length: ex.sets || 3 }, (_, i) => ({
            set_number: i + 1,
            reps: 0,
            weight: undefined,
            completed: false,
          }));
        pendingRecApplyRef.current.add(ex.exercise_id);
        return {
          exercise_id: ex.exercise_id,
          exercise_name: ex.exercise_name,
          sets,
        };
      });

      setFormData({
        ...emptySessionForm(),
        split_id: todayData.split_id || "",
        split_name: todayData.plan_name || "",
        split_day: todayData.day_name || "",
        exercises: planExercises,
      });
      setShowForm(true);

      // Fetch AI recommendations for each exercise
      planExercises.forEach((ex: any, idx: number) => {
        const planEx = todayData.exercises[idx];
        fetchAiRecommendation(
          ex.exercise_id,
          ex.exercise_name,
          idx,
          planEx?.sets,
          planEx?.reps,
          planEx?.notes
        );
      });

      // Clear URL params
      setSearchParams({}, { replace: true });
    } catch (error) {
      console.error("Error loading plan workout:", error);
    }
  }, []);

  const fetchTodaysPlan = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/workout-plan/today");
      setTodaysPlanWorkout(res.data);
    } catch {
      setTodaysPlanWorkout(null);
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/workout-sessions");
      setSessions(res.data);
    } catch (error) {
      console.error("Error fetching sessions:", error);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    checkAiSummaryStatus();
    fetchTodaysPlan();

    // Check for startPlan URL param
    if (searchParams.get("startPlan") === "true") {
      handleStartPlan();
    }
  }, []);

  const performAutoSave = useCallback(async (opts?: { silent?: boolean }) => {
    const run = async () => {
      const data = formDataRef.current;
      const payload = buildSessionPayload(data, timerPersistRef.current());
      const canSave =
        payload.exercises.length > 0 || hasCardioLog(data);
      if (!canSave) {
        return false;
      }

      if (!opts?.silent) setIsAutoSaving(true);
      try {
        const sessionId = editingSessionIdRef.current;
        if (sessionId) {
          await apiClient.put(`/api/workout-sessions/${sessionId}`, payload);
        } else {
          const response = await apiClient.post("/api/workout-sessions", payload);
          if (response.data && response.data.id) {
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
        setSaveError(getApiErrorMessage(error, "Auto-save failed"));
        return false;
      } finally {
        if (!opts?.silent) setIsAutoSaving(false);
      }
    };

    const queued = autoSaveChainRef.current.then(run, run);
    autoSaveChainRef.current = queued.then(
      () => true,
      () => true
    );
    return queued;
  }, [fetchSessions]);

  // Auto-save as you log. You should not need to press Save Workout.
  useEffect(() => {
    if (!showForm || (formData.exercises.length === 0 && !hasCardioLog(formData))) {
      return;
    }

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      void performAutoSave();
    }, 800);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [
    formData.exercises,
    formData.date,
    formData.split_name,
    formData.split_day,
    formData.notes,
    formData.cardio_sport,
    formData.cardio_minutes,
    formData.cardio_intensity,
    formData.cardio_fatigue,
    showForm,
    performAutoSave,
  ]);

  useEffect(() => {
    const flush = () => {
      void performAutoSave({ silent: true });
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [performAutoSave]);

  // Check AI recommendation status and auto-trigger if needed
  const checkAiSummaryStatus = async () => {
    try {
      const response = await apiClient.get("/api/workout-sessions/ai-recommendation-check");
      const data = response.data;
      
      setAiSummaryStatus({
        hasSetup: data.has_summary || false,
        needsSetup: data.needs_initial_setup || false,
        isGenerating: false,
        sessionsLogged: data.sessions_logged || 0,
        sessionsNeeded: data.sessions_needed || 3,
      });
      
      // Auto-trigger first-time setup if ready
      if (data.needs_initial_setup && !data.has_summary) {
        generateAiSummary();
      }
    } catch (error) {
      console.log("AI recommendations not available:", error);
    }
  };

  // Generate AI summary (first-time setup or manual refresh)
  const generateAiSummary = async () => {
    setAiSummaryStatus(prev => ({ ...prev, isGenerating: true }));
    try {
      await apiClient.get("/api/workout-sessions/ai-summary");
      setAiSummaryStatus(prev => ({ 
        ...prev, 
        hasSetup: true, 
        needsSetup: false, 
        isGenerating: false 
      }));
    } catch (error) {
      console.error("Error generating AI summary:", error);
      setAiSummaryStatus(prev => ({ ...prev, isGenerating: false }));
    }
  };

  // Fetch AI recommendation for an exercise
  const fetchAiRecommendation = async (
    exerciseId: string,
    exerciseName: string,
    positionInWorkout: number,
    planTargetSets?: number,
    planTargetReps?: number,
    planNotes?: string
  ) => {
    setAiRecommendationLoading(prev => ({ ...prev, [exerciseId]: true }));
    try {
      // Send exercises already done in current workout (for fatigue consideration)
      const currentExercises = formData.exercises.map(ex => ({
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        sets: ex.sets || []
      }));

      const response = await apiClient.post(`/api/workout-sessions/ai-recommendation/${exerciseId}`, {
        exercise_name: exerciseName,
        split_name: formData.split_name || undefined,
        split_day: undefined,
        position_in_workout: positionInWorkout,
        current_workout_exercises: currentExercises,
        plan_target_sets: planTargetSets,
        plan_target_reps: planTargetReps,
        plan_notes: planNotes,
        exclude_session_id: editingSessionIdRef.current || undefined,
      });

      if (response.data && response.data.status === "success") {
        const rec = response.data.recommendation;
        const stored = toStoredRecommendation(rec);
        setAiRecommendations(prev => ({
          ...prev,
          [exerciseId]: rec
        }));
        setFormData((prev) => {
          if (!prev.exercises.some((ex) => ex.exercise_id === exerciseId)) {
            return prev;
          }
          const shouldApplySets =
            recHasWeightedSets(rec) && pendingRecApplyRef.current.has(exerciseId);
          if (shouldApplySets) {
            pendingRecApplyRef.current.delete(exerciseId);
          }
          return {
            ...prev,
            exercises: prev.exercises.map((ex) =>
              ex.exercise_id === exerciseId
                ? {
                    ...ex,
                    ai_recommendation: stored,
                    ...(shouldApplySets ? { sets: mapRecSets(rec) } : {}),
                  }
                : ex
            ),
          };
        });
      }
    } catch (error) {
      console.log("No AI recommendation available for this exercise");
    } finally {
      setAiRecommendationLoading(prev => ({ ...prev, [exerciseId]: false }));
    }
  };

  useEffect(() => {
    if (!showForm) return;
    formData.exercises.forEach((ex, idx) => {
      if (!ex.exercise_id) return;
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
  }, [
    showForm,
    formData.exercises,
    aiRecommendations,
    lastExerciseData,
    sessions,
    editingSessionId,
    aiRecommendationLoading,
  ]);

  useEffect(() => {
    if (propEditSessionId && sessions.length > 0) {
      const sessionToEdit = sessions.find((s) => s.id === propEditSessionId);
      if (sessionToEdit) {
        setFormData(sessionToForm(sessionToEdit));
        setAiRecommendations(hydrateAiRecommendations(sessionToEdit.exercises || []));
        setEditingSessionId(sessionToEdit.id || null);
        setShowForm(true);
      }
    }
  }, [propEditSessionId, sessions]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        splitDropdownRef.current &&
        !splitDropdownRef.current.contains(event.target as Node)
      ) {
        setShowSplitDropdown(false);
      }
      if (
        dayDropdownRef.current &&
        !dayDropdownRef.current.contains(event.target as Node)
      ) {
        setShowDayDropdown(false);
      }
      if (
        exerciseDropdownRef.current &&
        !exerciseDropdownRef.current.contains(event.target as Node) &&
        exerciseSelectionRef.current &&
        !exerciseSelectionRef.current.contains(event.target as Node)
      ) {
        setShowExercisePicker(false);
      }
    };

    if (showSplitDropdown || showDayDropdown || showExercisePicker) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showSplitDropdown, showDayDropdown, showExercisePicker]);

  const allExercises = useMemo(() => {
    const defaultExercisesList = defaultExercises.map((ex) => ({
      id: ex.id,
      name: ex.name,
      category: ex.category,
      equipment: ex.equipment,
      is_default: true,
    }));

    const customExercisesList = exercises
      .filter((ex) => ex.id)
      .map((ex) => {
        let category = null;
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
          category: category,
          equipment: null,
          is_default: false,
        };
      });

    return [...defaultExercisesList, ...customExercisesList];
  }, [exercises]);

  const handleExerciseChange = async (exerciseId: string, exerciseName: string) => {
    const selectedExercise = allExercises.find((ex) => ex.id === exerciseId);
    const isCardio = selectedExercise?.category === "CARDIO";
    const positionInWorkout = formData.exercises.length; // Position is the current length (0-indexed)
    
    let lastData: any = null;
    try {
      const response = await apiClient.get(lastExerciseUrl(exerciseId));
      if (response.data) {
        lastData = response.data;
        setLastExerciseData(prev => ({
          ...prev,
          [exerciseId]: response.data
        }));
      }
    } catch (error) {
      console.log("No previous exercise data found");
    }
    
    try {
      const maxResponse = await apiClient.get(`/api/workout-sessions/max-exercise/${exerciseId}`);
      if (maxResponse.data) {
        setMaxExerciseData(prev => ({
          ...prev,
          [exerciseId]: maxResponse.data
        }));
      }
    } catch (error) {
      console.log("No max exercise data found");
    }

    if (!isCardio) {
      pendingRecApplyRef.current.add(exerciseId);
    }

    const lastSets = !isCardio ? setsFromLastWorkout(lastData, 3) : null;
    setFormData({
      ...formData,
      exercises: [
        ...formData.exercises,
        isCardio
          ? {
              exercise_id: exerciseId,
              exercise_name: exerciseName,
              time: undefined,
              speed: undefined,
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
    fetchAiRecommendation(exerciseId, exerciseName, positionInWorkout);
    setExerciseSearchQuery("");
    setCategoryFilter(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    } catch (error) {
      console.error("Error saving session:", error);
      setSaveError(getApiErrorMessage(error, "Could not save workout"));
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setFormData(emptySessionForm());
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
    // Clear auto-save state
    setLastSaved(null);
    setIsAutoSaving(false);
    setIsSaving(false);
    setSaveError(null);
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
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
    setShowForm(true);
  };

  const handleDelete = async (sessionId: string) => {
    if (confirm("Are you sure you want to delete this workout session?")) {
      try {
        await apiClient.delete(`/api/workout-sessions/${sessionId}`);
        fetchSessions();
        fetchTodaysPlan();
      } catch (error) {
        console.error("Error deleting session:", error);
      }
    }
  };

  const removeExercise = (exerciseIdx: number) => {
    setFormData({
      ...formData,
      exercises: formData.exercises.filter((_, i) => i !== exerciseIdx),
    });
    setCollapsedExercises((prev) => {
      const next: Record<number, boolean> = {};
      Object.entries(prev).forEach(([key, value]) => {
        const i = Number(key);
        if (i < exerciseIdx) next[i] = value;
        if (i > exerciseIdx) next[i - 1] = value;
      });
      return next;
    });
  };

  const removeSet = (exerciseIdx: number, setIdx: number) => {
    const exercise = formData.exercises[exerciseIdx];
    const currentSets = Array.isArray(exercise?.sets) ? exercise.sets : [];
    const remaining = currentSets
      .filter((_, i) => i !== setIdx)
      .map((set, i) => ({ ...set, set_number: i + 1 }));

    if (remaining.length === 0) {
      removeExercise(exerciseIdx);
      return;
    }

    const newExercises = [...formData.exercises];
    newExercises[exerciseIdx] = { ...exercise, sets: remaining };
    setFormData({ ...formData, exercises: newExercises });
  };

  const applyAiSets = (exerciseId: string, exerciseIdx: number) => {
    const rec = aiRecommendations[exerciseId];
    if (!rec?.sets || !Array.isArray(rec.sets)) return;
    const newExercises = [...formData.exercises];
    newExercises[exerciseIdx] = {
      ...newExercises[exerciseIdx],
      sets: rec.sets.map((s: any, i: number) => ({
        set_number: s.set_number || i + 1,
        reps: s.reps || 0,
        weight: s.weight,
        completed: undefined,
      })),
    };
    setFormData({ ...formData, exercises: newExercises });
  };

  const applyStartingWeight = (exerciseId: string, exerciseIdx: number) => {
    const rec = aiRecommendations[exerciseId];
    const startingWeight = Number(startingWeights[exerciseId]);
    if (!rec?.needs_starting_weight || !Number.isFinite(startingWeight) || startingWeight <= 0) {
      return;
    }

    const setCount = Math.max(1, rec.suggested_sets || 3);
    const reps = Math.max(1, rec.suggested_reps || 6);
    const newExercises = [...formData.exercises];
    newExercises[exerciseIdx] = {
      ...newExercises[exerciseIdx],
      sets: Array.from({ length: setCount }, (_, i) => ({
        set_number: i + 1,
        reps,
        weight: startingWeight,
        completed: false,
      })),
    };
    setFormData({ ...formData, exercises: newExercises });
  };

  const sessionProgress = useMemo(() => {
    const exerciseCount = formData.exercises.length;
    let totalSets = 0;
    let doneSets = 0;
    let doneExercises = 0;
    for (const ex of formData.exercises) {
      if (Array.isArray(ex.sets) && ex.sets.length > 0) {
        totalSets += ex.sets.length;
        const completed = ex.sets.filter(isValidSet).length;
        doneSets += completed;
        if (completed > 0) doneExercises += 1;
      } else if (ex.time) {
        totalSets += 1;
        doneSets += 1;
        doneExercises += 1;
      }
    }
    const pct = totalSets > 0 ? Math.round((doneSets / totalSets) * 100) : 0;
    return { exerciseCount, totalSets, doneSets, doneExercises, pct };
  }, [formData.exercises]);

  const currentVolume = useMemo(() => {
    let volume = 0;
    for (const ex of formData.exercises) {
      if (Array.isArray(ex.sets)) {
        for (const s of ex.sets) {
          volume += (s.weight || 0) * (s.reps || 0);
        }
      }
    }
    return volume;
  }, [formData.exercises]);

  // Push summary data to parent
  useEffect(() => {
    if (!onSessionSummaryChange) return;
    if (showForm) {
      onSessionSummaryChange({
        totalVolume: currentVolume,
        completedSets: sessionProgress.doneSets,
        totalSets: sessionProgress.totalSets,
        completedExercises: sessionProgress.doneExercises,
        totalExercises: sessionProgress.exerciseCount,
        completionPercent: sessionProgress.pct,
        isActive: true,
        formattedTime: timer.formattedTime,
        elapsedSeconds: timer.elapsedSeconds,
        isRunning: timer.isRunning,
        onTimerStart: timer.start,
        onTimerStop: timer.stop,
        onTimerRefresh: timer.refresh,
      });
    } else {
      onSessionSummaryChange(null);
    }
  }, [
    showForm,
    currentVolume,
    sessionProgress,
    onSessionSummaryChange,
    timer.formattedTime,
    timer.elapsedSeconds,
    timer.isRunning,
    timer.start,
    timer.stop,
    timer.refresh,
  ]);

  useEffect(() => {
    if (!onSessionMetaChange) return;
    if (showForm) {
      const name = sessionHeadline(
        formData.split_name,
        formData.split_day,
        formData.date
      );
      onSessionMetaChange(name);
    } else {
      onSessionMetaChange(null);
    }
  }, [showForm, formData.split_name, formData.split_day, formData.date, onSessionMetaChange]);

  const getExerciseCategory = (exerciseId: string, exerciseName: string) => {
    const fromDefault = defaultExercises.find(
      (e) => e.id === exerciseId || e.name === exerciseName
    );
    if (fromDefault?.category) {
      return fromDefault.category.charAt(0) + fromDefault.category.slice(1).toLowerCase();
    }
    const fromCustom = exercises.find((e) => e.id === exerciseId || e.name === exerciseName);
    if (fromCustom?.muscle_group) {
      return fromCustom.muscle_group;
    }
    return "Exercise";
  };

  const getBestSetLabel = (maxData: any) => {
    if (!maxData?.max_per_set) return null;
    const entries = Object.entries(maxData.max_per_set) as [string, any][];
    if (!entries.length) return null;
    entries.sort((a, b) => ((b[1].weight || 0) - (a[1].weight || 0)));
    const best = entries[0][1];
    if (best?.weight == null) return null;
    return `${best.weight} × ${best.reps || 0}`;
  };

  const confidencePct = (confidence?: string) => {
    if (confidence === "high") return "92%";
    if (confidence === "medium") return "75%";
    if (confidence === "low") return "58%";
    return null;
  };

  const formatShortDate = (dateString: string) => {
    const date = new Date(`${String(dateString).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getExerciseRole = (index: number) =>
    index === 0 ? "Primary" : "Secondary";

  const toggleExerciseCollapse = (idx: number) => {
    setCollapsedExercises((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const getCompletedSetCount = (sets: SessionExercise["sets"]) => {
    if (!Array.isArray(sets)) return 0;
    return sets.filter(isValidSet).length;
  };

  const categoryFilterPills = [
    { id: null, label: "All" },
    { id: "CHEST", label: "Chest" },
    { id: "SHOULDERS", label: "Shoulders" },
    { id: "BACK", label: "Back" },
    { id: "ARMS", label: "Arms" },
    { id: "LEGS", label: "Legs" },
    { id: "CORE", label: "Core" },
  ];

  const openExercisePicker = (anchor: "top" | "bottom" = "top") => {
    shouldScrollPickerRef.current = true;
    setPickerAnchor(anchor);
    setShowExercisePicker(true);
    setPickerMode("browse");
    setSelectedBodyPart(null);
    setEquipmentFilter(null);
  };

  useEffect(() => {
    if (!showExercisePicker || !shouldScrollPickerRef.current) return;
    shouldScrollPickerRef.current = false;
    const id = window.setTimeout(() => {
      exerciseSelectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }, 50);
    return () => window.clearTimeout(id);
  }, [showExercisePicker, pickerAnchor]);

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
    });
  }, [showForm, formData.exercises, editingSessionId]);

  // matchesCategoryFilter and filteredPickerExercises removed - filtering is now inline in the picker

  return (
    <div>
      {!showForm && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <p className="text-sm text-[#8E8E93] font-medium">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""} logged
          </p>
          <Button onClick={() => setShowForm(true)} icon={<MdAdd />}>
            New Session
          </Button>
        </div>
      )}

      {/* Today's Workout Banner */}
      {!showForm && todaysPlanWorkout && todaysPlanWorkout.status === "workout_day" && !todaysPlanWorkout.already_logged && (
        <div className="mb-5 bg-[#161A22] border border-[#FF6B35]/30 rounded-2xl p-5 sm:p-6">
          <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-[#FF6B35]/15 flex items-center justify-center flex-shrink-0">
                <MdFitnessCenter className="text-[#FF6B35] text-xl" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[#FF6B35]/15 text-[#FF6B35] border border-[#FF6B35]/30">
                    Today
                  </span>
                </div>
                <h3 className="text-base font-bold text-white">
                  {todaysPlanWorkout.day_name}
                </h3>
                <p className="text-sm text-[#8E8E93] mt-0.5">
                  {todaysPlanWorkout.focus}
                  {todaysPlanWorkout.exercises && todaysPlanWorkout.exercises.length > 0 && (
                    <> &middot; {todaysPlanWorkout.exercises.length} exercises</>
                  )}
                  {todaysPlanWorkout.estimated_duration_minutes && (
                    <> &middot; ~{todaysPlanWorkout.estimated_duration_minutes} min</>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={handleStartPlan}
              className="px-5 py-2.5 rounded-xl bg-[#FF6B35] text-white text-sm font-bold hover:bg-[#E85A2A] transition-colors flex items-center gap-2 flex-shrink-0 shadow-lg shadow-[#FF6B35]/20"
            >
              <MdPlayArrow size={18} />
              Start This Workout
            </button>
          </div>

          {/* Exercise preview */}
          {todaysPlanWorkout.exercises && todaysPlanWorkout.exercises.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {todaysPlanWorkout.exercises.slice(0, 4).map((ex) => (
                <span
                  key={ex.exercise_id + "-" + ex.order}
                  className="px-3 py-1.5 rounded-lg bg-[#0B0C10]/60 border border-[#2A2D35] text-xs text-[#8E8E93] font-medium"
                >
                  {ex.exercise_name}
                </span>
              ))}
              {todaysPlanWorkout.exercises.length > 4 && (
                <span className="px-3 py-1.5 rounded-lg bg-[#0B0C10]/60 border border-[#2A2D35] text-xs text-[#636366] font-medium">
                  +{todaysPlanWorkout.exercises.length - 4} more
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Rest Day Banner */}
      {!showForm && todaysPlanWorkout && todaysPlanWorkout.status === "rest_day" && (
        <div className="mb-5 bg-[#161A22] border border-[#2A2D35] rounded-2xl px-5 py-4">
          <div className="flex items-center gap-3">
            <MdSelfImprovement className="text-[#5EEAD4] text-xl flex-shrink-0" />
            <p className="text-sm text-[#8E8E93]">
              <span className="text-[#5EEAD4] font-medium">Rest Day</span>
              {todaysPlanWorkout.next_workout_day && todaysPlanWorkout.next_workout_name && (
                <> — Next up: {todaysPlanWorkout.next_workout_name} ({todaysPlanWorkout.next_workout_day})</>
              )}
            </p>
          </div>
        </div>
      )}

      {showForm && (
        <div className="mb-6 space-y-5">
          {/* Active Session Banner */}
          <div className="bg-[#161A22] rounded-2xl border border-[#2A2D35] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="text-[#8E8E93] hover:text-white transition-colors"
                >
                  <MdArrowBack size={22} />
                </button>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[#5EEAD4]/15 text-[#5EEAD4] border border-[#5EEAD4]/30">
                      Active Session
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-white">
                    {sessionHeadline(
                      formData.split_name,
                      formData.split_day,
                      formData.date
                    )}
                  </h3>
                  <div className="relative mt-1.5 inline-flex max-w-full items-center">
                    <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center gap-1.5 pl-2.5">
                      <MdCalendarToday size={14} className="text-[#FF6B35]" />
                    </div>
                    <input
                      ref={dateInputRef}
                      type="date"
                      value={formData.date}
                      onChange={(e) =>
                        setFormData({ ...formData, date: e.target.value })
                      }
                      onClick={(e) => {
                        const input = e.currentTarget;
                        try {
                          if (typeof input.showPicker === "function") {
                            input.showPicker();
                          }
                        } catch {
                          // Native picker will still open from the click.
                        }
                      }}
                      className="h-9 min-w-[11.5rem] cursor-pointer rounded-lg border border-[#2A2D35] bg-[#0B0C10] pl-8 pr-2 text-xs font-semibold text-white outline-none transition-colors [color-scheme:dark] hover:border-[#FF6B35]/50 focus:border-[#FF6B35]"
                      aria-label="Workout date"
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <div className="relative" ref={splitDropdownRef}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSplitDropdown(!showSplitDropdown);
                          setShowDayDropdown(false);
                        }}
                        className="h-9 min-w-[8.5rem] max-w-[12rem] px-3 rounded-lg border border-[#2A2D35] bg-[#0B0C10] text-xs font-semibold text-white hover:border-[#FF6B35]/50 transition-colors flex items-center justify-between gap-2"
                      >
                        <span className="truncate">
                          {formData.split_id
                            ? splits.find((s) => s.id === formData.split_id)?.name ||
                              formData.split_name ||
                              "Split"
                            : "Choose split"}
                        </span>
                        <MdKeyboardArrowDown
                          className={`text-[#8E8E93] flex-shrink-0 transition-transform ${
                            showSplitDropdown ? "rotate-180" : ""
                          }`}
                          size={16}
                        />
                      </button>
                      {showSplitDropdown && (
                        <div className="absolute z-[100] left-0 mt-1 min-w-[12rem] bg-[#161A22] border border-[#2A2D35] rounded-lg shadow-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => {
                              setFormData({
                                ...formData,
                                split_id: "",
                                split_name: "",
                                split_day: "",
                              });
                              setShowSplitDropdown(false);
                            }}
                            className={`w-full px-3 py-2.5 text-xs text-left text-white hover:bg-[#2A2D35] ${
                              !formData.split_id ? "bg-[#FF6B35]/20" : ""
                            }`}
                          >
                            No split
                          </button>
                          {splits.map((split) => (
                            <button
                              key={split.id}
                              type="button"
                              onClick={() => {
                                const onlyDay =
                                  split.days?.length === 1 ? split.days[0] : "";
                                setFormData({
                                  ...formData,
                                  split_id: split.id || "",
                                  split_name: split.name,
                                  split_day: onlyDay,
                                });
                                setShowSplitDropdown(false);
                              }}
                              className={`w-full px-3 py-2.5 text-xs text-left text-white hover:bg-[#2A2D35] ${
                                formData.split_id === split.id ? "bg-[#FF6B35]/20" : ""
                              }`}
                            >
                              {split.name}
                            </button>
                          ))}
                          {splits.length === 0 && (
                            <p className="px-3 py-2.5 text-xs text-[#8E8E93]">
                              Add a split in the Splits tab first.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    {formData.split_id &&
                      (() => {
                        const selectedSplit = splits.find(
                          (s) => s.id === formData.split_id
                        );
                        if (!selectedSplit?.days?.length) return null;
                        return (
                          <div className="relative" ref={dayDropdownRef}>
                            <button
                              type="button"
                              onClick={() => {
                                setShowDayDropdown(!showDayDropdown);
                                setShowSplitDropdown(false);
                              }}
                              className="h-9 min-w-[7.5rem] max-w-[11rem] px-3 rounded-lg border border-[#2A2D35] bg-[#0B0C10] text-xs font-semibold text-white hover:border-[#FF6B35]/50 transition-colors flex items-center justify-between gap-2"
                            >
                              <span className="truncate">
                                {formData.split_day || "Choose day"}
                              </span>
                              <MdKeyboardArrowDown
                                className={`text-[#8E8E93] flex-shrink-0 transition-transform ${
                                  showDayDropdown ? "rotate-180" : ""
                                }`}
                                size={16}
                              />
                            </button>
                            {showDayDropdown && (
                              <div className="absolute z-[100] left-0 mt-1 min-w-[11rem] bg-[#161A22] border border-[#2A2D35] rounded-lg shadow-lg overflow-hidden">
                                {selectedSplit.days.map((day, index) => (
                                  <button
                                    key={index}
                                    type="button"
                                    onClick={() => {
                                      setFormData({
                                        ...formData,
                                        split_day: day,
                                      });
                                      setShowDayDropdown(false);
                                    }}
                                    className={`w-full px-3 py-2.5 text-xs text-left text-white hover:bg-[#2A2D35] ${
                                      formData.split_day === day
                                        ? "bg-[#FF6B35]/20"
                                        : ""
                                    }`}
                                  >
                                    {day}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                  </div>
                  {timer.firstStartedAt && (
                    <p className="text-xs text-[#8E8E93] mt-0.5">
                      Started{" "}
                      {new Date(timer.firstStartedAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Auto-save indicator */}
                <span className="text-[11px] text-[#636366]">
                  {isAutoSaving
                    ? "Saving..."
                    : lastSaved
                    ? `Saved ${lastSaved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                    : formData.exercises.length > 0 || hasCardioLog(formData)
                    ? "Auto-saves as you log"
                    : ""}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="xl:hidden">
                <ActiveSessionTimer
                  formattedTime={timer.formattedTime}
                  isRunning={timer.isRunning}
                  onStart={timer.start}
                  onStop={timer.stop}
                  onRefresh={timer.refresh}
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  handleSubmit({
                    preventDefault: () => {},
                  } as React.FormEvent)
                }
                disabled={
                  (formData.exercises.length === 0 && !hasCardioLog(formData)) ||
                  isSaving
                }
                className="ml-auto px-4 py-2 rounded-xl bg-[#FF6B35] text-white text-sm font-semibold hover:bg-[#FF6B35]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? "Finishing..." : "Finish Workout"}
              </button>
            </div>
            {saveError && (
              <p className="mt-3 text-xs text-[#EF4444]">{saveError}</p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-4 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white">Cardio / Sports</h3>
                <p className="text-xs text-[#8E8E93] mt-0.5">
                  Optional — sport, time, intensity, and how tired you felt.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {CARDIO_SPORTS.map((sport) => {
                  const selected =
                    sport === "Other"
                      ? isCustomCardioSport(formData.cardio_sport)
                      : formData.cardio_sport === sport;
                  return (
                    <button
                      key={sport}
                      type="button"
                      onClick={() =>
                        setFormData({
                          ...formData,
                          cardio_sport: selected
                            ? ""
                            : sport === "Other"
                            ? "Other"
                            : sport,
                        })
                      }
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        selected
                          ? "bg-[#FF6B35]/20 border-[#FF6B35] text-white"
                          : "bg-[#0B0C10] border-[#2A2D35] text-[#8E8E93] hover:text-white hover:border-[#FF6B35]/40"
                      }`}
                    >
                      {sport}
                    </button>
                  );
                })}
              </div>
              {isCustomCardioSport(formData.cardio_sport) && (
                  <Input
                    label="Sport"
                    value={
                      formData.cardio_sport === "Other"
                        ? ""
                        : formData.cardio_sport
                    }
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        cardio_sport: e.target.value || "Other",
                      })
                    }
                    placeholder="What did you play?"
                    className="bg-[#0B0C10] border border-[#2A2D35] text-[#FFFFFF] placeholder:text-[#636366]"
                  />
                )}
              <Input
                label="Time (minutes)"
                type="number"
                min={0}
                inputMode="numeric"
                value={formData.cardio_minutes}
                onChange={(e) =>
                  setFormData({ ...formData, cardio_minutes: e.target.value })
                }
                placeholder="e.g. 45"
                className="bg-[#0B0C10] border border-[#2A2D35] text-[#FFFFFF] placeholder:text-[#636366]"
              />
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs sm:text-sm font-semibold text-white">
                    Intensity
                  </label>
                  <span className="text-sm font-bold text-[#FF6B35] tabular-nums">
                    {formData.cardio_intensity}/10
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={formData.cardio_intensity}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      cardio_intensity: Number(e.target.value),
                    })
                  }
                  className="w-full accent-[#FF6B35]"
                  aria-label="Cardio intensity from 1 to 10"
                />
                <div className="flex justify-between text-[11px] text-[#636366] mt-1">
                  <span>Easy</span>
                  <span>Max</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs sm:text-sm font-semibold text-white">
                    How tired do you feel?
                  </label>
                  <span className="text-sm font-bold text-[#FF6B35] tabular-nums">
                    {formData.cardio_fatigue}/10
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={formData.cardio_fatigue}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      cardio_fatigue: Number(e.target.value),
                    })
                  }
                  className="w-full accent-[#FF6B35]"
                  aria-label="How tired you feel from 1 to 10"
                />
                <div className="flex justify-between text-[11px] text-[#636366] mt-1">
                  <span>Fresh</span>
                  <span>Exhausted</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowSessionDetails(!showSessionDetails)}
              className="text-xs font-semibold text-[#8E8E93] hover:text-white transition-colors"
            >
              {showSessionDetails ? "Hide session details" : "Session details"}
            </button>

            {showSessionDetails && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-2xl bg-[#161A22] border border-[#2A2D35]">
                <Input
                  label="Workout Name (Optional)"
                  value={formData.split_name}
                  onChange={(e) =>
                    setFormData({ ...formData, split_name: e.target.value })
                  }
                  placeholder="e.g., Push Day, Leg Day, Full Body"
                  className="bg-[#0B0C10] border border-[#2A2D35] text-[#FFFFFF] placeholder:text-[#636366]"
                />

                <Input
                  label="Date"
                  type="date"
                  value={formData.date}
                  onChange={(e) =>
                    setFormData({ ...formData, date: e.target.value })
                  }
                  required
                  className="bg-[#0B0C10] border border-[#2A2D35] text-[#FFFFFF]"
                />

                <div className="flex flex-col">
                  <label className="block text-xs sm:text-sm font-semibold text-[#FFFFFF] mb-1.5 sm:mb-2">
                    Split (Optional)
                  </label>
                  <div className="relative z-30 flex-1" ref={splitDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowSplitDropdown(!showSplitDropdown)}
                      className="w-full h-[46px] px-3 sm:px-4 text-base rounded-lg bg-[#2A2D35] text-left text-[#FFFFFF] focus:outline-none focus:ring-2 focus:ring-[#FF6B35] cursor-pointer transition-all flex items-center justify-between"
                    >
                      <span className="truncate">
                        {formData.split_id
                          ? splits.find((s) => s.id === formData.split_id)
                              ?.name || "No Split"
                          : "No Split"}
                      </span>
                      <MdKeyboardArrowDown
                        className={`text-[#8E8E93] text-lg sm:text-xl flex-shrink-0 transition-transform ${
                          showSplitDropdown ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    {showSplitDropdown && (
                      <div className="absolute z-[100] w-full mt-1 bg-[#161A22] border border-[#2A2D35] rounded-lg shadow-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({
                              ...formData,
                              split_id: "",
                              split_name: "",
                              split_day: "",
                            });
                            setShowSplitDropdown(false);
                          }}
                          className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-[#FFFFFF] hover:bg-[#2A2D35] transition-colors ${
                            !formData.split_id ? "bg-[#FF6B35]/20" : ""
                          }`}
                        >
                          No Split
                        </button>
                        {splits.map((split) => (
                          <button
                            key={split.id}
                            type="button"
                            onClick={() => {
                              setFormData({
                                ...formData,
                                split_id: split.id || "",
                                split_name: split.name,
                                split_day: "",
                              });
                              setShowSplitDropdown(false);
                            }}
                            className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-[#FFFFFF] hover:bg-[#2A2D35] transition-colors ${
                              formData.split_id === split.id
                                ? "bg-[#FF6B35]/20"
                                : ""
                            }`}
                          >
                            {split.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {formData.split_id && (() => {
                  const selectedSplit = splits.find((s) => s.id === formData.split_id);
                  return selectedSplit && selectedSplit.days && selectedSplit.days.length > 0 ? (
                    <div className="flex flex-col">
                      <label className="block text-xs sm:text-sm font-semibold text-[#FFFFFF] mb-1.5 sm:mb-2">
                        Split Day (Optional)
                      </label>
                      <div className="relative z-20 flex-1" ref={dayDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setShowDayDropdown(!showDayDropdown)}
                          className="w-full h-[46px] px-3 sm:px-4 text-base rounded-lg bg-[#2A2D35] text-left text-[#FFFFFF] focus:outline-none focus:ring-2 focus:ring-[#FF6B35] cursor-pointer transition-all flex items-center justify-between"
                        >
                          <span className="truncate">
                            {formData.split_day || "Select Day"}
                          </span>
                          <MdKeyboardArrowDown
                            className={`text-[#8E8E93] text-lg sm:text-xl flex-shrink-0 transition-transform ${
                              showDayDropdown ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                        {showDayDropdown && (
                          <div className="absolute z-[100] w-full mt-1 bg-[#161A22] border border-[#2A2D35] rounded-lg shadow-lg overflow-hidden">
                            <button
                              type="button"
                              onClick={() => {
                                setFormData({ ...formData, split_day: "" });
                                setShowDayDropdown(false);
                              }}
                              className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-[#FFFFFF] hover:bg-[#2A2D35] transition-colors ${
                                !formData.split_day ? "bg-[#FF6B35]/20" : ""
                              }`}
                            >
                              No Specific Day
                            </button>
                            {selectedSplit.days.map((day, index) => (
                              <button
                                key={index}
                                type="button"
                                onClick={() => {
                                  setFormData({ ...formData, split_day: day });
                                  setShowDayDropdown(false);
                                }}
                                className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-[#FFFFFF] hover:bg-[#2A2D35] transition-colors ${
                                  formData.split_day === day
                                    ? "bg-[#FF6B35]/20"
                                    : ""
                                }`}
                              >
                                {day}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null;
                })()}
                </div>

                <Input
                  label="Notes (Optional)"
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  placeholder="How did the workout feel?"
                  className="bg-[#0B0C10] border border-[#2A2D35] text-[#FFFFFF] placeholder:text-[#636366]"
                />
              </>
            )}

            {/* Search + category filters */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="relative flex-1" ref={exerciseDropdownRef}>
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8E8E93]">
                  <MdSearch size={18} />
                </div>
                <input
                  type="text"
                  value={exerciseSearchQuery}
                  onChange={(e) => {
                    setExerciseSearchQuery(e.target.value);
                    if (e.target.value) {
                      setPickerAnchor("top");
                      setShowExercisePicker(true);
                      setPickerMode("search");
                    }
                  }}
                  onFocus={() => {
                    setPickerAnchor("top");
                    setShowExercisePicker(true);
                  }}
                  placeholder="Search exercises..."
                  className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#161A22] border border-[#2A2D35] text-white placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/40"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {categoryFilterPills.map((pill) => {
                  const isActive = categoryFilter === pill.id;
                  return (
                    <button
                      key={pill.label}
                      type="button"
                      onClick={() => {
                        setCategoryFilter(pill.id);
                        setShowExercisePicker(true);
                      }}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                        isActive
                          ? "border border-[#FF6B35] text-[#FF6B35] bg-[#FF6B35]/10"
                          : "border border-[#2A2D35] text-[#8E8E93] hover:text-white hover:border-[#3A3A3C]"
                      }`}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => openExercisePicker("top")}
              className="order-1 w-full py-3 rounded-xl border border-dashed border-[#3A3A3C] text-[#8E8E93] hover:text-[#FF6B35] hover:border-[#FF6B35]/40 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <MdAdd size={18} /> Add exercise
            </button>

            {/* Exercise picker */}
            {showExercisePicker && (
              <div
                ref={exerciseSelectionRef}
                className={`rounded-2xl border border-[#2A2D35] bg-[#161A22] overflow-hidden ${
                  pickerAnchor === "bottom" ? "order-6" : "order-2"
                }`}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2D35]">
                  <div className="flex items-center gap-3">
                    {selectedBodyPart && pickerMode === "browse" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBodyPart(null);
                          setEquipmentFilter(null);
                        }}
                        className="text-[#8E8E93] hover:text-white transition-colors"
                      >
                        <MdArrowBack size={20} />
                      </button>
                    ) : null}
                    <p className="text-sm font-semibold text-white">Select Exercise</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowExercisePicker(false);
                      setSelectedBodyPart(null);
                      setEquipmentFilter(null);
                      setExerciseSearchQuery("");
                      setCategoryFilter(null);
                    }}
                    className="text-[#8E8E93] hover:text-white transition-colors"
                  >
                    <MdClose size={20} />
                  </button>
                </div>

                {/* Browse / Search tabs */}
                <div className="grid grid-cols-2 mx-4 mt-3 gap-0">
                  <button
                    type="button"
                    onClick={() => {
                      setPickerMode("browse");
                      setExerciseSearchQuery("");
                    }}
                    className={`py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                      pickerMode === "browse"
                        ? "bg-[#FF6B35] text-white"
                        : "text-[#8E8E93] hover:text-white"
                    }`}
                  >
                    Browse
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPickerMode("search");
                      setSelectedBodyPart(null);
                      setEquipmentFilter(null);
                    }}
                    className={`py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                      pickerMode === "search"
                        ? "bg-[#FF6B35] text-white"
                        : "text-[#8E8E93] hover:text-white"
                    }`}
                  >
                    Search
                  </button>
                </div>

                {pickerMode === "browse" ? (
                  selectedBodyPart ? (
                    /* Exercise list for selected body part */
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8E8E93]">
                          {selectedBodyPart} Exercises
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBodyPart(null);
                            setEquipmentFilter(null);
                          }}
                          className="text-xs font-semibold text-[#5EEAD4] hover:text-[#5EEAD4]/80 transition-colors"
                        >
                          Change Body Part
                        </button>
                      </div>

                      {/* Equipment filter pills */}
                      <div className="flex flex-wrap gap-2 mb-3">
                        {(() => {
                          const equipmentTypes = [...new Set(
                            allExercises
                              .filter((ex) => ex.category === selectedBodyPart)
                              .map((ex) => ex.equipment)
                              .filter(Boolean)
                          )] as string[];
                          return equipmentTypes.map((eq) => (
                            <button
                              key={eq}
                              type="button"
                              onClick={() =>
                                setEquipmentFilter(
                                  equipmentFilter === eq ? null : eq
                                )
                              }
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                                equipmentFilter === eq
                                  ? "border border-[#FF6B35] text-[#FF6B35] bg-[#FF6B35]/10"
                                  : "border border-[#2A2D35] text-[#8E8E93] hover:text-white hover:border-[#3A3A3C]"
                              }`}
                            >
                              {eq}
                            </button>
                          ));
                        })()}
                      </div>

                      {/* Exercise list */}
                      <div className="max-h-[320px] overflow-y-auto custom-scrollbar space-y-0.5">
                        {allExercises
                          .filter((ex) => {
                            if (ex.category !== selectedBodyPart) return false;
                            if (equipmentFilter && ex.equipment !== equipmentFilter)
                              return false;
                            return true;
                          })
                          .map((ex) => (
                            <button
                              key={ex.id}
                              type="button"
                              onClick={() => {
                                handleExerciseChange(ex.id, ex.name);
                                setShowExercisePicker(false);
                                setSelectedBodyPart(null);
                                setEquipmentFilter(null);
                                setExerciseSearchQuery("");
                              }}
                              className="w-full flex items-center justify-between px-3 py-3 rounded-xl text-left text-white hover:bg-[#2A2D35] transition-colors"
                            >
                              <span className="font-semibold text-sm">
                                {ex.name}
                              </span>
                              {ex.equipment && (
                                <span className="text-[10px] uppercase text-[#636366] font-bold">
                                  {ex.equipment}
                                </span>
                              )}
                            </button>
                          ))}
                      </div>
                    </div>
                  ) : (
                    /* Body part grid */
                    <div className="p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8E8E93] mb-3">
                        Select Body Part
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {categories.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setSelectedBodyPart(cat)}
                            className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-[#0B0C10]/60 border border-[#2A2D35] text-left text-white hover:border-[#3A3A3C] hover:bg-[#1C1C1E] transition-colors"
                          >
                            <MdChevronRight
                              size={18}
                              className="text-[#636366]"
                            />
                            <span className="text-sm font-semibold">{cat}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                ) : (
                  /* Search mode */
                  <div className="p-4">
                    <div className="relative mb-3">
                      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8E8E93]">
                        <MdSearch size={18} />
                      </div>
                      <input
                        type="text"
                        value={exerciseSearchQuery}
                        onChange={(e) => setExerciseSearchQuery(e.target.value)}
                        placeholder="Search all exercises..."
                        autoFocus
                        className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#0B0C10] border border-[#2A2D35] text-white placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/40"
                      />
                    </div>
                    <div className="max-h-[320px] overflow-y-auto custom-scrollbar space-y-0.5">
                      {allExercises
                        .filter((ex) => {
                          if (!exerciseSearchQuery.trim()) return true;
                          return ex.name
                            .toLowerCase()
                            .includes(
                              exerciseSearchQuery.trim().toLowerCase()
                            );
                        })
                        .slice(0, 40)
                        .map((ex) => (
                          <button
                            key={ex.id}
                            type="button"
                            onClick={() => {
                              handleExerciseChange(ex.id, ex.name);
                              setShowExercisePicker(false);
                              setExerciseSearchQuery("");
                            }}
                            className="w-full flex items-center justify-between px-3 py-3 rounded-xl text-left text-white hover:bg-[#2A2D35] transition-colors"
                          >
                            <span className="font-semibold text-sm">
                              {ex.name}
                            </span>
                            {ex.equipment && (
                              <span className="text-[10px] uppercase text-[#636366] font-bold">
                                {ex.equipment}
                              </span>
                            )}
                          </button>
                        ))}
                      {exerciseSearchQuery.trim() &&
                        allExercises.filter((ex) =>
                          ex.name
                            .toLowerCase()
                            .includes(
                              exerciseSearchQuery.trim().toLowerCase()
                            )
                        ).length === 0 && (
                          <p className="text-sm text-[#8E8E93] text-center py-6">
                            No exercises match your search.
                          </p>
                        )}
                    </div>
                  </div>
                )}
              </div>
            )}

              {/* List of Added Exercises */}
              <div className="order-3 space-y-4">
                {formData.exercises.map((ex, idx) => {
                  const exerciseSets = Array.isArray(ex.sets) ? ex.sets : [];
                  const isCardio = ex.hasOwnProperty("time") || ex.hasOwnProperty("speed");
                  const isCollapsed = collapsedExercises[idx] ?? false;
                  const completedCount = getCompletedSetCount(exerciseSets);
                  const totalSetCount = exerciseSets.length;
                  const categoryLabel = getExerciseCategory(
                    ex.exercise_id,
                    ex.exercise_name
                  );
                  const roleLabel = getExerciseRole(idx);
                  const lastData = resolveLastExercise(
                    lastExerciseData[ex.exercise_id],
                    sessions,
                    ex.exercise_id,
                    ex.exercise_name,
                    editingSessionId
                  );
                  const lastSets = lastWorkingSets(lastData);
                  const maxData = maxExerciseData[ex.exercise_id];
                  const aiRec =
                    aiRecommendations[ex.exercise_id] || ex.ai_recommendation;
                  const aiLoading = aiRecommendationLoading[ex.exercise_id];
                  const bestSetLabel = getBestSetLabel(maxData);
                  const confPct =
                    aiRec && !aiRec.needs_starting_weight
                      ? confidencePct(aiRec.confidence)
                      : null;

                  return (
                    <div
                      key={idx}
                      className="bg-[#161A22] rounded-2xl border border-[#2A2D35] overflow-hidden"
                    >
                      {/* Exercise Header */}
                      <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
                        <button
                          type="button"
                          onClick={() => {
                            setShowExercisePicker(true);
                            exerciseSelectionRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "nearest",
                            });
                          }}
                          className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#1C1C1E] border border-[#2A2D35] flex items-center justify-center text-[#8E8E93] hover:text-[#FF6B35] hover:border-[#FF6B35]/40 transition-colors"
                          title="Swap exercise"
                        >
                          <MdSwapHoriz size={20} />
                        </button>

                        <div className="flex-1 min-w-0">
                          <h4 className="text-base sm:text-lg font-bold text-white truncate">
                            {ex.exercise_name}
                          </h4>
                          <p className="text-xs text-[#8E8E93] mt-0.5">
                            {categoryLabel} · {roleLabel}
                          </p>
                          {formatLastPerformance(lastData) && (
                            <p className="text-xs text-[#5EEAD4]/90 mt-0.5 leading-relaxed">
                              Last {formatShortDate(lastData.date)}:{" "}
                              {formatLastPerformance(lastData)}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2.5 flex-shrink-0">
                          {!isCardio && (
                            <span className="text-xs sm:text-sm font-medium text-[#8E8E93] whitespace-nowrap">
                              {completedCount}/{totalSetCount} sets
                            </span>
                          )}
                          {(aiRec || aiLoading) && (
                            <span className="w-7 h-7 rounded-full bg-[#5EEAD4]/15 border border-[#5EEAD4]/30 flex items-center justify-center text-[10px] font-bold text-[#5EEAD4]">
                              AI
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeExercise(idx)}
                            className="text-[#636366] hover:text-[#EF4444] transition-colors"
                            title="Remove exercise"
                            aria-label={`Remove ${ex.exercise_name}`}
                          >
                            <MdDelete size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleExerciseCollapse(idx)}
                            className="text-[#8E8E93] hover:text-white transition-colors"
                            title={isCollapsed ? "Expand" : "Collapse"}
                          >
                            <MdExpandMore
                              size={22}
                              className={`transition-transform duration-200 ${
                                isCollapsed ? "-rotate-90" : ""
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      {!isCollapsed && (
                        <div>
                          {/* AI Coach — full-bleed band */}
                          {aiLoading ? (
                            <div className="bg-[#142422] px-4 sm:px-5 py-4 border-y border-[#5EEAD4]/20">
                              <div className="flex items-center gap-2">
                                <svg
                                  className="animate-spin h-4 w-4 text-[#5EEAD4]"
                                  xmlns="http://www.w3.org/2000/svg"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                >
                                  <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                  />
                                  <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                  />
                                </svg>
                                <span className="text-sm font-semibold text-[#5EEAD4]">
                                  Getting AI recommendation...
                                </span>
                              </div>
                            </div>
                          ) : (
                            aiRec && (
                              <div className="bg-[#142422] px-4 sm:px-5 py-4 border-y border-[#5EEAD4]/20">
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-[#5EEAD4]">
                                      ✦ AI Coach
                                    </span>
                                    {aiRec.generated_at && (
                                      <span className="text-[10px] font-semibold text-[#5EEAD4]/70">
                                        Saved with this session
                                      </span>
                                    )}
                                    {confPct && (
                                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#5EEAD4]/15 text-[#5EEAD4] border border-[#5EEAD4]/30">
                                        {confPct} confidence
                                      </span>
                                    )}
                                  </div>
                                  {lastData && formatLastPerformance(lastData) && (
                                    <p className="text-[11px] text-[#636366]">
                                      Last: {formatShortDate(lastData.date)} ·{" "}
                                      {formatLastPerformance(lastData)}
                                    </p>
                                  )}
                                </div>

                                {aiRec.needs_starting_weight &&
                                  !(lastWorkoutHasWeight(lastData) && isLastWorkoutRecent(lastData)) &&
                                  !recHasWeightedSets(aiRec) && (
                                  <div className="mb-3 rounded-xl border border-[#5EEAD4]/30 bg-[#0B0C10]/60 p-3 sm:p-4">
                                    <p className="text-sm font-semibold text-white">
                                      Choose your starting weight
                                    </p>
                                    <p className="mt-1 text-xs leading-relaxed text-[#8E8E93]">
                                      {aiRec.has_implausible_data
                                        ? "Your previous entry looked invalid, so it was ignored. "
                                        : "There is no usable weighted history for this exercise yet. "}
                                      Pick a weight you can control for{" "}
                                      {aiRec.suggested_reps || 6} reps with good form.
                                    </p>
                                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                      <div className="relative flex-1">
                                        <input
                                          type="number"
                                          min="0.5"
                                          step="0.5"
                                          value={startingWeights[ex.exercise_id] || ""}
                                          onChange={(event) =>
                                            setStartingWeights((prev) => ({
                                              ...prev,
                                              [ex.exercise_id]: event.target.value,
                                            }))
                                          }
                                          placeholder="Enter starting weight"
                                          aria-label={`Starting weight for ${ex.exercise_name}`}
                                          className="w-full rounded-xl border border-[#2A2D35] bg-[#0B0C10] px-3 py-2.5 pr-12 text-sm text-white outline-none transition-colors placeholder:text-[#636366] focus:border-[#5EEAD4]/60"
                                        />
                                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#636366]">
                                          lbs
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          applyStartingWeight(ex.exercise_id, idx)
                                        }
                                        disabled={
                                          !startingWeights[ex.exercise_id] ||
                                          Number(startingWeights[ex.exercise_id]) <= 0
                                        }
                                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#5EEAD4]/40 bg-[#5EEAD4]/10 px-4 py-2.5 text-xs font-semibold text-[#5EEAD4] transition-colors hover:bg-[#5EEAD4]/15 disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm"
                                      >
                                        <MdBolt size={15} />
                                        Use starting weight
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {aiRec.sets && Array.isArray(aiRec.sets) && (
                                  <div className="flex gap-2 mb-3">
                                    {aiRec.sets.slice(0, 3).map(
                                      (set: any, setIdx: number) => (
                                        <div
                                          key={setIdx}
                                          className="rounded-xl bg-[#0B0C10]/60 border border-[#5EEAD4]/25 px-4 py-2.5 min-w-[80px]"
                                        >
                                          <p className="text-[10px] font-bold uppercase tracking-wide text-[#5EEAD4]/60 mb-1">
                                            Set {set.set_number || setIdx + 1}
                                          </p>
                                          <p className="text-white">
                                            <span className="text-base font-bold">
                                              {set.reps}
                                            </span>
                                            <span className="text-xs text-[#8E8E93] ml-1">
                                              reps
                                            </span>
                                          </p>
                                          {set.weight != null && set.weight > 0 && (
                                            <p className="text-sm font-bold text-[#5EEAD4]">
                                              {set.weight} lbs
                                            </p>
                                          )}
                                        </div>
                                      )
                                    )}
                                  </div>
                                )}

                                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                                  {aiRec.reasoning && (
                                    <p className="text-xs text-[#8E8E93] leading-relaxed flex-1">
                                      {aiRec.reasoning}
                                    </p>
                                  )}
                                  {(!aiRec.needs_starting_weight ||
                                    recHasWeightedSets(aiRec) ||
                                    (lastWorkoutHasWeight(lastData) &&
                                      isLastWorkoutRecent(lastData))) &&
                                    aiRec.sets &&
                                    Array.isArray(aiRec.sets) && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        applyAiSets(ex.exercise_id, idx)
                                      }
                                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#5EEAD4]/40 bg-[#5EEAD4]/10 text-[#5EEAD4] text-xs sm:text-sm font-semibold hover:bg-[#5EEAD4]/15 transition-colors shadow-ai flex-shrink-0 sm:ml-auto"
                                    >
                                      <MdBolt size={15} />
                                      Apply sets
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          )}

                          {/* Stats — full-bleed band */}
                          {maxData && maxData.max_weight != null && (
                            <div className="flex items-stretch divide-x divide-[#2A2D35]/80 bg-[#1A1410] border-b border-[#2A2D35]/60 px-4 sm:px-5 py-3">
                              <div className="flex-1 px-2 first:pl-0">
                                <p className="text-[10px] uppercase tracking-wide text-[#FF6B35] font-bold">
                                  PR
                                </p>
                                <p className="text-sm font-bold text-white mt-0.5">
                                  {maxData.max_weight} lbs
                                </p>
                              </div>
                              {maxData.max_reps != null &&
                                maxData.max_reps > 0 && (
                                  <div className="flex-1 px-2">
                                    <p className="text-[10px] uppercase tracking-wide text-[#636366] font-semibold">
                                      Est. 1RM
                                    </p>
                                    <p className="text-sm font-bold text-white mt-0.5">
                                      {Math.round(
                                        maxData.max_weight *
                                          (1 + maxData.max_reps / 30)
                                      )}{" "}
                                      lbs
                                    </p>
                                  </div>
                                )}
                              {bestSetLabel && (
                                <div className="flex-1 px-2">
                                  <p className="text-[10px] uppercase tracking-wide text-[#636366] font-semibold">
                                    Best Set
                                  </p>
                                  <p className="text-sm font-bold text-white mt-0.5">
                                    {bestSetLabel}
                                  </p>
                                </div>
                              )}
                              {maxData.max_volume != null && (
                                <div className="flex-1 px-2 last:pr-0">
                                  <p className="text-[10px] uppercase tracking-wide text-[#636366] font-semibold">
                                    Max Volume
                                  </p>
                                  <p className="text-sm font-bold text-white mt-0.5">
                                    {Math.round(maxData.max_volume)} lbs
                                  </p>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="px-4 sm:px-5 py-4 space-y-3">
                          {isCardio ? (
                            <div className="space-y-4">
                              <div>
                                <label className="block text-[10px] font-bold text-[#636366] uppercase tracking-wide mb-2">
                                  Time (minutes)
                                </label>
                                <input
                                  type="number"
                                  value={ex.time || ""}
                                  onChange={(e) => {
                                    const newExercises = [...formData.exercises];
                                    newExercises[idx] = {
                                      ...newExercises[idx],
                                      time: e.target.value
                                        ? parseFloat(e.target.value)
                                        : undefined,
                                    };
                                    setFormData({
                                      ...formData,
                                      exercises: newExercises,
                                    });
                                  }}
                                  placeholder="—"
                                  className="w-full px-4 py-3 rounded-xl bg-[#0B0C10] border border-[#2A2D35] text-white placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/50"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-[#636366] uppercase tracking-wide mb-2">
                                  Speed (mph)
                                </label>
                                <input
                                  type="number"
                                  value={ex.speed || ""}
                                  onChange={(e) => {
                                    const newExercises = [...formData.exercises];
                                    newExercises[idx] = {
                                      ...newExercises[idx],
                                      speed: e.target.value
                                        ? parseFloat(e.target.value)
                                        : undefined,
                                    };
                                    setFormData({
                                      ...formData,
                                      exercises: newExercises,
                                    });
                                  }}
                                  placeholder="—"
                                  className="w-full px-4 py-3 rounded-xl bg-[#0B0C10] border border-[#2A2D35] text-white placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/50"
                                />
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="grid grid-cols-12 gap-2 sm:gap-3 text-[10px] font-bold text-[#636366] uppercase tracking-wide">
                                <div className="col-span-1">Set</div>
                                <div className="col-span-4">Reps</div>
                                <div className="col-span-4">Weight (lbs)</div>
                                <div className="col-span-2">RPE</div>
                                <div className="col-span-1" />
                              </div>

                              <div className="space-y-1.5">
                                {exerciseSets.map((set, setIdx) => {
                                  const lastSet = lastSets[setIdx];
                                  const lastRepsHint =
                                    lastSet && lastSet.reps > 0
                                      ? String(lastSet.reps)
                                      : "—";
                                  const lastWeightHint =
                                    lastSet && lastSet.weight != null && lastSet.weight > 0
                                      ? String(lastSet.weight)
                                      : "—";
                                  return (
                                  <div
                                    key={setIdx}
                                    className="grid grid-cols-12 gap-2 sm:gap-3 items-center"
                                  >
                                    <div className="col-span-1">
                                      <div className="text-sm font-medium text-[#8E8E93]">
                                        {set.set_number}
                                      </div>
                                      {lastSet && (
                                        <div className="text-[9px] leading-tight text-[#636366]">
                                          {lastSet.weight != null && lastSet.weight > 0
                                            ? `${lastSet.reps}×${lastSet.weight}`
                                            : `${lastSet.reps}r`}
                                        </div>
                                      )}
                                    </div>
                                    <div className="col-span-4">
                                      <input
                                        type="number"
                                        value={set.reps === 0 ? "" : set.reps}
                                        onChange={(e) => {
                                          const newExercises = [
                                            ...formData.exercises,
                                          ];
                                          const newSets = [...exerciseSets];
                                          const inputValue = e.target.value;
                                          const value =
                                            inputValue === ""
                                              ? 0
                                              : parseInt(inputValue) || 0;
                                          newSets[setIdx] = {
                                            ...newSets[setIdx],
                                            reps: value,
                                          };
                                          newExercises[idx] = {
                                            ...newExercises[idx],
                                            sets: newSets,
                                          };
                                          setFormData({
                                            ...formData,
                                            exercises: newExercises,
                                          });
                                        }}
                                        onFocus={(e) => e.target.select()}
                                        placeholder={lastRepsHint}
                                        className="w-full h-10 px-2 rounded-lg bg-[#0B0C10] border border-[#2A2D35] text-white text-sm text-center placeholder:text-[#636366] focus:outline-none focus:ring-1 focus:ring-[#FF6B35]/50"
                                      />
                                    </div>
                                    <div className="col-span-4">
                                      <input
                                        type="number"
                                        value={set.weight || ""}
                                        onChange={(e) => {
                                          const newExercises = [
                                            ...formData.exercises,
                                          ];
                                          const newSets = [...exerciseSets];
                                          newSets[setIdx] = {
                                            ...newSets[setIdx],
                                            weight: e.target.value
                                              ? parseFloat(e.target.value)
                                              : undefined,
                                          };
                                          newExercises[idx] = {
                                            ...newExercises[idx],
                                            sets: newSets,
                                          };
                                          setFormData({
                                            ...formData,
                                            exercises: newExercises,
                                          });
                                        }}
                                        placeholder={lastWeightHint}
                                        className="w-full h-10 px-2 rounded-lg bg-[#0B0C10] border border-[#2A2D35] text-white text-sm text-center placeholder:text-[#636366] focus:outline-none focus:ring-1 focus:ring-[#FF6B35]/50"
                                      />
                                    </div>
                                    <div className="col-span-2">
                                      <input
                                        type="number"
                                        min="1"
                                        max="10"
                                        step="0.5"
                                        value={set.rpe || ""}
                                        onChange={(e) => {
                                          const newExercises = [
                                            ...formData.exercises,
                                          ];
                                          const newSets = [...exerciseSets];
                                          newSets[setIdx] = {
                                            ...newSets[setIdx],
                                            rpe: e.target.value
                                              ? parseFloat(e.target.value)
                                              : undefined,
                                          };
                                          newExercises[idx] = {
                                            ...newExercises[idx],
                                            sets: newSets,
                                          };
                                          setFormData({
                                            ...formData,
                                            exercises: newExercises,
                                          });
                                        }}
                                        placeholder="—"
                                        className="w-full h-10 px-2 rounded-lg bg-[#0B0C10] border border-[#2A2D35] text-white text-sm text-center placeholder:text-[#636366] focus:outline-none focus:ring-1 focus:ring-[#FF6B35]/50"
                                      />
                                    </div>
                                    <div className="col-span-1 flex justify-center">
                                      <button
                                        type="button"
                                        onClick={() => removeSet(idx, setIdx)}
                                        className="text-[#636366] hover:text-[#EF4444] transition-colors"
                                        title="Remove set"
                                        aria-label={`Remove set ${set.set_number}`}
                                      >
                                        <MdClose size={16} />
                                      </button>
                                    </div>
                                  </div>
                                  );
                                })}
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  const newExercises = [...formData.exercises];
                                  const newSets = [...exerciseSets];
                                  newSets.push({
                                    set_number: exerciseSets.length + 1,
                                    reps: 0,
                                    weight: undefined,
                                    completed: false,
                                  });
                                  newExercises[idx] = {
                                    ...newExercises[idx],
                                    sets: newSets,
                                  };
                                  setFormData({
                                    ...formData,
                                    exercises: newExercises,
                                  });
                                }}
                                className="w-full py-2.5 border border-dashed border-[#3A3A3C] hover:border-[#FF6B35]/40 text-[#8E8E93] hover:text-[#FF6B35] text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
                              >
                                <MdAdd size={16} /> Add set
                              </button>
                            </>
                          )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

            <button
              type="button"
              onClick={() => openExercisePicker("bottom")}
              className="order-5 w-full py-3 rounded-xl border border-dashed border-[#3A3A3C] text-[#8E8E93] hover:text-[#FF6B35] hover:border-[#FF6B35]/40 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <MdAdd size={18} /> Add exercise
            </button>
            </div>

          </form>
        </div>
      )}

      {!showForm && (
        <div className="space-y-4">
          {sessions.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[#2A2D35] bg-[#161A22] px-6 py-16 text-center">
              <p className="text-[#FFFFFF] font-semibold mb-1">No sessions yet</p>
              <p className="text-sm text-[#8E8E93] mb-5">
                Log your first workout to see it here.
              </p>
              <Button onClick={() => setShowForm(true)} icon={<MdAdd />}>
                New Session
              </Button>
            </div>
          )}

          {sessions.map((session) => {
            const exerciseCount = session.exercises?.length || 0;

            return (
              <button
                key={session.id}
                type="button"
                onClick={() => handleEdit(session)}
                className="w-full text-left group bg-[#161A22] border border-[#2A2D35] rounded-2xl p-5 sm:p-6 shadow-sm hover:shadow-md hover:border-[#FF6B35]/40 transition-all"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base sm:text-lg font-bold text-[#FFFFFF] truncate">
                      {sessionListTitle(session)}
                    </h3>
                    <p className="text-sm text-[#8E8E93] mt-0.5">
                      {exerciseCount} exercise{exerciseCount !== 1 ? "s" : ""}
                      {session.cardio_sport || session.cardio_minutes
                        ? ` · ${[
                            session.cardio_sport,
                            session.cardio_minutes
                              ? `${session.cardio_minutes} min`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(session.id!);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          handleDelete(session.id!);
                        }
                      }}
                      className="p-1.5 rounded-lg text-[#636366] hover:text-[#EF4444] hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete"
                    >
                      <MdDelete size={18} />
                    </span>
                    <MdChevronRight className="text-[#3A3A3C] text-xl group-hover:text-[#FF6B35] transition-colors" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
