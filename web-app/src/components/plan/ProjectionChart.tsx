import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A small multi-series line chart over a week axis.
 *
 * Chart marks use their own palette rather than the UI accent colours: the
 * bright brand teal and orange sit well above the lightness band that reads
 * cleanly as a data mark on a dark surface, and glare when used as fills.
 * These steps are the same hues, validated for contrast and for colour-vision
 * separation against the #161A22 card surface.
 */
export const SERIES_COLORS = {
  primary: "#0D9488",
  secondary: "#E2622B",
} as const;

export interface Series {
  id: string;
  label: string;
  points: { week: number; value: number }[];
  color: string;
  /** Dashed marks carry identity without relying on colour alone. */
  dashed?: boolean;
}

interface ProjectionChartProps {
  series: Series[];
  height?: number;
  /** A horizontal rule with a label, e.g. estimated maintenance calories. */
  reference?: { value: number; label: string };
  formatValue?: (value: number) => string;
  /** Y axis starts at the data floor unless the zero baseline is meaningful. */
  zeroBaseline?: boolean;
  ariaLabel?: string;
}

const PAD = { top: 12, right: 12, bottom: 22, left: 40 };

export default function ProjectionChart({
  series,
  height = 160,
  reference,
  formatValue = (v) => `${Math.round(v)}`,
  zeroBaseline = false,
  ariaLabel,
}: ProjectionChartProps) {
  const [hoverWeek, setHoverWeek] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // The viewBox tracks the element's real pixel width so one unit is one pixel.
  // A fixed viewBox with the default preserveAspectRatio letterboxes the chart
  // inside a wider container, and stretching it instead would distort the axis
  // text along with the marks.
  const [width, setWidth] = useState(520);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured && measured > 0) setWidth(measured);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { weeks, yMin, yMax, xFor, yFor } = useMemo(() => {
    const allWeeks = Array.from(
      new Set(series.flatMap((s) => s.points.map((p) => p.week)))
    ).sort((a, b) => a - b);

    const values = series.flatMap((s) => s.points.map((p) => p.value));
    if (reference) values.push(reference.value);

    let min = values.length ? Math.min(...values) : 0;
    let max = values.length ? Math.max(...values) : 1;
    if (zeroBaseline) min = Math.min(0, min);
    // Breathing room so marks never touch the frame.
    const span = max - min || Math.abs(max) || 1;
    min -= span * 0.12;
    max += span * 0.12;

    const firstWeek = allWeeks[0] ?? 0;
    const lastWeek = allWeeks[allWeeks.length - 1] ?? 1;
    const weekSpan = lastWeek - firstWeek || 1;

    return {
      weeks: allWeeks,
      yMin: min,
      yMax: max,
      xFor: (week: number) =>
        PAD.left + ((week - firstWeek) / weekSpan) * (width - PAD.left - PAD.right),
      yFor: (value: number) =>
        PAD.top + (1 - (value - min) / (max - min || 1)) * (height - PAD.top - PAD.bottom),
    };
  }, [series, reference, height, zeroBaseline, width]);

  if (!series.length || !weeks.length) return null;

  const path = (s: Series) =>
    s.points
      .slice()
      .sort((a, b) => a.week - b.week)
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.week).toFixed(1)} ${yFor(p.value).toFixed(1)}`)
      .join(" ");

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const x = ratio * width;
    // Snap to the nearest week so the crosshair always lands on real data.
    let nearest = weeks[0];
    let bestDistance = Infinity;
    for (const week of weeks) {
      const distance = Math.abs(xFor(week) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = week;
      }
    }
    setHoverWeek(nearest);
  };

  const gridValues = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <div className="relative" ref={wrapRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverWeek(null)}
      >
        {/* Recessive grid — present enough to read a value against, quiet
            enough that the data stays the loudest thing in the frame. */}
        {gridValues.map((value, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={yFor(value)}
              y2={yFor(value)}
              stroke="#2A2D35"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={yFor(value) + 3}
              textAnchor="end"
              className="fill-[#636366]"
              style={{ fontSize: 9 }}
            >
              {formatValue(value)}
            </text>
          </g>
        ))}

        {reference && (
          <g>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={yFor(reference.value)}
              y2={yFor(reference.value)}
              stroke="#8E8E93"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={width - PAD.right}
              y={yFor(reference.value) - 4}
              textAnchor="end"
              className="fill-[#8E8E93]"
              style={{ fontSize: 9 }}
            >
              {reference.label}
            </text>
          </g>
        )}

        {series.map((s) => (
          <path
            key={s.id}
            d={path(s)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={s.dashed ? "5 4" : undefined}
          />
        ))}

        {hoverWeek !== null && (
          <line
            x1={xFor(hoverWeek)}
            x2={xFor(hoverWeek)}
            y1={PAD.top}
            y2={height - PAD.bottom}
            stroke="#8E8E93"
            strokeWidth={1}
          />
        )}

        {series.map((s) =>
          s.points
            .filter((p) => p.week === hoverWeek)
            .map((p) => (
              <circle
                key={`${s.id}-${p.week}`}
                cx={xFor(p.week)}
                cy={yFor(p.value)}
                r={4.5}
                fill={s.color}
                // A surface ring keeps overlapping marks readable.
                stroke="#161A22"
                strokeWidth={2}
              />
            ))
        )}

        {/* Week axis: ends plus the hovered point, rather than a label per
            tick, which would collide at this width. */}
        {[weeks[0], weeks[weeks.length - 1]].map((week) => (
          <text
            key={week}
            x={xFor(week)}
            y={height - 6}
            textAnchor={week === weeks[0] ? "start" : "end"}
            className="fill-[#636366]"
            style={{ fontSize: 9 }}
          >
            wk {week}
          </text>
        ))}
      </svg>

      {hoverWeek !== null && (
        <div
          className="pointer-events-none absolute top-0 rounded-lg border border-[#2A2D35] bg-[#0B0C10] px-2.5 py-1.5 shadow-lg"
          // Follows the crosshair rather than sitting in a corner, and flips to
          // the inside of whichever edge it is near so it never runs off.
          style={{
            left: Math.min(Math.max(xFor(hoverWeek) - 60, 0), Math.max(width - 140, 0)),
          }}
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#8E8E93]">
            Week {hoverWeek}
          </p>
          {series.map((s) => {
            const point = s.points.find((p) => p.week === hoverWeek);
            if (!point) return null;
            return (
              <p key={s.id} className="flex items-center gap-1.5 text-xs text-white">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-[#8E8E93]">{s.label}</span>
                <span className="font-semibold">{formatValue(point.value)}</span>
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Shared legend. Identity is never carried by colour alone. */
export function ChartLegend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {series.map((s) => (
        <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-[#8E8E93]">
          <svg width={16} height={6} aria-hidden="true">
            <line
              x1={0}
              x2={16}
              y1={3}
              y2={3}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
            />
          </svg>
          {s.label}
        </span>
      ))}
    </div>
  );
}
