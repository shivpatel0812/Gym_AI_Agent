import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  MdAutoAwesome,
  MdChatBubbleOutline,
  MdInfoOutline,
  MdWarningAmber,
} from "react-icons/md";
import ProjectionChart, {
  ChartLegend,
  type Series,
} from "../components/plan/ProjectionChart";
import {
  getPlanProjection,
  type PlanProjection,
  type ProjectedDay,
  type ProjectedExercise,
} from "../api/trainingPlan";
import {
  getActiveNutritionPlan,
  getPacingCatalog,
  setPacing,
  type NutritionPlan,
  type NutritionPacing,
  type PacingStyleInfo,
} from "../api/nutritionPlan";

const HORIZONS = [4, 8, 12];

/** Blues that read as data marks on the dark surface — same role as SERIES_COLORS. */
const LIFT_COLORS = ["#5EEAD4", "#9CC0E8", "#7C9CF5", "#38BDF8", "#A5B4FC"];

export default function PlanRoadmapPage() {
  const [projection, setProjection] = useState<PlanProjection | null>(null);
  const [nutritionPlan, setNutritionPlan] = useState<NutritionPlan | null>(null);
  const [weeks, setWeeks] = useState<number>(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getPlanProjection(weeks),
      getActiveNutritionPlan().catch(() => null),
    ])
      .then(([data, nutrition]) => {
        if (cancelled) return;
        setProjection(data);
        setNutritionPlan(nutrition);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load your plan roadmap.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weeks, reloadKey]);

  const handlePacingSaved = (plan: NutritionPlan) => {
    setNutritionPlan(plan);
    setReloadKey((k) => k + 1);
  };

  if (loading && !projection) {
    return (
      <div className="p-6 text-[#8E8E93]">
        <div className="animate-pulse">Projecting your plan…</div>
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-[#8E8E93]">{error}</div>;
  }

  if (!projection) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-8 text-center">
          <MdAutoAwesome className="mx-auto mb-3 text-[#5EEAD4]" size={32} />
          <h2 className="text-xl font-bold text-white">No active plan yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#8E8E93]">
            A roadmap projects where your current plan leads — week by week, per
            lift, with your nutrition alongside it. Build a plan first and it
            will show up here.
          </p>
          <Link
            to="/plan-generator"
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-[#5EEAD4]/40 bg-[#5EEAD4]/10 px-4 py-2.5 text-sm font-semibold text-[#5EEAD4] transition-colors hover:bg-[#5EEAD4]/15"
          >
            <MdAutoAwesome size={16} />
            Build my plan
          </Link>
        </div>
      </div>
    );
  }

  const { adherence, progress, nutrition } = projection;
  const totalWeeks =
    progress.total_weeks || nutrition?.weeks[nutrition.weeks.length - 1]?.week || weeks;

  return (
    <div className="relative mx-auto max-w-3xl space-y-10 p-4 pb-24 sm:p-6">
      <Header
        projection={projection}
        nutritionPlan={nutritionPlan}
        weeks={weeks}
        totalWeeks={totalWeeks}
        onWeeks={setWeeks}
      />

      <FuelSection
        trajectory={nutrition}
        plan={nutritionPlan}
        totalWeeks={totalWeeks}
        onPacingSaved={handlePacingSaved}
      />

      <SplitSection projection={projection} />

      <ClimbSection projection={projection} totalWeeks={totalWeeks} />

      <p className="flex items-start gap-2 text-xs leading-relaxed text-[#636366]">
        <MdInfoOutline size={14} className="mt-0.5 flex-shrink-0" />
        <span>
          Projections run your real progression rules forward — they are what
          the app will ask of you, not a guarantee.
          {adherence.measured ? (
            <>
              {" "}
              The realistic line is scaled to your recent consistency (
              {Math.round(adherence.rate * 100)}% of targets hit across{" "}
              {adherence.sessions_logged} sessions).
            </>
          ) : (
            <>
              {" "}
              Not enough history yet, so the realistic line assumes{" "}
              {Math.round(adherence.rate * 100)}%.
            </>
          )}
        </span>
      </p>

      <Link
        to="/chatbot"
        className="fixed bottom-6 right-6 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-[#5EEAD4] text-[#0B0C10] shadow-lg shadow-[#5EEAD4]/25 transition hover:bg-[#7EEFDD]"
        aria-label="Ask the coach"
      >
        <MdChatBubbleOutline size={22} />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  projection,
  nutritionPlan,
  weeks,
  totalWeeks,
  onWeeks,
}: {
  projection: PlanProjection;
  nutritionPlan: NutritionPlan | null;
  weeks: number;
  totalWeeks: number;
  onWeeks: (weeks: number) => void;
}) {
  const pills = useMemo(
    () => buildMetricPills(projection, nutritionPlan),
    [projection, nutritionPlan]
  );

  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#8E8E93]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#5EEAD4]" />
            Your plan · {totalWeeks} weeks
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {projection.plan_name}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#8E8E93]">
            {projection.primary_goal ||
              "Everything below is mapped to one goal: hit your week-end numbers without guessing week to week. Training and nutrition move together."}
          </p>
        </div>
        <div className="flex rounded-xl border border-[#2A2D35] bg-[#161A22] p-1">
          {HORIZONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onWeeks(option)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                weeks === option
                  ? "bg-[#5EEAD4]/15 text-[#5EEAD4]"
                  : "text-[#8E8E93] hover:text-white"
              }`}
            >
              {option} wk
            </button>
          ))}
        </div>
      </div>

      {pills.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pills.map((pill) => (
            <span
              key={pill.label}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                pill.highlight
                  ? "border-[#5EEAD4]/35 bg-[#5EEAD4]/10 text-[#5EEAD4]"
                  : "border-[#2A2D35] bg-[#161A22] text-[#C7CBD1]"
              }`}
            >
              <span
                className={`text-[10px] font-bold uppercase tracking-wide ${
                  pill.highlight ? "text-[#5EEAD4]/80" : "text-[#636366]"
                }`}
              >
                {pill.label}
              </span>
              <span className={pill.highlight ? "text-[#5EEAD4]" : "text-white"}>
                {pill.from}
              </span>
              <span className={pill.highlight ? "text-[#5EEAD4]/70" : "text-[#636366]"}>
                →
              </span>
              <span className={pill.highlight ? "text-[#5EEAD4]" : "text-white"}>
                {pill.to}
              </span>
            </span>
          ))}
        </div>
      )}
    </header>
  );
}

