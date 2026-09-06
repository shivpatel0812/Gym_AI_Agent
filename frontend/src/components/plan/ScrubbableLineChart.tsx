import { useMemo, useRef, useState } from "react";
import { PanResponder, View, Text, StyleSheet } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { colors, spacing, typography, weight } from "../../theme";
import { type ChartPoint, formatShortDate, trendColor } from "./chartUtils";

type Props = {
  points: ChartPoint[];
  height?: number;
  /** Line colour. Marks are coloured by trend, independently of this. */
  accent?: string;
  flat?: boolean;
  showAxis?: boolean;
  /** Dates under the plot (first / mid / last, or every point when few). */
  showDateAxis?: boolean;
  /**
   * `time` — space by calendar date (default, honest for layoffs).
   * `even` — equal gaps between sessions so the series reads dense.
   */
  spacing?: "time" | "even";
  /** Cap the gap between even-spaced points (px). Keeps short histories compact. */
  maxPointGap?: number;
  /** Unit suffix for the y-axis labels, e.g. "lb" or "reps". */
  unit?: string;
  /**
   * Draw one continuous polyline through every plotted point.
   * Default breaks the line across layoff/null markers so a gap reads as a gap.
   */
  connectGaps?: boolean;
  onScrub?: (point: ChartPoint | null) => void;
};

const PAD_X = 8;
const PAD_Y = 10;
const AXIS_H = 14;
/** Room for the y-axis value labels on the left. */
const GUTTER = 34;
/** Default max px between even-spaced session marks. */
const DEFAULT_MAX_POINT_GAP = 32;
/** Gridline positions as a fraction of plot height, top to bottom. */
const gridRatios = [0, 0.5, 1];

