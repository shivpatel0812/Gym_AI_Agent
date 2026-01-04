"use client";

import { useState, useEffect, useRef } from "react";
import apiClient from "@/lib/api-client";
import { Exercise } from "@/types";
import {
  MdAdd,
  MdSearch,
  MdFitnessCenter,
  MdClose,
  MdKeyboardArrowDown,
} from "react-icons/md";

interface ExercisesSectionProps {
  onUpdate: () => void;
}

export default function ExercisesSection({ onUpdate }: ExercisesSectionProps) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(true);
  const [formData, setFormData] = useState<Exercise>({
    name: "",
    type: "",
    muscle_group: "",
    description: "",
  });
  const [muscleGroups, setMuscleGroups] = useState<string[]>([]);
  const [muscleGroupSearch, setMuscleGroupSearch] = useState("");
  const [showMuscleGroupDropdown, setShowMuscleGroupDropdown] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const muscleGroupDropdownRef = useRef<HTMLDivElement>(null);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchExercises();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        muscleGroupDropdownRef.current &&
        !muscleGroupDropdownRef.current.contains(event.target as Node)
      ) {
        setShowMuscleGroupDropdown(false);
      }
      if (
        typeDropdownRef.current &&
        !typeDropdownRef.current.contains(event.target as Node)
      ) {
        setShowTypeDropdown(false);
      }
    };

    if (showMuscleGroupDropdown || showTypeDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMuscleGroupDropdown, showTypeDropdown]);

  const fetchExercises = async () => {
    try {
      const res = await apiClient.get("/api/exercises");
      setExercises(res.data);
      onUpdate();
    } catch (error) {
      console.error("Error fetching exercises:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: formData.name,
        type: formData.type || "strength",
        muscle_group:
          muscleGroups.length > 0 ? muscleGroups.join(", ") : undefined,
        is_custom: true,
      };

      await apiClient.post("/api/exercises", payload);
      setFormData({ name: "", type: "", muscle_group: "", description: "" });
      setMuscleGroups([]);
      fetchExercises();
    } catch (error: any) {
      console.error("Error creating exercise:", error);
      if (error.response?.data) {
        console.error("Backend error details:", error.response.data);
        alert(`Error: ${JSON.stringify(error.response.data)}`);
      }
    }
  };

  const handleCancel = () => {
    setFormData({ name: "", type: "", muscle_group: "", description: "" });
    setMuscleGroups([]);
  };

  const removeMuscleGroup = (group: string) => {
    setMuscleGroups(muscleGroups.filter((g) => g !== group));
  };

  const filteredExercises = exercises.filter((ex) =>
    ex.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const muscleGroupOptions = [
    // Major Muscle Groups
    "Chest",
    "Back",
    "Shoulders",
    "Arms",
    "Legs",
    "Core",
    // Back Subdivisions
    "Lats",
    "Upper Back",
    "Mid Back",
    "Lower Back",
    "Traps",
    "Erector Spinae",
    // Shoulders Subdivisions
    "Front Delts",
    "Lateral Delts",
    "Rear Delts",
    "Rotator Cuff",
    // Arms Subdivisions
    "Biceps",
    "Triceps",
    "Forearms",
    // Legs Subdivisions
    "Quadriceps",
    "Hamstrings",
    "Glutes",
    "Glute Maximus",
    "Glute Medius",
    "Calves",
    "Hip Flexors",
    "Adductors",
    "Abductors",
    "Tibialis Anterior",
    // Core Subdivisions
    "Abs",
    "Obliques",
    "Transverse Abdominis",
    // Neck & Stability
    "Neck",
    "Serratus Anterior",
  ];

  const handleMuscleGroupSelect = (value: string) => {
    if (value && !muscleGroups.includes(value)) {
      setMuscleGroups([...muscleGroups, value]);
      setMuscleGroupSearch(""); // Clear search after selection
      setShowMuscleGroupDropdown(false);
    }
  };

  const filteredMuscleGroupOptions = muscleGroupOptions.filter(
    (opt) =>
      opt.toLowerCase().includes(muscleGroupSearch.toLowerCase()) &&
      !muscleGroups.includes(opt)
  );

  return (
    <div className="space-y-4 sm:space-y-6 lg:space-y-8">
      {/* Create Exercise Form */}
      {showForm && (
        <div className="bg-[#1a2332] rounded-lg border border-[#2d3b4e] p-3 sm:p-5 lg:p-8 relative z-0 overflow-visible">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
            <h2 className="text-lg sm:text-xl font-semibold text-white">
              Create Exercise
            </h2>
            <button
              onClick={() => setShowForm(false)}
              className="text-xs sm:text-sm font-medium text-gray-400 hover:text-white transition-colors self-start sm:self-auto"
            >
              Hide Form
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            {/* Exercise Name */}
            <div>
              <label className="block text-xs sm:text-sm font-medium text-white mb-1.5 sm:mb-2">
                Exercise Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="Enter exercise name"
                required
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base rounded-lg bg-[#2d3b4e] border-2 border-transparent text-white placeholder:text-gray-500 focus:outline-none focus:border-[#6366F1] transition-all"
              />
            </div>

            {/* Type */}
            <div className="relative z-30" ref={typeDropdownRef}>
              <label className="block text-xs sm:text-sm font-medium text-white mb-1.5 sm:mb-2">
                Type
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTypeDropdown(!showTypeDropdown)}
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 pr-8 sm:pr-10 text-sm sm:text-base rounded-lg bg-[#2d3b4e] border-2 border-transparent text-left text-gray-400 focus:outline-none focus:border-[#6366F1] cursor-pointer transition-all relative z-10 flex items-center justify-between"
                >
                  <span className={formData.type ? "text-white" : ""}>
                    {formData.type
                      ? formData.type.charAt(0).toUpperCase() +
                        formData.type.slice(1)
                      : "Select exercise type"}
                  </span>
                  <MdKeyboardArrowDown
                    className={`text-gray-400 text-lg sm:text-xl flex-shrink-0 transition-transform ${
                      showTypeDropdown ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {showTypeDropdown && (
                  <div className="absolute z-[100] w-full mt-1 bg-[#2d3b4e] border border-[#3d4d63] rounded-lg shadow-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        setFormData({ ...formData, type: "strength" });
                        setShowTypeDropdown(false);
                      }}
                      className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#3d4d63] transition-colors ${
                        formData.type === "strength" ? "bg-[#6366F1]/20" : ""
                      }`}
                    >
                      Strength
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFormData({ ...formData, type: "cardio" });
                        setShowTypeDropdown(false);
                      }}
                      className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#3d4d63] transition-colors ${
                        formData.type === "cardio" ? "bg-[#6366F1]/20" : ""
                      }`}
                    >
                      Cardio
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFormData({ ...formData, type: "custom" });
                        setShowTypeDropdown(false);
                      }}
                      className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#3d4d63] transition-colors ${
                        formData.type === "custom" ? "bg-[#6366F1]/20" : ""
                      }`}
                    >
                      Custom
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Muscle Group */}
            <div>
              <label className="block text-xs sm:text-sm font-medium text-white mb-1.5 sm:mb-2">
                Muscle Group
              </label>
              {muscleGroups.length > 0 && (
                <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-2 sm:mb-3">
                  {muscleGroups.map((group, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1 sm:py-1.5 rounded-lg bg-[#6366F1] text-white text-xs sm:text-sm font-medium"
                    >
                      {group}
                      <button
                        type="button"
                        onClick={() => removeMuscleGroup(group)}
                        className="hover:opacity-80 transition-opacity flex-shrink-0"
                        aria-label={`Remove ${group}`}
                      >
                        <MdClose size={14} className="sm:w-4 sm:h-4" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative z-20" ref={muscleGroupDropdownRef}>
                <div className="relative">
                  <div className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10">
                    <MdSearch size={16} className="sm:w-[18px] sm:h-[18px]" />
                  </div>
                  <input
                    type="text"
                    value={muscleGroupSearch}
                    onChange={(e) => {
                      setMuscleGroupSearch(e.target.value);
                      setShowMuscleGroupDropdown(true);
                    }}
                    onFocus={() => {
                      if (muscleGroupSearch) {
                        setShowMuscleGroupDropdown(true);
                      }
                    }}
                    placeholder="Search and select muscle groups..."
                    className="w-full pl-8 sm:pl-10 pr-3 sm:pr-4 py-2.5 text-sm sm:text-base rounded-lg bg-[#2d3b4e] border-2 border-transparent text-white placeholder:text-gray-500 focus:outline-none focus:border-[#6366F1] transition-all relative z-10"
                  />
                </div>
                {showMuscleGroupDropdown &&
                  muscleGroupSearch &&
                  filteredMuscleGroupOptions.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-[#2d3b4e] border border-[#3d4d63] rounded-lg shadow-lg max-h-48 sm:max-h-60 overflow-y-auto">
                      {filteredMuscleGroupOptions.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => handleMuscleGroupSelect(option)}
                          className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base text-left text-white hover:bg-[#3d4d63] transition-colors first:rounded-t-lg last:rounded-b-lg"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                {showMuscleGroupDropdown &&
                  muscleGroupSearch &&
                  filteredMuscleGroupOptions.length === 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-[#2d3b4e] border border-[#3d4d63] rounded-lg shadow-lg p-3 sm:p-4">
                      <p className="text-gray-400 text-xs sm:text-sm">
                        No matching muscle groups found
                      </p>
                    </div>
                  )}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs sm:text-sm font-medium text-white mb-1.5 sm:mb-2">
                Description
              </label>
              <textarea
                value={formData.description || ""}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Exercise description..."
                rows={3}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base rounded-lg bg-[#2d3b4e] border-2 border-transparent text-white placeholder:text-gray-500 focus:outline-none focus:border-[#6366F1] resize-none transition-all"
              />
            </div>

            {/* Form Buttons */}
            <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3 pt-2 sm:pt-3">
              <button
                type="submit"
                className="w-full sm:w-auto px-5 sm:px-6 py-2.5 sm:py-3 text-sm sm:text-base rounded-lg bg-[#6366F1] text-white font-semibold hover:bg-[#5558E3] transition-all active:scale-[0.98]"
              >
                Create Exercise
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="w-full sm:w-auto px-5 sm:px-6 py-2.5 sm:py-3 text-sm sm:text-base rounded-lg font-semibold text-white hover:bg-white/5 transition-all active:scale-[0.98]"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* All Exercises Section */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h2 className="text-2xl font-bold text-white">All Exercises</h2>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
            <div className="relative w-full sm:w-64 lg:w-80">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                <MdSearch size={20} />
              </div>
              <input
                type="text"
                placeholder="Search exercises..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[#1a2332] border border-[#2d3b4e] text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:border-transparent transition-all"
              />
            </div>
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#6366F1] text-white font-semibold hover:bg-[#5558E3] transition-all whitespace-nowrap"
              >
                <MdAdd size={20} />
                Create Exercise
              </button>
            )}
          </div>
        </div>

        {/* Exercise Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredExercises.map((exercise) => {
            const groups = exercise.muscle_group
              ? exercise.muscle_group
                  .split(",")
                  .map((g) => g.trim())
                  .filter(Boolean)
              : [];
            return (
              <div
                key={exercise.id}
                className="bg-[#1a2332] border border-[#2d3b4e] rounded-xl p-5 hover:border-[#3d4d63] transition-colors"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-11 h-11 rounded-lg bg-[#6366F1]/20 flex items-center justify-center flex-shrink-0">
                    <MdFitnessCenter className="text-[#6366F1] text-xl" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-white mb-0.5 truncate">
                      {exercise.name}
                    </h3>
                    <p className="text-sm text-gray-400">
                      {exercise.type || "N/A"}
                    </p>
                  </div>
                </div>
                {groups.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {groups.map((group, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-md bg-[#2d3b4e] text-gray-300 text-xs font-medium"
                      >
                        {group}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
