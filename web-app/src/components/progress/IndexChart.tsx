import { useEffect, useMemo, useRef, useState } from "react";
import { series as seriesColors } from "../../lib/progressTheme";
import type { ForwardProjection, IndexPoint } from "../../api/progress";

/**
 * Index line + optional forward pair, with scrub/hover.
 *
 * Gaps (null level) break the polyline — never draw through unlogged weeks.
 * Best-case and realistic share series.projected (dashed); measured uses
 * series.mark. Scrub stops at today; selection persists after mouse-up.
 */

const PAD_X = 8;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;
const HEIGHT = 168;

export default function IndexChart({
  points,
  projection,
  selected,
  onSelect,
}: {
  points: IndexPoint[];
  projection?: ForwardProjection | null;
  selected: number | null;
  onSelect: (index: number | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(520);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured && measured > 0) setWidth(Math.round(measured));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const forward = useMemo(() => {
    if (!projection?.available) return null;
    const best = projection.best_case ?? [];
    const real = projection.realistic ?? [];
    if (!best.length && !real.length) return null;
    return { best, real, length: Math.max(best.length, real.length) };
  }, [projection]);

  const geometry = useMemo(() => {
    const measured = points
      .map((p) => p.level)
      .filter((v): v is number => v != null);
    if (!measured.length) return null;

    const projected = forward
      ? [...forward.best, ...forward.real].map((p) => p.level)
      : [];
    const all = [...measured, ...projected];
    const rawLo = Math.min(...all);
    const rawHi = Math.max(...all);
    const pad = Math.max((rawHi - rawLo) * 0.2, 3);
    const lo = rawLo - pad;
    const hi = rawHi + pad;
    const span = Math.max(hi - lo, 1);

    const innerW = Math.max(width - PAD_X * 2, 1);
    const innerH = Math.max(HEIGHT - PAD_TOP - PAD_BOTTOM, 1);
    const slots = points.length + (forward?.length ?? 0);
    const step = slots > 1 ? innerW / (slots - 1) : 0;
    const y = (value: number) => PAD_TOP + innerH * (1 - (value - lo) / span);

    const coords = points.map((p, i) => ({
      x: PAD_X + step * i,
      y: p.level == null ? null : y(p.level),
      point: p,
    }));

    const segments: string[] = [];
    let current: string[] = [];
    coords.forEach((c) => {
      if (c.y == null) {
        if (current.length > 1) segments.push(current.join(" "));
        current = [];
      } else {
        current.push(`${c.x},${c.y}`);
      }
    });
    if (current.length > 1) segments.push(current.join(" "));

    const lastMeasured = [...coords].reverse().find((c) => c.y != null);
    const forwardLine = (rows: { level: number }[]) => {
      if (!rows.length || !lastMeasured || lastMeasured.y == null) return "";
      const head = `${lastMeasured.x},${lastMeasured.y}`;
      const tail = rows.map(
        (p, i) => `${PAD_X + step * (points.length + i)},${y(p.level)}`
      );
      return [head, ...tail].join(" ");
    };

    return {
      coords,
      segments,
      step,
      lastMeasured,
      bestLine: forward ? forwardLine(forward.best) : "",
      realLine: forward ? forwardLine(forward.real) : "",
      dividerX: lastMeasured ? lastMeasured.x : null,
    };
  }, [points, width, forward]);

  function pick(clientX: number) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !points.length) return;
    const x = ((clientX - rect.left) / rect.width) * width;
    const innerW = Math.max(width - PAD_X * 2, 1);
    const slots = points.length + (forward?.length ?? 0);
    const step = slots > 1 ? innerW / (slots - 1) : 0;
    const idx = step > 0 ? Math.round((x - PAD_X) / step) : 0;
    onSelect(Math.max(0, Math.min(points.length - 1, idx)));
  }

  if (!geometry) {
    return (
      <div className="flex h-[168px] items-center justify-center px-8">
        <p className="text-center text-xs text-[#8E8E93]">
          No weeks scored yet. Log a few sessions and meals and the line starts
          here.
        </p>
      </div>
    );
  }

  const { coords, segments, step, bestLine, realLine, dividerX } = geometry;
  const active = selected != null ? coords[selected] : null;

  return (
    <div>
      <div
        ref={wrapRef}
        className="relative cursor-crosshair select-none"
        style={{ height: HEIGHT }}
        onMouseMove={(e) => pick(e.clientX)}
        onMouseDown={(e) => pick(e.clientX)}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) pick(t.clientX);
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t) pick(t.clientX);
        }}
        role="img"
        aria-label="Progress index over time"
      >
        <svg width={width} height={HEIGHT} className="block overflow-visible">
          {coords.map((c) =>
            c.point.planned_low || c.point.level == null ? (
              <rect
                key={`band-${c.point.week_start}`}
                x={c.x - step / 2}
                y={PAD_TOP - 6}
                width={Math.max(step, 6)}
                height={HEIGHT - PAD_TOP - PAD_BOTTOM + 12}
                fill={c.point.planned_low ? "#2A2D35" : "#0F1115"}
                opacity={c.point.planned_low ? 0.9 : 0.6}
              />
            ) : null
          )}

          <line
            x1={PAD_X}
            y1={HEIGHT - PAD_BOTTOM}
            x2={width - PAD_X}
            y2={HEIGHT - PAD_BOTTOM}
            stroke="#2A2D35"
            strokeWidth={1}
          />

          {bestLine || realLine ? (
            <line
              x1={dividerX ?? 0}
              y1={PAD_TOP - 6}
              x2={dividerX ?? 0}
              y2={HEIGHT - PAD_BOTTOM}
              stroke="#3A3F4A"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          ) : null}

          {bestLine ? (
            <polyline
              points={bestLine}
              fill="none"
              stroke={seriesColors.projected}
              strokeWidth={1.5}
              strokeDasharray="2 4"
              opacity={0.55}
              strokeLinecap="round"
            />
          ) : null}
          {realLine ? (
            <polyline
              points={realLine}
              fill="none"
              stroke={seriesColors.projected}
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinecap="round"
            />
          ) : null}

          {segments.map((seg, i) => (
            <polyline
              key={`seg-${i}`}
              points={seg}
              fill="none"
              stroke={seriesColors.mark}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {coords.map((c, i) =>
            c.y != null ? (
              <circle
                key={`dot-${c.point.week_start}`}
                cx={c.x}
                cy={c.y}
                r={selected === i ? 6 : 3.5}
                fill={seriesColors.mark}
                stroke="#161A22"
                strokeWidth={selected === i ? 2 : 1.5}
                opacity={selected == null || selected === i ? 1 : 0.45}
              />
            ) : null
          )}

          {active && active.y != null ? (
            <line
              x1={active.x}
              y1={PAD_TOP - 6}
              x2={active.x}
              y2={HEIGHT - PAD_BOTTOM}
              stroke="#3A3F4A"
              strokeWidth={1}
            />
          ) : null}
        </svg>

        <div
          className="pointer-events-none absolute bottom-0 left-2 right-2 flex justify-between"
          aria-hidden
        >
          <span className="text-[10px] font-bold text-[#8E8E93]">
            {points[0]?.label}
          </span>
          <span className="text-[10px] font-bold text-[#8E8E93]">
            {forward
              ? (
                  forward.real[forward.real.length - 1] ??
                  forward.best[forward.best.length - 1]
                )?.label
              : points[points.length - 1]?.label}
          </span>
        </div>
      </div>

      {forward ? (
        <div className="mt-1 flex flex-wrap gap-4">
          <LegendKey color={seriesColors.mark} label="Measured" />
          <LegendKey
            color={seriesColors.projected}
            label="If you keep this up"
            dashed
          />
          <LegendKey
            color={seriesColors.projected}
            label="Every target met"
            dashed
            faint
          />
        </div>
      ) : null}
    </div>
  );
}

function LegendKey({
  color,
  label,
  dashed,
  faint,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  faint?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <svg width={16} height={8} aria-hidden>
        <line
          x1={0}
          y1={4}
          x2={16}
          y2={4}
          stroke={color}
          strokeWidth={faint ? 1.5 : 2}
          strokeDasharray={dashed ? (faint ? "2 4" : "5 4") : undefined}
          opacity={faint ? 0.55 : 1}
        />
      </svg>
      <span className="text-[10px] text-[#8E8E93]">{label}</span>
    </div>
  );
}
