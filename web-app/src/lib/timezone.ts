import apiClient from "./api-client";

const STORAGE_PREFIX = "gymai.timezone.synced";

/** Keep server-side relative dates on the browser user's calendar. */
export async function syncTimezone(userId: string): Promise<void> {
  let timezone: string;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return;
  }
  if (!timezone) return;

  // Scope the cache to the signed-in account. A shared browser may otherwise
  // skip the write for a second user simply because both users live nearby.
  const storageKey = `${STORAGE_PREFIX}.${userId}`;
  try {
    if (localStorage.getItem(storageKey) === timezone) return;
  } catch {
    // Storage can be unavailable in privacy modes; sending again is harmless.
  }

  try {
    await apiClient.put("/api/user-profile/timezone", { timezone });
    try {
      localStorage.setItem(storageKey, timezone);
    } catch {
      // The backend is already updated; failure to cache is non-fatal.
    }
  } catch {
    // Offline and older-backend failures must not block sign-in.
  }
}
