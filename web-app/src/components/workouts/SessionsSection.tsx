"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import apiClient from "@/lib/api-client";
import { WorkoutSession, Exercise, Split, SessionExercise } from "@/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import {
  MdAdd,
  MdDelete,
  MdFitnessCenter,
  MdClose,
  MdEdit,
  MdKeyboardArrowDown,
  MdSearch,
  MdArrowBack,
  MdAccessTime,
} from "react-icons/md";
import defaultExercises, {
  categories,
  categoryToMuscleGroup,
} from "@/data/defaultExercises";

interface SessionsSectionProps {
  exercises: Exercise[];
  splits: Split[];
  editSessionId?: string | null;
}

export default function SessionsSection({
  exercises,
  splits,
  editSessionId: propEditSessionId,
}: SessionsSectionProps) {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    date: string;
    split_id: string;
    split_name: string;
    split_day: string;
    exercises: SessionExercise[];
    notes: string;
  }>({
    date: new Date().toISOString().split("T")[0],
    split_id: "",
    split_name: "",
    split_day: "",
    exercises: [],
    notes: "",
  });
  const [showSplitDropdown, setShowSplitDropdown] = useState(false);
  const [showDayDropdown, setShowDayDropdown] = useState(false);
  const splitDropdownRef = useRef<HTMLDivElement>(null);
  const dayDropdownRef = useRef<HTMLDivElement>(null);
  const [showExerciseDropdown, setShowExerciseDropdown] = useState(false);
  const [exerciseSearchQuery, setExerciseSearchQuery] = useState("");
  const exerciseDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(
    null
  );
  const [exerciseTab, setExerciseTab] = useState<"browse" | "search">("browse");
  const exerciseSelectionRef = useRef<HTMLDivElement>(null);
  const [lastExerciseData, setLastExerciseData] = useState<Record<string, any>>({});
  const [maxExerciseData, setMaxExerciseData] = useState<Record<string, any>>({});
  const [aiRecommendations, setAiRecommendations] = useState<Record<string, any>>({});
  const [aiRecommendationLoading, setAiRecommendationLoading] = useState<Record<string, boolean>>({});
  const [expandedRecommendations, setExpandedRecommendations] = useState<Record<string, boolean>>({});
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [aiSummaryStatus, setAiSummaryStatus] = useState<{
    hasSetup: boolean;
    needsSetup: boolean;
    isGenerating: boolean;
    sessionsLogged: number;
    sessionsNeeded: number;
  }>({ hasSetup: false, needsSetup: false, isGenerating: false, sessionsLogged: 0, sessionsNeeded: 3 });

  useEffect(() => {
    fetchSessions();
    checkAiSummaryStatus();
  }, []);

  // Auto-save functionality
  useEffect(() => {
    // Only auto-save if there are exercises and form is visible
    if (!showForm || formData.exercises.length === 0) {
      return;
    }

    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Set new timeout for auto-save (2 seconds after last change)
    autoSaveTimeoutRef.current = setTimeout(async () => {
      await performAutoSave();
    }, 2000);

    // Cleanup on unmount
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.exercises, formData.date, formData.split_name, formData.split_day, formData.notes, showForm, editingSessionId]);

  const performAutoSave = async () => {
    // Don't auto-save if no exercises
    if (formData.exercises.length === 0) {
      return;
    }

    setIsAutoSaving(true);
    try {
      // Filter out empty sets (0 reps and no weight) before saving
      const filteredExercises = formData.exercises.map(ex => {
        if (ex.sets && Array.isArray(ex.sets)) {
          // Filter out sets with 0 reps and no weight
          const validSets = ex.sets.filter(set => {
            const reps = set.reps || 0;
            const weight = set.weight;
            // Keep sets that have at least reps > 0 OR weight > 0
            return reps > 0 || (weight !== undefined && weight !== null && weight > 0);
          });
          
          // Only include exercise if it has valid sets (or is cardio)
          if (validSets.length > 0 || ex.time !== undefined || ex.speed !== undefined) {
            return { ...ex, sets: validSets };
          }
          return null; // Exclude exercises with no valid sets
        }
        return ex; // Keep cardio exercises or exercises without sets array
      }).filter(ex => ex !== null); // Remove null entries
      
      // Don't save if no exercises have valid data
      if (filteredExercises.length === 0) {
        setIsAutoSaving(false);
        return;
      }
      
      const payload = {
        date: formData.date,
        split_name: formData.split_name || undefined,
        split_day: formData.split_day || undefined,
        exercises: filteredExercises,
        notes: formData.notes || undefined,
      };

      if (editingSessionId) {
        await apiClient.put(
          `/api/workout-sessions/${editingSessionId}`,
          payload
        );
      } else {
        // For new sessions, create it and store the ID for future auto-saves
        const response = await apiClient.post("/api/workout-sessions", payload);
        if (response.data && response.data.id) {
          setEditingSessionId(response.data.id);
        }
      }

      setLastSaved(new Date());
      // Refresh sessions list to show updates
      fetchSessions();
    } catch (error) {
      console.error("Error auto-saving session:", error);
    } finally {
      setIsAutoSaving(false);
    }
  };

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
    positionInWorkout: number
  ) => {
    // Don't fetch if AI isn't set up
    if (!aiSummaryStatus.hasSetup && !aiSummaryStatus.needsSetup) {
      return;
    }
    
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
        current_workout_exercises: currentExercises
      });
      
      if (response.data && response.data.status === "success") {
        setAiRecommendations(prev => ({
          ...prev,
          [exerciseId]: response.data.recommendation
        }));
        // Auto-expand when recommendation is first loaded
        setExpandedRecommendations(prev => ({
          ...prev,
          [exerciseId]: true
        }));
      }
    } catch (error) {
      console.log("No AI recommendation available for this exercise");
    } finally {
      setAiRecommendationLoading(prev => ({ ...prev, [exerciseId]: false }));
    }
  };

  useEffect(() => {
    if (propEditSessionId && sessions.length > 0) {
      const sessionToEdit = sessions.find((s) => s.id === propEditSessionId);
      if (sessionToEdit) {
        setFormData({
          date: sessionToEdit.date,
          split_id: sessionToEdit.split_id || "",
          split_name: sessionToEdit.split_name || "",
          split_day: (sessionToEdit as any).split_day || "",
          exercises: sessionToEdit.exercises || [],
          notes: sessionToEdit.notes || "",
        });
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
        !exerciseDropdownRef.current.contains(event.target as Node)
      ) {
        setShowExerciseDropdown(false);
      }
    };

    if (showSplitDropdown || showDayDropdown || showExerciseDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showSplitDropdown, showDayDropdown, showExerciseDropdown]);

  const fetchSessions = async () => {
    try {
      const res = await apiClient.get("/api/workout-sessions");
      setSessions(res.data);
    } catch (error) {
      console.error("Error fetching sessions:", error);
    }
  };

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
    
    // Fetch last time this exercise was done
    try {
      const response = await apiClient.get(`/api/workout-sessions/last-exercise/${exerciseId}`);
      if (response.data) {
        setLastExerciseData(prev => ({
          ...prev,
          [exerciseId]: response.data
        }));
      }
    } catch (error) {
      // Silently fail if no previous data exists
      console.log("No previous exercise data found");
    }
    
    // Fetch all-time max for this exercise
    try {
      const maxResponse = await apiClient.get(`/api/workout-sessions/max-exercise/${exerciseId}`);
      if (maxResponse.data) {
        setMaxExerciseData(prev => ({
          ...prev,
          [exerciseId]: maxResponse.data
        }));
      }
    } catch (error) {
      // Silently fail if no max data exists
      console.log("No max exercise data found");
    }
    
    // Fetch AI recommendation for this exercise
    fetchAiRecommendation(exerciseId, exerciseName, positionInWorkout);
    
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
              sets: [{ set_number: 1, reps: 0, weight: undefined }],
            },
      ],
    });
    setExerciseSearchQuery("");
    setSelectedCategory(null);
    setSelectedEquipment(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Filter out empty sets (0 reps and no weight) before saving
      const filteredExercises = formData.exercises.map(ex => {
        if (ex.sets && Array.isArray(ex.sets)) {
          // Filter out sets with 0 reps and no weight
          const validSets = ex.sets.filter(set => {
            const reps = set.reps || 0;
            const weight = set.weight;
            // Keep sets that have at least reps > 0 OR weight > 0
            return reps > 0 || (weight !== undefined && weight !== null && weight > 0);
          });
          
          // Only include exercise if it has valid sets (or is cardio)
          if (validSets.length > 0 || ex.time !== undefined || ex.speed !== undefined) {
            return { ...ex, sets: validSets };
          }
          return null; // Exclude exercises with no valid sets
        }
        return ex; // Keep cardio exercises or exercises without sets array
      }).filter(ex => ex !== null); // Remove null entries
      
      const payload = {
        date: formData.date,
        split_name: formData.split_name || undefined,
        split_day: formData.split_day || undefined,
        exercises: filteredExercises,
        notes: formData.notes || undefined,
      };

      if (editingSessionId) {
        await apiClient.put(
          `/api/workout-sessions/${editingSessionId}`,
          payload
        );
      } else {
        await apiClient.post("/api/workout-sessions", payload);
      }

      // Keep recommendations but collapse them after saving
      setExpandedRecommendations({});

      resetForm();
      fetchSessions();
    } catch (error) {
      console.error("Error saving session:", error);
    }
  };

  const resetForm = () => {
    setFormData({
      date: new Date().toISOString().split("T")[0],
      split_id: "",
      split_name: "",
      split_day: "",
      exercises: [],
      notes: "",
    });
    setEditingSessionId(null);
    setShowForm(false);
    setShowExerciseDropdown(false);
    setExerciseSearchQuery("");
    setSelectedCategory(null);
    setSelectedEquipment(null);
    setLastExerciseData({});
    setMaxExerciseData({});
    // Don't clear recommendations - keep them visible but collapsed
    setAiRecommendationLoading({});
    // Collapse all recommendations when starting a new workout or after saving
    setExpandedRecommendations({});
    // Clear auto-save state
    setLastSaved(null);
    setIsAutoSaving(false);
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
  };

  const handleCancel = () => {
    resetForm();
  };

  const handleEdit = (session: WorkoutSession) => {
    setFormData({
      date: session.date,
      split_id: session.split_id || "",
      split_name: session.split_name || "",
      split_day: (session as any).split_day || "",
      exercises: session.exercises || [],
      notes: session.notes || "",
    });
    setEditingSessionId(session.id || null);
    setShowForm(true);
  };

  const handleDelete = async (sessionId: string) => {
    if (confirm("Are you sure you want to delete this workout session?")) {
      try {
        await apiClient.delete(`/api/workout-sessions/${sessionId}`);
        fetchSessions();
      } catch (error) {
        console.error("Error deleting session:", error);
      }
    }
  };

  const formatLastTime = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);
    
    const diffTime = today.getTime() - compareDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    }
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined 
    });
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold text-[#F9FAFB]">Workout Sessions</h2>
        <Button onClick={() => setShowForm(true)} icon={<MdAdd />}>
          Log Workout
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6 sm:mb-8 p-4 sm:p-6 bg-[#1A1F3A] border-none shadow-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="text-[#9CA3AF] hover:text-[#F9FAFB] transition-colors"
              >
                <MdArrowBack size={24} />
              </button>
              <h3 className="text-xl sm:text-2xl font-bold text-[#F9FAFB]">
                {editingSessionId
                  ? "Edit Workout Session"
                  : "Log Workout Session"}
              </h3>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8">
            {/* Auto-save indicator */}
            {isAutoSaving && (
              <div className="flex items-center gap-2 text-sm text-[#10B981] mb-2">
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Auto-saving...</span>
              </div>
            )}
            {lastSaved && !isAutoSaving && (
              <div className="text-xs text-[#9CA3AF] mb-2">
                Last saved: {lastSaved.toLocaleTimeString()}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Workout Name (Optional)"
                value={formData.split_name}
                onChange={(e) =>
                  setFormData({ ...formData, split_name: e.target.value })
                }
                placeholder="e.g., Push Day, Leg Day, Full Body"
                className="bg-[#2d3b4e] border-none text-white placeholder:text-gray-500"
              />

              <Input
                label="Date"
                type="date"
                value={formData.date}
                onChange={(e) =>
                  setFormData({ ...formData, date: e.target.value })
                }
                required
                className="bg-[#2d3b4e] border-none text-white"
              />

              <div className="flex flex-col">
                <label className="block text-xs sm:text-sm font-semibold text-[#F9FAFB] mb-1.5 sm:mb-2">
                  Split (Optional)
                </label>
                <div className="relative z-30 flex-1" ref={splitDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowSplitDropdown(!showSplitDropdown)}
                    className="w-full h-[46px] px-3 sm:px-4 text-base rounded-lg bg-[#2d3b4e] text-left text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1] cursor-pointer transition-all flex items-center justify-between"
                  >
                    <span className="truncate">
                      {formData.split_id
                        ? splits.find((s) => s.id === formData.split_id)
                            ?.name || "No Split"
                        : "No Split"}
                    </span>
                    <MdKeyboardArrowDown
                      className={`text-gray-400 text-lg sm:text-xl flex-shrink-0 transition-transform ${
                        showSplitDropdown ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {showSplitDropdown && (
                    <div className="absolute z-[100] w-full mt-1 bg-[#1A1F3A] border border-[#374151] rounded-lg shadow-lg overflow-hidden">
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
                        className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#374151] transition-colors ${
                          !formData.split_id ? "bg-[#6366F1]/20" : ""
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
                              split_day: "", // Reset day when split changes
                            });
                            setShowSplitDropdown(false);
                          }}
                          className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#374151] transition-colors ${
                            formData.split_id === split.id
                              ? "bg-[#6366F1]/20"
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

              {/* Split Day Dropdown - Only show if a split is selected */}
              {formData.split_id && (() => {
                const selectedSplit = splits.find((s) => s.id === formData.split_id);
                return selectedSplit && selectedSplit.days && selectedSplit.days.length > 0 ? (
                  <div className="flex flex-col">
                    <label className="block text-xs sm:text-sm font-semibold text-[#F9FAFB] mb-1.5 sm:mb-2">
                      Split Day (Optional)
                    </label>
                    <div className="relative z-20 flex-1" ref={dayDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowDayDropdown(!showDayDropdown)}
                        className="w-full h-[46px] px-3 sm:px-4 text-base rounded-lg bg-[#2d3b4e] text-left text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1] cursor-pointer transition-all flex items-center justify-between"
                      >
                        <span className="truncate">
                          {formData.split_day || "Select Day"}
                        </span>
                        <MdKeyboardArrowDown
                          className={`text-gray-400 text-lg sm:text-xl flex-shrink-0 transition-transform ${
                            showDayDropdown ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                      {showDayDropdown && (
                        <div className="absolute z-[100] w-full mt-1 bg-[#1A1F3A] border border-[#374151] rounded-lg shadow-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, split_day: "" });
                              setShowDayDropdown(false);
                            }}
                            className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#374151] transition-colors ${
                              !formData.split_day ? "bg-[#6366F1]/20" : ""
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
                              className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#374151] transition-colors ${
                                formData.split_day === day
                                  ? "bg-[#6366F1]/20"
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

            <div>
              <label className="block text-lg font-bold text-[#F9FAFB] mb-4">
                Exercises
              </label>

              {/* Exercise Selection Box */}
              <div
                ref={exerciseSelectionRef}
                className="bg-[#1a2332] rounded-xl border border-[#2d3b4e] overflow-hidden mb-6"
              >
                <div className="p-4 sm:p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h4 className="text-xl font-bold text-white">
                      Select Exercise
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowExerciseDropdown(false)}
                      className="text-gray-400 hover:text-white"
                    >
                      <MdClose size={24} />
                    </button>
                  </div>

                  {/* Tabs */}
                  <div className="flex bg-[#2d3b4e] p-1 rounded-lg mb-6">
                    <button
                      type="button"
                      onClick={() => setExerciseTab("browse")}
                      className={`flex-1 py-2 rounded-md font-semibold transition-all ${
                        exerciseTab === "browse"
                          ? "bg-white text-[#1a2332]"
                          : "text-gray-400"
                      }`}
                    >
                      Browse
                    </button>
                    <button
                      type="button"
                      onClick={() => setExerciseTab("search")}
                      className={`flex-1 py-2 rounded-md font-semibold transition-all ${
                        exerciseTab === "search"
                          ? "bg-white text-[#1a2332]"
                          : "text-gray-400"
                      }`}
                    >
                      Search
                    </button>
                  </div>

                  {exerciseTab === "browse" ? (
                    !selectedCategory ? (
                      <div>
                        <p className="text-[#9CA3AF] mb-4 font-semibold">
                          Select Body Part
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          {categories.map((category) => (
                            <button
                              key={category}
                              type="button"
                              onClick={() => setSelectedCategory(category)}
                              className="flex items-center justify-between p-3 rounded-lg bg-[#2d3b4e] text-white hover:bg-[#3d4d63] transition-colors border border-transparent hover:border-[#6366F1]/50 text-left"
                            >
                              <span className="font-semibold text-sm sm:text-base italic flex items-center gap-2">
                                <span className="text-gray-500">{">"}</span>{" "}
                                {category}
                              </span>
                            </button>
                          ))}
                          {!categories.includes("CARDIO") && (
                            <button
                              type="button"
                              onClick={() => setSelectedCategory("CARDIO")}
                              className="flex items-center justify-between p-3 rounded-lg bg-[#2d3b4e] text-white hover:bg-[#3d4d63] transition-colors border border-transparent hover:border-[#6366F1]/50 text-left"
                            >
                              <span className="font-semibold text-sm sm:text-base italic flex items-center gap-2">
                                <span className="text-gray-500">{">"}</span>{" "}
                                CARDIO
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <h5 className="text-lg font-bold text-white uppercase italic">
                            {selectedCategory} Exercises
                          </h5>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCategory(null);
                              setSelectedEquipment(null);
                            }}
                            className="text-[#6366F1] font-bold text-sm hover:underline"
                          >
                            Change Body Part
                          </button>
                        </div>

                        <p className="text-[#9CA3AF] text-xs font-semibold mb-2">
                          Filter by Equipment
                        </p>
                        <div className="flex flex-wrap gap-2 mb-6">
                          {[
                            "Barbell",
                            "Dumbbell",
                            "Cable",
                            "Machine",
                            "Bodyweight",
                          ].map((equip) => (
                            <button
                              key={equip}
                              type="button"
                              onClick={() =>
                                setSelectedEquipment(
                                  selectedEquipment === equip ? null : equip
                                )
                              }
                              className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                                selectedEquipment === equip
                                  ? "bg-[#6366F1] text-white"
                                  : "bg-[#2d3b4e] text-gray-400 hover:text-white"
                              }`}
                            >
                              {equip}
                            </button>
                          ))}
                        </div>

                        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                          {allExercises
                            .filter(
                              (ex) =>
                                ex.category === selectedCategory &&
                                (!selectedEquipment ||
                                  ex.equipment === selectedEquipment)
                            )
                            .map((ex) => (
                              <button
                                key={ex.id}
                                type="button"
                                onClick={() =>
                                  handleExerciseChange(ex.id, ex.name)
                                }
                                className="w-full flex items-center justify-between p-3 rounded-lg bg-[#2d3b4e] text-white hover:bg-[#3d4d63] transition-colors border border-[#374151]"
                              >
                                <span className="font-bold text-left">
                                  {ex.name}
                                </span>
                                {ex.equipment && (
                                  <span className="text-[10px] bg-[#374151] px-2 py-0.5 rounded text-gray-400 font-bold uppercase">
                                    {ex.equipment}
                                  </span>
                                )}
                              </button>
                            ))}
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="relative">
                      <div className="absolute left-3 top-3 text-gray-400">
                        <MdSearch size={20} />
                      </div>
                      <input
                        type="text"
                        value={exerciseSearchQuery}
                        onChange={(e) => setExerciseSearchQuery(e.target.value)}
                        placeholder="Search for a workout..."
                        className="w-full pl-10 pr-4 py-3 rounded-lg bg-[#2d3b4e] border-none text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
                        autoFocus
                      />
                      {exerciseSearchQuery && (
                        <div className="mt-4 space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                          {allExercises
                            .filter((ex) =>
                              ex.name
                                .toLowerCase()
                                .includes(exerciseSearchQuery.toLowerCase())
                            )
                            .slice(0, 20)
                            .map((ex) => (
                              <button
                                key={ex.id}
                                type="button"
                                onClick={() =>
                                  handleExerciseChange(ex.id, ex.name)
                                }
                                className="w-full flex items-center justify-between p-3 rounded-lg bg-[#2d3b4e] text-white hover:bg-[#3d4d63] transition-colors border border-[#374151]"
                              >
                                <span className="font-bold text-left">
                                  {ex.name}
                                </span>
                                <span className="text-[10px] text-gray-500 uppercase">
                                  {ex.category}
                                </span>
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* List of Added Exercises */}
              <div className="space-y-4">
                {formData.exercises.map((ex, idx) => {
                  const exerciseSets = Array.isArray(ex.sets) ? ex.sets : [];
                  const isCardio = ex.hasOwnProperty("time") || ex.hasOwnProperty("speed");
                  
                  return (
                    <div
                      key={idx}
                      className="bg-[#1a2332] rounded-xl border border-[#2d3b4e] p-4 sm:p-6 overflow-hidden shadow-lg"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <h4 className="text-xl font-bold text-white italic uppercase">
                          {ex.exercise_name}
                        </h4>
                        <button
                          type="button"
                          onClick={() =>
                            setFormData({
                              ...formData,
                              exercises: formData.exercises.filter(
                                (_, i) => i !== idx
                              ),
                            })
                          }
                          className="text-red-500 hover:text-red-400 transition-colors"
                        >
                          <MdClose size={24} />
                        </button>
                      </div>

                      {/* Last Time Info */}
                      {lastExerciseData[ex.exercise_id] && (
                        <div className="bg-[#252f3f] rounded-lg p-3 mb-4 border-l-4 border-[#6366F1]">
                          <div className="flex items-center gap-2 mb-2">
                            <MdAccessTime className="text-[#6366F1]" size={16} />
                            <span className="text-sm font-semibold text-[#6366F1]">
                              Last time: {formatLastTime(lastExerciseData[ex.exercise_id].date)}
                            </span>
                          </div>
                          {lastExerciseData[ex.exercise_id].exercise_data && (
                            <div className="ml-6">
                              {lastExerciseData[ex.exercise_id].exercise_data.time !== undefined ? (
                                <p className="text-xs text-[#9CA3AF]">
                                  Time: {lastExerciseData[ex.exercise_id].exercise_data.time} min
                                  {lastExerciseData[ex.exercise_id].exercise_data.speed && 
                                    ` | Speed: ${lastExerciseData[ex.exercise_id].exercise_data.speed} mph`}
                                </p>
                              ) : lastExerciseData[ex.exercise_id].exercise_data.sets && Array.isArray(lastExerciseData[ex.exercise_id].exercise_data.sets) ? (
                                <div>
                                  <p className="text-xs text-[#9CA3AF] mb-1">
                                    {lastExerciseData[ex.exercise_id].exercise_data.sets.length} set{lastExerciseData[ex.exercise_id].exercise_data.sets.length > 1 ? 's' : ''}
                                  </p>
                                  {lastExerciseData[ex.exercise_id].exercise_data.sets.slice(0, 3).map((set: any, setIdx: number) => (
                                    <p key={setIdx} className="text-xs text-[#9CA3AF] ml-2">
                                      Set {set.set_number}: {set.reps} reps
                                      {set.weight && ` @ ${set.weight} lbs`}
                                    </p>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-[#9CA3AF]">
                                  {lastExerciseData[ex.exercise_id].exercise_data.sets} sets x {lastExerciseData[ex.exercise_id].exercise_data.reps} reps
                                  {lastExerciseData[ex.exercise_id].exercise_data.weight && 
                                    ` @ ${lastExerciseData[ex.exercise_id].exercise_data.weight} lbs`}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* AI Recommendation */}
                      {aiRecommendationLoading[ex.exercise_id] ? (
                        <div className="bg-[#1a2a1f] rounded-lg p-3 mb-4 border-l-4 border-[#10B981]">
                          <div className="flex items-center gap-2">
                            <svg className="animate-spin h-4 w-4 text-[#10B981]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span className="text-sm font-semibold text-[#10B981]">
                              Getting AI recommendation...
                            </span>
                          </div>
                        </div>
                      ) : aiRecommendations[ex.exercise_id] && (
                        <div className="bg-[#1a2a1f] rounded-lg p-3 mb-4 border-l-4 border-[#10B981]">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#10B981]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                              <span className="text-sm font-semibold text-[#10B981]">
                                AI Recommendation
                              </span>
                              {aiRecommendations[ex.exercise_id].confidence && (
                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                  aiRecommendations[ex.exercise_id].confidence === 'high' 
                                    ? 'bg-[#10B981]/20 text-[#10B981]' 
                                    : aiRecommendations[ex.exercise_id].confidence === 'medium'
                                    ? 'bg-yellow-500/20 text-yellow-500'
                                    : 'bg-gray-500/20 text-gray-400'
                                }`}>
                                  {aiRecommendations[ex.exercise_id].confidence}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => setExpandedRecommendations(prev => ({
                                ...prev,
                                [ex.exercise_id]: !(prev[ex.exercise_id] ?? true)
                              }))}
                              className="text-[#10B981] hover:text-[#10B981]/80 transition-colors"
                            >
                              <MdKeyboardArrowDown 
                                className={`h-5 w-5 transition-transform ${
                                  (expandedRecommendations[ex.exercise_id] ?? true) ? '' : 'rotate-180'
                                }`}
                              />
                            </button>
                          </div>
                          {(expandedRecommendations[ex.exercise_id] ?? true) && (
                          <div className="ml-6">
                            {/* Cardio recommendation */}
                            {aiRecommendations[ex.exercise_id].time !== undefined ? (
                              <div>
                                <p className="text-xs text-[#9CA3AF]">
                                  Target: {aiRecommendations[ex.exercise_id].time} min
                                  {aiRecommendations[ex.exercise_id].speed && 
                                    ` @ ${aiRecommendations[ex.exercise_id].speed} mph`}
                                </p>
                              </div>
                            ) : aiRecommendations[ex.exercise_id].sets && Array.isArray(aiRecommendations[ex.exercise_id].sets) ? (
                              /* Strength recommendation with sets array */
                              <div>
                                <p className="text-xs text-[#9CA3AF] mb-1 font-semibold">
                                  Target: {aiRecommendations[ex.exercise_id].sets.length} set{aiRecommendations[ex.exercise_id].sets.length > 1 ? 's' : ''}
                                </p>
                                {aiRecommendations[ex.exercise_id].sets.map((set: any, setIdx: number) => (
                                  <p key={setIdx} className="text-xs text-[#9CA3AF] ml-2">
                                    Set {set.set_number || setIdx + 1}: {set.reps} reps
                                    {set.weight && ` @ ${set.weight} lbs`}
                                  </p>
                                ))}
                              </div>
                            ) : null}
                            
                            {/* Progression type badge */}
                            {aiRecommendations[ex.exercise_id].progression_type && (
                              <div className="mt-2">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  aiRecommendations[ex.exercise_id].progression_type === 'increase_weight'
                                    ? 'bg-green-500/20 text-green-400'
                                    : aiRecommendations[ex.exercise_id].progression_type === 'increase_reps'
                                    ? 'bg-blue-500/20 text-blue-400'
                                    : aiRecommendations[ex.exercise_id].progression_type === 'deload'
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : 'bg-gray-500/20 text-gray-400'
                                }`}>
                                  {aiRecommendations[ex.exercise_id].progression_type.replace('_', ' ')}
                                </span>
                              </div>
                            )}
                            
                            {/* Reasoning */}
                            {aiRecommendations[ex.exercise_id].reasoning && (
                              <p className="text-xs text-[#6B7280] mt-2 italic">
                                {aiRecommendations[ex.exercise_id].reasoning}
                              </p>
                            )}
                          </div>
                          )}
                        </div>
                      )}

                      {/* All-Time Max Info */}
                      {maxExerciseData[ex.exercise_id] && (
                        <div className="bg-[#2a1f1a] rounded-lg p-3 mb-4 border-l-4 border-[#F59E0B]">
                          <div className="flex items-center gap-2 mb-2">
                            <MdFitnessCenter className="text-[#F59E0B]" size={16} />
                            <span className="text-sm font-semibold text-[#F59E0B]">
                              All-Time Max
                            </span>
                          </div>
                          {maxExerciseData[ex.exercise_id] && (
                            <div className="ml-6">
                              {(maxExerciseData[ex.exercise_id].max_time != null || maxExerciseData[ex.exercise_id].max_speed != null) ? (
                                <div>
                                  {maxExerciseData[ex.exercise_id].max_time != null && (
                                    <p className="text-xs text-[#9CA3AF]">
                                      Best Time: {maxExerciseData[ex.exercise_id].max_time} min
                                    </p>
                                  )}
                                  {maxExerciseData[ex.exercise_id].max_speed != null && (
                                    <p className="text-xs text-[#9CA3AF]">
                                      Best Speed: {maxExerciseData[ex.exercise_id].max_speed} mph
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <div>
                                  {/* Primary: Max Weight - Most Prominent */}
                                  {maxExerciseData[ex.exercise_id].max_weight != null && (
                                    <div className="mb-2">
                                      <p className="text-sm font-bold text-white">
                                        Personal Best: {maxExerciseData[ex.exercise_id].max_weight} lbs
                                      </p>
                                      {/* Calculate estimated 1RM if we have max weight and reps */}
                                      {maxExerciseData[ex.exercise_id].max_weight != null && maxExerciseData[ex.exercise_id].max_reps != null && maxExerciseData[ex.exercise_id].max_reps > 0 && (
                                        <p className="text-xs text-[#9CA3AF] mt-0.5">
                                          Est. 1RM: {Math.round(maxExerciseData[ex.exercise_id].max_weight * (1 + maxExerciseData[ex.exercise_id].max_reps / 30))} lbs
                                        </p>
                                      )}
                                    </div>
                                  )}
                                  
                                  {/* Heaviest Sets - Weight-focused */}
                                  {maxExerciseData[ex.exercise_id].max_per_set && Object.keys(maxExerciseData[ex.exercise_id].max_per_set).length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-[#374151]">
                                      <p className="text-xs font-semibold text-[#F59E0B] mb-1">
                                        Heaviest Sets:
                                      </p>
                                      {Object.entries(maxExerciseData[ex.exercise_id].max_per_set)
                                        .sort(([a, aData], [b, bData]) => {
                                          // Sort by weight (descending), then by set number
                                          const weightA = (aData as any).weight || 0;
                                          const weightB = (bData as any).weight || 0;
                                          if (weightB !== weightA) return weightB - weightA;
                                          return parseInt(a) - parseInt(b);
                                        })
                                        .map(([setNum, setData]: [string, any]) => (
                                          <p key={setNum} className="text-xs text-[#9CA3AF] ml-2">
                                            Set {setNum}: {setData.weight != null ? `${setData.weight} lbs` : ''}
                                            {setData.reps != null && setData.reps > 0 && ` × ${setData.reps} reps`}
                                          </p>
                                        ))}
                                    </div>
                                  )}
                                  
                                  {/* Secondary metrics - smaller, less prominent */}
                                  <div className="mt-2 pt-2 border-t border-[#374151]">
                                    {maxExerciseData[ex.exercise_id].max_volume != null && (
                                      <p className="text-xs text-[#6B7280]">
                                        Max Volume: {Math.round(maxExerciseData[ex.exercise_id].max_volume)} lbs
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {isCardio ? (
                        <div className="space-y-4">
                          <div>
                            <label className="block text-xs font-bold text-[#9CA3AF] uppercase italic mb-2">
                              Time (minutes)
                            </label>
                            <input
                              type="number"
                              value={ex.time || ""}
                              onChange={(e) => {
                                const newExercises = [...formData.exercises];
                                newExercises[idx] = {
                                  ...newExercises[idx],
                                  time: e.target.value ? parseFloat(e.target.value) : undefined,
                                };
                                setFormData({ ...formData, exercises: newExercises });
                              }}
                              placeholder="Time"
                              className="w-full px-4 py-3 rounded-lg bg-[#2d3b4e] border-none text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-[#9CA3AF] uppercase italic mb-2">
                              Speed (mph)
                            </label>
                            <input
                              type="number"
                              value={ex.speed || ""}
                              onChange={(e) => {
                                const newExercises = [...formData.exercises];
                                newExercises[idx] = {
                                  ...newExercises[idx],
                                  speed: e.target.value ? parseFloat(e.target.value) : undefined,
                                };
                                setFormData({ ...formData, exercises: newExercises });
                              }}
                              placeholder="Speed"
                              className="w-full px-4 py-3 rounded-lg bg-[#2d3b4e] border-none text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-12 gap-4 mb-2 text-xs font-bold text-[#9CA3AF] uppercase italic">
                            <div className="col-span-2">Set</div>
                            <div className="col-span-5">Reps</div>
                            <div className="col-span-5">Weight (lbs)</div>
                          </div>

                          <div className="space-y-3 mb-6">
                            {exerciseSets.map((set, setIdx) => (
                              <div
                                key={setIdx}
                                className="grid grid-cols-12 gap-4 items-center"
                              >
                                <div className="col-span-2 text-lg font-bold text-gray-400 italic">
                                  {set.set_number}
                                </div>
                                <div className="col-span-5">
                                  <input
                                    type="number"
                                    value={set.reps === 0 ? "" : set.reps}
                                    onChange={(e) => {
                                      const newExercises = [...formData.exercises];
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
                                    onFocus={(e) => {
                                      e.target.select();
                                    }}
                                    placeholder="Reps"
                                    className="w-full px-4 py-3 rounded-lg bg-[#2d3b4e] border-none text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
                                  />
                                </div>
                                <div className="col-span-5">
                                  <input
                                    type="number"
                                    value={set.weight || ""}
                                    onChange={(e) => {
                                      const newExercises = [...formData.exercises];
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
                                    placeholder="Weight (lbs)"
                                    className="w-full px-4 py-3 rounded-lg bg-[#2d3b4e] border-none text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
                                  />
                                </div>
                              </div>
                            ))}
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
                              });
                              newExercises[idx] = {
                                ...newExercises[idx],
                                sets: newSets,
                              };
                              setFormData({ ...formData, exercises: newExercises });
                            }}
                            className="w-full py-3 bg-white hover:bg-gray-100 text-[#1a2332] font-bold rounded-lg flex items-center justify-center gap-2 transition-colors mb-4"
                          >
                            <MdAdd size={20} /> Add Set
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  exerciseSelectionRef.current?.scrollIntoView({
                    behavior: "smooth",
                  });
                }}
                className="w-full py-3 mt-4 border-2 border-white/20 text-[#6366F1] font-bold rounded-lg flex items-center justify-center gap-2 hover:bg-white/5 transition-colors"
              >
                <MdAdd size={20} /> Add Exercise
              </button>
            </div>

            <Input
              label="Notes (Optional)"
              value={formData.notes}
              onChange={(e) =>
                setFormData({ ...formData, notes: e.target.value })
              }
              placeholder="How did the workout feel?"
              className="bg-[#2d3b4e] border-none text-white placeholder:text-gray-500"
            />

            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Button
                type="submit"
                variant="primary"
                disabled={formData.exercises.length === 0}
                className="flex-1 py-4 text-lg font-bold"
              >
                {editingSessionId ? "Update Workout" : "Save Workout"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleCancel}
                className="flex-1 py-4 text-lg font-bold bg-white text-[#1a2332] hover:bg-gray-100 border-none"
              >
                {editingSessionId ? "Close" : "Cancel"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {sessions.map((session) => (
          <Card key={session.id}>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-[#6366F1]/20 flex items-center justify-center flex-shrink-0">
                <MdFitnessCenter className="text-[#6366F1] text-2xl" />
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-lg font-semibold text-[#F9FAFB]">
                    {session.split_name || "Workout Session"}
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(session)}
                      className="text-[#6366F1] hover:text-[#8B5CF6] transition-colors"
                      title="Edit"
                    >
                      <MdEdit size={20} />
                    </button>
                    <button
                      onClick={() => handleDelete(session.id!)}
                      className="text-[#EF4444] hover:text-[#DC2626] transition-colors"
                      title="Delete"
                    >
                      <MdDelete size={20} />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-[#9CA3AF] mb-2">{session.date}</p>
                <p className="text-sm text-[#9CA3AF] mb-2">
                  {session.exercises?.length || 0} exercises
                </p>
                {session.exercises && session.exercises.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {session.exercises.slice(0, 3).map((ex: any, idx: number) => (
                      <div key={idx} className="text-xs text-[#9CA3AF]">
                        • {ex.exercise_name || ex.exercise_id}
                        {ex.sets && ex.sets.length > 0 && (
                          <span className="text-[#6B7280] ml-1">
                            ({ex.sets.length} set{ex.sets.length > 1 ? 's' : ''})
                          </span>
                        )}
                      </div>
                    ))}
                    {session.exercises.length > 3 && (
                      <div className="text-xs text-[#6B7280]">
                        +{session.exercises.length - 3} more
                      </div>
                    )}
                  </div>
                )}
                {session.notes && (
                  <p className="text-sm text-[#F9FAFB] mt-2 italic">
                    {session.notes}
                  </p>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
