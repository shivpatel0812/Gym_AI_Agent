/**
 * Queue for workout Live Activity / sticky-notification actions that need the
 * session form (log prescribed set, open session).
 */

export type WorkoutLiveAction =
  | { type: "open-session" }
  | {
      type: "log-set";
      exerciseIdx: number;
      setIdx: number;
      weight?: number;
      reps?: number;
    };

type Listener = (action: WorkoutLiveAction) => void;

let pending: WorkoutLiveAction | null = null;
let listeners = new Set<Listener>();

export function requestWorkoutLiveAction(action: WorkoutLiveAction) {
  pending = action;
  listeners.forEach((fn) => {
    try {
      fn(action);
    } catch {
      // Listener errors shouldn't break notification handling.
    }
  });
}

export function consumeWorkoutLiveAction(): WorkoutLiveAction | null {
  const next = pending;
  pending = null;
  return next;
}

export function subscribeWorkoutLiveActions(listener: Listener): () => void {
  listeners.add(listener);
  if (pending) {
    try {
      listener(pending);
    } catch {
      // ignore
    }
  }
  return () => {
    listeners.delete(listener);
  };
}
