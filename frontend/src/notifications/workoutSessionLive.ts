/**
 * Spotify-style workout presence: iOS Live Activity + Android sticky notification.
 *
 * Shows session timer, current exercise, set progress, and a one-tap
 * "Log set" that fills the prescribed weight/reps. Full number pads still
 * live in the app — OS lock screens don't allow free-form entry.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { type WorkoutLiveSnapshot } from "./workoutSessionSnapshot";

export {
  buildWorkoutLiveSnapshot,
  type WorkoutLiveSnapshot,
} from "./workoutSessionSnapshot";

export const WORKOUT_LIVE_TYPE = "workoutlive";
export const WORKOUT_LOG_SET_ACTION = "LOG_SET";
export const WORKOUT_OPEN_ACTION = "OPEN_SESSION";
export const WORKOUT_CATEGORY = "workout-live";
export const WORKOUT_NOTIF_ID = "gymai-workout-live";
export const WORKOUT_CHANNEL_ID = "workout-live";

export const WORKOUT_OPEN_URL = "gymai://workout/session";
export const WORKOUT_LOG_SET_URL = "gymai://workout/log-set";

let categoryReady = false;
let lastFingerprint = "";
let liveActivity: { update: (p: any) => Promise<void>; end: (d?: any, p?: any) => Promise<void> } | null =
  null;
let WorkoutLiveActivityFactory: {
  start: (props: any, url?: string, staleDate?: Date) => typeof liveActivity;
  getInstances: () => Array<NonNullable<typeof liveActivity>>;
} | null = null;

function loadLiveActivityFactory() {
  if (Platform.OS !== "ios") return null;
  if (WorkoutLiveActivityFactory) return WorkoutLiveActivityFactory;
  try {
    // Lazy require so Expo Go / Android never touch the native module at import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../../widgets/WorkoutLiveActivity");
    WorkoutLiveActivityFactory = mod.default || mod;
    return WorkoutLiveActivityFactory;
  } catch {
    return null;
  }
}

function fingerprint(snapshot: WorkoutLiveSnapshot) {
  return [
    snapshot.exerciseName,
    snapshot.setLabel,
    snapshot.prescription,
    snapshot.isRunning ? "1" : "0",
    // Elapsed is native on iOS; only bump Android notif every 30s.
    Platform.OS === "android" ? Math.floor(snapshot.elapsedSeconds / 30) : "t",
  ].join("|");
}

async function ensureCategory() {
  if (categoryReady) return;
  categoryReady = true;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(WORKOUT_CHANNEL_ID, {
      name: "Workout in progress",
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: [0],
      enableVibrate: false,
      showBadge: false,
    });
  }
  await Notifications.setNotificationCategoryAsync(WORKOUT_CATEGORY, [
    {
      identifier: WORKOUT_LOG_SET_ACTION,
      buttonTitle: "Log set",
      options: { opensAppToForeground: true },
    },
    {
      identifier: WORKOUT_OPEN_ACTION,
      buttonTitle: "Open",
      options: { opensAppToForeground: true },
    },
  ]);
}

function formatElapsed(elapsedSeconds: number) {
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function syncAndroidNotification(snapshot: WorkoutLiveSnapshot) {
  await ensureCategory();
  const perms = await Notifications.getPermissionsAsync();
  if (perms.status !== "granted") {
    const asked = await Notifications.requestPermissionsAsync();
    if (asked.status !== "granted") return;
  }
  const bodyParts = [snapshot.setLabel, snapshot.prescription].filter(Boolean);
  const elapsed = formatElapsed(snapshot.elapsedSeconds);
  bodyParts.push(elapsed);
  await Notifications.scheduleNotificationAsync({
    identifier: WORKOUT_NOTIF_ID,
    content: {
      title: snapshot.exerciseName,
      body: bodyParts.join(" · "),
      categoryIdentifier: WORKOUT_CATEGORY,
      sticky: true,
      autoDismiss: false,
      data: {
        type: WORKOUT_LIVE_TYPE,
        exerciseIdx: snapshot.exerciseIdx,
        setIdx: snapshot.setIdx,
        weight: snapshot.weight ?? null,
        reps: snapshot.reps ?? null,
      },
      ...(Platform.OS === "android"
        ? {
            channelId: WORKOUT_CHANNEL_ID,
            priority: Notifications.AndroidNotificationPriority.LOW,
          }
        : {}),
    },
    trigger: null,
  });
}

async function syncIosLiveActivity(snapshot: WorkoutLiveSnapshot) {
  const factory = loadLiveActivityFactory();
  if (!factory) return;

  const props = {
    dayLabel: snapshot.dayLabel,
    exerciseName: snapshot.exerciseName,
    setLabel: snapshot.setLabel,
    prescription: snapshot.prescription,
    timerBaseEpochMs: snapshot.timerBaseEpochMs,
    isRunning: snapshot.isRunning,
    pauseTimeEpochMs: snapshot.pauseTimeEpochMs || Date.now(),
    logSetUrl: WORKOUT_LOG_SET_URL,
  };
  const staleDate = new Date(Date.now() + 4 * 60 * 60 * 1000);

  try {
    if (!liveActivity) {
      const existing = factory.getInstances?.() || [];
      if (existing.length) {
        liveActivity = existing[0];
        await liveActivity.update(props);
      } else {
        liveActivity = factory.start(props, WORKOUT_OPEN_URL, staleDate);
      }
    } else {
      await liveActivity.update(props);
    }
  } catch (err) {
    // Live Activities need iOS 16.2+, a real device/dev build, and user permission.
    console.warn("[workout-live] Live Activity unavailable", err);
    liveActivity = null;
  }
}

export async function syncWorkoutLive(snapshot: WorkoutLiveSnapshot | null): Promise<void> {
  if (!snapshot) {
    await endWorkoutLive();
    return;
  }
  const fp = fingerprint(snapshot);
  // Android refreshes the sticky body every 30s via the fingerprint bucket;
  // iOS timer ticks natively so exercise/set/pause changes are the only bumps.
  if (fp === lastFingerprint) return;
  lastFingerprint = fp;

  if (Platform.OS === "ios") {
    await syncIosLiveActivity(snapshot);
    return;
  }
  // Android: sticky ongoing notification with Log set / Open actions.
  await syncAndroidNotification(snapshot);
}

export async function endWorkoutLive(): Promise<void> {
  lastFingerprint = "";
  try {
    await Notifications.dismissNotificationAsync(WORKOUT_NOTIF_ID);
  } catch {
    // ignore
  }
  try {
    await Notifications.cancelScheduledNotificationAsync(WORKOUT_NOTIF_ID);
  } catch {
    // ignore
  }
  if (liveActivity) {
    try {
      await liveActivity.end("immediate");
    } catch {
      // ignore
    }
    liveActivity = null;
  }
  const factory = loadLiveActivityFactory();
  if (factory?.getInstances) {
    for (const instance of factory.getInstances()) {
      try {
        await instance.end("immediate");
      } catch {
        // ignore
      }
    }
  }
}
