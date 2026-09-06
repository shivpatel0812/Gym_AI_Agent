/**
 * THIS WEEK strip — Mon→Sun pills you can drag between days.
 *
 * Dropping on another day swaps the two assignments (so training days are never
 * lost). A press that never moves still selects the family, same as before.
 *
 * Built on core PanResponder like MealDrag — no gesture-handler dependency.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type View as ViewType,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { borderRadius, colors, spacing, typography, weight } from "../../theme";
import { dayFamilyKey, type DayFamily } from "./dayFamilies";
import {
  shortScheduleLabel,
  WEEK_STRIP,
} from "./weekSchedule";

export { swapScheduleDays } from "./weekSchedule";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DRAG_SLOP = 8;

type DayZone = { key: string; x: number; y: number; width: number; height: number };

function hitDay(x: number, y: number, zones: DayZone[]): string | null {
  let hit: string | null = null;
  for (const zone of zones) {
    if (x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height) {
      hit = zone.key;
    }
  }
  return hit;
}

export default function WeekScheduleStrip({
  schedule,
  families,
  saving,
  onSelectFamily,
  onSwapDays,
  onImport,
  onEdit,
}: {
  schedule: Record<string, string>;
  families: DayFamily<{ day_name: string }>[];
  saving?: boolean;
  onSelectFamily: (familyKey: string) => void;
  onSwapDays: (from: string, to: string) => void;
  onImport?: () => void;
  onEdit?: () => void;
}) {
  const todayKey = WEEKDAYS[new Date().getDay()].toLowerCase();
  const [draggingFrom, setDraggingFrom] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [dragLabel, setDragLabel] = useState("");

  const position = useRef(new Animated.ValueXY()).current;
  const zones = useRef<DayZone[]>([]);
  const dragFromRef = useRef<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const movedRef = useRef(false);
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;

  const setHoverIfChanged = useCallback((next: string | null) => {
    if (hoverRef.current === next) return;
    hoverRef.current = next;
    setHover(next);
  }, []);

  const registerZone = useCallback((zone: DayZone) => {
    const list = zones.current.filter((item) => item.key !== zone.key);
    list.push(zone);
    zones.current = list;
  }, []);

  const beginDrag = useCallback(
    (dayKey: string, label: string, x: number, y: number) => {
      movedRef.current = false;
      dragFromRef.current = dayKey;
      setDragLabel(label);
      position.setValue({ x, y });
    },
    [position]
  );

  const moveDrag = useCallback(
    (x: number, y: number, dx: number, dy: number) => {
      if (!dragFromRef.current) return;
      if (!movedRef.current && Math.hypot(dx, dy) < DRAG_SLOP) return;
      if (!movedRef.current) {
        movedRef.current = true;
        setDraggingFrom(dragFromRef.current);
      }
      position.setValue({ x, y });
      const hit = hitDay(x, y, zones.current);
      setHoverIfChanged(hit && hit !== dragFromRef.current ? hit : null);
    },
    [position, setHoverIfChanged]
  );

  const endDrag = useCallback(() => {
    const from = dragFromRef.current;
    const to = hoverRef.current;
    const dragged = movedRef.current;
    dragFromRef.current = null;
    movedRef.current = false;
    setHoverIfChanged(null);
    setDraggingFrom(null);

    if (!from) return;
    if (!dragged) {
      const assignment = scheduleRef.current[from] || "Rest";
      if (/^rest$/i.test(assignment.trim())) return;
      const familyKey = dayFamilyKey(assignment);
      if (families.some((item) => item.key === familyKey)) onSelectFamily(familyKey);
      return;
    }
    if (to && to !== from) onSwapDays(from, to);
  }, [families, onSelectFamily, onSwapDays, setHoverIfChanged]);

  const cancelDrag = useCallback(() => {
    dragFromRef.current = null;
    movedRef.current = false;
    setHoverIfChanged(null);
    setDraggingFrom(null);
  }, [setHoverIfChanged]);

  return (
    <View style={styles.weekStrip}>
      <View style={styles.weekStripHead}>
        <Text style={styles.weekStripEyebrow}>THIS WEEK</Text>
        <View style={styles.weekStripActions}>
          {saving ? <ActivityIndicator size="small" color={colors.accentPrimary} /> : null}
          {onImport ? (
            <TouchableOpacity
              style={styles.weekAction}
              onPress={onImport}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Import workout"
            >
              <MaterialCommunityIcons name="history" size={16} color={colors.accentPrimary} />
              <Text style={styles.weekActionText}>Import</Text>
            </TouchableOpacity>
          ) : null}
          {onEdit ? (
            <TouchableOpacity
              style={styles.weekAction}
              onPress={onEdit}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Edit plan"
            >
              <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.accentPrimary} />
              <Text style={styles.weekActionText}>Edit</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.weekDays}>
        {WEEK_STRIP.map(({ key, short }) => {
          const assignment = schedule[key] || "Rest";
          const isRest = /^rest$/i.test(assignment.trim());
          const isToday = key === todayKey;
          const isSource = draggingFrom === key;
          const isHover = hover === key;

          return (
            <DayColumn
              key={key}
              dayKey={key}
              short={short}
              label={shortScheduleLabel(assignment)}
              isRest={isRest}
              isToday={isToday}
              isSource={isSource}
              isHover={isHover}
              disabled={saving}
              onRegister={registerZone}
              onBegin={beginDrag}
              onMove={moveDrag}
              onEnd={endDrag}
              onCancel={cancelDrag}
            />
          );
        })}
      </View>

      <Text style={styles.hint}>Drag a pill onto another day to move it · tap to open</Text>

      {draggingFrom ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Animated.View
            style={[
              styles.floatChip,
              {
                transform: [
                  { translateX: Animated.subtract(position.x, 28) },
                  { translateY: Animated.subtract(position.y, 44) },
                ],
              },
            ]}
          >
            <Text style={styles.floatChipText} numberOfLines={1}>
              {dragLabel}
            </Text>
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}

function DayColumn({
  dayKey,
  short,
  label,
  isRest,
  isToday,
  isSource,
  isHover,
  disabled,
  onRegister,
  onBegin,
  onMove,
  onEnd,
  onCancel,
}: {
  dayKey: string;
  short: string;
  label: string;
  isRest: boolean;
  isToday: boolean;
  isSource: boolean;
  isHover: boolean;
  disabled?: boolean;
  onRegister: (zone: DayZone) => void;
  onBegin: (dayKey: string, label: string, x: number, y: number) => void;
  onMove: (x: number, y: number, dx: number, dy: number) => void;
  onEnd: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<ViewType>(null);

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (!width || !height) return;
      onRegister({ key: dayKey, x, y, width, height });
    });
  }, [dayKey, onRegister]);

  useEffect(() => {
    measure();
  }, [measure]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (_e, gesture) => {
          measure();
          onBegin(dayKey, label, gesture.x0, gesture.y0);
        },
        onPanResponderMove: (_e, gesture) => {
          onMove(gesture.moveX, gesture.moveY, gesture.dx, gesture.dy);
        },
        onPanResponderRelease: () => onEnd(),
        onPanResponderTerminate: () => onCancel(),
      }),
    [dayKey, disabled, label, measure, onBegin, onCancel, onEnd, onMove]
  );

  return (
    <View
      ref={ref}
      onLayout={measure}
      style={styles.weekDay}
      {...responder.panHandlers}
      accessibilityRole="button"
      accessibilityState={{ selected: isToday, disabled }}
      accessibilityLabel={`${short}, ${label}. Drag to another day to move.`}
    >
      <Text style={[styles.weekDayLabel, isToday && styles.weekDayLabelToday]}>{short}</Text>
      <View
        style={[
          styles.weekPill,
          isToday && !isSource && styles.weekPillActive,
          isRest && !isToday && !isHover && styles.weekPillRest,
          isSource && styles.weekPillSource,
          isHover && styles.weekPillHover,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.weekPillText,
            isToday && !isSource && styles.weekPillTextActive,
            isRest && !isToday && !isHover && styles.weekPillTextRest,
            isHover && styles.weekPillTextHover,
          ]}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  weekStrip: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  weekStripHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  weekStripEyebrow: {
    fontSize: typography.micro,
    fontWeight: weight.heavy,
    letterSpacing: 1.4,
    color: colors.textFaintCool,
  },
  weekStripActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  weekAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  weekActionText: {
    color: colors.accentPrimary,
    fontSize: typography.caption,
    fontWeight: weight.bold,
  },
  weekDays: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  weekDay: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
  },
  weekDayLabel: {
    fontSize: typography.caption,
    fontWeight: weight.medium,
    color: colors.textFaintCool,
  },
  weekDayLabelToday: {
    color: colors.textPrimary,
    fontWeight: weight.heavy,
  },
  weekPill: {
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    paddingHorizontal: 2,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    minHeight: 28,
    borderWidth: 1,
    borderColor: "transparent",
  },
  weekPillActive: {
    backgroundColor: colors.accentPrimary,
    borderColor: colors.accentPrimary,
  },
  weekPillRest: {
    backgroundColor: colors.surfaceSunken,
  },
  weekPillSource: {
    opacity: 0.35,
  },
  weekPillHover: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.accentPrimary,
  },
  weekPillText: {
    fontSize: typography.micro,
    fontWeight: weight.bold,
    color: colors.textMutedCool,
  },
  weekPillTextActive: {
    color: colors.onAccent,
  },
  weekPillTextRest: {
    color: colors.textFaintCool,
  },
  weekPillTextHover: {
    color: colors.accentPrimary,
  },
  hint: {
    fontSize: typography.caption,
    color: colors.textFaintCool,
    marginTop: 2,
  },
  floatChip: {
    position: "absolute",
    left: 0,
    top: 0,
    minWidth: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentPrimary,
    alignItems: "center",
  },
  floatChipText: {
    color: colors.onAccent,
    fontSize: typography.caption,
    fontWeight: weight.heavy,
  },
});
