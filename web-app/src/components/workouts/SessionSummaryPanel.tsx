import { useSessionTimer } from "@/hooks/useSessionTimer";
import { MdPause, MdPlayArrow, MdRefresh } from "react-icons/md";

interface SessionSummaryPanelProps {
  totalVolume: number;
  completedSets: number;
  totalSets: number;
  completedExercises: number;
  totalExercises: number;
  completionPercent: number;
}

export default function SessionSummaryPanel({
  totalVolume,
  completedSets,
  totalSets,
  completedExercises,
  totalExercises,
  completionPercent,
}: SessionSummaryPanelProps) {
  const { formattedTime, isRunning, pause, resume, reset, elapsedSeconds } =
    useSessionTimer();

  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const maxSeconds = 3600;
  const progress = Math.min(elapsedSeconds / maxSeconds, 1);
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <aside className="hidden xl:flex fixed inset-y-0 right-0 z-20 w-[280px] flex-col bg-[#0F1117] border-l border-[#2A2D35] px-5 pt-8 pb-6 overflow-y-auto">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-6">
        Summary
      </p>

      <div className="space-y-5 mb-8">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-1">
            Total Volume
          </p>
          <p className="text-2xl font-bold text-white">
            {totalVolume.toLocaleString()}
          </p>
          <p className="text-xs text-[#8E8E93]">pounds lifted</p>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-1">
            Completed Sets
          </p>
          <p className="text-2xl font-bold text-white">
            {completedSets}{" "}
            <span className="text-base font-normal text-[#8E8E93]">
              / {totalSets}
            </span>
          </p>
          <p className="text-xs text-[#8E8E93]">
            {completionPercent}% complete
          </p>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-1">
            Exercises
          </p>
          <p className="text-2xl font-bold text-white">
            {completedExercises}{" "}
            <span className="text-base font-normal text-[#8E8E93]">
              / {totalExercises}
            </span>
          </p>
        </div>
      </div>

      <div className="border-t border-[#2A2D35] mb-6" />

      <div className="flex flex-col items-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-4">
          Session Timer
        </p>

        <div className="relative w-[140px] h-[140px] mb-4">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 140 140">
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke="#2A2D35"
              strokeWidth="6"
            />
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke="#FF6B35"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-[stroke-dashoffset] duration-1000 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-xl font-bold text-white font-mono">
              {formattedTime}
            </p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#636366] font-bold mt-0.5">
              Elapsed
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={isRunning ? pause : resume}
            className="w-10 h-10 rounded-full bg-[#161A22] border border-[#2A2D35] flex items-center justify-center text-[#8E8E93] hover:text-white hover:border-[#FF6B35]/40 transition-colors"
            title={isRunning ? "Pause" : "Resume"}
          >
            {isRunning ? <MdPause size={20} /> : <MdPlayArrow size={20} />}
          </button>
          <button
            onClick={reset}
            className="w-10 h-10 rounded-full bg-[#161A22] border border-[#2A2D35] flex items-center justify-center text-[#8E8E93] hover:text-white hover:border-[#FF6B35]/40 transition-colors"
            title="Reset"
          >
            <MdRefresh size={20} />
          </button>
        </div>
      </div>
    </aside>
  );
}
