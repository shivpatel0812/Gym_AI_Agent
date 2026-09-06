import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  borderRadius,
  colors,
  domainSeries,
  series,
  spacing,
  typography,
  weight,
} from "../../theme";
import Sparkline from "../home/Sparkline";
import GoalsSection from "./GoalsSection";
import IndexChart from "./IndexChart";
import PhotoStrip from "./PhotoStrip";
import {
  getGoals,
  getPhotoHub,
  getProgressHub,
  getProgressProjection,
} from "../../api/progress";
import type {
  Domain,
  ForwardProjection,
  Goal,
  IndexPoint,
  PhotoHub,
  Position,
  ProgressEvent,
  ProgressHub as Hub,
  ProgressState,
  ScanCompare,
  ScanRegionChange,
} from "../../api/progress";

/**
 * The progress hub.
 *
 * A stock profile for training: one index over time, the domains under it, the
 * lifts as positions, and a feed of what happened so a move in the line has a
 * cause next to it.
 *
 * The states are deliberately not a good/bad axis. "Holding" is neutral ink,
 * not a warning colour — one light week is a week, and a hub that scolds after
 * every below-average one is the failure mode this feature exists to avoid.
 */

const RANGES = [
  { label: "2M", weeks: 8 },
  { label: "3M", weeks: 12 },
  { label: "6M", weeks: 26 },
  { label: "1Y", weeks: 52 },
];

const STATE_STYLE: Record<
  ProgressState,
  { color: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }
> = {
  building: { color: colors.success, icon: "trending-up" },
  holding: { color: colors.textMutedCool, icon: "trending-neutral" },
  stalled: { color: colors.warning, icon: "minus-circle-outline" },
  declining: { color: colors.attention, icon: "trending-down" },
  unknown: { color: colors.textFaintCool, icon: "progress-clock" },
};

const EVENT_ICON: Record<
  ProgressEvent["kind"],
  keyof typeof MaterialCommunityIcons.glyphMap
> = {
  pr: "trophy-outline",
  scan: "camera-outline",
  planned_low: "calendar-check-outline",
  no_evidence: "cloud-off-outline",
};

function fmt(value: number | null | undefined, digits = 0) {
  return value == null ? "—" : value.toFixed(digits);
}

