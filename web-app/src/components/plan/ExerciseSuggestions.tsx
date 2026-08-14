import type { ExerciseSuggestion, ExerciseSuggestionGroup } from "../../types";
import { MdAddCircle, MdCheckCircle } from "react-icons/md";

interface ExerciseSuggestionsProps {
  groups: ExerciseSuggestionGroup[];
  selected: ExerciseSuggestion[];
  onToggle: (suggestion: ExerciseSuggestion) => void;
}

export default function ExerciseSuggestions({
  groups,
  selected,
  onToggle,
}: ExerciseSuggestionsProps) {
  const isSelected = (exerciseId: string, day: string) =>
    selected.some(
      (item) => item.exercise_id === exerciseId && item.day === day
    );

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.day}>
          <h3 className="mb-2 text-sm font-bold text-white">{group.day}</h3>
          <div className="space-y-2">
            {group.exercises.map((exercise) => {
              const suggestion: ExerciseSuggestion = {
                ...exercise,
                day: group.day,
              };
              const chosen = isSelected(exercise.exercise_id, group.day);
              return (
                <button
                  key={`${group.day}-${exercise.exercise_id}`}
                  type="button"
                  onClick={() => onToggle(suggestion)}
                  className={`flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                    chosen
                      ? "border-[#5EEAD4] bg-[#5EEAD4]/10"
                      : "border-[#2A2D35] bg-[#161A22] hover:border-[#3A3A3C]"
                  }`}
                >
                  {chosen ? (
                    <MdCheckCircle className="mt-0.5 flex-shrink-0 text-xl text-[#5EEAD4]" />
                  ) : (
                    <MdAddCircle className="mt-0.5 flex-shrink-0 text-xl text-[#636366]" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-white">
                      {exercise.exercise_name}
                    </span>
                    <span className="mt-0.5 block text-xs text-[#8E8E93]">
                      {exercise.sets} sets × {exercise.reps} reps
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-[#5EEAD4]">
                      {exercise.reason}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
