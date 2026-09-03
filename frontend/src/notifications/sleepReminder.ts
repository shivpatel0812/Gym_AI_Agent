/**
 * Nightly-ish reminder to log how you slept.
 *
 * Local notifications, not push. A "log your sleep" nudge fires at a fixed
 * wall-clock time the user picked; nothing about that decision needs a server,
 * a push token, or APNs credentials, and doing it locally means it still works
 * on a plane and costs the user no privacy.
 *
 * The one non-obvious piece is the *rolling window*. The obvious approach is a
 * single daily-repeating trigger, but a repeating trigger cannot skip one
 * occurrence — so a user who logs at 07:00 still gets nagged at 09:00 about the
 * thing they already did. Being reminded to do something you have already done
 * is the fastest way to get notifications switched off for good. So instead we
 * keep a short queue of individual dated notifications and simply leave out the
 * days that are already logged, re-arming whenever that set changes.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const SETTINGS_KEY = "gymai.notifications.sleepReminder";
const ANDROID_CHANNEL_ID = "sleep-reminders";

/**
 * How many days ahead to keep queued. Re-armed on every app open.
 *
 * Deliberately short. iOS caps an app at 64 pending local notifications and
 * silently drops the rest, so this budget has to be shared with every reminder
 * type added later — a workout nudge, a check-in. Two weeks is far more runway
 * than someone who has not opened the app in two weeks needs.
 */
const HORIZON_DAYS = 14;

/** Morning, not night: you log the night you have just finished. */
export const DEFAULT_HOUR = 9;
export const DEFAULT_MINUTE = 0;

export interface SleepReminderSettings {
  enabled: boolean;
  hour: number;
  minute: number;
}

export const DEFAULT_SETTINGS: SleepReminderSettings = {
  enabled: false,
  hour: DEFAULT_HOUR,
  minute: DEFAULT_MINUTE,
};

/** Marks our notifications so re-arming never cancels someone else's. */
const REMINDER_TYPE = "sleep-reminder";

export function formatTime(hour: number, minute: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// --- settings -------------------------------------------------------------

export async function loadSettings(): Promise<SleepReminderSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed?.enabled),
      hour: clamp(Number(parsed?.hour), 0, 23, DEFAULT_HOUR),
      minute: clamp(Number(parsed?.minute), 0, 59, DEFAULT_MINUTE),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: SleepReminderSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // A failed write means the toggle does not survive a restart. Not worth
    // interrupting the user over, and the scheduled notifications still stand.
  }
}

function clamp(value: number, low: number, high: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, Math.round(value)));
}

// --- permission -----------------------------------------------------------

/** Android needs a channel before anything will show. Safe to call repeatedly. */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Sleep reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
    vibrationPattern: [0, 200],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

/**
 * Ask only when the user has just asked for reminders.
 *
 * iOS allows exactly one prompt, ever. Spending it on app launch — before the
 * user has any idea what we would send them — is how apps end up permanently
 * unable to notify anyone.
 *
 * On Android 13+, create the channel first — the OS often only surfaces the
 * POST_NOTIFICATIONS prompt after a channel exists.
 */
export async function ensurePermission(): Promise<boolean> {
  await ensureAndroidChannel();

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }
  if (!existing.canAskAgain) return false;

  const request = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return Boolean(request.granted);
}

// --- scheduling -----------------------------------------------------------

async function cancelOurs(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => item.content?.data?.type === REMINDER_TYPE)
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier))
  );
}

/**
 * The dates worth queueing: the next `HORIZON_DAYS`, minus anything already
 * logged, minus any time that has already passed today.
 */
export function pendingDates(
  settings: SleepReminderSettings,
  loggedDates: Set<string>,
  now: Date = new Date()
): Date[] {
  const out: Date[] = [];
  for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
    const when = new Date(now);
    when.setDate(when.getDate() + offset);
    when.setHours(settings.hour, settings.minute, 0, 0);

    if (when.getTime() <= now.getTime()) continue;
    if (loggedDates.has(dateKey(when))) continue;
    out.push(when);
  }
  return out;
}

/**
 * Bring the scheduled queue in line with settings and what has been logged.
 *
 * Cheap enough to call on every app open, every settings change, and every
 * save — which is what keeps "already logged, so no nag" true rather than
 * merely intended.
 */
export async function syncSleepReminders(
  settings: SleepReminderSettings,
  loggedDates: Iterable<string>
): Promise<number> {
  await cancelOurs();
  if (!settings.enabled) return 0;

  const granted = await ensurePermission();
  if (!granted) return 0;
  await ensureAndroidChannel();

  const logged = new Set(loggedDates);
  const dates = pendingDates(settings, logged);

  await Promise.all(
    dates.map((when) =>
      Notifications.scheduleNotificationAsync({
        content: {
          title: "How did you sleep?",
          body: "Log last night while you still remember it — it takes a few seconds.",
          data: { type: REMINDER_TYPE, date: dateKey(when) },
          ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
        },
      })
    )
  );

  return dates.length;
}

/**
 * Fire one notification in a few seconds so the user can confirm permission
 * and delivery without waiting until tomorrow morning.
 */
export async function sendTestSleepReminder(): Promise<boolean> {
  const granted = await ensurePermission();
  if (!granted) return false;
  await ensureAndroidChannel();

  const when = new Date(Date.now() + 5_000);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "How did you sleep?",
      body: "Test reminder — if you see this, sleep notifications are working.",
      data: { type: REMINDER_TYPE, date: dateKey(when), test: true },
      ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: when,
    },
  });
  return true;
}

/** Turn every reminder off, e.g. on logout. */
export async function clearSleepReminders(): Promise<void> {
  await cancelOurs();
}

export const SLEEP_REMINDER_TYPE = REMINDER_TYPE;
