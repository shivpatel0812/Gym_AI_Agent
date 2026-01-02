"use client";

import { useState, useEffect } from "react";
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

  useEffect(() => {
    fetchExercises();
  }, []);

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
        muscle_group: muscleGroups.length > 0 ? muscleGroups.join(", ") : undefined,
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
    "Chest",
    "Back",
    "Legs",
    "Shoulders",
    "Arms",
    "Core",
    "Triceps",
    "Biceps",
    "Glutes",
    "Hamstrings",
    "Quadriceps",
    "Calves",
  ];

  const handleMuscleGroupSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value && !muscleGroups.includes(value)) {
      setMuscleGroups([...muscleGroups, value]);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-8">
      {/* Create Exercise Form */}
      {showForm && (
        <div className="bg-[#1a2332] rounded-lg border border-[#2d3b4e] p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">
              Create Exercise
            </h2>
            <button
              onClick={() => setShowForm(false)}
              className="text-sm font-medium text-gray-400 hover:text-white transition-colors"
            >
              Hide Form
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Exercise Name */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">
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
                className="w-full px-4 py-3 rounded-lg bg-[#2d3b4e] border-2 border-transparent text-white placeholder:text-gray-500 focus:outline-none focus:border-[#6366F1] transition-all"
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Type
              </label>
              <div className="relative">
                <select
                  value={formData.type}
                  onChange={(e) =>
                    setFormData({ ...formData, type: e.target.value })
                  }
                  className="w-full px-4 py-3 pr-10 rounded-lg bg-[#2d3b4e] border-2 border-transparent text-gray-400 focus:outline-none focus:border-[#6366F1] appearance-none cursor-pointer transition-all"
                  required
                >
                  <option value="" disabled>
                    Select exercise type
                  </option>
                  <option value="strength">Strength</option>
                  <option value="cardio">Cardio</option>
                  <option value="custom">Custom</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <MdKeyboardArrowDown className="text-gray-400 text-xl" />
                </div>
              </div>
            </div>

            {/* Muscle Group */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Muscle Group
              </label>
              {muscleGroups.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {muscleGroups.map((group, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[#6366F1] text-white text-sm font-medium"
                    >
                      {group}
                      <button
                        type="button"
                        onClick={() => removeMuscleGroup(group)}
                        className="hover:opacity-80 transition-opacity"
                      >
                        <MdClose size={16} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative">
                <select
                  onChange={handleMuscleGroupSelect}
                  value=""
                  className="w-full px-4 py-3 pr-10 rounded-lg bg-[#2d3b4e] border-2 border-transparent text-gray-500 focus:outline-none focus:border-[#6366F1] appearance-none cursor-pointer transition-all"
                >
                  <option value="" disabled>
                    Add muscle group...
                  </option>
                  {muscleGroupOptions
                    .filter((opt) => !muscleGroups.includes(opt))
                    .map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <MdKeyboardArrowDown className="text-gray-400 text-xl" />
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Description
              </label>
              <textarea
                value={formData.description || ""}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Exercise description..."
                rows={4}
                className="w-full px-4 py-3 rounded-lg bg-[#2d3b4e] border-2 border-transparent text-white placeholder:text-gray-500 focus:outline-none focus:border-[#6366F1] resize-none transition-all"
              />
            </div>

            {/* Form Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="px-6 py-3 rounded-lg bg-[#6366F1] text-white font-semibold hover:bg-[#5558E3] transition-all"
              >
                Create Exercise
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-3 rounded-lg font-semibold text-white hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* All Exercises Section */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">All Exercises</h2>
          <div className="flex items-center gap-4">
            <div className="relative w-80">
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
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#6366F1] text-white font-semibold hover:bg-[#5558E3] transition-all"
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
