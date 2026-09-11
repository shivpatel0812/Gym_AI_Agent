import { useCallback, useState } from "react";
import {
  MdAdd,
  MdCheckCircleOutline,
  MdClose,
  MdSchedule,
  MdTrendingDown,
  MdTrendingUp,
} from "react-icons/md";
import {
  createGoal,
  deleteGoal,
  setGoalStatus,
} from "../../api/progress";
import type { Goal, GoalKind, Position } from "../../api/progress";

/**
 * Goals list + create form. on_track is tri-state: true / false / null
 * ("too early") — never collapse null into behind.
 */

const KIND_OPTIONS: {
  kind: GoalKind;
  label: string;
  unit: string;
  hint: string;
}[] = [
  { kind: "exercise_e1rm", label: "A lift", unit: "lb", hint: "Estimated 1RM to reach" },
  { kind: "bodyweight", label: "Bodyweight", unit: "lb", hint: "Weight to reach" },
  { kind: "index_level", label: "Progress index", unit: "", hint: "Index level to reach" },
  { kind: "sessions_per_week", label: "Consistency", unit: "/wk", hint: "Sessions per week" },
];

function trackStyle(goal: Goal): {
  color: string;
  Icon: typeof MdTrendingUp;
  text: string;
} {
  if (goal.status === "achieved")
    return { color: "#22C55E", Icon: MdCheckCircleOutline, text: "Reached" };
  if (goal.on_track === true)
    return { color: "#22C55E", Icon: MdTrendingUp, text: "On pace" };
  if (goal.on_track === false)
    return { color: "#EF4444", Icon: MdTrendingDown, text: "Behind pace" };
  return { color: "#8E8E93", Icon: MdSchedule, text: "Too early to say" };
}

function goalTitle(goal: Goal, positions: Position[]): string {
  if (goal.label) return goal.label;
  if (goal.kind === "exercise_e1rm") {
    const match = positions.find((p) => p.exercise_id === goal.exercise_id);
    return match ? `${match.name} 1RM` : "Lift 1RM";
  }
  return goal.kind_label;
}

