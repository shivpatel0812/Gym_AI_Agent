import { useState, useEffect } from "react";
import apiClient from "../lib/api-client";
import { Exercise, Split } from "../types";
import ExercisesSection from "../components/workouts/ExercisesSection";
import SplitsSection from "../components/workouts/SplitsSection";
import SessionsSection from "../components/workouts/SessionsSection";
import { MdFitnessCenter, MdCalendarToday, MdViewList } from "react-icons/md";

type TabType = "exercises" | "splits" | "sessions";

export default function WorkoutsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("exercises");
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);

  useEffect(() => {
    fetchExercises();
    fetchSplits();
  }, []);

  const fetchExercises = async () => {
    try {
      const res = await apiClient.get("/api/exercises");
      setExercises(res.data);
    } catch (error) {
      console.error("Error fetching exercises:", error);
    }
  };

  const fetchSplits = async () => {
    try {
      const res = await apiClient.get("/api/splits");
      setSplits(res.data);
    } catch (error) {
      console.error("Error fetching splits:", error);
    }
  };

  const tabs = [
    { id: "exercises" as TabType, label: "Exercises", icon: MdFitnessCenter },
    { id: "splits" as TabType, label: "Splits", icon: MdViewList },
    { id: "sessions" as TabType, label: "Sessions", icon: MdCalendarToday },
  ];

  return (
    <div className="p-8 lg:p-12 max-w-[1600px] mx-auto">
      <h1 className="text-4xl font-bold text-[#F9FAFB] mb-10">Workouts</h1>

      <div className="flex gap-3 mb-8 bg-[#1A1F3A] p-2 rounded-xl border border-[#374151] w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg transition-all ${
                isActive
                  ? "bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white shadow-md"
                  : "text-[#9CA3AF] hover:text-[#F9FAFB] hover:bg-[#374151]/30"
              }`}
            >
              <Icon className="text-xl" />
              <span className="font-semibold text-sm">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === "exercises" && (
        <ExercisesSection onUpdate={fetchExercises} />
      )}
      {activeTab === "splits" && (
        <SplitsSection exercises={exercises} onUpdate={fetchSplits} />
      )}
      {activeTab === "sessions" && (
        <SessionsSection exercises={exercises} splits={splits} />
      )}
    </div>
  );
}
