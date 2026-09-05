import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  MdArrowBackIosNew,
  MdArrowForwardIos,
  MdAutoAwesome,
  MdCheck,
  MdClose,
  MdEdit,
  MdInfoOutline,
  MdOutlineCalendarToday,
  MdWarningAmber,
} from "react-icons/md";
import ProjectionChart, {
  ChartLegend,
  SERIES_COLORS,
  type Series,
} from "../components/plan/ProjectionChart";
import {
  getPlanProjection,
  type NutritionTrajectory,
  type PlanProjection,
  type ProjectedDay,
  type ProjectedExercise,
  type WeekPoint,
} from "../api/trainingPlan";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PROJECTION_WEEKS = 12;
type LiftRole = "building" | "maintaining" | "support";

type HistoryPoint = {
  key: string;
  date: string;
  e1rm: number;
  sessionId?: string;
  label: string;
};

export default function PlanRoadmapPage() {
  const [projection, setProjection] = useState<PlanProjection | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getPlanProjection(PROJECTION_WEEKS)
      .then((value) => live && setProjection(value))
      .catch(() => live && setError("Could not load your plan hub."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const days = projection?.days || [];
  const day = days[dayIndex] || days[0];

  if (loading) return <PageMessage>Loading your live plan…</PageMessage>;
  if (error) return <PageMessage>{error}</PageMessage>;
  if (!projection || !day) return <EmptyState />;

  const move = (delta: number) => setDayIndex((dayIndex + delta + days.length) % days.length);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-5 sm:px-7 sm:pt-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#FF6B35]">
            Active training plan
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Plan Hub</h1>
          <p className="mt-2 text-sm text-[#8E8E93]">
            Today’s target, the road ahead, and the reason behind every lift.
          </p>
        </div>
        <Link
          to="/chatbot"
          className="inline-flex items-center gap-2 rounded-xl border border-[#393C44] bg-[#161A22] px-4 py-2.5 text-sm font-semibold text-white hover:border-[#FF6B35]/60"
        >
          <MdEdit size={16} /> Edit in Plan Mode
        </Link>
      </header>

      <nav className="mt-8 flex items-center gap-3" aria-label="Training days">
        <button
          onClick={() => move(-1)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#2A2D35] text-[#8E8E93] hover:text-white"
          aria-label="Previous training day"
        >
          <MdArrowBackIosNew size={15} />
        </button>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto rounded-2xl bg-[#111319] p-1.5">
          {days.map((item, index) => (
            <button
              key={item.day_name}
              onClick={() => setDayIndex(index)}
              className={`min-w-[110px] flex-1 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                index === dayIndex
                  ? "bg-[#FF6B35] text-white shadow-lg shadow-[#FF6B35]/10"
                  : "text-[#8E8E93] hover:text-white"
              }`}
            >
              {shortDay(item.day_name)}
            </button>
          ))}
        </div>
        <button
          onClick={() => move(1)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#2A2D35] text-[#8E8E93] hover:text-white"
          aria-label="Next training day"
        >
          <MdArrowForwardIos size={15} />
        </button>
      </nav>

      <DaySummary day={day} projection={projection} />

      <div className="mt-7 space-y-5">
        {day.exercises.map((exercise) => (
          <FocusCard key={exercise.exercise_id} exercise={exercise} />
        ))}
      </div>

      {projection.nutrition?.weeks?.length ? (
        <NutritionSection nutrition={projection.nutrition} />
      ) : null}

      <div className="mt-8 rounded-2xl border border-dashed border-[#343740] px-5 py-4 text-sm text-[#8E8E93]">
        <span className="font-semibold text-white">Coach changes stay reviewable.</span> When the
        AI adjusts a next-session target, its suggestion appears here with Accept and Discard
        controls before your live plan changes.
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="rounded-3xl border border-[#2A2D35] bg-[#161A22] p-10 text-center">
        <MdAutoAwesome className="mx-auto text-[#FF6B35]" size={34} />
        <h1 className="mt-4 text-2xl font-bold">Your plan starts with a goal</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#8E8E93]">
          Build a plan with your coach, then every lift’s next target and longer-term direction
          will live here.
        </p>
        <Link
          to="/chatbot"
          className="mt-6 inline-flex rounded-xl bg-[#FF6B35] px-5 py-3 text-sm font-bold text-white"
        >
          Start Plan Mode
        </Link>
      </div>
    </div>
  );
}

function DaySummary({ day, projection }: { day: ProjectedDay; projection: PlanProjection }) {
  const lastDates = day.exercises.map((x) => x.last_trained).filter(Boolean) as string[];
  const last = lastDates.sort().at(-1);
  const counts = day.exercises.reduce(
    (acc, ex) => {
      const role = roleFor(ex);
      if (role === "building") acc.building++;
      if (role === "maintaining") acc.maintaining++;
      return acc;
    },
    { building: 0, maintaining: 0 }
  );

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-[#2A2D35] bg-[#161A22]">
      <div className="border-b border-[#2A2D35] px-5 py-4">
        <p className="text-lg font-bold">{day.day_name}</p>
        <p className="mt-0.5 text-xs text-[#8E8E93]">
          {day.day_goal || day.focus || "Your next session targets"}
        </p>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-[#2A2D35] sm:grid-cols-4 sm:divide-y-0">
        <SummaryMetric label="Last trained" value={last ? formatDate(last) : "No session yet"} />
        <SummaryMetric
          label="Next expected"
          value={nextScheduled(day.day_name, projection.weekly_schedule)}
          icon={<MdOutlineCalendarToday size={14} />}
        />
        <SummaryMetric
          label="Building"
          value={`${counts.building} lift${counts.building === 1 ? "" : "s"}`}
          accent
        />
        <SummaryMetric
          label="Maintaining"
          value={`${counts.maintaining} lift${counts.maintaining === 1 ? "" : "s"}`}
        />
      </div>
    </section>
  );
}

function SummaryMetric({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#636366]">{label}</p>
      <p
        className={`mt-1 flex items-center gap-1.5 text-sm font-bold ${
          accent ? "text-[#FF8A5C]" : "text-white"
        }`}
      >
        {icon}
        {value}
      </p>
    </div>
  );
}

function FocusCard({ exercise }: { exercise: ProjectedExercise }) {
  const role = roleFor(exercise);

  const current = exercise.current || exercise.realistic[0];
  const target = destinationAsWeekPoint(exercise) || peakPoint(exercise.realistic);
  const progress =
    current && target?.e1rm ? Math.min(100, Math.round((current.e1rm / target.e1rm) * 100)) : 0;
  const dest = resolveDestination(exercise);
  const targetWeeks = dest?.weeks || exercise.realistic.length || PROJECTION_WEEKS;

  return (
    <article className="overflow-hidden rounded-3xl border border-[#2A2D35] bg-[#161A22]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#2A2D35] px-5 py-5 sm:px-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{exercise.exercise_name}</h2>
            <RoleBadge role={role} />
          </div>
          <p className="mt-1 text-xs text-[#8E8E93]">
            {role === "building"
              ? goalCopy(exercise)
              : role === "support"
                ? "Support work for your priority lifts — history still charts below."
                : "Holding this number on purpose while it supports the rest of your plan."}
          </p>
        </div>
        <Link to="/chatbot" className="text-xs font-bold text-[#8E8E93] hover:text-[#FF8A5C]">
          Revise goal →
        </Link>
      </div>

      <div className="grid gap-6 p-5 sm:grid-cols-[180px_1fr] sm:p-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366]">
            Next session
          </p>
          <p className="mt-2 text-3xl font-bold tracking-tight">
            {formatTarget(nextPoint(exercise))}
          </p>
          <p className="mt-1 text-xs text-[#8E8E93]">{exercise.sets || 3} working sets</p>
          {role === "building" && target && (
            <div className="mt-5">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-wide text-[#636366]">
                <span>Goal progress</span>
                <span>{progress}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#292C33]">
                <div className="h-full rounded-full bg-[#FF6B35]" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-xs font-semibold text-white">
                {formatTarget(target)}{" "}
                <span className="font-normal text-[#636366]">by {targetDate(targetWeeks)}</span>
                {exercise.reachable === false ? (
                  <span className="font-normal text-[#E2622B]"> · stretch</span>
                ) : null}
              </p>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366]">
              History &amp; {PROJECTION_WEEKS}-week trajectory
            </p>
            <p className="text-[10px] text-[#636366]">Today is the divider</p>
          </div>
          <Trajectory exercise={exercise} flat={role === "maintaining" || role === "support"} />
        </div>
      </div>

      <div className="border-t border-[#2A2D35] px-5 py-4 sm:px-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366]">
          Workout recommendations
        </p>
        <p className="mt-1 text-xs text-[#8E8E93]">
          What to hit each week if you stay on plan.
        </p>
        <ProgressionTable exercise={exercise} />
      </div>

      <HistoryStrip exercise={exercise} role={role} />
    </article>
  );
}

function RoleBadge({ role }: { role: LiftRole }) {
  const styles =
    role === "building"
      ? "bg-[#FF6B35]/15 text-[#FF8A5C]"
      : role === "maintaining"
        ? "bg-[#5EEAD4]/10 text-[#5EEAD4]"
        : "bg-[#2A2D35] text-[#A4A7AE]";
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.12em] ${styles}`}
    >
      {role === "support" ? "Support work" : role}
    </span>
  );
}

/**
 * History left of TODAY, realistic solid + dashed best_case to the right.
 * Clicking a history point with a session_id opens that workout.
 */
function Trajectory({ exercise, flat }: { exercise: ProjectedExercise; flat: boolean }) {
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const history = useMemo(() => historyPoints(exercise), [exercise]);

  const chart = useMemo(() => {
    const forward = [exercise.current, ...exercise.realistic].filter(Boolean) as WeekPoint[];
    const ceiling = [exercise.current, ...(exercise.best_case || [])].filter(Boolean) as WeekPoint[];
    if (!forward.length && !history.length) return null;

    const forwardValues = forward.map((p) => (flat && forward.length ? forward[0].e1rm : p.e1rm));
    const ceilingValues = flat ? [] : ceiling.map((p) => p.e1rm);
    const pastValues = history.map((p) => p.e1rm);
    const all = [...forwardValues, ...ceilingValues, ...pastValues];
    if (!all.length) return null;

    const width = 400;
    const height = 120;
    const plotTop = 10;
    const plotHeight = 78;
    const left = 8;
    const right = width - 8;

    const rawLo = Math.min(...all);
    const rawHi = Math.max(...all);
    const pad = rawHi - rawLo < 1e-6 ? Math.max(rawHi * 0.1, 1) : (rawHi - rawLo) * 0.12;
    const min = rawLo - pad;
    const max = rawHi + pad;
    const span = Math.max(max - min, 1e-6);
    const y = (value: number) => plotTop + (1 - (value - min) / span) * plotHeight;

    const historySteps = Math.max(history.length - 1, 0);
    const forwardSteps = Math.max(forward.length - 1, 1);
    const rawShare = historySteps / (historySteps + forwardSteps || 1);
    const share = history.length < 2 ? 0.12 : Math.min(0.5, Math.max(0.2, rawShare));
    const todayX = left + share * (right - left);

    const pastCoords = history.map((point, index) => ({
      x: history.length === 1 ? todayX : left + (index / historySteps) * (todayX - left),
      y: y(point.e1rm),
      point,
    }));

    const project = (points: WeekPoint[], values: number[]) =>
      points.map((point, i) => ({
        x: todayX + (i / forwardSteps) * (right - todayX),
        y: y(values[i]),
        point,
      }));

    return {
      width,
      height,
      pastCoords,
      forward: project(forward, forwardValues),
      ceiling: flat || ceiling.length < 2 ? [] : project(ceiling, ceilingValues),
      todayX,
      left,
      right,
      plotTop,
      plotHeight,
    };
  }, [exercise, flat, history]);

  if (!chart) {
    return <p className="mt-3 text-xs text-[#636366]">No data for this exercise yet.</p>;
  }

  const path = (points: { x: number; y: number }[]) =>
    points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const accent = flat ? "#5EEAD4" : "#FF6B35";
  const hovered = chart.pastCoords.find((c) => c.point.key === hoverKey);

  const pickHistory = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !chart.pastCoords.length) return;
    const x = ((clientX - rect.left) / rect.width) * chart.width;
    if (x > chart.todayX + 8) {
      setHoverKey(null);
      return;
    }
    let best = chart.pastCoords[0];
    let bestDist = Infinity;
    for (const coord of chart.pastCoords) {
      const dist = Math.abs(coord.x - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = coord;
      }
    }
    setHoverKey(best.point.key);
  };

  const openHovered = () => {
    const sessionId = hovered?.point.sessionId;
    if (!sessionId) return;
    navigate(`/workouts?tab=sessions&edit=${encodeURIComponent(sessionId)}`);
  };

  return (
    <div className="mt-3">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        className="h-[145px] w-full"
        role="img"
        aria-label={`Projected trajectory for ${exercise.exercise_name}`}
        onMouseMove={(e) => pickHistory(e.clientX)}
        onMouseLeave={() => setHoverKey(null)}
        onClick={openHovered}
        style={{ cursor: hovered?.point.sessionId ? "pointer" : "default" }}
      >
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={chart.left}
            x2={chart.right}
            y1={chart.plotTop + chart.plotHeight * ratio}
            y2={chart.plotTop + chart.plotHeight * ratio}
            stroke="#292C33"
            strokeDasharray="3 5"
          />
        ))}

        <line
          x1={chart.todayX}
          x2={chart.todayX}
          y1={chart.plotTop - 2}
          y2={chart.plotTop + chart.plotHeight + 4}
          stroke="#393C44"
          strokeWidth={1}
        />

        {chart.pastCoords.length > 1 ? (
          <path
            d={path(chart.pastCoords)}
            fill="none"
            stroke="#8E8E93"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {chart.ceiling.length > 1 ? (
          <path
            d={path(chart.ceiling)}
            fill="none"
            stroke={accent}
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.55}
          />
        ) : null}

        {chart.forward.length > 1 ? (
          <path
            d={path(chart.forward)}
            fill="none"
            stroke={accent}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {chart.pastCoords.map((coord) => (
          <circle
            key={coord.point.key}
            cx={coord.x}
            cy={coord.y}
            r={hoverKey === coord.point.key ? 5 : 3}
            fill={hoverKey === coord.point.key ? "#fff" : "#8E8E93"}
          />
        ))}

        {chart.forward.map((coord, i) => (
          <circle
            key={`fwd-${i}`}
            cx={coord.x}
            cy={coord.y}
            r={i === 0 ? 5 : 2.5}
            fill={i === 0 ? "#fff" : accent}
          />
        ))}

        <text x={chart.left} y={chart.height - 4} fill="#636366" fontSize="9">
          {history.length ? formatDate(history[0].date) : ""}
        </text>
        <text
          x={chart.todayX}
          y={chart.height - 4}
          fill="#636366"
          fontSize="9"
          textAnchor="middle"
        >
          TODAY
        </text>
        <text x={chart.right} y={chart.height - 4} fill="#636366" fontSize="9" textAnchor="end">
          {PROJECTION_WEEKS} WK
        </text>
      </svg>

      {hovered ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#8E8E93]">
          <span className="font-semibold text-white">{formatDate(hovered.point.date)}</span>
          <span>{hovered.point.label}</span>
          {hovered.point.sessionId ? (
            <Link
              to={`/workouts?tab=sessions&edit=${encodeURIComponent(hovered.point.sessionId)}`}
              className="font-bold text-[#FF8A5C] hover:underline"
            >
              Open session →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProgressionTable({ exercise }: { exercise: ProjectedExercise }) {
  const { weeks, sessionCount } = useMemo(() => {
    const schedule = exercise.schedule || [];
    const byWeek = new Map<number, Map<number, WeekPoint>>();
    let maxSession = 1;
    for (const point of schedule) {
      const session = point.session || 1;
      maxSession = Math.max(maxSession, session);
      if (!byWeek.has(point.week)) byWeek.set(point.week, new Map());
      byWeek.get(point.week)!.set(session, point);
    }
    return {
      weeks: [...byWeek.entries()].sort((a, b) => a[0] - b[0]),
      sessionCount: maxSession,
    };
  }, [exercise]);

  if (!weeks.length) return <LegacyProgressionTable exercise={exercise} />;

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-[#2A2D35]">
      <table className="min-w-full text-left text-xs">
        {sessionCount > 1 ? (
          <thead>
            <tr className="border-b border-[#2A2D35] bg-[#111319] text-[10px] uppercase tracking-wide text-[#636366]">
              <th className="px-3 py-2 font-bold">Week</th>
              {Array.from({ length: sessionCount }, (_, i) => (
                <th key={i} className="px-3 py-2 font-bold">
                  Workout {i + 1}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {weeks.map(([week, sessions]) => (
            <tr key={week} className="border-b border-[#2A2D35] last:border-0">
              <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-[#8E8E93]">
                Week {week}
              </td>
              {Array.from({ length: sessionCount }, (_, i) => (
                <td key={i} className="px-3 py-2.5 font-medium text-white">
                  {describePrescription(sessions.get(i + 1))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegacyProgressionTable({ exercise }: { exercise: ProjectedExercise }) {
  const source = [exercise.current, ...exercise.realistic].filter(Boolean) as WeekPoint[];
  if (!source.length) {
    return <p className="mt-3 text-xs text-[#636366]">No progression data yet</p>;
  }
  return (
    <div className="mt-3 space-y-1.5">
      {source.map((point, index) => (
        <div
          key={`${point.week}-${index}`}
          className="flex items-center justify-between rounded-lg bg-[#111319] px-3 py-2 text-xs"
        >
          <span className="font-semibold text-[#8E8E93]">
            {index === 0
              ? exercise.seeded_from_history
                ? "Last logged"
                : "Starting estimate"
              : `Week ${point.week || index}`}
          </span>
          <span className="font-medium text-white">{formatTarget(point)}</span>
        </div>
      ))}
    </div>
  );
}

function HistoryStrip({ exercise, role }: { exercise: ProjectedExercise; role: LiftRole }) {
  const sessions = exercise.recent_sessions || [];
  const values = sessions
    .slice()
    .reverse()
    .map((s) =>
      Math.max(
        ...(s.sets || []).map((set) => (set.weight || 0) * (1 + (set.reps || 0) / 30)),
        0
      )
    )
    .filter(Boolean);
  return (
    <div className="flex items-center gap-4 border-t border-[#2A2D35] bg-[#111319] px-5 py-3.5 sm:px-6">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#636366]">
          Recent sessions
        </p>
        <p className="mt-0.5 truncate text-xs text-[#8E8E93]">
          {sessions.length
            ? `${sessions.length} sessions · ${trendLabel(values, role)}`
            : "Log a session to start your history line"}
        </p>
      </div>
      <MiniLine values={values} flat={role === "maintaining" || role === "support"} />
    </div>
  );
}

function MiniLine({ values, flat }: { values: number[]; flat: boolean }) {
  if (values.length < 2) return <div className="h-7 w-24" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * 94 + 1},${flat ? 14 : 25 - ((v - min) / span) * 20}`
    )
    .join(" ");
  return (
    <svg width="96" height="28" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={flat ? "#5EEAD4" : "#FF8A5C"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NutritionSection({ nutrition }: { nutrition: NutritionTrajectory }) {
  const weeks = nutrition.weeks || [];
  const caloriePoints = weeks
    .filter((w) => w.calories != null)
    .map((w) => ({ week: w.week, value: Number(w.calories) }));
  const bodyweightPoints = weeks
    .map((w) => ({
      week: w.week,
      value: w.bodyweight ?? w.expected_weight_lb ?? null,
    }))
    .filter((p): p is { week: number; value: number } => p.value != null);

  const calorieSeries: Series[] =
    caloriePoints.length > 1
      ? [
          {
            id: "calories",
            label: "Daily calories",
            color: SERIES_COLORS.primary,
            points: caloriePoints,
          },
        ]
      : [];

  const bodyweightSeries: Series[] =
    bodyweightPoints.length > 1
      ? [
          {
            id: "bodyweight",
            label: "Bodyweight",
            color: SERIES_COLORS.secondary,
            points: bodyweightPoints,
          },
        ]
      : [];

  const maintenance =
    nutrition.maintenance_calories ??
    weeks.find((w) => w.maintenance_calories != null)?.maintenance_calories ??
    null;

  if (!calorieSeries.length && !bodyweightSeries.length) return null;

  return (
    <section className="mt-10 space-y-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#5EEAD4]">
          Nutrition trajectory
        </p>
        <h2 className="mt-1 text-xl font-bold">Fuel the plan</h2>
        <p className="mt-1 text-sm text-[#8E8E93]">
          {nutrition.rationale ||
            "Week-by-week calories and bodyweight so training and fueling move together."}
        </p>
      </div>

      {nutrition.warnings?.map((warning, i) => (
        <p
          key={i}
          className="flex items-start gap-2 rounded-xl border border-[#E2622B]/40 bg-[#E2622B]/10 px-3 py-2.5 text-xs leading-relaxed text-[#F5B99B]"
        >
          <MdWarningAmber size={15} className="mt-0.5 flex-shrink-0" />
          {warning}
        </p>
      ))}

      {calorieSeries.length > 0 ? (
        <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366]">
              Calories
            </p>
            <ChartLegend series={calorieSeries} />
          </div>
          <ProjectionChart
            series={calorieSeries}
            height={150}
            formatValue={(v) => `${Math.round(v)}`}
            ariaLabel="Daily calorie target by week"
            reference={
              maintenance != null
                ? { value: maintenance, label: "maintenance" }
                : undefined
            }
          />
        </div>
      ) : null}

      {bodyweightSeries.length > 0 ? (
        <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366]">
              Bodyweight
            </p>
            <ChartLegend series={bodyweightSeries} />
          </div>
          <ProjectionChart
            series={bodyweightSeries}
            height={150}
            formatValue={(v) => `${Math.round(v)} lb`}
            ariaLabel="Projected bodyweight by week"
          />
        </div>
      ) : null}
    </section>
  );
}

// --- helpers ---------------------------------------------------------------

function historyPoints(exercise: ProjectedExercise): HistoryPoint[] {
  const sessions = (exercise.recent_sessions || []).filter(
    (session) => session.date && !String(session.date).startsWith("week-")
  );
  const points: HistoryPoint[] = [];

  for (const session of sessions) {
    const date = String(session.date);
    const sets = (session.sets || [])
      .filter((set) => set.completed !== false && (set.reps || 0) > 0)
      .map((set) => ({ weight: set.weight || 0, reps: set.reps || 0 }));
    const loaded = sets.filter((set) => set.weight > 0);
    const fallback = session.top_set;
    const pool =
      loaded.length > 0
        ? loaded
        : sets.length > 0
          ? sets
          : fallback && (fallback.reps || 0) > 0
            ? [{ weight: fallback.weight || 0, reps: fallback.reps || 0 }]
            : [];
    if (!pool.length) continue;

    const withLoad = pool.filter((set) => set.weight > 0);
    const top = withLoad.length
      ? withLoad.reduce((best, set) =>
          calcE1rm(set.weight, set.reps) > calcE1rm(best.weight, best.reps) ? set : best
        )
      : pool.reduce((best, set) => (set.reps > best.reps ? set : best));
    const e1rm = top.weight > 0 ? Math.round(calcE1rm(top.weight, top.reps)) : top.reps;
    if (!e1rm) continue;

    points.push({
      key: `${exercise.exercise_id}-${date}`,
      date,
      e1rm,
      sessionId: session.session_id,
      label:
        top.weight > 0
          ? `${top.weight} lb × ${top.reps} · ${e1rm} e1RM`
          : `${top.reps} reps`,
    });
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

function describePrescription(point?: WeekPoint) {
  if (!point) return "—";
  if (point.sets?.length) {
    return point.sets.map((set) => `${set.weight}×${set.reps}`).join(", ");
  }
  return formatTarget(point);
}

function resolveDestination(exercise: ProjectedExercise): {
  weight: number;
  reps: number;
  weeks?: number;
} | null {
  if (exercise.destination?.weight && exercise.destination?.reps) {
    return exercise.destination;
  }
  if (exercise.target_weight && exercise.target_reps) {
    return {
      weight: exercise.target_weight,
      reps: exercise.target_reps,
      weeks: exercise.target_weeks ?? undefined,
    };
  }
  return null;
}

function destinationAsWeekPoint(exercise: ProjectedExercise): WeekPoint | null {
  const dest = resolveDestination(exercise);
  if (!dest) return null;
  return {
    week: dest.weeks || exercise.realistic.length || PROJECTION_WEEKS,
    weight: dest.weight,
    reps: dest.reps,
    e1rm: calcE1rm(dest.weight, dest.reps),
  };
}

function calcE1rm(weight: number, reps: number) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

function roleFor(exercise: ProjectedExercise): LiftRole {
  const goal = (exercise.goal || "").toLowerCase();
  if (exercise.priority === "supporting") return "support";
  if (
    exercise.priority === "high" ||
    ["strength", "weight", "power", "hypertrophy", "build"].some((x) => goal.includes(x))
  ) {
    return "building";
  }
  return "maintaining";
}

function nextPoint(exercise: ProjectedExercise) {
  return exercise.realistic[0] || exercise.current;
}

function peakPoint(points: WeekPoint[]) {
  return points.reduce<WeekPoint | undefined>(
    (best, point) => (!best || point.e1rm > best.e1rm ? point : best),
    undefined
  );
}

function formatTarget(point?: WeekPoint | null) {
  return point ? `${point.weight} lb × ${point.reps}` : "Rep range";
}

function goalCopy(exercise: ProjectedExercise) {
  const dest = resolveDestination(exercise);
  if (dest) {
    const weeks = dest.weeks || exercise.realistic.length || PROJECTION_WEEKS;
    const reach = exercise.reachable === false ? " · stretch" : "";
    return `Goal · ${dest.weight} lb × ${dest.reps} by ${targetDate(weeks)}${reach}`;
  }
  const target = peakPoint(exercise.realistic);
  return exercise.goal
    ? `${titleCase(exercise.goal)} focus · building toward ${formatTarget(target)}`
    : `Building toward ${formatTarget(target)}`;
}

function targetDate(weeks: number) {
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shortDay(name: string) {
  return name.replace(/\s+(day|workout)$/i, "");
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
}

function trendLabel(values: number[], role: LiftRole) {
  if (role === "maintaining") return "holding steady by design";
  if (values.length < 2) return "building a baseline";
  const delta = values.at(-1)! - values[0];
  return delta > 1
    ? "moving up"
    : delta < -1
      ? "stall detected — ask your coach"
      : "holding this block";
}

function nextScheduled(dayName: string, schedule?: Record<string, string>) {
  if (!schedule) return "Not scheduled";
  const today = new Date();
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    const key = WEEKDAYS[(date.getDay() + 6) % 7];
    if (schedule[key] === dayName) {
      return offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : key;
    }
  }
  return "Not scheduled";
}

function PageMessage({ children }: { children: ReactNode }) {
  return <div className="p-8 text-sm text-[#8E8E93]">{children}</div>;
}

/** Ready for the structured coach-patch API; accepting is always explicit. */
export function PendingSuggestionCard({
  title,
  detail,
  onAccept,
  onDiscard,
}: {
  title: string;
  detail: string;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[#FF6B35]/40 bg-[#FF6B35]/[0.07] p-5">
      <div className="flex items-start gap-3">
        <MdAutoAwesome className="mt-0.5 text-[#FF8A5C]" />
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#FF8A5C]">
            Coach suggestion · pending
          </p>
          <p className="mt-1 font-bold">{title}</p>
          <p className="mt-1 text-sm text-[#B6B8BE]">{detail}</p>
          <p className="mt-2 flex items-center gap-1 text-xs text-[#8E8E93]">
            <MdInfoOutline /> Your current plan stays live until you accept.
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onDiscard}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-[#A4A7AE]"
        >
          <MdClose />
          Discard
        </button>
        <button
          onClick={onAccept}
          className="inline-flex items-center gap-1 rounded-lg bg-[#FF6B35] px-3 py-2 text-xs font-bold"
        >
          <MdCheck />
          Accept change
        </button>
      </div>
    </div>
  );
}
