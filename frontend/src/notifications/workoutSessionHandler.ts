/**
 * Handle Live Activity deep links and sticky-notification actions for workouts.
 */

import * as Notifications from "expo-notifications";
import { Linking } from "react-native";
import {
  WORKOUT_LIVE_TYPE,
  WORKOUT_LOG_SET_ACTION,
  WORKOUT_LOG_SET_URL,
  WORKOUT_OPEN_ACTION,
  WORKOUT_OPEN_URL,
} from "./workoutSessionLive";
import { requestWorkoutLiveAction } from "./pendingWorkoutAction";

let responseSub: Notifications.EventSubscription | null = null;
let linkingSub: { remove: () => void } | null = null;
let handledResponseIds = new Set<string>();

function parseWorkoutUrl(url: string | null | undefined): "open-session" | "log-set" | null {
  if (!url) return null;
  const normalized = url.trim().toLowerCase();
  if (
    normalized === WORKOUT_LOG_SET_URL ||
    normalized.startsWith("gymai://workout/log-set")
  ) {
    return "log-set";
  }
  if (
    normalized === WORKOUT_OPEN_URL ||
    normalized.startsWith("gymai://workout/session") ||
    normalized.startsWith("gymai://workout")
  ) {
    return "open-session";
  }
  return null;
}

function handleUrl(url: string | null | undefined) {
  const kind = parseWorkoutUrl(url);
  if (kind === "log-set") {
    requestWorkoutLiveAction({ type: "log-set", exerciseIdx: -1, setIdx: -1 });
    return;
  }
  if (kind === "open-session") {
    requestWorkoutLiveAction({ type: "open-session" });
  }
}

export function handleWorkoutNotificationResponse(
  response: Notifications.NotificationResponse
) {
  const id = response.notification.request.identifier;
  if (handledResponseIds.has(id + response.actionIdentifier)) return;
  handledResponseIds.add(id + response.actionIdentifier);

  const data = response.notification.request.content.data || {};
  if (data.type !== WORKOUT_LIVE_TYPE) return;

  const action = response.actionIdentifier;
  if (action === WORKOUT_LOG_SET_ACTION) {
    requestWorkoutLiveAction({
      type: "log-set",
      exerciseIdx: Number(data.exerciseIdx),
      setIdx: Number(data.setIdx),
      weight: data.weight != null ? Number(data.weight) : undefined,
      reps: data.reps != null ? Number(data.reps) : undefined,
    });
    return;
  }

  // Default tap or Open action.
  if (
    action === WORKOUT_OPEN_ACTION ||
    action === Notifications.DEFAULT_ACTION_IDENTIFIER
  ) {
    requestWorkoutLiveAction({ type: "open-session" });
  }
}

export function setupWorkoutLiveResponseHandler() {
  if (!responseSub) {
    responseSub = Notifications.addNotificationResponseReceivedListener(
      handleWorkoutNotificationResponse
    );
  }
  if (!linkingSub) {
    Linking.getInitialURL().then(handleUrl).catch(() => {});
    linkingSub = Linking.addEventListener("url", (event) => handleUrl(event.url));
  }

  return () => {
    responseSub?.remove();
    responseSub = null;
    linkingSub?.remove();
    linkingSub = null;
  };
}
