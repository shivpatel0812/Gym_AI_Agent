import { useMemo, useState } from "react";
import { MdAdd, MdClose, MdSearch } from "react-icons/md";
import defaultExercises from "../../data/defaultExercises";
import type { SplitRoutineExercise, SplitRoutineSet } from "../../types";

interface SplitRoutineInputProps {
  dayNames: string[];
  value: Record<string, SplitRoutineExercise[]>;
  onChange: (value: Record<string, SplitRoutineExercise[]>) => void;
}

type DraftKind = "reps" | "weight";

const defaultSets = (): SplitRoutineSet[] => [
  { set_number: 1, reps: 8 },
  { set_number: 2, reps: 8 },
  { set_number: 3, reps: 8 },
];

const withDerived = (exercise: SplitRoutineExercise): SplitRoutineExercise => {
  const details = exercise.set_details?.length
    ? exercise.set_details.map((set, index) => ({
        ...set,
        set_number: index + 1,
      }))
    : defaultSets();
  const repsValues = details.map((set) => set.reps).filter((reps) => reps > 0);
  const weightValues = details
    .map((set) => set.weight)
    .filter((weight): weight is number => typeof weight === "number" && weight > 0);
  return {
    ...exercise,
    set_details: details,
    sets: details.length,
    reps: repsValues.length
      ? Math.round(repsValues.reduce((sum, reps) => sum + reps, 0) / repsValues.length)
      : 8,
    weight: weightValues.length
      ? Math.round(
          (weightValues.reduce((sum, weight) => sum + weight, 0) /
            weightValues.length) *
            10
        ) / 10
      : undefined,
  };
};

