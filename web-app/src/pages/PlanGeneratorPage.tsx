import { useState, useEffect } from "react";
import apiClient from "../lib/api-client";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import SplitSelector from "../components/plan/SplitSelector";
import TopLiftsInput from "../components/plan/TopLiftsInput";
import ExerciseSuggestions from "../components/plan/ExerciseSuggestions";
import SplitRoutineInput from "../components/plan/SplitRoutineInput";
import {
  MdArrowBack,
  MdArrowForward,
  MdAutoAwesome,
  MdRefresh,
  MdDelete,
  MdExpandMore,
  MdFitnessCenter,
  MdTimer,
  MdCalendarToday,
  MdCheckCircle,
  MdPlaylistAdd,
  MdTune,
} from "react-icons/md";
import type {
  WorkoutPlan,
  PlanGenerationRequest,
  WorkoutPlanDay,
  Split,
  PlanCreationMode,
  TopLifts,
  ExerciseSuggestion,
  ExerciseSuggestionGroup,
  SplitRoutineExercise,
} from "../types";

const GOALS = [
  "Build Muscle",
  "Lose Fat",
  "Get Stronger",
  "General Fitness",
];

const SECONDARY_GOALS = [
  ...GOALS,
  "Improve overall health",
  "Reduce stress",
];

const FREQUENCIES = [
  { label: "2-3x / week", value: "2-3x/week", desc: "Great for beginners" },
  { label: "3-4x / week", value: "3-4x/week", desc: "Most popular" },
  { label: "5+ / week", value: "5+ times/week", desc: "Advanced" },
];

const SESSION_LENGTHS = ["30 min", "45 min", "60 min", "90 min"];

const EXPERIENCE_LEVELS = [
  {
    label: "Beginner",
    value: "Beginner (0-6 months)",
    desc: "New to the gym or returning after a long break",
  },
  {
    label: "Intermediate",
    value: "Intermediate (6-24 months)",
    desc: "Consistent training with solid form",
  },
  {
    label: "Advanced",
    value: "Advanced (2+ years)",
    desc: "Experienced lifter looking to optimize",
  },
];

const EQUIPMENT_OPTIONS = [
  "Full Gym",
  "Dumbbells Only",
  "Barbell + Rack",
  "Cable Machine",
  "Bodyweight Only",
  "Home Gym (Dumbbells + Bench)",
];

const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const TOP_LEVEL_MODES: {
  value: "generate" | "split_base";
  title: string;
  description: string;
  icon: typeof MdAutoAwesome;
}[] = [
  {
    value: "generate",
    title: "Generate from scratch",
    description: "AI designs the structure and exercises around your goals.",
    icon: MdAutoAwesome,
  },
  {
    value: "split_base",
    title: "Use my split as a base",
    description: "Start from a split you already have, then choose how to fill it in.",
    icon: MdTune,
  },
];

const SPLIT_SUB_MODES: {
  value: Exclude<PlanCreationMode, "generate">;
  title: string;
  description: string;
  icon: typeof MdAutoAwesome;
}[] = [
  {
    value: "use_split",
    title: "Customize with my info",
    description:
      "Pick the split, then enter your goals, schedule, and equipment so AI fills the exercises.",
    icon: MdTune,
  },
  {
    value: "adopt_split",
    title: "Adopt my current routine",
    description: "Keep the exercises from your recent split sessions exactly as-is.",
    icon: MdCheckCircle,
  },
  {
    value: "add_onto",
    title: "Add onto what I do",
    description: "Keep your routine and review a few gap-filling suggestions.",
    icon: MdPlaylistAdd,
  },
];

const TOP_LIFT_KEYS: (keyof TopLifts)[] = [
  "bench_press",
  "squat",
  "deadlift",
  "overhead_press",
  "barbell_row",
];

const normalizeTopLifts = (raw: unknown): TopLifts => {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const normalized: TopLifts = {};
  TOP_LIFT_KEYS.forEach((key) => {
    const value = source[key];
    if (typeof value === "number" && value > 0) {
      normalized[key] = { weight: value };
    } else if (value && typeof value === "object") {
      const entry = value as { weight?: unknown; reps?: unknown };
      if (typeof entry.weight === "number" && entry.weight > 0) {
        normalized[key] = {
          weight: entry.weight,
          reps:
            typeof entry.reps === "number" && entry.reps > 0
              ? entry.reps
              : undefined,
        };
      }
    }
  });
  return normalized;
};