type MetricPill = {
  label: string;
  from: string;
  to: string;
  highlight?: boolean;
};

function buildMetricPills(
  projection: PlanProjection,
  nutritionPlan: NutritionPlan | null
): MetricPill[] {
  const pills: MetricPill[] = [];
  const keyLifts = pickClimbLifts(projection.days).slice(0, 2);

  for (const lift of keyLifts) {
    const start = lift.current || lift.realistic[0];
    const end = lift.realistic[lift.realistic.length - 1];
    if (!start || !end) continue;
    pills.push({
      label: shortLiftName(lift.exercise_name),
      from: `${start.weight}`,
      to: `${end.weight} lb`,
    });
  }

  const traj = projection.nutrition;
  if (traj?.weeks?.length) {
    const first = traj.weeks[0];
    const last = traj.weeks[traj.weeks.length - 1];
    if (first.expected_weight_lb != null && last.expected_weight_lb != null) {
      pills.push({
        label: "Bodyweight",
        from: `${Math.round(first.expected_weight_lb)}`,
        to: `${Math.round(last.expected_weight_lb)} lb`,
      });
    }
    pills.push({
      label: "Calories",
      from: formatCal(first.calories),
      to: formatCal(last.calories),
      highlight: true,
    });
  } else if (nutritionPlan?.targets?.calories) {
    pills.push({
      label: "Calories",
      from: formatCal(nutritionPlan.targets.calories),
      to: formatCal(nutritionPlan.targets.calories),
      highlight: true,
    });
  }

  return pills;
}

