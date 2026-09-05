import { useState } from "react";
import type { PlanProjection } from "../../api/trainingPlan";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export default function ProgramOverview({ projection }: { projection: PlanProjection }) {
  const [week, setWeek] = useState(1);
  const macro = projection.nutrition_companion;
  return <section className="mt-6 space-y-4">
    {macro ? <div className="rounded-2xl border border-[#2A2D35] p-5">
      <h2 className="font-semibold">{macro.source === "nutrition_plan" ? "Your nutrition targets" : "Starting macro estimates"}</h2>
      {macro.targets ? <div className="my-4 flex flex-wrap gap-6">
        {Object.entries(macro.targets).map(([name, value]) => <div key={name}>
          <div className="font-semibold">{Math.round(value)} {name === "calories" ? "kcal" : "g"}</div>
          <div className="text-sm text-[#8E8E93]">{name}</div>
        </div>)}
      </div> : <p className="my-2 text-sm">Complete: {macro.missing_fields?.join(", ") || "individually agreed nutrition targets"}.</p>}
      <p className="text-sm text-[#8E8E93]">Goal: {macro.goal || "maintain"}</p>
      {macro.guidelines.map((line, i) => <p key={i} className="mt-2 text-sm text-[#8E8E93]">{line}</p>)}
      {macro.assumptions?.map((line, i) => <p key={i} className="mt-2 text-xs text-[#8E8E93]">{line}</p>)}
    </div> : null}
    <details className="rounded-2xl border border-[#2A2D35] p-5">
      <summary className="cursor-pointer font-semibold">Full weekly program · {projection.weeks} weeks ahead</summary>
      <p className="my-3 text-sm text-[#8E8E93]">Every workout in order. Future targets assume you complete the prescribed work; your next workout adapts to performance and recovery.</p>
      <div className="flex gap-2 overflow-x-auto pb-3" aria-label="Program week">
        {Array.from({ length: projection.weeks }, (_, i) => i + 1).map(value => <button key={value}
          aria-pressed={value === week} onClick={() => setWeek(value)}
          className={`shrink-0 rounded-lg border px-3 py-2 text-sm ${week === value ? "border-[#FF6B35]" : "border-[#2A2D35]"}`}>
          Week {(projection.progress.current_week || 1) + value - 1}
        </button>)}
      </div>
      {DAYS.map((weekday, index) => {
        const name = projection.weekly_schedule?.[weekday] || "Rest";
        const day = projection.days.find(d => d.day_name === name);
        const occurrence = DAYS.slice(0, index + 1).filter(d => projection.weekly_schedule?.[d] === name).length;
        return <div key={weekday} className="border-t border-[#2A2D35] py-4">
          <h3 className="font-semibold capitalize">{weekday} · {name}</h3>
          {day?.day_type ? <p className="text-sm text-[#8E8E93]">{day.day_type} · {day.day_goal || day.focus}</p> : null}
          <ol className="mt-2 space-y-3">
            {day?.exercises.map((exercise, i) => {
              const target = exercise.schedule?.find(p => p.week === week && (p.session || 1) === occurrence);
              const cardio = exercise.cardio_realistic?.find(p => p.week === week);
              return <li key={`${exercise.exercise_id}-${i}`}>
                <div className="text-sm">{i + 1}. {exercise.exercise_name}</div>
                <div className="text-sm text-[#FF6B35]">{cardio ? `${cardio.minutes} min` : exercise.seeded_from_history && target?.sets?.length
                  ? target.sets.map(s => `${s.weight} lb × ${s.reps}`).join(" · ")
                  : `${exercise.sets || 3} sets × ${exercise.target_rep_range?.join("–") || exercise.reps || 8} reps`}</div>
                {!exercise.seeded_from_history && !cardio ? <p className="text-xs text-[#8E8E93]">Choose a manageable starting load; log a session to personalize progression.</p> : null}
                {exercise.notes ? <p className="text-xs text-[#8E8E93]">{exercise.notes}</p> : null}
              </li>;
            })}
          </ol>
          {!day && name !== "Rest" ? <p className="text-sm">This workout needs to be filled with Coach.</p> : null}
        </div>;
      })}
    </details>
  </section>;
}
