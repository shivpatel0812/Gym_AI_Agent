/**
 * Dragging a logged food from one meal into another.
 *
 * Built on core `PanResponder` and `Animated` — the app has neither
 * react-native-gesture-handler nor reanimated, and a feature this small does
 * not justify adding a native dependency.
 *
 * Two decisions worth keeping:
 *
 * **The drag starts on a grip, not on the row.** A pan responder that claims
 * the touch anywhere on a row takes the gesture away from the ScrollView, so
 * the meal list stops scrolling wherever a food happens to be. A dedicated
 * handle is the same affordance iOS reorder lists use, and it leaves every
 * other pixel of the row scrollable and tappable.
 *
 * **The drop targets are a fixed tray, not the meal cards themselves.** Cards
 * move with the scroll, so hit-testing them means reconciling content offset
 * with page coordinates mid-gesture. The tray sits in screen space and is
 * mounted (invisible, `pointerEvents="none"`) before the drag starts, so its
 * zones are measured and correct on the first frame of movement.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, spacing, typography, weight, borderRadius, shadows } from "../../theme";
import { dropTargetAt, type DropZone } from "../../lib/mealTiming";

/** How far the finger travels before a press becomes a drag. */
const DRAG_SLOP = 6;

export interface MealTarget {
  id: string;
  label: string;
  icon: string;
}

interface DragState<T> {
  item: T;
  label: string;
  from: string;
}

/**
 * `panHandlersFor` arms a grip; `layer` is the floating chip and the drop
 * tray, rendered once near the root of the screen.
 */
export function useMealDrag<T>({
  meals,
  onDrop,
  onTapHandle,
}: {
  meals: MealTarget[];
  /** Fired once, on release over a meal other than the one dragged from. */
  onDrop: (item: T, mealId: string) => void;
  /** A press with no drag — the keyboard/assistive path to the same move. */
  onTapHandle?: (item: T, from: string) => void;
}) {
  const [drag, setDrag] = useState<DragState<T> | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const position = useRef(new Animated.ValueXY()).current;
  const zones = useRef<Record<string, DropZone>>({});
  const dragRef = useRef<DragState<T> | null>(null);
  const hoverRef = useRef<string | null>(null);
  const movedRef = useRef(false);

  const setHoverIfChanged = useCallback((next: string | null) => {
    if (hoverRef.current === next) return;
    hoverRef.current = next;
    setHover(next);
  }, []);

  const registerZone = useCallback((zone: DropZone) => {
    zones.current[zone.id] = zone;
  }, []);

  const begin = useCallback(
    (state: DragState<T>, x: number, y: number) => {
      movedRef.current = false;
      dragRef.current = state;
      position.setValue({ x, y });
    },
    [position]
  );

  const move = useCallback(
    (x: number, y: number, dx: number, dy: number) => {
      if (!dragRef.current) return;
      if (!movedRef.current && Math.hypot(dx, dy) < DRAG_SLOP) return;
      if (!movedRef.current) {
        movedRef.current = true;
        setDrag(dragRef.current);
      }
      position.setValue({ x, y });
      const targets = Object.values(zones.current);
      const hit = dropTargetAt(x, y, targets);
      setHoverIfChanged(hit && hit !== dragRef.current.from ? hit : null);
    },
    [position, setHoverIfChanged]
  );

  const end = useCallback(() => {
    const state = dragRef.current;
    const target = hoverRef.current;
    const dragged = movedRef.current;
    dragRef.current = null;
    movedRef.current = false;
    setHoverIfChanged(null);
    setDrag(null);
    if (!state) return;
    if (!dragged) {
      onTapHandle?.(state.item, state.from);
      return;
    }
    if (target && target !== state.from) onDrop(state.item, target);
  }, [onDrop, onTapHandle, setHoverIfChanged]);

  const cancel = useCallback(() => {
    dragRef.current = null;
    movedRef.current = false;
    setHoverIfChanged(null);
    setDrag(null);
  }, [setHoverIfChanged]);

  const controller = useMemo(
    () => ({ begin, move, end, cancel }),
    [begin, move, end, cancel]
  );

  const dragging = drag !== null;

  const layer = (
    <MealDragLayer
      meals={meals}
      dragging={dragging}
      draggingLabel={drag?.label ?? ""}
      from={drag?.from ?? null}
      hover={hover}
      position={position}
      onZone={registerZone}
    />
  );

  return { controller, dragging, layer };
}

export type MealDragController<T> = ReturnType<typeof useMealDrag<T>>["controller"];

/**
 * The grip. Press and drag to move the row; a press that never moves falls
 * through to `onTapHandle`, so the same move is reachable without a drag.
 */
