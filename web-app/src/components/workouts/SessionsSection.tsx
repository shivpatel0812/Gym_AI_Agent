"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import apiClient from "@/lib/api-client";
import {
  WorkoutSession,
  Exercise,
  Split,
  SessionExercise,
  WorkoutSet,
} from "@/types";
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
    exercises: SessionExercise[];
    notes: string;
  }>({
    date: new Date().toISOString().split("T")[0],
    split_id: "",
    split_name: "",
    exercises: [],
    notes: "",
  });
  const [showSplitDropdown, setShowSplitDropdown] = useState(false);
  const splitDropdownRef = useRef<HTMLDivElement>(null);
  const [showExerciseDropdown, setShowExerciseDropdown] = useState(false);
  const [exerciseSearchQuery, setExerciseSearchQuery] = useState("");
  const exerciseDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(
    null
  );
  const [exerciseTab, setExerciseTab] = useState<"browse" | "search">("browse");
  const exerciseSelectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (propEditSessionId && sessions.length > 0) {
      const sessionToEdit = sessions.find((s) => s.id === propEditSessionId);
      if (sessionToEdit) {
        setFormData({
          date: sessionToEdit.date,
          split_id: sessionToEdit.split_id || "",
          split_name: sessionToEdit.split_name || "",
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
        exerciseDropdownRef.current &&
        !exerciseDropdownRef.current.contains(event.target as Node)
      ) {
        setShowExerciseDropdown(false);
      }
    };

    if (showSplitDropdown || showExerciseDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showSplitDropdown, showExerciseDropdown]);

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

  const handleExerciseChange = (exerciseId: string, exerciseName: string) => {
    setFormData({
      ...formData,
      exercises: [
        ...formData.exercises,
        {
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

  const getEquipmentTypes = (category: string): string[] => {
    const equipmentSet = new Set<string>();
    allExercises
      .filter((ex) => ex.category === category && ex.equipment)
      .forEach((ex) => equipmentSet.add(ex.equipment!));
    return Array.from(equipmentSet).sort();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        date: formData.date,
        split_name: formData.split_name || undefined,
        exercises: formData.exercises,
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
      exercises: [],
      notes: "",
    });
    setEditingSessionId(null);
    setShowForm(false);
    setShowExerciseDropdown(false);
    setExerciseSearchQuery("");
    setSelectedCategory(null);
    setSelectedEquipment(null);
  };

  const handleCancel = () => {
    resetForm();
  };

  const handleEdit = (session: WorkoutSession) => {
    setFormData({
      date: session.date,
      split_id: session.split_id || "",
      split_name: session.split_name || "",
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
                          setFormData({ ...formData, split_id: "" });
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
                Cancel
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
                <p className="text-sm text-[#9CA3AF]">
                  {session.exercises?.length || 0} exercises
                </p>
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
