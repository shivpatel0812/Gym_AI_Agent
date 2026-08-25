import { useState } from "react";
import { View, Text, StyleSheet, LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";

export type SparkPoint = { label: string; value: number | null };

export default function Sparkline({
  points,
  color,
  height = 92,
  min,
  max,
  unit,
}: {
  points: SparkPoint[];
  color: string;
  height?: number;
  min?: number;
  max?: number;
  unit?: string;
}) {
  const [width, setWidth] = useState(280);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };

  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  if (!points.length || values.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>Not enough logs yet</Text>
      </View>
    );
  }

  const padX = 10;
  const padY = 12;
  const lo = min != null ? min : Math.min(...values);
  const hi = max != null ? max : Math.max(...values);
  const span = Math.max(hi - lo, 1);
  const innerW = Math.max(width - padX * 2, 1);
  const innerH = Math.max(height - padY * 2, 1);
  const n = Math.max(points.length - 1, 1);

  const coords = points.map((p, i) => {
    const x = padX + (innerW * i) / n;
    if (p.value == null) return { x, y: null as number | null };
    const y = padY + innerH * (1 - (p.value - lo) / span);
    return { x, y };
  });

  const poly = coords
    .filter((c) => c.y != null)
    .map((c) => `${c.x},${c.y}`)
    .join(" ");

  return (
    <View onLayout={onLayout} style={{ height }}>
      <Svg width={width} height={height}>
        <Line
          x1={padX}
          y1={height - padY}
          x2={width - padX}
          y2={height - padY}
          stroke="#1E2A38"
          strokeWidth={1}
        />
        {poly ? (
          <Polyline
            points={poly}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {coords.map((c, i) =>
          c.y == null ? null : (
            <Circle key={points[i].label + i} cx={c.x} cy={c.y} r={3.5} fill={color} />
          )
        )}
      </Svg>
      <View style={styles.labels} pointerEvents="none">
        {points.map((p, i) => (
          <Text
            key={p.label + i}
            style={[styles.tick, i === points.length - 1 && { color: "#fff" }]}
          >
            {p.label}
          </Text>
        ))}
      </View>
      {unit ? (
        <Text style={[styles.unit, { color }]}>
          {values[values.length - 1]}
          {unit}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", justifyContent: "center" },
  emptyText: { color: "#55647A", fontSize: 13 },
  labels: {
    position: "absolute",
    left: 4,
    right: 4,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tick: { color: "#55647A", fontSize: 9, fontWeight: "700" },
  unit: {
    position: "absolute",
    top: 0,
    right: 4,
    fontSize: 11,
    fontWeight: "700",
  },
});
