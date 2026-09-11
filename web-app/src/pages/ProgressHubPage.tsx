import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MdAdd,
  MdArrowDownward,
  MdArrowUpward,
  MdCameraAlt,
  MdCloudOff,
  MdEmojiEvents,
  MdErrorOutline,
  MdEventAvailable,
  MdRemove,
  MdSchedule,
  MdTrendingDown,
  MdTrendingFlat,
  MdTrendingUp,
} from "react-icons/md";
import GoalsSection from "../components/progress/GoalsSection";
import IndexChart from "../components/progress/IndexChart";
import PhotoStrip from "../components/progress/PhotoStrip";
import { domainSeries, series } from "../lib/progressTheme";
import {
  getGoals,
  getPhotoHub,
  getProgressHub,
  getProgressProjection,
} from "../api/progress";
import type {
  Domain,
  ForwardProjection,
  Goal,
  IndexPoint,
  PhotoHub,
  Position,
  ProgressEvent,
  ProgressHub as Hub,
  ProgressState,
  ScanCompare,
  ScanRegionChange,
} from "../api/progress";

const RANGES = [
  { label: "2M", weeks: 8 },
  { label: "3M", weeks: 12 },
  { label: "6M", weeks: 26 },
  { label: "1Y", weeks: 52 },
];

const STATE_STYLE: Record<
  ProgressState,
  { color: string; Icon: typeof MdTrendingUp }
> = {
  building: { color: "#22C55E", Icon: MdTrendingUp },
  holding: { color: "#8E8E93", Icon: MdTrendingFlat },
  stalled: { color: "#F59E0B", Icon: MdRemove },
  declining: { color: "#EF4444", Icon: MdTrendingDown },
  unknown: { color: "#6B7280", Icon: MdSchedule },
};

const EVENT_ICON: Record<ProgressEvent["kind"], typeof MdEmojiEvents> = {
  pr: MdEmojiEvents,
  scan: MdCameraAlt,
  planned_low: MdEventAvailable,
  no_evidence: MdCloudOff,
};

const DOMAIN_ORDER = [
  "strength",
  "consistency",
  "nutrition",
  "body",
  "sleep",
  "hydration",
  "stress",
  "activity",
] as const;

function fmt(value: number | null | undefined, digits = 0) {
  return value == null ? "—" : value.toFixed(digits);
}

