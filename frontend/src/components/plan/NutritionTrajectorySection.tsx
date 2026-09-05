import { View, Text, StyleSheet, Dimensions } from "react-native";
import Svg, { Line, Polyline, Circle, Text as SvgText } from "react-native-svg";
import type { NutritionTrajectory } from "../../api/trainingPlan";
import { borderRadius, colors, spacing } from "../../theme";

/**
 * Chart marks — not brand accents. Same band as web ProjectionChart SERIES_COLORS.
 */
const MARK = {
  primary: "#0D9488",
  secondary: "#E2622B",
};

/**
 * Week-by-week nutrition from the projection API.
 * Two frames (calories, optional bodyweight) — never dual-axis.
 */
export default function NutritionTrajectorySection({
  nutrition,
}: {
  nutrition: NutritionTrajectory;
}) {
  const weeks = nutrition.weeks || [];
  if (!weeks.length) return null;

  const calPoints = weeks
    .filter((w) => w.calories != null)
    .map((w) => ({ week: w.week, value: Number(w.calories) }));
  const maint =
    nutrition.maintenance_calories ??
    weeks.find((w) => w.maintenance_calories != null)?.maintenance_calories;
  const bwPoints = weeks
    .filter((w) => w.expected_weight_lb != null || (w as { bodyweight?: number }).bodyweight != null)
    .map((w) => ({
      week: w.week,
      value: Number(
        w.expected_weight_lb ?? (w as { bodyweight?: number }).bodyweight
      ),
    }));

  if (!calPoints.length && !bwPoints.length) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>NUTRITION ROADMAP</Text>
      <Text style={styles.title}>{nutrition.plan_name || "Calorie & weight path"}</Text>
      {calPoints.length ? (
        <Frame
          label="Calories"
          points={calPoints}
          color={MARK.primary}
          reference={
            maint != null
              ? { value: Number(maint), label: "Maintenance" }
              : undefined
          }
          format={(v) => `${Math.round(v)}`}
        />
      ) : null}
      {bwPoints.length ? (
        <Frame
          label="Bodyweight"
          points={bwPoints}
          color={MARK.secondary}
          format={(v) => `${v.toFixed(1)} lb`}
        />
      ) : null}
      {(nutrition.warnings || []).slice(0, 2).map((w) => (
        <Text key={w} style={styles.warning}>
          {w}
        </Text>
      ))}
    </View>
  );
}

function Frame({
  label,
  points,
  color,
  reference,
  format,
}: {
  label: string;
  points: { week: number; value: number }[];
  color: string;
  reference?: { value: number; label: string };
  format: (v: number) => string;
}) {
  const width = Math.min(Dimensions.get("window").width - 48, 520);
  const height = 120;
  const padL = 36;
  const padR = 12;
  const padT = 10;
  const padB = 22;
  const values = points.map((p) => p.value);
  if (reference) values.push(reference.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  min -= span * 0.12;
  max += span * 0.12;
  const weeks = points.map((p) => p.week);
  const wMin = Math.min(...weeks);
  const wMax = Math.max(...weeks);
  const wSpan = Math.max(1, wMax - wMin);

  const xFor = (week: number) =>
    padL + ((week - wMin) / wSpan) * (width - padL - padR);
  const yFor = (value: number) =>
    padT + (1 - (value - min) / (max - min || 1)) * (height - padT - padB);

  const poly = points.map((p) => `${xFor(p.week)},${yFor(p.value)}`).join(" ");

  return (
    <View style={styles.frame}>
      <Text style={styles.frameLabel}>{label}</Text>
      <Svg width={width} height={height}>
        {[0.25, 0.5, 0.75].map((t) => {
          const y = padT + t * (height - padT - padB);
          return (
            <Line
              key={t}
              x1={padL}
              x2={width - padR}
              y1={y}
              y2={y}
              stroke={colors.border}
              strokeDasharray="3 4"
            />
          );
        })}
        {reference ? (
          <Line
            x1={padL}
            x2={width - padR}
            y1={yFor(reference.value)}
            y2={yFor(reference.value)}
            stroke={colors.textMuted}
            strokeDasharray="5 4"
          />
        ) : null}
        <Polyline
          points={poly}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((p) => (
          <Circle
            key={p.week}
            cx={xFor(p.week)}
            cy={yFor(p.value)}
            r={3}
            fill={color}
          />
        ))}
        <SvgText x={padL} y={height - 4} fill={colors.textMuted} fontSize={9}>
          W{wMin}
        </SvgText>
        <SvgText
          x={width - padR - 18}
          y={height - 4}
          fill={colors.textMuted}
          fontSize={9}
        >
          W{wMax}
        </SvgText>
        <SvgText x={2} y={yFor(max) + 3} fill={colors.textMuted} fontSize={8}>
          {format(max)}
        </SvgText>
        <SvgText x={2} y={yFor(min) + 3} fill={colors.textMuted} fontSize={8}>
          {format(min)}
        </SvgText>
      </Svg>
      {reference ? (
        <Text style={styles.refNote}>
          Dashed · {reference.label} ({format(reference.value)})
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
    gap: 10,
  },
  eyebrow: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
    color: colors.ai,
  },
  title: { fontSize: 16, fontWeight: "800", color: colors.textPrimary },
  frame: { gap: 4, marginTop: 4 },
  frameLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  refNote: { fontSize: 10, color: colors.textMuted },
  warning: { fontSize: 11, color: colors.textSecondary, lineHeight: 15 },
});
