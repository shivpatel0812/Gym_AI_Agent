import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import apiClient from "../lib/api-client";
import { Exercise, Split } from "../types";
import ExercisesSection from "../components/workouts/ExercisesSection";
import SplitsSection from "../components/workouts/SplitsSection";
import SessionsSection from "../components/workouts/SessionsSection";
import { MdFitnessCenter, MdCalendarToday, MdViewList } from "react-icons/md";

type TabType = "exercises" | "splits" | "sessions";

export default function WorkoutsPage() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>("sessions");
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);
  const [editSessionId, setEditSessionId] = useState<string | null>(null);

  useEffect(() => {
    fetchExercises();
    fetchSplits();

    const tabParam = searchParams.get("tab");
    const editParam = searchParams.get("edit");

    if (tabParam && ["exercises", "splits", "sessions"].includes(tabParam)) {
      setActiveTab(tabParam as TabType);
    }

    if (editParam) {
      setEditSessionId(editParam);
    }
  }, [searchParams]);

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
    { id: "sessions" as TabType, label: "Sessions", icon: MdCalendarToday },
    { id: "exercises" as TabType, label: "Exercises", icon: MdFitnessCenter },
    { id: "splits" as TabType, label: "Splits", icon: MdViewList },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-12 max-w-[1600px] mx-auto">
      <h1 className="text-3xl sm:text-4xl font-bold text-[#F9FAFB] mb-6 sm:mb-10">
        Workouts
      </h1>

      <div className="mb-6 sm:mb-8 bg-[#1A1F3A] p-2 rounded-xl border border-[#374151] w-full sm:w-fit">
        {/* Mobile: 2x1 layout with Sessions centered */}
        <div className="flex justify-center sm:hidden mb-2">
          {tabs
            .filter((tab) => tab.id === "sessions")
            .map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-all text-sm ${
                    isActive
                      ? "bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white shadow-md"
                      : "text-[#9CA3AF] hover:text-[#F9FAFB] hover:bg-[#374151]/30"
                  }`}
                >
                  <Icon className="text-lg" />
                  <span className="font-semibold">{tab.label}</span>
                </button>
              );
            })}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:hidden">
          {tabs
            .filter((tab) => tab.id !== "sessions")
            .map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-all text-sm ${
                    isActive
                      ? "bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white shadow-md"
                      : "text-[#9CA3AF] hover:text-[#F9FAFB] hover:bg-[#374151]/30"
                  }`}
                >
                  <Icon className="text-lg" />
                  <span className="font-semibold">{tab.label}</span>
                </button>
              );
            })}
        </div>
        {/* Desktop: All tabs in a row */}
        <div className="hidden sm:flex sm:flex-wrap sm:gap-3">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg transition-all text-base ${
                  isActive
                    ? "bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white shadow-md"
                    : "text-[#9CA3AF] hover:text-[#F9FAFB] hover:bg-[#374151]/30"
                }`}
              >
                <Icon className="text-xl" />
                <span className="font-semibold">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "sessions" && (
        <SessionsSection
          exercises={exercises}
          splits={splits}
          editSessionId={editSessionId}
        />
      )}
      {activeTab === "exercises" && (
        <ExercisesSection onUpdate={fetchExercises} />
      )}
      {activeTab === "splits" && (
        <SplitsSection exercises={exercises} onUpdate={fetchSplits} />
      )}
    </div>
  );
}