export default function PlanGeneratorPage() {
  const [activePlan, setActivePlan] = useState<WorkoutPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState(0);
  const [showWizard, setShowWizard] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState(false);
  const [splits, setSplits] = useState<Split[]>([]);
  const [loadingSplits, setLoadingSplits] = useState(true);
  const [suggestions, setSuggestions] = useState<ExerciseSuggestionGroup[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<
    ExerciseSuggestion[]
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [splitRoutine, setSplitRoutine] = useState<
    Record<string, SplitRoutineExercise[]>
  >({});

  // Wizard form state
  const [form, setForm] = useState<PlanGenerationRequest>({
    primary_goal: "",
    experience_level: "",
    preferred_workout_frequency: "",
    preferred_session_length: "",
    available_equipment: [],
    preferred_workout_days: [],
    secondary_goals: [],
    mode: "generate",
    top_lifts: {},
  });

  const usingSplitBase = form.mode !== "generate";
  const selectedSplit = splits.find((split) => split.id === form.split_id);
  const selectedSplitDays = Array.from(
    new Set(
      (selectedSplit?.days || [])
        .map((day) => String(day).trim())
        .filter(Boolean)
    )
  );

  const routinePayload = usingSplitBase
    ? selectedSplitDays.map((day) => ({
        day,
        exercises: splitRoutine[day] || [],
      }))
    : undefined;
  const hasRoutineExercises = (routinePayload || []).some(
    (day) => day.exercises.length > 0
  );

  useEffect(() => {
    fetchActivePlan();
    fetchSetupData();
  }, []);

  const fetchSetupData = async () => {
    try {
      const [splitsRes, topLiftsRes] = await Promise.all([
        apiClient.get("/api/splits"),
        apiClient.get("/api/user-profile/top-lifts"),
      ]);
      setSplits(splitsRes.data || []);
      const savedTopLifts = normalizeTopLifts(topLiftsRes.data?.top_lifts);
      if (Object.keys(savedTopLifts).length) {
        setForm((prev) => ({ ...prev, top_lifts: savedTopLifts }));
      }
    } catch (error) {
      console.error("Error loading plan setup:", error);
    } finally {
      setLoadingSplits(false);
    }
  };

  const fetchActivePlan = async () => {
    try {
      const res = await apiClient.get("/api/workout-plan");
      if (res.data) {
        setActivePlan(res.data);
        setShowWizard(false);
      } else {
        setShowWizard(true);
      }
    } catch {
      setShowWizard(true);
    } finally {
      setLoading(false);
    }
  };

  const submitPlan = async () => {
    setGenerating(true);
    try {
      const payload = {
        ...form,
        split_routine: hasRoutineExercises ? routinePayload : undefined,
        accepted_additions:
          form.mode === "add_onto" ? selectedSuggestions : undefined,
      };
      const res = await apiClient.post("/api/workout-plan/generate", payload);
      setActivePlan(res.data);
      setShowWizard(false);
      setShowSuggestions(false);
      setStep(0);
    } catch (error: any) {
      console.error("Error generating plan:", error);
      alert(
        error?.response?.data?.detail ||
          "Failed to generate workout plan. Please try again."
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = async () => {
    if (form.mode !== "add_onto") {
      await submitPlan();
      return;
    }
    setGenerating(true);
    try {
      const res = await apiClient.post(
        "/api/workout-plan/suggest-additions",
        {
          split_id: form.split_id,
          primary_goal: form.primary_goal,
          available_equipment: form.available_equipment,
          split_routine: hasRoutineExercises ? routinePayload : undefined,
        }
      );
      const groups = (res.data?.suggestions || []) as ExerciseSuggestionGroup[];
      setSuggestions(groups);
      setSelectedSuggestions(
        groups.flatMap((group) =>
          group.exercises.map((exercise) => ({ ...exercise, day: group.day }))
        )
      );
      setShowSuggestions(true);
    } catch (error: any) {
      console.error("Error suggesting additions:", error);
      alert(
        error?.response?.data?.detail ||
          "Failed to review exercise additions. Please try again."
      );
    } finally {
      setGenerating(false);
    }
  };

  const toggleSuggestion = (suggestion: ExerciseSuggestion) => {
    setSelectedSuggestions((current) => {
      const exists = current.some(
        (item) =>
          item.exercise_id === suggestion.exercise_id &&
          item.day === suggestion.day
      );
      return exists
        ? current.filter(
            (item) =>
              item.exercise_id !== suggestion.exercise_id ||
              item.day !== suggestion.day
          )
        : [...current, suggestion];
    });
  };

  const handleRegenerate = async () => {
    if (!activePlan?.id) return;
    setGenerating(true);
    try {
      const res = await apiClient.post(
        `/api/workout-plan/${activePlan.id}/regenerate`
      );
      setActivePlan(res.data);
    } catch (error) {
      console.error("Error regenerating plan:", error);
      alert("Failed to regenerate plan.");
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!activePlan?.id) return;
    if (!confirm("Delete this workout plan? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/api/workout-plan/${activePlan.id}`);
      setActivePlan(null);
      setShowWizard(true);
    } catch (error) {
      console.error("Error deleting plan:", error);
    } finally {
      setDeleting(false);
    }
  };

  const toggleEquipment = (eq: string) => {
    setForm((prev) => ({
      ...prev,
      available_equipment: prev.available_equipment.includes(eq)
        ? prev.available_equipment.filter((e) => e !== eq)
        : [...prev.available_equipment, eq],
    }));
  };

  const toggleDay = (day: string) => {
    setForm((prev) => ({
      ...prev,
      preferred_workout_days: (prev.preferred_workout_days || []).includes(day)
        ? (prev.preferred_workout_days || []).filter((d) => d !== day)
        : [...(prev.preferred_workout_days || []), day],
    }));
  };

  const toggleSecondaryGoal = (goal: string) => {
    setForm((prev) => ({
      ...prev,
      secondary_goals: (prev.secondary_goals || []).includes(goal)
        ? (prev.secondary_goals || []).filter((g) => g !== goal)
        : [...(prev.secondary_goals || []), goal],
    }));
  };

  const selectPrimaryGoal = (goal: string) => {
    setForm((prev) => ({
      ...prev,
      primary_goal: goal,
      // A goal should not be selected as both primary and secondary.
      secondary_goals: (prev.secondary_goals || []).filter(
        (secondaryGoal) => secondaryGoal !== goal
      ),
    }));
  };

  const toggleDayExpand = (dayName: string) => {
    setExpandedDays((prev) => ({ ...prev, [dayName]: !prev[dayName] }));
  };

  const canProceed = () => {
    if (step === 0) {
      if (form.mode === "generate") return true;
      return !!form.split_id && usingSplitBase;
    }
    if (step === 1) return !!form.primary_goal;
    if (step === 2)
      return !!form.preferred_workout_frequency && !!form.preferred_session_length;
    if (step === 3)
      return !!form.experience_level && form.available_equipment.length > 0;
    if (step === 4) {
      if (form.mode === "adopt_split" || form.mode === "add_onto") {
        return hasRoutineExercises;
      }
      return true;
    }
    return false;
  };

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
        <div className="text-center text-[#8E8E93] py-20">Loading...</div>
      </div>
    );
  }

  // Generating overlay
  if (generating) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
        <div className="flex flex-col items-center justify-center py-32">
          <div className="w-16 h-16 rounded-2xl bg-[#FF6B35]/15 flex items-center justify-center mb-6">
            <MdAutoAwesome className="text-[#FF6B35] text-3xl animate-pulse" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">
            Building Your Plan
          </h2>
          <p className="text-[#8E8E93] text-center max-w-md">
            Our AI is designing a personalized workout program based on your
            goals and preferences...
          </p>
          <div className="mt-8 w-48 h-1.5 rounded-full bg-[#2A2D35] overflow-hidden">
            <div className="h-full rounded-full bg-[#FF6B35] animate-[progress_2s_ease-in-out_infinite]" />
          </div>
        </div>
        <style>{`
          @keyframes progress {
            0% { width: 0%; }
            50% { width: 80%; }
            100% { width: 100%; }
          }
        `}</style>
      </div>
    );
  }

  if (showSuggestions) {
    return (
      <div className="mx-auto max-w-[760px] p-4 sm:p-6 lg:p-8">
        <button
          type="button"
          onClick={() => setShowSuggestions(false)}
          className="mb-6 flex items-center gap-2 text-sm text-[#8E8E93] transition-colors hover:text-white"
        >
          <MdArrowBack size={18} />
          Back to plan setup
        </button>
        <div className="mb-8">
          <p className="mb-1 text-sm font-medium text-[#5EEAD4]">
            Optional additions
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Round out your routine
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#8E8E93]">
            Your existing exercises stay untouched. Select only the additions
            you want included.
          </p>
        </div>

        {suggestions.length ? (
          <ExerciseSuggestions
            groups={suggestions}
            selected={selectedSuggestions}
            onToggle={toggleSuggestion}
          />
        ) : (
          <Card>
            <p className="font-semibold text-white">Your routine looks balanced.</p>
            <p className="mt-1 text-sm text-[#8E8E93]">
              No useful catalog additions were found. You can continue with the
              routine as-is.
            </p>
          </Card>
        )}

        <div className="mt-8 flex flex-col-reverse justify-between gap-3 sm:flex-row">
          <Button
            variant="secondary"
            onClick={() => setSelectedSuggestions([])}
          >
            Select none
          </Button>
          <Button onClick={submitPlan} icon={<MdCheckCircle />}>
            Create Plan
            {selectedSuggestions.length
              ? ` with ${selectedSuggestions.length} addition${
                  selectedSuggestions.length === 1 ? "" : "s"
                }`
              : ""}
          </Button>
        </div>
      </div>
    );
  }

  // Plan View
  if (activePlan && !showWizard) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
        <div className="mb-8">
          <p className="text-[#8E8E93] text-sm mb-1 font-medium">
            AI Workout Plan
          </p>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            {activePlan.plan_name}
          </h1>
          {activePlan.plan_description && (
            <p className="text-[#8E8E93] mt-2">{activePlan.plan_description}</p>
          )}
        </div>

        {/* Plan meta */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-[#161A22] border border-[#2A2D35] rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#8E8E93] mb-1">
              Split Type
            </p>
            <p className="text-white font-semibold">{activePlan.split_type}</p>
          </div>
          <div className="bg-[#161A22] border border-[#2A2D35] rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#8E8E93] mb-1">
              Workout Days
            </p>
            <p className="text-white font-semibold">{activePlan.days.length}</p>
          </div>
          <div className="bg-[#161A22] border border-[#2A2D35] rounded-xl p-4 col-span-2 sm:col-span-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#8E8E93] mb-1">
              Created
            </p>
            <p className="text-white font-semibold text-sm">
              {activePlan.created_at
                ? new Date(activePlan.created_at).toLocaleDateString()
                : "—"}
            </p>
          </div>
        </div>

        {/* Weekly schedule strip */}
        <Card className="mb-6">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <MdCalendarToday className="text-[#FF6B35]" />
            Weekly Schedule
          </h3>
          <div className="grid grid-cols-7 gap-1.5">
            {(
              [
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
              ] as const
            ).map((day) => {
              const assignment =
                activePlan.weekly_schedule[day] || "Rest";
              const isRest =
                !assignment || assignment.toLowerCase() === "rest";
              return (
                <div
                  key={day}
                  className={`rounded-xl p-2.5 text-center ${
                    isRest
                      ? "bg-[#0B0C10] border border-[#1C1C1E]"
                      : "bg-[#FF6B35]/10 border border-[#FF6B35]/30"
                  }`}
                >
                  <p className="text-[10px] font-bold uppercase text-[#8E8E93] mb-1">
                    {day.slice(0, 3)}
                  </p>
                  <p
                    className={`text-xs font-semibold truncate ${
                      isRest ? "text-[#636366]" : "text-[#FF6B35]"
                    }`}
                  >
                    {isRest ? "Rest" : assignment}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Workout days */}
        <div className="space-y-4 mb-6">
          {activePlan.days.map((day: WorkoutPlanDay) => {
            const isExpanded = expandedDays[day.day_name] ?? false;
            return (
              <Card key={day.day_name}>
                <button
                  type="button"
                  onClick={() => toggleDayExpand(day.day_name)}
                  className="w-full flex items-center justify-between"
                >
                  <div className="text-left">
                    <h3 className="text-lg font-bold text-white">
                      {day.day_name}
                    </h3>
                    <p className="text-sm text-[#8E8E93] mt-0.5">
                      {day.focus} &middot; {day.exercises.length} exercises
                      {day.estimated_duration_minutes &&
                        ` \u00B7 ~${day.estimated_duration_minutes} min`}
                    </p>
                  </div>
                  <MdExpandMore
                    size={24}
                    className={`text-[#8E8E93] transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {isExpanded && (
                  <div className="mt-4 space-y-2">
                    {day.exercises.map((ex) => (
                      <div
                        key={ex.exercise_id + "-" + ex.order}
                        className="flex items-start gap-3 px-3 py-3 rounded-xl bg-[#0B0C10] border border-[#1C1C1E]"
                      >
                        <span className="w-6 h-6 rounded-full bg-[#FF6B35]/15 text-[#FF6B35] text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                          {ex.order}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white">
                            {ex.exercise_name}
                          </p>
                          <p className="text-xs text-[#8E8E93] mt-0.5">
                            {ex.sets} sets &times; {ex.reps} reps
                            {ex.rest_seconds &&
                              ` \u00B7 ${ex.rest_seconds}s rest`}
                          </p>
                          {ex.notes && (
                            <p className="text-xs text-[#5EEAD4] mt-1 italic">
                              {ex.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {/* Progression & deload notes */}
        {(activePlan.progression_notes || activePlan.deload_schedule) && (
          <Card className="mb-6">
            {activePlan.progression_notes && (
              <div className="mb-4">
                <h3 className="text-sm font-bold text-white mb-1">
                  Progression
                </h3>
                <p className="text-sm text-[#8E8E93]">
                  {activePlan.progression_notes}
                </p>
              </div>
            )}
            {activePlan.deload_schedule && (
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Deload</h3>
                <p className="text-sm text-[#8E8E93]">
                  {activePlan.deload_schedule}
                </p>
              </div>
            )}
          </Card>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setShowWizard(true);
              setStep(0);
            }}
            icon={<MdRefresh />}
          >
            New Plan
          </Button>
          {(!activePlan.creation_mode ||
            activePlan.creation_mode === "generate" ||
            activePlan.creation_mode === "use_split") && (
            <Button
              variant="ai"
              onClick={handleRegenerate}
              icon={<MdAutoAwesome />}
            >
              Regenerate
            </Button>
          )}
          <Button
            variant="danger"
            onClick={handleDelete}
            disabled={deleting}
            loading={deleting}
            icon={<MdDelete />}
          >
            Delete Plan
          </Button>
        </div>
      </div>
    );
  }

  // Wizard
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[700px] mx-auto">
      {activePlan && (
        <button
          onClick={() => setShowWizard(false)}
          className="flex items-center gap-2 text-sm text-[#8E8E93] hover:text-white mb-6 transition-colors"
        >
          <MdArrowBack size={18} />
          Back to current plan
        </button>
      )}

      <div className="mb-8">
        <p className="text-[#8E8E93] text-sm mb-1 font-medium">
          Step {step + 1} of 5
        </p>
        <h1 className="text-3xl font-bold text-white tracking-tight">
          {step === 0 && "How should we build it?"}
          {step === 1 && "What's your goal?"}
          {step === 2 && "Your schedule"}
          {step === 3 && "Your setup"}
          {step === 4 &&
            (usingSplitBase ? "Your workouts" : "Your top lifts")}
        </h1>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 rounded-full bg-[#2A2D35] mb-8">
        <div
          className="h-full rounded-full bg-[#FF6B35] transition-all duration-300"
          style={{ width: `${((step + 1) / 5) * 100}%` }}
        />
      </div>

      {/* Step 0: Creation mode */}
      {step === 0 && (
        <div className="space-y-6">
          <div className="space-y-2">
            {TOP_LEVEL_MODES.map((option) => {
              const selected =
                option.value === "generate"
                  ? form.mode === "generate"
                  : usingSplitBase;
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setForm((prev) => ({
                      ...prev,
                      mode:
                        option.value === "generate" ? "generate" : "use_split",
                      split_id:
                        option.value === "generate" ? undefined : prev.split_id,
                    }));
                    if (option.value === "generate") {
                      setSplitRoutine({});
                    }
                    setShowSuggestions(false);
                  }}
                  className={`flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                    selected
                      ? "border-[#FF6B35] bg-[#FF6B35]/10"
                      : "border-[#2A2D35] bg-[#161A22] hover:border-[#3A3A3C]"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                      selected
                        ? "bg-[#FF6B35]/15 text-[#FF6B35]"
                        : "bg-[#0B0C10] text-[#636366]"
                    }`}
                  >
                    <Icon size={20} />
                  </span>
                  <span>
                    <span
                      className={`block text-sm font-semibold ${
                        selected ? "text-[#FF6B35]" : "text-white"
                      }`}
                    >
                      {option.title}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-[#8E8E93]">
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {usingSplitBase && (
            <div className="space-y-5 rounded-2xl border border-[#2A2D35] bg-[#0B0C10]/60 p-4">
              <div>
                <label className="mb-3 block text-sm font-semibold text-white">
                  Choose a split
                </label>
                <SplitSelector
                  splits={splits}
                  selectedId={form.split_id}
                  loading={loadingSplits}
                  onSelect={(splitId) => {
                    setForm((prev) => ({ ...prev, split_id: splitId }));
                    const next = splits.find((split) => split.id === splitId);
                    if (next) {
                      const uniqueDays = Array.from(
                        new Set(
                          next.days
                            .map((day) => String(day).trim())
                            .filter(Boolean)
                        )
                      );
                      setSplitRoutine((prev) => {
                        const synced: Record<string, SplitRoutineExercise[]> =
                          {};
                        uniqueDays.forEach((day) => {
                          synced[day] = prev[day] || [];
                        });
                        return synced;
                      });
                    }
                  }}
                  onCreated={(split) => {
                    setSplits((prev) => [split, ...prev]);
                    if (split.id) {
                      setForm((prev) => ({ ...prev, split_id: split.id }));
                    }
                    const uniqueDays = Array.from(
                      new Set(
                        split.days
                          .map((day) => String(day).trim())
                          .filter(Boolean)
                      )
                    );
                    const synced: Record<string, SplitRoutineExercise[]> = {};
                    uniqueDays.forEach((day) => {
                      synced[day] = [];
                    });
                    setSplitRoutine(synced);
                  }}
                />
              </div>

              <div>
                <label className="mb-3 block text-sm font-semibold text-white">
                  How should we use it?
                </label>
                <div className="space-y-2">
                  {SPLIT_SUB_MODES.map((option) => {
                    const selected = form.mode === option.value;
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({
                            ...prev,
                            mode: option.value,
                          }));
                          setShowSuggestions(false);
                        }}
                        className={`flex w-full items-start gap-3 rounded-xl border-2 p-3.5 text-left transition-all ${
                          selected
                            ? "border-[#5EEAD4] bg-[#5EEAD4]/10"
                            : "border-[#2A2D35] bg-[#161A22] hover:border-[#3A3A3C]"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${
                            selected
                              ? "bg-[#5EEAD4]/15 text-[#5EEAD4]"
                              : "bg-[#0B0C10] text-[#636366]"
                          }`}
                        >
                          <Icon size={18} />
                        </span>
                        <span>
                          <span
                            className={`block text-sm font-semibold ${
                              selected ? "text-[#5EEAD4]" : "text-white"
                            }`}
                          >
                            {option.title}
                          </span>
                          <span className="mt-1 block text-xs leading-relaxed text-[#8E8E93]">
                            {option.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {(form.mode === "adopt_split" || form.mode === "add_onto") && (
                  <p className="mt-3 text-xs leading-relaxed text-[#8E8E93]">
                    GymAI reconstructs this routine from the exercises in your
                    recent sessions for each split day.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 1: Goals */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-white mb-3">
              Primary goal
            </label>
            <div className="grid grid-cols-2 gap-3">
              {GOALS.map((goal) => (
                <button
                  key={goal}
                  type="button"
                  onClick={() => selectPrimaryGoal(goal)}
                  className={`px-4 py-4 rounded-xl text-left font-semibold text-sm transition-all ${
                    form.primary_goal === goal
                      ? "bg-[#FF6B35]/15 border-2 border-[#FF6B35] text-[#FF6B35]"
                      : "bg-[#161A22] border-2 border-[#2A2D35] text-white hover:border-[#3A3A3C]"
                  }`}
                >
                  {goal}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-white mb-3">
              Secondary goals (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {SECONDARY_GOALS.filter(
                (goal) => goal !== form.primary_goal
              ).map((goal) => {
                const selected = (form.secondary_goals || []).includes(goal);
                return (
                  <button
                    key={goal}
                    type="button"
                    onClick={() => toggleSecondaryGoal(goal)}
                    className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-colors ${
                      selected
                        ? "bg-[#FF6B35]/15 border border-[#FF6B35] text-[#FF6B35]"
                        : "bg-[#161A22] border border-[#2A2D35] text-[#8E8E93] hover:text-white hover:border-[#3A3A3C]"
                    }`}
                  >
                    {goal}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Schedule */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-white mb-3">
              How often can you work out?
            </label>
            <div className="space-y-2">
              {FREQUENCIES.map((freq) => (
                <button
                  key={freq.value}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      preferred_workout_frequency: freq.value,
                    })
                  }
                  className={`w-full px-4 py-4 rounded-xl text-left transition-all flex items-center justify-between ${
                    form.preferred_workout_frequency === freq.value
                      ? "bg-[#FF6B35]/15 border-2 border-[#FF6B35]"
                      : "bg-[#161A22] border-2 border-[#2A2D35] hover:border-[#3A3A3C]"
                  }`}
                >
                  <div>
                    <p
                      className={`font-semibold text-sm ${
                        form.preferred_workout_frequency === freq.value
                          ? "text-[#FF6B35]"
                          : "text-white"
                      }`}
                    >
                      {freq.label}
                    </p>
                    <p className="text-xs text-[#8E8E93] mt-0.5">{freq.desc}</p>
                  </div>
                  <MdFitnessCenter
                    className={
                      form.preferred_workout_frequency === freq.value
                        ? "text-[#FF6B35]"
                        : "text-[#3A3A3C]"
                    }
                  />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-white mb-3">
              Session length
            </label>
            <div className="grid grid-cols-4 gap-2">
              {SESSION_LENGTHS.map((len) => (
                <button
                  key={len}
                  type="button"
                  onClick={() =>
                    setForm({ ...form, preferred_session_length: len })
                  }
                  className={`px-3 py-3 rounded-xl text-center text-sm font-semibold transition-all ${
                    form.preferred_session_length === len
                      ? "bg-[#FF6B35]/15 border-2 border-[#FF6B35] text-[#FF6B35]"
                      : "bg-[#161A22] border-2 border-[#2A2D35] text-[#8E8E93] hover:text-white hover:border-[#3A3A3C]"
                  }`}
                >
                  <MdTimer
                    className={`mx-auto mb-1 text-lg ${
                      form.preferred_session_length === len
                        ? "text-[#FF6B35]"
                        : "text-[#636366]"
                    }`}
                  />
                  {len}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-white mb-3">
              Preferred days (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((day) => {
                const selected = (form.preferred_workout_days || []).includes(
                  day
                );
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`w-12 h-12 rounded-xl text-xs font-bold transition-all ${
                      selected
                        ? "bg-[#FF6B35]/15 border-2 border-[#FF6B35] text-[#FF6B35]"
                        : "bg-[#161A22] border-2 border-[#2A2D35] text-[#8E8E93] hover:border-[#3A3A3C]"
                    }`}
                  >
                    {day.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Setup */}
      {step === 3 && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-white mb-3">
              Experience level
            </label>
            <div className="space-y-2">
              {EXPERIENCE_LEVELS.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  onClick={() =>
                    setForm({ ...form, experience_level: level.value })
                  }
                  className={`w-full px-4 py-4 rounded-xl text-left transition-all ${
                    form.experience_level === level.value
                      ? "bg-[#FF6B35]/15 border-2 border-[#FF6B35]"
                      : "bg-[#161A22] border-2 border-[#2A2D35] hover:border-[#3A3A3C]"
                  }`}
                >
                  <p
                    className={`font-semibold text-sm ${
                      form.experience_level === level.value
                        ? "text-[#FF6B35]"
                        : "text-white"
                    }`}
                  >
                    {level.label}
                  </p>
                  <p className="text-xs text-[#8E8E93] mt-0.5">{level.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-white mb-3">
              Available equipment
            </label>
            <div className="grid grid-cols-2 gap-2">
              {EQUIPMENT_OPTIONS.map((eq) => {
                const selected = form.available_equipment.includes(eq);
                return (
                  <button
                    key={eq}
                    type="button"
                    onClick={() => toggleEquipment(eq)}
                    className={`px-4 py-3 rounded-xl text-left text-sm font-semibold transition-all ${
                      selected
                        ? "bg-[#FF6B35]/15 border-2 border-[#FF6B35] text-[#FF6B35]"
                        : "bg-[#161A22] border-2 border-[#2A2D35] text-[#8E8E93] hover:text-white hover:border-[#3A3A3C]"
                    }`}
                  >
                    {eq}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Routine exercises + optional top lifts */}
      {step === 4 && (
        <div className="space-y-8">
          {usingSplitBase && (
            <div>
              <p className="mb-1 text-sm font-semibold text-white">
                Exercises you currently do
                {form.mode === "use_split" ? " (optional)" : ""}
              </p>
              <p className="mb-5 text-sm leading-relaxed text-[#8E8E93]">
                {form.mode === "use_split"
                  ? "You don’t need every exercise. A couple key lifts with weight (like bench, row, squat) is enough context for GymAI to build a full plan around your split."
                  : form.mode === "add_onto"
                    ? "Add the main lifts you already do. GymAI will keep them and suggest extras to fill gaps."
                    : "Add the workouts for each day of your split. GymAI will adopt these as your plan."}
              </p>
              {selectedSplitDays.length ? (
                <SplitRoutineInput
                  dayNames={selectedSplitDays}
                  value={splitRoutine}
                  onChange={setSplitRoutine}
                />
              ) : (
                <p className="text-sm text-[#8E8E93]">
                  Select a split first so we know which days to fill in.
                </p>
              )}
              {(form.mode === "adopt_split" || form.mode === "add_onto") &&
                !hasRoutineExercises && (
                  <p className="mt-3 text-xs text-[#FF6B35]">
                    Add at least one exercise to continue with this option.
                  </p>
                )}
              {form.mode === "use_split" && hasRoutineExercises && (
                <p className="mt-3 text-xs text-[#8E8E93]">
                  That amount of context is enough — GymAI will build out the
                  rest of each day.
                </p>
              )}
              {form.mode === "use_split" && !hasRoutineExercises && (
                <p className="mt-3 text-xs text-[#8E8E93]">
                  Optional. Skip this if you want, or add 1–2 key lifts with
                  weight for better starting estimates.
                </p>
              )}
            </div>
          )}

          <div>
            <p className="mb-1 text-sm font-semibold text-white">
              Recent lift context (optional)
            </p>
            <p className="mb-5 text-sm leading-relaxed text-[#8E8E93]">
              Enter any set you remember—heavy or moderate, not necessarily a
              max. GymAI uses the weight and optional reps as context for
              conservative starting suggestions.
            </p>
            <TopLiftsInput
              value={form.top_lifts || {}}
              onChange={(topLifts) =>
                setForm((prev) => ({ ...prev, top_lifts: topLifts }))
              }
            />
          </div>
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex items-center justify-between mt-10">
        <div>
          {step > 0 && (
            <Button
              variant="secondary"
              onClick={() => setStep(step - 1)}
              icon={<MdArrowBack />}
            >
              Back
            </Button>
          )}
        </div>
        <div>
          {step < 4 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              icon={<MdArrowForward />}
            >
              Continue
            </Button>
          ) : (
            <Button
              onClick={handleGenerate}
              disabled={!canProceed()}
              icon={<MdAutoAwesome />}
            >
              {form.mode === "add_onto"
                ? "Review Additions"
                : form.mode === "adopt_split"
                  ? "Adopt Routine"
                  : "Generate Plan"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
