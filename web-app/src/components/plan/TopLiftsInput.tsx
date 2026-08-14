import type { TopLifts } from "../../types";

const LIFTS: { key: keyof TopLifts; label: string; hint: string }[] = [
  { key: "bench_press", label: "Bench Press", hint: "Any recent strong set" },
  { key: "squat", label: "Squat", hint: "Any recent strong set" },
  { key: "deadlift", label: "Deadlift", hint: "Any recent strong set" },
  { key: "overhead_press", label: "Overhead Press", hint: "Any recent strong set" },
  { key: "barbell_row", label: "Barbell Row", hint: "Any recent strong set" },
];

interface TopLiftsInputProps {
  value: TopLifts;
  onChange: (value: TopLifts) => void;
}

export default function TopLiftsInput({ value, onChange }: TopLiftsInputProps) {
  return (
    <div className="space-y-3">
      {LIFTS.map((lift) => (
        <label
          key={lift.key}
          className="flex flex-col gap-3 rounded-xl border border-[#2A2D35] bg-[#161A22] p-4 sm:flex-row sm:items-center"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white">{lift.label}</span>
            <span className="block text-xs text-[#636366]">{lift.hint}</span>
          </span>
          <span className="grid w-full grid-cols-2 gap-2 sm:w-[230px]">
            <span className="relative">
              <input
                type="number"
                min="1"
                max="1000"
                step="5"
                placeholder="Weight"
                aria-label={`${lift.label} weight`}
                value={value[lift.key]?.weight ?? ""}
                onChange={(event) => {
                  const next = { ...value };
                  const parsed = Number(event.target.value);
                  if (event.target.value && parsed > 0) {
                    next[lift.key] = {
                      weight: parsed,
                      reps: value[lift.key]?.reps,
                    };
                  } else {
                    delete next[lift.key];
                  }
                  onChange(next);
                }}
                className="w-full rounded-lg border border-[#2A2D35] bg-[#0B0C10] px-3 py-2 pr-9 text-right text-sm font-semibold text-white outline-none placeholder:text-[#636366] focus:border-[#FF6B35]"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#636366]">
                lbs
              </span>
            </span>
            <span className="relative">
              <input
                type="number"
                min="1"
                max="50"
                step="1"
                placeholder="Reps"
                aria-label={`${lift.label} reps`}
                disabled={!value[lift.key]}
                value={value[lift.key]?.reps ?? ""}
                onChange={(event) => {
                  const current = value[lift.key];
                  if (!current) return;
                  const parsed = Number(event.target.value);
                  onChange({
                    ...value,
                    [lift.key]: {
                      ...current,
                      reps:
                        event.target.value && parsed > 0 ? parsed : undefined,
                    },
                  });
                }}
                className="w-full rounded-lg border border-[#2A2D35] bg-[#0B0C10] px-3 py-2 pr-9 text-right text-sm font-semibold text-white outline-none placeholder:text-[#636366] focus:border-[#FF6B35] disabled:opacity-40"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#636366]">
                reps
              </span>
            </span>
          </span>
        </label>
      ))}
      <p className="text-xs leading-relaxed text-[#8E8E93]">
        This does not need to be a max. Enter any representative set you
        remember; reps are optional. It only provides context for adjustable,
        medium-confidence starting estimates.
      </p>
    </div>
  );
}
