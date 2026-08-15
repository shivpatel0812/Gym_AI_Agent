import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import apiClient from "../lib/api-client";
import { Exercise, Split } from "../types";
import ExercisesSection from "../components/workouts/ExercisesSection";
import SplitsSection from "../components/workouts/SplitsSection";
import SessionsSection from "../components/workouts/SessionsSection";
import type { SessionSummaryData } from "../components/workouts/SessionsSection";
import SessionSummaryPanel from "../components/workouts/SessionSummaryPanel";

type TabType = "exercises" | "splits" | "sessions";

export default function WorkoutsPage() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>("sessions");
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);
  const [editSessionId, setEditSessionId] = useState<string | null>(null);
  const [sessionSubtitle, setSessionSubtitle] = useState<string | null>(null);
  const [summaryData, setSummaryData] = useState<SessionSummaryData | null>(null);

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
    { id: "sessions" as TabType, label: "Sessions" },
    { id: "exercises" as TabType, label: "Exercises" },
    { id: "splits" as TabType, label: "Splits" },
  ];

  return (
    <>
      <div
        className={`w-full p-4 sm:p-6 lg:p-8 ${
          summaryData
            ? "xl:pr-[304px]"
            : "max-w-[1200px] mx-auto"
        }`}
      >
        <div className="mb-6">
          <h1 className="text-3xl sm:text-[2rem] font-bold text-white tracking-tight">
            Workouts
          </h1>
          {sessionSubtitle && (
            <p className="text-sm text-[#8E8E93] mt-1">{sessionSubtitle}</p>
          )}
        </div>

        <div className="mb-6 flex gap-6 border-b border-[#2A2D35]">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative pb-3 text-sm font-semibold transition-colors ${
                  isActive
                    ? "text-white"
                    : "text-[#8E8E93] hover:text-white"
                }`}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#FF6B35] rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {activeTab === "sessions" && (
          <SessionsSection
            exercises={exercises}
            splits={splits}
            editSessionId={editSessionId}
            onSessionMetaChange={setSessionSubtitle}
            onSessionSummaryChange={setSummaryData}
          />
        )}
        {activeTab === "exercises" && (
          <ExercisesSection onUpdate={fetchExercises} />
        )}
        {activeTab === "splits" && (
          <SplitsSection exercises={exercises} onUpdate={fetchSplits} />
        )}
      </div>

      {summaryData && (
        <SessionSummaryPanel
          totalVolume={summaryData.totalVolume}
          completedSets={summaryData.completedSets}
          totalSets={summaryData.totalSets}
          completedExercises={summaryData.completedExercises}
          totalExercises={summaryData.totalExercises}
          completionPercent={summaryData.completionPercent}
          formattedTime={summaryData.formattedTime}
          elapsedSeconds={summaryData.elapsedSeconds}
          isRunning={summaryData.isRunning}
          onTimerStart={summaryData.onTimerStart}
          onTimerStop={summaryData.onTimerStop}
          onTimerRefresh={summaryData.onTimerRefresh}
        />
      )}
    </>
  );
}
