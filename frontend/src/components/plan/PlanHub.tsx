import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import ProgramOverview from "./ProgramOverview";
import Ring from "../nutrition/Ring";
import ReviseGoalSheet from "./ReviseGoalSheet";
import {
  acceptPlanSuggestions,
  dismissPlanSuggestions,
  getPlanProjection,
  getPlanSuggestions,
  type CardioWeekPoint,
  type MuscleGroupDay,
  type PendingPlanSuggestions,
  type PlanProjection,
  type ProjectedDay,
  type ProjectedExercise,
  type WeekPoint,
} from "../../api/trainingPlan";
import { borderRadius, colors, spacing } from "../../theme";
import HistoryStrip from "./HistoryStrip";
import MuscleGroupCharts from "./MuscleGroupChart";
import ScrubbableLineChart from "./ScrubbableLineChart";
import WorkoutDetailCallout from "./WorkoutDetailCallout";
import {
  buildExerciseChart,
  calcE1rm,
  getSessionRecords,
  parseDate,
  rawSessionsFor,
  sessionValue,
  trendColor,
  sessionsForPoint,
  type ChartPoint,
  type LoggedSession,
  type ProgressionMetric,
} from "./chartUtils";
import {
  groupDaysByFamily,
  variantCaption,
  type DayFamily,
} from "./dayFamilies";

type Role = "building" | "maintaining" | "support";
type DetailTab = "history" | "roadmap";
type SetFilter = "all" | number;
type DetailSelection =
  | { kind: "single"; exercise: ProjectedExercise }
  | { kind: "combined"; exercises: ProjectedExercise[]; label: string };

type SessionRecord = LoggedSession;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Roadmap horizon. The chart's right-hand axis label reads from this. */
const PROJECTION_WEEKS = 12;

