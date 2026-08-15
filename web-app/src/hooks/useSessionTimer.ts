import { useState, useEffect, useRef, useCallback } from "react";

const STORAGE_PREFIX = "gymai-session-timer:";

export type SessionTimerPersist = {
  accumulatedMs: number;
  runningSince: number | null;
  firstStartedAt: number | null;
};

function emptyPersist(): SessionTimerPersist {
  return { accumulatedMs: 0, runningSince: null, firstStartedAt: null };
}

function storageKeyFor(id: string) {
  return `${STORAGE_PREFIX}${id}`;
}

function readPersist(id: string): SessionTimerPersist | null {
  try {
    const raw = localStorage.getItem(storageKeyFor(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      accumulatedMs: Number(parsed.accumulatedMs) || 0,
      runningSince:
        typeof parsed.runningSince === "number" ? parsed.runningSince : null,
      firstStartedAt:
        typeof parsed.firstStartedAt === "number" ? parsed.firstStartedAt : null,
    };
  } catch {
    return null;
  }
}

function writePersist(id: string, state: SessionTimerPersist) {
  try {
    localStorage.setItem(storageKeyFor(id), JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

function clearPersist(id: string) {
  try {
    localStorage.removeItem(storageKeyFor(id));
  } catch {
    // ignore
  }
}

function elapsedSecondsFrom(state: SessionTimerPersist) {
  const extra = state.runningSince ? Date.now() - state.runningSince : 0;
  return Math.max(0, Math.floor((state.accumulatedMs + extra) / 1000));
}

function formatElapsed(elapsedSeconds: number) {
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function persistFromSession(session?: {
  timer_accumulated_ms?: number | null;
  timer_running_since?: string | null;
  timer_started_at?: string | null;
} | null): SessionTimerPersist | null {
  if (!session) return null;
  const accumulated = Number(session.timer_accumulated_ms) || 0;
  const runningSince = session.timer_running_since
    ? Date.parse(session.timer_running_since)
    : NaN;
  const firstStartedAt = session.timer_started_at
    ? Date.parse(session.timer_started_at)
    : NaN;
  if (!accumulated && Number.isNaN(runningSince) && Number.isNaN(firstStartedAt)) {
    return null;
  }
  return {
    accumulatedMs: accumulated,
    runningSince: Number.isFinite(runningSince) ? runningSince : null,
    firstStartedAt: Number.isFinite(firstStartedAt) ? firstStartedAt : null,
  };
}

export function useSessionTimer(
  storageKey: string | null,
  seed?: SessionTimerPersist | null
) {
  const stateRef = useRef<SessionTimerPersist>(emptyPersist());
  const keyRef = useRef<string | null>(storageKey);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [firstStartedAt, setFirstStartedAt] = useState<number | null>(null);

  const applyState = useCallback((next: SessionTimerPersist) => {
    stateRef.current = next;
    setIsRunning(Boolean(next.runningSince));
    setFirstStartedAt(next.firstStartedAt);
    setElapsedSeconds(elapsedSecondsFrom(next));
    if (keyRef.current) writePersist(keyRef.current, next);
  }, []);

  const loadForKey = useCallback(
    (key: string | null, nextSeed?: SessionTimerPersist | null) => {
      if (!key) {
        stateRef.current = emptyPersist();
        setElapsedSeconds(0);
        setIsRunning(false);
        setFirstStartedAt(null);
        return;
      }
      const stored = readPersist(key);
      const incoming = stored || nextSeed || emptyPersist();
      applyState(incoming);
    },
    [applyState]
  );

  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    const prevKey = keyRef.current;
    if (prevKey && storageKey && prevKey !== storageKey) {
      const prev = readPersist(prevKey);
      const next = readPersist(storageKey);
      if (prev && !next) {
        writePersist(storageKey, prev);
        clearPersist(prevKey);
      }
    }
    keyRef.current = storageKey;
    loadForKey(storageKey, seedRef.current || null);
  }, [storageKey, loadForKey]);

  useEffect(() => {
    const tick = () => {
      setElapsedSeconds(elapsedSecondsFrom(stateRef.current));
    };
    tick();
    const interval = window.setInterval(tick, 250);
    const onVis = () => {
      tick();
      if (keyRef.current) writePersist(keyRef.current, stateRef.current);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("pagehide", onVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("pagehide", onVis);
    };
  }, []);

  const start = useCallback(() => {
    const current = stateRef.current;
    if (current.runningSince) return;
    applyState({
      accumulatedMs: current.accumulatedMs,
      runningSince: Date.now(),
      firstStartedAt: current.firstStartedAt || Date.now(),
    });
  }, [applyState]);

  const stop = useCallback(() => {
    const current = stateRef.current;
    if (!current.runningSince) return;
    applyState({
      accumulatedMs: current.accumulatedMs + (Date.now() - current.runningSince),
      runningSince: null,
      firstStartedAt: current.firstStartedAt,
    });
  }, [applyState]);

  const refresh = useCallback(() => {
    const key = keyRef.current;
    const stored = key ? readPersist(key) : null;
    applyState(stored || stateRef.current);
  }, [applyState]);

  const reset = useCallback(() => {
    applyState(emptyPersist());
  }, [applyState]);

  const clear = useCallback(() => {
    if (keyRef.current) clearPersist(keyRef.current);
    clearPersist("draft");
    applyState(emptyPersist());
  }, [applyState]);

  const getPersist = useCallback(() => ({ ...stateRef.current }), []);

  return {
    elapsedSeconds,
    isRunning,
    firstStartedAt,
    formattedTime: formatElapsed(elapsedSeconds),
    start,
    stop,
    refresh,
    reset,
    clear,
    getPersist,
  };
}