export function MealDragHandle<T>({
  item,
  from,
  label,
  controller,
  active,
}: {
  item: T;
  /** Meal id the row currently sits in — a drop back here is a no-op. */
  from: string;
  /** What the floating chip shows while dragging. */
  label: string;
  controller: MealDragController<T>;
  active?: boolean;
}) {
  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim only what starts on the grip, so the ScrollView keeps every
        // other pixel of the row.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (_e, gesture) => {
          controller.begin({ item, label, from }, gesture.x0, gesture.y0);
        },
        onPanResponderMove: (_e, gesture) => {
          controller.move(gesture.moveX, gesture.moveY, gesture.dx, gesture.dy);
        },
        onPanResponderRelease: () => controller.end(),
        onPanResponderTerminate: () => controller.cancel(),
      }),
    [controller, item, from, label]
  );

  return (
    <View
      {...responder.panHandlers}
      hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={`Move ${label} to another meal`}
      accessibilityHint="Drag to a meal, or tap to pick one from a list"
      style={styles.handle}
    >
      <MaterialCommunityIcons
        name="drag-horizontal-variant"
        size={16}
        color={active ? colors.accentPrimary : colors.textFaintCool}
      />
    </View>
  );
}

function MealDragLayer({
  meals,
  dragging,
  draggingLabel,
  from,
  hover,
  position,
  onZone,
}: {
  meals: MealTarget[];
  dragging: boolean;
  draggingLabel: string;
  from: string | null;
  hover: string | null;
  position: Animated.ValueXY;
  onZone: (zone: DropZone) => void;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {dragging ? (
        <Animated.View
          style={[
            styles.chip,
            {
              transform: [
                // Offset so the chip sits above the finger rather than under it.
                { translateX: Animated.subtract(position.x, 70) },
                { translateY: Animated.subtract(position.y, 56) },
              ],
            },
          ]}
        >
          <MaterialCommunityIcons
            name="silverware-fork-knife"
            size={13}
            color={colors.onAccent}
          />
          <Text style={styles.chipText} numberOfLines={1}>
            {draggingLabel}
          </Text>
        </Animated.View>
      ) : null}

      <View style={[styles.tray, dragging && styles.trayOn]}>
        <Text style={styles.trayLabel}>
          {hover ? `Drop in ${meals.find((m) => m.id === hover)?.label}` : "Drop on a meal"}
        </Text>
        <View style={styles.trayRow}>
          {meals.map((meal) => {
            const isHover = hover === meal.id;
            const isSource = from === meal.id;
            return (
              <MealDropZone
                key={meal.id}
                meal={meal}
                isHover={isHover}
                isSource={isSource}
                onZone={onZone}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

function MealDropZone({
  meal,
  isHover,
  isSource,
  onZone,
}: {
  meal: MealTarget;
  isHover: boolean;
  isSource: boolean;
  onZone: (zone: DropZone) => void;
}) {
  const ref = useRef<View>(null);

  // Measured in window coordinates on layout — the tray is always mounted, so
  // this has run long before the first drag reaches it.
  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (!width || !height) return;
      onZone({ id: meal.id, x, y, width, height });
    });
  }, [meal.id, onZone]);

  return (
    <View
      ref={ref}
      onLayout={measure}
      style={[
        styles.zone,
        isSource && styles.zoneSource,
        isHover && styles.zoneHover,
      ]}
    >
      <Text style={styles.zoneIcon}>{meal.icon}</Text>
      <Text
        style={[styles.zoneLabel, isHover && styles.zoneLabelOn]}
        numberOfLines={1}
      >
        {meal.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  handle: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    maxWidth: 180,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.accentPrimary,
    ...shadows.large,
  },
  chipText: {
    color: colors.onAccent,
    fontSize: typography.caption,
    fontWeight: weight.bold,
    flexShrink: 1,
  },
  tray: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: Platform.OS === "ios" ? 96 : 80,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderCool,
    opacity: 0,
    ...shadows.large,
  },
  trayOn: { opacity: 1 },
  trayLabel: {
    color: colors.textMutedCool,
    fontSize: typography.micro,
    fontWeight: weight.bold,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  trayRow: { flexDirection: "row", gap: spacing.xs },
  zone: {
    flex: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSunken,
  },
  zoneSource: { opacity: 0.35 },
  zoneHover: {
    borderColor: colors.accentPrimary,
    backgroundColor: colors.cardBackground,
  },
  zoneIcon: { fontSize: typography.body },
  zoneLabel: {
    color: colors.textMutedCool,
    fontSize: typography.micro,
    fontWeight: weight.medium,
  },
  zoneLabelOn: { color: colors.accentPrimary },
});
