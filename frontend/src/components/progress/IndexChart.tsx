import { useMemo, useRef, useState } from "react";
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Line, Polyline, Rect } from "react-native-svg";
import { colors, series, spacing, typography, weight } from "../../theme";
import type { ForwardProjection, IndexPoint } from "../../api/progress";

/**
 * The index line, its forward pair, and a scrub layer.
 *
 * Weeks with no level are a gap rather than a straight segment across them:
 * drawing through a month the user did not log would assert progress that was
 * never measured.
 *
 * The forward lines are dashed and share one hue, because they are not two
 * different quantities — they are the same projection under two assumptions.
 * Best case is the thinner, fainter of the pair on purpose: the realistic line
 * is the one to read, and a lone confident forward line is the failure this
 * chart is built to avoid.
 *
 * Scrubbing is the whole interaction, and it stops at today. There is nothing
 * to ask about a week that has not happened.
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
  const [width, setWidth] = useState(320);
  const widthRef = useRef(width);
  widthRef.current = width;

  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next > 0 && next !== widthRef.current) setWidth(next);
  };

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
    // Measured and projected weeks share one axis and one step, so the forward
    // half is drawn at the same scale rather than compressed beside it.
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
      // Anchored on the last measured point so the pair grows out of the line
      // rather than appearing to float above a gap.
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

  const responder = useMemo(
    () =>
      PanResponder.create({
        // The chart lives inside a ScrollView. Claiming the gesture on touch
        // down would mean a vertical flick that happens to start on the chart
        // never scrolls the page, so the responder is only taken once the
        // movement is clearly horizontal.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 4,
        onPanResponderGrant: (e) => pick(e.nativeEvent.locationX),
        onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
        onPanResponderRelease: () => onSelect(null),
        onPanResponderTerminate: () => onSelect(null),
      }),
    [points.length, width, forward?.length]
  );

  function pick(x: number) {
    if (points.length < 2) return;
    const innerW = Math.max(widthRef.current - PAD_X * 2, 1);
    const slots = points.length + (forward?.length ?? 0);
    const step = slots > 1 ? innerW / (slots - 1) : 0;
    const idx = step > 0 ? Math.round((x - PAD_X) / step) : 0;
    // Clamped to the measured half — there is nothing to ask about a week that
    // has not happened.
    onSelect(Math.max(0, Math.min(points.length - 1, idx)));
  }

  if (!geometry) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          No weeks scored yet. Log a few sessions and meals and the line starts here.
        </Text>
      </View>
    );
  }

  const { coords, segments, step, lastMeasured, bestLine, realLine, dividerX } =
    geometry;
  const active = selected != null ? coords[selected] : null;

  return (
    <View>
      <View onLayout={onLayout} style={styles.wrap} {...responder.panHandlers}>
        <Svg width={width} height={HEIGHT}>
          {/* Weeks the plan asked to be light, and weeks with nothing logged,
              are shaded rather than scored — the chart says which is which. */}
          {coords.map((c) =>
            c.point.planned_low || c.point.level == null ? (
              <Rect
                key={`band-${c.point.week_start}`}
                x={c.x - step / 2}
                y={PAD_TOP - 6}
                width={Math.max(step, 6)}
                height={HEIGHT - PAD_TOP - PAD_BOTTOM + 12}
                fill={c.point.planned_low ? colors.borderCool : colors.surfaceSunken}
                opacity={c.point.planned_low ? 0.9 : 0.6}
              />
            ) : null
          )}

          <Line
            x1={PAD_X}
            y1={HEIGHT - PAD_BOTTOM}
            x2={width - PAD_X}
            y2={HEIGHT - PAD_BOTTOM}
            stroke={colors.borderCool}
            strokeWidth={1}
          />

          {bestLine || realLine ? (
            <Line
              x1={dividerX ?? 0}
              y1={PAD_TOP - 6}
              x2={dividerX ?? 0}
              y2={HEIGHT - PAD_BOTTOM}
              stroke={colors.borderCoolStrong}
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          ) : null}

          {bestLine ? (
            <Polyline
              points={bestLine}
              fill="none"
              stroke={series.projected}
              strokeWidth={1.5}
              strokeDasharray="2 4"
              opacity={0.55}
              strokeLinecap="round"
            />
          ) : null}
          {realLine ? (
            <Polyline
              points={realLine}
              fill="none"
              stroke={series.projected}
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinecap="round"
            />
          ) : null}

          {segments.map((seg, i) => (
            <Polyline
              key={`seg-${i}`}
              points={seg}
              fill="none"
              stroke={series.mark}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {active && active.y != null ? (
            <>
              <Line
                x1={active.x}
                y1={PAD_TOP - 6}
                x2={active.x}
                y2={HEIGHT - PAD_BOTTOM}
                stroke={colors.borderCoolStrong}
                strokeWidth={1}
              />
              <Circle
                cx={active.x}
                cy={active.y}
                r={6}
                fill={series.mark}
                stroke={colors.cardBackground}
                strokeWidth={2}
              />
            </>
          ) : lastMeasured && lastMeasured.y != null ? (
            <Circle
              cx={lastMeasured.x}
              cy={lastMeasured.y}
              r={5}
              fill={series.mark}
              stroke={colors.cardBackground}
              strokeWidth={2}
            />
          ) : null}
        </Svg>

        <View style={styles.ticks} pointerEvents="none">
          <Text style={styles.tick}>{points[0]?.label}</Text>
          <Text style={styles.tick}>
            {forward
              ? (forward.real[forward.real.length - 1] ??
                  forward.best[forward.best.length - 1])?.label
              : points[points.length - 1]?.label}
          </Text>
        </View>
      </View>

      {/* Three series means a legend is not optional. */}
      {forward ? (
        <View style={styles.legend}>
          <LegendKey color={series.mark} label="Measured" />
          <LegendKey color={series.projected} label="If you keep this up" dashed />
          <LegendKey color={series.projected} label="Every target met" dashed faint />
        </View>
      ) : null}
    </View>
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
    <View style={styles.legendItem}>
      <Svg width={16} height={8}>
        <Line
          x1={0}
          y1={4}
          x2={16}
          y2={4}
          stroke={color}
          strokeWidth={faint ? 1.5 : 2}
          strokeDasharray={dashed ? (faint ? "2 4" : "5 4") : undefined}
          opacity={faint ? 0.55 : 1}
        />
      </Svg>
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: HEIGHT },
  ticks: {
    position: "absolute",
    left: PAD_X,
    right: PAD_X,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tick: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    fontWeight: weight.bold,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  legendText: { color: colors.textFaintCool, fontSize: typography.micro },
  empty: {
    height: HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    color: colors.textFaintCool,
    fontSize: typography.caption,
    textAlign: "center",
    lineHeight: 18,
  },
});