export default function SplitRoutineInput({
  dayNames,
  value,
  onChange,
}: SplitRoutineInputProps) {
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const draftKey = (
    day: string,
    exerciseId: string,
    setNumber: number,
    field: DraftKind
  ) => `${day}:${exerciseId}:${setNumber}:${field}`;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const existing = new Set(
      (activeDay ? value[activeDay] || [] : []).map((ex) => ex.exercise_id)
    );
    return defaultExercises
      .filter((ex) => !existing.has(ex.id))
      .filter((ex) => {
        if (!q) return true;
        return (
          ex.name.toLowerCase().includes(q) ||
          ex.category.toLowerCase().includes(q) ||
          ex.equipment.toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [activeDay, query, value]);

  const updateExercise = (
    day: string,
    exerciseId: string,
    updater: (exercise: SplitRoutineExercise) => SplitRoutineExercise
  ) => {
    onChange({
      ...value,
      [day]: (value[day] || []).map((exercise) =>
        exercise.exercise_id === exerciseId
          ? withDerived(updater(withDerived(exercise)))
          : exercise
      ),
    });
  };

  const addExercise = (day: string, exerciseId: string, exerciseName: string) => {
    const current = value[day] || [];
    if (current.some((ex) => ex.exercise_id === exerciseId)) return;
    onChange({
      ...value,
      [day]: [
        ...current,
        withDerived({
          exercise_id: exerciseId,
          exercise_name: exerciseName,
          set_details: defaultSets(),
        }),
      ],
    });
    setQuery("");
    setActiveDay(null);
  };

  const removeExercise = (day: string, exerciseId: string) => {
    onChange({
      ...value,
      [day]: (value[day] || []).filter((ex) => ex.exercise_id !== exerciseId),
    });
    setDrafts((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${day}:${exerciseId}:`)) delete next[key];
      });
      return next;
    });
  };

  const addSet = (day: string, exerciseId: string) => {
    updateExercise(day, exerciseId, (exercise) => {
      const details = [...(exercise.set_details || defaultSets())];
      if (details.length >= 10) return exercise;
      const previous = details[details.length - 1];
      details.push({
        set_number: details.length + 1,
        reps: previous?.reps || 8,
        weight: previous?.weight,
      });
      return { ...exercise, set_details: details };
    });
  };

  const removeSet = (day: string, exerciseId: string, setNumber: number) => {
    updateExercise(day, exerciseId, (exercise) => {
      const details = (exercise.set_details || defaultSets()).filter(
        (set) => set.set_number !== setNumber
      );
      return {
        ...exercise,
        set_details: details.length ? details : defaultSets().slice(0, 1),
      };
    });
  };

  const commitSetField = (
    day: string,
    exerciseId: string,
    setNumber: number,
    field: DraftKind,
    raw: string
  ) => {
    updateExercise(day, exerciseId, (exercise) => {
      const details = (exercise.set_details || defaultSets()).map((set) => {
        if (set.set_number !== setNumber) return set;
        if (field === "reps") {
          const parsed = Number(raw);
          return {
            ...set,
            reps:
              Number.isFinite(parsed) && parsed > 0
                ? Math.min(30, Math.max(1, Math.round(parsed)))
                : 8,
          };
        }
        const cleaned = raw.trim();
        if (!cleaned) {
          const { weight: _weight, ...rest } = set;
          return rest;
        }
        const parsed = Number(cleaned);
        return {
          ...set,
          weight:
            Number.isFinite(parsed) && parsed > 0
              ? Math.min(1000, Math.round(parsed * 2) / 2)
              : set.weight,
        };
      });
      return { ...exercise, set_details: details };
    });
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[draftKey(day, exerciseId, setNumber, field)];
      return next;
    });
  };

  const displayValue = (
    day: string,
    exerciseId: string,
    set: SplitRoutineSet,
    field: DraftKind
  ) => {
    const key = draftKey(day, exerciseId, set.set_number, field);
    if (Object.prototype.hasOwnProperty.call(drafts, key)) {
      return drafts[key];
    }
    if (field === "reps") return String(set.reps ?? 8);
    return set.weight != null ? String(set.weight) : "";
  };

  return (
    <div className="space-y-4">
      {dayNames.map((day, dayIndex) => {
        const exercises = value[day] || [];
        const picking = activeDay === day;
        return (
          <section
            key={`${dayIndex}-${day}`}
            className="rounded-xl border border-[#2A2D35] bg-[#161A22] p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white">{day}</h3>
                <p className="text-xs text-[#636366]">
                  {exercises.length
                    ? `${exercises.length} exercise${exercises.length === 1 ? "" : "s"}`
                    : "No exercises yet"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveDay(picking ? null : day);
                  setQuery("");
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-[#2A2D35] px-3 py-1.5 text-xs font-semibold text-[#FF6B35] hover:border-[#FF6B35]/50"
              >
                <MdAdd size={14} />
                Add
              </button>
            </div>

            <div className="space-y-3">
              {exercises.map((ex) => {
                const details = withDerived(ex).set_details || defaultSets();
                return (
                  <div
                    key={ex.exercise_id}
                    className="rounded-lg border border-[#1C1C1E] bg-[#0B0C10] p-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                        {ex.exercise_name}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeExercise(day, ex.exercise_id)}
                        className="rounded-lg p-1.5 text-[#636366] hover:bg-[#161A22] hover:text-white"
                        aria-label={`Remove ${ex.exercise_name}`}
                      >
                        <MdClose size={16} />
                      </button>
                    </div>

                    <div className="mb-1.5 grid grid-cols-[36px_1fr_1fr_28px] gap-2 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#636366]">
                      <span>Set</span>
                      <span>Reps</span>
                      <span>Weight</span>
                      <span />
                    </div>

                    <div className="space-y-1.5">
                      {details.map((set) => (
                        <div
                          key={set.set_number}
                          className="grid grid-cols-[36px_1fr_1fr_28px] items-center gap-2"
                        >
                          <span className="text-center text-xs font-semibold text-[#8E8E93]">
                            {set.set_number}
                          </span>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={displayValue(day, ex.exercise_id, set, "reps")}
                            onChange={(event) => {
                              const next = event.target.value.replace(/[^\d]/g, "");
                              setDrafts((prev) => ({
                                ...prev,
                                [draftKey(
                                  day,
                                  ex.exercise_id,
                                  set.set_number,
                                  "reps"
                                )]: next,
                              }));
                            }}
                            onBlur={(event) =>
                              commitSetField(
                                day,
                                ex.exercise_id,
                                set.set_number,
                                "reps",
                                event.target.value
                              )
                            }
                            className="w-full rounded border border-[#2A2D35] bg-[#161A22] px-2 py-1.5 text-center text-xs text-white outline-none focus:border-[#FF6B35]"
                            aria-label={`Set ${set.set_number} reps`}
                          />
                          <div className="relative">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={displayValue(
                                day,
                                ex.exercise_id,
                                set,
                                "weight"
                              )}
                              onChange={(event) => {
                                const next = event.target.value.replace(
                                  /[^\d.]/g,
                                  ""
                                );
                                setDrafts((prev) => ({
                                  ...prev,
                                  [draftKey(
                                    day,
                                    ex.exercise_id,
                                    set.set_number,
                                    "weight"
                                  )]: next,
                                }));
                              }}
                              onBlur={(event) =>
                                commitSetField(
                                  day,
                                  ex.exercise_id,
                                  set.set_number,
                                  "weight",
                                  event.target.value
                                )
                              }
                              placeholder="—"
                              className="w-full rounded border border-[#2A2D35] bg-[#161A22] px-2 py-1.5 pr-8 text-center text-xs text-white outline-none placeholder:text-[#636366] focus:border-[#FF6B35]"
                              aria-label={`Set ${set.set_number} weight`}
                            />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#636366]">
                              lbs
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              removeSet(day, ex.exercise_id, set.set_number)
                            }
                            disabled={details.length <= 1}
                            className="rounded p-1 text-[#636366] hover:text-white disabled:opacity-30"
                            aria-label={`Remove set ${set.set_number}`}
                          >
                            <MdClose size={14} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => addSet(day, ex.exercise_id)}
                      disabled={details.length >= 10}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#5EEAD4] hover:text-white disabled:opacity-40"
                    >
                      <MdAdd size={14} />
                      Add set
                    </button>
                  </div>
                );
              })}
            </div>

            {picking && (
              <div className="mt-3 rounded-xl border border-[#2A2D35] bg-[#0B0C10] p-3">
                <div className="relative mb-2">
                  <MdSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#636366]" />
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search exercises…"
                    className="w-full rounded-lg border border-[#2A2D35] bg-[#161A22] py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-[#636366] focus:border-[#FF6B35]"
                  />
                </div>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {results.map((ex) => (
                    <button
                      key={ex.id}
                      type="button"
                      onClick={() => addExercise(day, ex.id, ex.name)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-[#161A22]"
                    >
                      <span className="text-sm font-medium text-white">
                        {ex.name}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-[#636366]">
                        {ex.category}
                      </span>
                    </button>
                  ))}
                  {!results.length && (
                    <p className="px-2 py-3 text-xs text-[#8E8E93]">
                      No matching exercises.
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
