import { useMemo, useRef, useState } from "react";
import { PanResponder, View, Text, StyleSheet } from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import { colors } from "../../theme";
import {
  type ChartPoint,
  formatShortDate,
  trendColor,
} from "./chartUtils";

type Props = {
  points: ChartPoint[];
  height?: number;
  accent?: string;
  flat?: boolean;
  showAxis?: boolean;
  onScrub?: (point: ChartPoint | null) => void;
};

export default function ScrubbableLineChart({
  points,
  height = 110,
  accent = colors.accentPrimary,
  flat = false,
  showAxis = true,
  onScrub,
}: Props) {
  const [width, setWidth] = useState(280);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const plotted = useMemo(
    () => points.filter((p) => p.value != null) as Array<ChartPoint & { value: number }>,
    [points]
  );

  const geometry = useMemo(() => {
    if (!plotted.length) return null;
    const padX = 8;
    const padY = 10;
    const values = plotted.map((p) => p.value);
    const lo = flat ? Math.min(...values) * 0.98 : Math.min(...values) * 0.96;
    const hi = flat ? Math.max(...values) * 1.02 : Math.max(...values) * 1.04;
    const span = Math.max(hi - lo, 1);
    const innerW = Math.max(width - padX * 2, 1);
    const innerH = Math.max(height - padY * 2 - (showAxis ? 14 : 0), 1);

    const coords = points.map((point, index) => {
      if (point.value == null) return { index, x: null as number | null, y: null as number | null, point };
      const slot = plotted.findIndex((p) => p.key === point.key);
      const x = padX + (slot / Math.max(plotted.length - 1, 1)) * innerW;
      const y = padY + innerH * (1 - (point.value - lo) / span);
      return { index, x, y, point };
    });

    const segments: string[] = [];
    let current: string[] = [];
    for (const c of coords) {
      if (c.x == null || c.y == null) {
        if (current.length) {
          segments.push(current.join(" "));
          current = [];
        }
        continue;
      }
      current.push(`${c.x},${c.y}`);
    }
    if (current.length) segments.push(current.join(" "));

    return { coords, segments, padX, innerW, padY, innerH, lo, hi };
  }, [points, plotted, width, height, flat, showAxis]);

  const scrubAt = (x: number) => {
    if (!geometry || !plotted.length) return;
    const { padX, innerW } = geometry;
    const clamped = Math.max(padX, Math.min(padX + innerW, x));
    let best = 0;
    let bestDist = Infinity;
    geometry.coords.forEach((c, index) => {
      if (c.x == null) return;
      const dist = Math.abs(c.x - clamped);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    setScrubIndex(best);
    onScrub?.(points[best] ?? null);
  };

  const scrubAtRef = useRef(scrubAt);
  scrubAtRef.current = scrubAt;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => scrubAtRef.current(e.nativeEvent.locationX),
      onPanResponderMove: (e) => scrubAtRef.current(e.nativeEvent.locationX),
      onPanResponderRelease: () => {
        setScrubIndex(null);
        onScrub?.(null);
      },
      onPanResponderTerminate: () => {
        setScrubIndex(null);
        onScrub?.(null);
      },
    })
  ).current;

  if (!geometry || !plotted.length) {
    return (
      <Text style={styles.empty}>
        {points.length ? "Not enough logged sessions to chart yet." : "No sessions logged yet."}
      </Text>
    );
  }

  const active = scrubIndex != null ? geometry.coords[scrubIndex] : null;
  const activePoint = active?.point;

  return (
    <View>
      <View
        onLayout={(e) => {
          const next = Math.round(e.nativeEvent.layout.width);
          if (next > 0 && next !== width) setWidth(next);
        }}
        {...pan.panHandlers}
      >
        <Svg width={width} height={height}>
          {[0.25, 0.5, 0.75].map((ratio) => (
            <Line
              key={ratio}
              x1={8}
              x2={width - 8}
              y1={geometry.padY + geometry.innerH * ratio}
              y2={geometry.padY + geometry.innerH * ratio}
              stroke="#252529"
              strokeDasharray="3 5"
            />
          ))}

          {geometry.segments.map((segment, i) => (
            <Polyline
              key={i}
              points={segment}
              fill="none"
              stroke={flat ? colors.ai : accent}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {geometry.coords.map((c, i) => {
            if (c.x == null || c.y == null) return null;
            const selected = scrubIndex === i;
            const stroke = trendColor(c.point.trend, accent);
            return (
              <Circle
                key={c.point.key}
                cx={c.x}
                cy={c.y}
                r={selected ? 7 : 4}
                fill={selected ? "#fff" : stroke}
                stroke={selected ? stroke : "transparent"}
                strokeWidth={2}
              />
            );
          })}

          {active?.x != null && active.y != null ? (
            <Line
              x1={active.x}
              x2={active.x}
              y1={geometry.padY}
              y2={geometry.padY + geometry.innerH}
              stroke={colors.textMuted}
              strokeWidth={1}
            />
          ) : null}
        </Svg>
      </View>

      {showAxis ? (
        <View style={styles.axis}>
          <Text style={styles.axisText}>{formatShortDate(plotted[0].date)}</Text>
          <Text style={styles.axisText}>{formatShortDate(plotted[plotted.length - 1].date)}</Text>
        </View>
      ) : null}

      {activePoint?.value != null ? (
        <View style={styles.scrubBadge}>
          <Text style={styles.scrubDate}>{formatShortDate(activePoint.date)}</Text>
          <Text style={styles.scrubValue}>
            {Math.round(activePoint.value)}
            {activePoint.label ? ` · ${activePoint.label}` : ""}
          </Text>
        </View>
      ) : (
        <Text style={styles.hint}>Drag to inspect a logged session</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  axis: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginTop: 2,
  },
  axisText: { color: colors.textMuted, fontSize: 9 },
  hint: { color: colors.textMuted, fontSize: 10, marginTop: 4 },
  scrubBadge: {
    marginTop: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scrubDate: { fontSize: 10, fontWeight: "800", color: colors.textMuted },
  scrubValue: { fontSize: 12, fontWeight: "700", color: colors.textPrimary, marginTop: 2 },
});
