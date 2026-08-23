/**
 * App-wide notification wiring.
 *
 * Kept separate from the sleep reminder itself so that the next reminder type
 * (a workout nudge, a check-in) plugs in here rather than re-declaring how
 * notifications behave.
 */

import * as Notifications from "expo-notifications";

let configured = false;

/**
 * How a notification behaves when it arrives while the app is open.
 *
 * A banner but no sound: if you are already in the app, being pinged about
 * logging sleep is noise, and the banner is enough to act on.
 */
export function configureNotifications(): void {
  if (configured) return;
  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export {
  SLEEP_REMINDER_TYPE,
  clearSleepReminders,
  loadSettings as loadSleepReminderSettings,
  saveSettings as saveSleepReminderSettings,
  syncSleepReminders,
  formatTime,
  DEFAULT_SETTINGS as DEFAULT_SLEEP_REMINDER,
} from "./sleepReminder";
export type { SleepReminderSettings } from "./sleepReminder";
