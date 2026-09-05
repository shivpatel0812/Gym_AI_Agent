import { describe, expect, it } from "vitest";
import type { ProjectedExercise } from "../../api/trainingPlan";
import {
  buildExerciseChart,
  buildMuscleGroupPoints,
  compareSessions,
  daysBetween,
  getSessionRecords,
  parseDate,
  rollingAverage,
  sessionStimulus,
  sessionValue,
  trendColor,
  type LoggedSession,
} from "./chartUtils";

type RawSet = { set_number?: number; weight?: number; reps?: number; completed?: boolean };

/** Minimal ProjectedExercise — the chart layer only reads the history fields. */
function exercise(
  sessions: Array<{ date: string; sets?: RawSet[]; top_set?: { weight: number; reps: number } }>,
  extra: Partial<ProjectedExercise> = {}
): ProjectedExercise {
  return {
    exercise_id: "ex-1",
    exercise_name: "Incline Dumbbell Press",
    sets: 3,
    reps: 8,
    order: 1,
    day_name: "Push",
    sessions_per_week: 1,
    seeded_from_history: true,
    current: null,
    best_case: [],
    realistic: [],
    gain: {
      best_case_e1rm: 0,
      realistic_e1rm: 0,
      best_case_pct: null,
      realistic_pct: null,
    },
    recent_sessions: sessions,
    ...extra,
  } as ProjectedExercise;
}

const s = (weight: number, reps: number, extra: Partial<RawSet> = {}): RawSet => ({
  weight,
  reps,
  ...extra,
});

describe("parseDate", () => {
  it("reads a plain date at local noon, not UTC midnight", () => {
    const parsed = new Date(parseDate("2026-08-01"));
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(7);
    // The bug this guards: UTC midnight renders as July 31 west of Greenwich.
    expect(parsed.getDate()).toBe(1);
  });

  it("passes a full timestamp through instead of corrupting it", () => {
    expect(Number.isNaN(parseDate("2026-08-01T14:30:00Z"))).toBe(false);
  });

  it("returns NaN for junk rather than a silent epoch-zero date", () => {
    expect(Number.isNaN(parseDate("not-a-date"))).toBe(true);
  });
});

describe("daysBetween", () => {
  it("measures a real gap", () => {
    expect(daysBetween("2026-08-01", "2026-09-01")).toBe(31);
  });

  it("still measures a gap when dates carry a time component", () => {
    // Previously these produced an invalid date and silently returned 0, so a
    // three-month layoff was never detected as a gap at all.
    expect(daysBetween("2026-08-01T09:00:00Z", "2026-09-01T09:00:00Z")).toBe(31);
  });
});

describe("getSessionRecords", () => {
  it("keeps a session whose sets were all left unticked", () => {
    const records = getSessionRecords(
      exercise([
        {
          date: "2026-08-01",
          sets: [s(80, 6, { completed: false }), s(80, 5, { completed: false })],
          top_set: { weight: 80, reps: 6 },
        },
      ])
    );
    expect(records).toHaveLength(1);
    expect(records[0].topSet).toEqual({ weight: 80, reps: 6 });
  });

  it("drops a session with neither usable sets nor a top set", () => {
    expect(getSessionRecords(exercise([{ date: "2026-08-01", sets: [] }]))).toHaveLength(0);
  });

  it("preserves the logged set number when an earlier set is hidden", () => {
    const [record] = getSessionRecords(
      exercise([
        {
          date: "2026-08-01",
          sets: [
            s(80, 6, { set_number: 1 }),
            s(80, 5, { set_number: 2, completed: false }),
            s(75, 8, { set_number: 3 }),
          ],
        },
      ])
    );
    // Renumbering from 1 relabelled the user's set 3 as "Set 2".
    expect(record.sets.map((set) => set.setNumber)).toEqual([1, 3]);
  });

  it("merges two entries logged on the same day instead of dropping one", () => {
    const [record] = getSessionRecords(
      exercise([
        { date: "2026-08-01", sets: [s(80, 6)] },
        { date: "2026-08-01", sets: [s(85, 6)] },
      ])
    );
    expect(record.sets).toHaveLength(2);
    // 85x6 can only have come from the second entry, so the top set proves
    // the merge rather than one entry silently replacing the other.
    expect(record.topSet.weight).toBe(85);
  });

  it("ranks the top set by e1RM, so 80x6 beats 85x3", () => {
    const [record] = getSessionRecords(
      exercise([{ date: "2026-08-01", sets: [s(80, 6), s(85, 3)] }])
    );
    expect(record.topSet).toEqual({ weight: 80, reps: 6 });
  });

  it("never mixes the two server history lists", () => {
    // Concatenating them double-counted every date they shared.
    const records = getSessionRecords(
      exercise([{ date: "2026-08-01", sets: [s(80, 6)] }], {
        history_context: {
          lifetime_session_count: 1,
          recent_sessions: [{ date: "2026-08-01", sets: [s(80, 6)] }],
        },
      } as Partial<ProjectedExercise>)
    );
    expect(records).toHaveLength(1);
    expect(records[0].sets).toHaveLength(1);
  });

  it("ignores the projector's synthetic week rows", () => {
    const records = getSessionRecords(
      exercise([
        { date: "2026-08-01", sets: [s(80, 6)] },
        { date: "week-4", sets: [s(200, 6)] },
      ])
    );
    expect(records).toHaveLength(1);
    expect(records[0].date).toBe("2026-08-01");
  });

  it("flags unloaded work as bodyweight and ranks its top set by reps", () => {
    const [record] = getSessionRecords(
      exercise([{ date: "2026-08-01", sets: [s(0, 8), s(0, 12), s(0, 6)] }])
    );
    expect(record.isBodyweight).toBe(true);
    expect(record.topSet.reps).toBe(12);
    expect(record.e1rm).toBe(0);
  });
});

