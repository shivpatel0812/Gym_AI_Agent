import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import Ring from "../nutrition/Ring";
import {
  acceptPlanSuggestions,
  dismissPlanSuggestions,
  getPlanProjection,
  getPlanSuggestions,
  type PendingPlanSuggestions,
  type PlanProjection,
  type ProjectedDay,
  type ProjectedExercise,
  type WeekPoint,
} from "../../api/trainingPlan";
import { borderRadius, colors, spacing } from "../../theme";

type Role = "building" | "maintaining" | "support";
type DetailTab = "history" | "roadmap";
type SetFilter = "all" | number;
type DetailSelection =
  | { kind: "single"; exercise: ProjectedExercise }
  | { kind: "combined"; exercises: ProjectedExercise[]; label: string };

type SessionRecord = {
  key: string;
  date: string;
  sets: Array<{ setNumber: number; weight: number; reps: number }>;
  topSet: { weight: number; reps: number };
  e1rm: number;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function PlanHub({
  onEdit,
  onImport,
}: {
  onEdit?: (prompt: string) => void;
  onImport?: () => void;
}) {
  const [projection, setProjection] = useState<PlanProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [dayIndex, setDayIndex] = useState(0);
  const [detail, setDetail] = useState<DetailSelection | null>(null);
  const [pending, setPending] = useState<PendingPlanSuggestions | null>(null);
  const [resolving, setResolving] = useState(false);

  const loadProjection = useCallback(
    () => getPlanProjection(12).then(setProjection).catch(() => setProjection(null)),
    []
  );
  const loadPending = useCallback(
    () => getPlanSuggestions().then(setPending).catch(() => setPending(null)),
    []
  );

  useEffect(() => {
    Promise.all([loadProjection(), loadPending()]).finally(() => setLoading(false));
  }, [loadProjection, loadPending]);

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

  if (loading) return <ActivityIndicator style={styles.loader} color={colors.accentPrimary} />;
  if (!projection?.days.length) {
    return <Text style={styles.muted}>The roadmap will appear after your plan has enough exercise data.</Text>;
  }

  const days = projection.days;
  const day = days[dayIndex] || days[0];
  const move = (delta: number) => setDayIndex((dayIndex + delta + days.length) % days.length);

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

      <View style={styles.pager}>
        <TouchableOpacity onPress={() => move(-1)} style={styles.arrow}>
          <MaterialCommunityIcons name="chevron-left" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.tabs}>
          {days.map((item, i) => (
            <TouchableOpacity
              key={item.day_name}
              onPress={() => setDayIndex(i)}
              style={[styles.tab, i === dayIndex && styles.tabActive]}
            >
              <Text numberOfLines={1} style={[styles.tabText, i === dayIndex && styles.tabTextActive]}>
                {shortDay(item.day_name)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => move(1)} style={styles.arrow}>
          <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <DaySummary day={day} schedule={projection.weekly_schedule} />

      <View style={styles.cards}>
        {groupExercises(day.exercises).map((group) =>
          group.length > 1 ? (
            <CombinedExerciseSummary
              key={group[0].exercise_id}
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
              key={group[0].exercise_id}
              exercise={group[0]}
              onPress={() => setDetail({ kind: "single", exercise: group[0] })}
            />
          )
        )}
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

      <ExerciseDetailModal detail={detail} onClose={() => setDetail(null)} onEdit={onEdit} />
    </View>
  );
}

function DaySummary({ day, schedule }: { day: ProjectedDay; schedule?: Record<string, string> }) {
  const dates = day.exercises.map((e) => e.last_trained).filter(Boolean).sort() as string[];
  const counts = day.exercises.reduce(
    (a, e) => {
      const role = roleFor(e);
      if (role === "building") a.building++;
      if (role === "maintaining") a.maintaining++;
      return a;
    },
    { building: 0, maintaining: 0 }
  );
  return (
    <View style={styles.summary}>
      <View style={styles.daySummaryHead}>
        <Text style={styles.dayName}>{day.day_name}</Text>
        <Text style={styles.dayFocus}>{day.day_goal || day.focus}</Text>
      </View>
      <View style={styles.metrics}>
        <Metric label="LAST TRAINED" value={dates.length ? formatDate(dates[dates.length - 1]) : "No session"} />
        <Metric label="NEXT EXPECTED" value={nextScheduled(day.day_name, schedule)} />
        <Metric label="BUILDING" value={`${counts.building} lifts`} accent />
        <Metric label="MAINTAINING" value={`${counts.maintaining} lifts`} />
      </View>
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

function ExerciseSummary({
  exercise,
  onPress,
}: {
  exercise: ProjectedExercise;
  onPress: () => void;
}) {
  const role = roleFor(exercise);
  const target = peak(exercise.realistic);
  const sessions = lastSessions(exercise, 2);
  const goalLine = summaryGoalLine(exercise, role, target);

  return (
    <TouchableOpacity style={styles.summaryCard} onPress={onPress} activeOpacity={0.85}>
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
    <TouchableOpacity style={styles.summaryCard} onPress={onPress} activeOpacity={0.85}>
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
  );
}

function ExerciseDetailModal({
  detail,
  onClose,
  onEdit,
}: {
  detail: DetailSelection | null;
  onClose: () => void;
  onEdit?: (prompt: string) => void;
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
              <FocusExerciseDetail exercise={detail.exercise} onEdit={onEdit} onClose={onClose} />
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function FocusExerciseDetail({
  exercise,
  onEdit,
  onClose,
}: {
  exercise: ProjectedExercise;
  onEdit?: (prompt: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("history");
  const role = roleFor(exercise);

  return (
    <>
      <DetailTabBar tab={tab} onChange={setTab} />
      {tab === "history" ? (
        <GoalHistoryTab exercise={exercise} role={role} onEdit={onEdit} onClose={onClose} />
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
}: {
  exercise: ProjectedExercise;
  role: Role;
  onEdit?: (prompt: string) => void;
  onClose: () => void;
}) {
  const sessions = useMemo(() => getSessionRecords(exercise), [exercise]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [setFilter, setSetFilter] = useState<SetFilter>("all");

  const target = peak(exercise.realistic);
  const current = exercise.current || exercise.realistic[0];
  const progressPct =
    role === "building" && current && target?.e1rm
      ? Math.min(100, Math.round((current.e1rm / target.e1rm) * 100))
      : 0;

  const selectedIndex = sessions.findIndex((s) => s.key === selectedKey);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : Math.max(0, sessions.length - 1);
  const selected = sessions[activeIndex];

  const maxSets = sessions.reduce((max, session) => Math.max(max, session.sets.length), 0);
  const setFilters: SetFilter[] = ["all", ...Array.from({ length: maxSets }, (_, i) => i + 1)];

  return (
    <>
      <View style={styles.detailSection}>
        <View style={styles.detailTopRow}>
          <RoleBadge role={role} />
          <TouchableOpacity
            onPress={() => {
              onEdit?.(`I want to revise the goal for ${exercise.exercise_name}. `);
              onClose();
            }}
          >
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sessionChipRow}>
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
                      {session.e1rm} e1RM
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
            <InteractiveHistoryChart
              sessions={sessions}
              setFilter={setFilter}
              selectedIndex={activeIndex}
              onSelectIndex={(index) => setSelectedKey(sessions[index]?.key ?? null)}
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
  const target = peak(exercise.realistic);
  const progress =
    role === "building" && current && target?.e1rm
      ? Math.min(100, Math.round((current.e1rm / target.e1rm) * 100))
      : 0;
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

      {role !== "support" ? (
        <View style={styles.detailSection}>
          <Text style={styles.chartLabel}>HISTORY &amp; 12-WEEK ROADMAP</Text>
          <Trajectory exercise={exercise} flat={flatChart} />
        </View>
      ) : null}

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

function InteractiveHistoryChart({
  sessions,
  setFilter,
  selectedIndex,
  onSelectIndex,
}: {
  sessions: SessionRecord[];
  setFilter: SetFilter;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
}) {
  const width = Math.min(Dimensions.get("window").width - 68, 520);
  const height = 120;

  const points = useMemo(() => {
    return sessions
      .map((session, index) => {
        let value = 0;
        if (setFilter === "all") {
          value = session.e1rm;
        } else {
          const set = session.sets[setFilter - 1];
          value = set ? calcE1rm(set.weight, set.reps) : 0;
        }
        return { date: session.date, value, index };
      })
      .filter((point) => point.value > 0);
  }, [sessions, setFilter]);

  if (points.length < 2) {
    return (
      <Text style={styles.mutedSmall}>
        {points.length === 1 ? "One session logged — chart starts at two." : "No sets to chart for this filter."}
      </Text>
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values) * 0.96;
  const max = Math.max(...values) * 1.04;
  const span = max - min || 1;
  const coords = points.map((point, i) => ({
    x: 8 + (i / (points.length - 1)) * (width - 16),
    y: 10 + (1 - (point.value - min) / span) * 66,
    sessionIndex: point.index,
  }));

  return (
    <View style={styles.historyChart}>
      <Svg width={width} height={height}>
        {[10, 43, 76].map((y) => (
          <Line key={y} x1="8" x2={width - 8} y1={y} y2={y} stroke="#252529" strokeDasharray="3 5" />
        ))}
        <Polyline
          points={coords.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={colors.ai}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map((p, i) => {
          const selected = p.sessionIndex === selectedIndex;
          return (
            <Circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={selected ? 8 : 5}
              fill={selected ? colors.accentPrimary : i === coords.length - 1 ? "#fff" : colors.ai}
              stroke={selected ? "#fff" : "transparent"}
              strokeWidth={2}
              onPress={() => onSelectIndex(p.sessionIndex)}
            />
          );
        })}
        <SvgText x="8" y="100" fill={colors.textMuted} fontSize="9">
          {shortDate(points[0].date)}
        </SvgText>
        <SvgText x={width - 46} y="100" fill={colors.textMuted} fontSize="9">
          {shortDate(points[points.length - 1].date)}
        </SvgText>
      </Svg>
      <Text style={styles.chartCaption}>
        Tap a point to inspect that session · estimated 1RM
      </Text>
    </View>
  );
}

function getSessionRecords(exercise: ProjectedExercise): SessionRecord[] {
  const primary = exercise.recent_sessions || [];
  const fallback = exercise.history_context?.recent_sessions || [];
  const merged = primary.length ? primary : fallback;
  const seen = new Set<string>();

  const raw = merged
    .filter((session) => session.date && !String(session.date).startsWith("week-"))
    .filter((session) => {
      const key = String(session.date);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const chronological = [...raw].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return chronological.map((session, index) => {
    const sets = (session.sets || [])
      .filter((set) => set.completed !== false && (set.reps || 0) > 0)
      .map((set, setIndex) => ({
        setNumber: setIndex + 1,
        weight: set.weight || 0,
        reps: set.reps || 0,
      }));

    const topSet = sets.reduce(
      (best, set) => (calcE1rm(set.weight, set.reps) > calcE1rm(best.weight, best.reps) ? set : best),
      sets[0] || { setNumber: 1, weight: 0, reps: 0 }
    );

    const e1rm = sets.length ? Math.max(...sets.map((set) => calcE1rm(set.weight, set.reps))) : 0;

    return {
      key: `${session.date}-${index}`,
      date: String(session.date),
      sets,
      topSet: { weight: topSet.weight, reps: topSet.reps },
      e1rm: Math.round(e1rm),
    };
  });
}

function calcE1rm(weight: number, reps: number) {
  if (!weight && !reps) return 0;
  return (weight || 0) * (1 + (reps || 0) / 30);
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
  const allSessions = exercise.recent_sessions || [];
  const allSets = allSessions.flatMap((session) =>
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

function ProgressionTable({ exercise, flat }: { exercise: ProjectedExercise; flat: boolean }) {
  const rows = useMemo(() => {
    const source = [exercise.current, ...exercise.realistic].filter(Boolean) as WeekPoint[];
    return source.map((point, index) => ({
      key: `${point.week}-${index}`,
      label: index === 0
        ? (exercise.seeded_from_history ? "Last logged" : "Starting estimate")
        : `Week ${point.week || index}`,
      target: formatTarget(point),
      e1rm: point.e1rm ? `${Math.round(point.e1rm)} e1RM` : "—",
    }));
  }, [exercise, flat]);

  if (!rows.length) {
    return <Text style={styles.mutedSmall}>No progression data yet</Text>;
  }

  return (
    <View style={styles.progressionTable}>
      {rows.map((row) => (
        <View key={row.key} style={styles.progressionRow}>
          <Text style={styles.progressionWeek}>{row.label}</Text>
          <Text style={styles.progressionTarget}>{row.target}</Text>
          <Text style={styles.progressionE1rm}>{row.e1rm}</Text>
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
  if (role === "building" && target) {
    return `Goal · ${formatTarget(target)} by ${targetDate(exercise.realistic.length)}`;
  }
  if (role === "support") {
    return `Target · ${formatSupportTarget(exercise)} reps`;
  }
  return "Holding steady — not a plateau.";
}

function detailGoalHeadline(exercise: ProjectedExercise, role: Role, target?: WeekPoint | null) {
  if (role === "building" && target) {
    return `${formatTarget(target)} by ${targetDate(exercise.realistic.length)}`;
  }
  if (role === "support") {
    return `${formatSupportTarget(exercise)} reps`;
  }
  return "Holding steady — not a plateau.";
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
 * plotted on one shared estimated-1RM scale so the join is honest rather than
 * two graphs stacked. History is solid and lighter, projection is the accent
 * colour, and the ceiling stays dashed.
 */
function Trajectory({ exercise, flat }: { exercise: ProjectedExercise; flat: boolean }) {
  const width = Math.min(Dimensions.get("window").width - 68, 520);
  const height = 152;
  const plotTop = 12;
  const plotHeight = 78;
  const accent = flat ? colors.ai : colors.accentPrimary;

  const chart = useMemo(() => {
    const forward = [exercise.current, ...exercise.realistic].filter(Boolean) as WeekPoint[];
    const ceiling = [exercise.current, ...(exercise.best_case || [])].filter(
      Boolean
    ) as WeekPoint[];

    const past = (
      exercise.history_context?.recent_sessions?.length
        ? exercise.history_context.recent_sessions
        : exercise.recent_sessions || []
    )
      .filter((session) => session.date && !String(session.date).startsWith("week-"))
      .map((session) => ({
        date: String(session.date),
        e1rm: Math.max(
          0,
          ...(session.sets || []).map((set) => (set.weight || 0) * (1 + (set.reps || 0) / 30))
        ),
      }))
      .filter((point) => point.e1rm > 0)
      // The API returns newest first; a timeline reads oldest to newest.
      .reverse();

    if (!forward.length && !past.length) return null;

    const forwardValues = forward.map((p) => (flat && forward.length ? forward[0].e1rm : p.e1rm));
    const ceilingValues = flat ? [] : ceiling.map((p) => p.e1rm);
    const pastValues = past.map((p) => p.e1rm);
    const all = [...forwardValues, ...ceilingValues, ...pastValues];
    if (!all.length) return null;

    const min = Math.min(...all) * 0.96;
    const max = Math.max(...all) * 1.04;
    const span = max - min || 1;
    const y = (value: number) => plotTop + (1 - (value - min) / span) * plotHeight;

    // Today sits proportionally: a long history earns more of the width, but
    // never so much that the roadmap is squeezed out of view.
    const historySteps = Math.max(past.length - 1, 0);
    const forwardSteps = Math.max(forward.length - 1, 1);
    const rawShare = historySteps / (historySteps + forwardSteps || 1);
    const share = past.length < 2 ? 0 : Math.min(0.5, Math.max(0.2, rawShare));
    const left = 8;
    const right = width - 8;
    const todayX = left + share * (right - left);

    const pastPoints = past.map((point, i) => ({
      x: historySteps ? left + (i / historySteps) * (todayX - left) : todayX,
      y: y(point.e1rm),
    }));
    const project = (points: WeekPoint[], values: number[]) =>
      points.map((_, i) => ({
        x: todayX + (i / forwardSteps) * (right - todayX),
        y: y(values[i]),
      }));

    return {
      past: pastPoints,
      forward: project(forward, forwardValues),
      ceiling: flat || ceiling.length < 2 ? [] : project(ceiling, ceilingValues),
      todayX,
      firstDate: past.length ? past[0].date : null,
      sessionCount: past.length,
    };
  }, [exercise, flat, width]);

  if (!chart) {
    return <Text style={styles.mutedSmall}>No data for this exercise yet.</Text>;
  }

  const line = (points: { x: number; y: number }[]) =>
    points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <View>
      <Svg width={width} height={height}>
        {[15, 52, 89].map((y) => (
          <Line key={y} x1="8" x2={width - 8} y1={y} y2={y} stroke="#252529" strokeDasharray="3 5" />
        ))}

        {/* The boundary between what happened and what is predicted */}
        <Line
          x1={chart.todayX}
          x2={chart.todayX}
          y1={plotTop - 4}
          y2={plotTop + plotHeight + 6}
          stroke={colors.borderHover}
          strokeWidth="1"
        />

        {chart.past.length > 1 ? (
          <Polyline
            points={line(chart.past)}
            fill="none"
            stroke={colors.textSecondary}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {chart.past.map((p, i) => (
          <Circle key={`h-${i}`} cx={p.x} cy={p.y} r={2.5} fill={colors.textSecondary} />
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
          <SvgText x="8" y={height - 26} fill={colors.textMuted} fontSize="9">
            {shortDate(chart.firstDate)}
          </SvgText>
        ) : null}
        <SvgText
          x={chart.todayX}
          y={height - 26}
          fill={colors.textSecondary}
          fontSize="9"
          textAnchor="middle"
        >
          TODAY
        </SvgText>
        <SvgText x={width - 34} y={height - 26} fill={colors.textMuted} fontSize="9">
          12 WK
        </SvgText>
      </Svg>

      <View style={styles.legend}>
        {chart.sessionCount > 1 ? (
          <View style={styles.legendItem}>
            <View style={[styles.legendSolid, { backgroundColor: colors.textSecondary }]} />
            <Text style={styles.legendText}>
              Logged — {chart.sessionCount} sessions you actually did
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
    </View>
  );
}

function lastSessions(exercise: ProjectedExercise, limit: number) {
  const primary = exercise.recent_sessions || [];
  const fallback = exercise.history_context?.recent_sessions || [];
  const merged = primary.length ? primary : fallback;
  const seen = new Set<string>();

  const sessions = merged
    .filter((session) => session.date && !String(session.date).startsWith("week-"))
    .filter((session) => {
      const key = session.date || "";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);

  return sessions.map((session, index) => {
    const sets = (session.sets || [])
      .filter((set) => set.completed !== false)
      .map((set) => {
        const weight = set.weight || 0;
        const reps = set.reps || 0;
        if (weight > 0) return `${weight}×${reps}`;
        if (reps > 0) return `${reps} reps`;
        return null;
      })
      .filter(Boolean) as string[];

    const topSet = (
      "top_set" in session && session.top_set ? session.top_set : null
    ) as { weight?: number; reps?: number } | null;
    const displaySets =
      sets.length > 0
        ? sets
        : topSet && (topSet.reps || topSet.weight)
          ? [
              (topSet.weight || 0) > 0
                ? `${topSet.weight}×${topSet.reps}`
                : `${topSet.reps} reps`,
            ]
          : [];

    const dateLabel = session.date ? formatDate(session.date) : "Unknown date";
    return {
      key: `${session.date || "unknown"}-${index}`,
      label: displaySets.length
        ? `${dateLabel} · ${displaySets.join(", ")}`
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

function shortDay(s: string) {
  return s.replace(/\s+(day|workout)$/i, "");
}

function nextScheduled(day: string, schedule?: Record<string, string>) {
  if (!schedule) return "Not scheduled";
  const today = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (schedule[WEEKDAYS[d.getDay()]] === day) {
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
  progressionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  progressionWeek: { width: 56, fontSize: 11, fontWeight: "700", color: colors.textSecondary },
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