function signed(value: number | null | undefined, digits = 1) {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export default function ProgressHub() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [weeks, setWeeks] = useState(12);
  const [hub, setHub] = useState<Hub | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [projection, setProjection] = useState<ForwardProjection | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [photos, setPhotos] = useState<PhotoHub | null>(null);

  const load = useCallback(
    async (nextWeeks: number) => {
      setLoading(true);
      setError(null);
      try {
        const [next, photoHub] = await Promise.all([
          getProgressHub(nextWeeks),
          // A failure here must not blank the whole screen — the index is the
          // point, the strip around it is not.
          getPhotoHub(nextWeeks).catch(() => null),
        ]);
        setHub(next);
        // Goals ride along on the hub payload; evaluating them needs a built
        // hub, so asking for them separately would rebuild it.
        setGoals(next.goals ?? []);
        setPhotos(photoHub);
      } catch {
        // Visible, retryable. A swallowed failure renders as an empty hub and
        // reads to the user as "I have made no progress".
        setError("Could not load your progress.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      void load(weeks);
    }, [load, weeks])
  );

  // Laid over the hub afterwards, and only once: the engine walks every
  // planned lift forward, so it is much the slowest call on the screen — and
  // it projects a fixed horizon, so changing the *history* range cannot change
  // its answer. Refetching it on every range chip would pay the highest cost
  // on the screen for an identical result.
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void getProgressProjection(8)
      .then(setProjection)
      // A missing plan or thin history is an ordinary state here; the chart
      // simply renders without its forward pair.
      .catch(() => setProjection(null));
  }, []);

  const selectedPoint = useMemo(() => {
    if (!hub || scrub == null) return null;
    return hub.series[scrub] ?? null;
  }, [hub, scrub]);

  const eventsForSelected = useMemo(() => {
    if (!hub || !selectedPoint) return [];
    return hub.events.filter((e) => e.week_start === selectedPoint.week_start);
  }, [hub, selectedPoint]);

  const stateStyle = hub ? STATE_STYLE[hub.index.state] : STATE_STYLE.unknown;

  const positions: Position[] = useMemo(
    () =>
      hub?.domains.find((d) => d.key === "strength")?.detail.positions ?? [],
    [hub]
  );

  const refreshGoals = useCallback(() => {
    void getGoals()
      .then(setGoals)
      .catch(() => undefined);
  }, []);

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: Math.max(insets.top, spacing.md) }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <MaterialCommunityIcons
            name="chevron-left"
            size={26}
            color={colors.textPrimary}
          />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Progress</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing["2xl"] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.rangeRow}>
          {RANGES.map((range) => {
            const active = range.weeks === weeks;
            return (
              <TouchableOpacity
                key={range.label}
                onPress={() => {
                  // The old scrub index can point past the end of a shorter
                  // series.
                  setScrub(null);
                  setWeeks(range.weeks);
                }}
                style={[styles.rangeChip, active && styles.rangeChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.rangeText, active && styles.rangeTextActive]}>
                  {range.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading && !hub ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accentPrimary} />
            <Text style={styles.mutedText}>Reading your last {weeks} weeks…</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={18}
              color={colors.attention}
            />
            <Text style={styles.errorText} accessibilityRole="alert">
              {error}
            </Text>
            <TouchableOpacity onPress={() => void load(weeks)} hitSlop={10}>
              <Text style={styles.retry}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {hub ? (
          <>
            {/* Hero — the level, what it is doing, and why. */}
            <View style={styles.hero}>
              <Text style={styles.heroLabel}>PROGRESS INDEX</Text>
              <View style={styles.heroRow}>
                <Text style={styles.heroValue}>
                  {selectedPoint
                    ? fmt(selectedPoint.level, 1)
                    : fmt(hub.index.level, 1)}
                </Text>
                <View style={[styles.stateChip, { borderColor: stateStyle.color }]}>
                  <MaterialCommunityIcons
                    name={stateStyle.icon}
                    size={14}
                    color={stateStyle.color}
                  />
                  <Text style={[styles.stateText, { color: stateStyle.color }]}>
                    {hub.index.state_label}
                  </Text>
                </View>
              </View>

              {selectedPoint ? (
                <Text style={styles.heroSub}>
                  Week of {selectedPoint.label}
                  {selectedPoint.planned_low ? " · planned light week" : ""}
                  {selectedPoint.level == null ? " · nothing logged" : ""}
                </Text>
              ) : (
                <Text style={styles.heroSub}>
                  {signed(hub.index.range_delta.value)} over {hub.weeks} weeks
                  {hub.index.range_delta.drivers.length
                    ? ` · mostly ${hub.index.range_delta.drivers[0].label.toLowerCase()} ${signed(
                        hub.index.range_delta.drivers[0].change
                      )}`
                    : ""}
                </Text>
              )}

              <Text style={styles.reason}>{hub.index.reason}</Text>
            </View>

            <IndexChart
              points={hub.series}
              projection={projection}
              selected={scrub}
              onSelect={setScrub}
            />
            <Text style={styles.scrubHint}>
              {selectedPoint
                ? "Tap another point, or Clear below."
                : "Tap a point to see that week's numbers."}
            </Text>

            {selectedPoint ? (
              <WeekDetailCard
                point={selectedPoint}
                domains={hub.domains}
                events={eventsForSelected}
                onClear={() => setScrub(null)}
              />
            ) : null}

            {/* Coverage — reported, never folded into the number. */}
            <View style={styles.statGrid}>
              <Stat
                label="Weeks logged"
                value={`${hub.coverage.weeks_with_data}/${hub.coverage.weeks_total}`}
              />
              <Stat label="Sessions" value={String(hub.coverage.sessions_logged)} />
              <Stat
                label="Food days"
                value={String(hub.coverage.days_food_logged)}
              />
              <Stat label="Weigh-ins" value={String(hub.coverage.weigh_ins)} />
            </View>
            <View style={[styles.statGrid, { marginTop: spacing.sm }]}>
              <Stat
                label="Sleep nights"
                value={String(hub.coverage.nights_sleep_logged ?? 0)}
              />
              <Stat
                label="Hydration"
                value={String(hub.coverage.days_hydration_logged ?? 0)}
              />
              <Stat
                label="Stress"
                value={String(hub.coverage.days_stress_logged ?? 0)}
              />
              <Stat
                label="Activity"
                value={String(hub.coverage.days_activity_logged ?? 0)}
              />
            </View>
            <Text style={styles.footnote}>
              Coverage is shown, not scored. Domains you do not log (sleep,
              hydration, stress, steps, weigh-ins) stay out of the index until
              you have enough days — they never drag the number down as zeros.
            </Text>

            {projection?.available && projection.assumption ? (
              <Text style={styles.footnote}>{projection.assumption}</Text>
            ) : null}

            <GoalsSection
              goals={goals}
              positions={positions}
              onChanged={refreshGoals}
            />

            <PhotoStrip hub={photos} />

            <ScanCompareCard compare={hub.scan_compare} />

            <Text style={styles.sectionLabel}>DOMAINS</Text>
            {hub.domains.map((domain) => (
              <DomainCard key={domain.key} domain={domain} />
            ))}

            <PositionsCard hub={hub} />

            {hub.events.length ? (
              <>
                <Text style={styles.sectionLabel}>WHAT HAPPENED</Text>
                {hub.events.slice(0, 8).map((event, i) => (
                  <View key={`${event.week_start}-${event.kind}-${i}`} style={styles.eventRow}>
                    <MaterialCommunityIcons
                      name={EVENT_ICON[event.kind]}
                      size={16}
                      color={colors.textMutedCool}
                    />
                    <View style={styles.eventBody}>
                      <Text style={styles.eventTitle}>{event.title}</Text>
                      <Text style={styles.eventDetail}>{event.detail}</Text>
                    </View>
                  </View>
                ))}
              </>
            ) : null}

            <Text style={styles.version}>
              Scoring {hub.formula_version} · relative to your own plan, not to
              anyone else.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const DOMAIN_ORDER = [
  "strength",
  "consistency",
  "nutrition",
  "body",
  "sleep",
  "hydration",
  "stress",
  "activity",
] as const;

/**
 * What one week of the index is made of — domain levels that week, plus any
 * events tagged to it. Lives under the chart so a tap has somewhere to land.
 */
function WeekDetailCard({
  point,
  domains,
  events,
  onClear,
}: {
  point: IndexPoint;
  domains: Domain[];
  events: ProgressEvent[];
  onClear: () => void;
}) {
  const labels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of domains) map[d.key] = d.label;
    return map;
  }, [domains]);

  const rows = DOMAIN_ORDER.map((key) => ({
    key,
    label: labels[key] ?? key,
    value: point.contributions?.[key] ?? null,
  })).filter((row) => {
    // Only show domains that exist on the hub — optional lifestyle ones stay
    // off the week card until the user has enough logs to score them.
    return labels[row.key] != null;
  });

  return (
    <View style={styles.weekCard}>
      <View style={styles.cardHead}>
        <View>
          <Text style={styles.weekEyebrow}>WEEK OF</Text>
          <Text style={styles.cardTitle}>{point.label}</Text>
        </View>
        <TouchableOpacity
          onPress={onClear}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear week selection"
        >
          <Text style={styles.clearWeek}>Clear</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.weekHeroRow}>
        <View>
          <Text style={styles.weekHeroValue}>{fmt(point.level, 1)}</Text>
          <Text style={styles.cardMeta}>Index that week</Text>
        </View>
        <View style={styles.weekMetaCol}>
          <Text style={styles.weekMetaValue}>
            {Math.round((point.confidence ?? 0) * 100)}%
          </Text>
          <Text style={styles.cardMeta}>Coverage</Text>
        </View>
      </View>

      {point.planned_low ? (
        <Text style={styles.weekFlag}>Planned light week</Text>
      ) : null}
      {point.level == null ? (
        <Text style={styles.weekFlag}>Nothing logged this week</Text>
      ) : null}
      {point.estimated && point.level != null ? (
        <Text style={styles.weekFlag}>Estimate softening — thin coverage</Text>
      ) : null}

      <Text style={styles.weekSection}>IN THIS NUMBER</Text>
      {rows.map((row) => (
        <View key={row.key} style={styles.contribRow}>
          <View style={styles.titleRow}>
            <View
              style={[
                styles.swatch,
                { backgroundColor: domainSeries[row.key] ?? series.mark },
              ]}
            />
            <Text style={styles.contribLabel}>{row.label}</Text>
          </View>
          <Text style={styles.contribValue}>{fmt(row.value, 0)}</Text>
        </View>
      ))}

      <Text style={styles.weekSection}>THAT WEEK</Text>
      {events.length ? (
        events.map((event, i) => (
          <View
            key={`${event.week_start}-${event.kind}-${i}`}
            style={styles.eventRow}
          >
            <MaterialCommunityIcons
              name={EVENT_ICON[event.kind]}
              size={16}
              color={colors.textMutedCool}
            />
            <View style={styles.eventBody}>
              <Text style={styles.eventTitle}>{event.title}</Text>
              <Text style={styles.eventDetail}>{event.detail}</Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.cardEmpty}>No PRs, scans, or flags that week.</Text>
      )}
    </View>
  );
}

function DomainCard({ domain }: { domain: Domain }) {
  const spark = domain.series.map((p) => ({
    label: "",
    value: p.level,
  }));
  const values = spark
    .map((p) => p.value)
    .filter((v): v is number => v != null);
  // Pad the domain so a two-point wobble does not fill the frame and read as
  // a collapse.
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 100;
  const pad = Math.max((hi - lo) * 0.25, 4);

  if (domain.unavailable_reason) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{domain.label}</Text>
        <Text style={styles.cardEmpty}>{domain.unavailable_reason}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.titleRow}>
          <View
            style={[
              styles.swatch,
              { backgroundColor: domainSeries[domain.key] ?? series.mark },
            ]}
          />
          <Text style={styles.cardTitle}>{domain.label}</Text>
        </View>
        <Text style={styles.cardValue}>{fmt(domain.level, 0)}</Text>
      </View>
      <View style={styles.cardHead}>
        <Text style={styles.cardMeta}>
          {signed(domain.change)} over range
          {domain.estimated ? " · estimate softening" : ""}
        </Text>
        <Text style={styles.cardMeta}>
          {Math.round(domain.coverage * 100)}% logged
        </Text>
      </View>
      <Sparkline
        points={spark}
        color={domainSeries[domain.key] ?? series.mark}
        height={56}
        min={lo - pad}
        max={hi + pad}
      />
      <Text style={styles.cardDetail}>{domainDetail(domain)}</Text>
      {domain.lever ? (
        <View style={styles.leverRow}>
          <MaterialCommunityIcons
            name="arrow-up-circle-outline"
            size={14}
            color={colors.accentPrimary}
          />
          <Text style={styles.leverText}>
            Biggest lever: {domain.lever.label}
            {domain.lever.value != null && domain.lever.target != null
              ? ` — ${Math.round(domain.lever.value)} vs ${Math.round(
                  domain.lever.target
                )}${domain.lever.unit || ""}`
              : ""}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const SCAN_DIRECTION: Record<string, { color: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }> = {
  improved: { color: colors.success, icon: "arrow-up" },
  regressed: { color: colors.attention, icon: "arrow-down" },
  unchanged: { color: colors.textMutedCool, icon: "minus" },
};

function ScanRow({ row }: { row: ScanRegionChange }) {
  const style = row.direction ? SCAN_DIRECTION[row.direction] : null;
  return (
    <View style={styles.scanRow}>
      <Text style={styles.scanLabel}>{row.label}</Text>
      <View style={styles.scanChange}>
        <Text style={styles.scanFrom}>{row.from ?? "—"}</Text>
        {style ? (
          <MaterialCommunityIcons name={style.icon} size={13} color={style.color} />
        ) : (
          <Text style={styles.scanFrom}>→</Text>
        )}
        <Text style={[styles.scanTo, style ? { color: style.color } : null]}>
          {row.to ?? "—"}
        </Text>
      </View>
    </View>
  );
}

/**
 * Scan change across the range.
 *
 * No photos, and the card says why rather than leaving a gap where a
 * before/after would go — scans keep written observations only, by design.
 */
function ScanCompareCard({ compare }: { compare: ScanCompare | null }) {
  if (!compare) return null;

  // Someone who has never scanned does not need a card telling them so; one
  // scan is worth prompting on, because a second makes it a comparison.
  if (!compare.available && compare.scan_count === 0) return null;

  if (!compare.available) {
    return (
      <>
        <Text style={styles.sectionLabel}>BODY SCAN</Text>
        <View style={styles.card}>
          <Text style={styles.cardEmpty}>{compare.reason}</Text>
        </View>
      </>
    );
  }

  const moved = compare.changed ?? [];
  const posture = compare.posture ?? [];

  return (
    <>
      <Text style={styles.sectionLabel}>BODY SCAN</Text>
      <View style={styles.card}>
        <Text style={styles.cardDetail}>
          {compare.from_date} → {compare.to_date} · {compare.scan_count} scans
        </Text>
        {moved.length ? (
          moved.map((row) => <ScanRow key={row.key} row={row} />)
        ) : (
          <Text style={styles.cardEmpty}>
            No region changed enough to call between these two scans.
          </Text>
        )}
        {posture.length ? (
          <>
            <Text style={styles.scanSubhead}>POSTURE</Text>
            {posture.map((row) => (
              <ScanRow key={row.key} row={row} />
            ))}
          </>
        ) : null}
        {compare.unread?.length ? (
          <Text style={styles.footnote}>
            Not readable in both scans: {compare.unread.join(", ")}.
          </Text>
        ) : null}
        <Text style={styles.footnote}>{compare.note}</Text>
      </View>
    </>
  );
}

function domainDetail(domain: Domain): string {
  const d = domain.detail;
  switch (domain.key) {
    case "strength":
      return `${d.tracked ?? 0} lift${d.tracked === 1 ? "" : "s"} tracked. 100 is where each one started.`;
    case "consistency":
      return `${d.sessions_last_week ?? 0} of ${fmt(d.expected_per_week)} sessions last week.`;
    case "nutrition":
      return `${d.days_logged_last_week ?? 0} days logged last week against ${
        d.calorie_target ?? "—"
      } kcal and ${d.protein_target ?? "—"}g protein.`;
    case "body":
      return d.latest_weight_lb
        ? `${d.latest_weight_lb} lb smoothed, ${signed(d.change_lb)} lb over range. 100 is your goal's expected pace.`
        : "Not enough weigh-ins to read a trend.";
    case "sleep":
    case "hydration":
    case "stress":
    case "activity":
      return d.target != null
        ? `${d.days_logged_last_week ?? 0} days last week · target ${d.target}${
            d.unit ? ` ${d.unit}` : ""
          } (${d.target_source === "declared" ? "your goal" : "your usual"}). 100 is hitting it.`
        : "Not enough logs yet.";
    default:
      return "";
  }
}

function PositionsCard({ hub }: { hub: Hub }) {
  const strength = hub.domains.find((d) => d.key === "strength");
  const positions = strength?.detail.positions ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  if (!positions.length) return null;

  return (
    <>
      <Text style={styles.sectionLabel}>LIFTS</Text>
      <View style={styles.card}>
        <Text style={styles.cardDetail}>
          Each lift is a position. The price is its peak estimated 1RM, which
          does not fall because of one bad session. Tap + to see the sets
          behind the %.
        </Text>
        {positions.map((p) => {
          const open = openId === p.exercise_id;
          return (
            <View key={p.exercise_id} style={styles.positionBlock}>
              <View style={styles.positionRow}>
                <View style={styles.positionName}>
                  <Text style={styles.positionTitle} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={styles.positionSub}>
                    {p.peak_e1rm} lb peak
                    {p.weeks_stale > 0
                      ? ` · ${p.weeks_stale}w since trained`
                      : ""}
                    {p.estimated ? " · softening" : ""}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.positionChange,
                    {
                      color:
                        p.change_pct > 0
                          ? colors.success
                          : p.change_pct < 0
                          ? colors.attention
                          : colors.textMutedCool,
                    },
                  ]}
                >
                  {signed(p.change_pct)}%
                </Text>
                <TouchableOpacity
                  onPress={() =>
                    setOpenId(open ? null : p.exercise_id)
                  }
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={
                    open
                      ? `Hide records for ${p.name}`
                      : `Show records for ${p.name}`
                  }
                  accessibilityState={{ expanded: open }}
                  style={styles.positionPlus}
                >
                  <MaterialCommunityIcons
                    name={open ? "minus" : "plus"}
                    size={18}
                    color={colors.accentPrimary}
                  />
                </TouchableOpacity>
              </View>
              {open ? <PositionRecords position={p} /> : null}
            </View>
          );
        })}
      </View>
    </>
  );
}

/**
 * The sets that earned the %. Baseline is week one of the lift in range;
 * peak is the best e1RM since — change_pct is peak ÷ baseline − 1.
 */
function PositionRecords({ position }: { position: Position }) {
  const history = position.history ?? [];
  if (!history.length) {
    return (
      <Text style={styles.cardEmpty}>
        No weekly sets attached for this lift yet.
      </Text>
    );
  }

  return (
    <View style={styles.recordsBox}>
      <Text style={styles.recordsMath}>
        {position.peak_e1rm} peak ÷ {position.baseline_e1rm} baseline − 1 ={" "}
        {signed(position.change_pct)}%
      </Text>
      {history.map((row) => {
        const tags = [
          row.is_baseline ? "baseline" : null,
          row.is_peak ? "peak" : null,
        ].filter(Boolean);
        return (
          <View key={row.week_start} style={styles.recordRow}>
            <View style={styles.recordLeft}>
              <Text style={styles.recordWeek}>{row.label}</Text>
              {tags.length ? (
                <Text style={styles.recordTag}>{tags.join(" · ")}</Text>
              ) : null}
            </View>
            <Text style={styles.recordSet}>
              {fmt(row.weight, 1)} × {row.reps}
            </Text>
            <Text style={styles.recordE1rm}>{fmt(row.e1rm, 1)} e1RM</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  topTitle: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: weight.bold,
  },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  centered: { paddingVertical: spacing["2xl"], alignItems: "center", gap: spacing.sm },
  mutedText: { color: colors.textMutedCool, fontSize: typography.caption },

  rangeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  rangeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 36,
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: colors.cardBackground,
  },
  rangeChipActive: { backgroundColor: colors.accentPrimary },
  rangeText: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    fontWeight: weight.bold,
  },
  rangeTextActive: { color: colors.onAccent },

  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { flex: 1, color: colors.textMutedCool, fontSize: typography.caption },
  retry: {
    color: colors.accentPrimary,
    fontSize: typography.caption,
    fontWeight: weight.bold,
  },

  hero: { marginBottom: spacing.md },
  heroLabel: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    fontWeight: weight.bold,
    letterSpacing: 1.4,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  heroValue: {
    color: colors.textPrimary,
    fontSize: typography.hero,
    fontWeight: weight.heavy,
  },
  stateChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  stateText: { fontSize: typography.caption, fontWeight: weight.bold },
  heroSub: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  reason: {
    color: colors.textPrimary,
    fontSize: typography.body,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  scrubHint: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    textAlign: "center",
    marginBottom: spacing.md,
  },

  weekCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderCool,
  },
  weekEyebrow: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    fontWeight: weight.bold,
    letterSpacing: 1.2,
  },
  clearWeek: {
    color: colors.accentPrimary,
    fontSize: typography.caption,
    fontWeight: weight.medium,
  },
  weekHeroRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  weekHeroValue: {
    color: colors.textPrimary,
    fontSize: typography.display,
    fontWeight: weight.heavy,
  },
  weekMetaCol: { alignItems: "flex-end" },
  weekMetaValue: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: weight.bold,
  },
  weekFlag: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    marginBottom: spacing.xs,
  },
  weekSection: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    fontWeight: weight.bold,
    letterSpacing: 1.2,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  contribRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  contribLabel: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: weight.medium,
  },
  contribValue: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: weight.bold,
  },

  statGrid: { flexDirection: "row", gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: weight.bold,
  },
  statLabel: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    marginTop: 2,
  },
  footnote: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    lineHeight: 15,
    marginTop: spacing.sm,
  },

  sectionLabel: {
    color: colors.textMutedCool,
    fontSize: typography.micro,
    fontWeight: weight.bold,
    letterSpacing: 1.4,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: weight.bold,
  },
  cardValue: {
    color: colors.textPrimary,
    fontSize: typography.display,
    fontWeight: weight.heavy,
  },
  cardMeta: { color: colors.textMutedCool, fontSize: typography.micro },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  scanRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
  },
  scanLabel: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: weight.medium,
  },
  scanChange: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  scanFrom: { color: colors.textFaintCool, fontSize: typography.caption },
  scanTo: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    fontWeight: weight.bold,
  },
  scanSubhead: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    fontWeight: weight.bold,
    letterSpacing: 1.2,
    marginTop: spacing.md,
  },
  cardDetail: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  cardEmpty: {
    color: colors.textFaintCool,
    fontSize: typography.caption,
    marginTop: spacing.xs,
    lineHeight: 17,
  },
  leverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  leverText: { flex: 1, color: colors.accentPrimary, fontSize: typography.caption },

  positionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
  },
  positionBlock: {},
  positionName: { flex: 1, paddingRight: spacing.sm },
  positionTitle: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: weight.medium,
  },
  positionSub: { color: colors.textFaintCool, fontSize: typography.micro, marginTop: 2 },
  positionChange: { fontSize: typography.body, fontWeight: weight.bold, marginRight: spacing.xs },
  positionPlus: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.surfaceSunken,
  },
  recordsBox: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceSunken,
    gap: spacing.xs,
  },
  recordsMath: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    marginBottom: spacing.xs,
    lineHeight: 17,
  },
  recordRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  recordLeft: { flex: 1, minWidth: 0 },
  recordWeek: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: weight.medium,
  },
  recordTag: {
    color: colors.accentPrimary,
    fontSize: typography.micro,
    marginTop: 1,
  },
  recordSet: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    fontVariant: ["tabular-nums"],
  },
  recordE1rm: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: weight.bold,
    fontVariant: ["tabular-nums"],
    minWidth: 72,
    textAlign: "right",
  },

  eventRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  eventBody: { flex: 1 },
  eventTitle: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: weight.medium,
  },
  eventDetail: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    marginTop: 2,
    lineHeight: 15,
  },
  version: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    textAlign: "center",
    marginTop: spacing.xl,
    lineHeight: 15,
  },
});