describe("sessionValue", () => {
  const bodyweight = { isBodyweight: true, topSet: { weight: 0, reps: 12 }, e1rm: 0 } as LoggedSession;
  const loaded = { isBodyweight: false, topSet: { weight: 80, reps: 6 }, e1rm: 96 } as LoggedSession;

  it("charts unloaded work in reps rather than a flat zero e1RM", () => {
    expect(sessionValue(bodyweight, "reps")).toBe(12);
  });

  it("breaks the line for an unloaded session on a loaded exercise", () => {
    // Plotting 0 here read as a total collapse in strength.
    expect(sessionValue(bodyweight, "e1rm")).toBeNull();
  });

  it("charts loaded work in e1RM", () => {
    expect(sessionValue(loaded, "e1rm")).toBe(96);
  });
});

describe("compareSessions", () => {
  const session = (weight: number, reps: number, e1rm: number) =>
    ({ topSet: { weight, reps }, e1rm, isBodyweight: weight === 0 }) as LoggedSession;

  it("calls the very first session a baseline, not progress", () => {
    // "Moving up" against nothing at all was the old behaviour.
    expect(compareSessions(undefined, session(80, 6, 96))).toBe("baseline");
  });

  it("reads more weight as progress", () => {
    expect(compareSessions(session(80, 6, 96), session(85, 6, 102))).toBe("progress");
  });

  it("reads more reps at the same weight as progress", () => {
    expect(compareSessions(session(80, 6, 96), session(80, 8, 101))).toBe("progress");
  });

  it("reads an identical session as maintaining", () => {
    expect(compareSessions(session(80, 6, 96), session(80, 6, 96))).toBe("maintain");
  });

  it("reads fewer reps at the same weight as a stall", () => {
    expect(compareSessions(session(80, 6, 96), session(80, 4, 90))).toBe("stall");
  });
});

describe("buildExerciseChart", () => {
  it("inserts a break across a layoff instead of connecting through it", () => {
    const { points } = buildExerciseChart(
      exercise([
        { date: "2026-06-01", sets: [s(80, 6)] },
        { date: "2026-08-01", sets: [s(85, 6)] },
      ])
    );
    expect(points.map((p) => p.trend)).toEqual(["baseline", "gap", "progress"]);
    expect(points[1].value).toBeNull();
  });

  it("does not insert a break for a normal weekly cadence", () => {
    const { points } = buildExerciseChart(
      exercise([
        { date: "2026-08-01", sets: [s(80, 6)] },
        { date: "2026-08-08", sets: [s(80, 6)] },
      ])
    );
    expect(points.some((p) => p.trend === "gap")).toBe(false);
  });

  it("carries a timestamp so the axis can space points by date", () => {
    const { points } = buildExerciseChart(exercise([{ date: "2026-08-01", sets: [s(80, 6)] }]));
    expect(Number.isNaN(points[0].t)).toBe(false);
  });

  it("charts a never-loaded exercise in reps", () => {
    const chart = buildExerciseChart(
      exercise([
        { date: "2026-08-01", sets: [s(0, 8)] },
        { date: "2026-08-08", sets: [s(0, 11)] },
      ])
    );
    expect(chart.metric).toBe("reps");
    // The bug: every one of these plotted at 0 and the line sat on the floor.
    expect(chart.points.map((p) => p.value)).toEqual([8, 11]);
  });

  it("honours a per-set override that returns null for a missing set", () => {
    const chart = buildExerciseChart(
      exercise([
        { date: "2026-08-01", sets: [s(80, 6), s(80, 5), s(75, 8)] },
        { date: "2026-08-08", sets: [s(80, 6)] },
      ]),
      (session) => {
        const set = session.sets.find((item) => item.setNumber === 3);
        return set ? set.reps : null;
      }
    );
    // A session that never had a set 3 must break the line, not plot zero.
    expect(chart.points.map((p) => p.value)).toEqual([8, null]);
  });
});

