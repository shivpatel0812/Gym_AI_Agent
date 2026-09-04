import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./client";

const STORAGE_KEY = "gymai.timezone.synced";

/**
 * The device's IANA timezone, e.g. "America/New_York".
 *
 * Available on every device with no permission prompt, which is why the app
 * never asks the user what timezone they are in.
 */
export function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Tell the backend which timezone this device is in, so anything the server
 * decides on its own — a default date, the current meal slot — lands on the
 * user's calendar day instead of UTC.
 *
 * Silent and best-effort: it re-sends only when the zone actually changes, so
 * a normal launch costs nothing, and a failure never blocks the app. Travel is
 * handled for free — the new zone differs from the stored one and gets sent.
 */
export async function syncTimezone(userId?: string): Promise<void> {
  const timezone = deviceTimezone();
  if (!timezone) return;
  const storageKey = userId ? `${STORAGE_KEY}.${userId}` : STORAGE_KEY;
  try {
    if ((await AsyncStorage.getItem(storageKey)) === timezone) return;
  } catch {
    // Unreadable cache just means we send it again.
  }
  try {
    await apiClient.put("/api/user-profile/timezone", { timezone });
    await AsyncStorage.setItem(storageKey, timezone).catch(() => {});
  } catch {
    // Offline or an older backend — the clients still send explicit dates.
  }
}
