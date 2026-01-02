import { useEffect, useState } from "react";
import apiClient from "../lib/api-client";
import {
  MdFitnessCenter,
  MdDirectionsRun,
  MdRestaurant,
  MdFavorite,
} from "react-icons/md";
import type { DashboardStats } from "../types";

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
      gradient: "from-[#6366F1] to-[#8B5CF6]",
    },
    {
      label: "Activities",
      value: stats.activities,
      icon: MdDirectionsRun,
      gradient: "from-[#10B981] to-[#059669]",
    },
    {
      label: "Macro Entries",
      value: stats.macros,
      icon: MdRestaurant,
      gradient: "from-[#F59E0B] to-[#D97706]",
    },
    {
      label: "Wellness",
      value: stats.stress,
      icon: MdFavorite,
      gradient: "from-[#8B5CF6] to-[#7C3AED]",
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <p className="text-[#9CA3AF] text-sm mb-1">Welcome Back</p>
        <h1 className="text-3xl font-bold text-[#F9FAFB]">Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="group">
              <div
                className={`bg-gradient-to-br ${stat.gradient} rounded-xl p-6 shadow-lg hover:shadow-xl transition-all h-full`}
              >
                <div className="flex flex-col h-full">
                  <div className="w-12 h-12 rounded-lg bg-white/20 flex items-center justify-center mb-4 flex-shrink-0">
                    <Icon className="text-white text-2xl" />
                  </div>
                  <div className="mt-auto">
                    <p className="text-white text-4xl font-bold mb-1">
                      {loading ? "..." : stat.value}
                    </p>
                    <p className="text-white/90 text-sm font-semibold">
                      {stat.label}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