function signed(value: number | null | undefined, digits = 1) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export default function ProgressHubPage() {
  const [weeks, setWeeks] = useState(12);
  const [hub, setHub] = useState<Hub | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [projection, setProjection] = useState<ForwardProjection | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [photos, setPhotos] = useState<PhotoHub | null>(null);

  const load = useCallback(async (nextWeeks: number) => {
    setLoading(true);
    setError(null);
    try {
      const [next, photoHub] = await Promise.all([
        getProgressHub(nextWeeks),
        getPhotoHub(nextWeeks).catch(() => null),
      ]);
      setHub(next);
      setGoals(next.goals ?? []);
      setPhotos(photoHub);
    } catch {
      setError("Could not load your progress.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(weeks);
  }, [load, weeks]);

  // Projection is laid over after hub render, once — fixed horizon, slow call.
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void getProgressProjection(8)
      .then(setProjection)
      .catch(() => setProjection(null));
  }, []);

  const selectedPoint = useMemo(() => {
    if (!hub || scrub == null) return null;
    return hub.series[scrub] ?? null;
  }, [hub, scrub]);

  const eventsForSelected = useMemo(() => {
    if (!hub || !selectedPoint) return [];
    return hub.events.filter((e) => e.week_start === selectedPoint.week_start);
  }, [hub, selectedPoint]);

  const stateStyle = hub ? STATE_STYLE[hub.index.state] : STATE_STYLE.unknown;
  const StateIcon = stateStyle.Icon;

  const positions: Position[] = useMemo(
    () =>
      hub?.domains.find((d) => d.key === "strength")?.detail.positions ?? [],
    [hub]
  );

  const refreshGoals = useCallback(() => {
    void getGoals()
      .then(setGoals)
      .catch(() => undefined);
  }, []);

  return (
    <div className="min-h-screen bg-[#0B0C10] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-4 text-xl font-bold text-white">Progress</h1>

        <div className="mb-6 flex flex-wrap gap-2">
          {RANGES.map((range) => {
            const active = range.weeks === weeks;
            return (
              <button
                key={range.label}
                type="button"
                onClick={() => {
                  setScrub(null);
                  setWeeks(range.weeks);
                }}
                className={`min-h-9 rounded-full px-4 text-xs font-bold ${
                  active
                    ? "bg-[#FF6B35] text-white"
                    : "bg-[#161A22] text-[#8E8E93] hover:text-white"
                }`}
                aria-pressed={active}
              >
                {range.label}
              </button>
            );
          })}
        </div>

        {loading && !hub ? (
          <div className="flex flex-col items-center gap-2 py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#FF6B35] border-t-transparent" />
            <p className="text-xs text-[#8E8E93]">
              Reading your last {weeks} weeks…
            </p>
          </div>
        ) : null}

        {error ? (
          <div
            className="mb-4 flex items-center gap-2 rounded-xl bg-[#161A22] p-4"
            role="alert"
          >
            <MdErrorOutline size={18} className="shrink-0 text-[#EF4444]" />
            <p className="flex-1 text-xs text-[#8E8E93]">{error}</p>
            <button
              type="button"
              onClick={() => void load(weeks)}
              className="text-xs font-bold text-[#FF6B35]"
            >
              Retry
            </button>
          </div>
        ) : null}

        {!loading && !error && !hub ? (
          <div className="rounded-xl bg-[#161A22] p-6 text-center">
            <p className="text-sm text-[#8E8E93]">
              No progress data yet. Log workouts and meals to build your index.
            </p>
            <button
              type="button"
              onClick={() => void load(weeks)}
              className="mt-3 text-xs font-bold text-[#FF6B35]"
            >
              Retry
            </button>
          </div>
        ) : null}

        {hub ? (
          <>
            <div className="mb-4">
              <p className="text-[10px] font-bold tracking-[1.4px] text-[#6B7280]">
                PROGRESS INDEX
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <p className="text-4xl font-extrabold text-white">
                  {selectedPoint
                    ? fmt(selectedPoint.level, 1)
                    : fmt(hub.index.level, 1)}
                </p>
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold"
                  style={{
                    borderColor: stateStyle.color,
                    color: stateStyle.color,
                  }}
                >
                  <StateIcon size={14} />
                  {hub.index.state_label}
                </span>
              </div>

              {selectedPoint ? (
                <p className="mt-1 text-xs text-[#8E8E93]">
                  Week of {selectedPoint.label}
                  {selectedPoint.planned_low ? " · planned light week" : ""}
                  {selectedPoint.level == null ? " · nothing logged" : ""}
                </p>
              ) : (
                <p className="mt-1 text-xs text-[#8E8E93]">
                  {signed(hub.index.week_delta)} this week
                  {hub.index.range_delta.value != null
                    ? ` · ${signed(hub.index.range_delta.value)} over ${hub.weeks} weeks`
                    : ""}
                  {hub.index.range_delta.drivers.length
                    ? ` · mostly ${hub.index.range_delta.drivers[0].label.toLowerCase()} ${signed(
                        hub.index.range_delta.drivers[0].change
                      )}`
                    : ""}
                </p>
              )}

              <p className="mt-2 text-sm leading-5 text-white">
                {hub.index.reason}
              </p>
            </div>

            <IndexChart
              points={hub.series}
              projection={projection}
              selected={scrub}
              onSelect={setScrub}
            />
            <p className="mb-4 mt-1 text-center text-[10px] text-[#6B7280]">
              {selectedPoint
                ? "Hover another point, or Clear below."
                : "Hover a point to see that week's numbers."}
            </p>

            {selectedPoint ? (
              <WeekDetailCard
                point={selectedPoint}
                domains={hub.domains}
                events={eventsForSelected}
                onClear={() => setScrub(null)}
              />
            ) : null}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Weeks logged"
                value={`${hub.coverage.weeks_with_data}/${hub.coverage.weeks_total}`}
              />
              <Stat
                label="Sessions"
                value={String(hub.coverage.sessions_logged)}
              />
              <Stat
                label="Food days"
                value={String(hub.coverage.days_food_logged)}
              />
              <Stat label="Weigh-ins" value={String(hub.coverage.weigh_ins)} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Sleep nights"
                value={String(hub.coverage.nights_sleep_logged ?? 0)}
              />
              <Stat
                label="Hydration"
                value={String(hub.coverage.days_hydration_logged ?? 0)}
              />
              <Stat
                label="Stress"
                value={String(hub.coverage.days_stress_logged ?? 0)}
              />
              <Stat
                label="Activity"
                value={String(hub.coverage.days_activity_logged ?? 0)}
              />
            </div>
            <p className="mt-2 text-[10px] leading-4 text-[#6B7280]">
              Coverage is shown, not scored. Domains you do not log stay out of
              the index until you have enough days — they never drag the number
              down as zeros.
            </p>

            {projection?.available && projection.assumption ? (
              <p className="mt-2 text-[10px] leading-4 text-[#6B7280]">
                {projection.assumption}
              </p>
            ) : null}

            <GoalsSection
              goals={goals}
              positions={positions}
              onChanged={refreshGoals}
            />

            <PhotoStrip hub={photos} />

            <ScanCompareCard compare={hub.scan_compare} />

            <h2 className="mb-2 mt-8 text-[10px] font-bold tracking-[1.4px] text-[#8E8E93]">
              DOMAINS
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {hub.domains.map((domain) => (
                <DomainCard key={domain.key} domain={domain} />
              ))}
            </div>

            <PositionsCard hub={hub} />

            {hub.events.length ? (
              <>
                <h2 className="mb-2 mt-8 text-[10px] font-bold tracking-[1.4px] text-[#8E8E93]">
                  WHAT HAPPENED
                </h2>
                {hub.events.slice(0, 8).map((event, i) => {
                  const Icon = EVENT_ICON[event.kind];
                  return (
                    <div
                      key={`${event.week_start}-${event.kind}-${i}`}
                      className="flex gap-2 py-2"
                    >
                      <Icon size={16} className="mt-0.5 shrink-0 text-[#8E8E93]" />
                      <div>
                        <p className="text-xs font-medium text-white">
                          {event.title}
                        </p>
                        <p className="mt-0.5 text-[10px] leading-4 text-[#6B7280]">
                          {event.detail}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : null}

            <p className="mt-8 text-center text-[10px] leading-4 text-[#6B7280]">
              Scoring {hub.formula_version} · relative to your own plan, not to
              anyone else.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#161A22] py-3 text-center">
      <p className="text-base font-bold text-white">{value}</p>
      <p className="mt-0.5 text-[10px] text-[#6B7280]">{label}</p>
    </div>
  );
}

function WeekDetailCard({
  point,
  domains,
  events,
  onClear,
}: {
  point: IndexPoint;
  domains: Domain[];
  events: ProgressEvent[];
  onClear: () => void;
}) {
  const labels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of domains) map[d.key] = d.label;
    return map;
  }, [domains]);

  const rows = DOMAIN_ORDER.map((key) => ({
    key,
    label: labels[key] ?? key,
    value: point.contributions?.[key] ?? null,
  })).filter((row) => labels[row.key] != null);

  return (
    <div className="mb-6 rounded-xl border border-[#2A2D35] bg-[#161A22] p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-[1.2px] text-[#6B7280]">
            WEEK OF
          </p>
          <p className="text-base font-bold text-white">{point.label}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-medium text-[#FF6B35]"
        >
          Clear
        </button>
      </div>

      <div className="mt-2 mb-2 flex items-end justify-between">
        <div>
          <p className="text-2xl font-extrabold text-white">
            {fmt(point.level, 1)}
          </p>
          <p className="text-[10px] text-[#8E8E93]">Index that week</p>
        </div>
        <div className="text-right">
          <p className="text-base font-bold text-white">
            {Math.round((point.confidence ?? 0) * 100)}%
          </p>
          <p className="text-[10px] text-[#8E8E93]">Coverage</p>
        </div>
      </div>

      {point.planned_low ? (
        <p className="mb-1 text-xs text-[#8E8E93]">Planned light week</p>
      ) : null}
      {point.level == null ? (
        <p className="mb-1 text-xs text-[#8E8E93]">Nothing logged this week</p>
      ) : null}
      {point.estimated && point.level != null ? (
        <p className="mb-1 text-xs text-[#8E8E93]">
          Estimate softening — thin coverage
        </p>
      ) : null}

      <p className="mb-1 mt-3 text-[10px] font-bold tracking-[1.2px] text-[#6B7280]">
        IN THIS NUMBER
      </p>
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex items-center justify-between border-t border-[#2A2D35] py-2"
        >
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{
                backgroundColor: domainSeries[row.key] ?? series.mark,
              }}
            />
            <span className="text-sm font-medium text-white">{row.label}</span>
          </div>
          <span className="text-base font-bold text-white">
            {fmt(row.value, 0)}
          </span>
        </div>
      ))}

      <p className="mb-1 mt-3 text-[10px] font-bold tracking-[1.2px] text-[#6B7280]">
        THAT WEEK
      </p>
      {events.length ? (
        events.map((event, i) => {
          const Icon = EVENT_ICON[event.kind];
          return (
            <div
              key={`${event.week_start}-${event.kind}-${i}`}
              className="flex gap-2 py-2"
            >
              <Icon size={16} className="mt-0.5 shrink-0 text-[#8E8E93]" />
              <div>
                <p className="text-xs font-medium text-white">{event.title}</p>
                <p className="mt-0.5 text-[10px] text-[#6B7280]">
                  {event.detail}
                </p>
              </div>
            </div>
          );
        })
      ) : (
        <p className="text-xs text-[#6B7280]">
          No PRs, scans, or flags that week.
        </p>
      )}
    </div>
  );
}

/** One domain, one colour, one sparkline — never share a plot frame. */
function DomainCard({ domain }: { domain: Domain }) {
  const color = domainSeries[domain.key] ?? series.mark;
  const values = domain.series
    .map((p) => p.level)
    .filter((v): v is number => v != null);
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 100;
  const pad = Math.max((hi - lo) * 0.25, 4);

  if (domain.unavailable_reason) {
    return (
      <div className="rounded-xl bg-[#161A22] p-4">
        <p className="text-base font-bold text-white">{domain.label}</p>
        <p className="mt-1 text-xs text-[#6B7280]">
          {domain.unavailable_reason}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-[#161A22] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: color }}
          />
          <p className="text-base font-bold text-white">{domain.label}</p>
        </div>
        <p className="text-2xl font-extrabold text-white">
          {fmt(domain.level, 0)}
        </p>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-[#8E8E93]">
        <span>
          {signed(domain.change)} over range
          {domain.estimated ? " · estimate softening" : ""}
        </span>
        <span>{Math.round(domain.coverage * 100)}% logged</span>
      </div>
      <DomainSpark
        levels={domain.series.map((p) => p.level)}
        color={color}
        min={lo - pad}
        max={hi + pad}
      />
      <p className="mt-1 text-xs leading-[17px] text-[#8E8E93]">
        {domainDetail(domain)}
      </p>
      {domain.lever ? (
        <p className="mt-2 text-xs text-[#FF6B35]">
          Biggest lever: {domain.lever.label}
          {domain.lever.value != null && domain.lever.target != null
            ? ` — ${Math.round(domain.lever.value)} vs ${Math.round(
                domain.lever.target
              )}${domain.lever.unit || ""}`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

function DomainSpark({
  levels,
  color,
  min,
  max,
}: {
  levels: (number | null)[];
  color: string;
  min: number;
  max: number;
}) {
  const w = 280;
  const h = 56;
  const span = Math.max(max - min, 1);
  const step = levels.length > 1 ? w / (levels.length - 1) : 0;
  const parts: string[] = [];
  let current: string[] = [];
  levels.forEach((level, i) => {
    if (level == null) {
      if (current.length > 1) parts.push(current.join(" "));
      current = [];
    } else {
      const x = step * i;
      const y = h * (1 - (level - min) / span);
      current.push(`${x},${y}`);
    }
  });
  if (current.length > 1) parts.push(current.join(" "));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-14 w-full" aria-hidden>
      {parts.map((pts, i) => (
        <polyline
          key={i}
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

const SCAN_DIRECTION: Record<
  string,
  { color: string; Icon: typeof MdArrowUpward }
> = {
  improved: { color: "#22C55E", Icon: MdArrowUpward },
  regressed: { color: "#EF4444", Icon: MdArrowDownward },
  unchanged: { color: "#8E8E93", Icon: MdRemove },
};

function ScanRow({ row }: { row: ScanRegionChange }) {
  const style = row.direction ? SCAN_DIRECTION[row.direction] : null;
  const Icon = style?.Icon;
  return (
    <div className="mt-2 flex items-center justify-between border-t border-[#2A2D35] py-2">
      <span className="text-sm font-medium text-white">{row.label}</span>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-[#6B7280]">{row.from ?? "—"}</span>
        {Icon ? (
          <Icon size={13} style={{ color: style!.color }} />
        ) : (
          <span className="text-[#6B7280]">→</span>
        )}
        <span
          className="font-bold"
          style={{ color: style?.color ?? "#8E8E93" }}
        >
          {row.to ?? "—"}
        </span>
      </div>
    </div>
  );
}

function ScanCompareCard({ compare }: { compare: ScanCompare | null }) {
  if (!compare) return null;
  if (!compare.available && compare.scan_count === 0) return null;

  if (!compare.available) {
    return (
      <>
        <h2 className="mb-2 mt-8 text-[10px] font-bold tracking-[1.4px] text-[#8E8E93]">
          BODY SCAN
        </h2>
        <div className="rounded-xl bg-[#161A22] p-4">
          <p className="text-xs text-[#6B7280]">{compare.reason}</p>
        </div>
      </>
    );
  }

  const moved = compare.changed ?? [];
  const posture = compare.posture ?? [];

  return (
    <>
      <h2 className="mb-2 mt-8 text-[10px] font-bold tracking-[1.4px] text-[#8E8E93]">
        BODY SCAN
      </h2>
      <div className="rounded-xl bg-[#161A22] p-4">
        <p className="text-xs text-[#8E8E93]">
          {compare.from_date} → {compare.to_date} · {compare.scan_count} scans
        </p>
        {moved.length ? (
          moved.map((row) => <ScanRow key={row.key} row={row} />)
        ) : (
          <p className="mt-2 text-xs text-[#6B7280]">
            No region changed enough to call between these two scans.
          </p>
        )}
        {posture.length ? (
          <>
            <p className="mt-3 text-[10px] font-bold tracking-[1.2px] text-[#6B7280]">
              POSTURE
            </p>
            {posture.map((row) => (
              <ScanRow key={row.key} row={row} />
            ))}
          </>
        ) : null}
        {compare.unread?.length ? (
          <p className="mt-2 text-[10px] text-[#6B7280]">
            Not readable in both scans: {compare.unread.join(", ")}.
          </p>
        ) : null}
        {compare.note ? (
          <p className="mt-2 text-[10px] leading-4 text-[#6B7280]">
            {compare.note}
          </p>
        ) : null}
      </div>
    </>
  );
}

function domainDetail(domain: Domain): string {
  const d = domain.detail;
  switch (domain.key) {
    case "strength":
      return `${d.tracked ?? 0} lift${d.tracked === 1 ? "" : "s"} tracked. 100 is where each one started.`;
    case "consistency":
      return `${d.sessions_last_week ?? 0} of ${fmt(d.expected_per_week)} sessions last week.`;
    case "nutrition":
      return `${d.days_logged_last_week ?? 0} days logged last week against ${
        d.calorie_target ?? "—"
      } kcal and ${d.protein_target ?? "—"}g protein.`;
    case "body":
      return d.latest_weight_lb
        ? `${d.latest_weight_lb} lb smoothed, ${signed(d.change_lb)} lb over range. 100 is your goal's expected pace.`
        : "Not enough weigh-ins to read a trend.";
    case "sleep":
    case "hydration":
    case "stress":
    case "activity":
      return d.target != null
        ? `${d.days_logged_last_week ?? 0} days last week · target ${d.target}${
            d.unit ? ` ${d.unit}` : ""
          } (${d.target_source === "declared" ? "your goal" : "your usual"}). 100 is hitting it.`
        : "Not enough logs yet.";
    default:
      return "";
  }
}

function PositionsCard({ hub }: { hub: Hub }) {
  const strength = hub.domains.find((d) => d.key === "strength");
  const positions = strength?.detail.positions ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  if (!positions.length) return null;

  return (
    <>
      <h2 className="mb-2 mt-8 text-[10px] font-bold tracking-[1.4px] text-[#8E8E93]">
        LIFTS
      </h2>
      <div className="rounded-xl bg-[#161A22] p-4">
        <p className="mb-1 text-xs leading-[17px] text-[#8E8E93]">
          Each lift is a position. The price is its peak estimated 1RM, which
          does not fall because of one bad session.
        </p>
        {positions.map((p) => {
          const open = openId === p.exercise_id;
          return (
            <div key={p.exercise_id}>
              <div className="mt-2 flex items-center border-t border-[#2A2D35] py-2">
                <div className="min-w-0 flex-1 pr-2">
                  <p className="truncate text-sm font-medium text-white">
                    {p.name}
                  </p>
                  <p className="mt-0.5 text-[10px] text-[#6B7280]">
                    {p.peak_e1rm} lb peak · {p.latest_e1rm} lb latest
                    {p.weeks_stale > 0
                      ? ` · ${p.weeks_stale}w since trained`
                      : ""}
                    {p.estimated ? " · softening" : ""}
                  </p>
                </div>
                <span
                  className="mr-2 text-sm font-bold tabular-nums"
                  style={{
                    color:
                      p.change_pct > 0
                        ? "#22C55E"
                        : p.change_pct < 0
                          ? "#EF4444"
                          : "#8E8E93",
                  }}
                >
                  {signed(p.change_pct)}%
                </span>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : p.exercise_id)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0F1115] text-[#FF6B35]"
                  aria-expanded={open}
                  aria-label={
                    open
                      ? `Hide records for ${p.name}`
                      : `Show records for ${p.name}`
                  }
                >
                  {open ? <MdRemove size={18} /> : <MdAdd size={18} />}
                </button>
              </div>
              {open ? <PositionRecords position={p} /> : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function PositionRecords({ position }: { position: Position }) {
  const history = position.history ?? [];
  if (!history.length) {
    return (
      <p className="mb-2 text-xs text-[#6B7280]">
        No weekly sets attached for this lift yet.
      </p>
    );
  }

  return (
    <div className="mb-2 space-y-1 rounded-lg bg-[#0F1115] p-3">
      <p className="mb-1 text-xs leading-[17px] text-[#8E8E93]">
        {position.peak_e1rm} peak ÷ {position.baseline_e1rm} baseline − 1 ={" "}
        {signed(position.change_pct)}%
      </p>
      {history.map((row) => {
        const tags = [
          row.is_baseline ? "baseline" : null,
          row.is_peak ? "peak" : null,
        ].filter(Boolean);
        return (
          <div
            key={row.week_start}
            className="flex items-center gap-2 py-1 text-xs"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-white">{row.label}</p>
              {tags.length ? (
                <p className="text-[10px] text-[#FF6B35]">{tags.join(" · ")}</p>
              ) : null}
            </div>
            <span className="tabular-nums text-[#8E8E93]">
              {fmt(row.weight, 1)} × {row.reps}
            </span>
            <span className="min-w-[4.5rem] text-right font-bold tabular-nums text-white">
              {fmt(row.e1rm, 1)} e1RM
            </span>
          </div>
        );
      })}
    </div>
  );
}
