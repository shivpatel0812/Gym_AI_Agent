import { useState, useEffect } from "react";
import apiClient from "../lib/api-client";
import { Exercise, Split } from "../types";
import CalendarSection from "../components/workouts/CalendarSection";

export default function CalendarPage() {
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

  return (
    <div className="p-6 lg:p-12 max-w-[1600px] mx-auto">
      <h1 className="text-3xl font-bold text-[#F9FAFB] mb-6">Calendar</h1>
      <CalendarSection exercises={exercises} splits={splits} />
    </div>
  );
}