export default function PlanHub({
  onEdit,
  onImport,
}: {
  onEdit?: (prompt: string) => void;
  onImport?: () => void;
}) {
  const [projection, setProjection] = useState<PlanProjection | null>(null);
  const [loading, setLoading] = useState(true);
  // A failed request and an empty plan are different facts. Collapsing both to
  // null told users who had just hit a 500 that they had not logged enough
  // data, which is both wrong and unactionable.
  const [loadError, setLoadError] = useState(false);
  const [dayIndex, setDayIndex] = useState(0);
  const [detail, setDetail] = useState<DetailSelection | null>(null);
  const [pending, setPending] = useState<PendingPlanSuggestions | null>(null);
  const [resolving, setResolving] = useState(false);

  const loadProjection = useCallback(
    () =>
      getPlanProjection()
        .then((next) => {
          setProjection(next);
          setLoadError(false);
        })
        .catch((error) => {
          console.error("Could not load the plan projection:", error);
          setProjection(null);
          setLoadError(true);
        }),
    []
  );
  const loadPending = useCallback(
    () => getPlanSuggestions().then(setPending).catch(() => setPending(null)),
    []
  );

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([loadProjection(), loadPending()]).finally(() => setLoading(false));
  }, [loadProjection, loadPending]);

  useEffect(() => {
    reload();
  }, [reload]);

  const resolveSuggestions = useCallback(
    async (accept: boolean) => {
      if (!pending) return;
      setResolving(true);
      try {
        if (accept) {
          await acceptPlanSuggestions(pending.suggestion.id);
          // Accepted targets change what the roadmap projects, so re-read it
          // rather than patching the chart from the response.
          await loadProjection();
        } else {
          await dismissPlanSuggestions(pending.suggestion.id);
        }
        await loadPending();
      } catch (error) {
        console.error("Could not resolve plan suggestions:", error);
        Alert.alert("Error", "Could not update those suggestions. Please try again.");
      } finally {
        setResolving(false);
      }
    },
    [pending, loadPending, loadProjection]
  );

  // Push A / Push B stay separate plan days (heavy vs volume), but the hub
  // pages by family so the user sees Push · Pull · Legs — not five tabs.
  const families = useMemo(
    () => groupDaysByFamily(projection?.days || []),
    [projection?.days]
  );

  useEffect(() => {
    if (dayIndex >= families.length && families.length > 0) {
      setDayIndex(0);
    }
  }, [dayIndex, families.length]);

  if (loading) return <ActivityIndicator style={styles.loader} color={colors.accentPrimary} />;

  if (loadError) {
    return (
      <View style={styles.errorBox}>
        <MaterialCommunityIcons name="cloud-off-outline" size={20} color={colors.textSecondary} />
        <Text style={styles.errorText}>
          Could not load your roadmap. This is a connection problem, not missing data —
          your logged sessions are safe.
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={reload}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!families.length) {
    return <Text style={styles.muted}>The roadmap will appear after your plan has enough exercise data.</Text>;
  }

  const family = families[dayIndex] || families[0];
  const move = (delta: number) =>
    setDayIndex((dayIndex + delta + families.length) % families.length);

  return (
    <View>
      <View style={styles.heroRow}>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>ACTIVE TRAINING PLAN</Text>
          <Text style={styles.title}>Plan Hub</Text>
          <Text style={styles.subtitle}>What to lift now—and what you’re building toward.</Text>
        </View>
        <View style={styles.heroActions}>
          <TouchableOpacity style={styles.editButton} onPress={onImport}>
            <MaterialCommunityIcons name="history" size={16} color={colors.accentPrimary} />
            <Text style={styles.editText}>Import</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => onEdit?.("I want to revise one exercise in my active plan. ")}
          >
            <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.accentPrimary} />
            <Text style={styles.editText}>Edit</Text>
          </TouchableOpacity>
        </View>
      </View>

      {pending ? (
        <PendingSuggestions
          pending={pending}
          busy={resolving}
          onAccept={() => resolveSuggestions(true)}
          onDiscard={() => resolveSuggestions(false)}
        />
      ) : null}

      {projection ? <ProgramOverview projection={projection} /> : null}

      <View style={styles.pager}>
        <TouchableOpacity onPress={() => move(-1)} style={styles.arrow}>
          <MaterialCommunityIcons name="chevron-left" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.tabs}>
          {families.map((item, i) => (
            <TouchableOpacity
              key={item.key}
              onPress={() => setDayIndex(i)}
              style={[styles.tab, i === dayIndex && styles.tabActive]}
            >
              <Text numberOfLines={1} style={[styles.tabText, i === dayIndex && styles.tabTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => move(1)} style={styles.arrow}>
          <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <FamilySummary
        family={family}
        schedule={projection?.weekly_schedule}
        muscleHistory={projection?.muscle_group_history}
      />

      <View style={styles.cards}>
        {family.days.map((variant) => {
          const caption = variantCaption(variant.day_name, family.key);
          const showVariant = family.days.length > 1;
          return (
            <View key={variant.day_name} style={styles.variantBlock}>
              {showVariant ? (
                <View style={styles.variantHead}>
                  <Text style={styles.variantTitle}>
                    {caption ? `Session ${caption}` : variant.day_name}
                  </Text>
                  {variant.day_goal || variant.focus ? (
                    <Text style={styles.variantFocus}>
                      {variant.day_goal || variant.focus}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {groupExercises(variant.exercises).map((group) =>
                group.length > 1 ? (
                  <CombinedExerciseSummary
                    key={`${variant.day_name}-${group[0].exercise_id}`}
                    exercises={group}
                    onPress={() =>
                      setDetail({
                        kind: "combined",
                        exercises: group,
                        label: (group.find((item) => item.priority === "high") || group[0]).exercise_name.replace(
                          /^weighted\s+/i,
                          ""
                        ),
                      })
                    }
                  />
                ) : (
                  <ExerciseSummary
                    key={`${variant.day_name}-${group[0].exercise_id}`}
                    exercise={group[0]}
                    onPress={() => setDetail({ kind: "single", exercise: group[0] })}
                  />
                )
              )}
            </View>
          );
        })}
      </View>

      {pending ? null : (
        <View style={styles.reviewNote}>
          <MaterialCommunityIcons name="shield-check-outline" size={18} color={colors.ai} />
          <Text style={styles.reviewText}>
            <Text style={styles.reviewStrong}>Coach changes stay reviewable. </Text>
            Target adjustments appear here for Accept or Discard before the live plan changes.
          </Text>
        </View>
      )}

      <ExerciseDetailModal
        detail={detail}
        onClose={() => setDetail(null)}
        onEdit={onEdit}
        onSaved={loadProjection}
      />
    </View>
  );
}

function FamilySummary({
  family,
  schedule,
  muscleHistory,
}: {
  family: DayFamily<ProjectedDay>;
  schedule?: Record<string, string>;
  muscleHistory?: Record<string, MuscleGroupDay[]>;
}) {
  const exercises = family.days.flatMap((day) => day.exercises);
  const dates = exercises.map((e) => e.last_trained).filter(Boolean).sort() as string[];
  const counts = exercises.reduce(
    (a, e) => {
      const role = roleFor(e);
      if (role === "building") a.building++;
      if (role === "maintaining") a.maintaining++;
      return a;
    },
    { building: 0, maintaining: 0 }
  );
  const focusBits = family.days
    .map((day) => day.day_goal || day.focus)
    .filter(Boolean);
  const focusLine =
    family.days.length > 1
      ? `${family.days.length} sessions · ${[...new Set(focusBits)].join(" · ") || "variants on this page"}`
      : focusBits[0] || family.label;

  return (
    <View style={styles.summary}>
      <View style={styles.daySummaryHead}>
        <Text style={styles.dayName}>{family.label}</Text>
        <Text style={styles.dayFocus}>{focusLine}</Text>
      </View>
      <View style={styles.metrics}>
        <Metric label="LAST TRAINED" value={dates.length ? formatDate(dates[dates.length - 1]) : "No session"} />
        <Metric
          label="NEXT EXPECTED"
          value={nextScheduledAny(
            family.days.map((day) => day.day_name),
            schedule
          )}
        />
        <Metric label="BUILDING" value={`${counts.building} lifts`} accent />
        <Metric label="MAINTAINING" value={`${counts.maintaining} lifts`} />
      </View>
      <MuscleGroupCharts exercises={exercises} history={muscleHistory} />
    </View>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, accent && styles.accent]}>{value}</Text>
    </View>
  );
}

/**
 * A cardio lift on a plan day.
 *
 * Cardio has no load and no rep band, so the lifting card had nothing to put
 * in it — before the projector understood cardio it rendered an empty shell
 * with no target and no chart. This shows the two things cardio actually has:
 * how long, and how hard.
 */
function CardioSummary({ exercise }: { exercise: ProjectedExercise }) {
  const next = exercise.cardio_realistic?.[0] || exercise.cardio_current;
  const target = (exercise.cardio_realistic || []).reduce<CardioWeekPoint | undefined>(
    (best, point) => (!best || point.minutes > best.minutes ? point : best),
    undefined
  );
  const isSport = exercise.cardio_modality === "sport";

  return (
    <View style={styles.accessory}>
      <View style={styles.accessoryCopy}>
        <View style={styles.nameRow}>
          <Text style={styles.exerciseName}>{exercise.exercise_name}</Text>
          <View style={[styles.roleBadge, styles.maintainBadge]}>
            <Text style={[styles.roleBadgeText, styles.maintainText]}>
              {isSport ? "SPORT" : "CARDIO"}
            </Text>
          </View>
        </View>
        <Text style={styles.roleCopy}>
          {target && next && target.minutes > next.minutes
            ? `Building toward ${target.minutes} min`
            : isSport
              ? "Play at a hard but repeatable effort."
              : "Holding this session length on purpose."}
        </Text>
      </View>
      <View>
        <Text style={[styles.label, { textAlign: "right" }]}>NEXT SESSION</Text>
        <Text style={styles.accessoryTarget}>
          {next ? `${next.minutes} min` : "—"}
          {next?.speed ? ` @ ${next.speed}` : ""}
        </Text>
        {next?.speed ? <Text style={styles.mutedSmall}>mph</Text> : null}
      </View>
    </View>
  );
}

function ExerciseSummary({
  exercise,
  onPress,
}: {
  exercise: ProjectedExercise;
  onPress: () => void;
}) {
  if (exercise.is_cardio) return <CardioSummary exercise={exercise} />;
  const role = roleFor(exercise);
  const target = destinationAsWeekPoint(exercise) || peak(exercise.realistic);
  const sessions = lastSessions(exercise, 2);
  const goalLine = summaryGoalLine(exercise, role, target);

  return (
    <View style={styles.summaryCard}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
        <View style={styles.summaryHead}>
          <View style={styles.cardTitleWrap}>
            <View style={styles.nameRow}>
              <Text style={styles.exerciseName}>{exercise.exercise_name}</Text>
              <RoleBadge role={role} />
            </View>
            <Text style={styles.goalLine}>{goalLine}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textMuted} />
        </View>
        <View style={styles.sessionLogs}>
          <Text style={styles.label}>LAST SESSIONS</Text>
          {sessions.length ? (
            sessions.map((session) => (
              <Text key={session.key} style={styles.sessionRow}>
                {session.label}
              </Text>
            ))
          ) : (
            <Text style={styles.mutedSmall}>No sessions logged yet</Text>
          )}
        </View>
      </TouchableOpacity>
      <HistoryStrip
        exercise={exercise}
        flat={role === "maintaining" || role === "support"}
      />
    </View>
  );
}

function CombinedExerciseSummary({
  exercises,
  onPress,
}: {
  exercises: ProjectedExercise[];
  onPress: () => void;
}) {
  const exercise = exercises.find((item) => item.priority === "high") || exercises[0];
  const displayName = exercise.exercise_name.replace(/^weighted\s+/i, "");
  const sessions = lastSessions(exercise, 2);

  return (
    <View style={styles.summaryCard}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
        <View style={styles.summaryHead}>
          <View style={styles.cardTitleWrap}>
            <View style={styles.nameRow}>
              <Text style={styles.exerciseName}>{displayName}</Text>
              <RoleBadge role="building" />
            </View>
            <Text style={styles.goalLine}>Dual track · weighted load + bodyweight reps</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textMuted} />
        </View>
        <View style={styles.sessionLogs}>
          <Text style={styles.label}>LAST SESSIONS</Text>
          {sessions.length ? (
            sessions.map((session) => (
              <Text key={session.key} style={styles.sessionRow}>
                {session.label}
              </Text>
            ))
          ) : (
            <Text style={styles.mutedSmall}>No sessions logged yet</Text>
          )}
        </View>
      </TouchableOpacity>
      <HistoryStrip exercise={exercise} />
    </View>
  );
}

function ExerciseDetailModal({
  detail,
  onClose,
  onEdit,
  onSaved,
}: {
  detail: DetailSelection | null;
  onClose: () => void;
  onEdit?: (prompt: string) => void;
  onSaved?: () => void;
}) {
  if (!detail) return null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>
                {detail.kind === "combined" ? detail.label : detail.exercise.exercise_name}
              </Text>
              <Text style={styles.modalSubtitle}>Progression & roadmap</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.modalClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            showsVerticalScrollIndicator
            bounces
          >
            {detail.kind === "combined" ? (
              <CombinedExerciseDetail exercises={detail.exercises} onEdit={onEdit} onClose={onClose} />
            ) : (
              <FocusExerciseDetail exercise={detail.exercise} onEdit={onEdit} onClose={onClose} onSaved={onSaved} />
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function FocusExerciseDetail({
  exercise,
  onEdit,
  onClose,
  onSaved,
}: {
  exercise: ProjectedExercise;
  onEdit?: (prompt: string) => void;
  onClose: () => void;
  /** Refetch the projection — a revised target changes the whole roadmap. */
  onSaved?: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("history");
  const role = roleFor(exercise);

  return (
    <>
      <DetailTabBar tab={tab} onChange={setTab} />
      {tab === "history" ? (
        <GoalHistoryTab exercise={exercise} role={role} onEdit={onEdit} onClose={onClose} onSaved={onSaved} />
      ) : (
        <RoadmapTab exercise={exercise} role={role} />
      )}
    </>
  );
}

function DetailTabBar({ tab, onChange }: { tab: DetailTab; onChange: (tab: DetailTab) => void }) {
  return (
    <View style={styles.detailTabBar}>
      {(
        [
          { id: "history" as const, label: "Goal and history" },
          { id: "roadmap" as const, label: "Roadmap" },
        ] as const
      ).map((item) => {
        const active = tab === item.id;
        return (
          <TouchableOpacity
            key={item.id}
            style={[styles.detailTab, active && styles.detailTabActive]}
            onPress={() => onChange(item.id)}
          >
            <Text style={[styles.detailTabText, active && styles.detailTabTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function GoalHistoryTab({
  exercise,
  role,
  onEdit,
  onClose,
  onSaved,
}: {
  exercise: ProjectedExercise;
  role: Role;
  onEdit?: (prompt: string) => void;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const sessions = useMemo(() => getSessionRecords(exercise), [exercise]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [setFilter, setSetFilter] = useState<SetFilter>("all");
  const chipScroll = useRef<ScrollView | null>(null);
  const navigation = useNavigation<any>();

  const target = destinationAsWeekPoint(exercise) || peak(exercise.realistic);
  const current = exercise.current || exercise.realistic[0];
  const progressPct = goalProgress(sessions, role, current, target);

  const selectedIndex = sessions.findIndex((s) => s.key === selectedKey);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : Math.max(0, sessions.length - 1);
  const selected = sessions[activeIndex];

  // Set numbers are the ones the user logged, so the filter offers those
  // rather than a count of whatever survived filtering.
  const setNumbers = useMemo(() => {
    const seen = new Set<number>();
    for (const session of sessions) {
      for (const set of session.sets) seen.add(set.setNumber);
    }
    return [...seen].sort((a, b) => a - b);
  }, [sessions]);
  const setFilters: SetFilter[] = ["all", ...setNumbers];

  const chart = useMemo(
    () =>
      buildExerciseChart(exercise, (session, metric) => {
        if (setFilter === "all") return sessionValue(session, metric);
        const set = session.sets.find((item) => item.setNumber === setFilter);
        // A session that never had this set number has nothing to plot here.
        // Returning 0 dropped the line to the floor and read as a total
        // failure rather than as an absent set.
        if (!set) return null;
        if (metric === "reps") return set.reps || null;
        return set.weight > 0 ? Math.round(calcE1rm(set.weight, set.reps)) : null;
      }),
    [exercise, setFilter]
  );
  const chartPoints = chart.points;
  const [scrubSessions, setScrubSessions] = useState<LoggedSession[]>([]);
  const [revising, setRevising] = useState(false);

  return (
    <>
      <ReviseGoalSheet
        exercise={exercise}
        visible={revising}
        onClose={() => setRevising(false)}
        onSaved={() => {
          onSaved?.();
          onClose();
        }}
      />
      <View style={styles.detailSection}>
        <View style={styles.detailTopRow}>
          <RoleBadge role={role} />
          <TouchableOpacity onPress={() => setRevising(true)}>
            <Text style={styles.revise}>Revise goal</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.detailSection}>
        <View style={styles.goalCard}>
          <View style={styles.goalCopy}>
            <Text style={styles.label}>{role === "support" ? "TARGET" : "GOAL"}</Text>
            <Text style={styles.goalTarget}>{detailGoalHeadline(exercise, role, target)}</Text>
            {role === "building" ? (
              <Text style={styles.mutedSmall}>{titleCase(exercise.goal || "strength")} focus</Text>
            ) : role === "support" ? (
              <Text style={styles.mutedSmall}>Support work for your priority lifts</Text>
            ) : null}
          </View>
          {role === "building" ? (
            <Ring size={72} stroke={6} progress={progressPct / 100} color={colors.accentPrimary}>
              <Text style={styles.ringPct}>{progressPct}%</Text>
            </Ring>
          ) : null}
        </View>
      </View>

      {sessions.length ? (
        <>
          <View style={styles.detailSection}>
            <Text style={styles.chartLabel}>SESSION HISTORY · TAP A DAY</Text>
            <ScrollView
              ref={chipScroll}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.sessionChipRow}
              // The active chip defaults to the most recent session, which is
              // at the far right. Without this the row opened on the oldest
              // session and the highlighted one was off-screen.
              onContentSizeChange={() => chipScroll.current?.scrollToEnd({ animated: false })}
            >
              {sessions.map((session, index) => {
                const active = index === activeIndex;
                const top = session.topSet;
                const topLabel =
                  top.weight > 0 ? `${top.weight}×${top.reps}` : `${top.reps} reps`;
                return (
                  <TouchableOpacity
                    key={session.key}
                    style={[styles.sessionChip, active && styles.sessionChipActive]}
                    onPress={() => setSelectedKey(session.key)}
                  >
                    <Text style={[styles.sessionChipDate, active && styles.sessionChipTextActive]}>
                      {shortDate(session.date)}
                    </Text>
                    <Text style={[styles.sessionChipSet, active && styles.sessionChipTextActive]}>{topLabel}</Text>
                    <Text style={[styles.sessionChipE1rm, active && styles.sessionChipTextActive]}>
                      {session.isBodyweight ? "bodyweight" : `${session.e1rm} e1RM`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {selected ? (
            <View style={styles.detailSection}>
              <Text style={styles.chartLabel}>{shortDate(selected.date).toUpperCase()} FULL WORKOUT</Text>
              {selected.sets.length ? (
                selected.sets.map((set) => (
                  <View key={set.setNumber} style={styles.setRow}>
                    <Text style={styles.setRowLabel}>Set {set.setNumber}</Text>
                    <Text style={styles.setRowValue}>
                      {set.weight > 0 ? `${set.weight} lb × ${set.reps}` : `${set.reps} reps`}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.mutedSmall}>Session logged — no set detail saved</Text>
              )}
            </View>
          ) : null}

          <View style={styles.detailSection}>
            <Text style={styles.chartLabel}>FILTER CHART BY SET</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {setFilters.map((filter) => {
                const active = setFilter === filter;
                const label = filter === "all" ? "All sets" : `Set ${filter}`;
                return (
                  <TouchableOpacity
                    key={String(filter)}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => setSetFilter(filter)}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <ScrubbableLineChart
              points={chartPoints}
              height={132}
              flat={role === "maintaining"}
              unit={chart.metric === "reps" ? "reps" : "e1RM"}
              onScrub={(point) => {
                const found = sessionsForPoint(point);
                setScrubSessions(found);
                if (found[0]) setSelectedKey(found[0].key);
              }}
            />
            <WorkoutDetailCallout
              sessions={scrubSessions}
              onOpenSession={(sessionId) =>
                navigation.navigate("Workouts", { editSessionId: sessionId })
              }
            />
          </View>
        </>
      ) : (
        <View style={styles.detailSection}>
          <Text style={styles.mutedSmall}>
            No logged sessions for this exercise yet. Log a workout and your history will appear here.
          </Text>
        </View>
      )}
    </>
  );
}

function RoadmapTab({ exercise, role }: { exercise: ProjectedExercise; role: Role }) {
  const current = exercise.current || exercise.realistic[0];
  const target = destinationAsWeekPoint(exercise) || peak(exercise.realistic);
  const sessions = useMemo(() => getSessionRecords(exercise), [exercise]);
  const progress = goalProgress(sessions, role, current, target);
  const flatChart = role === "maintaining" || role === "support";

  return (
    <>
      <View style={styles.detailSection}>
        <View style={styles.targetRow}>
          <View>
            <Text style={styles.label}>{role === "support" ? "TARGET RANGE" : "NEXT SESSION"}</Text>
            <Text style={styles.target}>
              {role === "support" ? formatSupportTarget(exercise) : formatTarget(exercise.realistic[0] || exercise.current)}
            </Text>
            <Text style={styles.mutedSmall}>
              {role === "support"
                ? "Hit the rep range — supports your main lifts"
                : `${exercise.sets || 3} working sets`}
            </Text>
            {!exercise.seeded_from_history && role !== "support" ? (
              <Text style={styles.estimateNote}>Starting estimate · no verified baseline yet</Text>
            ) : null}
          </View>
          {role === "building" ? (
            <View style={styles.progressWrap}>
              <View style={styles.progressLabels}>
                <Text style={styles.label}>GOAL PROGRESS</Text>
                <Text style={styles.progressPercent}>{progress}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.detailSection}>
        <Text style={styles.chartLabel}>HISTORY &amp; {PROJECTION_WEEKS}-WEEK ROADMAP</Text>
        <Trajectory exercise={exercise} flat={flatChart} />
      </View>

      <View style={[styles.detailSection, styles.detailSectionLast]}>
        <Text style={styles.chartLabel}>{role === "support" ? "SESSION PRESCRIPTION" : "WORKOUT RECOMMENDATIONS"}</Text>
        <Text style={styles.roadmapHint}>
          {role === "support"
            ? "What to aim for each time this lift comes up."
            : "What to hit each week if you stay on plan."}
        </Text>
        {role === "support" ? (
          <SupportPrescriptionTable exercise={exercise} />
        ) : (
          <ProgressionTable exercise={exercise} flat={flatChart} />
        )}
      </View>
    </>
  );
}

function CombinedExerciseDetail({
  exercises,
  onEdit,
  onClose,
}: {
  exercises: ProjectedExercise[];
  onEdit?: (prompt: string) => void;
  onClose: () => void;
}) {
  const exercise = exercises.find((item) => item.priority === "high") || exercises[0];
  // Must go through rawSessionsFor: `recent_sessions` also carries the
  // projector's synthetic `week-N` rows, so reading it directly could crown a
  // set the user has not performed yet as their best ever.
  const allSets = rawSessionsFor(exercise).flatMap((session) =>
    (session.sets || []).map((set) => ({ ...set, date: session.date }))
  );
  const weighted = allSets.filter((set) => (set.weight || 0) > 0);
  const bodyweight = allSets.filter((set) => (set.weight || 0) <= 0);
  const recentBestWeighted = weighted.reduce<(typeof weighted)[number] | undefined>(
    (best, set) =>
      !best ||
      (set.weight || 0) > (best.weight || 0) ||
      ((set.weight || 0) === (best.weight || 0) && (set.reps || 0) > (best.reps || 0))
        ? set
        : best,
    undefined
  );
  const recentBestBodyweight = bodyweight.reduce<(typeof bodyweight)[number] | undefined>(
    (best, set) => (!best || (set.reps || 0) > (best.reps || 0) ? set : best),
    undefined
  );
  const bestWeighted = exercise.history_context?.best_weighted_set || recentBestWeighted;
  const bestBodyweight = exercise.history_context?.best_bodyweight_rep_set || recentBestBodyweight;
  const bodyEntry = exercises.find((item) => !item.exercise_name.toLowerCase().includes("weighted"));
  const weightedEntry = exercises.find((item) => item.exercise_name.toLowerCase().includes("weighted"));
  const bodyRange = bodyEntry?.target_rep_range ||
    (bodyEntry ? ([bodyEntry.reps, Math.max(bodyEntry.reps, bodyEntry.reps + 4)] as [number, number]) : undefined);
  const weightedTarget = weightedEntry?.realistic.find((point) => point.weight > 0) || bestWeighted;
  const displayName = exercise.exercise_name.replace(/^weighted\s+/i, "");
  const [tab, setTab] = useState<DetailTab>("history");

  return (
    <>
      <View style={styles.detailSection}>
        <View style={styles.detailTopRow}>
          <RoleBadge role="building" />
          <TouchableOpacity
            onPress={() => {
              onEdit?.(`I want to revise both the weighted and bodyweight progression for ${displayName}. `);
              onClose();
            }}
          >
            <Text style={styles.revise}>Revise goal</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.roleCopy}>One movement, two coordinated progression tracks.</Text>
      </View>

      <DetailTabBar tab={tab} onChange={setTab} />
      {tab === "history" ? (
        <GoalHistoryTab exercise={exercise} role="building" onEdit={onEdit} onClose={onClose} />
      ) : (
        <>
          <View style={styles.detailSection}>
            <View style={styles.dualTargets}>
              <View style={styles.dualTarget}>
                <Text style={styles.label}>WEIGHTED TRACK</Text>
                <Text style={styles.dualTargetValue}>
                  {weightedTarget && "weight" in weightedTarget
                    ? `+${weightedTarget.weight || 0} lb × ${weightedTarget.reps || 0}`
                    : "Build added load"}
                </Text>
                <Text style={styles.mutedSmall}>
                  {bestWeighted ? `Best logged: +${bestWeighted.weight} × ${bestWeighted.reps}` : "No weighted baseline logged"}
                </Text>
              </View>
              <View style={styles.dualDivider} />
              <View style={styles.dualTarget}>
                <Text style={styles.label}>BODYWEIGHT TRACK</Text>
                <Text style={styles.dualTargetValue}>
                  {bodyRange ? `${bodyRange[0]}–${bodyRange[1]} reps` : `${bestBodyweight?.reps || 0}+ reps`}
                </Text>
                <Text style={styles.mutedSmall}>
                  {bestBodyweight ? `Best logged: ${bestBodyweight.reps} reps` : "Build a rep baseline"}
                </Text>
              </View>
            </View>
          </View>
          <View style={[styles.detailSection, styles.detailSectionLast]}>
            <Text style={styles.chartLabel}>HISTORY &amp; 12-WEEK ROADMAP</Text>
            <Trajectory exercise={exercise} flat={false} />
            <Text style={[styles.chartLabel, { marginTop: 16 }]}>WORKOUT RECOMMENDATIONS</Text>
            <ProgressionTable exercise={exercise} flat={false} />
          </View>
        </>
      )}
    </>
  );
}

function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SupportPrescriptionTable({ exercise }: { exercise: ProjectedExercise }) {
  const range = supportRepRange(exercise);
  const next = exercise.realistic[0] || exercise.current;
  const rows = [
    {
      key: "next",
      label: "Next session",
      value: next ? formatTarget(next) : `${exercise.sets || 3} × ${range[0]}–${range[1]}`,
    },
    {
      key: "range",
      label: "Rep range",
      value: `${range[0]}–${range[1]} reps`,
    },
    {
      key: "sets",
      label: "Working sets",
      value: `${exercise.sets || 3}`,
    },
  ];

  return (
    <View style={styles.progressionTable}>
      {rows.map((row) => (
        <View key={row.key} style={styles.progressionRow}>
          <Text style={styles.progressionWeek}>{row.label}</Text>
          <Text style={[styles.progressionTarget, { flex: 1 }]}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Week-by-week prescriptions: one row per week, one column per workout.
 *
 * A lift trained twice a week gets a different prescription each time — heavy
 * on one day, volume on the other — and every set matters, not just the top
 * one. Collapsing a week to a single "80 lb x 6" hid both, which is why the
 * table could not answer "what do I actually do on Friday".
 */
function ProgressionTable({ exercise, flat }: { exercise: ProjectedExercise; flat: boolean }) {
  const { weeks, sessionCount } = useMemo(() => {
    const schedule = exercise.schedule || [];
    const byWeek = new Map<number, Map<number, WeekPoint>>();
    let maxSession = 1;
    for (const point of schedule) {
      const session = point.session || 1;
      maxSession = Math.max(maxSession, session);
      if (!byWeek.has(point.week)) byWeek.set(point.week, new Map());
      byWeek.get(point.week)!.set(session, point);
    }
    return {
      weeks: [...byWeek.entries()].sort((a, b) => a[0] - b[0]),
      sessionCount: maxSession,
    };
  }, [exercise]);

  // Older payloads have no schedule; fall back to the weekly curve so the
  // table still renders something rather than disappearing.
  if (!weeks.length) return <LegacyProgressionTable exercise={exercise} />;

  const describe = (point?: WeekPoint) => {
    if (!point) return "—";
    if (point.sets?.length) {
      return point.sets.map((set) => `${set.weight}x${set.reps}`).join(", ");
    }
    return formatTarget(point);
  };

  return (
    <View style={styles.progressionTable}>
      {weeks.map(([week, sessions]) => (
        <View key={week} style={styles.progressionWeekBlock}>
          <Text style={styles.progressionWeekLabel}>Week {week}</Text>
          {Array.from({ length: sessionCount }, (_, i) => (
            <View key={i} style={styles.progressionWorkoutRow}>
              {sessionCount > 1 ? (
                <Text style={styles.progressionWorkoutLabel}>Workout {i + 1}</Text>
              ) : null}
              <Text style={styles.progressionWorkoutSets} numberOfLines={3}>
                {describe(sessions.get(i + 1))}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function LegacyProgressionTable({ exercise }: { exercise: ProjectedExercise }) {
  const source = [exercise.current, ...exercise.realistic].filter(Boolean) as WeekPoint[];
  if (!source.length) {
    return <Text style={styles.mutedSmall}>No progression data yet</Text>;
  }
  return (
    <View style={styles.progressionTable}>
      {source.map((point, index) => (
        <View key={`${point.week}-${index}`} style={styles.progressionRow}>
          <Text style={styles.progressionWeek}>
            {index === 0
              ? exercise.seeded_from_history
                ? "Last logged"
                : "Starting estimate"
              : `Week ${point.week || index}`}
          </Text>
          <Text style={styles.progressionTarget}>{formatTarget(point)}</Text>
          <Text style={styles.progressionE1rm}>
            {point.e1rm ? `${Math.round(point.e1rm)} e1RM` : "—"}
          </Text>
        </View>
      ))}
    </View>
  );
}

function supportRepRange(exercise: ProjectedExercise): [number, number] {
  return exercise.target_rep_range || [exercise.reps || 10, Math.max(exercise.reps || 10, 15)];
}

function formatSupportTarget(exercise: ProjectedExercise) {
  const range = supportRepRange(exercise);
  return `${exercise.sets || 3} × ${range[0]}–${range[1]}`;
}

function summaryGoalLine(exercise: ProjectedExercise, role: Role, target?: WeekPoint | null) {
  const dest = resolveDestination(exercise);
  if (role === "building" && dest) {
    const weeks = dest.weeks || exercise.realistic.length || PROJECTION_WEEKS;
    const reach = exercise.reachable === false ? " · stretch" : "";
    return `Goal · ${dest.weight} lb × ${dest.reps} by ${targetDate(weeks)}${reach}`;
  }
  if (role === "building" && target) {
    return `Goal · ${formatTarget(target)} by ${targetDate(exercise.realistic.length)}`;
  }
  if (role === "support") {
    return `Target · ${formatSupportTarget(exercise)} reps`;
  }
  return "Holding steady — not a plateau.";
}

function detailGoalHeadline(exercise: ProjectedExercise, role: Role, target?: WeekPoint | null) {
  const dest = resolveDestination(exercise);
  if (role === "building" && dest) {
    const weeks = dest.weeks || exercise.realistic.length || PROJECTION_WEEKS;
    return `${dest.weight} lb × ${dest.reps} by ${targetDate(weeks)}`;
  }
  if (role === "building" && target) {
    return `${formatTarget(target)} by ${targetDate(exercise.realistic.length)}`;
  }
  if (role === "support") {
    return `${formatSupportTarget(exercise)} reps`;
  }
  return "Holding steady — not a plateau.";
}

function resolveDestination(exercise: ProjectedExercise): {
  weight: number;
  reps: number;
  weeks?: number;
} | null {
  if (exercise.destination?.weight && exercise.destination?.reps) {
    return exercise.destination;
  }
  if (exercise.target_weight && exercise.target_reps) {
    return {
      weight: exercise.target_weight,
      reps: exercise.target_reps,
      weeks: exercise.target_weeks ?? undefined,
    };
  }
  return null;
}

function destinationAsWeekPoint(exercise: ProjectedExercise): WeekPoint | null {
  const dest = resolveDestination(exercise);
  if (!dest) return null;
  return {
    week: dest.weeks || exercise.realistic.length || PROJECTION_WEEKS,
    weight: dest.weight,
    reps: dest.reps,
    e1rm: calcE1rm(dest.weight, dest.reps),
  };
}

function RoleBadge({ role }: { role: Role }) {
  return (
    <View
      style={[
        styles.roleBadge,
        role === "building" ? styles.buildingBadge : role === "maintaining" ? styles.maintainBadge : styles.supportBadge,
      ]}
    >
      <Text
        style={[
          styles.roleBadgeText,
          role === "building" ? styles.buildingText : role === "maintaining" ? styles.maintainText : styles.supportText,
        ]}
      >
        {role === "support" ? "SUPPORT WORK" : role.toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * One chart, two axes of time: what was actually lifted, and what comes next.
 *
 * These were separate charts, which made the comparison the user actually
 * wants — "am I on the line I was promised?" — impossible to make. Logged
 * sessions run left of TODAY, projection runs right of it, and both are
 * plotted on one shared scale so the join is honest rather than two graphs
 * stacked. History is solid and lighter, projection is the accent colour, and
 * the ceiling stays dashed.
 *
 * Both halves scrub. The forward half is where the question "what am I
 * supposed to hit in week 6?" actually lives, and it used to be inert.
 */
export function Trajectory({ exercise, flat }: { exercise: ProjectedExercise; flat: boolean }) {
  const navigation = useNavigation<any>();
  const width = Math.min(Dimensions.get("window").width - 68, 520);
  const height = 150;
  const plotTop = 12;
  const plotHeight = 96;
  // Enough room on the left for the y-axis values, and on both ends for the
  // date captions — "TODAY" is centred on its rule and used to hang off the
  // edge of the canvas whenever that rule sat at x = 8.
  const gutter = 34;
  const edge = 26;
  const accent = flat ? colors.ai : colors.accentPrimary;
  const [scrubSessions, setScrubSessions] = useState<LoggedSession[]>([]);
  const [scrubTarget, setScrubTarget] = useState<WeekPoint | null>(null);
  const history = useMemo(() => buildExerciseChart(exercise), [exercise]);

  const chart = useMemo(() => {
    const forward = [exercise.current, ...exercise.realistic].filter(Boolean) as WeekPoint[];
    const ceiling = [exercise.current, ...(exercise.best_case || [])].filter(Boolean) as WeekPoint[];
    const past = history.points;
    const pastValues = past.map((p) => p.value).filter((v): v is number => v != null);

    if (!forward.length && !pastValues.length) return null;

    const forwardValues = forward.map((p) => (flat && forward.length ? forward[0].e1rm : p.e1rm));
    const ceilingValues = flat ? [] : ceiling.map((p) => p.e1rm);
    const all = [...forwardValues, ...ceilingValues, ...pastValues];
    if (!all.length) return null;

    const rawLo = Math.min(...all);
    const rawHi = Math.max(...all);
    const pad = rawHi - rawLo < 1e-6 ? Math.max(rawHi * 0.1, 1) : (rawHi - rawLo) * 0.12;
    const min = rawLo - pad;
    const max = rawHi + pad;
    const span = Math.max(max - min, 1e-6);
    const y = (value: number) => plotTop + (1 - (value - min) / span) * plotHeight;

    const plottedPast = past.filter((p) => p.value != null);
    const left = gutter;
    const right = width - edge;
    const historySteps = Math.max(plottedPast.length - 1, 0);
    const forwardSteps = Math.max(forward.length - 1, 1);
    const rawShare = historySteps / (historySteps + forwardSteps || 1);
    // The divider never sits flush against either edge, so its label and the
    // first history mark always have room to render.
    const share = plottedPast.length < 2 ? 0.12 : Math.min(0.5, Math.max(0.2, rawShare));
    const todayX = left + share * (right - left);

    // History is spaced by date, like every other chart here, so a layoff
    // reads as a layoff rather than as one more evenly spaced session.
    const times = plottedPast.map((p) => p.t).filter((t) => !Number.isNaN(t));
    const t0 = times.length ? Math.min(...times) : 0;
    const tSpan = times.length ? Math.max(...times) - t0 : 0;

    const pastCoords = plottedPast.map((point, index) => {
      const ratio = tSpan && !Number.isNaN(point.t)
        ? (point.t - t0) / tSpan
        : historySteps
          ? index / historySteps
          : 1;
      return { x: left + ratio * (todayX - left), y: y(point.value as number), point };
    });
    const coordFor = new Map(pastCoords.map((c) => [c.point.key, c]));

    const segments: Array<{ x: number; y: number }[]> = [];
    let current: Array<{ x: number; y: number }> = [];
    for (const point of past) {
      if (point.value == null || point.trend === "gap") {
        if (current.length > 1) segments.push(current);
        current = [];
        continue;
      }
      const coord = coordFor.get(point.key);
      if (coord) current.push({ x: coord.x, y: coord.y });
    }
    if (current.length > 1) segments.push(current);

    const project = (points: WeekPoint[], values: number[]) =>
      points.map((point, i) => ({
        x: todayX + (i / forwardSteps) * (right - todayX),
        y: y(values[i]),
        point,
      }));

    return {
      pastSegments: segments,
      pastCoords,
      forward: project(forward, forwardValues),
      ceiling: flat || ceiling.length < 2 ? [] : project(ceiling, ceilingValues),
      todayX,
      firstDate: plottedPast.length ? plottedPast[0].date : null,
      sessionCount: plottedPast.length,
      min,
      max,
      left,
      right,
    };
  }, [exercise, flat, width, history]);

  const scrubAtRef = useRef<(x: number) => void>(() => {});
  scrubAtRef.current = (x: number) => {
    if (!chart) return;
    if (x <= chart.todayX) {
      setScrubTarget(null);
      if (!chart.pastCoords.length) return;
      let best = chart.pastCoords[0];
      let bestDist = Infinity;
      for (const coord of chart.pastCoords) {
        const dist = Math.abs(coord.x - x);
        if (dist < bestDist) {
          bestDist = dist;
          best = coord;
        }
      }
      setScrubSessions(sessionsForPoint(best.point));
      return;
    }
    setScrubSessions([]);
    if (!chart.forward.length) return;
    let best = chart.forward[0];
    let bestDist = Infinity;
    for (const coord of chart.forward) {
      const dist = Math.abs(coord.x - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = coord;
      }
    }
    setScrubTarget(best.point);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => scrubAtRef.current(e.nativeEvent.locationX),
      onPanResponderMove: (e) => scrubAtRef.current(e.nativeEvent.locationX),
      // Same as ScrubbableLineChart: leave the callout up after the finger lifts.
      onPanResponderRelease: () => {},
      onPanResponderTerminate: () => {},
    })
  ).current;

  if (!chart) {
    return <Text style={styles.mutedSmall}>No data for this exercise yet.</Text>;
  }

  const line = (points: { x: number; y: number }[]) => points.map((p) => `${p.x},${p.y}`).join(" ");
  const unit = history.metric === "reps" ? "reps" : "e1RM";
  const lifetime = exercise.history_context?.lifetime_session_count ?? chart.sessionCount;

  return (
    <View>
      <View {...pan.panHandlers}>
        <Svg width={width} height={height}>
          {[0, 0.5, 1].map((ratio) => (
            <Line
              key={`grid-${ratio}`}
              x1={chart.left}
              x2={chart.right}
              y1={plotTop + plotHeight * ratio}
              y2={plotTop + plotHeight * ratio}
              stroke="#252529"
              strokeDasharray="3 5"
            />
          ))}
          {/* The line had no y axis at all, so its height carried no magnitude. */}
          {[0, 0.5, 1].map((ratio) => (
            <SvgText
              key={`tick-${ratio}`}
              x={4}
              y={plotTop + plotHeight * ratio + 3}
              fill={colors.textMuted}
              fontSize="9"
            >
              {Math.round(chart.max - (chart.max - chart.min) * ratio)}
            </SvgText>
          ))}

          <Line
            x1={chart.todayX}
            x2={chart.todayX}
            y1={plotTop - 4}
            y2={plotTop + plotHeight + 6}
            stroke={colors.borderHover}
            strokeWidth="1"
          />

          {chart.pastSegments.map((segment, i) => (
            <Polyline
              key={`past-${i}`}
              points={line(segment)}
              fill="none"
              stroke={colors.textSecondary}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {chart.pastCoords.map((p) => (
            <Circle
              key={`h-${p.point.key}`}
              cx={p.x}
              cy={p.y}
              r={3}
              fill={trendColor(p.point.trend)}
            />
          ))}

          {chart.ceiling.length ? (
            <Polyline
              points={line(chart.ceiling)}
              fill="none"
              stroke={accent}
              strokeOpacity={0.45}
              strokeWidth="2"
              strokeDasharray="5 4"
              strokeLinecap="round"
            />
          ) : null}
          <Polyline
            points={line(chart.forward)}
            fill="none"
            stroke={accent}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {chart.forward.map((p, i) => (
            <Circle key={`f-${i}`} cx={p.x} cy={p.y} r={i === 0 ? 4.5 : 2.5} fill={i === 0 ? "#fff" : accent} />
          ))}

          {chart.firstDate ? (
            <SvgText x={chart.left} y={height - 18} fill={colors.textMuted} fontSize="9">
              {shortDate(chart.firstDate)}
            </SvgText>
          ) : null}
          <SvgText
            x={chart.todayX}
            y={height - 18}
            fill={colors.textSecondary}
            fontSize="9"
            textAnchor="middle"
          >
            TODAY
          </SvgText>
          <SvgText
            x={chart.right}
            y={height - 18}
            fill={colors.textMuted}
            fontSize="9"
            textAnchor="end"
          >
            {PROJECTION_WEEKS} WK
          </SvgText>
        </Svg>
      </View>

      {scrubTarget ? (
        <View style={styles.scrubTarget}>
          <Text style={styles.scrubTargetLabel}>
            WEEK {scrubTarget.week}
            {scrubTarget.session ? ` · WORKOUT ${scrubTarget.session}` : ""} TARGET
          </Text>
          <Text style={styles.scrubTargetValue}>
            {formatTarget(scrubTarget)} · {Math.round(scrubTarget.e1rm)} {unit}
          </Text>
        </View>
      ) : (
        <Text style={styles.chartCaption}>
          Tap a point — left of TODAY for logged sets, right for upcoming targets
        </Text>
      )}

      <View style={styles.legend}>
        {chart.sessionCount ? (
          <View style={styles.legendItem}>
            <View style={[styles.legendSolid, { backgroundColor: colors.textSecondary }]} />
            <Text style={styles.legendText}>
              Logged — {chart.sessionCount} charted
              {lifetime > chart.sessionCount ? ` of ${lifetime} total` : ""}
            </Text>
          </View>
        ) : null}
        <View style={styles.legendItem}>
          <View style={[styles.legendSolid, { backgroundColor: accent }]} />
          <Text style={styles.legendText}>Target — paced by your actual consistency</Text>
        </View>
        {chart.ceiling.length ? (
          <View style={styles.legendItem}>
            <View style={[styles.legendDashed, { borderColor: accent }]} />
            <Text style={styles.legendText}>Best case — every session hit</Text>
          </View>
        ) : null}
      </View>

      <WorkoutDetailCallout
        sessions={scrubSessions}
        onOpenSession={(sessionId) =>
          navigation.navigate("Workouts", { editSessionId: sessionId })
        }
      />
    </View>
  );
}

/**
 * How far a building goal has come, measured from where the lifter started.
 *
 * Dividing current by target treats zero as the origin, so someone at 200
 * e1RM chasing 220 opened the card already showing 91% and the ring barely
 * moved across the whole block. Progress is the share of the distance between
 * the baseline and the target that has actually been covered.
 */
function goalProgress(
  sessions: LoggedSession[],
  role: Role,
  current: WeekPoint | null | undefined,
  target: WeekPoint | null | undefined
) {
  if (role !== "building" || !current?.e1rm || !target?.e1rm) return 0;
  const loaded = sessions.filter((session) => !session.isBodyweight);
  const baseline = loaded.length ? loaded[0].e1rm : current.e1rm;
  const span = target.e1rm - baseline;
  // A target at or below the baseline is not a distance to cover; it is either
  // already met or the goal needs revising.
  if (span <= 0) return current.e1rm >= target.e1rm ? 100 : 0;
  const covered = (current.e1rm - baseline) / span;
  return Math.max(0, Math.min(100, Math.round(covered * 100)));
}

/**
 * The text list under a card, built from the same records as the chart above
 * it. These used to merge the two server history lists by different rules, so
 * the list and the line could disagree about which sessions existed.
 */
function lastSessions(exercise: ProjectedExercise, limit: number) {
  return getSessionRecords(exercise)
    .slice(-limit)
    .reverse()
    .map((session) => {
      const sets = session.sets.map((set) =>
        set.weight > 0 ? `${set.weight}×${set.reps}` : `${set.reps} reps`
      );
      const dateLabel = formatDate(session.date);
      return {
        key: session.key,
        label: sets.length
          ? `${dateLabel} · ${sets.join(", ")}`
          : `${dateLabel} · session logged`,
      };
    });
}

/**
 * Coach patches staged from chat, awaiting an explicit decision.
 *
 * This is the only route by which a chat turn reaches the live plan, and it
 * runs on a tap. The card lists each edit so "accept" is never a blank cheque.
 */
function formatEditBefore(value: unknown): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.map(String).join("-");
  return String(value);
}

function formatEditAfter(value: unknown): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.map(String).join("-");
  if (typeof value === "object" && value && "exercise_name" in (value as object)) {
    return String((value as { exercise_name?: string }).exercise_name);
  }
  return String(value);
}

function PendingSuggestions({
  pending,
  busy,
  onAccept,
  onDiscard,
}: {
  pending: PendingPlanSuggestions;
  busy: boolean;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  const edits = (pending.suggestion.edits || []).filter((edit) => edit.status === "pending");
  if (!edits.length) return null;

  return (
    <View style={styles.suggestion}>
      <Text style={styles.suggestionEyebrow}>AI COACH SUGGESTION · PENDING</Text>
      <Text style={styles.suggestionTitle}>{pending.suggestion.summary}</Text>

      {edits.map((edit) => (
        <View key={edit.id} style={styles.suggestionEdit}>
          <MaterialCommunityIcons name="circle-small" size={20} color={colors.accentPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.suggestionEditTitle}>{edit.title}</Text>
            {edit.from != null && edit.op?.startsWith("set_") ? (
              <Text style={styles.roleCopy}>
                {formatEditBefore(edit.from)} → {formatEditAfter(edit.value)}
              </Text>
            ) : null}
            {edit.op === "replace_day_exercises" && Array.isArray(edit.value) ? (
              <Text style={styles.roleCopy}>
                {(edit.from as string[] | undefined)?.join(", ") || "empty"} →{" "}
                {(edit.value as { exercise_name?: string }[])
                  .map((ex) => ex.exercise_name)
                  .filter(Boolean)
                  .join(", ")}
              </Text>
            ) : null}
            {edit.rationale ? <Text style={styles.roleCopy}>{edit.rationale}</Text> : null}
          </View>
        </View>
      ))}

      {pending.planChangedSince ? (
        <Text style={styles.suggestionWarning}>
          Your plan has changed since this was suggested — anything that no longer applies
          will be skipped.
        </Text>
      ) : null}
      <Text style={styles.mutedSmall}>Your current plan stays live until you accept.</Text>

      <View style={styles.suggestionActions}>
        <TouchableOpacity onPress={onDiscard} style={styles.discard} disabled={busy}>
          <Text style={styles.discardText}>Discard</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onAccept} style={styles.accept} disabled={busy}>
          <Text style={styles.acceptText}>
            {busy ? "Applying…" : `Accept ${edits.length > 1 ? `all ${edits.length}` : "change"}`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function roleFor(ex: ProjectedExercise): Role {
  const goal = (ex.goal || "").toLowerCase();
  if (ex.priority === "supporting") return "support";
  if (ex.priority === "high" || ["strength", "weight", "power", "hypertrophy", "build"].some((x) => goal.includes(x))) {
    return "building";
  }
  return "maintaining";
}

function peak(points: WeekPoint[]) {
  return points.reduce<WeekPoint | undefined>((best, p) => (!best || p.e1rm > best.e1rm ? p : best), undefined);
}

function formatTarget(p?: WeekPoint | null) {
  return p ? `${p.weight} lb × ${p.reps}` : "Rep range";
}

function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function targetDate(weeks: number) {
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDate(s: string) {
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.valueOf()) ? s : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function nextScheduledAny(dayNames: string[], schedule?: Record<string, string>) {
  if (!schedule || !dayNames.length) return "Not scheduled";
  const wanted = new Set(dayNames);
  const today = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const key = WEEKDAYS[d.getDay()].toLowerCase();
    if (wanted.has(schedule[key])) {
      return i === 0 ? "Today" : i === 1 ? "Tomorrow" : WEEKDAYS[d.getDay()];
    }
  }
  return "Not scheduled";
}

function groupExercises(exercises: ProjectedExercise[]) {
  const groups = new Map<string, ProjectedExercise[]>();
  exercises.forEach((exercise, index) => {
    const key = exercise.exercise_id || `${exercise.exercise_name}-${index}`;
    groups.set(key, [...(groups.get(key) || []), exercise]);
  });
  return [...groups.values()];
}

const styles = StyleSheet.create({
  errorBox: {
    margin: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    alignItems: "center",
    gap: 8,
  },
  errorText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.accentPrimary,
  },
  retryText: { color: colors.accentPrimary, fontSize: 12, fontWeight: "800" },
  scrubTarget: {
    marginTop: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  scrubTargetLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.6, color: colors.textMuted },
  scrubTargetValue: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 2,
  },
  loader: { marginVertical: 40 },
  muted: { color: colors.textSecondary, fontSize: 13 },
  heroRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 20,
  },
  heroCopy: { flex: 1 },
  heroActions: { gap: 6 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.4, color: colors.accentPrimary },
  title: { fontSize: 30, fontWeight: "800", color: colors.textPrimary, marginTop: 3 },
  subtitle: { fontSize: 13, lineHeight: 18, color: colors.textSecondary, marginTop: 5 },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: colors.borderHover,
    borderRadius: borderRadius.md,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  editText: { color: colors.accentPrimary, fontSize: 11, fontWeight: "700" },
  pager: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 10 },
  arrow: { width: 34, height: 40, alignItems: "center", justifyContent: "center" },
  tabs: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: 4,
    gap: 3,
  },
  tab: { flex: 1, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 9 },
  tabActive: { backgroundColor: colors.accentPrimary },
  tabText: { color: colors.textSecondary, textAlign: "center", fontSize: 12, fontWeight: "700" },
  tabTextActive: { color: colors.onAccent },
  summary: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    overflow: "hidden",
  },
  summaryHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    padding: 14,
    paddingBottom: 10,
  },
  daySummaryHead: { padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  dayName: { fontSize: 17, fontWeight: "800", color: colors.textPrimary },
  dayFocus: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
  metrics: { flexDirection: "row", flexWrap: "wrap" },
  metric: {
    width: "50%",
    padding: 14,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  metricLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.8, color: colors.textMuted },
  metricValue: { fontSize: 13, fontWeight: "700", color: colors.textPrimary, marginTop: 4 },
  accent: { color: colors.accentPrimary },
  cards: { gap: 10, marginTop: 16 },
  variantBlock: { gap: 10 },
  variantHead: {
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 2,
    gap: 2,
  },
  variantTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
    letterSpacing: 0.2,
  },
  variantFocus: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  summaryCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    overflow: "hidden",
  },
  cardTitleWrap: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 },
  exerciseName: { color: colors.textPrimary, fontSize: 16, fontWeight: "800" },
  goalLine: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 5 },
  sessionLogs: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 4,
  },
  sessionRow: { color: colors.textPrimary, fontSize: 12, lineHeight: 17 },
  sessionRowDetail: { color: colors.textPrimary, fontSize: 13, lineHeight: 20, marginTop: 6 },
  roleCopy: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 4 },
  revise: { color: colors.accentPrimary, fontSize: 12, fontWeight: "700" },
  roleBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 99 },
  roleBadgeText: { fontSize: 8, fontWeight: "900", letterSpacing: 0.5 },
  buildingBadge: { backgroundColor: "rgba(156,192,232,.14)" },
  buildingText: { color: colors.accentPrimary },
  maintainBadge: { backgroundColor: "rgba(94,234,212,.1)" },
  maintainText: { color: colors.ai },
  supportBadge: { backgroundColor: colors.border },
  supportText: { color: colors.textSecondary },
  label: { fontSize: 9, fontWeight: "800", letterSpacing: 0.8, color: colors.textMuted },
  mutedSmall: { fontSize: 10, color: colors.textSecondary, marginTop: 3 },
  estimateNote: { fontSize: 10, color: colors.warning, marginTop: 5 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,.55)", justifyContent: "flex-end" },
  modalSheet: {
    maxHeight: "92%",
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: "800", color: colors.textPrimary },
  modalSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
  modalClose: { padding: 4 },
  modalScroll: { maxHeight: Dimensions.get("window").height * 0.78 },
  modalScrollContent: { paddingBottom: spacing.xl * 2 },
  historyHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 },
  historyMeta: { fontSize: 10, color: colors.textSecondary, fontWeight: "600" },
  detailSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailSectionLast: { borderBottomWidth: 0 },
  detailTabBar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  detailTabActive: {
    borderColor: colors.accentPrimary,
    backgroundColor: "rgba(156,192,232,.1)",
  },
  detailTabText: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  detailTabTextActive: { color: colors.accentPrimary },
  goalCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  goalCopy: { flex: 1 },
  goalTarget: { fontSize: 20, fontWeight: "800", color: colors.textPrimary, marginTop: 4, lineHeight: 26 },
  ringPct: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  sessionChipRow: { gap: 8, paddingVertical: 4 },
  sessionChip: {
    minWidth: 92,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sessionChipActive: {
    borderColor: colors.accentPrimary,
    backgroundColor: "rgba(156,192,232,.12)",
  },
  sessionChipDate: { fontSize: 11, fontWeight: "800", color: colors.textSecondary },
  sessionChipSet: { fontSize: 13, fontWeight: "800", color: colors.textPrimary, marginTop: 4 },
  sessionChipE1rm: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  sessionChipTextActive: { color: colors.accentPrimary },
  setRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  setRowLabel: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  setRowValue: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  filterRow: { gap: 8, marginBottom: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipActive: {
    borderColor: colors.accentPrimary,
    backgroundColor: colors.accentPrimary,
  },
  filterChipText: { fontSize: 11, fontWeight: "700", color: colors.textSecondary },
  filterChipTextActive: { color: colors.onAccent },
  roadmapHint: { fontSize: 11, color: colors.textSecondary, marginBottom: 10, marginTop: -2 },
  detailTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  targetRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 18 },
  target: { fontSize: 24, fontWeight: "800", color: colors.textPrimary, marginTop: 3 },
  progressWrap: { flex: 1, maxWidth: 160 },
  progressLabels: { flexDirection: "row", justifyContent: "space-between" },
  progressPercent: { fontSize: 10, fontWeight: "700", color: colors.textSecondary },
  progressTrack: { height: 5, borderRadius: 99, backgroundColor: colors.border, marginTop: 7, overflow: "hidden" },
  progressFill: { height: 5, borderRadius: 99, backgroundColor: colors.accentPrimary },
  chartLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: colors.textMuted,
    marginBottom: 8,
  },
  progressionTable: { gap: 0 },
  progressionWeekBlock: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 6,
  },
  progressionWeekLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  progressionWorkoutRow: {
    gap: 2,
    paddingLeft: 2,
  },
  progressionWorkoutLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  progressionWorkoutSets: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
    lineHeight: 18,
  },
  progressionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  progressionWeek: { width: 56, fontSize: 11, fontWeight: "700", color: colors.textSecondary },
  progressionCell: { flex: 1, fontSize: 12, fontWeight: "700", color: colors.textPrimary, paddingRight: 6 },
  progressionHeader: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  progressionTarget: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  progressionE1rm: { fontSize: 11, color: colors.textMuted },
  dualTargets: { flexDirection: "row", gap: 12 },
  dualTarget: { flex: 1 },
  dualDivider: { width: 1, backgroundColor: colors.border },
  dualTargetValue: { fontSize: 18, fontWeight: "800", color: colors.textPrimary, marginTop: 5 },
  accessory: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: 16,
  },
  accessoryCopy: { flex: 1 },
  accessoryTarget: { fontSize: 18, fontWeight: "800", color: colors.textPrimary, marginTop: 3 },
  reviewNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderHover,
    borderRadius: borderRadius.md,
    padding: 14,
    marginTop: 18,
  },
  reviewText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 16 },
  reviewStrong: { color: colors.textPrimary, fontWeight: "700" },
  suggestion: {
    borderWidth: 1,
    borderColor: colors.accentPrimary,
    borderRadius: borderRadius.lg,
    padding: 16,
    backgroundColor: "rgba(156,192,232,.06)",
  },
  suggestionEyebrow: { fontSize: 9, fontWeight: "900", letterSpacing: 0.8, color: colors.accentPrimary },
  suggestionTitle: { fontSize: 15, fontWeight: "800", color: colors.textPrimary, marginTop: 5 },
  suggestionEdit: { flexDirection: "row", alignItems: "flex-start", gap: 2, marginTop: 10 },
  suggestionEditTitle: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  suggestionWarning: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.ai,
    marginTop: 10,
  },
  legend: { marginTop: 8, gap: 5 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 7 },
  legendSolid: { width: 16, height: 3, borderRadius: 2 },
  legendDashed: { width: 16, height: 0, borderTopWidth: 2, borderStyle: "dashed", opacity: 0.6 },
  legendText: { fontSize: 10, color: colors.textSecondary },
  historyChart: { marginTop: 6, marginBottom: 10 },
  chartCaption: { fontSize: 10, color: colors.textMuted, marginTop: 4 },
  suggestionActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  discard: { paddingHorizontal: 12, paddingVertical: 9 },
  discardText: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  accept: { paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.accentPrimary, borderRadius: borderRadius.sm },
  acceptText: { fontSize: 12, fontWeight: "800", color: colors.onAccent },
});