function formatCal(n: number): string {
  return Math.round(n).toLocaleString();
}

function shortLiftName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("bench")) return "Bench";
  if (lower.includes("squat")) return "Squat";
  if (lower.includes("deadlift")) return "Deadlift";
  if (lower.includes("overhead") || lower.includes("ohp") || lower.includes("press"))
    return "Press";
  if (lower.includes("row")) return "Row";
  return name.split(" ").slice(0, 2).join(" ");
}

// ---------------------------------------------------------------------------
// Fuel the plan
// ---------------------------------------------------------------------------

function FuelSection({
  trajectory,
  plan,
  totalWeeks,
  onPacingSaved,
}: {
  trajectory: PlanProjection["nutrition"];
  plan: NutritionPlan | null;
  totalWeeks: number;
  onPacingSaved?: (plan: NutritionPlan) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [styles, setStyles] = useState<PacingStyleInfo[]>([]);
  const [savingStyle, setSavingStyle] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const pacing: NutritionPacing | null =
    (trajectory?.pacing as NutritionPacing | undefined) || plan?.pacing || null;

  useEffect(() => {
    if (!plan?.id || !showPicker) return;
    let cancelled = false;
    getPacingCatalog(plan.id)
      .then((data) => {
        if (!cancelled) setStyles(data.styles);
      })
      .catch(() => {
        if (!cancelled) setPickerError("Could not load pacing styles.");
      });
    return () => {
      cancelled = true;
    };
  }, [plan?.id, showPicker]);

  const applyStyle = async (style: string) => {
    if (!plan?.id) return;
    setSavingStyle(style);
    setPickerError(null);
    try {
      const catalog = styles.find((s) => s.style === style);
      const updated = await setPacing(plan.id, {
        style,
        ...(catalog?.weekly_step != null ? { weekly_step: catalog.weekly_step } : {}),
      });
      onPacingSaved?.(updated);
      setShowPicker(false);
    } catch {
      setPickerError("Could not save pacing. Try again.");
    } finally {
      setSavingStyle(null);
    }
  };

  if (!trajectory && !plan) {
    return (
      <section className="space-y-3">
        <SectionHead title="Fuel the plan" right={`wk 1–${totalWeeks}`} />
        <div className="rounded-2xl border border-dashed border-[#2A2D35] bg-[#161A22]/50 px-5 py-6 text-center">
          <p className="text-sm text-[#8E8E93]">
            No nutrition plan linked yet. Build one and it shows up here as the
            calorie ramp that fuels this training block.
          </p>
          <Link
            to="/nutrition"
            className="mt-3 inline-block text-sm font-semibold text-[#5EEAD4]"
          >
            Open nutrition plan →
          </Link>
        </div>
      </section>
    );
  }

  const weeks = trajectory?.weeks || [];
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const nowCal = first?.calories ?? plan?.targets?.calories ?? null;
  const targetCal = last?.calories ?? plan?.targets?.calories ?? null;
  const targetWeek = last?.week ?? totalWeeks;

  const proteinNow = plan?.targets?.protein ?? first?.protein ?? null;
  const proteinEnd = last?.protein ?? proteinNow;
  const carbs = plan?.targets?.carbs ?? null;
  const fats = plan?.targets?.fats ?? null;

  const calorieSeries: Series[] =
    weeks.length > 1
      ? [
          {
            id: "calories",
            label: "Daily calories",
            color: "#5EEAD4",
            points: weeks.map((w) => ({ week: w.week, value: w.calories })),
          },
        ]
      : [];

  return (
    <section className="space-y-4">
      <SectionHead
        title="Fuel the plan"
        right={
          plan ? (
            <Link to="/nutrition" className="hover:text-[#5EEAD4]">
              {plan.goal ? `${String(plan.goal).replace(/_/g, " ")} · ` : ""}
              wk 1–{targetWeek}
            </Link>
          ) : (
            `wk 1–${targetWeek}`
          )
        }
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#636366]">
            Current phase
          </p>
          <p className="mt-1 text-2xl font-bold text-[#8E8E93] sm:text-3xl">
            {nowCal != null ? formatCal(nowCal) : "—"}{" "}
            <span className="text-base font-semibold text-[#636366]">kcal / day</span>
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#5EEAD4]">
            Target phase
          </p>
          <p className="mt-1 text-2xl font-bold text-white sm:text-3xl">
            {targetCal != null ? formatCal(targetCal) : "—"}{" "}
            <span className="text-base font-semibold text-[#8E8E93]">
              kcal / day
              {weeks.length > 1 ? ` by wk ${targetWeek}` : ""}
            </span>
          </p>
        </div>
      </div>

      {pacing && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2A2D35] bg-[#161A22] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#636366]">
              Pacing
            </p>
            <p className="mt-0.5 text-sm font-bold text-white">
              {pacing.label || pacing.style}
              {pacing.weekly_step ? (
                <span className="ml-2 font-semibold text-[#5EEAD4]">
                  {pacing.weekly_step > 0 ? "+" : ""}
                  {pacing.weekly_step} kcal/wk
                </span>
              ) : (
                <span className="ml-2 font-semibold text-[#8E8E93]">flat</span>
              )}
            </p>
            {pacing.blurb && (
              <p className="mt-1 text-xs leading-relaxed text-[#8E8E93]">{pacing.blurb}</p>
            )}
          </div>
          {plan?.id && (
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              className="shrink-0 rounded-full border border-[#5EEAD4]/40 bg-[#5EEAD4]/10 px-3 py-1.5 text-xs font-bold text-[#5EEAD4] hover:bg-[#5EEAD4]/15"
            >
              {showPicker ? "Close" : "Adjust pacing"}
            </button>
          )}
        </div>
      )}

      {showPicker && (
        <div className="space-y-2 rounded-2xl border border-[#2A2D35] bg-[#0B0C10] p-4">
          <p className="text-xs text-[#8E8E93]">
            Pick how calories should move. This updates your nutrition plan and
            redraws the ramp — it does not rewrite your meals.
          </p>
          {pickerError && <p className="text-xs text-[#F5B99B]">{pickerError}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {styles.map((s) => {
              const on = pacing?.style === s.style;
              const busy = savingStyle === s.style;
              return (
                <button
                  key={s.style}
                  type="button"
                  disabled={!!savingStyle}
                  onClick={() => applyStyle(s.style)}
                  className={`rounded-xl border px-3 py-3 text-left transition ${
                    on
                      ? "border-[#5EEAD4]/50 bg-[#5EEAD4]/10"
                      : "border-[#2A2D35] bg-[#161A22] hover:border-[#5EEAD4]/30"
                  }`}
                >
                  <p className="text-sm font-bold text-white">
                    {s.label}
                    {busy ? "…" : ""}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#8E8E93]">{s.blurb}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {trajectory?.rationale && (
        <div className="rounded-xl border border-[#5EEAD4]/35 bg-[#5EEAD4]/05 px-4 py-3 text-sm leading-relaxed text-[#C7CBD1]">
          {trajectory.rationale}
          {trajectory.weekly_step > 0 && (
            <span className="mt-1 block text-[#8E8E93]">
              Add +{trajectory.weekly_step} kcal each week while the trend holds.
              If a week runs hot, hold instead of stacking another increase.
            </span>
          )}
        </div>
      )}

      {trajectory?.warnings?.map((warning, i) => (
        <p
          key={i}
          className="flex items-start gap-2 rounded-xl border border-[#E2622B]/40 bg-[#E2622B]/10 px-3 py-2.5 text-xs leading-relaxed text-[#F5B99B]"
        >
          <MdWarningAmber size={15} className="mt-0.5 flex-shrink-0" />
          {warning}
        </p>
      ))}

      {calorieSeries.length > 0 && (
        <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-4">
          <ProjectionChart
            series={calorieSeries}
            height={140}
            formatValue={(v) => `${Math.round(v)}`}
            ariaLabel="Daily calorie target by week"
            reference={
              trajectory?.maintenance_calories
                ? {
                    value: trajectory.maintenance_calories,
                    label: "maintenance",
                  }
                : undefined
            }
          />
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <MacroCard
          label="Protein"
          value={proteinEnd}
          unit="g"
          delta={
            proteinNow != null && proteinEnd != null && proteinEnd !== proteinNow
              ? proteinEnd - proteinNow
              : null
          }
        />
        <MacroCard label="Carbs" value={carbs} unit="g" />
        <MacroCard label="Fat" value={fats} unit="g" />
      </div>
    </section>
  );
}

function MacroCard({
  label,
  value,
  unit,
  delta,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  delta?: number | null;
}) {
  return (
    <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] px-4 py-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#636366]">
        {label}
      </p>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-bold text-white">
          {value != null ? Math.round(value) : "—"}
          {value != null && (
            <span className="ml-0.5 text-sm font-semibold text-[#8E8E93]">{unit}</span>
          )}
        </p>
        {delta != null && delta !== 0 && (
          <span className="text-xs font-bold text-[#5EEAD4]">
            {delta > 0 ? "+" : ""}
            {Math.round(delta)}
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The split
// ---------------------------------------------------------------------------

function SplitSection({ projection }: { projection: PlanProjection }) {
  const days = projection.days;
  const [active, setActive] = useState(days[0]?.day_name || "");

  useEffect(() => {
    if (!days.find((d) => d.day_name === active) && days[0]) {
      setActive(days[0].day_name);
    }
  }, [days, active]);

  const day = days.find((d) => d.day_name === active) || days[0];
  const splitLabel = days.map((d) => d.day_name.split(" ")[0]).join(" · ");

  if (!day) return null;

  return (
    <section className="space-y-4">
      <SectionHead title="The split" right={splitLabel.toLowerCase()} />

      <div className="flex flex-wrap gap-2">
        {days.map((d) => {
          const on = d.day_name === day.day_name;
          return (
            <button
              key={d.day_name}
              type="button"
              onClick={() => setActive(d.day_name)}
              className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
                on
                  ? "bg-[#5EEAD4] text-[#0B0C10]"
                  : "border border-[#2A2D35] bg-[#161A22] text-[#8E8E93] hover:text-white"
              }`}
            >
              {d.day_name}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#2A2D35] bg-[#161A22]">
        {day.exercises.map((exercise, i) => (
          <ExerciseRow
            key={exercise.exercise_id}
            exercise={exercise}
            last={i === day.exercises.length - 1}
          />
        ))}
        {day.exercises.length === 0 && (
          <p className="px-5 py-6 text-sm text-[#8E8E93]">
            No exercises on this day yet.
          </p>
        )}
      </div>
    </section>
  );
}

function ExerciseRow({
  exercise,
  last,
}: {
  exercise: ProjectedExercise;
  last?: boolean;
}) {
  const start = exercise.current || exercise.realistic[0];
  const end = exercise.realistic[exercise.realistic.length - 1];
  const badge = exerciseBadge(exercise);
  const sparkPoints = exercise.realistic.map((p) => p.e1rm);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5 ${
        last ? "" : "border-b border-[#2A2D35]"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white">
          {exercise.exercise_name}
        </p>
        {badge && (
          <span
            className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${badge.className}`}
          >
            {badge.label}
          </span>
        )}
      </div>

      <div className="shrink-0 text-right text-xs font-semibold text-[#C7CBD1]">
        <p className="sm:hidden text-[10px] text-[#636366]">
          {start ? `${start.weight}×${start.reps}` : "—"} → {end ? `${end.weight}×${end.reps}` : "—"}
        </p>
        <p className="hidden sm:block">
          {start ? `${start.weight}×${start.reps}` : "—"}
          <span className="mx-1.5 text-[#636366]">→</span>
          {end ? `${end.weight}×${end.reps}` : "—"}
        </p>
      </div>

      <Sparkline values={sparkPoints} color="#9CC0E8" />
    </div>
  );
}

function exerciseBadge(
  exercise: ProjectedExercise
): { label: string; className: string } | null {
  const goal = (exercise.goal || "").toLowerCase();
  if (exercise.priority === "high" || goal.includes("strength") || goal.includes("weight")) {
    return {
      label: "Weight-target",
      className: "bg-[#9CC0E8]/15 text-[#9CC0E8]",
    };
  }
  if (exercise.target_rep_range || goal.includes("hypertrophy") || goal.includes("rep")) {
    return {
      label: "Rep-range",
      className: "bg-[#5EEAD4]/15 text-[#5EEAD4]",
    };
  }
  if (exercise.priority === "supporting") {
    return {
      label: "Supporting",
      className: "bg-[#2A2D35] text-[#8E8E93]",
    };
  }
  return null;
}

function Sparkline({
  values,
  color,
  width = 72,
  height = 28,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return <div style={{ width, height }} className="shrink-0" />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      className="shrink-0"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The climb
// ---------------------------------------------------------------------------

function ClimbSection({
  projection,
  totalWeeks,
}: {
  projection: PlanProjection;
  totalWeeks: number;
}) {
  const lifts = pickClimbLifts(projection.days).slice(0, 4);
  if (!lifts.length) return null;

  const series: Series[] = lifts.map((lift, i) => ({
    id: lift.exercise_id,
    label: shortLiftName(lift.exercise_name),
    color: LIFT_COLORS[i % LIFT_COLORS.length],
    points: lift.realistic.map((p) => ({ week: p.week, value: p.e1rm })),
  }));

  return (
    <section className="space-y-4">
      <SectionHead title="The climb" right={`e1RM, wk 1–${totalWeeks}`} />

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {lifts.map((lift, i) => {
          const start = lift.current?.e1rm ?? lift.realistic[0]?.e1rm;
          const end = lift.realistic[lift.realistic.length - 1]?.e1rm;
          return (
            <span
              key={lift.exercise_id}
              className="flex items-center gap-2 text-xs text-[#8E8E93]"
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: LIFT_COLORS[i % LIFT_COLORS.length] }}
              />
              <span className="font-semibold text-[#C7CBD1]">
                {shortLiftName(lift.exercise_name)}
              </span>
              {start != null && end != null && (
                <span>
                  {Math.round(start)} → {Math.round(end)}
                </span>
              )}
            </span>
          );
        })}
      </div>

      <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-4">
        <ProjectionChart
          series={series}
          height={200}
          formatValue={(v) => `${Math.round(v)}`}
          ariaLabel="Projected estimated 1RM for key lifts"
        />
        <div className="mt-3">
          <ChartLegend series={series} />
        </div>
      </div>
    </section>
  );
}

/** Prefer priority lifts, then common compounds, then biggest projected gain. */
function pickClimbLifts(days: ProjectedDay[]): ProjectedExercise[] {
  const all = days.flatMap((d) => d.exercises);
  const scored = all.map((ex) => {
    const name = ex.exercise_name.toLowerCase();
    let score = 0;
    if (ex.priority === "high") score += 40;
    if (name.includes("bench")) score += 30;
    else if (name.includes("squat")) score += 28;
    else if (name.includes("deadlift")) score += 26;
    else if (name.includes("row") || name.includes("press")) score += 12;
    score += Math.min(ex.gain.realistic_e1rm || 0, 40);
    if (ex.seeded_from_history) score += 5;
    return { ex, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: ProjectedExercise[] = [];
  for (const { ex } of scored) {
    const key = shortLiftName(ex.exercise_name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ex);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

function SectionHead({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-xl font-bold text-white">{title}</h2>
      {right != null && (
        <p className="text-xs font-medium text-[#636366]">{right}</p>
      )}
    </div>
  );
}
