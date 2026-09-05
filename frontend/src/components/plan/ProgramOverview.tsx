import { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { NutritionCompanion, PlanProjection } from "../../api/trainingPlan";
import { borderRadius, colors, spacing } from "../../theme";

export function MacroSummary({ value }: { value?: NutritionCompanion }) {
  if (!value) return null;
  return <View style={styles.card}>
    <Text style={styles.title}>{value.source === "nutrition_plan" ? "Your nutrition targets" : "Starting macro estimates"}</Text>
    {value.targets ? <View style={styles.row}>
      {Object.entries(value.targets).map(([name, amount]) => <View key={name} style={styles.macro}>
        <Text style={styles.title}>{Math.round(amount)}{name === "calories" ? " kcal" : " g"}</Text>
        <Text style={styles.muted}>{name}</Text>
      </View>)}
    </View> : <Text style={styles.body}>Complete: {value.missing_fields?.join(", ") || "individually agreed nutrition targets"}.</Text>}
    {value.goal ? <Text style={styles.muted}>Goal: {value.goal}</Text> : null}
    {value.guidelines.map((line, index) => <Text key={index} style={styles.body}>{line}</Text>)}
    {value.assumptions?.map((line, index) => <Text key={index} style={styles.muted}>{line}</Text>)}
  </View>;
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export default function ProgramOverview({ projection }: { projection: PlanProjection }) {
  const [week, setWeek] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const selectedWeek = Math.min(week, projection.weeks);
  const startWeek = projection.progress.current_week || 1;
  return <View>
    <MacroSummary value={projection.nutrition_companion} />
    <View style={styles.card}>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}>
        <Text style={styles.title}>{expanded ? "▾" : "▸"} Full weekly program · {projection.weeks} weeks ahead</Text>
        <Text style={styles.muted}>Every workout and exercise, in order</Text>
      </TouchableOpacity>
      {expanded ? <>
        <Text style={styles.body}>Future targets assume you complete the prescribed work. Your next workout adapts to performance and recovery.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {Array.from({ length: projection.weeks }, (_, i) => i + 1).map(value => <TouchableOpacity
            key={value} accessibilityRole="button" accessibilityState={{ selected: selectedWeek === value }}
            onPress={() => setWeek(value)} style={[styles.chip, selectedWeek === value && styles.selected]}>
            <Text style={styles.body}>Week {startWeek + value - 1}</Text>
          </TouchableOpacity>)}
        </ScrollView>
        {DAYS.map(weekday => {
          const name = projection.weekly_schedule?.[weekday] || "Rest";
          const day = projection.days.find(item => item.day_name === name);
          const occurrence = DAYS.slice(0, DAYS.indexOf(weekday) + 1)
            .filter(key => projection.weekly_schedule?.[key] === name).length;
          return <View key={weekday} style={styles.day}>
            <Text style={styles.title}>{weekday.charAt(0).toUpperCase() + weekday.slice(1)} · {name}</Text>
            {day?.day_type ? <Text style={styles.muted}>{day.day_type} · {day.day_goal || day.focus}</Text> : null}
            {day?.exercises.map((exercise, index) => {
              const target = exercise.schedule?.find(point => point.week === selectedWeek && (point.session || 1) === occurrence);
              const cardio = exercise.cardio_realistic?.find(point => point.week === selectedWeek);
              const range = exercise.target_rep_range;
              const base = `${exercise.sets || 3} sets × ${range ? range.join("–") : exercise.reps || 8} reps`;
              return <View key={`${exercise.exercise_id}-${index}`} style={styles.exercise}>
                <Text style={styles.body}>{index + 1}. {exercise.exercise_name}</Text>
                <Text style={styles.accent}>{cardio ? `${cardio.minutes} min` : target?.sets?.length && exercise.seeded_from_history
                  ? target.sets.map(set => `${set.weight} lb × ${set.reps}`).join(" · ") : base}</Text>
                {!exercise.seeded_from_history && !cardio ? <Text style={styles.muted}>Choose a manageable starting load; log a session to personalize progression.</Text> : null}
                {exercise.notes ? <Text style={styles.muted}>{exercise.notes}</Text> : null}
              </View>;
            })}
            {!day && name !== "Rest" ? <Text style={styles.body}>This workout needs to be filled with Coach.</Text> : null}
          </View>;
        })}
      </> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, gap: spacing.sm },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: "700" },
  body: { color: colors.textPrimary, fontSize: 13, lineHeight: 20 },
  muted: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  accent: { color: colors.accentPrimary, fontSize: 13, lineHeight: 20 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  macro: { minWidth: 100, paddingVertical: spacing.sm },
  chip: { padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.md },
  selected: { borderColor: colors.accentPrimary },
  day: { paddingVertical: spacing.sm, gap: 4, borderTopWidth: 1, borderTopColor: colors.border },
  exercise: { paddingVertical: 6, gap: 2 },
});
