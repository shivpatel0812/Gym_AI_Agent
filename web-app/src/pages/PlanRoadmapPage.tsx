import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MdArrowBackIosNew, MdArrowForwardIos, MdAutoAwesome, MdCheck, MdClose, MdEdit, MdInfoOutline, MdOutlineCalendarToday } from "react-icons/md";
import { getPlanProjection, type PlanProjection, type ProjectedDay, type ProjectedExercise, type WeekPoint } from "../api/trainingPlan";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
type LiftRole = "building" | "maintaining" | "support";

export default function PlanRoadmapPage() {
  const [projection, setProjection] = useState<PlanProjection | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getPlanProjection(12).then((value) => live && setProjection(value)).catch(() => live && setError("Could not load your plan hub.")).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);
  const days = projection?.days || [];
  const day = days[dayIndex] || days[0];
  if (loading) return <PageMessage>Loading your live plan…</PageMessage>;
  if (error) return <PageMessage>{error}</PageMessage>;
  if (!projection || !day) return <EmptyState />;
  const move = (delta: number) => setDayIndex((dayIndex + delta + days.length) % days.length);

  return <div className="mx-auto max-w-5xl px-4 pb-24 pt-5 sm:px-7 sm:pt-8">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#FF6B35]">Active training plan</p><h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Plan Hub</h1><p className="mt-2 text-sm text-[#8E8E93]">Today’s target, the road ahead, and the reason behind every lift.</p></div>
      <Link to="/chatbot" className="inline-flex items-center gap-2 rounded-xl border border-[#393C44] bg-[#161A22] px-4 py-2.5 text-sm font-semibold text-white hover:border-[#FF6B35]/60"><MdEdit size={16} /> Edit in Plan Mode</Link>
    </header>
    <nav className="mt-8 flex items-center gap-3" aria-label="Training days">
      <button onClick={() => move(-1)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#2A2D35] text-[#8E8E93] hover:text-white" aria-label="Previous training day"><MdArrowBackIosNew size={15} /></button>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto rounded-2xl bg-[#111319] p-1.5">{days.map((item, index) => <button key={item.day_name} onClick={() => setDayIndex(index)} className={`min-w-[110px] flex-1 rounded-xl px-4 py-2.5 text-sm font-bold transition ${index === dayIndex ? "bg-[#FF6B35] text-white shadow-lg shadow-[#FF6B35]/10" : "text-[#8E8E93] hover:text-white"}`}>{shortDay(item.day_name)}</button>)}</div>
      <button onClick={() => move(1)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#2A2D35] text-[#8E8E93] hover:text-white" aria-label="Next training day"><MdArrowForwardIos size={15} /></button>
    </nav>
    <DaySummary day={day} projection={projection} />
    <div className="mt-7 space-y-5">{day.exercises.map((exercise) => <FocusCard key={exercise.exercise_id} exercise={exercise} />)}</div>
    <div className="mt-8 rounded-2xl border border-dashed border-[#343740] px-5 py-4 text-sm text-[#8E8E93]"><span className="font-semibold text-white">Coach changes stay reviewable.</span> When the AI adjusts a next-session target, its suggestion appears here with Accept and Discard controls before your live plan changes.</div>
  </div>;
}

function EmptyState() { return <div className="mx-auto max-w-3xl p-6"><div className="rounded-3xl border border-[#2A2D35] bg-[#161A22] p-10 text-center"><MdAutoAwesome className="mx-auto text-[#FF6B35]" size={34} /><h1 className="mt-4 text-2xl font-bold">Your plan starts with a goal</h1><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#8E8E93]">Build a plan with your coach, then every lift’s next target and longer-term direction will live here.</p><Link to="/chatbot" className="mt-6 inline-flex rounded-xl bg-[#FF6B35] px-5 py-3 text-sm font-bold text-white">Start Plan Mode</Link></div></div>; }

function DaySummary({ day, projection }: { day: ProjectedDay; projection: PlanProjection }) {
  const lastDates = day.exercises.map((x) => x.last_trained).filter(Boolean) as string[];
  const last = lastDates.sort().at(-1);
  const counts = day.exercises.reduce((acc, ex) => { const role = roleFor(ex); if (role === "building") acc.building++; if (role === "maintaining") acc.maintaining++; return acc; }, { building: 0, maintaining: 0 });
  return <section className="mt-4 overflow-hidden rounded-2xl border border-[#2A2D35] bg-[#161A22]"><div className="border-b border-[#2A2D35] px-5 py-4"><p className="text-lg font-bold">{day.day_name}</p><p className="mt-0.5 text-xs text-[#8E8E93]">{day.day_goal || day.focus || "Your next session targets"}</p></div><div className="grid grid-cols-2 divide-x divide-y divide-[#2A2D35] sm:grid-cols-4 sm:divide-y-0"><SummaryMetric label="Last trained" value={last ? formatDate(last) : "No session yet"} /><SummaryMetric label="Next expected" value={nextScheduled(day.day_name, projection.weekly_schedule)} icon={<MdOutlineCalendarToday size={14} />} /><SummaryMetric label="Building" value={`${counts.building} lift${counts.building === 1 ? "" : "s"}`} accent /><SummaryMetric label="Maintaining" value={`${counts.maintaining} lift${counts.maintaining === 1 ? "" : "s"}`} /></div></section>;
}
function SummaryMetric({ label, value, accent, icon }: { label: string; value: string; accent?: boolean; icon?: ReactNode }) { return <div className="px-5 py-4"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#636366]">{label}</p><p className={`mt-1 flex items-center gap-1.5 text-sm font-bold ${accent ? "text-[#FF8A5C]" : "text-white"}`}>{icon}{value}</p></div>; }

function FocusCard({ exercise }: { exercise: ProjectedExercise }) {
  const role = roleFor(exercise);
  if (role === "support") return <AccessoryCard exercise={exercise} />;
  const current = exercise.current || exercise.realistic[0], target = peakPoint(exercise.realistic);
  const progress = current && target?.e1rm ? Math.min(100, Math.round((current.e1rm / target.e1rm) * 100)) : 0;
  return <article className="overflow-hidden rounded-3xl border border-[#2A2D35] bg-[#161A22]">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#2A2D35] px-5 py-5 sm:px-6"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold">{exercise.exercise_name}</h2><RoleBadge role={role} /></div><p className="mt-1 text-xs text-[#8E8E93]">{role === "building" ? goalCopy(exercise) : "Holding this number on purpose while it supports the rest of your plan."}</p></div><Link to="/chatbot" className="text-xs font-bold text-[#8E8E93] hover:text-[#FF8A5C]">Revise goal →</Link></div>
    <div className="grid gap-6 p-5 sm:grid-cols-[180px_1fr] sm:p-6"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366]">Next session</p><p className="mt-2 text-3xl font-bold tracking-tight">{formatTarget(nextPoint(exercise))}</p><p className="mt-1 text-xs text-[#8E8E93]">{exercise.sets || 3} working sets</p>{role === "building" && target && <div className="mt-5"><div className="flex justify-between text-[10px] font-bold uppercase tracking-wide text-[#636366]"><span>Goal progress</span><span>{progress}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#292C33]"><div className="h-full rounded-full bg-[#FF6B35]" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-xs font-semibold text-white">{formatTarget(target)} <span className="font-normal text-[#636366]">by {targetDate(exercise.realistic.length)}</span></p></div>}</div><div className="min-w-0"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366]">12-week trajectory</p><p className="text-[10px] text-[#636366]">Today is the bright point</p></div><Trajectory exercise={exercise} flat={role === "maintaining"} /></div></div>
    <HistoryStrip exercise={exercise} role={role} />
  </article>;
}

function AccessoryCard({ exercise }: { exercise: ProjectedExercise }) { const range = exercise.target_rep_range || [exercise.current?.reps || 10, exercise.current?.reps || 15]; return <article className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#2A2D35] bg-[#12141A] px-5 py-4 sm:px-6"><div><div className="flex items-center gap-2"><h2 className="font-bold">{exercise.exercise_name}</h2><RoleBadge role="support" /></div><p className="mt-1 text-xs text-[#8E8E93]">Supports your priority work — no progression chart needed.</p></div><div className="text-right"><p className="text-[10px] font-bold uppercase tracking-wide text-[#636366]">Target range</p><p className="mt-0.5 text-xl font-bold">{exercise.sets || 3} × {range[0]}–{range[1]}</p></div></article>; }
function RoleBadge({ role }: { role: LiftRole }) { const styles = role === "building" ? "bg-[#FF6B35]/15 text-[#FF8A5C]" : role === "maintaining" ? "bg-[#5EEAD4]/10 text-[#5EEAD4]" : "bg-[#2A2D35] text-[#A4A7AE]"; return <span className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.12em] ${styles}`}>{role === "support" ? "Support work" : role}</span>; }

function Trajectory({ exercise, flat }: { exercise: ProjectedExercise; flat: boolean }) {
  const points = useMemo(() => { const source = [exercise.current, ...exercise.realistic].filter(Boolean) as WeekPoint[]; const values = source.map((p) => flat ? source[0].e1rm : p.e1rm); const min = Math.min(...values) * .97, max = Math.max(...values) * 1.03, span = max - min || 1; return values.map((value, i) => ({ x: 10 + (i / Math.max(1, values.length - 1)) * 380, y: 88 - ((value - min) / span) * 70 })); }, [exercise, flat]);
  const path = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  return <svg viewBox="0 0 400 105" className="mt-3 h-[135px] w-full" role="img" aria-label={`Projected trajectory for ${exercise.exercise_name}`}>{[18, 53, 88].map((y) => <line key={y} x1="10" x2="390" y1={y} y2={y} stroke="#292C33" strokeDasharray="3 5" />)}<path d={path} fill="none" stroke={flat ? "#5EEAD4" : "#FF6B35"} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? 5 : 2.5} fill={i === 0 ? "#fff" : flat ? "#5EEAD4" : "#FF6B35"} />)}<text x="10" y="103" fill="#636366" fontSize="9">TODAY</text><text x="365" y="103" fill="#636366" fontSize="9">12 WK</text></svg>;
}
function HistoryStrip({ exercise, role }: { exercise: ProjectedExercise; role: LiftRole }) { const sessions = exercise.recent_sessions || []; const values = sessions.slice().reverse().map((s) => Math.max(...(s.sets || []).map((set) => (set.weight || 0) * (1 + (set.reps || 0) / 30)), 0)).filter(Boolean); return <div className="flex items-center gap-4 border-t border-[#2A2D35] bg-[#111319] px-5 py-3.5 sm:px-6"><div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#636366]">Recent sessions</p><p className="mt-0.5 truncate text-xs text-[#8E8E93]">{sessions.length ? `${sessions.length} sessions · ${trendLabel(values, role)}` : "Log a session to start your history line"}</p></div><MiniLine values={values} flat={role === "maintaining"} /></div>; }
function MiniLine({ values, flat }: { values: number[]; flat: boolean }) { if (values.length < 2) return <div className="h-7 w-24" />; const min = Math.min(...values), max = Math.max(...values), span = max - min || 1; const pts = values.map((v, i) => `${(i / (values.length - 1)) * 94 + 1},${flat ? 14 : 25 - ((v - min) / span) * 20}`).join(" "); return <svg width="96" height="28" aria-hidden="true"><polyline points={pts} fill="none" stroke={flat ? "#5EEAD4" : "#FF8A5C"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

function roleFor(exercise: ProjectedExercise): LiftRole { const goal = (exercise.goal || "").toLowerCase(); if (exercise.priority === "supporting") return "support"; if (exercise.priority === "high" || ["strength", "weight", "power", "hypertrophy", "build"].some((x) => goal.includes(x))) return "building"; return "maintaining"; }
function nextPoint(exercise: ProjectedExercise) { return exercise.realistic[0] || exercise.current; }
function peakPoint(points: WeekPoint[]) { return points.reduce<WeekPoint | undefined>((best, point) => !best || point.e1rm > best.e1rm ? point : best, undefined); }
function formatTarget(point?: WeekPoint | null) { return point ? `${point.weight} lb × ${point.reps}` : "Rep range"; }
function goalCopy(exercise: ProjectedExercise) { const target = peakPoint(exercise.realistic); return exercise.goal ? `${titleCase(exercise.goal)} focus · building toward ${formatTarget(target)}` : `Building toward ${formatTarget(target)}`; }
function targetDate(weeks: number) { const date = new Date(); date.setDate(date.getDate() + weeks * 7); return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function formatDate(value: string) { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function shortDay(name: string) { return name.replace(/\s+(day|workout)$/i, ""); }
function titleCase(value: string) { return value.replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase()); }
function trendLabel(values: number[], role: LiftRole) { if (role === "maintaining") return "holding steady by design"; if (values.length < 2) return "building a baseline"; const delta = values.at(-1)! - values[0]; return delta > 1 ? "moving up" : delta < -1 ? "stall detected — ask your coach" : "holding this block"; }
function nextScheduled(dayName: string, schedule?: Record<string, string>) { if (!schedule) return "Not scheduled"; const today = new Date(); for (let offset = 0; offset < 8; offset++) { const date = new Date(today); date.setDate(today.getDate() + offset); const key = WEEKDAYS[(date.getDay() + 6) % 7]; if (schedule[key] === dayName) return offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : key; } return "Not scheduled"; }
function PageMessage({ children }: { children: ReactNode }) { return <div className="p-8 text-sm text-[#8E8E93]">{children}</div>; }

/** Ready for the structured coach-patch API; accepting is always explicit. */
export function PendingSuggestionCard({ title, detail, onAccept, onDiscard }: { title: string; detail: string; onAccept: () => void; onDiscard: () => void }) { return <div className="rounded-2xl border border-[#FF6B35]/40 bg-[#FF6B35]/[0.07] p-5"><div className="flex items-start gap-3"><MdAutoAwesome className="mt-0.5 text-[#FF8A5C]" /><div className="flex-1"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#FF8A5C]">Coach suggestion · pending</p><p className="mt-1 font-bold">{title}</p><p className="mt-1 text-sm text-[#B6B8BE]">{detail}</p><p className="mt-2 flex items-center gap-1 text-xs text-[#8E8E93]"><MdInfoOutline /> Your current plan stays live until you accept.</p></div></div><div className="mt-4 flex justify-end gap-2"><button onClick={onDiscard} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-[#A4A7AE]"><MdClose />Discard</button><button onClick={onAccept} className="inline-flex items-center gap-1 rounded-lg bg-[#FF6B35] px-3 py-2 text-xs font-bold"><MdCheck />Accept change</button></div></div>; }