describe("rollingAverage", () => {
  it("smooths within a window", () => {
    expect(rollingAverage([3, 6, 9], 3)).toEqual([3, 4.5, 6]);
  });

  it("restarts after a gap rather than averaging across a layoff", () => {
    const out = rollingAverage([10, 10, null, 100], 3);
    expect(out[3]).toBe(100);
  });
});

describe("sessionStimulus", () => {
  it("counts weight by reps for loaded work", () => {
    expect(sessionStimulus([{ setNumber: 1, weight: 100, reps: 5 }])).toBe(500);
  });

  it("counts reps for unloaded work instead of scoring it zero", () => {
    expect(sessionStimulus([{ setNumber: 1, weight: 0, reps: 12 }])).toBe(12);
  });
});

describe("buildMuscleGroupPoints", () => {
  const day = (date: string, stimulus: number) => ({
    date,
    stimulus,
    sessions: [
      {
        exercise_id: "ex-1",
        exercise_name: "Incline Dumbbell Press",
        sets: [{ set_number: 1, weight: 80, reps: 6 }],
      },
    ],
  });

  it("smooths a single outlier instead of reporting it as a trend", () => {
    const points = buildMuscleGroupPoints([
      day("2026-08-01", 1000),
      day("2026-08-08", 1000),
      day("2026-08-15", 4000),
    ]);
    // The raw value is 4x, but a 3-wide window puts the smoothed value at
    // 2000 against a smoothed 1000 — a rise, not a spike.
    expect(points[2].value).toBe(2000);
  });

  it("compares smoothed against smoothed, so one spike does not read as a stall", () => {
    const points = buildMuscleGroupPoints([
      day("2026-08-01", 1000),
      day("2026-08-08", 1000),
      day("2026-08-15", 3000),
      day("2026-08-22", 1200),
    ]);
    // Rolling volume climbs across the block (1667 -> 1733). Measuring the
    // smoothed value against the previous *raw* 3000 called that a stall —
    // exactly the single-session sensitivity the smoothing exists to remove.
    expect(points[3].trend).toBe("progress");
  });

  it("orders days chronologically regardless of input order", () => {
    const points = buildMuscleGroupPoints([day("2026-08-15", 1), day("2026-08-01", 1)]);
    expect(points.map((p) => p.date)).toEqual(["2026-08-01", "2026-08-15"]);
  });

  it("breaks the line across a layoff", () => {
    const points = buildMuscleGroupPoints([day("2026-06-01", 1000), day("2026-08-01", 1000)]);
    expect(points[1].value).toBeNull();
    expect(points[1].trend).toBe("gap");
  });

  it("attaches every lift behind a day so scrubbing can list them", () => {
    const points = buildMuscleGroupPoints([day("2026-08-01", 1000)]);
    expect(points[0].sessions).toHaveLength(1);
    expect(points[0].sessions?.[0].exerciseName).toBe("Incline Dumbbell Press");
  });

  it("scrubs to set count instead of volume", () => {
    const points = buildMuscleGroupPoints([
      {
        date: "2026-08-29",
        stimulus: 537,
        sessions: [
          {
            exercise_id: "ex-1",
            exercise_name: "Incline Dumbbell Press",
            sets: [
              { set_number: 1, weight: 80, reps: 3 },
              { set_number: 2, weight: 80, reps: 4 },
              { set_number: 3, weight: 70, reps: 6 },
            ],
          },
        ],
      },
    ]);
    expect(points[0].scrubText).toBe("3 sets");
  });
});

describe("trendColor", () => {
  it("gives progress and maintain distinct marks", () => {
    // These were the same colour on any chart whose accent was already teal.
    expect(trendColor("progress")).not.toBe(trendColor("maintain"));
  });

  it("distinguishes a stall from progress", () => {
    expect(trendColor("stall")).not.toBe(trendColor("progress"));
  });
});