export default function ScrubbableLineChart({
  points,
  height = 110,
  accent = colors.accentPrimary,
  flat = false,
  showAxis = true,
  showDateAxis = false,
  spacing = "time",
  maxPointGap = DEFAULT_MAX_POINT_GAP,
  unit,
  connectGaps = false,
  onScrub,
}: Props) {
  // Nothing is drawn until the real width arrives, so the chart never paints
  // once at a guessed size and then jumps.
  const [width, setWidth] = useState<number | null>(null);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  const plotted = useMemo(
    () => points.filter((p) => p.value != null) as Array<ChartPoint & { value: number }>,
    [points]
  );

  const geometry = useMemo(() => {
    if (!plotted.length || !width) return null;
    const values = plotted.map((p) => p.value);
    const rawLo = Math.min(...values);
    const rawHi = Math.max(...values);
    // A flat series has no span to scale by, so pad it absolutely. Scaling by
    // a percentage collapsed to nothing at zero and pinned every point to the
    // top of the plot.
    const pad = rawHi - rawLo < 1e-6 ? Math.max(Math.abs(rawHi) * 0.1, 1) : 0;
    const lo = pad ? rawLo - pad : rawLo - (rawHi - rawLo) * (flat ? 0.2 : 0.12);
    const hi = pad ? rawHi + pad : rawHi + (rawHi - rawLo) * (flat ? 0.2 : 0.12);
    const span = Math.max(hi - lo, 1e-6);

    const left = PAD_X + (showAxis ? GUTTER : 0);
    const right = width - PAD_X;
    const innerW = Math.max(right - left, 1);
    const innerH = Math.max(height - PAD_Y * 2 - (showAxis ? AXIS_H : 0), 1);

    const slotOf = new Map<string, number>();
    plotted.forEach((p, i) => slotOf.set(p.key, i));

    let xFor: (point: ChartPoint, fallbackSlot: number) => number;
    if (spacing === "even") {
      // Equal steps, capped so a handful of sessions sits tight instead of
      // stretching across the full card width.
      const gaps = Math.max(plotted.length - 1, 1);
      const step = Math.min(innerW / gaps, maxPointGap);
      const used = step * gaps;
      const start = left + (innerW - used) / 2;
      xFor = (_point, fallbackSlot) => start + fallbackSlot * step;
    } else {
      // Time, not index — a three-month layoff should read longer than a week.
      const times = plotted.map((p) => p.t).filter((t) => !Number.isNaN(t));
      const t0 = times.length ? Math.min(...times) : 0;
      const t1 = times.length ? Math.max(...times) : 0;
      const tSpan = t1 - t0;
      xFor = (point, fallbackSlot) => {
        if (!tSpan || Number.isNaN(point.t)) {
          return left + (fallbackSlot / Math.max(plotted.length - 1, 1)) * innerW;
        }
        return left + ((point.t - t0) / tSpan) * innerW;
      };
    }

    const coords = points.map((point, index) => {
      if (point.value == null) return { index, x: null, y: null, point };
      const x = xFor(point, slotOf.get(point.key) ?? 0);
      const y = PAD_Y + innerH * (1 - (point.value - lo) / span);
      return { index, x, y, point };
    }) as Array<{ index: number; x: number | null; y: number | null; point: ChartPoint }>;

    const segments: string[] = [];
    if (connectGaps) {
      const joined = coords
        .filter((c) => c.x != null && c.y != null)
        .map((c) => `${c.x},${c.y}`)
        .join(" ");
      if (joined) segments.push(joined);
    } else {
      let current: string[] = [];
      for (const c of coords) {
        if (c.x == null || c.y == null) {
          if (current.length > 1) segments.push(current.join(" "));
          current = [];
          continue;
        }
        current.push(`${c.x},${c.y}`);
      }
      if (current.length > 1) segments.push(current.join(" "));
    }

    // Date ticks: every point when the series is short, otherwise ends + middle.
    const plottedCoords = coords.filter((c) => c.x != null && c.y != null);
    let dateTicks = plottedCoords;
    if (plottedCoords.length > 5) {
      const mid = Math.floor(plottedCoords.length / 2);
      dateTicks = [
        plottedCoords[0],
        plottedCoords[mid],
        plottedCoords[plottedCoords.length - 1],
      ];
    }

    return { coords, segments, left, right, innerW, innerH, lo, hi, dateTicks };
  }, [
    points,
    plotted,
    width,
    height,
    flat,
    showAxis,
    connectGaps,
    spacing,
    maxPointGap,
  ]);

  const scrubAtRef = useRef<(x: number) => void>(() => {});
  scrubAtRef.current = (x: number) => {
    if (!geometry) return;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const c of geometry.coords) {
      if (c.x == null) continue;
      const dist = Math.abs(c.x - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = c.index;
      }
    }
    if (best == null) return;
    setScrubIndex(best);
    onScrub?.(points[best] ?? null);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => scrubAtRef.current(e.nativeEvent.locationX),
      onPanResponderMove: (e) => scrubAtRef.current(e.nativeEvent.locationX),
      // Keep the selected session pinned after release so the set list stays
      // on screen — clearing on lift made every tap feel broken.
      onPanResponderRelease: () => {},
      onPanResponderTerminate: () => {},
    })
  ).current;

  const onLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };

  if (!plotted.length) {
    return (
      <View onLayout={onLayout}>
        <Text style={styles.empty}>
          {points.length
            ? "Sessions logged, but nothing comparable to chart yet."
            : "No sessions logged yet."}
        </Text>
      </View>
    );
  }

  if (!geometry || !width) return <View style={{ height }} onLayout={onLayout} />;

  const active = scrubIndex != null ? geometry.coords[scrubIndex] : null;
  const activePoint = active?.point;
  const round = (value: number) =>
    Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;

  return (
    <View>
      <View onLayout={onLayout} {...pan.panHandlers}>
        <Svg width={width} height={height}>
          {gridRatios.map((ratio) => (
            <Line
              key={`grid-${ratio}`}
              x1={geometry.left}
              x2={geometry.right}
              y1={PAD_Y + geometry.innerH * ratio}
              y2={PAD_Y + geometry.innerH * ratio}
              stroke={colors.borderCool}
              strokeDasharray="3 5"
            />
          ))}

          {showAxis
            ? gridRatios.map((ratio) => (
                <SvgText
                  key={`tick-${ratio}`}
                  x={PAD_X}
                  y={PAD_Y + geometry.innerH * ratio + 3}
                  fill={colors.textFaintCool}
                  fontSize={String(typography.micro)}
                >
                  {round(geometry.hi - (geometry.hi - geometry.lo) * ratio)}
                </SvgText>
              ))
            : null}

          {geometry.segments.map((segment, i) => (
            <Polyline
              key={i}
              points={segment}
              fill="none"
              stroke={flat ? colors.textMutedCool : accent}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {geometry.coords.map((c, i) => {
            if (c.x == null || c.y == null) return null;
            const selected = scrubIndex === i;
            const stroke = trendColor(c.point.trend);
            return (
              <Circle
                key={c.point.key}
                cx={c.x}
                cy={c.y}
                r={selected ? 7 : 4}
                fill={selected ? colors.textPrimary : stroke}
                stroke={selected ? stroke : "transparent"}
                strokeWidth={2}
              />
            );
          })}

          {active?.x != null ? (
            <Line
              x1={active.x}
              x2={active.x}
              y1={PAD_Y}
              y2={PAD_Y + geometry.innerH}
              stroke={colors.textMutedCool}
              strokeWidth={1}
            />
          ) : null}
        </Svg>
      </View>

      {showDateAxis ? (
        <View style={[styles.dateAxis, { height: 16 }]}>
          {geometry.dateTicks.map((tick) =>
            tick.x == null ? null : (
              <Text
                key={`date-${tick.point.key}`}
                style={[
                  styles.dateTick,
                  {
                    left: Math.max(0, tick.x - 22),
                    width: 44,
                  },
                ]}
                numberOfLines={1}
              >
                {formatShortDate(tick.point.date)}
              </Text>
            )
          )}
        </View>
      ) : showAxis ? (
        <View style={[styles.axis, { marginLeft: GUTTER }]}>
          <Text style={styles.axisText}>{formatShortDate(plotted[0].date)}</Text>
          <Text style={styles.axisText}>
            {formatShortDate(plotted[plotted.length - 1].date)}
          </Text>
        </View>
      ) : null}

      {activePoint?.value != null ? (
        <View style={styles.scrubBadge}>
          <Text style={styles.scrubDate}>{formatShortDate(activePoint.date)}</Text>
          <Text style={styles.scrubValue}>
            {activePoint.scrubText
              ? activePoint.scrubText
              : `${round(activePoint.value)}${unit ? ` ${unit}` : ""}${
                  activePoint.label ? ` · ${activePoint.label}` : ""
                }`}
          </Text>
        </View>
      ) : (
        <Text style={styles.hint}>Tap a point to see that session’s sets</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.textFaintCool, fontSize: typography.caption, marginTop: spacing.xs },
  axis: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xs,
    marginTop: 2,
  },
  axisText: { color: colors.textFaintCool, fontSize: typography.micro },
  dateAxis: {
    position: "relative",
    marginTop: 2,
    marginBottom: 2,
  },
  dateTick: {
    position: "absolute",
    top: 0,
    textAlign: "center",
    color: colors.textFaintCool,
    fontSize: typography.micro,
    fontWeight: weight.medium,
  },
  hint: { color: colors.textFaintCool, fontSize: typography.caption, marginTop: spacing.xs },
  scrubBadge: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderCool,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  scrubDate: {
    fontSize: typography.caption,
    fontWeight: weight.heavy,
    color: colors.textFaintCool,
  },
  scrubValue: {
    fontSize: typography.body,
    fontWeight: weight.bold,
    color: colors.textPrimary,
    marginTop: 2,
  },
});
