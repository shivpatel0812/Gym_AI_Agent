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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const [sessions, activities, macros, stress] = await Promise.all([
        apiClient.get(`/api/workout-sessions?date_filter=${today}`),
        apiClient.get(`/api/physical-activities?date_filter=${today}`),
        apiClient.get(`/api/macros?date_filter=${today}`),
        apiClient.get(`/api/stress?date_filter=${today}`),
      ]);
      setStats({
        workouts: sessions.data.length,
        activities: activities.data.length,
        macros: macros.data.length,
        stress: stress.data.length,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      label: "Workouts Today",
      value: stats.workouts,
      icon: MdFitnessCenter,
      iconBg: "bg-[#FF6B35]/15",
      iconColor: "text-[#FF6B35]",
    },
    {
      label: "Activities",
      value: stats.activities,
      icon: MdDirectionsRun,
      iconBg: "bg-[#5EEAD4]/15",
      iconColor: "text-[#5EEAD4]",
    },
    {
      label: "Macro Entries",
      value: stats.macros,
      icon: MdRestaurant,
      iconBg: "bg-[#F5C542]/15",
      iconColor: "text-[#F5C542]",
    },
    {
      label: "Wellness",
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
                {loading ? "—" : stat.value}
              </p>
              <p className="text-sm font-medium text-[#8E8E93]">{stat.label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
