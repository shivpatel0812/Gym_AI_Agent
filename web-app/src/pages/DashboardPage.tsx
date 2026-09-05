import { localDateKey } from "../lib/localDate";
import { useEffect, useState } from "react";
import apiClient from "../lib/api-client";
import {
  MdFitnessCenter,
  MdDirectionsRun,
  MdRestaurant,
  MdFavorite,
} from "react-icons/md";
import type { DashboardStats } from "../types";
import TodaysWorkoutCard from "../components/dashboard/TodaysWorkoutCard";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    workouts: 0,
    activities: 0,
    macros: 0,
    stress: 0,
  });
  const [states, setStates] = useState<Record<string, { loaded: boolean; loading: boolean; error: boolean }>>({});
  const endpoints = {
    workouts: "workout-sessions", activities: "physical-activities", macros: "macros", stress: "stress",
  };

  useEffect(() => { void fetchStats(); }, []);

  const fetchStats = async (only?: string) => {
    const today = localDateKey();
    await Promise.all(Object.entries(endpoints).filter(([key]) => !only || key === only).map(async ([key, endpoint]) => {
      setStates(prev => ({ ...prev, [key]: { loaded: prev[key]?.loaded || false, loading: true, error: false } }));
      try {
        const { data } = await apiClient.get(`/api/${endpoint}?date_filter=${today}`, { timeout: 30000 });
        setStats(prev => ({ ...prev, [key]: data.length }));
        setStates(prev => ({ ...prev, [key]: { loaded: true, loading: false, error: false } }));
      } catch {
        setStates(prev => ({ ...prev, [key]: { loaded: prev[key]?.loaded || false, loading: false, error: true } }));
      }
    }));
  };

  const statCards = [
    {
      label: "Workouts Today",
      key: "workouts",
      value: stats.workouts,
      icon: MdFitnessCenter,
      iconBg: "bg-[#FF6B35]/15",
      iconColor: "text-[#FF6B35]",
    },
    {
      label: "Activities",
      key: "activities",
      value: stats.activities,
      icon: MdDirectionsRun,
      iconBg: "bg-[#5EEAD4]/15",
      iconColor: "text-[#5EEAD4]",
    },
    {
      label: "Macro Entries",
      key: "macros",
      value: stats.macros,
      icon: MdRestaurant,
      iconBg: "bg-[#F5C542]/15",
      iconColor: "text-[#F5C542]",
    },
    {
      label: "Wellness",
      key: "stress",
      value: stats.stress,
      icon: MdFavorite,
      iconBg: "bg-[#C4B5FD]/15",
      iconColor: "text-[#C4B5FD]",
    },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1200px] mx-auto">
      <div className="mb-8">
        <p className="text-[#8E8E93] text-sm mb-1 font-medium">Welcome back</p>
        <h1 className="text-3xl font-bold text-white tracking-tight">Dashboard</h1>
      </div>

      <TodaysWorkoutCard />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-[#161A22] border border-[#2A2D35] rounded-2xl p-5"
            >
              <div
                className={`w-11 h-11 rounded-xl ${stat.iconBg} flex items-center justify-center mb-4`}
              >
                <Icon className={`${stat.iconColor} text-xl`} />
              </div>
              <p className="text-3xl font-bold text-white mb-1">
                {states[stat.key]?.loaded ? stat.value : "—"}
              </p>
              <p className="text-sm font-medium text-[#8E8E93]">{stat.label}</p>
              {states[stat.key]?.error && <div role="status" className="text-sm text-[#8E8E93] mt-2">
                <p>{states[stat.key].loaded ? "Last loaded value; may be out of date." : "Could not load."}</p>
                <button onClick={() => void fetchStats(stat.key)} className="text-[#FF6B35]">Retry</button>
              </div>}
              {states[stat.key]?.loading && <p className="text-sm text-[#8E8E93]">Loading…</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
