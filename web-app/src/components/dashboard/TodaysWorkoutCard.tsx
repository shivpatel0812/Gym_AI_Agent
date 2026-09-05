import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import apiClient from "../../lib/api-client";
import type { TodaysWorkout } from "../../types";
import {
  MdPlayArrow,
  MdAutoAwesome,
  MdSelfImprovement,
  MdArrowForward,
  MdFitnessCenter,
  MdCheckCircle,
} from "react-icons/md";

export default function TodaysWorkoutCard() {
  const [todaysWorkout, setTodaysWorkout] = useState<TodaysWorkout | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchTodaysWorkout();
  }, []);

  const fetchTodaysWorkout = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await apiClient.get("/api/workout-plan/today", { timeout: 30000 });
      setTodaysWorkout(res.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-[#161A22] border border-[#2A2D35] rounded-2xl p-6 mb-6 animate-pulse">
        <div className="h-6 w-48 bg-[#2A2D35] rounded mb-3" />
        <div className="h-4 w-72 bg-[#2A2D35] rounded" />
      </div>
    );
  }

  // No plan state
  if (loadError) return (
    <div role="status" className="bg-[#161A22] border border-[#2A2D35] rounded-2xl p-6 mb-6 text-[#8E8E93]">
      <p>Could not refresh today's workout.{todaysWorkout ? ` Last loaded: ${todaysWorkout.day_name || todaysWorkout.status.replace(/_/g, " ")}.` : ""}</p>
      <button onClick={fetchTodaysWorkout} className="mt-2 text-[#FF6B35]">Retry workout</button>
    </div>
  );
  if (!todaysWorkout || todaysWorkout.status === "no_plan") {
    return (
      <div className="bg-gradient-to-r from-[#161A22] to-[#1A1512] border border-[#2A2D35] rounded-2xl p-6 mb-6">
        <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#FF6B35]/15 flex items-center justify-center flex-shrink-0">
              <MdAutoAwesome className="text-[#FF6B35] text-2xl" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">
                Get your personalized workout plan
              </h3>
              <p className="text-sm text-[#8E8E93] mt-0.5">
                Tell us your goals and our AI will build your program
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate("/plan-generator")}
            className="px-5 py-2.5 rounded-xl bg-[#FF6B35] text-white text-sm font-semibold hover:bg-[#E85A2A] transition-colors flex items-center gap-2 flex-shrink-0"
          >
            Create Plan <MdArrowForward />
          </button>
        </div>
      </div>
    );
  }

  // Rest day state
  if (todaysWorkout.status === "rest_day") {
    return (
      <div className="bg-gradient-to-r from-[#161A22] to-[#141A1E] border border-[#2A2D35] rounded-2xl p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#5EEAD4]/15 flex items-center justify-center flex-shrink-0">
            <MdSelfImprovement className="text-[#5EEAD4] text-2xl" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white">Rest Day</h3>
            <p className="text-sm text-[#8E8E93] mt-0.5">
              {todaysWorkout.rest_day_message ||
                "Focus on recovery, stretching, and nutrition."}
            </p>
            {todaysWorkout.next_workout_day && (
              <p className="text-sm text-[#5EEAD4] mt-2 font-medium">
                Next up: {todaysWorkout.next_workout_name} (
                {todaysWorkout.next_workout_day})
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Workout day — already completed
  if (todaysWorkout.already_logged) {
    return (
      <div className="bg-gradient-to-r from-[#161A22] to-[#121A14] border border-[#2A2D35] rounded-2xl p-6 mb-6">
        <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-green-500/15 flex items-center justify-center flex-shrink-0">
              <MdCheckCircle className="text-green-400 text-2xl" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">
                {todaysWorkout.day_name} — Done!
              </h3>
              <p className="text-sm text-[#8E8E93] mt-0.5">
                {todaysWorkout.focus}
              </p>
            </div>
          </div>
          {todaysWorkout.existing_session_id && (
            <button
              onClick={() =>
                navigate(
                  `/workouts?tab=sessions&editSession=${todaysWorkout.existing_session_id}`
                )
              }
              className="px-4 py-2 rounded-xl border border-[#2A2D35] bg-[#161A22] text-white text-sm font-semibold hover:bg-[#1C1C1E] transition-colors flex items-center gap-2 flex-shrink-0"
            >
              View Session
            </button>
          )}
        </div>
      </div>
    );
  }

  // Workout day — not started
  const exerciseCount = todaysWorkout.exercises?.length || 0;
  return (
    <div className="bg-gradient-to-r from-[#161A22] to-[#1A1512] border border-[#FF6B35]/30 rounded-2xl p-6 mb-6">
      <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#FF6B35]/15 flex items-center justify-center flex-shrink-0">
            <MdFitnessCenter className="text-[#FF6B35] text-2xl" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[#FF6B35]/15 text-[#FF6B35] border border-[#FF6B35]/30">
                Today
              </span>
            </div>
            <h3 className="text-lg font-bold text-white">
              {todaysWorkout.day_name}
            </h3>
            <p className="text-sm text-[#8E8E93] mt-0.5">
              {todaysWorkout.focus} &middot; {exerciseCount} exercises
              {todaysWorkout.estimated_duration_minutes &&
                ` \u00B7 ~${todaysWorkout.estimated_duration_minutes} min`}
            </p>
          </div>
        </div>
        <button
          onClick={() =>
            navigate(
              `/workouts?tab=sessions&startPlan=true&planDay=${encodeURIComponent(
                todaysWorkout.day_name || ""
              )}`
            )
          }
          className="px-6 py-3 rounded-xl bg-[#FF6B35] text-white text-sm font-bold hover:bg-[#E85A2A] transition-colors flex items-center gap-2 flex-shrink-0 shadow-lg shadow-[#FF6B35]/20"
        >
          <MdPlayArrow size={20} />
          Start Workout
        </button>
      </div>

      {/* Exercise preview */}
      {todaysWorkout.exercises && todaysWorkout.exercises.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {todaysWorkout.exercises.slice(0, 4).map((ex) => (
            <span
              key={ex.exercise_id + "-" + ex.order}
              className="px-3 py-1.5 rounded-lg bg-[#0B0C10]/60 border border-[#2A2D35] text-xs text-[#8E8E93] font-medium"
            >
              {ex.exercise_name}
            </span>
          ))}
          {todaysWorkout.exercises.length > 4 && (
            <span className="px-3 py-1.5 rounded-lg bg-[#0B0C10]/60 border border-[#2A2D35] text-xs text-[#636366] font-medium">
              +{todaysWorkout.exercises.length - 4} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}