export default function GoalsSection({
  goals,
  positions,
  onChanged,
}: {
  goals: Goal[];
  positions: Position[];
  onChanged: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<GoalKind>("exercise_e1rm");
  const [exerciseId, setExerciseId] = useState<string | null>(
    positions[0]?.exercise_id ?? null
  );
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const reset = () => {
    setKind("exercise_e1rm");
    setExerciseId(positions[0]?.exercise_id ?? null);
    setTarget("");
    setTargetDate("");
    setError(null);
  };

  const submit = useCallback(async () => {
    const value = Number(target);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a target number.");
      return;
    }
    if (kind === "exercise_e1rm" && !exerciseId) {
      setError("Pick a lift.");
      return;
    }
    if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      setError("Date must look like 2026-12-31.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createGoal({
        kind,
        target_value: value,
        target_date: targetDate || null,
        exercise_id: kind === "exercise_e1rm" ? exerciseId : null,
      });
      setComposing(false);
      reset();
      onChanged();
    } catch {
      setError("Could not save that goal.");
    } finally {
      setBusy(false);
    }
  }, [kind, exerciseId, target, targetDate, onChanged]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch {
      setError("That didn't save.");
    } finally {
      setBusy(false);
    }
  };

  const proposed = goals.filter((g) => g.status === "proposed");
  const listed = goals.filter((g) => g.status !== "proposed");
  const selectedUnit = KIND_OPTIONS.find((k) => k.kind === kind)?.unit ?? "";

  return (
    <section>
      <div className="mb-2 mt-8 flex items-center justify-between">
        <h2 className="text-[10px] font-bold tracking-[1.4px] text-[#8E8E93]">
          GOALS
        </h2>
        <button
          type="button"
          onClick={() => setComposing((v) => !v)}
          className="flex h-10 w-10 items-center justify-center text-[#FF6B35] hover:opacity-80"
          aria-label="Add a goal"
        >
          <MdAdd size={20} />
        </button>
      </div>

      {error && !composing ? (
        <p className="mb-2 text-xs text-[#EF4444]" role="alert">
          {error}
        </p>
      ) : null}

      {composing ? (
        <div className="mb-3 rounded-xl border border-[#2A2D35] bg-[#161A22] p-4">
          <p className="mb-3 text-base font-bold text-white">New goal</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {KIND_OPTIONS.map((option) => {
              const on = option.kind === kind;
              return (
                <button
                  key={option.kind}
                  type="button"
                  onClick={() => setKind(option.kind)}
                  className={`min-h-[40px] rounded-full px-3 text-xs ${
                    on
                      ? "bg-[#FF6B35] font-bold text-white"
                      : "bg-[#0F1115] text-[#8E8E93]"
                  }`}
                  aria-pressed={on}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {kind === "exercise_e1rm" ? (
            positions.length ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {positions.slice(0, 6).map((position) => {
                  const on = position.exercise_id === exerciseId;
                  return (
                    <button
                      key={position.exercise_id}
                      type="button"
                      onClick={() => setExerciseId(position.exercise_id)}
                      className={`min-h-[40px] rounded-full px-3 text-xs ${
                        on
                          ? "bg-[#FF6B35] font-bold text-white"
                          : "bg-[#0F1115] text-[#8E8E93]"
                      }`}
                      aria-pressed={on}
                    >
                      {position.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mb-3 text-xs text-[#8E8E93]">
                No tracked lifts yet — log a couple of sessions first.
              </p>
            )
          ) : null}

          <label className="mb-1 block text-xs text-[#8E8E93]">
            {KIND_OPTIONS.find((k) => k.kind === kind)?.hint}
            {selectedUnit ? ` (${selectedUnit})` : ""}
          </label>
          <input
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="225"
            className="mb-3 w-full rounded-lg bg-[#0F1115] px-3 py-2.5 text-sm text-white placeholder:text-[#8E8E93] outline-none focus:ring-1 focus:ring-[#FF6B35]"
          />

          <label className="mb-1 block text-xs text-[#8E8E93]">
            Target date (optional)
          </label>
          <input
            type="text"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            placeholder="2026-12-31"
            className="mb-1 w-full rounded-lg bg-[#0F1115] px-3 py-2.5 text-sm text-white placeholder:text-[#8E8E93] outline-none focus:ring-1 focus:ring-[#FF6B35]"
          />
          <p className="mb-3 text-[10px] leading-4 text-[#8E8E93]">
            Without a date there is no pace to be behind — the goal just tracks
            distance.
          </p>

          {error ? (
            <p className="mb-2 text-xs text-[#EF4444]" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="min-h-[44px] flex-1 rounded-xl bg-[#FF6B35] text-sm font-bold text-white disabled:opacity-60"
            >
              {busy ? "Saving…" : "Set goal"}
            </button>
            <button
              type="button"
              onClick={() => {
                setComposing(false);
                reset();
              }}
              className="min-h-[44px] rounded-xl bg-[#0F1115] px-4 text-sm text-[#8E8E93]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {proposed.map((goal) => (
        <div
          key={goal.id}
          className="mb-2 rounded-xl border border-[#3A3F4A] bg-[#161A22] p-4"
        >
          <p className="mb-1 text-[10px] font-bold tracking-[1.2px] text-[#5EEAD4]">
            SUGGESTED BY YOUR COACH
          </p>
          <p className="text-base font-bold text-white">
            {goalTitle(goal, positions)}
          </p>
          <p className="text-xs text-[#8E8E93]">
            Target {goal.target_value}
            {goal.unit}
            {goal.target_date ? ` by ${goal.target_date}` : ""}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => setGoalStatus(goal.id, "active"))}
              className="min-h-[44px] flex-1 rounded-xl bg-[#FF6B35] text-sm font-bold text-white disabled:opacity-60"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => deleteGoal(goal.id))}
              className="min-h-[44px] flex-1 rounded-xl bg-[#0F1115] text-sm text-[#8E8E93] disabled:opacity-60"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}

      {listed.length === 0 && proposed.length === 0 ? (
        <div className="rounded-xl bg-[#161A22] p-4">
          <p className="text-xs leading-[18px] text-[#8E8E93]">
            No goals yet. Set one here, or ask the coach to suggest a target it
            thinks the plan can actually reach.
          </p>
        </div>
      ) : null}

      {listed.map((goal) => {
        const track = trackStyle(goal);
        const pct = Math.max(0, Math.min(100, goal.progress_pct ?? 0));
        const Icon = track.Icon;
        return (
          <div key={goal.id} className="mb-2 rounded-xl bg-[#161A22] p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="flex-1 text-base font-bold text-white">
                {goalTitle(goal, positions)}
              </p>
              {goal.status === "active" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => deleteGoal(goal.id))}
                  className="text-[#8E8E93] hover:text-white"
                  aria-label="Remove goal"
                >
                  <MdClose size={16} />
                </button>
              ) : null}
            </div>

            <p className="text-xs text-[#8E8E93]">
              {goal.current_value != null
                ? `${goal.current_value}${goal.unit}`
                : "—"}
              {" → "}
              {goal.target_value}
              {goal.unit}
              {goal.target_date ? ` by ${goal.target_date}` : ""}
            </p>

            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#0F1115]">
              <div
                className="h-1.5 rounded-full"
                style={{ width: `${pct}%`, backgroundColor: track.color }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Icon size={13} color={track.color} />
                <span
                  className="text-xs font-bold"
                  style={{ color: track.color }}
                >
                  {track.text}
                </span>
              </div>
              <span className="text-xs text-[#8E8E93]">
                {goal.progress_pct != null
                  ? `${Math.round(goal.progress_pct)}%`
                  : "—"}
                {goal.days_remaining != null && goal.days_remaining > 0
                  ? ` · ${goal.days_remaining}d left`
                  : ""}
              </span>
            </div>

            {goal.note ? (
              <p className="mt-1 text-[10px] text-[#8E8E93]">{goal.note}</p>
            ) : null}

            {goal.status === "active" ? (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => setGoalStatus(goal.id, "achieved"))}
                  className="min-h-[40px] flex-1 rounded-lg border border-[#2A2D35] text-xs font-bold text-[#22C55E] hover:bg-[#0F1115] disabled:opacity-60"
                >
                  Mark achieved
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => setGoalStatus(goal.id, "abandoned"))}
                  className="min-h-[40px] flex-1 rounded-lg border border-[#2A2D35] text-xs font-bold text-[#8E8E93] hover:bg-[#0F1115] disabled:opacity-60"
                >
                  Abandon
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
